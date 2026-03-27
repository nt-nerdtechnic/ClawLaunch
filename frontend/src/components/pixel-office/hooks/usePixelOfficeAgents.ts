import { useMemo, useRef } from 'react';
import { useStore } from '../../../store';
import type { PixelAgent } from '../engine/types';
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
  const deskAssignment = useRef<Map<string, number>>(new Map());

  return useMemo(() => {
    if (!snapshot?.sessions?.length) return [];

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
        // Find agent by sessionKey
        for (const [agentId, data] of byAgent) {
          if (data.sessions.some(s => s.sessionKey === status.sessionKey)) {
            data.statuses.push(status);
          }
        }
      }
    }

    // Build agent summaries
    const summaries: PixelAgentSummary[] = [];
    const sortedAgentIds = [...byAgent.keys()].sort();
    const assignment = deskAssignment.current;

    // Clean up removed agents
    for (const existingId of assignment.keys()) {
      if (!byAgent.has(existingId)) {
        assignment.delete(existingId);
      }
    }

    let nextDesk = 0;
    // Find highest assigned desk
    for (const d of assignment.values()) {
      if (d >= nextDesk) nextDesk = d + 1;
    }

    for (const agentId of sortedAgentIds) {
      const data = byAgent.get(agentId)!;

      // Determine if any session is active
      const isActive = data.sessions.some(s => {
        const status = s.status?.toLowerCase() || '';
        return status.includes('running') || status.includes('active') || status.includes('working');
      }) || data.statuses.some(st => {
        const state = st.state?.toLowerCase() || '';
        return state.includes('running') || state.includes('active') || state.includes('working');
      });

      // Aggregate tokens/cost
      let tokensIn = 0, tokensOut = 0, cost = 0;
      for (const s of data.sessions) {
        tokensIn += s.tokensIn || 0;
        tokensOut += s.tokensOut || 0;
        cost += s.cost || 0;
      }

      // Get model from first active session
      const model = data.sessions[0]?.model;

      // Desk assignment (stable)
      if (!assignment.has(agentId)) {
        assignment.set(agentId, nextDesk);
        nextDesk++;
      }

      const colorIdx = assignment.get(agentId)! % AGENT_COLORS.length;

      summaries.push({
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

    return summaries;
  }, [snapshot?.sessions, snapshot?.statuses]);
}
