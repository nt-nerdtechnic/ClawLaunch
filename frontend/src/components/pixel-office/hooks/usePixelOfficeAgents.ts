import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../../store';
import { AGENT_COLORS } from '../engine/constants';

export interface PixelAgentSummary {
  id: string;
  displayName: string;
  color: string;
  snapshotState: 'active' | 'idle';
  model?: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  sessionCount: number;
}

interface ScannedSession {
  key: string;
  agentId?: string;
  displayName?: string;
  isRunning?: boolean;
  model?: string;
}

/**
 * Transform Zustand snapshot data into PixelAgent descriptors.
 * Falls back to scanActiveSessions when snapshot has no sessions
 * (e.g. last-snapshot.json hasn't been written yet).
 */
export function usePixelOfficeAgents(): PixelAgentSummary[] {
  const snapshot = useStore(s => s.snapshot);

  // Fallback: poll scanActiveSessions when snapshot is empty
  const [scannedSessions, setScannedSessions] = useState<ScannedSession[]>([]);
  const snapshotHasSessions = (snapshot?.sessions?.length ?? 0) > 0;

  useEffect(() => {
    if (snapshotHasSessions) return; // snapshot has data — no need to poll

    let cancelled = false;
    const poll = async () => {
      try {
        if (!window.electronAPI?.scanActiveSessions) return;
        const res = await window.electronAPI.scanActiveSessions({ activeMinutes: 15 });
        if (cancelled || res.code !== 0) return;
        const parsed = JSON.parse(res.stdout || '{}');
        const sessions: ScannedSession[] = Array.isArray(parsed.sessions) ? parsed.sessions : [];
        if (!cancelled) setScannedSessions(sessions);
      } catch { /* silent */ }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [snapshotHasSessions]);

  // Stable desk assignment by agentId
  const assignmentRef = useRef<Map<string, number>>(new Map());

  const summaries = useMemo(() => {
    const results: PixelAgentSummary[] = [];

    // ── Path A: snapshot has sessions → original logic ──────────────────────
    if (snapshot?.sessions?.length) {

    const assignment = assignmentRef.current;

    // Aggregate sessions by agentId
    const byAgent = new Map<string, {
      sessions: typeof snapshot.sessions;
      statuses: typeof snapshot.statuses;
    }>();

    for (const sess of snapshot.sessions) {
      const key = sess.agentId || 'unknown';
      if (!byAgent.has(key)) {
        byAgent.set(key, { sessions: [], statuses: [] });
      }
      byAgent.get(key)!.sessions.push(sess);
    }

    // Match statuses to agents
    if (snapshot.statuses) {
      for (const status of snapshot.statuses) {
        for (const [_agentId, data] of byAgent) {
          if (data.sessions.some(s => s.sessionKey === status.sessionKey)) {
            data.statuses.push(status);
          }
        }
      }
    }

    const sortedAgentIds = [...byAgent.keys()].sort();

    // Clean up removed agents
    for (const existingId of assignment.keys()) {
      if (!byAgent.has(existingId)) {
        assignment.delete(existingId);
      }
    }

    let nextDesk = 0;
    for (const d of assignment.values()) {
      if (d >= nextDesk) nextDesk = d + 1;
    }

    for (const agentId of sortedAgentIds) {
      const data = byAgent.get(agentId)!;

      const isActive = data.sessions.some(s => {
        const status = s.status?.toLowerCase() || '';
        return status.includes('running') || status.includes('active') || status.includes('working');
      }) || data.statuses.some(st => {
        const state = st.state?.toLowerCase() || '';
        return state.includes('running') || state.includes('active') || state.includes('working');
      });

      let tokensIn = 0, tokensOut = 0, cost = 0;
      for (const s of data.sessions) {
        tokensIn += s.tokensIn || 0;
        tokensOut += s.tokensOut || 0;
        cost += s.cost || 0;
      }

      const model = data.sessions[0]?.model;

      if (!assignment.has(agentId)) {
        assignment.set(agentId, nextDesk);
        nextDesk++;
      }

      const colorIdx = assignment.get(agentId)! % AGENT_COLORS.length;

      results.push({
        id: agentId,
        displayName: agentId,
        color: AGENT_COLORS[colorIdx],
        snapshotState: isActive ? 'active' : 'idle',
        model,
        tokensIn,
        tokensOut,
        cost,
        sessionCount: data.sessions.length,
      });
    }

    return results;
    }

    // ── Path B: no snapshot — derive from scanActiveSessions fallback ────────
    if (!scannedSessions.length) return results;

    const assignment = assignmentRef.current;

    // Group by agentId (or fall back to 'main')
    const byAgent = new Map<string, ScannedSession[]>();
    for (const sess of scannedSessions) {
      const key = sess.agentId || 'main';
      if (!byAgent.has(key)) byAgent.set(key, []);
      byAgent.get(key)!.push(sess);
    }

    // Clean up removed agents
    for (const existingId of assignment.keys()) {
      if (!byAgent.has(existingId)) assignment.delete(existingId);
    }

    let nextDesk = 0;
    for (const d of assignment.values()) {
      if (d >= nextDesk) nextDesk = d + 1;
    }

    for (const agentId of [...byAgent.keys()].sort()) {
      const sessions = byAgent.get(agentId)!;
      const isActive = sessions.some(s => s.isRunning === true);

      if (!assignment.has(agentId)) {
        assignment.set(agentId, nextDesk);
        nextDesk++;
      }

      const colorIdx = assignment.get(agentId)! % AGENT_COLORS.length;
      const model = sessions[0]?.model;
      const displayName = sessions.length === 1 && sessions[0].displayName
        ? sessions[0].displayName
        : agentId;

      results.push({
        id: agentId,
        displayName,
        color: AGENT_COLORS[colorIdx],
        snapshotState: isActive ? 'active' : 'idle',
        model,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        sessionCount: sessions.length,
      });
    }

    return results;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.sessions, snapshot?.statuses, scannedSessions]);

  return summaries;
}
