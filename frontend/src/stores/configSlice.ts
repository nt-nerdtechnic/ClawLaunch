import type { StateCreator } from 'zustand';
import type { SkillItem } from './skillSlice';

export interface Config {
  model: string;
  authChoice: string;
  apiKey: string;
  platform: string;
  botToken: string;
  appToken: string;
  installDaemon: boolean;
  useExternalTerminal: boolean;
  autoRestartGateway: boolean;
  unrestrictedMode: boolean;
  corePath: string;
  configPath: string;
  workspacePath: string;
  theme?: 'light' | 'dark';
  language?: string;
  appVersion?: string;
}

export interface DetectedConfig {
  apiKey?: string;
  model?: string;
  authChoice?: string;
  botToken?: string;
  corePath?: string;
  configPath?: string;
  workspacePath?: string;
  workspaceSkills?: SkillItem[];
}

export interface ConfigSlice {
  config: Config;
  detectedConfig: DetectedConfig | null;
  detectingPaths: boolean;
  pathsConfirmed: boolean;
  runtimeProfile: Record<string, unknown> | null;
  setConfig: (patch: Partial<Config>) => void;
  setDetectedConfig: (config: DetectedConfig | null) => void;
  setDetectingPaths: (status: boolean) => void;
  setPathsConfirmed: (status: boolean) => void;
  setRuntimeProfile: (profile: Record<string, unknown> | null) => void;
}

export const createConfigSlice: StateCreator<ConfigSlice> = (set) => ({
  config: {
    model: '',
    authChoice: '',
    apiKey: '',
    platform: 'telegram',
    botToken: '',
    appToken: '',
    installDaemon: false,
    useExternalTerminal: true,
    autoRestartGateway: false,
    unrestrictedMode: false,
    corePath: '',
    configPath: '',
    workspacePath: '',
    language: localStorage.getItem('i18nextLng') || 'zh-TW',
    appVersion: '',
  },
  detectedConfig: null,
  detectingPaths: false,
  pathsConfirmed: false,
  runtimeProfile: null,
  setConfig: (patch) => set((state) => ({ config: { ...state.config, ...patch } })),
  setDetectedConfig: (config) => set({ detectedConfig: config }),
  setDetectingPaths: (status) => set({ detectingPaths: status }),
  setPathsConfirmed: (status) => set({ pathsConfirmed: status }),
  setRuntimeProfile: (profile) => set({ runtimeProfile: profile }),
});
