import { ipcMain, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { resolveOpenClawRuntime } from '../services/openclaw-runtime.js';
import { extractCronDisplayNameFromText, extractMessageText, deriveSessionDisplayName } from '../utils/chat-helpers.js';
import { readLauncherConfigPaths } from '../services/activity-watcher.js';

const HOME = (() => { try { return app.getPath('home'); } catch { return process.env['HOME'] || process.env['USERPROFILE'] || ''; } })();

// ── Tail-read last JSONL message (reads only last TAIL_BYTES, not whole file) ─
const TAIL_BYTES = 8192;
async function readLastJsonlMessage(filePath: string): Promise<{ lastMessage: string; lastTimestamp: string }> {
  let fd: fsSync.promises.FileHandle | null = null;
  let lastMessage = '';
  let lastTimestamp = '';
  try {
    fd = await fs.open(filePath, 'r');
    const stat = await fd.stat();
    const fileSize = stat.size;
    if (fileSize === 0) return { lastMessage: '', lastTimestamp: '' };
    const readSize = Math.min(TAIL_BYTES, fileSize);
    const offset = fileSize - readSize;
    const buf = Buffer.allocUnsafe(readSize);
    await fd.read(buf, 0, readSize, offset);
    const chunk = buf.toString('utf-8');
    // Split into complete lines (skip the first partial line if we didn't start at byte 0)
    const lines = chunk.split(/\n/);
    const start = offset > 0 ? 1 : 0; // first element may be a partial line
    for (let i = lines.length - 1; i >= start; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'message') continue;
        const role = entry.message?.role;
        if (role === 'assistant' || role === 'user') {
          lastMessage = String(extractMessageText(entry.message) || '').slice(0, 100);
          lastTimestamp = String(entry.timestamp || '');
          break;
        }
      } catch { continue; }
    }
    return { lastMessage, lastTimestamp };
  } catch {
    return { lastMessage: '', lastTimestamp: '' };
  } finally {
    await fd?.close().catch(() => {});
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ChatHandlerContext {
  sendToRenderer: (channel: string, payload: unknown) => boolean;
  emitShellStdout: (data: string, source?: 'stdout' | 'stderr') => void;
  runShellCommand: (cmd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

export function registerChatHandler(_ctx: ChatHandlerContext): void {

  ipcMain.handle('openclaw:gateway.info', async () => {
    const runtime = await resolveOpenClawRuntime();
    return {
      baseUrl: `http://localhost:${runtime.gatewayPort}`,
      token: runtime.gatewayToken,
    };
  });

  ipcMain.handle('openclaw:sessions.list', async (_event, payloadRaw?: string) => {
    try {
      const opts = payloadRaw ? (() => { try { return JSON.parse(payloadRaw); } catch { return {}; } })() : {};
      const limit = (Number.isFinite(Number(opts?.limit)) && Number(opts.limit) > 0) ? Number(opts.limit) : 20;
      const offset = (Number.isFinite(Number(opts?.offset)) && Number(opts.offset) >= 0) ? Number(opts.offset) : 0;

      const { stateDir } = await readLauncherConfigPaths();
      const base = stateDir || path.join(HOME, '.openclaw');
      const agentsDir = path.join(base, 'agents');

      // ── Phase 1: fast metadata pass — read only sessions.json indexes ─────
      type SessionMeta = {
        sessionKey: string;
        agentId: string;
        sessionId: string;
        displayName: string;
        updatedAt: string;
        sessionFile: string;
        indexMeta: Record<string, unknown>;
      };
      const allMeta: SessionMeta[] = [];

      let agentIds: string[] = [];
      try {
        agentIds = await fs.readdir(agentsDir);
      } catch {
        return { code: 0, stdout: JSON.stringify({ sessions: [], total: 0, hasMore: false }), stderr: '' };
      }

      for (const agentId of agentIds) {
        const sessionsDir = path.join(agentsDir, agentId, 'sessions');
        const sessionsJsonPath = path.join(sessionsDir, 'sessions.json');

        let sessionsIndex: Record<string, unknown> = {};
        try {
          const raw = await fs.readFile(sessionsJsonPath, 'utf-8');
          sessionsIndex = JSON.parse(raw);
        } catch {
          continue;
        }

        for (const [sessionKey, metaRaw] of Object.entries(sessionsIndex) as [string, unknown][]) {
          const meta = metaRaw as Record<string, unknown>;
          const sessionId = String(meta?.sessionId || '');
          if (!sessionId) continue;
          const sessionFile: string = (typeof meta?.sessionFile === 'string' && meta.sessionFile)
            ? (meta.sessionFile as string)
            : path.join(sessionsDir, `${sessionId}.jsonl`);
          allMeta.push({
            sessionKey,
            agentId,
            sessionId,
            displayName: deriveSessionDisplayName(sessionKey, meta),
            updatedAt: String(meta?.updatedAt || ''),
            sessionFile,
            indexMeta: meta,
          });
        }
      }

      // Deduplicate: for cron sessions, group all :run:<uuid> variants under the base
      // job key so each cron job shows only its most recent run.
      const cronBaseKey = (sk: string) => { const i = sk.indexOf(':run:'); return i !== -1 ? sk.slice(0, i) : sk; };
      const dedupMap = new Map<string, SessionMeta>();
      for (const m of allMeta) {
        const groupKey = cronBaseKey(m.sessionKey);
        const existing = dedupMap.get(groupKey);
        if (!existing) {
          dedupMap.set(groupKey, m);
        } else {
          const ta = Number(m.updatedAt) || new Date(m.updatedAt).getTime() || 0;
          const tb = Number(existing.updatedAt) || new Date(existing.updatedAt).getTime() || 0;
          if (ta > tb) dedupMap.set(groupKey, m);
        }
      }
      const dedupedMeta = Array.from(dedupMap.values());

      // Sort descending by updatedAt
      dedupedMeta.sort((a, b) => {
        const ta = Number(a.updatedAt) || new Date(a.updatedAt).getTime() || 0;
        const tb = Number(b.updatedAt) || new Date(b.updatedAt).getTime() || 0;
        return tb - ta;
      });

      const total = dedupedMeta.length;
      const slice = dedupedMeta.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      // ── Phase 2: extract metadata only (no .jsonl read) ────────────────────
      const sessions: Array<{
        sessionKey: string;
        agentId: string;
        sessionId: string;
        displayName: string;
        lastMessage: string;
        lastTimestamp: string;
        messageCount: number;
      }> = new Array(slice.length);

      // Read only the tail of each .jsonl in parallel — no full-file scan
      await Promise.all(slice.map(async (m, idx) => {
        // Prefer metadata fields if available (avoid file I/O entirely)
        const metaMsg = String(m.indexMeta?.lastMessage || m.indexMeta?.preview || '').trim();
        const metaTs  = String(m.indexMeta?.lastTimestamp || m.updatedAt || '');
        const msgCount = Number.isFinite(Number(m.indexMeta?.messageCount))
          ? Number(m.indexMeta.messageCount)
          : -1;

        let lastMessage = metaMsg.slice(0, 100);
        let lastTimestamp = metaTs;

        if (!lastMessage) {
          const tail = await readLastJsonlMessage(m.sessionFile);
          lastMessage = tail.lastMessage;
          if (tail.lastTimestamp) lastTimestamp = tail.lastTimestamp;
        }

        sessions[idx] = {
          sessionKey: m.sessionKey,
          agentId: m.agentId,
          sessionId: m.sessionId,
          displayName: m.displayName,
          lastMessage,
          lastTimestamp,
          messageCount: msgCount,
        };
      }));
      // Preserve sort order (Promise.all preserves index)
      sessions.length = slice.length;

      return { code: 0, stdout: JSON.stringify({ sessions, total, hasMore }), stderr: '' };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'Unknown error' };
    }
  });

  ipcMain.handle('openclaw:session.load', async (_event, payload: { sessionKey: string; agentId: string }) => {
    try {
      const sessionKey = String(payload?.sessionKey || '').trim();
      const agentId = String(payload?.agentId || '').trim();
      if (!sessionKey || !agentId) {
        return { code: 1, stdout: '', stderr: 'Missing sessionKey or agentId' };
      }

      const { stateDir } = await readLauncherConfigPaths();
      const base = stateDir || path.join(HOME, '.openclaw');
      const sessionsDir = path.join(base, 'agents', agentId, 'sessions');

      let sessionFile = '';
      try {
        const raw = await fs.readFile(path.join(sessionsDir, 'sessions.json'), 'utf-8');
        const index = JSON.parse(raw) as Record<string, unknown>;
        const meta = index[sessionKey] as Record<string, unknown>;
        if (meta?.sessionFile && typeof meta.sessionFile === 'string') {
          sessionFile = meta.sessionFile as string;
        } else if (meta?.sessionId) {
          sessionFile = path.join(sessionsDir, `${meta.sessionId}.jsonl`);
        }
      } catch {
        sessionFile = path.join(sessionsDir, `${sessionKey}.jsonl`);
      }
      if (!sessionFile) {
        return { code: 0, stdout: JSON.stringify([]), stderr: '' };
      }

      let content = '';
      try {
        content = await fs.readFile(sessionFile, 'utf-8');
      } catch {
        return { code: 0, stdout: JSON.stringify([]), stderr: '' };
      }

      const messages: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: string;
      }> = [];

      const lines = content.split(/\r?\n/).filter(Boolean);
      let idx = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'message') continue;
          const role = entry.message?.role as string;
          if (role !== 'user' && role !== 'assistant') continue;
          const text = extractMessageText(entry.message);
          if (!text) continue;
          messages.push({
            id: String(entry.id || entry.message?.id || `loaded-${agentId}-${idx++}`),
            role: role as 'user' | 'assistant',
            content: text,
            timestamp: String(entry.timestamp || ''),
          });
        } catch { /* skip malformed line */ }
      }

      return { code: 0, stdout: JSON.stringify(messages), stderr: '' };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'Unknown error' };
    }
  });

  ipcMain.handle('openclaw:session.abort', async (_event, payload?: string) => {
    try {
      const opts = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
      const sessionKey = String(opts?.sessionKey || '').trim();
      if (!sessionKey) {
        return { success: false, error: 'sessionKey is required' };
      }

      const runtime = await resolveOpenClawRuntime();
      const { gatewayPort, gatewayToken } = runtime;
      if (!gatewayPort) return { success: false, error: 'Gateway port not configured' };

      // Use HTTP /sessions/:key/kill endpoint
      const { default: http } = await import('node:http');
      const encodedKey = encodeURIComponent(sessionKey);
      await new Promise<void>((resolve, reject) => {
        const req = http.request({
          host: 'localhost',
          port: Number(gatewayPort),
          path: `/sessions/${encodedKey}/kill`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${gatewayToken}`,
            'Content-Type': 'application/json',
            'Content-Length': 0,
          },
        }, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 400) resolve();
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
        req.on('error', reject);
        req.end();
      });

      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error)?.message || 'abort session failed' };
    }
  });

  ipcMain.handle('openclaw:sessions.scan', async (_event, payload?: string) => {
    try {
      const opts = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
      const activeMinutes = Number(opts?.activeMinutes ?? 3);
      const now = Date.now();
      const activeWindowMs = Math.max(1, activeMinutes) * 60 * 1000;
      const indexRunningHeartbeatMs = Number(opts?.runningHeartbeatMs ?? 90_000);
      const byKey = new Map<string, {
        key: string;
        kind: string;
        updatedAt: string;
        ageMs: number;
        sessionId: string;
        agentId?: string;
        displayName?: string;
        lastMessage?: string;
        model?: string;
        source: 'memory' | 'index';
        isRunning: boolean;
      }>();

      // Source 1: in-memory active requests removed (HTTP/SSE mode — renderer tracks state directly)

      // Source 2: scan OpenClaw session indexes so external/CLI tasks can still be observed.
      const { stateDir } = await readLauncherConfigPaths();
      const base = stateDir || path.join(HOME, '.openclaw');
      const agentsDir = path.join(base, 'agents');
      let agentIds: string[] = [];
      try { agentIds = await fs.readdir(agentsDir); } catch { agentIds = []; }

      for (const agentId of agentIds) {
        const sessionsJsonPath = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
        let sessionsIndex: Record<string, unknown> = {};
        try {
          const raw = await fs.readFile(sessionsJsonPath, 'utf-8');
          sessionsIndex = JSON.parse(raw);
        } catch {
          continue;
        }

        for (const [sessionKey, metaRaw] of Object.entries(sessionsIndex) as [string, unknown][]) {
          const meta = metaRaw as Record<string, unknown>;
          const normalizedKey = String(sessionKey || '').trim();
          if (!normalizedKey) continue;
          // Deduplicate cron :run:<uuid> variants — same logic as sessions.list
          const runIdx = normalizedKey.indexOf(':run:');
          const groupKey = runIdx !== -1 ? normalizedKey.slice(0, runIdx) : normalizedKey;
          const updatedAtRaw = String(meta?.updatedAt || '').trim();
          const updatedMs = updatedAtRaw ? (new Date(updatedAtRaw).getTime() || Number(updatedAtRaw) || 0) : 0;
          if (!updatedMs) continue;
          const ageMs = Math.max(0, now - updatedMs);
          if (ageMs > activeWindowMs) continue;

          const existing = byKey.get(groupKey);
          // Always keep in-memory live state over indexed historical state.
          if (existing?.source === 'memory') continue;
          if (existing && existing.ageMs <= ageMs) continue;

          const sessionId = String(meta?.sessionId || normalizedKey);
          let displayName = deriveSessionDisplayName(normalizedKey, meta);
          let lastMessage = '';
          let titleHint = '';

          const sessionFile: string = (typeof meta?.sessionFile === 'string' && meta.sessionFile)
            ? String(meta.sessionFile)
            : path.join(agentsDir, agentId, 'sessions', `${sessionId}.jsonl`);

          // Regex for completion markers in assistant messages
          const DONE_PATTERN = /[✅☑️✔️]|完成|已完成|done|finished|completed|succeeded|成功|sprint.*完成|合併.*完成/i;
          let lastAssistantText = '';
          let lastMessageRole = '';
          let isCompletedByContent = false;

          try {
            const content = await fs.readFile(sessionFile, 'utf-8');
            const lines = content.split(/\r?\n/).filter(Boolean);
            // Scan forward: collect title hint, lastMessage, and last assistant text
            for (let i = 0; i < lines.length; i++) {
              try {
                const entry = JSON.parse(lines[i]);
                if (entry?.type !== 'message') continue;
                const role = entry?.message?.role;
                if (role !== 'assistant' && role !== 'user') continue;
                const text = extractMessageText(entry.message);
                if (!text) continue;
                lastMessageRole = role;
                if (!titleHint) titleHint = extractCronDisplayNameFromText(text);
                lastMessage = text.slice(0, 160);
                if (role === 'assistant') lastAssistantText = text;
              } catch {
                continue;
              }
            }
            // Detect completion from last assistant message
            if (lastAssistantText && DONE_PATTERN.test(lastAssistantText)) {
              isCompletedByContent = true;
            }
          } catch {
            lastMessage = '';
          }

          if (titleHint) displayName = titleHint;

          // Determine running state:
          // - 'main' type is a persistent daemon listener (not a one-shot task); only mark
          //   running if in-memory (handled in source-1 above), never from index.
          // - cron/subagent: prefer explicit run state from session index; fallback to heartbeat.
          const sessionType = normalizedKey.split(':')[2] || '';
          const isPersistentMain = sessionType === 'main';
          const runStateText = String(meta?.runState || meta?.status || meta?.state || '').toLowerCase();
          const hasExplicitRunningState = /(^|\b)(running|in_progress|in-progress|pending|initializing|streaming|executing|working)(\b|$)/.test(runStateText);
          const hasExplicitStoppedState = /(^|\b)(done|completed|success|succeeded|failed|error|aborted|stopped|cancelled|canceled|idle)(\b|$)/.test(runStateText);
          const isRunningFromIndex = !isPersistentMain
            && meta?.abortedLastRun !== true
            && !isCompletedByContent;
          const isHeartbeatFresh = ageMs <= Math.max(5_000, indexRunningHeartbeatMs);

          // Persistent main daemon (agent:main:main): exclude from normal isRunning path.
          // Instead, show as running only when it has a fresh updatedAt AND a non-empty
          // deliveryContext target — meaning it recently processed / is processing a message.
          if (isPersistentMain) {
            const dc = meta?.deliveryContext as Record<string, unknown> | undefined;
            const channel = String(dc?.channel || '').trim().toLowerCase();
            const lastTo = String(meta?.lastTo || dc?.to || '').trim();
            const persistentMainHasTarget = Boolean(lastTo);
            const lastAssistantTrimmed = lastAssistantText.trim();
            const isNoReply = lastAssistantTrimmed === 'NO_REPLY';
            const isHeartbeatAck = lastAssistantTrimmed === 'HEARTBEAT_OK';
            const persistentMainHasActiveSignal = hasExplicitRunningState
              || isNoReply
              || isHeartbeatAck
              || (isHeartbeatFresh && lastMessageRole !== 'assistant')
              || (isHeartbeatFresh && !isCompletedByContent);
            const persistentMainIdleThresholdMs = 5 * 60 * 1000; // 5 minutes
            const persistentMainHasStopSignal = meta?.abortedLastRun === true
              || (lastMessageRole === 'assistant' && (hasExplicitStoppedState || isCompletedByContent))
              || (!isHeartbeatFresh && hasExplicitStoppedState)
              || (lastMessageRole === 'assistant' && ageMs > persistentMainIdleThresholdMs);
            const persistentMainIsRunning = persistentMainHasTarget
              && persistentMainHasActiveSignal
              && !persistentMainHasStopSignal;

            // isPersistentMain is a long-lived daemon, so completion/error text in the last
            // reply should only hide it after the heartbeat has gone stale.
            // Keep it in the session list within activeWindowMs so the UI can show it as
            // recently active instead of making the card disappear entirely.
            if (persistentMainHasTarget) {
              const normalizedTarget = channel === 'telegram'
                ? lastTo.replace(/^telegram:/, '')
                : lastTo;
              const targetDisplay = channel === 'telegram'
                ? `Telegram 私訊 ${normalizedTarget}`
                : normalizedTarget;
              const toDisplay = `Main Session · ${targetDisplay}`;
              byKey.set(groupKey, {
                key: groupKey,
                kind: 'session',
                updatedAt: new Date(updatedMs).toISOString(),
                ageMs,
                sessionId,
                agentId,
                displayName: toDisplay || displayName,
                lastMessage,
                model: String(meta?.model || ''),
                source: 'index',
                isRunning: persistentMainIsRunning,
              });
            }
            continue;
          }

          // isRunning is true only if:
          // 1. Session is not yet marked as completed/failed/aborted in index AND
          // 2. Either: (a) has explicit running state OR (b) no explicit stopped state AND heartbeat is fresh
          // 3. AND: not marked completed by content analysis (e.g., contains ✅ or "完成")
          const isRunning = isRunningFromIndex 
            && (hasExplicitRunningState || (!hasExplicitStoppedState && isHeartbeatFresh))
            && !isCompletedByContent;

          byKey.set(groupKey, {
            key: groupKey,
            kind: 'session',
            updatedAt: new Date(updatedMs).toISOString(),
            ageMs,
            sessionId,
            agentId,
            displayName,
            lastMessage,
            model: String(meta?.model || ''),
            source: 'index',
            isRunning,
          });
        }
      }

      const sessions = Array.from(byKey.values()).sort((a, b) => a.ageMs - b.ageMs);
      return { code: 0, stdout: JSON.stringify({ sessions }), stderr: '' };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'scan active sessions failed' };
    }
  });
}
