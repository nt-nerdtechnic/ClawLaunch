import { create } from 'zustand';

export interface LogEntry {
  text: string;
  time: string;
  source: 'stdout' | 'stderr' | 'system';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sessionKey: string;
  agentId: string;
  createdAt: number;
  status?: 'streaming' | 'done' | 'error';
  error?: string;
}

interface ChatState {
  isOpen: boolean;
  unreadCount: number;
  isStreaming: boolean;
  runtimeMode: 'gateway' | 'local';
  modeReason: string;
  activeSessionKey: string;
  activeAgentId: string;
  messages: ChatMessage[];
  gatewayWsConnected: boolean;
}

// Skill definitions (shared between core or workspace layer)
export interface SkillItem {
  id: string;
  name: string;
  desc: string;
  category: string;
  details: string;
}

export interface Config {
  model: string;
  authChoice: string; // Align with CLI AuthChoice
  apiKey: string;
  platform: string;
  botToken: string;
  appToken: string; // Slack App-Level Token (xapp-...)
  installDaemon: boolean;
  useExternalTerminal: boolean;
  autoRestartGateway: boolean;
  unrestrictedMode: boolean;
  corePath: string;    // Primary core area
  configPath: string;  // Configuration area
  workspacePath: string; // Workspace area
  theme?: 'light' | 'dark'; // Persisted theme
  language?: string; // Persisted language
  appVersion?: string; // Persisted app version
}

export interface ReadModelSession {
  sessionKey: string;
  agentId: string;
  status: string;
  tokensIn: number;
  tokensOut: number;
  cost?: number;
  model?: string;
  updatedAt: string;
}

export interface ReadModelTask {
  id: string;
  title: string;
  status: string;
  scope: string;
  updatedAt: string;
}

export interface ReadModelApproval {
  id: string;
  status: string;
  summary: string;
  requestedAt: string;
}

export interface ReadModelStatus {
  sessionKey: string;
  state: string;
  tokensIn: number;
  tokensOut: number;
  cost?: number;
  model?: string;
  contextWindowTokens?: number;
}

export interface ReadModelBudgetEvaluation {
  scope: string;
  status: string;
  usedCost30d: number;
  limitCost30d: number;
}

export interface ReadModelBudgetSummary {
  status: string;
  usedCost30d: number;
  limitCost30d: number;
  burnRatePerDay: number;
  projectedDaysToLimit: number;
  evaluations: ReadModelBudgetEvaluation[];
}

export interface ReadModelSnapshot {
  generatedAt: string;
  sessions: ReadModelSession[];
  tasks: ReadModelTask[];
  approvals: ReadModelApproval[];
  statuses: ReadModelStatus[];
  budgetSummary: ReadModelBudgetSummary;
}

export interface ReadModelHistoryPoint {
  dateKey: string;
  label: string;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  estimatedCost: number;
}

// Raw usage events scanned directly from session JSONL (copy openclaw-control-center Track 2 logic)
export interface RuntimeUsageEvent {
  timestamp: string;
  day: string;          // YYYY-MM-DD for date bucketing
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  tokensIn: number;
  tokensOut: number;
  cacheTokens: number;
  tokens: number;       // in + out + cache
  cost: number;         // from message.usage.cost.total
}

export interface EventQueueItem {
  id: string;
  level: 'info' | 'warn' | 'action-required';
  title: string;
  detail: string;
  source: string;
  createdAt: string;
  status?: 'pending' | 'acked' | 'expired';
  ackedAt?: string;
  ackExpiresAt?: string;
  entityId?: string;
}

export interface AuditTimelineItem {
  id: string;
  level: 'info' | 'warn' | 'action-required';
  source: string;
  message: string;
  timestamp: string;
}

export interface RuntimeUsageUpdate {
  input: number;
  output: number;
  history: { name: string; tokens: number }[];
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

interface AppState {
  userType: 'new' | 'existing' | null;
  setUserType: (type: 'new' | 'existing' | null) => void;
  running: boolean;
  setRunning: (status: boolean) => void;
  logs: LogEntry[];
  addLog: (text: string, source?: 'stdout' | 'stderr' | 'system') => void;
  envStatus: { node: 'loading' | 'ok' | 'error'; git: 'loading' | 'ok' | 'error'; pnpm: 'loading' | 'ok' | 'error' };
  setEnvStatus: (status: { node: 'loading' | 'ok' | 'error'; git: 'loading' | 'ok' | 'error'; pnpm: 'loading' | 'ok' | 'error' }) => void;
  config: Config;
  detectedConfig: DetectedConfig | null;
  coreSkills: SkillItem[];
  workspaceSkills: SkillItem[];
  detectingPaths: boolean;
  pathsConfirmed: boolean;
  runtimeProfile: Record<string, unknown> | null;
  setRuntimeProfile: (profile: Record<string, unknown> | null) => void;
  setConfig: (patch: Partial<Config>) => void;
  setDetectedConfig: (config: DetectedConfig | null) => void;
  setCoreSkills: (skills: SkillItem[]) => void;
  setWorkspaceSkills: (skills: SkillItem[]) => void;
  setDetectingPaths: (status: boolean) => void;
  setPathsConfirmed: (status: boolean) => void;
  setRuntimeProfile: (profile: Record<string, unknown> | null) => void;
  toggleSkill: (skillId: string) => void;
  usage: RuntimeUsageUpdate;
  setUsage: (data: RuntimeUsageUpdate) => void;
  // Snapshot Data
  snapshot: ReadModelSnapshot | null;
  snapshotHistory: ReadModelHistoryPoint[];
  eventQueue: EventQueueItem[];
  ackedEvents: EventQueueItem[];
  auditTimeline: AuditTimelineItem[];
  dailyDigest: string;
  rawSnapshot: ReadModelSnapshot | null;
  snapshotSourcePath: string;
  setSnapshot: (snapshot: ReadModelSnapshot | null) => void;
  setSnapshotHistory: (history: ReadModelHistoryPoint[]) => void;
  setEventQueue: (items: EventQueueItem[]) => void;
  setAckedEvents: (items: EventQueueItem[]) => void;
  setAuditTimeline: (items: AuditTimelineItem[]) => void;
  setDailyDigest: (digest: string) => void;
  ackEventLocal: (eventId: string, ttlMs?: number) => void;
  setRawSnapshot: (rawSnapshot: ReadModelSnapshot | null) => void;
  setSnapshotSourcePath: (path: string) => void;
  runtimeUsageEvents: RuntimeUsageEvent[];
  setRuntimeUsageEvents: (events: RuntimeUsageEvent[]) => void;
  modelPrices: Record<string, { prompt: number, completion: number }>;
  setModelPrices: (prices: Record<string, { prompt: number, completion: number }>) => void;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  language: string;
  setLanguage: (lang: string) => void;
  chat: ChatState;
  setChatOpen: (open: boolean) => void;
  clearChatUnread: () => void;
  setChatRuntimeMode: (mode: 'gateway' | 'local', reason?: string) => void;
  setActiveChatSession: (sessionKey: string) => void;
  setActiveChatAgent: (agentId: string) => void;
  setGatewayWsConnected: (connected: boolean) => void;
  addChatMessage: (message: ChatMessage) => void;
  appendChatChunk: (id: string, chunk: string, sessionKey: string, agentId: string) => void;
  completeChatMessage: (id: string, patch?: Partial<ChatMessage>) => void;
  markChatMessageError: (id: string, error: string) => void;
  resetChatMessages: () => void;
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
  userType: null,
  coreSkills: [],
  workspaceSkills: [],
  setCoreSkills: (skills: SkillItem[]) => set({ coreSkills: skills }),
  setWorkspaceSkills: (skills: SkillItem[]) => set({ workspaceSkills: skills }),
  setUserType: (type) => set({ userType: type }),
  setConfig: (patch) => set((state) => ({ config: { ...state.config, ...patch } })),
  setDetectedConfig: (config) => set({ detectedConfig: config }),
  setDetectingPaths: (status) => set({ detectingPaths: status }),
  setPathsConfirmed: (status) => set({ pathsConfirmed: status }),
  runtimeProfile: null,
  setRuntimeProfile: (profile) => set({ runtimeProfile: profile }),
  toggleSkill: (skillId) => {
    // Skills are now handled by filesystem actions, not by this config toggle.
    console.log(`Toggle skill requested for ${skillId}, but enabledSkills has been removed from config.`);
  },
  usage: {
    input: 0,
    output: 0,
    history: []
  },
  setUsage: (data) => set((state) => ({ usage: { ...state.usage, ...data } })),
  snapshot: null,
  snapshotHistory: [],
  eventQueue: [],
  ackedEvents: [],
  auditTimeline: [],
  dailyDigest: '',
  rawSnapshot: null,
  snapshotSourcePath: '',
  setSnapshot: (snapshot) => set({ snapshot }),
  setSnapshotHistory: (snapshotHistory) => set({ snapshotHistory }),
  setEventQueue: (eventQueue) => set({ eventQueue }),
  setAckedEvents: (ackedEvents) => set({ ackedEvents }),
  setAuditTimeline: (auditTimeline) => set({ auditTimeline }),
  setDailyDigest: (dailyDigest) => set({ dailyDigest }),
  ackEventLocal: (eventId, ttlMs = 30 * 60 * 1000) => set((state) => {
    const now = Date.now();
    const expiresAt = new Date(now + ttlMs).toISOString();
    const target = state.eventQueue.find((item) => item.id === eventId);
    if (!target) return { eventQueue: state.eventQueue, ackedEvents: state.ackedEvents };
    return {
      eventQueue: state.eventQueue.filter((item) => item.id !== eventId),
      ackedEvents: [
        {
          ...target,
          status: 'acked' as const,
          ackedAt: new Date(now).toISOString(),
          ackExpiresAt: expiresAt,
        },
        ...state.ackedEvents,
      ].slice(0, 200),
    };
  }),
  setRawSnapshot: (rawSnapshot) => set({ rawSnapshot }),
  setSnapshotSourcePath: (snapshotSourcePath) => set({ snapshotSourcePath }),
  runtimeUsageEvents: [],
  setRuntimeUsageEvents: (runtimeUsageEvents) => set({ runtimeUsageEvents }),
  modelPrices: (() => {
    try {
      const stored = localStorage.getItem('openclaw_model_prices');
      if (stored) return JSON.parse(stored);
    } catch (_e) { /* ignore */ }
    return {};
  })(),
  setModelPrices: (modelPrices) => set((state) => {
    try {
      localStorage.setItem('openclaw_model_prices', JSON.stringify({ ...state.modelPrices, ...modelPrices }));
    } catch(_e) { /* ignore */ }
    return { modelPrices: { ...state.modelPrices, ...modelPrices } };
  }),
  theme: (localStorage.getItem('theme') as 'light' | 'dark') ||
    (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  setTheme: (theme) => {
    localStorage.setItem('theme', theme);
    set({ theme });
  },
  language: localStorage.getItem('i18nextLng') || 'zh-TW',
  setLanguage: (lang) => {
    localStorage.setItem('i18nextLng', lang);
    set((state) => ({ language: lang, config: { ...state.config, language: lang } }));
  },
  chat: {
    isOpen: false,
    unreadCount: 0,
    isStreaming: false,
    runtimeMode: 'gateway',
    modeReason: '',
    activeSessionKey: 'agent:main:local:default',
    activeAgentId: 'main',
    messages: [],
    gatewayWsConnected: false,
  },
  setChatOpen: (open) => set((state) => ({
    chat: {
      ...state.chat,
      isOpen: open,
      unreadCount: open ? 0 : state.chat.unreadCount,
    }
  })),
  clearChatUnread: () => set((state) => ({ chat: { ...state.chat, unreadCount: 0 } })),
  setChatRuntimeMode: (mode, reason = '') => set((state) => ({
    chat: {
      ...state.chat,
      runtimeMode: mode,
      modeReason: reason,
    }
  })),
  setActiveChatSession: (sessionKey) => set((state) => ({
    chat: {
      ...state.chat,
      activeSessionKey: sessionKey || state.chat.activeSessionKey,
    }
  })),
  setActiveChatAgent: (agentId) => set((state) => ({
    chat: {
      ...state.chat,
      activeAgentId: agentId || state.chat.activeAgentId,
    }
  })),
  setGatewayWsConnected: (connected) => set((state) => ({
    chat: { ...state.chat, gatewayWsConnected: connected },
  })),
  addChatMessage: (message) => set((state) => {
    const shouldIncreaseUnread = !state.chat.isOpen && message.role === 'assistant';
    return {
      chat: {
        ...state.chat,
        messages: [...state.chat.messages, message],
        unreadCount: shouldIncreaseUnread ? state.chat.unreadCount + 1 : state.chat.unreadCount,
        isStreaming: message.status === 'streaming' ? true : state.chat.isStreaming,
      }
    };
  }),
  appendChatChunk: (id, chunk, sessionKey, agentId) => set((state) => {
    let found = false;
    const nextMessages = state.chat.messages.map((m) => {
      if (m.id !== id) return m;
      found = true;
      return {
        ...m,
        content: `${m.content}${chunk}`,
        status: 'streaming' as const,
      };
    });

    if (!found) {
      nextMessages.push({
        id,
        role: 'assistant',
        content: chunk,
        sessionKey,
        agentId,
        createdAt: Date.now(),
        status: 'streaming',
      });
    }

    return {
      chat: {
        ...state.chat,
        messages: nextMessages,
        isStreaming: true,
      }
    };
  }),
  completeChatMessage: (id, patch = {}) => set((state) => ({
    chat: {
      ...state.chat,
      messages: state.chat.messages.map((m) => m.id === id ? { ...m, status: 'done', ...patch } : m),
      isStreaming: false,
    }
  })),
  markChatMessageError: (id, error) => set((state) => ({
    chat: {
      ...state.chat,
      messages: state.chat.messages.map((m) => m.id === id ? { ...m, status: 'error', error } : m),
      isStreaming: false,
    }
  })),
  resetChatMessages: () => set((state) => ({
    chat: {
      ...state.chat,
      messages: [],
      isStreaming: false,
      unreadCount: 0,
    }
  })),
}));
