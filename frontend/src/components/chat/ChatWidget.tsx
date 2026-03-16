import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, MessageSquare, Send, Square, X, WifiOff, Cpu, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store';
import type { ChatMessage } from '../../store';

const clampText = (value: string) => value.replace(/\s+/g, ' ').trim();

const loadRecentList = (key: string, fallback: string[]) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((item) => typeof item === 'string' && item.trim().length > 0);
    }
  } catch (_) {
    // Ignore malformed local state.
  }
  return fallback;
};

const persistRecentList = (key: string, list: string[]) => {
  localStorage.setItem(key, JSON.stringify(list.slice(0, 8)));
};

const nextRequestId = () => `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const formatTime = (createdAt: number) => {
  const d = new Date(createdAt);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

interface ChatWidgetProps {
  compact?: boolean;
}

export function ChatWidget({ compact = false }: ChatWidgetProps) {
  const { t } = useTranslation();
  const {
    running,
    chat,
    setChatOpen,
    clearChatUnread,
    addChatMessage,
    appendChatChunk,
    completeChatMessage,
    markChatMessageError,
    setChatRuntimeMode,
    setActiveChatSession,
    setActiveChatAgent,
    resetChatMessages,
  } = useStore();

  const [inputValue, setInputValue] = useState('');
  const [sessionDraft, setSessionDraft] = useState(chat.activeSessionKey);
  const [agentDraft, setAgentDraft] = useState(chat.activeAgentId);
  const [sessionHistory, setSessionHistory] = useState<string[]>(() => loadRecentList('chat_recent_sessions', [chat.activeSessionKey]));
  const [agentHistory, setAgentHistory] = useState<string[]>(() => loadRecentList('chat_recent_agents', [chat.activeAgentId]));
  const [requestMap, setRequestMap] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);

  const activeMessages = useMemo(
    () => chat.messages.filter((item) => item.sessionKey === chat.activeSessionKey && item.agentId === chat.activeAgentId),
    [chat.messages, chat.activeSessionKey, chat.activeAgentId]
  );

  useEffect(() => {
    if (!window.electronAPI?.onChatChunk) return;
    const off = window.electronAPI.onChatChunk((chunk) => {
      const messageId = requestMap[chunk.requestId] || chunk.messageId;
      if (!messageId) return;

      if (chunk.mode) {
        setChatRuntimeMode(chunk.mode, chunk.reason || '');
      }

      if (chunk.error) {
        markChatMessageError(messageId, chunk.error);
        return;
      }

      if (chunk.delta) {
        appendChatChunk(messageId, chunk.delta, chat.activeSessionKey, chat.activeAgentId);
      }

      if (chunk.done) {
        completeChatMessage(messageId);
      }
    });

    return () => off();
  }, [appendChatChunk, chat.activeAgentId, chat.activeSessionKey, completeChatMessage, markChatMessageError, requestMap, setChatRuntimeMode]);

  useEffect(() => {
    if (!chat.isOpen) return;
    clearChatUnread();
  }, [chat.isOpen, clearChatUnread]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [activeMessages]);

  const applySessionAgent = () => {
    const normalizedSession = clampText(sessionDraft || chat.activeSessionKey);
    const normalizedAgent = clampText(agentDraft || chat.activeAgentId);

    setActiveChatSession(normalizedSession);
    setActiveChatAgent(normalizedAgent);

    const nextSessions = [normalizedSession, ...sessionHistory.filter((item) => item !== normalizedSession)];
    const nextAgents = [normalizedAgent, ...agentHistory.filter((item) => item !== normalizedAgent)];
    setSessionHistory(nextSessions);
    setAgentHistory(nextAgents);
    persistRecentList('chat_recent_sessions', nextSessions);
    persistRecentList('chat_recent_agents', nextAgents);
  };

  const handleSend = async () => {
    const message = inputValue.trim();
    if (!message || chat.isStreaming) return;

    if (!running) {
      addChatMessage({
        id: `${nextRequestId()}-system`,
        role: 'system',
        content: t('chat.coreRequired'),
        createdAt: Date.now(),
        sessionKey: chat.activeSessionKey,
        agentId: chat.activeAgentId,
        status: 'done',
      });
      return;
    }

    applySessionAgent();

    const requestId = nextRequestId();
    const assistantMessageId = `${requestId}-assistant`;

    addChatMessage({
      id: `${requestId}-user`,
      role: 'user',
      content: message,
      createdAt: Date.now(),
      sessionKey: chat.activeSessionKey,
      agentId: chat.activeAgentId,
      status: 'done',
    });

    addChatMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      sessionKey: chat.activeSessionKey,
      agentId: chat.activeAgentId,
      status: 'streaming',
    });

    setRequestMap((prev) => ({ ...prev, [requestId]: assistantMessageId }));
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.value = '';
    }

    if (!window.electronAPI?.invokeChat) {
      markChatMessageError(assistantMessageId, t('chat.unavailable'));
      return;
    }

    const res = await window.electronAPI.invokeChat({
      requestId,
      sessionKey: chat.activeSessionKey,
      agentId: chat.activeAgentId,
      message,
      stream: true,
      deliver: false,
    });

    if (res.mode) {
      setChatRuntimeMode(res.mode, res.reason || '');
    }

    if (!res.success) {
      markChatMessageError(assistantMessageId, res.error || t('chat.errorGeneric'));
      return;
    }

    if (res.content && !chat.isStreaming) {
      appendChatChunk(assistantMessageId, res.content, chat.activeSessionKey, chat.activeAgentId);
      completeChatMessage(assistantMessageId);
    }
  };

  const handleAbort = async () => {
    if (!window.electronAPI?.abortChat) return;
    const pendingRequestIds = Object.keys(requestMap);
    if (pendingRequestIds.length === 0) return;
    const latest = pendingRequestIds[pendingRequestIds.length - 1];
    await window.electronAPI.abortChat(latest);
  };

  const panelBase = compact
    ? 'w-[min(calc(100vw-0.75rem),320px)] h-[min(78vh,520px)] sm:w-[320px]'
    : 'w-[min(calc(100vw-1rem),430px)] h-[min(82vh,640px)] sm:w-[390px] md:w-[420px]';

  return (
    <div className={`fixed z-[90] ${compact ? 'bottom-2 right-2 sm:bottom-3 sm:right-3' : 'bottom-3 right-3 sm:bottom-5 sm:right-5'}`}>
      {!chat.isOpen && (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="group relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-300/70 bg-white/95 text-sky-600 shadow-2xl shadow-sky-500/20 transition-all hover:-translate-y-0.5 hover:bg-white sm:h-14 sm:w-14 dark:border-sky-700 dark:bg-slate-900/95 dark:text-sky-300"
          title={t('chat.open')}
          aria-label={t('chat.open')}
        >
          <MessageSquare size={22} />
          {chat.unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
              {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
            </span>
          )}
        </button>
      )}

      {chat.isOpen && (
        <div className={`${panelBase} flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-950/95`}>
          <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-sky-50/80 via-white to-white px-3 py-3 sm:px-4 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
            <div className="flex items-center gap-2">
              <div className="rounded-xl bg-sky-500/10 p-2 text-sky-600 dark:text-sky-300">
                <Bot size={16} />
              </div>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t('chat.title')}</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {chat.runtimeMode === 'local' ? t('chat.modeLocal') : t('chat.modeGateway')}
                  {chat.modeReason ? ` · ${chat.modeReason}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={resetChatMessages}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                title={t('chat.clear')}
                aria-label={t('chat.clear')}
              >
                <Trash2 size={15} />
              </button>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                title={t('chat.close')}
                aria-label={t('chat.close')}
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 border-b border-slate-200 px-3 py-2 sm:grid-cols-2 dark:border-slate-800">
            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {t('chat.session')}
              <input
                list="chat-session-options"
                value={sessionDraft}
                onChange={(e) => setSessionDraft(e.target.value)}
                onBlur={applySessionAgent}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono text-slate-700 outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                aria-label={t('chat.session')}
              />
            </label>
            <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
              {t('chat.agent')}
              <input
                list="chat-agent-options"
                value={agentDraft}
                onChange={(e) => setAgentDraft(e.target.value)}
                onBlur={applySessionAgent}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono text-slate-700 outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                aria-label={t('chat.agent')}
              />
            </label>
            <datalist id="chat-session-options">
              {sessionHistory.map((value) => <option key={value} value={value} />)}
            </datalist>
            <datalist id="chat-agent-options">
              {agentHistory.map((value) => <option key={value} value={value} />)}
            </datalist>
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-3 py-3 sm:px-4 dark:bg-slate-950/40">
            {activeMessages.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
                  <Bot size={14} />
                </div>
                <p className="font-semibold text-slate-600 dark:text-slate-200">{t('chat.empty')}</p>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">Enter 送出，Shift+Enter 換行</p>
              </div>
            )}
            <div className="space-y-2">
              {activeMessages.map((msg) => (
                <ChatBubble key={msg.id} msg={msg} />
              ))}
            </div>
          </div>

          <div className="border-t border-slate-200 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-950/85">
            {chat.runtimeMode === 'local' && (
              <div className="mb-2 inline-flex items-center gap-1 rounded-lg border border-amber-300/70 bg-amber-100/70 px-2 py-1 text-[10px] font-bold text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <WifiOff size={12} />
                {t('chat.fallbackLocal')}
              </div>
            )}
            {!running && (
              <div className="mb-2 inline-flex items-center gap-1 rounded-lg border border-rose-300/70 bg-rose-100/70 px-2 py-1 text-[10px] font-bold text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                <WifiOff size={12} />
                {t('chat.coreRequired')}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={t('chat.placeholder')}
                rows={2}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  composingRef.current = false;
                }}
                className="min-h-14 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                aria-label={t('chat.placeholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              {!chat.isStreaming ? (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!inputValue.trim() || !running}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-sky-600 text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                  title={!running ? t('chat.coreRequired') : t('chat.send')}
                  aria-label={!running ? t('chat.coreRequired') : t('chat.send')}
                >
                  <Send size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleAbort}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-rose-600 text-white transition-colors hover:bg-rose-500"
                  title={t('chat.stop')}
                  aria-label={t('chat.stop')}
                >
                  <Square size={14} className="fill-current" />
                </button>
              )}
            </div>
            <div className="mt-2 text-right text-[10px] text-slate-400 dark:text-slate-500">Enter 送出，Shift+Enter 換行</div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[92%] rounded-2xl border px-3 py-2.5 text-sm leading-relaxed shadow-sm sm:max-w-[88%] ${isUser ? 'border-sky-500/70 bg-gradient-to-br from-sky-500 to-sky-600 text-white' : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
        <div className="whitespace-pre-wrap break-words">{msg.content || (msg.status === 'streaming' ? '...' : '')}</div>
        <div className={`mt-1.5 flex items-center gap-1 text-[10px] ${isUser ? 'text-sky-100/90' : 'text-slate-400 dark:text-slate-500'}`}>
          <span>{formatTime(msg.createdAt)}</span>
          {msg.status === 'streaming' && <Cpu size={10} className="animate-pulse" />}
          {msg.status === 'error' && <span className="text-rose-400">{msg.error}</span>}
        </div>
      </div>
    </div>
  );
}
