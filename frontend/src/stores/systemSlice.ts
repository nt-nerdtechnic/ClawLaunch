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
      const res = await window.electronAPI.exec(`cat ${shellQuote(corePath + '/package.json')}`);
      if (res.code === 0 && res.stdout?.trim()) {
        const pkg = JSON.parse(res.stdout) as { version?: unknown };
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
