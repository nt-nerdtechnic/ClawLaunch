import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Cpu, MessageSquare, MessageSquarePlus, MessagesSquare, PanelLeftClose, PanelLeftOpen, RefreshCw, Send, Square, WifiOff, X } from 'lucide-react';
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

const formatRelativeTime = (timestamp: string, t?: any): string => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) return t ? t('chat.justNow', '剛剛') : '剛剛';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  return `${days}d`;
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
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [ocSessions, setOcSessions] = useState<OpenClawSessionEntry[]>([]);
  const [sessionLoading, setSessionLoading] = useState(false);
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

  // Fetch all openclaw sessions when session panel opens
  const fetchSessions = async () => {
    if (!window.electronAPI?.listChatSessions) return;
    setSessionLoading(true);
    try {
      const res = await window.electronAPI.listChatSessions();
      if (res.code === 0) {
        const parsed = JSON.parse(res.stdout);
        setOcSessions(Array.isArray(parsed) ? parsed : []);
      }
    } catch (_) {
      // ignore
    } finally {
      setSessionLoading(false);
    }
  };

  useEffect(() => {
    if (sessionPanelOpen) {
      void fetchSessions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionPanelOpen]);

  // 串流結束後，若面板開著則自動刷新 session 列表（讓新建的 session 能即時出現）
  const prevIsStreaming = useRef(false);
  useEffect(() => {
    if (prevIsStreaming.current && !chat.isStreaming && sessionPanelOpen) {
      void fetchSessions();
    }
    prevIsStreaming.current = chat.isStreaming;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.isStreaming]);

  // Load openclaw session history from JSONL into chat UI
  const loadSessionHistory = async (sessionKey: string, agentId: string) => {
    if (!window.electronAPI?.loadChatSession) return;
    try {
      const res = await window.electronAPI.loadChatSession({ sessionKey, agentId });
      if (res.code === 0) {
        const loaded: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: string }> =
          JSON.parse(res.stdout);
        if (Array.isArray(loaded) && loaded.length > 0) {
          resetChatMessages();
          for (const msg of loaded) {
            addChatMessage({
              id: msg.id,
              role: msg.role,
              content: msg.content,
              createdAt: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
              sessionKey,
              agentId,
              status: 'done',
            });
          }
        }
      }
    } catch (_) {
      // ignore
    }
  };

  // Switch to the selected session and load its history
  const handleSelectSession = (session: OpenClawSessionEntry) => {
    const key = session.sessionKey.trim();
    const agent = session.agentId.trim();
    setActiveChatSession(key);
    setActiveChatAgent(agent);
    setSessionDraft(key);
    setAgentDraft(agent);
    const nextSessions = [key, ...sessionHistory.filter((s) => s !== key)];
    const nextAgents = [agent, ...agentHistory.filter((a) => a !== agent)];
    setSessionHistory(nextSessions);
    setAgentHistory(nextAgents);
    persistRecentList('chat_recent_sessions', nextSessions);
    persistRecentList('chat_recent_agents', nextAgents);
    setSessionPanelOpen(false);
    void loadSessionHistory(key, agent);
  };

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (sessionPanelOpen) {
          setSessionPanelOpen(false);
          return;
        }
        if (chat.isOpen) {
          setChatOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chat.isOpen, sessionPanelOpen, setChatOpen]);

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

  const panelHeight = compact ? 'h-[min(78vh,520px)]' : 'h-[min(82vh,640px)]';

  return (
    <div className={`fixed z-[90] flex items-end gap-2 ${compact ? 'bottom-2 right-2 sm:bottom-3 sm:right-3' : 'bottom-3 right-3 sm:bottom-5 sm:right-5'}`}>

      {/* ── Session history drawer — slides out to the LEFT ── */}
      {chat.isOpen && (
        <div
          className={`${panelHeight} overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-sm transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-950/95 ${
            sessionPanelOpen ? 'w-[240px] opacity-100' : 'w-0 opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex h-full w-[240px] flex-col">

            {/* Drawer header */}
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-gradient-to-r from-sky-50/80 via-white to-white px-3 py-2.5 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
              <div className="flex items-center gap-1.5">
                <div className="rounded-lg bg-sky-500/10 p-1 text-sky-600 dark:text-sky-300">
                  <MessagesSquare size={13} />
                </div>
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
                  {t('chat.sessions.title')}
                </span>
              </div>
              <div className="flex items-center gap-0.5">

                <button
                  type="button"
                  onClick={() => void fetchSessions()}
                  disabled={sessionLoading}
                  className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  title={t('chat.sessions.refresh')}
                  aria-label={t('chat.sessions.refresh')}
                >
                  <RefreshCw size={12} className={sessionLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Manual input */}
            {/* Session list */}
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {sessionLoading && (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw size={16} className="animate-spin text-sky-400" />
                  <span className="ml-2 text-[11px] text-slate-400">{t('chat.sessions.loading')}</span>
                </div>
              )}
              {!sessionLoading && ocSessions.length === 0 && (
                <div className="py-8 text-center">
                  <div className="mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                    <MessagesSquare size={16} />
                  </div>
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t('chat.sessions.empty')}</p>
                </div>
              )}
              {!sessionLoading && ocSessions.map((s) => {
                const isActive = s.sessionKey === chat.activeSessionKey && s.agentId === chat.activeAgentId;
                return (
                  <button
                    key={`${s.agentId}/${s.sessionKey}`}
                    type="button"
                    onClick={() => handleSelectSession(s)}
                    className={`mb-1 w-full rounded-xl border px-2.5 py-2 text-left transition-all ${
                      isActive
                        ? 'border-sky-300/70 bg-sky-50 dark:border-sky-700 dark:bg-sky-900/30'
                        : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50 dark:bg-slate-900/60 dark:hover:border-slate-700 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={`inline-flex shrink-0 items-center rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide ${
                            isActive
                              ? 'bg-sky-100 text-sky-700 dark:bg-sky-800/60 dark:text-sky-300'
                              : 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-300'
                          }`}>
                            {s.displayName || s.agentId}
                          </span>
                          {isActive && (
                            <span className="inline-flex items-center rounded bg-sky-500 px-1 py-0.5 text-[8px] font-bold text-white">✓</span>
                          )}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-[9px] text-slate-400 dark:text-slate-500" title={s.sessionKey}>{s.sessionKey}</p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className="text-[8px] text-slate-400">{formatRelativeTime(s.lastTimestamp, t)}</span>
                        <span className="text-[8px] text-slate-300 dark:text-slate-600">{s.messageCount} {t('chat.messageSuffix', '則')}</span>
                      </div>
                    </div>
                    {s.lastMessage && (
                      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {s.lastMessage}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Main chat button / panel ── */}
      {!chat.isOpen ? (
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
      ) : (
        <div className={`${panelBase} flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-950/95`}>
          <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-sky-50/80 via-white to-white px-3 py-3 sm:px-4 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSessionPanelOpen((v) => !v)}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-900/30 dark:hover:text-sky-300"
                title={t('chat.sessions.openPanel')}
                aria-label={t('chat.sessions.openPanel')}
              >
                {sessionPanelOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
              </button>
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
                onClick={() => {
                  const newKey = crypto.randomUUID();
                  setActiveChatSession(newKey);
                  resetChatMessages();
                  setSessionPanelOpen(false);
                }}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-900/30 dark:hover:text-sky-300"
                title={t('chat.sessions.new')}
                aria-label={t('chat.sessions.new')}
              >
                <MessageSquarePlus size={16} />
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

          {/* Compact session indicator bar */}
          <button
            type="button"
            onClick={() => setSessionPanelOpen((v) => !v)}
            className={`flex w-full items-center gap-1.5 border-b border-slate-200 px-4 py-1.5 text-left transition-colors ${
              sessionPanelOpen
                ? 'bg-sky-50/80 dark:bg-sky-900/20'
                : 'bg-slate-50/60 hover:bg-sky-50/60 dark:bg-slate-900/40 dark:hover:bg-sky-900/20'
            } dark:border-slate-800`}
          >
            <span className="inline-flex shrink-0 items-center rounded-md bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-600 dark:bg-orange-900/40 dark:text-orange-300">
              {chat.activeAgentId}
            </span>
            <span className="text-[9px] text-slate-300 dark:text-slate-600">›</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">
              {chat.activeSessionKey}
            </span>
            <MessagesSquare size={10} className={`shrink-0 ${sessionPanelOpen ? 'text-sky-400' : 'text-slate-300 dark:text-slate-600'}`} />
          </button>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-3 py-3 sm:px-4 dark:bg-slate-950/40">
            {activeMessages.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300">
                  <Bot size={14} />
                </div>
                <p className="font-semibold text-slate-600 dark:text-slate-200">{t('chat.empty')}</p>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{t('chat.inputHint')}</p>
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
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; }}
                className="min-h-14 flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 outline-none focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                aria-label={t('chat.placeholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
              />
              {!chat.isStreaming ? (
                <button
                  type="button"
                  onClick={() => void handleSend()}
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
                  onClick={() => void handleAbort()}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-rose-600 text-white transition-colors hover:bg-rose-500"
                  title={t('chat.stop')}
                  aria-label={t('chat.stop')}
                >
                  <Square size={14} className="fill-current" />
                </button>
              )}
            </div>
            <div className="mt-2 text-right text-[10px] text-slate-400 dark:text-slate-500">{t('chat.inputHint')}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// 解析 OpenClaw 注入的訊息前綴，例如：
// [Telegram Neil Lu (@neillu123) id:5493089992 +11m Wed 2026-03-25 16:59 GMT+8]
// [message_id: 5229]
const MSG_PREFIX_RE = /^\[([A-Za-z]+)\s+(.*?)\s+id:(\S+)\s+\+\S+\s+(.*?)\]\n?/;
const MSG_ID_SUFFIX_RE = /\n?\[message_id:\s*(\S+)\]$/;

interface ParsedMessage {
  platform: string;
  senderName: string;
  senderId: string;
  timestamp: string;
  messageId: string | null;
  body: string;
}

function parseMessageContent(content: string): ParsedMessage | null {
  const prefixMatch = MSG_PREFIX_RE.exec(content);
  if (!prefixMatch) return null;

  let body = content.slice(prefixMatch[0].length);
  let messageId: string | null = null;
  const suffixMatch = MSG_ID_SUFFIX_RE.exec(body);
  if (suffixMatch) {
    messageId = suffixMatch[1];
    body = body.slice(0, suffixMatch.index);
  }

  return {
    platform: prefixMatch[1],
    senderName: prefixMatch[2],
    senderId: prefixMatch[3],
    timestamp: prefixMatch[4],
    messageId,
    body: body.trim(),
  };
}

function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  const parsed = isUser ? parseMessageContent(msg.content) : null;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[92%] rounded-2xl border px-3 py-2.5 text-sm leading-relaxed shadow-sm sm:max-w-[88%] ${isUser ? 'border-sky-500/70 bg-gradient-to-br from-sky-500 to-sky-600 text-white' : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
        {parsed ? (
          <>
            {/* 來源 badge 列 */}
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              <span className="inline-flex items-center rounded-md bg-white/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-100">
                {parsed.platform}
              </span>
              <span className="text-[11px] font-semibold text-sky-50">{parsed.senderName}</span>
              <span className="text-[9px] text-sky-200/70">{parsed.timestamp}</span>
            </div>
            {/* 主要訊息內容 */}
            <div className="whitespace-pre-wrap break-words">{parsed.body || (msg.status === 'streaming' ? '...' : '')}</div>
            {/* message_id */}
            {parsed.messageId && (
              <div className="mt-1 text-[9px] text-sky-200/50">#{parsed.messageId}</div>
            )}
          </>
        ) : (
          <div className="whitespace-pre-wrap break-words">{msg.content || (msg.status === 'streaming' ? '...' : '')}</div>
        )}
        <div className={`mt-1.5 flex items-center gap-1 text-[10px] ${isUser ? 'text-sky-100/90' : 'text-slate-400 dark:text-slate-500'}`}>
          <span>{formatTime(msg.createdAt)}</span>
          {msg.status === 'streaming' && <Cpu size={10} className="animate-pulse" />}
          {msg.status === 'error' && <span className="text-rose-400">{msg.error}</span>}
        </div>
      </div>
    </div>
  );
}
