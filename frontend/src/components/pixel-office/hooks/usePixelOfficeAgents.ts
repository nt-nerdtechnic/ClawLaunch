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
  workspace?: string;
  agentDir?: string;
}

interface ScannedSession {
  key: string;
  agentId?: string;
  displayName?: string;
  isRunning?: boolean;
  model?: string;
}

interface UsePixelOfficeAgentsResult {
  summaries: PixelAgentSummary[];
  refreshAgents: () => void;
}

/**
 * Transform Zustand snapshot data into PixelAgent descriptors.
 * Falls back to scanActiveSessions when snapshot has no sessions.
 * Also polls agent:list so configured agents appear even without sessions.
 */
export function usePixelOfficeAgents(): UsePixelOfficeAgentsResult {
  const snapshot = useStore(s => s.snapshot);
  const configPath = useStore(s => s.config?.configPath);
  const configAgentList = useStore(s => s.detectedConfig?.agentList);

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

  // Always poll configured agents from filesystem
  const [configuredAgentIds, setConfiguredAgentIds] = useState<string[]>([]);
  const [agentListTick, setAgentListTick] = useState(0);

  const refreshAgents = () => setAgentListTick(t => t + 1);

  useEffect(() => {
    if (!configPath) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await window.electronAPI.exec(
          `agent:list ${JSON.stringify({ configPath })}`
        );
        if (cancelled || res.code !== 0) return;
        const parsed = JSON.parse(res.stdout || '{}');
        const ids: string[] = Array.isArray(parsed.agents)
          ? (parsed.agents as { agentId: string }[]).map(a => a.agentId)
          : [];
        if (!cancelled) setConfiguredAgentIds(ids);
      } catch { /* silent */ }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 10000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [configPath, agentListTick]);

  // Stable desk assignment by agentId
  const assignmentRef = useRef<Map<string, number>>(new Map());

  const summaries = useMemo(() => {
    const assignment = assignmentRef.current;

    const sessionAgentIds = new Set<string>();
    const bySnapshotAgent = new Map<string, {
      sessions: Array<{
        sessionKey: string;
        agentId: string;
        status: string;
        tokensIn: number;
        tokensOut: number;
        cost?: number;
        model?: string;
      }>;
      statuses: Array<{ sessionKey: string; state: string }>;
    }>();

    if (snapshot?.sessions?.length) {
      for (const sess of snapshot.sessions) {
        const key = sess.agentId || 'unknown';
        sessionAgentIds.add(key);
        if (!bySnapshotAgent.has(key)) {
          bySnapshotAgent.set(key, { sessions: [], statuses: [] });
        }
        bySnapshotAgent.get(key)!.sessions.push(sess);
      }
      if (snapshot.statuses) {
        for (const status of snapshot.statuses) {
          for (const [, data] of bySnapshotAgent) {
            if (data.sessions.some(s => s.sessionKey === status.sessionKey)) {
              data.statuses.push(status);
            }
          }
        }
      }
    }

    const byScannedAgent = new Map<string, ScannedSession[]>();
    if (!snapshot?.sessions?.length) {
      for (const sess of scannedSessions) {
        const key = sess.agentId || 'main';
        sessionAgentIds.add(key);
        if (!byScannedAgent.has(key)) byScannedAgent.set(key, []);
        byScannedAgent.get(key)!.push(sess);
      }
    }

    // Union of all known agents: snapshot/scanned/configured/config-list
    const configListIds = (configAgentList ?? []).map(a => a.id).filter(Boolean);
    const allAgentIds = new Set<string>([...sessionAgentIds, ...configuredAgentIds, ...configListIds]);

    // Clean up removed agents
    for (const existingId of assignment.keys()) {
      if (!allAgentIds.has(existingId)) assignment.delete(existingId);
    }

    let nextDesk = 0;
    for (const d of assignment.values()) {
      if (d >= nextDesk) nextDesk = d + 1;
    }

    const results: PixelAgentSummary[] = [];
    for (const agentId of [...allAgentIds].sort()) {
      if (!assignment.has(agentId)) {
        assignment.set(agentId, nextDesk);
        nextDesk++;
      }

      const colorIdx = assignment.get(agentId)! % AGENT_COLORS.length;

      // Agent with snapshot data
      if (bySnapshotAgent.has(agentId)) {
        const data = bySnapshotAgent.get(agentId)!;
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
        const configEntry = configAgentList?.find(a => a.id === agentId);
        results.push({
          id: agentId,
          displayName: configEntry?.name || agentId,
          color: AGENT_COLORS[colorIdx],
          snapshotState: isActive ? 'active' : 'idle',
          model: data.sessions[0]?.model || configEntry?.model || undefined,
          tokensIn,
          tokensOut,
          cost,
          sessionCount: data.sessions.length,
          workspace: configEntry?.workspace || undefined,
          agentDir: configEntry?.agentDir || undefined,
        });
        continue;
      }

      // Agent with scanned session data
      if (byScannedAgent.has(agentId)) {
        const sessions = byScannedAgent.get(agentId)!;
        const isActive = sessions.some(s => s.isRunning === true);
        const configEntry = configAgentList?.find(a => a.id === agentId);
        const displayName = configEntry?.name || agentId;
        results.push({
          id: agentId,
          displayName,
          color: AGENT_COLORS[colorIdx],
          snapshotState: isActive ? 'active' : 'idle',
          model: sessions[0]?.model || configEntry?.model || undefined,
          tokensIn: 0,
          tokensOut: 0,
          cost: 0,
          sessionCount: sessions.length,
          workspace: configEntry?.workspace || undefined,
          agentDir: configEntry?.agentDir || undefined,
        });
        continue;
      }

      // Configured agent with no sessions — show as idle
      const configEntry = configAgentList?.find(a => a.id === agentId);
      results.push({
        id: agentId,
        displayName: configEntry?.name || agentId,
        color: AGENT_COLORS[colorIdx],
        snapshotState: 'idle',
        model: configEntry?.model || undefined,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        sessionCount: 0,
        workspace: configEntry?.workspace || undefined,
        agentDir: configEntry?.agentDir || undefined,
      });
    }

    return results;
  }, [snapshot?.sessions, snapshot?.statuses, scannedSessions, configuredAgentIds, configAgentList]);

  return { summaries, refreshAgents };
}
