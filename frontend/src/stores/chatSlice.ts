import type { StateCreator } from 'zustand';

export interface ToolCall {
  id: string;
  name: string;
  input?: Record<string, unknown>;
  output?: string;
  status: 'pending' | 'success' | 'error';
}

export interface ChatAttachment {
  id: string;
  name: string;
  type: string;
  url: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sessionKey: string;
  agentId: string;
  createdAt: number;
  status?: 'streaming' | 'thinking' | 'tool_use' | 'done' | 'error';
  error?: string;
  toolCalls?: ToolCall[];
  attachments?: ChatAttachment[];
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
  searchQuery: string;
}

export interface ChatSlice {
  chat: ChatState;
  setChatOpen: (open: boolean) => void;
  clearChatUnread: () => void;
  setChatRuntimeMode: (mode: 'gateway' | 'local', reason?: string) => void;
  setActiveChatSession: (sessionKey: string) => void;
  setActiveChatAgent: (agentId: string) => void;
  setActiveChatAgentAndSave: (agentId: string) => void;
  setGatewayWsConnected: (connected: boolean) => void;
  addChatMessage: (message: ChatMessage) => void;
  appendChatChunk: (id: string, chunk: string, sessionKey: string, agentId: string) => void;
  patchChatMessage: (id: string, patch: Partial<ChatMessage>, isStreaming?: boolean) => void;
  completeChatMessage: (id: string, patch?: Partial<ChatMessage>) => void;
  markChatMessageError: (id: string, error: string) => void;
  updateToolCall: (messageId: string, toolCall: Partial<ToolCall> & { id: string }) => void;
  resetChatMessages: () => void;
  setSearchQuery: (query: string) => void;
}

export const createChatSlice: StateCreator<ChatSlice> = (set, get) => ({
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
    searchQuery: '',
  },
  setChatOpen: (open) =>
    set((state) => ({
      chat: {
        ...state.chat,
        isOpen: open,
        unreadCount: open ? 0 : state.chat.unreadCount,
      },
    })),
  clearChatUnread: () => set((state) => ({ chat: { ...state.chat, unreadCount: 0 } })),
  setChatRuntimeMode: (mode, reason = '') =>
    set((state) => ({
      chat: { ...state.chat, runtimeMode: mode, modeReason: reason },
    })),
  setActiveChatSession: (sessionKey) =>
    set((state) => ({
      chat: {
        ...state.chat,
        activeSessionKey: sessionKey || state.chat.activeSessionKey,
      },
    })),
  setActiveChatAgent: (agentId) =>
    set((state) => ({
      chat: {
        ...state.chat,
        activeAgentId: agentId || state.chat.activeAgentId,
      },
    })),
  setActiveChatAgentAndSave: (agentId) => {
    set((state) => ({
      chat: {
        ...state.chat,
        activeAgentId: agentId || state.chat.activeAgentId,
      },
    }));
    if (typeof window !== 'undefined' && window.electronAPI) {
      const state = get() as any;
      if (state.setConfig) {
        state.setConfig({ activeAgentId: agentId });
        const currentConfig = state.config;
        const { model: _m, botToken: _b, authChoice: _a, apiKey: _k, platform: _p, appToken: _at, ...launcherPayload } = currentConfig;
        window.electronAPI.exec(`config:write ${JSON.stringify({ ...launcherPayload, activeAgentId: agentId })}`).catch(() => {});
      }
    }
  },
  setGatewayWsConnected: (connected) =>
    set((state) => ({ chat: { ...state.chat, gatewayWsConnected: connected } })),
  addChatMessage: (message) =>
    set((state) => {
      const shouldIncreaseUnread = !state.chat.isOpen && message.role === 'assistant';
      return {
        chat: {
          ...state.chat,
          messages: [...state.chat.messages, message],
          unreadCount: shouldIncreaseUnread
            ? state.chat.unreadCount + 1
            : state.chat.unreadCount,
          isStreaming:
            message.status === 'streaming' ? true : state.chat.isStreaming,
        },
      };
    }),
  appendChatChunk: (id, chunk, sessionKey, agentId) =>
    set((state) => {
      let found = false;
      const nextMessages = state.chat.messages.map((m) => {
        if (m.id !== id) return m;
        found = true;
        return { ...m, content: `${m.content}${chunk}`, status: 'streaming' as const };
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

      return { chat: { ...state.chat, messages: nextMessages, isStreaming: true } };
    }),
  patchChatMessage: (id, patch, isStreaming) =>
    set((state) => ({
      chat: {
        ...state.chat,
        messages: state.chat.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        isStreaming: isStreaming ?? state.chat.isStreaming,
      },
    })),
  completeChatMessage: (id, patch = {}) =>
    set((state) => ({
      chat: {
        ...state.chat,
        messages: state.chat.messages.map((m) =>
          m.id === id ? { ...m, status: 'done', ...patch } : m
        ),
        isStreaming: false,
      },
    })),
  markChatMessageError: (id, error) =>
    set((state) => ({
      chat: {
        ...state.chat,
        messages: state.chat.messages.map((m) =>
          m.id === id ? { ...m, status: 'error', error } : m
        ),
        isStreaming: false,
      },
    })),
  updateToolCall: (messageId, toolCallPatch) =>
    set((state) => ({
      chat: {
        ...state.chat,
        messages: state.chat.messages.map((m) => {
          if (m.id !== messageId) return m;
          const existingCalls = m.toolCalls || [];
          const idx = existingCalls.findIndex(tc => tc.id === toolCallPatch.id);
          const newCalls = [...existingCalls];
          if (idx !== -1) {
            newCalls[idx] = { ...newCalls[idx], ...toolCallPatch };
          } else {
            newCalls.push({
              id: toolCallPatch.id,
              name: toolCallPatch.name || 'unknown_tool',
              input: toolCallPatch.input,
              output: toolCallPatch.output,
              status: toolCallPatch.status || 'pending',
            });
          }
          return { ...m, toolCalls: newCalls };
        }),
      },
    })),
  resetChatMessages: () =>
    set((state) => ({
      chat: { ...state.chat, messages: [], isStreaming: false, unreadCount: 0 },
    })),
  setSearchQuery: (query) =>
    set((state) => ({ chat: { ...state.chat, searchQuery: query } })),
});
