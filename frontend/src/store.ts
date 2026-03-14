import { create } from 'zustand';

interface LogEntry {
  text: string;
  time: string;
  source: 'stdout' | 'stderr' | 'system';
}

// 技能定義 (核心層或工作區層共用)
export interface SkillItem {
  id: string;
  name: string;
  desc: string;
  category: string;
  details: string;
}

interface Config {
  model: string;
  authChoice: string; // 對齊 CLI AuthChoice
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
    workspaceSkills?: SkillItem[];
  } | null;
  coreSkills: SkillItem[];
  workspaceSkills: SkillItem[];
  setCoreSkills: (skills: SkillItem[]) => void;
  setWorkspaceSkills: (skills: SkillItem[]) => void;
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
  // Snapshot Data
  snapshot: {
    generatedAt: string;
    sessions: any[];
    tasks: any[];
    approvals: any[];
    statuses: any[];
    budgetSummary: any;
  } | null;
  setSnapshot: (snapshot: any) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  language: string;
  setLanguage: (lang: string) => void;
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
    model: '', 
    authChoice: '',
    apiKey: '', 
    platform: 'telegram', 
    botToken: '',
    enabledSkills: [], // 初始擴展技能為空，核心技能已預設啟動
    corePath: '',
    configPath: '',
    workspacePath: '~/.openclaw'
  },
  detectedConfig: null,
  detectingPaths: false,
  pathsConfirmed: false,
  userType: null,
  coreSkills: [],
  workspaceSkills: [],
  setCoreSkills: (skills) => set({ coreSkills: skills }),
  setWorkspaceSkills: (skills) => set({ workspaceSkills: skills }),
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
  snapshot: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  theme: (localStorage.getItem('theme') as 'light' | 'dark') || 'dark',
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },
  language: localStorage.getItem('i18nextLng') || 'zh-TW',
  setLanguage: (lang) => {
    localStorage.setItem('i18nextLng', lang);
    set({ language: lang });
  },
}));
