import { useEffect } from 'react';

interface UseSnapshotSyncParams {
  running: boolean;
  resolvedConfigDir: string;
  config: {
    workspacePath?: string;
    corePath?: string;
  };
  setSnapshot: (snapshot: any | null) => void;
  setSnapshotHistory: (history: any[]) => void;
  setEventQueue: (items: any[]) => void;
  setAckedEvents: (items: any[]) => void;
  setAuditTimeline: (items: any[]) => void;
  setDailyDigest: (digest: string) => void;
  setRawSnapshot: (rawSnapshot: any | null) => void;
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
  const syncSnapshot = async () => {
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
      const code = res.code ?? res.exitCode;
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
  };

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
