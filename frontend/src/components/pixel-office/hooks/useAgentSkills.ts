import { useCallback, useEffect, useState } from 'react';
import type { SkillItem } from '../../../store';

interface UseAgentSkillsParams {
  agentWorkspace?: string;
  enabled: boolean;
}

export interface AgentSkillEntry extends SkillItem {
  isCore: boolean;
}

export function useAgentSkills({ agentWorkspace, enabled }: UseAgentSkillsParams) {
  const [skills, setSkills] = useState<AgentSkillEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const scan = useCallback(async () => {
    if (!agentWorkspace || !window.electronAPI?.exec) return;
    setLoading(true);
    setError('');
    try {
      const res = await window.electronAPI.exec(
        `detect:paths ${JSON.stringify({ workspacePath: agentWorkspace })}`
      );
      if (res.code !== 0) {
        setError(res.stderr || 'scan failed');
        return;
      }
      const data = JSON.parse(res.stdout || '{}') as {
        coreSkills?: SkillItem[];
        existingConfig?: { workspaceSkills?: SkillItem[] };
      };
      const ws: AgentSkillEntry[] = (data.existingConfig?.workspaceSkills ?? []).map(s => ({ ...s, isCore: false }));
      const core: AgentSkillEntry[] = (data.coreSkills ?? []).map(s => ({ ...s, isCore: true }));
      setSkills([...ws, ...core]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [agentWorkspace]);

  useEffect(() => {
    if (enabled && agentWorkspace) void scan();
  }, [enabled, agentWorkspace, scan]);

  const removeSkill = useCallback(async (skillId: string) => {
    if (!window.electronAPI?.exec || !agentWorkspace) return;
    await window.electronAPI.exec(
      `skill:delete ${JSON.stringify({ skillId, workspacePath: agentWorkspace })}`
    );
    await scan();
  }, [agentWorkspace, scan]);

  const deleteCoreSkill = useCallback(async (skillId: string) => {
    if (!window.electronAPI?.exec) return;
    await window.electronAPI.exec(`skill:delete-core ${JSON.stringify({ skillId })}`);
    await scan();
  }, [scan]);

  const moveToCore = useCallback(async (skillId: string) => {
    if (!window.electronAPI?.exec) return;
    const res = await window.electronAPI.exec(`skill:move-to-core ${JSON.stringify({ skillId })}`);
    if ((res.exitCode ?? res.code) !== 0) throw new Error(res.stderr || 'move failed');
    await scan();
  }, [scan]);

  const moveToWorkspace = useCallback(async (skillId: string) => {
    if (!window.electronAPI?.exec) return;
    const res = await window.electronAPI.exec(`skill:move-core ${JSON.stringify({ skillId })}`);
    if ((res.exitCode ?? res.code) !== 0) throw new Error(res.stderr || 'move failed');
    await scan();
  }, [scan]);

  const importSkill = useCallback(async () => {
    if (!window.electronAPI?.exec) return;
    const res = await window.electronAPI.exec('skill:import');
    if ((res.exitCode ?? res.code) === 0 && res.stdout !== 'Canceled') {
      await scan();
    }
  }, [scan]);

  return { skills, loading, error, scan, removeSkill, deleteCoreSkill, moveToCore, moveToWorkspace, importSkill };
}
