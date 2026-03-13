import { create } from 'zustand';

interface LogEntry {
  text: string;
  time: string;
  source: 'stdout' | 'stderr' | 'system';
}

interface Config {
  model: string;
  apiKey: string;
  platform: string;
  botToken: string;
  enabledSkills: string[];
  corePath: string;    // 主核心區
  configPath: string;  // 設定區
  workspacePath: string; // 工作區
}

interface AppState {
  userType: 'new' | 'existing' | null;
  setUserType: (type: 'new' | 'existing' | null) => void;
  running: boolean;
  setRunning: (status: boolean) => void;
  logs: LogEntry[];
  addLog: (text: string, source?: 'stdout' | 'stderr' | 'system') => void;
  envStatus: { node: string; git: string; pnpm: string };
  setEnvStatus: (status: { node: string; git: string; pnpm: string }) => void;
  config: Config;
  detectedConfig: { 
    apiKey?: string; 
    model?: string;
    botToken?: string;
    corePath?: string;
    configPath?: string;
    workspacePath?: string;
  } | null;
  detectingPaths: boolean;
  pathsConfirmed: boolean;
  setConfig: (patch: Partial<Config>) => void;
  setDetectedConfig: (config: AppState['detectedConfig']) => void;
  setDetectingPaths: (status: boolean) => void;
  setPathsConfirmed: (status: boolean) => void;
  toggleSkill: (skillId: string) => void;
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
  config: { 
    model: 'claude-3-5', 
    apiKey: '', 
    platform: 'telegram', 
    botToken: '',
    enabledSkills: ['browser', 'coding', 'market', 'cron'],
    corePath: '',
    configPath: '',
    workspacePath: '~/.openclaw'
  },
  detectedConfig: null,
  detectingPaths: false,
  pathsConfirmed: false,
  userType: null,
  setUserType: (type) => set({ userType: type }),
  setConfig: (patch) => set((state) => ({ config: { ...state.config, ...patch } })),
  setDetectedConfig: (config) => set({ detectedConfig: config }),
  setDetectingPaths: (status) => set({ detectingPaths: status }),
  setPathsConfirmed: (status) => set({ pathsConfirmed: status }),
  toggleSkill: (skillId) => set((state) => ({
    config: {
      ...state.config,
      enabledSkills: state.config.enabledSkills.includes(skillId)
        ? state.config.enabledSkills.filter(id => id !== skillId)
        : [...state.config.enabledSkills, skillId]
    }
  })),
  usage: {
    input: 0,
    output: 0,
    history: []
  },
  setUsage: (data) => set((state) => ({ usage: { ...state.usage, ...data } })),
}));
