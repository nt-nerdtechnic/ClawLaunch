import { useCallback, useEffect } from 'react';
import type { ReadModelSnapshot, ReadModelHistoryPoint, EventQueueItem, AuditTimelineItem } from '../store';

interface UseSnapshotSyncParams {
  running: boolean;
  resolvedConfigDir: string;
  config: {
    workspacePath?: string;
    corePath?: string;
  };
  setSnapshot: (snapshot: ReadModelSnapshot | null) => void;
  setSnapshotHistory: (history: ReadModelHistoryPoint[]) => void;
  setEventQueue: (items: EventQueueItem[]) => void;
  setAckedEvents: (items: EventQueueItem[]) => void;
  setAuditTimeline: (items: AuditTimelineItem[]) => void;
  setDailyDigest: (digest: string) => void;
  setRawSnapshot: (rawSnapshot: ReadModelSnapshot | null) => void;
  setSnapshotSourcePath: (path: string) => void;
}

export function useSnapshotSync({
  running,
  resolvedConfigDir,
  config,
  setSnapshot,
  setSnapshotHistory,
  setEventQueue,
  setAckedEvents,
  setAuditTimeline,
  setDailyDigest,
  setRawSnapshot,
  setSnapshotSourcePath,
}: UseSnapshotSyncParams) {
  const syncSnapshot = useCallback(async () => {
    if (!window.electronAPI) return;

    try {
      const snapshotCandidates = [
        resolvedConfigDir ? `${resolvedConfigDir}/runtime/last-snapshot.json` : '',
        config.workspacePath ? `${config.workspacePath}/runtime/last-snapshot.json` : '',
        config.corePath ? `${config.corePath}/runtime/last-snapshot.json` : '',
      ].filter(Boolean);

      const historyCandidates = [
        resolvedConfigDir ? `${resolvedConfigDir}/runtime/usage-cost.jsonl` : '',
        resolvedConfigDir ? `${resolvedConfigDir}/runtime/timeline.log` : '',
        config.workspacePath ? `${config.workspacePath}/runtime/usage-cost.jsonl` : '',
        config.workspacePath ? `${config.workspacePath}/gateway.log` : '',
        config.corePath ? `${config.corePath}/runtime/usage-cost.jsonl` : '',
      ].filter(Boolean);

      const res = await window.electronAPI.exec(
        `snapshot:read-model ${JSON.stringify({ candidatePaths: snapshotCandidates, historyCandidatePaths: historyCandidates, historyDays: 30 })}`,
      );
      const code = res.code;
      if (code === 0 && res.stdout) {
        const parsed = JSON.parse(res.stdout || '{}');
        setRawSnapshot(parsed.snapshot || null);
        setSnapshot(parsed.readModel || null);
        setSnapshotHistory(Array.isArray(parsed.history) ? parsed.history : []);
        setEventQueue(Array.isArray(parsed.eventQueue) ? parsed.eventQueue : []);
        setAckedEvents(Array.isArray(parsed.ackedEvents) ? parsed.ackedEvents : []);
        setAuditTimeline(Array.isArray(parsed.auditTimeline) ? parsed.auditTimeline : []);
        setDailyDigest(String(parsed.dailyDigest || ''));
        setSnapshotSourcePath(String(parsed.sourcePath || ''));
      }
    } catch {
      // silent fail if files do not exist yet
    }
  }, [
    config.corePath,
    config.workspacePath,
    resolvedConfigDir,
    setAckedEvents,
    setAuditTimeline,
    setDailyDigest,
    setEventQueue,
    setRawSnapshot,
    setSnapshot,
    setSnapshotHistory,
    setSnapshotSourcePath,
  ]);

  useEffect(() => {
    if (!running) return;
    if (!resolvedConfigDir && !config.workspacePath && !config.corePath) return;

    void syncSnapshot();
    const interval = window.setInterval(() => {
      void syncSnapshot();
    }, 15000);

    return () => window.clearInterval(interval);
  }, [syncSnapshot, running, resolvedConfigDir, config.workspacePath, config.corePath]);

  return { syncSnapshot };
}
