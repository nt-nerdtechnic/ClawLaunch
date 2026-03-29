import type { StateCreator } from 'zustand';

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
});
