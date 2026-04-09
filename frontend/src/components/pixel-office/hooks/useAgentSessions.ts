import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../store';

export interface AgentSession {
  sessionKey: string;
  status: string;
  isRunning: boolean;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  model?: string;
  updatedAt: string;
}

interface UseAgentSessionsParams {
  agentId: string;
  enabled: boolean;
}

export function useAgentSessions({ agentId, enabled }: UseAgentSessionsParams) {
  const snapshot = useStore(s => s.snapshot);
  const [scannedSessions, setScannedSessions] = useState<AgentSession[]>([]);
  const [aborting, setAborting] = useState<Set<string>>(new Set());

  const snapshotSessions = useMemo((): AgentSession[] => {
    if (!snapshot) return [];
    const statusMap = new Map(
      (snapshot.statuses ?? []).map(st => [st.sessionKey, st])
    );
    return (snapshot.sessions ?? [])
      .filter(s => s.agentId === agentId)
      .map(s => {
        const st = statusMap.get(s.sessionKey);
        const state = (st?.state ?? s.status ?? '').toLowerCase();
        const isRunning = ['running', 'active', 'working'].some(k => state.includes(k));
        return {
          sessionKey: s.sessionKey,
          status: st?.state ?? s.status ?? 'unknown',
          isRunning,
          tokensIn: s.tokensIn ?? 0,
          tokensOut: s.tokensOut ?? 0,
          cost: s.cost ?? 0,
          model: s.model,
          updatedAt: s.updatedAt ?? '',
        };
      });
  }, [snapshot, agentId]);

  const hasSnapshotData = snapshotSessions.length > 0;

  useEffect(() => {
    if (!enabled || hasSnapshotData) return;
    let cancelled = false;

    const poll = async () => {
      try {
        if (!window.electronAPI?.scanActiveSessions) return;
        const res = await window.electronAPI.scanActiveSessions({ activeMinutes: 15 });
        if (cancelled || res.code !== 0) return;
        const parsed = JSON.parse(res.stdout || '{}') as { sessions?: Record<string, unknown>[] };
        const all = Array.isArray(parsed.sessions) ? parsed.sessions : [];
        const mine: AgentSession[] = all
          .filter((s) => !s['agentId'] || s['agentId'] === agentId)
          .map((s): AgentSession => ({
            sessionKey: String(s['key'] || s['sessionId'] || ''),
            status: s['isRunning'] ? 'running' : 'idle',
            isRunning: s['isRunning'] === true,
            tokensIn: Number(s['inputTokens'] ?? 0),
            tokensOut: Number(s['outputTokens'] ?? 0),
            cost: 0,
            model: s['model'] as string | undefined,
            updatedAt: String(s['updatedAt'] ?? ''),
          }));
        if (!cancelled) setScannedSessions(mine);
      } catch { /* silent */ }
    };

    void poll();
    const id = setInterval(() => void poll(), 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, hasSnapshotData, agentId]);

  const sessions = hasSnapshotData ? snapshotSessions : scannedSessions;

  const abort = useCallback(async (sessionKey: string) => {
    if (!window.electronAPI?.abortSession) return;
    setAborting(prev => new Set(prev).add(sessionKey));
    try {
      await window.electronAPI.abortSession({ sessionKey, agentId });
    } finally {
      setAborting(prev => { const n = new Set(prev); n.delete(sessionKey); return n; });
    }
  }, [agentId]);

  return { sessions, aborting, abort };
}
