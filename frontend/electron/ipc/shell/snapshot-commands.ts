import path from 'node:path';
import fs from 'node:fs/promises';
import {
  normalizeReadModelSnapshot, buildReadModelHistoryFromJsonl, fallbackHistoryFromSnapshot,
} from '../../services/snapshot.js';
import {
  computeTaskGovernance, buildGovernanceEvents, loadEventAcks, applyAckStateToEvents,
  buildAuditTimeline, buildDailyDigestMarkdown,
} from '../../services/governance.js';
import type { CommandResult } from './types.js';
import type { ShellExecContext } from '../shell-exec-handler.js';

export async function handleSnapshotCommands(fullCommand: string, _ctx: ShellExecContext): Promise<CommandResult | null> {
  if (!fullCommand.startsWith('snapshot:')) return null;

  if (fullCommand.startsWith('snapshot:read-model')) {
    try {
      const payloadStr = fullCommand.replace('snapshot:read-model', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const historyCandidatePaths: string[] = Array.isArray(payload?.historyCandidatePaths)
        ? payload.historyCandidatePaths.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [];
      const historyDays = Math.max(1, Math.min(30, Number(payload?.historyDays || 7)));
      const taskHeartbeatTimeoutMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number(payload?.taskHeartbeatTimeoutMs || 10 * 60 * 1000)));
      const candidatePaths: string[] = Array.isArray(payload?.candidatePaths)
        ? payload.candidatePaths.map((item: unknown) => String(item || '').trim()).filter(Boolean)
        : [];

      for (const snapshotPath of candidatePaths) {
        try {
          await fs.access(snapshotPath);
          const content = await fs.readFile(snapshotPath, 'utf-8');
          const rawSnapshot = JSON.parse(content);
          const readModel = normalizeReadModelSnapshot(rawSnapshot);
          const nowIso = new Date().toISOString();
          const taskGovernance = computeTaskGovernance(readModel, taskHeartbeatTimeoutMs, nowIso);
          readModel.tasks = taskGovernance.tasks as typeof readModel.tasks;

          const runtimeDir = path.dirname(snapshotPath);
          const ackMap = await loadEventAcks(runtimeDir);
          const governanceEvents = [
            ...taskGovernance.events,
            ...buildGovernanceEvents(readModel, nowIso),
          ];
          const { activeEvents, ackedEvents } = applyAckStateToEvents(governanceEvents, ackMap, nowIso);

          const auditTimeline = await buildAuditTimeline(runtimeDir, governanceEvents);
          const dailyDigest = buildDailyDigestMarkdown(auditTimeline);
          let history: unknown[] = [];
          let historySourcePath = '';

          for (const historyPath of historyCandidatePaths) {
            try {
              await fs.access(historyPath);
              const historyRaw = await fs.readFile(historyPath, 'utf-8');
              const parsedHistory = buildReadModelHistoryFromJsonl(historyRaw, historyDays);
              if (parsedHistory.length > 0) {
                history = parsedHistory;
                historySourcePath = historyPath;
                break;
              }
            } catch {
              continue;
            }
          }

          if (history.length === 0) {
            history = fallbackHistoryFromSnapshot(readModel, historyDays);
          }

          return {
            code: 0,
            stdout: JSON.stringify({
              sourcePath: snapshotPath,
              historySourcePath,
              snapshot: rawSnapshot,
              readModel,
              history,
              eventQueue: activeEvents,
              ackedEvents,
              auditTimeline,
              dailyDigest,
            }),
            stderr: '',
            exitCode: 0,
          };
        } catch {
          continue;
        }
      }

      return { code: 1, stdout: '', stderr: 'No readable snapshot found', exitCode: 1 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'snapshot read-model failed', exitCode: 1 };
    }
  }

  return null;
}
