import { useMemo, useRef } from 'react';
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

/**
 * Transform Zustand snapshot data into PixelAgent descriptors.
 * This only computes the "what should exist" — the game loop
 * handles creating / updating actual PixelAgent entities.
 */
export function usePixelOfficeAgents(): PixelAgentSummary[] {
  const snapshot = useStore(s => s.snapshot);

  // Stable desk assignment by agentId
  const assignmentRef = useRef<Map<string, number>>(new Map());

  const summaries = useMemo(() => {
    const results: PixelAgentSummary[] = [];
    
    if (!snapshot?.sessions?.length) return results;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.sessions, snapshot?.statuses]);

  return summaries;
}
