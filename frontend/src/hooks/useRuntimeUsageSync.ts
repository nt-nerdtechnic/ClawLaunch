/**
 * useRuntimeUsageSync
 *
 * Directly scans ~/.openclaw/agents/*\/sessions/*.jsonl,
 * Parses usage.cost.total for each assistant message,
 * Produces RuntimeUsageEvent[] and saves it to the Zustand store.
 *
 * Mirrors the openclaw-control-center usage-cost.ts Track 2 (JSONL scan) logic.
 *
 * Note: Historical JSONL data is independent of whether the gateway is running,
 * Scanning starts immediately on mount and refreshes every 60 seconds.
 *
 * Path descriptions:
 *   - configPath = ~/.openclaw (OpenClaw data directory) -> agents JSONL located here
 *   - corePath   = OpenClaw source code directory (clawdbot-main) -> does not contain agents
 */
import { useCallback, useEffect } from 'react';
import { useStore } from '../store';

const SCAN_INTERVAL_MS = 60_000;

export function useRuntimeUsageSync() {
  const config = useStore((s) => s.config);
  const setRuntimeUsageEvents = useStore((s) => s.setRuntimeUsageEvents);

  const scan = useCallback(async () => {
    const api = (window as any).electronAPI;
    console.log('[RTUsage] scan start | configPath:', config.configPath, '| corePath:', config.corePath, '| scanSessions:', typeof api?.scanSessions);
    if (!api?.scanSessions) {
      console.warn('[RTUsage] scanSessions not available on electronAPI');
      return;
    }

    // JSONL files located in configPath/agents/ (~/.openclaw/agents/)
    // configPath can be "~/.openclaw" or "~/.openclaw/openclaw.json"; consistently strip the suffix
    const configDir = config.configPath
      ? config.configPath.replace(/[\\/]openclaw\.json$/i, '')
      : undefined;
    const agentsDir = configDir ? `${configDir}/agents` : undefined;
    const payload = agentsDir ? JSON.stringify({ agentsDir }) : undefined;
    console.log('[RTUsage] configDir:', configDir, '| agentsDir:', agentsDir ?? '(default ~/.openclaw/agents)');

    try {
      const result = await api.scanSessions(payload);
      console.log('[RTUsage] result code:', result?.code, '| stdout length:', result?.stdout?.length, '| stderr:', result?.stderr);
      if (result?.code === 0) {
        const events = JSON.parse(result.stdout || '[]');
        console.log('[RTUsage] parsed events:', Array.isArray(events) ? events.length : 'NOT_ARRAY');
        if (Array.isArray(events)) {
          setRuntimeUsageEvents(events);
        }
      }
    } catch (e) {
      console.warn('[RTUsage] scan failed:', e);
    }
  }, [config.configPath, config.corePath, setRuntimeUsageEvents]);

  useEffect(() => {
    // Historical data doesn't require gateway to be online; scan initiated on mount
    scan();
    const id = setInterval(scan, SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [scan]);
}
