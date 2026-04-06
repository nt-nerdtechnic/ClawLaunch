import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Check, ChevronDown, Copy, MessageSquare, MessageSquarePlus, MessagesSquare, PanelLeftClose, PanelLeftOpen, RefreshCw, Send, Square, X, Settings2, Search, Paperclip } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { marked } from 'marked';
import { useStore } from '../../store';
import type { ChatMessage } from '../../store';
import { usePixelOfficeAgents } from '../pixel-office/hooks/usePixelOfficeAgents';

// ─── Types ──────────────────────────────────────────────────────────────────
export interface OpenClawSessionEntry {
  sessionKey: string;
  agentId: string;
  sessionId: string;
  displayName: string;
  lastMessage: string;
  lastTimestamp: string;
  messageCount: number;
}

// Configure marked for chat rendering
marked.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text: string): string {
  if (!text.trim()) return '';
  try {
    return marked.parse(text) as string;
  } catch {
    return text;
  }
}

// Command shortcuts (matches OpenClaw WebUI)
const STOP_COMMANDS = new Set(['/stop', 'stop', 'esc', 'abort', 'wait', 'exit']);
function isStopCommand(text: string) { return STOP_COMMANDS.has(text.trim().toLowerCase()); }
function isNewSessionCommand(text: string) {
  const t = text.trim().toLowerCase();
  return t === '/new' || t === '/reset' || t.startsWith('/new ') || t.startsWith('/reset ');
}

// ─── Telegram HTML support ────────────────────────────────────────────────────
const TG_SAFE_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del',
  'code', 'pre', 'a', 'blockquote', 'tg-spoiler', 'br', 'span',
]);

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeTgNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escHtml(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  const children = () => Array.from(el.childNodes).map(sanitizeTgNode).join('');
  if (tag === 'div' || tag === 'body' || tag === 'html') return children();
  if (!TG_SAFE_TAGS.has(tag)) return children(); // strip unknown tags, keep text
  if (tag === 'br') return '<br>';
  let attrs = '';
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    if (/^https?:\/\//.test(href)) {
      attrs = ` href="${escHtml(href)}" target="_blank" rel="noopener noreferrer"`;
    }
  }
  if (tag === 'tg-spoiler') attrs = ' class="tg-spoiler"';
  return `<${tag}${attrs}>${children()}</${tag}>`;
}

function sanitizeTgHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return escHtml(html);
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild as Element | null;
  if (!root) return '';
  return Array.from(root.childNodes).map(sanitizeTgNode).join('');
}

const TG_HTML_RE = /<(?:b|i|u|s|code|pre|a[\s>]|blockquote|tg-spoiler)[ >/]/i;
function isTgFormatted(text: string): boolean { return TG_HTML_RE.test(text); }

// Inline keyboard buttons  ── [[Button A | Button B]] per row
const BTN_BLOCK_RE = /\n?\[\[([^\]]+)\]\]/g;
function parseButtonBlocks(text: string): { body: string; rows: string[][] } {
  const rows: string[][] = [];
  BTN_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BTN_BLOCK_RE.exec(text)) !== null) {
    const row = match[1].split('|').map((s) => s.trim()).filter(Boolean);
    if (row.length) rows.push(row);
  }
  const body = rows.length ? text.replace(/\n?\[\[[^\]]+\]\]/g, '').trimEnd() : text;
  return { body, rows };
}

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

const formatRelativeTime = (timestamp: string, t?: TFunction): string => {
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
    markChatMessageError,
    setActiveChatSession,
    setActiveChatAgent,
    resetChatMessages,
  } = useStore();

  const [inputValue, setInputValue] = useState('');
  const [sessionDraft, setSessionDraft] = useState(chat.activeSessionKey);
  const [agentDraft, setAgentDraft] = useState(chat.activeAgentId);
  const [sessionHistory, setSessionHistory] = useState<string[]>(() => loadRecentList('chat_recent_sessions', [chat.activeSessionKey]));
  const [agentHistory, setAgentHistory] = useState<string[]>(() => loadRecentList('chat_recent_agents', [chat.activeAgentId]));
  const gatewayInfoRef = useRef<{ baseUrl: string; token: string } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [ocSessions, setOcSessions] = useState<OpenClawSessionEntry[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionHasMore, setSessionHasMore] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionLoadingMore, setSessionLoadingMore] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const { summaries: knownAgents } = usePixelOfficeAgents();

  const agentOptions = useMemo(() => {
    const has = knownAgents.some(a => a.id === chat.activeAgentId);
    if (has) return knownAgents;
    return [{ id: chat.activeAgentId, displayName: chat.activeAgentId, color: '#94a3b8', snapshotState: 'idle' as const, tokensIn: 0, tokensOut: 0, cost: 0, sessionCount: 0 }, ...knownAgents];
  }, [knownAgents, chat.activeAgentId]);

  const currentAgentColor = useMemo(() => {
    return agentOptions.find(a => a.id === chat.activeAgentId)?.color ?? '#94a3b8';
  }, [agentOptions, chat.activeAgentId]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const loadSessionHistory = useCallback(async (sessionKey: string, agentId: string) => {
    if (!window.electronAPI?.loadChatSession) return;
    try {
      const res = await window.electronAPI.loadChatSession({ sessionKey, agentId });
      if (res.code === 0) {
        const loaded: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: string }> =
          JSON.parse(res.stdout);
        if (Array.isArray(loaded)) {
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
    } catch (_) { /* ignore */ }
  }, [addChatMessage, resetChatMessages]);

  const fetchSessions = useCallback(async (offset = 0) => {
    if (!window.electronAPI?.listChatSessions) return;
    const isLoadMore = offset > 0;
    if (isLoadMore) setSessionLoadingMore(true);
    else setSessionLoading(true);
    try {
      const res = await window.electronAPI.listChatSessions({ limit: 20, offset });
      if (res.code === 0) {
        const parsed = JSON.parse(res.stdout) as { sessions: OpenClawSessionEntry[]; total: number; hasMore: boolean };
        const incoming = Array.isArray(parsed.sessions) ? parsed.sessions : [];
        setOcSessions((prev) => isLoadMore ? [...prev, ...incoming] : incoming);
        setSessionTotal(typeof parsed.total === 'number' ? parsed.total : incoming.length);
        setSessionHasMore(Boolean(parsed.hasMore));
      }
    } catch (_) { /* ignore */ }
    finally {
      if (isLoadMore) setSessionLoadingMore(false);
      else setSessionLoading(false);
    }
  }, []);

  const handleSwitchAgent = useCallback(async (agentId: string) => {
    setActiveChatAgent(agentId);
    setAgentDraft(agentId);
    setAgentPickerOpen(false);

    if (window.electronAPI?.listChatSessions) {
      try {
        const res = await window.electronAPI.listChatSessions({ limit: 20, offset: 0 });
        if (res.code === 0) {
          const parsed = JSON.parse(res.stdout) as { sessions: OpenClawSessionEntry[] };
          const lastSession = parsed.sessions.find(s => s.agentId === agentId);
          if (lastSession) {
            setActiveChatSession(lastSession.sessionKey);
            setSessionDraft(lastSession.sessionKey);
            void loadSessionHistory(lastSession.sessionKey, agentId);
            return;
          }
        }
      } catch (_) { /* fallback */ }
    }

    const newKey = `agent:${agentId}:local:${crypto.randomUUID()}`;
    setActiveChatSession(newKey);
    setSessionDraft(newKey);
    resetChatMessages();
  }, [setActiveChatAgent, setActiveChatSession, resetChatMessages, loadSessionHistory]);

  const handleSelectSession = useCallback((session: OpenClawSessionEntry) => {
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
  }, [sessionHistory, agentHistory, setActiveChatSession, setActiveChatAgent, loadSessionHistory]);

  const applySessionAgent = useCallback(() => {
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
  }, [sessionDraft, agentDraft, chat.activeSessionKey, chat.activeAgentId, sessionHistory, agentHistory, setActiveChatSession, setActiveChatAgent]);

  // ── Effects ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!agentPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setAgentPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [agentPickerOpen]);

  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const messageQueueRef = useRef<string[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const handleSendRef = useRef<(msgOverride?: string) => Promise<void>>(undefined as unknown as (msgOverride?: string) => Promise<void>);

  const activeMessages = useMemo(
    () => chat.messages.filter((item) => item.sessionKey === chat.activeSessionKey && item.agentId === chat.activeAgentId),
    [chat.messages, chat.activeSessionKey, chat.activeAgentId]
  );

  const chatIsOpenRef = useRef(chat.isOpen);
  chatIsOpenRef.current = chat.isOpen;

  useEffect(() => {
    if (chat.isOpen) clearChatUnread();
  }, [chat.isOpen, clearChatUnread]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = 'auto';
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
  }, [inputValue]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [activeMessages]);

  useEffect(() => {
    if (sessionPanelOpen) void fetchSessions();
  }, [sessionPanelOpen, fetchSessions]);

  const prevIsStreaming = useRef(false);
  useEffect(() => {
    if (prevIsStreaming.current && !chat.isStreaming) {
      if (sessionPanelOpen) void fetchSessions();
      if (messageQueueRef.current.length > 0) {
        const next = messageQueueRef.current.shift()!;
        setQueueCount(messageQueueRef.current.length);
        void handleSendRef.current?.(next);
      }
    }
    prevIsStreaming.current = chat.isStreaming;
  }, [chat.isStreaming, sessionPanelOpen, fetchSessions]);

  const handleAbortLocal = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (sessionPanelOpen) { setSessionPanelOpen(false); return; }
        if (chat.isStreaming) { handleAbortLocal(); return; }
        if (chat.isOpen) setChatOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chat.isOpen, sessionPanelOpen, chat.isStreaming, setChatOpen, handleAbortLocal]);

  const handleSend = useCallback(async (msgOverride?: string) => {
    const message = (msgOverride ?? inputValue).trim();
    if (!message) return;
    if (isStopCommand(message)) { setInputValue(''); handleAbortLocal(); return; }
    if (isNewSessionCommand(message)) {
      setInputValue('');
      const newKey = crypto.randomUUID();
      setActiveChatSession(newKey);
      resetChatMessages();
      setSessionPanelOpen(false);
      return;
    }
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
    if (chat.isStreaming) {
      messageQueueRef.current = [...messageQueueRef.current, message];
      setQueueCount(messageQueueRef.current.length);
      if (!msgOverride) setInputValue('');
      return;
    }
    if (!msgOverride) setInputValue('');
    applySessionAgent();

    const assistantMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    addChatMessage({
      id: `${assistantMessageId}-user`,
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

    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    // Cache gateway info (only IPC once per session)
    if (!gatewayInfoRef.current) {
      try {
        gatewayInfoRef.current = await window.electronAPI.getGatewayInfo();
      } catch {
        markChatMessageError(assistantMessageId, t('chat.errorGeneric'));
        return;
      }
    }

    const { baseUrl, token } = gatewayInfoRef.current;
    const sessionKey = chat.activeSessionKey;
    const agentId = chat.activeAgentId;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-openclaw-agent-id': agentId,
          'x-openclaw-session-key': sessionKey,
        },
        body: JSON.stringify({
          model: `openclaw/${agentId}`,
          messages: [{ role: 'user', content: message }],
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        markChatMessageError(assistantMessageId, errText || `HTTP ${response.status}`);
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            useStore.getState().completeChatMessage(assistantMessageId);
            if ((document.hidden || !chatIsOpenRef.current) && 'Notification' in window && Notification.permission === 'granted') {
              const preview = useStore.getState().chat.messages.find(m => m.id === assistantMessageId)?.content?.slice(0, 100).trim() ?? '';
              if (preview) {
                const n = new Notification('OpenClaw Core', { body: preview, silent: false });
                n.onclick = () => { window.focus(); };
              }
            }
            break outer;
          }
          try {
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              useStore.getState().appendChatChunk(assistantMessageId, delta, sessionKey, agentId);
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        useStore.getState().completeChatMessage(assistantMessageId);
      } else {
        markChatMessageError(assistantMessageId, (err as Error).message || t('chat.errorGeneric'));
      }
    } finally {
      abortControllerRef.current = null;
    }
  }, [inputValue, chat.isStreaming, chat.activeSessionKey, chat.activeAgentId, running, addChatMessage, applySessionAgent, markChatMessageError, t, setActiveChatSession, resetChatMessages, handleAbortLocal]);

  useEffect(() => { handleSendRef.current = handleSend; }, [handleSend]);

  const panelBase = compact ? 'w-[calc(100vw-1rem)] h-[calc(100vh-6.75rem)]' : 'w-[min(calc(100vw-1rem),430px)] h-[min(82vh,640px)] sm:w-[390px] md:w-[420px]';
  const panelHeight = compact ? 'h-[calc(100vh-6.75rem)]' : 'h-[min(82vh,640px)]';

  return (
    <div className={`fixed z-[90] flex items-end gap-2 ${compact ? 'bottom-[3.25rem] right-2 sm:bottom-[3.5rem] sm:right-3' : 'bottom-3 right-3 sm:bottom-5 sm:right-5'}`}>
      {chat.isOpen && (
        <div className={`${panelHeight} overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-sm transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-950/95 ${sessionPanelOpen ? 'w-[240px] opacity-100' : 'w-0 opacity-0 pointer-events-none'}`}>
          <div className="flex h-full w-[240px] flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-gradient-to-r from-sky-50/80 via-white to-white px-3 py-2.5 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
              <div className="flex items-center gap-1.5">
                <div className="rounded-lg bg-sky-500/10 p-1 text-sky-600 dark:text-sky-300"><MessagesSquare size={13} /></div>
                <span className="text-[11px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t('chat.sessions.title')}</span>
              </div>
              <button type="button" onClick={() => void fetchSessions()} disabled={sessionLoading} className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={t('chat.sessions.refresh')} aria-label={t('chat.sessions.refresh')}>
                <RefreshCw size={12} className={sessionLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {sessionLoading && <div className="flex items-center justify-center py-8"><RefreshCw size={16} className="animate-spin text-sky-400" /><span className="ml-2 text-[11px] text-slate-400">{t('chat.sessions.loading')}</span></div>}
              {!sessionLoading && ocSessions.length === 0 && <div className="py-8 text-center"><div className="mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"><MessagesSquare size={16} /></div><p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{t('chat.sessions.empty')}</p></div>}
              {!sessionLoading && ocSessions.map((s) => {
                const isActive = s.sessionKey === chat.activeSessionKey && s.agentId === chat.activeAgentId;
                const agentColor = agentOptions.find(a => a.id === s.agentId)?.color ?? '#94a3b8';
                const isRunning = s.messageCount === -1 || (s.lastTimestamp && (Date.now() - new Date(s.lastTimestamp).getTime() < 300000));

                return (
                  <button key={`${s.agentId}/${s.sessionKey}`} type="button" onClick={() => handleSelectSession(s)} className={`group mb-1.5 w-full rounded-xl border px-3 py-2.5 text-left transition-all ${isActive ? 'border-sky-300/70 bg-sky-50 shadow-sm dark:border-sky-700/50 dark:bg-sky-900/30' : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50 dark:bg-slate-900/40 dark:hover:border-slate-700/50 dark:hover:bg-slate-800/60'}`}>
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="relative flex h-2 w-2 shrink-0">
                            {isRunning && <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: agentColor }}></span>}
                            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: agentColor }}></span>
                          </span>
                          <span className={`truncate text-[11px] font-bold tracking-tight ${isActive ? 'text-sky-900 dark:text-sky-100' : 'text-slate-700 dark:text-slate-300'}`}>{s.displayName || s.agentId}</span>
                          {isRunning && <span className="rounded bg-emerald-500/10 px-1 py-0.5 text-[8px] font-black uppercase tracking-tighter text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">Live</span>}
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100/50 px-1.5 py-0.5 font-mono text-[8px] font-semibold text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500" title={s.sessionKey}><span className="truncate max-w-[80px]">{s.sessionKey}</span></span>
                          <span className="text-[8px] text-slate-300 dark:text-slate-600">•</span>
                          <span className="text-[8px] font-medium text-slate-400">{s.messageCount >= 0 ? s.messageCount : '—'} {t('chat.messageSuffix', '則')}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-[9px] font-semibold text-slate-400">{formatRelativeTime(s.lastTimestamp, t)}</span>
                        {isActive && <div className="rounded-full bg-sky-500 p-0.5 text-white shadow-sm"><Check size={8} strokeWidth={4} /></div>}
                      </div>
                    </div>
                    {s.lastMessage && <p className={`mt-2 line-clamp-2 text-[10px] leading-relaxed ${isActive ? 'text-sky-700/80 dark:text-sky-300/80' : 'text-slate-500 dark:text-slate-400'}`}>{s.lastMessage}</p>}
                  </button>
                );
              })}
              {!sessionLoading && sessionHasMore && <button type="button" onClick={() => void fetchSessions(ocSessions.length)} disabled={sessionLoadingMore} className="mt-1 w-full rounded-xl border border-dashed border-slate-200 py-2 text-[10px] font-semibold text-slate-400 transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:border-sky-700 dark:hover:bg-sky-900/20 dark:hover:text-sky-300">{sessionLoadingMore ? <span className="flex items-center justify-center gap-1.5"><RefreshCw size={10} className="animate-spin" />{t('chat.sessions.loadingMore', '載入中...')}</span> : `${t('chat.sessions.loadMore', '載入更多')} (${sessionTotal - ocSessions.length})`}</button>}
            </div>
          </div>
        </div>
      )}
      {!chat.isOpen ? (
        <button type="button" onClick={() => setChatOpen(true)} className="group relative inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-300/70 bg-white/95 text-sky-600 shadow-2xl shadow-sky-500/20 transition-all hover:-translate-y-0.5 hover:bg-white sm:h-14 sm:w-14 dark:border-sky-700 dark:bg-slate-900/95 dark:text-sky-300" title={t('chat.open')} aria-label={t('chat.open')}>
          <MessageSquare size={22} />
          {chat.unreadCount > 0 && <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">{chat.unreadCount > 99 ? '99+' : chat.unreadCount}</span>}
        </button>
      ) : (
        <div className={`${panelBase} flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-sm dark:border-slate-700 dark:bg-slate-950/95`}>
          <div className="flex items-center justify-between border-b border-slate-200 bg-gradient-to-r from-sky-50/80 via-white to-white px-3 py-3 sm:px-4 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setSessionPanelOpen((v) => !v)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-900/30 dark:hover:text-sky-300" title={t('chat.sessions.openPanel')} aria-label={t('chat.sessions.openPanel')}>{sessionPanelOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button>
              <div className="rounded-xl bg-sky-500/10 p-2 text-sky-600 dark:text-sky-300"><Bot size={16} /></div>
              <div>
                <div className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t('chat.title')}</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">{t('chat.modeGateway')}</div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-900/30 dark:hover:text-sky-300" title={t('chat.search', '搜尋會話')} aria-label={t('chat.search')}><Search size={14} /></button>
              <button type="button" className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-900/30 dark:hover:text-sky-300" title={t('chat.config', '覆寫設定')} aria-label={t('chat.config')}><Settings2 size={14} /></button>
              <button type="button" onClick={() => { const newKey = crypto.randomUUID(); setActiveChatSession(newKey); resetChatMessages(); setSessionPanelOpen(false); }} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-sky-900/30 dark:hover:text-sky-300" title={t('chat.sessions.new')} aria-label={t('chat.sessions.new')}><MessageSquarePlus size={16} /></button>
              <button type="button" onClick={() => setChatOpen(false)} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" title={t('chat.close')} aria-label={t('chat.close')}><X size={16} /></button>
            </div>
          </div>
          <div className="flex w-full items-center gap-0 border-b border-slate-200 dark:border-slate-800">
            <div ref={agentPickerRef} className="relative shrink-0">
              <button type="button" onClick={() => setAgentPickerOpen(v => !v)} className={`flex items-center gap-1.5 pl-4 pr-2 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-900/20 ${agentPickerOpen ? 'bg-slate-50 dark:bg-slate-900/20' : ''}`} title={t('chat.switchAgent', '切換 Agent')}><span className="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ backgroundColor: `${currentAgentColor}15`, color: currentAgentColor }}>{chat.activeAgentId}</span><ChevronDown size={9} style={{ color: currentAgentColor }} className={`opacity-60 transition-transform duration-150 ${agentPickerOpen ? 'rotate-180' : ''}`} /></button>
              {agentPickerOpen && (
                <div className="absolute top-full left-0 z-30 mt-1 min-w-[180px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  <div className="border-b border-slate-100 px-3 py-1.5 dark:border-slate-800"><span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{t('chat.selectAgent', 'Agent')}</span></div>
                  {agentOptions.map(agent => {
                    const isActive = agent.id === chat.activeAgentId;
                    const itemColor = agent.color ?? '#94a3b8';
                    return (
                      <button key={agent.id} type="button" onClick={() => void handleSwitchAgent(agent.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] transition-colors hover:bg-slate-50 dark:hover:bg-slate-800" style={{ backgroundColor: isActive ? `${itemColor}15` : undefined }}><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: itemColor }} /><span className="flex-1 truncate font-medium" style={{ color: isActive ? itemColor : undefined }}>{agent.displayName}</span><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${agent.snapshotState === 'active' ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'}`} />{isActive && <Check size={10} style={{ color: itemColor }} className="shrink-0" />}</button>
                    );
                  })}
                </div>
              )}
            </div>
            <button type="button" onClick={() => setSessionPanelOpen((v) => !v)} className={`flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-4 text-left transition-colors ${sessionPanelOpen ? 'bg-sky-50/80 dark:bg-sky-900/20' : 'bg-slate-50/60 hover:bg-sky-50/60 dark:bg-slate-900/40 dark:hover:bg-sky-900/20'}`}><span className="text-[9px] text-slate-300 dark:text-slate-600">›</span><span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500 dark:text-slate-400">{chat.activeSessionKey}</span><MessagesSquare size={10} className={`shrink-0 ${sessionPanelOpen ? 'text-sky-400' : 'text-slate-300 dark:text-slate-600'}`} /></button>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-3 py-3 sm:px-4 dark:bg-slate-950/40">{activeMessages.length === 0 && (<div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"><div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-300"><Bot size={14} /></div><p className="font-semibold text-slate-600 dark:text-slate-200">{t('chat.empty')}</p><p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{t('chat.inputHint')}</p></div>)}<div className="space-y-2">{activeMessages.map((msg) => (<ChatBubble key={msg.id} msg={msg} onButtonClick={(text) => void handleSend(text)} />))}</div></div>
          <div className="border-t border-slate-200 bg-white/90 p-3 dark:border-slate-800 dark:bg-slate-950/85">
            {!running && (
              <div className="mb-2 inline-flex items-center gap-1 rounded-lg border border-rose-300/70 bg-rose-100/70 px-2 py-1 text-[10px] font-bold text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{t('chat.coreRequired')}</div>
            )}
            <div className="flex items-end gap-2">
              <button type="button" className="shrink-0 rounded-xl p-2.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 mb-0.5" title={t('chat.attach', '上傳檔案')} aria-label={t('chat.attach')}><Paperclip size={18} /></button>
              <textarea ref={textareaRef} value={inputValue} onChange={(e) => setInputValue(e.target.value)} placeholder={t('chat.placeholder')} rows={1} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }} className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700 outline-none transition-colors focus:border-sky-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" aria-label={t('chat.placeholder')} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) { e.preventDefault(); void handleSend(); } }} />
              <div className="relative flex-none">
                {!chat.isStreaming ? (
                  <button type="button" onClick={() => void handleSend()} disabled={!inputValue.trim() || !running} className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl bg-sky-600 text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-300" title={!running ? t('chat.coreRequired') : t('chat.send')} aria-label={!running ? t('chat.coreRequired') : t('chat.send')}>
                    <Send size={16} />
                    {queueCount > 0 && (<span className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black text-white">{queueCount}</span>)}
                  </button>
                ) : (
                  <button type="button" onClick={() => handleAbortLocal()} className="relative inline-flex h-11 w-11 items-center justify-center rounded-xl bg-rose-600 text-white transition-colors hover:bg-rose-500" title={t('chat.stop')} aria-label={t('chat.stop')}>
                    <Square size={14} className="fill-current" />
                    {queueCount > 0 && (<span className="absolute -right-1 -top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black text-white">{queueCount}</span>)}
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500">
              <span className="text-[9px] text-slate-300 dark:text-slate-700">{t('chat.commandHint', '/stop 停止 · /new 新對話')}</span>
              <span>{t('chat.inputHint')}</span>
            </div>
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

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 dark:bg-slate-500"
          style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </span>
  );
}

function StreamingIndicator() {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1 w-1 rounded-full bg-slate-400 dark:bg-slate-500"
          style={{ animation: `bounce 1.2s ease-in-out ${i * 0.15}s infinite` }}
        />
      ))}
    </span>
  );
}

function ChatBubble({ msg, onButtonClick }: { msg: ChatMessage; onButtonClick?: (text: string) => void }) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';
  const [copied, setCopied] = useState(false);
  const [spoilerRevealed, setSpoilerRevealed] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const toggleTool = (toolId: string) => {
    setExpandedTools(prev => ({ ...prev, [toolId]: !prev[toolId] }));
  };

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (_) { /* ignore */ }
  }, [msg.content]);

  const parsedPrefix = useMemo(() => isUser ? parseMessageContent(msg.content) : null, [isUser, msg.content]);

  // For assistant messages: extract inline buttons and detect HTML mode
  const { body: bodyWithoutButtons, rows: buttonRows } = useMemo(
    () => (!isUser && !isSystem) ? parseButtonBlocks(msg.content) : { body: msg.content, rows: [] },
    [isUser, isSystem, msg.content]
  );

  const useTgHtml = !isUser && !isSystem && isTgFormatted(bodyWithoutButtons);

  const renderedTgHtml = useMemo(
    () => useTgHtml ? sanitizeTgHtml(bodyWithoutButtons) : '',
    [useTgHtml, bodyWithoutButtons]
  );
  const renderedMd = useMemo(
    () => (!useTgHtml && !isUser && !isSystem) ? renderMarkdown(bodyWithoutButtons) : '',
    [useTgHtml, isUser, isSystem, bodyWithoutButtons]
  );

  // System message
  if (isSystem) {
    return (
      <div className="flex justify-center py-1.5">
        <span className="rounded-full border border-slate-200 bg-slate-100/80 px-4 py-1 text-[10px] font-medium tracking-tight text-slate-500 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
          {msg.content}
        </span>
      </div>
    );
  }

  return (
    <div className={`group flex ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
      <div className={`relative max-w-[92%] rounded-2xl border px-3.5 py-3 text-[13px] leading-relaxed shadow-sm transition-all sm:max-w-[85%] ${
        isUser
          ? 'border-sky-500/50 bg-gradient-to-br from-sky-500 to-sky-600 text-white shadow-sky-500/10'
          : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700/50 dark:bg-slate-900 dark:text-slate-200'
      }`}>

        {/* Status Indicator (Thinking / Tool Use) */}
        {!isUser && (msg.status === 'thinking' || msg.status === 'tool_use') && (!msg.toolCalls || msg.toolCalls.length === 0) && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-50/50 px-2 py-1.5 text-[11px] font-semibold text-sky-600 dark:bg-slate-800/50 dark:text-sky-400">
            <RefreshCw size={12} className="animate-spin" />
            <span>{msg.status === 'thinking' ? 'AI 正在思考中...' : '正在準備執行工具...'}</span>
          </div>
        )}

        {/* Tool Calls Rendering */}
        {!isUser && msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {msg.toolCalls.map(tc => {
              const isExpanded = expandedTools[tc.id];
              const isPending = tc.status === 'pending';
              const isError = tc.status === 'error';
              return (
                <div key={tc.id} className="rounded-xl border border-slate-200/60 bg-slate-50/50 overflow-hidden dark:border-slate-800 dark:bg-slate-950/50">
                  <button 
                    type="button" 
                    onClick={() => toggleTool(tc.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium transition-colors hover:bg-slate-100/50 dark:hover:bg-slate-900/50"
                  >
                    <div className="flex shrink-0 items-center justify-center">
                      {isPending ? <RefreshCw size={12} className="animate-spin text-sky-500" /> 
                       : isError ? <X size={12} className="text-rose-500" />
                       : <Check size={12} className="text-emerald-500" />}
                    </div>
                    <span className="flex-1 truncate text-slate-600 dark:text-slate-300">
                      {isPending ? `正在使用 ${tc.name}...` : isError ? `${tc.name} 執行失敗` : `已使用 ${tc.name}`}
                    </span>
                    <ChevronDown size={12} className={`shrink-0 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-200/60 bg-slate-100/30 p-2.5 dark:border-slate-800 dark:bg-slate-900/30">
                      <div className="space-y-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        {tc.input && (
                          <div>
                            <div className="mb-1 font-bold text-slate-600 dark:text-slate-300">Input:</div>
                            <pre className="whitespace-pre-wrap break-words rounded bg-white/50 p-2 dark:bg-slate-950/50">{typeof tc.input === 'object' ? JSON.stringify(tc.input, null, 2) : String(tc.input)}</pre>
                          </div>
                        )}
                        {tc.output && (
                          <div>
                            <div className="mb-1 font-bold text-slate-600 dark:text-slate-300">Output:</div>
                            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-white/50 p-2 dark:bg-slate-950/50">{typeof tc.output === 'object' ? JSON.stringify(tc.output, null, 2) : String(tc.output)}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Copy button (assistant only, hover reveal) */}
        {!isUser && msg.status !== 'streaming' && msg.content && (
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="absolute -right-1 -top-1 translate-x-1/2 translate-y-1/2 rounded-full border border-slate-200 bg-white p-1.5 text-slate-400 opacity-0 shadow-sm transition-all group-hover:opacity-100 hover:text-sky-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500 dark:hover:text-sky-400"
            title="Copy message"
          >
            {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
          </button>
        )}

        {/* ── Message body ── */}
        {parsedPrefix ? (
          <>
            {/* Source badge row (Telegram/Slack platform prefix) */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-md bg-white/20 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-sm">
                {parsedPrefix.platform}
              </span>
              <span className="text-[11px] font-bold text-sky-50">{parsedPrefix.senderName}</span>
              <span className="text-[9px] opacity-70">{parsedPrefix.timestamp}</span>
            </div>
            <div className="whitespace-pre-wrap break-words">{parsedPrefix.body}</div>
            {parsedPrefix.messageId && (
              <div className="mt-1.5 text-[8px] opacity-40">#{parsedPrefix.messageId}</div>
            )}
          </>
        ) : isUser ? (
          <div className="whitespace-pre-wrap break-words">{msg.content}</div>
        ) : msg.status === 'streaming' && !msg.content ? (
          <TypingDots />
        ) : useTgHtml ? (
          <div
            className={`tg-message-html break-words ${spoilerRevealed ? 'spoilers-revealed' : ''}`}
            dangerouslySetInnerHTML={{ __html: renderedTgHtml }}
            onClick={(e) => {
              if ((e.target as Element).closest('.tg-spoiler')) setSpoilerRevealed(true);
            }}
          />
        ) : (
          <div
            className="prose-chat prose-slate dark:prose-invert max-w-none break-words"
            dangerouslySetInnerHTML={{ __html: renderedMd }}
          />
        )}

        {/* ── Inline keyboard buttons ── */}
        {buttonRows.length > 0 && msg.status !== 'streaming' && (
          <div className="mt-3 flex flex-col gap-1.5">
            {buttonRows.map((row, ri) => (
              <div key={ri} className="flex flex-wrap gap-1.5">
                {row.map((label, bi) => (
                  <button
                    key={bi}
                    type="button"
                    onClick={() => onButtonClick?.(label)}
                    className="flex-1 min-w-[80px] truncate rounded-xl border border-sky-200 bg-sky-50/50 px-3 py-2 text-[11px] font-bold text-sky-700 transition-all hover:border-sky-400 hover:bg-sky-100 active:scale-95 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:border-sky-700"
                    title={label}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── Footer ── */}
        <div className={`mt-2 flex items-center justify-end gap-1.5 text-[9px] font-medium tracking-tight ${isUser ? 'text-sky-100/80' : 'text-slate-400 dark:text-slate-500'}`}>
          <span>{formatTime(msg.createdAt)}</span>
          {msg.status === 'streaming' && msg.content && <StreamingIndicator />}
          {msg.status === 'error' && <span className="font-bold text-rose-500 dark:text-rose-400">⚠️ {msg.error}</span>}
          {msg.status === 'done' && !isUser && <Check size={10} className="text-sky-400/70" />}
        </div>
      </div>
    </div>
  );
}
