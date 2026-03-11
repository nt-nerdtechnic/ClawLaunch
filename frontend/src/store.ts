import { create } from 'zustand';

interface LogEntry {
  text: string;
  time: string;
  source: 'stdout' | 'stderr' | 'system';
}

interface AppState {
  running: boolean;
  setRunning: (status: boolean) => void;
  logs: LogEntry[];
  addLog: (text: string, source?: 'stdout' | 'stderr' | 'system') => void;
  envStatus: { node: string; git: string; pnpm: string };
  setEnvStatus: (status: { node: string; git: string; pnpm: string }) => void;
  usage: {
    input: number;
    output: number;
    history: { name: string; tokens: number }[];
  };
  setUsage: (data: any) => void;
}

export const useStore = create<AppState>((set) => ({
  running: false,
  setRunning: (status) => set({ running: status }),
  logs: [],
  addLog: (text, source = 'system') => set((state) => ({ 
    logs: [...state.logs.slice(-99), { 
      text, 
      source, 
      time: new Date().toLocaleTimeString() 
    }] 
  })),
  envStatus: { node: 'loading', git: 'loading', pnpm: 'loading' },
  setEnvStatus: (status) => set({ envStatus: status }),
  usage: {
    input: 0,
    output: 0,
    history: [
      { name: '3/05', tokens: 12000 },
      { name: '3/06', tokens: 19000 },
      { name: '3/07', tokens: 15000 },
      { name: '3/08', tokens: 27800 },
      { name: '3/09', tokens: 18900 },
      { name: '3/10', tokens: 23900 },
      { name: '3/11', tokens: 34900 },
    ]
  },
  setUsage: (data) => set((state) => ({ usage: { ...state.usage, ...data } })),
}));
