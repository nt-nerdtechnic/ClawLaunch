import type { StateCreator } from 'zustand';
import { shellQuote } from '../utils/shell';

export interface LogEntry {
  text: string;
  time: string;
  source: 'stdout' | 'stderr' | 'system';
}

export interface SystemSlice {
  userType: 'new' | 'existing' | null;
  setUserType: (type: 'new' | 'existing' | null) => void;
  running: boolean;
  setRunning: (status: boolean) => void;
  logs: LogEntry[];
  addLog: (text: string, source?: 'stdout' | 'stderr' | 'system') => void;
  envStatus: {
    node: 'loading' | 'ok' | 'error';
    git: 'loading' | 'ok' | 'error';
    pnpm: 'loading' | 'ok' | 'error';
  };
  setEnvStatus: (status: {
    node: 'loading' | 'ok' | 'error';
    git: 'loading' | 'ok' | 'error';
    pnpm: 'loading' | 'ok' | 'error';
  }) => void;
  ocVersion: string | null;
  setOcVersion: (version: string | null) => void;
  ocVersionChecking: boolean;
  setOcVersionChecking: (checking: boolean) => void;
  checkOcVersion: (corePath: string) => Promise<void>;
}

export const createSystemSlice: StateCreator<SystemSlice> = (set) => ({
  userType: null,
  setUserType: (type) => set({ userType: type }),
  running: false,
  setRunning: (status) => set({ running: status }),
  logs: [],
  addLog: (text, source = 'system') =>
    set((state) => ({
      logs: [
        ...state.logs.slice(-99),
        { text, source, time: new Date().toLocaleTimeString() },
      ],
    })),
  envStatus: { node: 'loading', git: 'loading', pnpm: 'loading' },
  setEnvStatus: (status) => set({ envStatus: status }),
  ocVersion: null,
  setOcVersion: (version) => set({ ocVersion: version }),
  ocVersionChecking: false,
  setOcVersionChecking: (checking) => set({ ocVersionChecking: checking }),
  checkOcVersion: async (corePath: string) => {
    if (!corePath?.trim()) return;
    set({ ocVersionChecking: true });
    try {
      // 優先使用 CLI 輸出（與 project:update 偵測版本的方式一致，反映實際安裝狀態）
      const cliRes = await window.electronAPI.exec(
        `zsh -ilc "cd ${shellQuote(corePath)} && pnpm openclaw --version" 2>/dev/null || cd ${shellQuote(corePath)} && pnpm openclaw --version 2>/dev/null`
      );
      const cliMatch = String(cliRes.stdout ?? '').match(/\d{4}\.\d+\.\d+/);
      if (cliMatch) {
        set({ ocVersion: cliMatch[0] });
        return;
      }
      // fallback：讀 package.json（CLI 不可用時）
      const pkgRes = await window.electronAPI.exec(`cat ${shellQuote(corePath + '/package.json')}`);
      if (pkgRes.code === 0 && pkgRes.stdout?.trim()) {
        const pkg = JSON.parse(pkgRes.stdout) as { version?: unknown };
        const match = String(pkg.version ?? '').match(/\d{4}\.\d+\.\d+/);
        set({ ocVersion: match ? match[0] : null });
      } else {
        set({ ocVersion: null });
      }
    } catch {
      set({ ocVersion: null });
    } finally {
      set({ ocVersionChecking: false });
    }
  },
});
