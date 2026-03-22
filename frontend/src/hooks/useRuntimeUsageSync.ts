/**
 * useRuntimeUsageSync
 *
 * 直接掃描 ~/.openclaw/agents/*\/sessions/*.jsonl，
 * 解析每個 assistant message 的 usage.cost.total，
 * 產生 RuntimeUsageEvent[] 存入 Zustand store。
 *
 * 複製 openclaw-control-center usage-cost.ts Track 2 (JSONL 掃描) 邏輯。
 *
 * 注意：歷史 JSONL 資料不依賴 gateway 是否正在執行，
 * 因此 mount 時立即掃描，之後每 60 秒更新一次。
 *
 * 路徑說明：
 *   - configPath = ~/.openclaw（OpenClaw 資料目錄）→ agents JSONL 在這裡
 *   - corePath   = OpenClaw 原始碼目錄（clawdbot-main）→ 不含 agents
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

    // JSONL 檔案在 configPath/agents/（~/.openclaw/agents/）
    // configPath 可能是 "~/.openclaw" 或 "~/.openclaw/openclaw.json"，統一 strip 尾綴
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
  }, [config.configPath, setRuntimeUsageEvents]);

  useEffect(() => {
    // 歷史數據不需要 gateway 在線，mount 時就掃描
    scan();
    const id = setInterval(scan, SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [scan]);
}
