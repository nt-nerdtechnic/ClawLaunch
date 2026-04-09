import { useCallback, useEffect, useRef, useState } from 'react';
import type { CronJob } from '../../../types/cron';
import { useStore } from '../../../store';
import { ConfigService } from '../../../services/configService';

interface UseAgentCronJobsParams {
  agentId: string;
  enabled: boolean;
}

interface UseAgentCronJobsReturn {
  jobs: CronJob[];
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
  toggle: (jobId: string) => Promise<void>;
  trigger: (jobId: string) => void;
  remove: (jobId: string) => Promise<void>;
  update: (jobId: string, updates: { name?: string; everyMs?: number; timeoutSeconds?: number; delivery?: { mode: string; channel?: string; to?: string }; payloadMessage?: string }) => Promise<void>;
}

export function useAgentCronJobs({ agentId, enabled }: UseAgentCronJobsParams): UseAgentCronJobsReturn {
  const config = useStore(s => s.config);
  const stateDir = ConfigService.normalizeConfigDir(config.configPath);

  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!window.electronAPI?.exec) return;
    setLoading(true);
    setError('');
    try {
      const payload = stateDir ? JSON.stringify({ stateDir }) : '';
      const res = await window.electronAPI.exec(`cron:list ${payload}`.trim());
      if (!mountedRef.current) return;
      if (res.code !== 0) {
        setError(res.stderr || 'Failed to load cron jobs');
        return;
      }
      const parsed = JSON.parse(res.stdout || '[]');
      const allJobs: CronJob[] = Array.isArray(parsed) ? parsed : (parsed.jobs ?? []);
      const filtered = agentId
        ? allJobs.filter(j => !j.agentId || j.agentId === agentId)
        : allJobs;
      setJobs(filtered);
    } catch (e) {
      if (mountedRef.current) setError(String(e));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [agentId, stateDir]);

  useEffect(() => {
    if (enabled) void reload();
  }, [enabled, reload]);

  const toggle = useCallback(async (jobId: string) => {
    if (!window.electronAPI?.exec) return;
    await window.electronAPI.exec(`cron:toggle ${JSON.stringify({ jobId, stateDir })}`);
    await reload();
  }, [stateDir, reload]);

  const trigger = useCallback((jobId: string) => {
    if (!window.electronAPI?.exec) return;
    void window.electronAPI.exec(`cron:trigger ${JSON.stringify({ jobId, stateDir })}`);
  }, [stateDir]);

  const remove = useCallback(async (jobId: string) => {
    if (!window.electronAPI?.exec) return;
    await window.electronAPI.exec(`cron:delete ${JSON.stringify({ jobId, stateDir })}`);
    await reload();
  }, [stateDir, reload]);

  const update = useCallback(async (
    jobId: string,
    updates: {
      name?: string;
      everyMs?: number;
      timeoutSeconds?: number;
      delivery?: { mode: string; channel?: string; to?: string };
      payloadMessage?: string;
    }
  ) => {
    if (!window.electronAPI?.exec) return;
    await window.electronAPI.exec(`cron:update ${JSON.stringify({ jobId, stateDir, ...updates })}`);
    await reload();
  }, [stateDir, reload]);

  return { jobs, loading, error, reload, toggle, trigger, remove, update };
}
