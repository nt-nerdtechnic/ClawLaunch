import type { StateCreator } from 'zustand';

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

export interface ChatSlice {
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

export const createChatSlice: StateCreator<ChatSlice> = (set) => ({
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
  resetChatMessages: () =>
    set((state) => ({
      chat: { ...state.chat, messages: [], isStreaming: false, unreadCount: 0 },
    })),
});
