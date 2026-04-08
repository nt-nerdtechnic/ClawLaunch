import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Play, Pause, Trash2, RefreshCw,
  AlertTriangle, CheckCircle,
  CalendarClock, Activity, Server, Terminal,
  Pencil, Save, X, Zap, Bell, BellOff, Wrench, MessageSquare,
} from 'lucide-react';
import cronstrue from 'cronstrue/i18n';
import { DeleteConfirmDialog } from '../components/dialogs/DeleteConfirmDialog';
import { ErrorLogDialog } from '../components/dialogs/ErrorLogDialog';
import type { CronSchedule, CronJob } from '../types/cron';
import { useStore } from '../store';
import { ConfigService } from '../services/configService';
import { PROVIDER_MODEL_CATALOGUE } from '../constants/providers';
import { usePixelOfficeAgents } from '../components/pixel-office/hooks/usePixelOfficeAgents';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CrontabEntry {
  schedule: string;
  command: string;
  name: string;
  raw: string;
  enabled?: boolean;
}

interface CalendarInterval {
  Hour?: number;
  Minute?: number;
  Weekday?: number;
  Day?: number;
  Month?: number;
}

interface LaunchAgent {
  label: string;
  name: string;
  plistExists: boolean;
  keepAlive: boolean;
  runAtLoad: boolean;
  comment: string;
  loaded: boolean;
  running: boolean;
  pid: number | null;
  exitCode: number | null;
  scheduleInterval?: number;
  scheduleCalendar?: CalendarInterval[];
}

// Active OpenClaw session
interface ActiveSession {
  key: string;
  kind: string;
  updatedAt: string;
  ageMs: number;
  sessionId: string;
  agentId?: string;
  displayName?: string;
  lastMessage?: string;
  source?: 'memory' | 'index';
  isRunning?: boolean;
  systemSent?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  model?: string;
  contextTokens?: number;
}

interface ControlCenterPageProps {
  onRefreshSnapshot?: () => Promise<void>;
  stateDir?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatInterval(s: CronSchedule, t: TFunction): string {
  if (s.kind === 'cron' && s.expr) return s.expr + (s.tz ? ` · ${s.tz}` : '');
  if (s.kind === 'every' && s.everyMs) {
    const m = s.everyMs / 60000;
    if (m < 1) return t('common.time.every', { val: `${s.everyMs / 1000}s` });
    if (m < 60) return t('common.time.every', { val: `${m.toFixed(0)}m` });
    return t('common.time.every', { val: `${(m / 60).toFixed(0)}h` });
  }
  return '—';
}

function getCronstrueLocale(lang: string): string {
  if (lang.toLowerCase().startsWith('zh-tw')) return 'zh_TW';
  if (lang.toLowerCase().startsWith('zh-cn')) return 'zh_CN';
  return 'en';
}

function describeCron(expr: string, lang: string): string {
  try {
    return cronstrue.toString(expr, { locale: getCronstrueLocale(lang) });
  } catch {
    return '';
  }
}

function relTime(ms: number | undefined, t: TFunction): string {
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 0) return t('common.time.soon');
  if (d < 60000) return t('common.time.ago', { val: `${Math.floor(d / 1000)}s` });
  if (d < 3600000) return t('common.time.ago', { val: `${Math.floor(d / 60000)}m` });
  if (d < 86400000) return t('common.time.ago', { val: `${Math.floor(d / 3600000)}h` });
  return t('common.time.ago', { val: `${Math.floor(d / 86400000)}d` });
}

function formatActiveSessionTitle(session: ActiveSession): string {
  const displayName = String(session.displayName || '').trim();
  const lastMessage = String(session.lastMessage || '').trim();
  const sessionKey = String(session.key || '').trim();

  const parseCron = (text: string): { name: string; shortId: string } | null => {
    const m = text.match(/\[cron:([0-9a-f-]{8,})\s+([^\]]+)\]/i);
    if (!m) return null;
    const rawId = String(m[1] || '').trim();
    const name = String(m[2] || '').trim();
    if (!rawId || !name) return null;
    const shortId = rawId.replace(/-/g, '').slice(0, 8);
    return { name, shortId };
  };

  const parsed = parseCron(lastMessage) || parseCron(displayName) || parseCron(sessionKey);
  if (parsed) return `${parsed.name}(Cron-${parsed.shortId})`;

  if (displayName && !/^cron\s+[0-9a-f]{6,}$/i.test(displayName)) return displayName;
  return String(session.sessionId || session.key || '—');
}

function nextTime(ms: number | undefined, t: TFunction): string {
  if (!ms) return '—';
  const d = ms - Date.now();
  if (d <= 0) return t('common.time.pending');
  if (d < 60000) return t('common.time.later', { val: `${Math.floor(d / 1000)}s` });
  if (d < 3600000) return t('common.time.later', { val: `${Math.floor(d / 60000)}m` });
  if (d < 86400000) return t('common.time.later', { val: `${Math.floor(d / 3600000)}h` });
  return t('common.time.later', { val: `${Math.floor(d / 86400000)}d` });
}

function nextCalendarRun(calendars: CalendarInterval[]): number | undefined {
  const now = new Date();
  for (let off = 1; off <= 7 * 24 * 60; off++) {
    const c = new Date(now.getTime() + off * 60_000);
    for (const cal of calendars) {
      if (
        (cal.Month   === undefined || cal.Month   === c.getMonth() + 1) &&
        (cal.Day     === undefined || cal.Day     === c.getDate()) &&
        (cal.Weekday === undefined || cal.Weekday === c.getDay()) &&
        (cal.Hour    === undefined || cal.Hour    === c.getHours()) &&
        (cal.Minute  === undefined || cal.Minute  === c.getMinutes())
      ) return c.getTime();
    }
  }
  return undefined;
}

function formatLaunchAgentSchedule(
  agent: LaunchAgent,
  t: TFunction,
  lang: string,
): { main: string; next?: string } | null {
  if (agent.scheduleInterval !== undefined) {
    const sec = agent.scheduleInterval;
    const m = sec / 60;
    const val = m < 1 ? `${sec}s` : m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 60)}h`;
    return { main: t('common.time.every', { val }) };
  }
  if (agent.scheduleCalendar && agent.scheduleCalendar.length > 0) {
    const cal = agent.scheduleCalendar[0];
    const parts: string[] = [];
    const isChinese = lang.toLowerCase().startsWith('zh');
    if (isChinese) {
      const days = ['日', '一', '二', '三', '四', '五', '六'];
      if (cal.Month !== undefined) parts.push(`${cal.Month}月`);
      if (cal.Weekday !== undefined) parts.push(`週${days[cal.Weekday] ?? cal.Weekday}`);
      if (cal.Day !== undefined && cal.Month === undefined) parts.push(`${cal.Day}日`);
    } else {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      if (cal.Month !== undefined) parts.push(`Mo${cal.Month}`);
      if (cal.Weekday !== undefined) parts.push(days[cal.Weekday] ?? `D${cal.Weekday}`);
      if (cal.Day !== undefined && cal.Month === undefined) parts.push(`D${cal.Day}`);
    }
    const hh = cal.Hour    !== undefined ? String(cal.Hour).padStart(2, '0')   : '**';
    const mm = cal.Minute  !== undefined ? String(cal.Minute).padStart(2, '0') : '00';
    if (cal.Hour !== undefined || cal.Minute !== undefined) parts.push(`${hh}:${mm}`);
    const nextMs = nextCalendarRun(agent.scheduleCalendar);
    return { main: parts.join(' ') || '—', next: nextMs ? nextTime(nextMs, t) : undefined };
  }
  if (agent.keepAlive) {
    const label = lang.toLowerCase().startsWith('zh') ? '常駐服務' : 'Keep-Alive';
    return { main: label };
  }
  if (agent.runAtLoad) {
    const label = lang.toLowerCase().startsWith('zh') ? '啟動時執行' : 'Run at load';
    return { main: label };
  }
  return null;
}

// ── Channel metadata (mirrors RuntimeSettingsPage) ──────────────────────────
const CHANNEL_META: { id: string; name: string }[] = [
  { id: 'telegram',   name: 'Telegram'    },
  { id: 'discord',    name: 'Discord'     },
  { id: 'slack',      name: 'Slack'       },
  { id: 'googlechat', name: 'Google Chat' },
  { id: 'line',       name: 'LINE'        },
  { id: 'whatsapp',   name: 'WhatsApp'    },
  { id: 'signal',     name: 'Signal'      },
  { id: 'imessage',   name: 'iMessage'    },
  { id: 'irc',        name: 'IRC'         },
];

const SkeletonItem: React.FC<{ className?: string }> = ({ className = 'h-12' }) => (
  <div className={`w-full rounded-xl bg-slate-100/50 dark:bg-slate-800/30 animate-pulse border border-slate-50 dark:border-slate-800/50 ${className}`} />
);

export const ControlCenterPage: React.FC<ControlCenterPageProps> = ({ onRefreshSnapshot, stateDir }) => {
  const { t, i18n } = useTranslation();
  const runtimeProfile = useStore(s => s.runtimeProfile);
  const config = useStore(s => s.config);
  const [cronJobs, setCronJobs]       = useState<CronJob[]>([]);
  const [authorizedRecipients, setAuthorizedRecipients] = useState<Record<string, string[]>>({}); // channel -> IDs
  const [crontabEntries, setCrontabEntries] = useState<CrontabEntry[]>([]);
  const [launchAgents, setLaunchAgents]     = useState<LaunchAgent[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [cronLoading, setCronLoading] = useState(false);
  const [systemLoading, setSystemLoading] = useState(false);
  const [sessionScanLoading, setSessionScanLoading] = useState(false);
  const [lastSessionsScanned, setLastSessionsScanned] = useState<Date | null>(null);
  const [lastCronScanned, setLastCronScanned] = useState<Date | null>(null);
  const [lastSystemScanned, setLastSystemScanned] = useState<Date | null>(null);
  const [abortingSessionKeys, setAbortingSessionKeys] = useState<Set<string>>(new Set());
  const [triggeringJobIds, setTriggeringJobIds] = useState<Set<string>>(new Set());
  const [fixingJobIds, setFixingJobIds] = useState<Set<string>>(new Set());
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError]             = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ name: string; onConfirm: () => void } | null>(null);
  const [activeSessionFilter, setActiveSessionFilter] = useState<'all' | 'running' | 'stopped'>('running');
  const [agentFilter, setAgentFilter] = useState<'all' | 'running' | 'stopped'>('running');
  const [ctFilter, setCtFilter]       = useState<'all' | 'enabled' | 'disabled'>('enabled');
  const [cjFilter, setCjFilter]       = useState<'all' | 'enabled' | 'disabled'>('enabled');
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; agentId: string; model: string; scheduleKind: 'every' | 'cron'; intervalMin: number; cronFreq: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'; cronMinute: number; cronHour: number; cronDow: number; cronDom: number; cronExpr: string; timeoutMin: number | ''; deliveryMode: string; deliveryChannel: string; deliveryTo: string; payloadMessage: string } | null>(null);
  const [logErrorJob, setLogErrorJob] = useState<CronJob | null>(null);
  const [fetchedLog, setFetchedLog] = useState<string | null>(null);
  const [isFetchingLog, setIsFetchingLog] = useState(false);

  // Chat actions
  const setChatOpen = useStore(s => s.setChatOpen);
  const setActiveChatAgent = useStore(s => s.setActiveChatAgent);
  const setActiveChatSession = useStore(s => s.setActiveChatSession);
  const addChatMessage = useStore(s => s.addChatMessage);

  const { summaries: allAgents } = usePixelOfficeAgents();

  const openChatToFix = (job: CronJob) => {
    if (!job) return;
    
    // 1. 切換 Agent
    setActiveChatAgent(job.agentId || 'main');
    
    // 2. 設定會話 Key (與 cron 系列一致)
    const sessionKey = `agent:${job.agentId || 'main'}:cron:${job.id}`;
    setActiveChatSession(sessionKey);
    
    // 3. 打開對話框
    setChatOpen(true);
    
    // 4. 發送診斷 Prompt
    const prompt = `【任務故障診斷】\n任務名稱：${job.name}\n任務 ID：${job.id}\n錯誤內容：\n"""\n${job.state?.lastError || '未知錯誤'}\n"""\n\n這項排程任務執行失敗了。請幫我分析以上錯誤原因，並提供具體的修復建議。如果是配置問題，請告訴我該如何調整；如果是環境問題，請指導我排除。`;
    
    addChatMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      sessionKey,
      agentId: job.agentId || 'main',
      createdAt: Date.now(),
    });
  };

  const openChatToSession = (session: ActiveSession) => {
    const agentId = session.agentId || 'main';
    const sessionKey = String(session.key || session.sessionId || '').trim() || `agent:${agentId}`;
    setActiveChatAgent(agentId);
    setActiveChatSession(sessionKey);
    setChatOpen(true);
  };

  // 從 runtimeProfile 偵測已綁定 bot token 的頻道
  const configuredBotChannels = useMemo(() => {
    const channels = (runtimeProfile?.channels || {}) as Record<string, Record<string, unknown>>;
    return CHANNEL_META.filter(ch => {
      if (ch.id === 'telegram') return !!String(runtimeProfile?.botToken || '').trim();
      return !!String(channels?.[ch.id]?.botToken || '').trim();
    }).map(ch => {
      const rawToken = ch.id === 'telegram'
        ? String(runtimeProfile?.botToken || '').trim()
        : String(channels?.[ch.id]?.botToken || '').trim();
      const preview = rawToken.length > 8 ? `${rawToken.slice(0, 4)}••••${rawToken.slice(-4)}` : '••••';
      return { ...ch, preview };
    });
  }, [runtimeProfile]);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const execCmd = useCallback(async (cmd: string) => {
    const res = await window.electronAPI.exec(cmd);
    if ((res.code ?? res.exitCode) !== 0) throw new Error(res.stderr || 'command failed');
    return res;
  }, []);

  // ── Authorized Recipients ─────────────────────────────────────────────────

  const loadAuthorizedRecipients = useCallback(async () => {
    if (!window.electronAPI) return;
    const resolvedConfigDir = ConfigService.normalizeConfigDir(config.configPath);
    if (!resolvedConfigDir) return;
    try {
      const telegramAllowFromFile = `${resolvedConfigDir}/credentials/telegram-allowFrom.json`;
      const res = await window.electronAPI.exec(`test -f ${ConfigService.shellQuote(telegramAllowFromFile)} && cat ${ConfigService.shellQuote(telegramAllowFromFile)}`);
      if (res.code === 0 && res.stdout) {
        const parsed = JSON.parse(res.stdout);
        const ids = Array.isArray(parsed?.allowFrom) ? parsed.allowFrom.map((v: any) => String(v)) : [];
        setAuthorizedRecipients(prev => ({ ...prev, telegram: ids }));
      }
    } catch {
      // ignore
    }
  }, [config.configPath]);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadCron = useCallback(async () => {
    try {
      const cmd = stateDir ? `cron:list ${JSON.stringify({ stateDir })}` : 'cron:list';
      const res = await window.electronAPI.exec(cmd);
      setCronJobs(JSON.parse(res.stdout || '{}').jobs || []);
      setLastCronScanned(new Date());
    } catch { setCronJobs([]); }
  }, [stateDir]);

  const loadSystem = useCallback(async () => {
    try {
      const [ctRes, laRes] = await Promise.all([
        window.electronAPI.exec('system:crontab:list'),
        window.electronAPI.exec('system:launchagents:list'),
      ]);
      console.log('[ControlCenter] loadSystem agents:', laRes.stdout);
      const ctData = JSON.parse(ctRes.stdout || '{}');
      const laData = JSON.parse(laRes.stdout || '{}');
      const ctEntries = ctData.entries || [];
      const laAgents = laData.agents || [];

      console.log(`[ControlCenter] loadSystem parsed ct:${ctEntries.length}, la:${laAgents.length}`);
      setCrontabEntries(ctEntries);
      setLaunchAgents(laAgents);
      setLastSystemScanned(new Date());
    } catch (e) {
      console.error('[ControlCenter] loadSystem failed:', e);
    }
  }, []);

  const loadActiveSessions = useCallback(async () => {
    try {
      setSessionScanLoading(true);
      console.log('[ControlCenter] Scanning active sessions...');
      const res = await window.electronAPI.scanActiveSessions({ activeMinutes: 15 });
      console.log('[ControlCenter] scanActiveSessions response:', res);
      if (res.code !== 0) {
        console.warn('[ControlCenter] scanActiveSessions error code:', res.code, 'stderr:', res.stderr);
        throw new Error(res.stderr || 'scan active sessions failed');
      }
      const parsed = JSON.parse(res.stdout || '{}');
      const rawSessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      const dedup = new Map<string, ActiveSession>();
      for (const raw of rawSessions) {
        const s = raw as ActiveSession;
        const normKey = String(s.key || '').trim();
        const normSessionId = String(s.sessionId || '').trim();
        const dedupKey = normKey || normSessionId;
        if (!dedupKey) continue;
        const existing = dedup.get(dedupKey);
        if (!existing || (existing.ageMs ?? Number.MAX_SAFE_INTEGER) > (s.ageMs ?? Number.MAX_SAFE_INTEGER)) {
          dedup.set(dedupKey, s);
        }
      }

      // Secondary dedup: collapse visually identical cards from mixed sources.
      const byFingerprint = new Map<string, ActiveSession>();
      for (const s of dedup.values()) {
        const fingerprint = [
          String(s.displayName || '').trim(),
          String(s.lastMessage || '').trim(),
          String(s.agentId || s.model || '').trim(),
          String(s.kind || '').trim(),
        ].join('|');
        if (!fingerprint.replace(/\|/g, '')) {
          byFingerprint.set(`${String(s.key || '').trim()}|${String(s.sessionId || '').trim()}`, s);
          continue;
        }
        const existing = byFingerprint.get(fingerprint);
        if (!existing || (existing.ageMs ?? Number.MAX_SAFE_INTEGER) > (s.ageMs ?? Number.MAX_SAFE_INTEGER)) {
          byFingerprint.set(fingerprint, s);
        }
      }
      const sessions = Array.from(byFingerprint.values());
      console.log('[ControlCenter] loadActiveSessions parsed:', parsed);
      console.log('[ControlCenter] loadActiveSessions got', sessions.length, 'sessions:', sessions);
      setActiveSessions(sessions);
      setLastSessionsScanned(new Date());
    } catch (e) {
      console.error('[ControlCenter] loadActiveSessions failed:', e);
      setActiveSessions([]);
    } finally {
      setSessionScanLoading(false);
    }
  }, []);

  const abortSession = useCallback(async (sessionKey: string, agentId?: string) => {
    const normalizedSessionKey = String(sessionKey || '').trim();
    if (!normalizedSessionKey) {
      setError(t('controlCenter.activeSessions.abortMissingKey', '找不到可中止的工作識別碼'));
      return;
    }
    try {
      setError('');
      setAbortingSessionKeys((prev) => {
        const next = new Set(prev);
        next.add(normalizedSessionKey);
        return next;
      });
      const res = await window.electronAPI.abortSession({ sessionKey: normalizedSessionKey, agentId });
      if (!res.success) {
        setError(res.error || 'abort session failed');
        return;
      }
      console.log('[ControlCenter] abortSession success for', normalizedSessionKey);
      await loadActiveSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'abort session failed');
    } finally {
      setAbortingSessionKeys((prev) => {
        const next = new Set(prev);
        next.delete(normalizedSessionKey);
        return next;
      });
    }
  }, [loadActiveSessions, t]);

  const abortAllRunningSessions = useCallback(async () => {
    const targets = activeSessions.filter(s => s.isRunning === true && (s.key || s.sessionId));
    for (const s of targets) {
      const key = String(s.key || s.sessionId || '').trim();
      if (key) await abortSession(key, s.agentId);
    }
  }, [activeSessions, abortSession]);

  const refresh = useCallback(async () => {
    setError('');
    try {
      await Promise.all([loadCron(), loadSystem(), loadAuthorizedRecipients()]);
      if (onRefreshSnapshot) await onRefreshSnapshot();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('controlCenter.errors.genericLoadFailed'));
    }
  }, [loadCron, loadSystem, loadAuthorizedRecipients, onRefreshSnapshot, t]);

  useEffect(() => {
    const init = async () => {
      setInitialLoading(true);
      try {
        await Promise.all([refresh(), loadActiveSessions()]);
      } finally {
        setInitialLoading(false);
      }
    };
    init();
  }, [refresh, loadActiveSessions]);

  useEffect(() => {
    const id = setInterval(() => void Promise.all([loadCron(), loadSystem()]), 30000);
    return () => clearInterval(id);
  }, [loadCron, loadSystem]);

  useEffect(() => {
    const id = setInterval(() => void loadActiveSessions(), 5000);
    return () => clearInterval(id);
  }, [loadActiveSessions]);

  // ── Cron actions ───────────────────────────────────────────────────────────

  const toggleCron = async (jobId: string) => {
    try {
      setError('');
      await execCmd(`cron:toggle ${JSON.stringify({ jobId, stateDir })}`);
      await loadCron();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Toggle cron job failed');
    }
  };

  const triggerCron = async (jobId: string) => {
    try {
      setError('');
      setTriggeringJobIds((prev) => { const next = new Set(prev); next.add(jobId); return next; });
      // Fire-and-forget: cron:trigger spins up the job in background, no need to await completion.
      window.electronAPI.exec(`cron:trigger ${JSON.stringify({ jobId, stateDir, fireAndForget: true })}`);
      // Brief visual feedback then remove spinner
      await new Promise(r => setTimeout(r, 800));
      await loadCron();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Trigger cron job failed');
    } finally {
      setTriggeringJobIds((prev) => { const next = new Set(prev); next.delete(jobId); return next; });
    }
  };

  // One-click auto-fix: resets OpenClaw cron error state then fires `openclaw cron run` natively.
  const fixAndRetry = async (jobId: string) => {
    try {
      setError('');
      setFixingJobIds((prev) => { const next = new Set(prev); next.add(jobId); return next; });
      setTriggeringJobIds((prev) => { const next = new Set(prev); next.add(jobId); return next; });
      // Step 1: Clear consecutiveErrors / lastError in jobs.json (OpenClaw's own cron state file)
      await execCmd(`cron:reset-errors ${JSON.stringify({ jobId, stateDir })}`);
      // Step 2: Fire `openclaw cron run <jobId>` natively in background
      window.electronAPI.exec(`cron:trigger ${JSON.stringify({ jobId, stateDir, fireAndForget: true })}`);
      // Brief visual feedback then remove spinner
      await new Promise(r => setTimeout(r, 1200));
      await loadCron();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fix and retry failed');
    } finally {
      setFixingJobIds((prev) => { const next = new Set(prev); next.delete(jobId); return next; });
      setTriggeringJobIds((prev) => { const next = new Set(prev); next.delete(jobId); return next; });
    }
  };

  const openErrorLog = async (job: CronJob) => {
    setLogErrorJob(job);
    setFetchedLog(null);
    if (!job.state?.lastError) {
      setIsFetchingLog(true);
      try {
        const res = await window.electronAPI.exec(`cron:get-last-session-log ${JSON.stringify({ jobId: job.id, agentId: job.agentId || 'main', stateDir })}`);
        if (res.code === 0) {
          const data = JSON.parse(res.stdout || '{}');
          setFetchedLog(data.log || null);
        }
      } catch (e) {
        console.error('Failed to fetch session log:', e);
      } finally {
        setIsFetchingLog(false);
      }
    }
  };

  const deleteCron = async (jobId: string) => {
    try {
      setError('');
      await execCmd(`cron:delete ${JSON.stringify({ jobId, stateDir })}`);
      await loadCron();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete cron job failed');
    }
  };

  const updateCron = async (jobId: string, updates: { name?: string; agentId?: string; model?: string; everyMs?: number; scheduleExpr?: string; timeoutSeconds?: number; delivery?: { mode: string; channel?: string; to?: string }; payloadMessage?: string }) => {
    try {
      setError('');
      await execCmd(`cron:update ${JSON.stringify({ jobId, stateDir, ...updates })}`);
      setEditingJobId(null);
      setEditDraft(null);
      await loadCron();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Update cron job failed');
    }
  };

  const toggleDelivery = async (job: CronJob) => {
    const currentMode = job.delivery?.mode || 'none';
    const newMode = currentMode === 'announce' ? 'none' : 'announce';
    await updateCron(job.id, {
      delivery: { ...job.delivery, mode: newMode },
    });
  };

  const parseCronExpr = (expr: string): { freq: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'; minute: number; hour: number; dow: number; dom: number } => {
    const parts = expr.trim().split(/\s+/);
    const isNum = (s: string) => /^\d+$/.test(s);
    const def = { minute: 0, hour: 0, dow: 0, dom: 1 };
    if (parts.length !== 5) return { freq: 'custom', ...def };
    const [min, hr, dom, mon, dow] = parts;
    if (isNum(min) && hr === '*' && dom === '*' && mon === '*' && dow === '*')
      return { freq: 'hourly', minute: +min, hour: 0, dow: 0, dom: 1 };
    if (isNum(min) && isNum(hr) && dom === '*' && mon === '*' && dow === '*')
      return { freq: 'daily', minute: +min, hour: +hr, dow: 0, dom: 1 };
    if (isNum(min) && isNum(hr) && dom === '*' && mon === '*' && isNum(dow))
      return { freq: 'weekly', minute: +min, hour: +hr, dow: +dow, dom: 1 };
    if (isNum(min) && isNum(hr) && isNum(dom) && mon === '*' && dow === '*')
      return { freq: 'monthly', minute: +min, hour: +hr, dow: 0, dom: +dom };
    return { freq: 'custom', ...def };
  };

  type EditDraftType = NonNullable<typeof editDraft>;
  const buildCronExpr = (d: EditDraftType): string => {
    switch (d.cronFreq) {
      case 'hourly':  return `${d.cronMinute} * * * *`;
      case 'daily':   return `${d.cronMinute} ${d.cronHour} * * *`;
      case 'weekly':  return `${d.cronMinute} ${d.cronHour} * * ${d.cronDow}`;
      case 'monthly': return `${d.cronMinute} ${d.cronHour} ${d.cronDom} * *`;
      default:        return d.cronExpr;
    }
  };

  const startEditCron = (job: CronJob) => {
    const scheduleKind: 'every' | 'cron' = job.schedule?.kind === 'cron' ? 'cron' : 'every';
    const rawExpr = job.schedule?.expr || '';
    const { freq, minute, hour, dow, dom } = parseCronExpr(rawExpr);
    const intervalMin = job.schedule?.everyMs ? Math.round(job.schedule.everyMs / 60000) : 10;
    const timeoutMin = job.payload?.timeoutSeconds ? Math.round(job.payload.timeoutSeconds / 60) : '';
    const existingTo = job.delivery?.to || '';
    setEditDraft({
      name: job.name,
      agentId: job.agentId || 'main',
      model: job.payload?.model || '',
      scheduleKind,
      intervalMin,
      cronFreq: freq,
      cronMinute: minute,
      cronHour: hour,
      cronDow: dow,
      cronDom: dom,
      cronExpr: freq === 'custom' ? rawExpr : '',
      timeoutMin,
      deliveryMode: job.delivery?.mode || 'none',
      deliveryChannel: job.delivery?.channel || '',
      deliveryTo: existingTo,
      payloadMessage: job.payload?.message || '',
    });
    setEditingJobId(job.id);
  };

  const toggleCrontab = async (raw: string) => {
    try {
      setError('');
      await execCmd(`system:crontab:toggle ${JSON.stringify({ raw })}`);
      await loadSystem();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Toggle crontab failed');
    }
  };

  const deleteCrontab = async (raw: string) => {
    try {
      setError('');
      await execCmd(`system:crontab:delete ${JSON.stringify({ raw })}`);
      await loadSystem();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete crontab failed');
    }
  };

  const toggleLaunchAgent = async (label: string) => {
    try {
      setError('');
      await execCmd(`system:launchagents:toggle ${JSON.stringify({ label })}`);
      await loadSystem();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Toggle LaunchAgent failed');
    }
  };

  const deleteLaunchAgent = async (label: string) => {
    try {
      setError('');
      await execCmd(`system:launchagents:delete ${JSON.stringify({ label })}`);
      await loadSystem();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete LaunchAgent failed');
    }
  };

  const deleteAllStoppedAgents = async () => {
    const targets = launchAgents.filter(a => !a.running && !a.loaded);
    for (const agent of targets) await deleteLaunchAgent(agent.label);
  };

  const startAllUnloadedAgents = async () => {
    const targets = launchAgents.filter(a => !a.loaded);
    for (const agent of targets) await toggleLaunchAgent(agent.label);
  };

  const stopAllLoadedAgents = async () => {
    const targets = launchAgents.filter(a => a.loaded);
    for (const agent of targets) await toggleLaunchAgent(agent.label);
  };

  const deleteAllDisabledCrontab = async () => {
    const targets = crontabEntries.filter(e => e.enabled === false);
    for (const entry of targets) await deleteCrontab(entry.raw);
  };

  const enableAllDisabledCrontab = async () => {
    const targets = crontabEntries.filter(e => e.enabled === false);
    for (const entry of targets) await toggleCrontab(entry.raw);
  };

  const disableAllEnabledCrontab = async () => {
    const targets = crontabEntries.filter(e => e.enabled !== false);
    for (const entry of targets) await toggleCrontab(entry.raw);
  };

  const deleteAllDisabledCronJobs = async () => {
    const targets = cronJobs.filter(j => !j.enabled);
    for (const job of targets) await deleteCron(job.id);
  };

  const enableAllDisabledCronJobs = async () => {
    const targets = cronJobs.filter(j => !j.enabled);
    for (const job of targets) await toggleCron(job.id);
  };

  const disableAllEnabledCronJobs = async () => {
    const targets = cronJobs.filter(j => j.enabled);
    for (const job of targets) await toggleCron(job.id);
  };

  // ── KPI ────────────────────────────────────────────────────────────────────

  const kpi = useMemo(() => {
    const cronJobsArray = cronJobs || [];
    const totalCrons = cronJobsArray.length;
    const activeCrons = cronJobsArray.filter(j => j.enabled).length;

    const launchAgentsArray = launchAgents || [];
    const totalAgents = launchAgentsArray.length;
    const runningAgents = launchAgentsArray.filter(a => a.running || a.loaded).length;

    const activeSessionsArray = activeSessions || [];
    const totalSessions = activeSessionsArray.length;
    const runningSessions = activeSessionsArray.filter(s => s.isRunning === true).length;

    const crontabArray = crontabEntries || [];
    const totalCrontab = crontabArray.length;
    const enabledCrontab = crontabArray.filter(e => e.enabled !== false).length;

    return {
      activeSessions: { running: runningSessions, total: totalSessions },
      systemServices: { running: runningAgents, total: totalAgents },
      crontabEntries: { enabled: enabledCrontab, total: totalCrontab },
      cronSchedules: { active: activeCrons, total: totalCrons },
    };
  }, [activeSessions, cronJobs, launchAgents, crontabEntries]);

  const filteredActiveSessions = useMemo(() => {
    if (activeSessionFilter === 'all') return activeSessions;
    if (activeSessionFilter === 'running') return activeSessions.filter((session) => session.isRunning === true);
    return activeSessions.filter((session) => session.isRunning !== true);
  }, [activeSessionFilter, activeSessions]);

  const filteredLaunchAgents = useMemo(() => {
    if (agentFilter === 'running') return launchAgents.filter(a => a.running || a.loaded);
    if (agentFilter === 'stopped') return launchAgents.filter(a => !a.running && !a.loaded);
    return launchAgents;
  }, [agentFilter, launchAgents]);

  const filteredCrontabEntries = useMemo(() => {
    if (ctFilter === 'enabled') return crontabEntries.filter(e => e.enabled !== false);
    if (ctFilter === 'disabled') return crontabEntries.filter(e => e.enabled === false);
    return crontabEntries;
  }, [ctFilter, crontabEntries]);

  const filteredCronJobs = useMemo(() => {
    if (cjFilter === 'enabled') return cronJobs.filter(j => j.enabled);
    if (cjFilter === 'disabled') return cronJobs.filter(j => !j.enabled);
    return cronJobs;
  }, [cjFilter, cronJobs]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        {[
          {
            label: t('controlCenter.kpi.activeSessions', '執行中工作'),
            active: kpi.activeSessions.running,
            total: kpi.activeSessions.total,
            color: 'text-indigo-600 dark:text-indigo-400',
            targetId: 'active-sessions-section'
          },
          {
            label: t('controlCenter.kpi.cronSchedules', '應用排程'),
            active: kpi.cronSchedules.active,
            total: kpi.cronSchedules.total,
            color: 'text-violet-600 dark:text-violet-400',
            targetId: 'application-scheduling-section'
          },
          {
            label: t('controlCenter.kpi.crontabEntries', '系統排程'),
            active: kpi.crontabEntries.enabled,
            total: kpi.crontabEntries.total,
            color: 'text-amber-600 dark:text-amber-400',
            targetId: 'system-crontab-section'
          },
          {
            label: t('controlCenter.kpi.systemServices', '系統服務'),
            active: kpi.systemServices.running,
            total: kpi.systemServices.total,
            color: kpi.systemServices.running < kpi.systemServices.total ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400',
            targetId: 'system-services-section'
          },
        ].map(({ label, active, total, color, targetId }) => (
          <button
            key={label}
            onClick={() => scrollToSection(targetId)}
            className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[22px] p-4 shadow-sm text-center transition-all hover:scale-[1.02] hover:shadow-md hover:bg-white dark:hover:bg-slate-800/40 group active:scale-95"
          >
            <div className={`text-2xl font-black ${initialLoading ? 'animate-pulse opacity-40 text-slate-400' : color} group-hover:drop-shadow-[0_0_8px_rgba(99,102,241,0.3)] transition-all flex items-baseline justify-center gap-1.5`}>
              <span>{initialLoading ? '—' : active}</span>
              <span className="text-sm opacity-40">/</span>
              <span className="text-sm opacity-60 font-bold">{initialLoading ? '—' : total}</span>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5 tracking-wide group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors uppercase font-bold">{label}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* ── Active OpenClaw Sessions ── full width, pinned to bottom ── */}
        <div id="active-sessions-section" className="xl:col-span-3 order-1 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
          <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(99,102,241,0.5),transparent)' }} />
          <div className="p-6 space-y-3">

            {/* Title */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity size={13} className="text-indigo-500" />
                <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-900 dark:text-slate-100">{t('controlCenter.activeSessions.title', '執行中工作')}</h3>
                <span className="text-[10px] text-slate-400">{t('controlCenter.timeline.count', { count: filteredActiveSessions.length })}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  {(['all', 'running', 'stopped'] as const).map((f) => {
                    const isActive = activeSessionFilter === f;
                    const Icon = f === 'all' ? Activity : f === 'running' ? Play : Pause;
                    const label = f === 'all'
                      ? t('controlCenter.timeline.tabs.all')
                      : f === 'running'
                        ? t('controlCenter.services.filterRunning')
                        : t('controlCenter.services.filterStopped');
                    return (
                      <button
                        key={f}
                        onClick={() => setActiveSessionFilter(f)}
                        title={label}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold transition-all border ${isActive ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'}`}
                      >
                        <Icon size={8} />
                        {label}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => void loadActiveSessions()}
                  title={lastSessionsScanned ? `${t('controlCenter.actions.refresh')} · 上次掃描: ${lastSessionsScanned.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : t('controlCenter.actions.refresh')}
                  className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all"
                >
                  <RefreshCw size={10} className={sessionScanLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Sessions list */}
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-0.5">
              {initialLoading ? (
                Array.from({ length: 3 }).map((_, i) => <SkeletonItem key={i} className="h-16" />)
              ) : filteredActiveSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Activity size={28} className="mb-2 opacity-25" />
                  <span className="text-sm">
                    {activeSessionFilter === 'running'
                      ? t('controlCenter.activeSessions.emptyRunning', '目前沒有執行中的工作')
                      : activeSessionFilter === 'stopped'
                        ? t('controlCenter.activeSessions.emptyStopped', '目前沒有已停止的工作')
                      : t('controlCenter.activeSessions.empty', '無執行中工作')}
                  </span>
                </div>
              ) : filteredActiveSessions.map((session, i) => {
                const isRecent = session.ageMs < 30000; // Recent if < 30s
                const isRunning = session.isRunning === true;
                const effectiveSessionKey = String(session.key || session.sessionId || '').trim();
                const isAborting = effectiveSessionKey ? abortingSessionKeys.has(effectiveSessionKey) : false;
                const canAbort = !!effectiveSessionKey && (isRunning || session.source === 'memory');
                return (
                  <div
                    key={`session-${session.key}-${i}`}
                    className={`rounded-2xl border px-3.5 py-2.5 transition-all ${
                      isRunning || isRecent
                        ? 'border-violet-200 dark:border-violet-800/40 bg-violet-50/30 dark:bg-violet-950/10'
                        : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Session icon with pulse indicator */}
                      <div className={`shrink-0 w-5 h-5 rounded-lg flex items-center justify-center ${
                        isRunning || isRecent
                          ? 'bg-violet-100 dark:bg-violet-900/40'
                          : 'bg-slate-100 dark:bg-slate-800/40'
                      }`}>
                        {(isRunning || isRecent) && <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />}
                        {!(isRunning || isRecent) && <Activity size={10} className="text-slate-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="block text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                          {formatActiveSessionTitle(session)}
                        </span>
                        {session.lastMessage ? (
                          <span className="block text-[10px] text-slate-500 truncate">{session.lastMessage}</span>
                        ) : session.agentId ? (
                          <span className="block text-[10px] text-slate-400 truncate">agent: {session.agentId}</span>
                        ) : session.model ? (
                          <span className="block text-[10px] text-slate-400">{session.model}</span>
                        ) : null}
                        {session.agentId && (
                          <span className="block text-[10px] text-slate-400/80">{session.agentId}</span>
                        )}
                      </div>
                      <button
                        onClick={() => openChatToSession(session)}
                        title={t('controlCenter.activeSessions.openChat', '開啟對話')}
                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400 transition-all active:scale-95"
                      >
                        <MessageSquare size={12} />
                      </button>
                      {canAbort ? (
                        <button
                          onClick={() => void abortSession(effectiveSessionKey, session.agentId)}
                          title={t('controlCenter.actions.abort', '停止')}
                          disabled={isAborting}
                          className="shrink-0 px-2 py-1 text-[10px] font-bold rounded-lg bg-rose-100 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-600 hover:text-white transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {isAborting ? t('controlCenter.actions.stopping', '停止中') : t('controlCenter.actions.abort', '停止')}
                        </button>
                      ) : (
                        <span className="shrink-0 px-2 py-1 text-[10px] font-bold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400">
                          {t('controlCenter.activeSessions.notAbortable', '已停止')}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 pl-7 text-[10px] flex-wrap">
                      <span className={`flex items-center gap-0.5 font-medium ${isRunning ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                        <Activity size={9} className={isRunning ? 'animate-pulse text-emerald-500' : 'text-slate-400'} />
                        {isRunning ? t('common.status.exec', '執行') : t('controlCenter.activeSessions.recentActivity', '近期活動')}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="text-slate-500 tabular-nums">
                        {(session.ageMs / 1000).toFixed(1)}s ago
                      </span>
                      {session.totalTokens !== undefined && (
                        <>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-slate-400 font-mono">
                            {session.totalTokens} tokens
                          </span>
                        </>
                      )}
                      {session.kind && (
                        <>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-indigo-400/80 font-mono text-[9px]">{session.kind}</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Bulk actions */}
            {(() => {
              const runningSessions = filteredActiveSessions.filter(s => s.isRunning === true);
              if (runningSessions.length === 0) return null;
              return (
                <div className="flex justify-end items-center gap-1.5 pt-1">
                  <button
                    onClick={() => void abortAllRunningSessions()}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-rose-200 dark:border-rose-800/40 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all"
                  >
                    <Pause size={8} />{t('common.stopAll', '全部停止')}
                  </button>
                </div>
              );
            })()}
          </div>
        </div>

        {/* ── Three-layer scheduling ──────────────────────────────────────── */}
        <div className="contents">

          {/* Layer 3: OpenClaw scheduling */}
          <div id="application-scheduling-section" className="order-2 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(139,92,246,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <CalendarClock size={12} className="text-violet-500" />
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{t('controlCenter.cronJobs.title')}</span>
                  <span className="text-[9px] text-slate-400">{t('controlCenter.cronJobs.count', { count: filteredCronJobs.length })}</span>
                </div>
                <div className="flex items-center gap-1">
                  {(['all', 'enabled', 'disabled'] as const).map(f => {
                    const isActive = cjFilter === f;
                    const Icon = f === 'all' ? Activity : f === 'enabled' ? Play : Pause;
                    const label = f === 'all' ? t('controlCenter.timeline.tabs.all')
                                : f === 'enabled' ? t('controlCenter.cronJobs.filterEnabled')
                                : t('controlCenter.cronJobs.filterDisabled');
                    return (
                      <button
                        key={f}
                        onClick={() => setCjFilter(f)}
                        title={label}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold transition-all border ${isActive ? 'bg-violet-500 text-white border-violet-500' : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'}`}
                      >
                        <Icon size={8} />
                        <span className="hidden sm:inline">{label}</span>
                      </button>
                    );
                  })}
                  <div className="w-px h-3 bg-slate-200 dark:bg-slate-700 mx-1" />
                  <button
                    onClick={async () => { setCronLoading(true); await loadCron(); setCronLoading(false); }}
                    title={lastCronScanned ? `${t('controlCenter.actions.refresh')} · 上次掃描: ${lastCronScanned.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : t('controlCenter.actions.refresh')}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
                  >
                    <RefreshCw size={9} className={cronLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-0.5">
                {initialLoading ? (
                  Array.from({ length: 4 }).map((_, i) => <SkeletonItem key={i} className="h-14" />)
                ) : filteredCronJobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                    <CalendarClock size={24} className="mb-2 opacity-30" />
                    <span className="text-sm">
                      {cjFilter === 'enabled' ? t('controlCenter.cronJobs.emptyEnabled', '目前沒有運作中的任務') :
                       cjFilter === 'disabled' ? t('controlCenter.cronJobs.emptyDisabled', '目前沒有停止的任務') :
                       t('controlCenter.cronJobs.empty', '沒有排程任務')}
                    </span>
                  </div>
                ) : [...filteredCronJobs]
                  .sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(job => {
                  const cronSessionPrefix = `agent:${job.agentId || 'main'}:cron:${job.id}`;
                  const hasRunningCronSession = activeSessions.some((session) => {
                    const sessionKey = String(session.key || '').trim();
                    return session.isRunning === true && (sessionKey === cronSessionPrefix || sessionKey.startsWith(`${cronSessionPrefix}:`));
                  });
                  const runningAtMs = job.state?.runningAtMs ?? 0;
                  const lastRunAtMs = job.state?.lastRunAtMs ?? 0;
                  const hasRecentTriggerGrace = Boolean(
                    triggeringJobIds.has(job.id)
                    || (runningAtMs > lastRunAtMs && Date.now() - runningAtMs < 60_000)
                  );
                  const isCurrentlyRunning = hasRunningCronSession || hasRecentTriggerGrace;
                  const hasError = !isCurrentlyRunning && (job.state?.consecutiveErrors ?? 0) > 0;
                  return (
                    <div key={job.id} className={`rounded-xl border px-3 py-2.5 transition-all ${
                      !job.enabled
                        ? 'border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 opacity-60'
                        : isCurrentlyRunning
                        ? 'border-emerald-100 dark:border-emerald-900/30 bg-white dark:bg-slate-900/50'
                        : hasError
                        ? 'border-rose-100 dark:border-rose-900/30 bg-white dark:bg-slate-900/50'
                        : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                    }`}>
                      <div className="flex items-center gap-2">
                        {/* 運作狀態 badge */}
                        <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                          job.enabled
                            ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800/40'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                        }`}>
                          {job.enabled ? t('controlCenter.cronJobs.filterEnabled') : t('controlCenter.cronJobs.filterDisabled')}
                        </span>
                        {/* 名稱 + 通知開關 */}
                        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
                          <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">{job.name}</span>
                          <button
                            onClick={() => void toggleDelivery(job)}
                            title={job.delivery?.mode === 'announce'
                              ? t('controlCenter.cronJobs.notifyOn', '通知已開啟，點擊關閉')
                              : t('controlCenter.cronJobs.notifyOff', '通知已關閉，點擊開啟')}
                            className={`shrink-0 p-0.5 rounded transition-all ${
                              job.delivery?.mode === 'announce'
                                ? 'text-violet-500 hover:text-violet-700 dark:hover:text-violet-300'
                                : 'text-slate-300 dark:text-slate-600 hover:text-violet-400'
                            }`}>
                            {job.delivery?.mode === 'announce' ? <Bell size={9} /> : <BellOff size={9} />}
                          </button>
                        </div>
                        {isCurrentlyRunning && (
                          <span className="shrink-0 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-md border bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800/40">
                            <Activity size={8} className="animate-pulse text-sky-500 dark:text-sky-400" />
                            {t('common.status.exec', '執行')}
                          </span>
                        )}
                        {/* 執行結果與錯誤修復整合標籤 */}
                        {!isCurrentlyRunning && (job.state?.lastRunAtMs ?? 0) > 0 && (
                          (hasError || job.state?.lastStatus === 'error') ? (
                            <div className="shrink-0 flex items-center group transition-all active:scale-95 disabled:opacity-60 disabled:active:scale-100">
                              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-l-md border-y border-l bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/20 group-hover:bg-rose-100 dark:group-hover:bg-rose-900/40 transition-colors text-[9px] font-bold">
                                <AlertTriangle size={8} />
                                <span>{t('controlCenter.cronJobs.lastFail')} {job.state?.consecutiveErrors ? `(${job.state.consecutiveErrors})` : ''}</span>
                              </div>
                                {/* 整合修復入口 */}
                                <button
                                  onClick={(e) => { e.stopPropagation(); void openErrorLog(job); }}
                                  disabled={fixingJobIds.has(job.id)}
                                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-r-md border bg-rose-500 text-white border-rose-500 hover:bg-rose-600 transition-all shadow-sm text-[9px] font-bold disabled:opacity-50 active:scale-95"
                                >
                                  <Wrench size={8} className={fixingJobIds.has(job.id) ? 'animate-spin' : ''} />
                                  <span>{fixingJobIds.has(job.id) ? t('controlCenter.cronJobs.fixing') : t('controlCenter.cronJobs.fix')}</span>
                                </button>
                            </div>
                          ) : job.state?.lastStatus === 'ok' ? (
                            <span className="shrink-0 flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md border bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40">
                              <CheckCircle size={8} />
                              {t('controlCenter.cronJobs.lastOk')}
                            </span>
                          ) : null
                        )}
                        {/* 操作按鈕 */}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => void triggerCron(job.id)}
                            title={t('controlCenter.cronJobs.triggerNow', '立即執行')}
                            disabled={triggeringJobIds.has(job.id)}
                            className="p-1 rounded-lg transition-all text-slate-300 dark:text-slate-600 hover:text-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed">
                            <Zap size={10} className={triggeringJobIds.has(job.id) ? 'animate-pulse text-emerald-500' : ''} />
                          </button>
                          <button
                            onClick={() => editingJobId === job.id ? (setEditingJobId(null), setEditDraft(null)) : startEditCron(job)}
                            title={editingJobId === job.id ? '取消編輯' : '編輯'}
                            className={`p-1 rounded-lg transition-all ${editingJobId === job.id ? 'text-violet-500' : 'text-slate-300 dark:text-slate-600 hover:text-violet-500'}`}>
                            <Pencil size={10} />
                          </button>
                          <button onClick={() => void toggleCron(job.id)} title={job.enabled ? t('controlCenter.cronJobs.pause') : t('controlCenter.cronJobs.start')}
                            className={`p-1 rounded-lg transition-all ${job.enabled ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-violet-600'}`}>
                            {job.enabled ? <Pause size={10} /> : <Play size={10} />}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm({ name: job.name, onConfirm: () => void deleteCron(job.id) })}
                            className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all">
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </div>
                      {/* 副資訊列：排程 · Agent · 模型 · 上次時間 · 下次時間 */}
                      <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-400 flex-wrap">
                        <span className="font-mono text-violet-400/70">{formatInterval(job.schedule, t)}</span>
                        <span className="opacity-40">·</span>
                        <span className="text-slate-500 font-mono" title={job.agentId}>
                          {job.agentId || 'main'}
                        </span>
                        {job.payload?.model && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="text-sky-500/80 font-mono" title={job.payload.model}>
                              {job.payload.model}
                            </span>
                          </>
                        )}
                        {job.payload?.timeoutSeconds && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="text-amber-400/70">{t('controlCenter.cronJobs.timeout', { val: `${Math.round(job.payload.timeoutSeconds / 60)}m` })}</span>
                          </>
                        )}
                        {(job.state?.lastRunAtMs ?? 0) > 0 && (
                          <>
                            <span className="opacity-40">·</span>
                            <span>{relTime(job.state.lastRunAtMs, t)}</span>
                          </>
                        )}
                        {job.enabled && job.state?.nextRunAtMs && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="text-violet-400">{nextTime(job.state.nextRunAtMs, t)}</span>
                          </>
                        )}
                        {job.delivery?.mode === 'announce' && (job.delivery.channel || job.delivery.to) && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="flex items-center gap-0.5 text-violet-400/70">
                              <Bell size={8} />
                              {[job.delivery.channel, job.delivery.to].filter(Boolean).join(' › ')}
                            </span>
                          </>
                        )}
                      </div>
                      {/* 內嵌編輯表單 */}
                      {editingJobId === job.id && editDraft && (
                        <div className="mt-2 pt-2 border-t border-violet-100 dark:border-violet-900/30 space-y-2">
                          {/* 基本欄位 */}
                          <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-3">
                              <label className="block text-[9px] font-bold text-slate-500 mb-0.5">名稱</label>
                              <input
                                type="text"
                                value={editDraft.name}
                                onChange={e => setEditDraft(d => d ? { ...d, name: e.target.value } : d)}
                                className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                maxLength={100}
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-bold text-slate-500 mb-0.5">Agent 種類</label>
                              <select
                                value={editDraft.agentId}
                                onChange={e => setEditDraft(d => d ? { ...d, agentId: e.target.value } : d)}
                                className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                              >
                                <option value="" disabled>請選擇 Agent...</option>
                                {allAgents.map(a => (
                                  <option key={a.id} value={a.id}>{a.displayName}</option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-2">
                              <label className="block text-[9px] font-bold text-slate-500 mb-0.5">強制指定模型（選填）</label>
                              <select
                                value={editDraft.model}
                                onChange={e => setEditDraft(d => d ? { ...d, model: e.target.value } : d)}
                                className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                              >
                                <option value="">(留空，套用 Agent 預設模型)</option>
                                {Object.entries(PROVIDER_MODEL_CATALOGUE).map(([prov, data]) => (
                                  <optgroup key={prov} label={data.label}>
                                    {data.models.map(m => (
                                      <option key={m} value={m}>{m}</option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </div>
                            <div className={editDraft.scheduleKind === 'cron' ? 'col-span-3' : undefined}>
                              <div className="flex items-center justify-between mb-0.5">
                                <label className="block text-[9px] font-bold text-slate-500">排程</label>
                                <div className="flex items-center gap-0.5">
                                  {(['every', 'cron'] as const).map(k => (
                                    <button
                                      key={k}
                                      type="button"
                                      onClick={() => setEditDraft(d => d ? { ...d, scheduleKind: k } : d)}
                                      className={`px-1.5 py-0 text-[8px] font-bold rounded border transition-all ${
                                        editDraft.scheduleKind === k
                                          ? 'bg-violet-500 text-white border-violet-500'
                                          : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-700 hover:border-violet-300'
                                      }`}
                                    >
                                      {k === 'every' ? '間隔' : 'Cron'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              {editDraft.scheduleKind === 'every' ? (
                                <input
                                  type="number"
                                  min={1}
                                  max={1440}
                                  value={editDraft.intervalMin}
                                  onChange={e => setEditDraft(d => d ? { ...d, intervalMin: Math.max(1, Number(e.target.value)) } : d)}
                                  className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                />
                              ) : (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {/* 頻率 */}
                                    <select
                                      value={editDraft.cronFreq}
                                      onChange={e => setEditDraft(d => d ? { ...d, cronFreq: e.target.value as typeof d.cronFreq } : d)}
                                      className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                    >
                                      <option value="hourly">每小時</option>
                                      <option value="daily">每天</option>
                                      <option value="weekly">每週</option>
                                      <option value="monthly">每月</option>
                                      <option value="custom">自訂</option>
                                    </select>
                                    {/* 週幾 */}
                                    {editDraft.cronFreq === 'weekly' && (
                                      <select
                                        value={editDraft.cronDow}
                                        onChange={e => setEditDraft(d => d ? { ...d, cronDow: Number(e.target.value) } : d)}
                                        className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                      >
                                        {['週日','週一','週二','週三','週四','週五','週六'].map((label, i) => (
                                          <option key={i} value={i}>{label}</option>
                                        ))}
                                      </select>
                                    )}
                                    {/* 幾號 */}
                                    {editDraft.cronFreq === 'monthly' && (
                                      <select
                                        value={editDraft.cronDom}
                                        onChange={e => setEditDraft(d => d ? { ...d, cronDom: Number(e.target.value) } : d)}
                                        className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                      >
                                        {Array.from({ length: 31 }, (_, i) => (
                                          <option key={i + 1} value={i + 1}>{i + 1} 日</option>
                                        ))}
                                      </select>
                                    )}
                                    {/* 時 */}
                                    {(editDraft.cronFreq === 'daily' || editDraft.cronFreq === 'weekly' || editDraft.cronFreq === 'monthly') && (
                                      <select
                                        value={editDraft.cronHour}
                                        onChange={e => setEditDraft(d => d ? { ...d, cronHour: Number(e.target.value) } : d)}
                                        className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                      >
                                        {Array.from({ length: 24 }, (_, i) => (
                                          <option key={i} value={i}>{String(i).padStart(2, '0')} 時</option>
                                        ))}
                                      </select>
                                    )}
                                    {/* 分 */}
                                    {editDraft.cronFreq !== 'custom' && (
                                      <select
                                        value={editDraft.cronMinute}
                                        onChange={e => setEditDraft(d => d ? { ...d, cronMinute: Number(e.target.value) } : d)}
                                        className="text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                      >
                                        {Array.from({ length: 60 }, (_, i) => (
                                          <option key={i} value={i}>{String(i).padStart(2, '0')} 分</option>
                                        ))}
                                      </select>
                                    )}
                                    {/* 自訂原始表達式 */}
                                    {editDraft.cronFreq === 'custom' && (
                                      <input
                                        type="text"
                                        value={editDraft.cronExpr}
                                        placeholder="0 10 * * 0"
                                        onChange={e => setEditDraft(d => d ? { ...d, cronExpr: e.target.value } : d)}
                                        className="flex-1 min-w-0 text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400 font-mono"
                                      />
                                    )}
                                  </div>
                                  {(() => {
                                    const expr = buildCronExpr(editDraft);
                                    try { return <p className="text-[9px] text-violet-500 truncate">{cronstrue.toString(expr, { locale: 'zh_TW' })}</p>; }
                                    catch { return editDraft.cronFreq === 'custom' ? <p className="text-[9px] text-rose-400">格式無效</p> : null; }
                                  })()}
                                </div>
                              )}
                            </div>
                            <div className={editDraft.scheduleKind === 'cron' ? 'col-span-1' : undefined}>
                              <label className="block text-[9px] font-bold text-slate-500 mb-0.5">逾時（分鐘）</label>
                              <input
                                type="number"
                                min={1}
                                max={60}
                                value={editDraft.timeoutMin}
                                placeholder="不設定"
                                onChange={e => setEditDraft(d => d ? { ...d, timeoutMin: e.target.value === '' ? '' : Math.max(1, Number(e.target.value)) } : d)}
                                className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                              />
                            </div>
                            {editDraft.scheduleKind !== 'cron' && <div className="col-span-1" />}
                          </div>
                          {/* 通知格式 */}
                          <div className="pt-1.5 border-t border-violet-50 dark:border-violet-900/20">
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="text-[9px] font-bold text-slate-500 flex items-center gap-1">
                                <Bell size={8} />通知格式
                              </label>
                              <div className="flex items-center gap-1">
                                {(['none', 'announce'] as const).map(mode => (
                                  <button
                                    key={mode}
                                    type="button"
                                    onClick={() => setEditDraft(d => d ? { ...d, deliveryMode: mode } : d)}
                                    className={`px-2 py-0.5 text-[9px] font-bold rounded-md border transition-all ${
                                      editDraft.deliveryMode === mode
                                        ? 'bg-violet-500 text-white border-violet-500'
                                        : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-700 hover:border-violet-300'
                                    }`}
                                  >
                                    {mode === 'none' ? '不通知' : '廣播'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {editDraft.deliveryMode === 'announce' && (
                              <div className="grid grid-cols-2 gap-2 mt-1">
                                <div>
                                  <label className="block text-[9px] font-bold text-slate-500 mb-0.5 flex items-center justify-between">
                                    <span>頻道</span>
                                    {configuredBotChannels.length > 0 && (
                                      <span className="text-[8px] text-violet-400 font-normal">{configuredBotChannels.length} 個已綁定</span>
                                    )}
                                  </label>
                                  <select
                                    value={editDraft.deliveryChannel}
                                    onChange={e => setEditDraft(d => d ? { ...d, deliveryChannel: e.target.value } : d)}
                                    className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                  >
                                    <option value="">— 選擇頻道 —</option>
                                    {CHANNEL_META.map(ch => {
                                      const isConfigured = configuredBotChannels.some(c => c.id === ch.id);
                                      return (
                                        <option key={ch.id} value={ch.id}>
                                          {isConfigured ? `✓ ${ch.name}` : ch.name}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                                <div>
                                  <label className="block text-[9px] font-bold text-slate-500 mb-0.5">對象（選填）</label>
                                    <select
                                      value={editDraft.deliveryTo || ''}
                                      onChange={e => {
                                        const val = e.target.value;
                                        setEditDraft(d => d ? { ...d, deliveryTo: val, ...(val ? { deliveryChannel: val } : {}) } : d);
                                      }}
                                      className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                                    >
                                      <option value="">不指定（使用頻道預設）</option>
                                      {/* Telegram 特定的已授權對象 */}
                                      {editDraft.deliveryChannel === 'telegram' && (authorizedRecipients['telegram'] || []).map(id => (
                                        <option key={id} value={id}>{id}</option>
                                      ))}
                                      {/* 若現有值不在已知選項中，動態補一個選項以顯示既有值 */}
                                      {editDraft.deliveryTo && !(authorizedRecipients['telegram'] || []).includes(editDraft.deliveryTo) && (
                                        <option value={editDraft.deliveryTo}>{editDraft.deliveryTo}</option>
                                      )}
                                    </select>
                                </div>
                                <div className="col-span-2">
                                  <label className="block text-[9px] font-bold text-slate-500 mb-0.5">觸發訊息（Prompt）</label>
                                  <textarea
                                    value={editDraft.payloadMessage}
                                    onChange={e => setEditDraft(d => d ? { ...d, payloadMessage: e.target.value } : d)}
                                    rows={3}
                                    placeholder="每次觸發時送給 agent 的提示，留空則使用任務預設 prompt"
                                    className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
                                    maxLength={2000}
                                  />
                                  <div className="flex justify-end mt-0.5">
                                    <span className="text-[8px] text-slate-300 dark:text-slate-600">{editDraft.payloadMessage.length}/2000</span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                          {/* 操作按鈕 */}
                          <div className="flex items-center gap-1 pt-0.5">
                            <button
                              onClick={() => void updateCron(job.id, {
                                name: editDraft.name,
                                agentId: editDraft.agentId,
                                ...(editDraft.model ? { model: editDraft.model } : { model: '' }),
                                ...(editDraft.scheduleKind === 'cron'
                                  ? { scheduleExpr: buildCronExpr(editDraft) }
                                  : { everyMs: editDraft.intervalMin * 60000 }),
                                ...(editDraft.timeoutMin !== '' ? { timeoutSeconds: editDraft.timeoutMin * 60 } : {}),
                                delivery: {
                                  mode: editDraft.deliveryMode,
                                  ...(editDraft.deliveryChannel ? { channel: editDraft.deliveryChannel } : {}),
                                  ...(editDraft.deliveryTo ? { to: editDraft.deliveryTo } : {}),
                                },
                                ...(editDraft.payloadMessage ? { payloadMessage: editDraft.payloadMessage } : {}),
                              })}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold bg-violet-500 text-white hover:bg-violet-600 transition-all"
                            >
                              <Save size={9} />儲存
                            </button>
                            <button
                              onClick={() => { setEditingJobId(null); setEditDraft(null); }}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
                            >
                              <X size={9} />取消
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {(() => {
                const visible = filteredCronJobs;
                const canEnable  = visible.some(j => !j.enabled);
                const canDisable = visible.some(j => j.enabled);
                const canClear   = cjFilter === 'disabled' && canEnable;
                if (!canEnable && !canDisable) return null;
                return (
                  <div className="flex justify-end items-center gap-1.5 pt-1">
                    {canEnable && (
                      <button
                        onClick={() => void enableAllDisabledCronJobs()}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-emerald-200 dark:border-emerald-800/40 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all"
                      >
                        <Play size={8} />{t('common.enableAll', '全部啟用')}
                      </button>
                    )}
                    {canDisable && (
                      <button
                        onClick={() => void disableAllEnabledCronJobs()}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-amber-200 dark:border-amber-800/40 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-all"
                      >
                        <Pause size={8} />{t('common.disableAll', '全部停用')}
                      </button>
                    )}
                    {canClear && (
                      <button
                        onClick={() => {
                          const count = visible.filter(j => !j.enabled).length;
                          setDeleteConfirm({ name: t('common.deleteAllCount', '全部 {{count}} 個已停止', { count }), onConfirm: () => void deleteAllDisabledCronJobs() });
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-rose-200 dark:border-rose-800/40 text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-500 transition-all"
                      >
                        <Trash2 size={8} />{t('common.clearAll', '全部清除')}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Layer 2: crontab */}
          <div id="system-crontab-section" className="order-3 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(245,158,11,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Terminal size={12} className="text-amber-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{t('controlCenter.crontab.title')}</span>
                <span className="text-[9px] text-slate-400">{t('controlCenter.crontab.count', { count: filteredCrontabEntries.length })}</span>
                <div className="flex items-center gap-1 ml-auto">
                  {(['all', 'enabled', 'disabled'] as const).map(f => {
                    const isActive = ctFilter === f;
                    const Icon = f === 'all' ? Activity : f === 'enabled' ? Play : Pause;
                    const label = f === 'all' ? t('controlCenter.timeline.tabs.all')
                                : f === 'enabled' ? t('controlCenter.crontab.filterEnabled')
                                : t('controlCenter.crontab.filterDisabled');
                    return (
                      <button
                        key={f}
                        onClick={() => setCtFilter(f)}
                        title={label}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold transition-all border ${isActive ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'}`}
                      >
                        <Icon size={8} />
                        <span className="hidden sm:inline">{label}</span>
                      </button>
                    );
                  })}
                  <div className="w-px h-3 bg-slate-200 dark:bg-slate-700 mx-1" />
                  <button
                    onClick={async () => { setSystemLoading(true); await loadSystem(); setSystemLoading(false); }}
                    title={lastSystemScanned ? `${t('controlCenter.actions.refresh')} · 上次掃描: ${lastSystemScanned.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : t('controlCenter.actions.refresh')}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
                  >
                    <RefreshCw size={9} className={systemLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              {initialLoading ? (
                Array.from({ length: 3 }).map((_, i) => <SkeletonItem key={i} className="h-12" />)
              ) : filteredCrontabEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Terminal size={24} className="mb-2 opacity-30" />
                  <span className="text-sm">
                    {ctFilter === 'enabled' ? t('controlCenter.crontab.emptyEnabled', '目前沒有啟用中的系統排程') :
                     ctFilter === 'disabled' ? t('controlCenter.crontab.emptyDisabled', '目前沒有停用的系統排程') :
                     t('controlCenter.crontab.empty', '無系統排程項目')}
                  </span>
                </div>
              ) : [...filteredCrontabEntries]
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map((entry, i) => (
                <div key={i} className={`rounded-xl border px-3 py-2.5 transition-all ${
                  entry.enabled !== false ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50' : 'border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 opacity-60'
                }`}>
                  <div className="flex items-center gap-2">
                    {/* 狀態 badge */}
                    <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                      entry.enabled !== false
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/40'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                    }`}>
                      {entry.enabled !== false ? t('controlCenter.crontab.filterEnabled') : t('controlCenter.crontab.filterDisabled')}
                    </span>
                    {/* 名稱 */}
                    <span className="flex-1 min-w-0 text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">{entry.name}</span>
                    {/* 操作按鈕 */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => void toggleCrontab(entry.raw)} title={entry.enabled !== false ? t('controlCenter.cronJobs.pause') : t('controlCenter.cronJobs.start')}
                        className={`p-1 rounded-lg transition-all ${entry.enabled !== false ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-amber-600'}`}>
                        {entry.enabled !== false ? <Pause size={10} /> : <Play size={10} />}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm({ name: entry.name, onConfirm: () => void deleteCrontab(entry.raw) })}
                        className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  {/* 副資訊：排程表達式 + 描述 + 指令 */}
                  <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-400 flex-wrap">
                    <span className="font-mono text-amber-400/80 bg-amber-50/50 dark:bg-amber-950/20 px-1.5 py-0.5 rounded" title={describeCron(entry.schedule, i18n.language)}>
                      {entry.schedule}
                    </span>
                    {describeCron(entry.schedule, i18n.language) && (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="truncate max-w-[120px]">{describeCron(entry.schedule, i18n.language)}</span>
                      </>
                    )}
                    <span className="truncate max-w-[140px] opacity-50 ml-auto">{entry.command.split('/').slice(-2).join('/')}</span>
                  </div>
                </div>
              ))}
              {(() => {
                const visible = filteredCrontabEntries;
                const canEnable  = visible.some(e => e.enabled === false);
                const canDisable = visible.some(e => e.enabled !== false);
                const canClear   = ctFilter === 'disabled' && canEnable;
                if (!canEnable && !canDisable) return null;
                return (
                  <div className="flex justify-end items-center gap-1.5 pt-1">
                    {canEnable && (
                      <button
                        onClick={() => void enableAllDisabledCrontab()}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-emerald-200 dark:border-emerald-800/40 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all"
                      >
                        <Play size={8} />{t('common.enableAll', '全部啟用')}
                      </button>
                    )}
                    {canDisable && (
                      <button
                        onClick={() => void disableAllEnabledCrontab()}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-amber-200 dark:border-amber-800/40 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-all"
                      >
                        <Pause size={8} />{t('common.disableAll', '全部停用')}
                      </button>
                    )}
                    {canClear && (
                      <button
                        onClick={() => {
                          const count = visible.filter(e => e.enabled === false).length;
                          setDeleteConfirm({ name: t('common.deleteAllCount', '全部 {{count}} 個已停用', { count }), onConfirm: () => void deleteAllDisabledCrontab() });
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-rose-200 dark:border-rose-800/40 text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-500 transition-all"
                      >
                        <Trash2 size={8} />{t('common.clearAll', '全部清除')}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Layer 1: System services */}
          <div id="system-services-section" className="order-4 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(16,185,129,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Server size={12} className="text-emerald-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{t('controlCenter.services.title')}</span>
                <span className="text-[9px] text-slate-400">LaunchAgents · {filteredLaunchAgents.length} {t('controlCenter.services.countSuffix', '項')}</span>
                <div className="flex items-center gap-1 ml-auto">
                  {(['all', 'running', 'stopped'] as const).map(f => {
                    const isActive = agentFilter === f;
                    const Icon = f === 'all' ? Activity : f === 'running' ? Play : Pause;
                    const label = f === 'all' ? t('controlCenter.timeline.tabs.all')
                                : f === 'running' ? t('controlCenter.services.filterRunning')
                                : t('controlCenter.services.filterStopped');
                    return (
                      <button
                        key={f}
                        onClick={() => setAgentFilter(f)}
                        title={label}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold transition-all border ${isActive ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'}`}
                      >
                        <Icon size={8} />
                        <span className="hidden sm:inline">{label}</span>
                      </button>
                    );
                  })}
                  <div className="w-px h-3 bg-slate-200 dark:bg-slate-700 mx-1" />
                  <button
                    onClick={async () => { setSystemLoading(true); await loadSystem(); setSystemLoading(false); }}
                    title={lastSystemScanned ? `${t('controlCenter.actions.refresh')} · 上次掃描: ${lastSystemScanned.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : t('controlCenter.actions.refresh')}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
                  >
                    <RefreshCw size={9} className={systemLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              {initialLoading ? (
                Array.from({ length: 5 }).map((_, i) => <SkeletonItem key={i} className="h-14" />)
              ) : filteredLaunchAgents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Server size={24} className="mb-2 opacity-30" />
                  <span className="text-sm">
                    {agentFilter === 'running' ? t('controlCenter.services.emptyRunning', '目前沒有執行中的服務') :
                     agentFilter === 'stopped' ? t('controlCenter.services.emptyStopped', '目前沒有已停止的服務') :
                     t('controlCenter.services.empty', '未偵測到系統服務')}
                  </span>
                </div>
              ) : [...filteredLaunchAgents]
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                .map(agent => (
                <div key={agent.label} className={`rounded-xl border px-3 py-2.5 transition-all ${
                  agent.running || agent.loaded
                    ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                    : 'border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 opacity-60'
                }`}>
                  <div className="flex items-center gap-2">
                    {/* 主狀態 badge：執行中（有 PID 或已載入）/ 已停止 */}
                    <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                      agent.running || agent.loaded
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                    }`}>
                      {agent.running || agent.loaded ? t('controlCenter.services.filterRunning') : t('controlCenter.services.filterStopped')}
                    </span>
                    {/* 名稱 */}
                    <span className="flex-1 min-w-0 text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">{agent.name}</span>
                    {/* PID badge */}
                    {agent.running && agent.pid != null && (
                      <span className="shrink-0 text-[9px] font-mono text-slate-400 px-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                        PID {agent.pid}
                      </span>
                    )}
                    {/* 操作按鈕 */}
                    {agent.plistExists && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={() => void toggleLaunchAgent(agent.label)} title={agent.loaded ? t('controlCenter.cronJobs.pause') : t('controlCenter.cronJobs.start')}
                          className={`p-1 rounded-lg transition-all ${agent.loaded ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-emerald-600'}`}>
                          {agent.loaded ? <Pause size={10} /> : <Play size={10} />}
                        </button>
                        <button
                          onClick={() => setDeleteConfirm({ name: agent.name, onConfirm: () => void deleteLaunchAgent(agent.label) })}
                          className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all">
                          <Trash2 size={10} />
                        </button>
                      </div>
                    )}
                  </div>
                  {/* 副資訊：label · schedule · next */}
                  <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-400 flex-wrap">
                    <span className="truncate font-mono">{agent.label}</span>
                    {(() => {
                      const sched = formatLaunchAgentSchedule(agent, t, i18n.language);
                      if (!sched) return null;
                      return (
                        <>
                          <span className="opacity-40">·</span>
                          <span className="font-mono text-violet-400/80">{sched.main}</span>
                          {sched.next && (
                            <>
                              <span className="opacity-40">·</span>
                              <span className="text-emerald-400/80">{sched.next}</span>
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              ))}
              {(() => {
                const visible = filteredLaunchAgents;
                const canStart = visible.some(a => !a.loaded);
                const canStop  = visible.some(a => a.loaded);
                const canClear = agentFilter === 'stopped' && visible.some(a => !a.running && !a.loaded);
                if (!canStart && !canStop && !canClear) return null;
                return (
                  <div className="flex justify-end items-center gap-1.5 pt-1">
                    {canStart && (
                      <button
                        onClick={() => void startAllUnloadedAgents()}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-emerald-200 dark:border-emerald-800/40 text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all"
                      >
                        <Play size={8} />{t('common.startAll', '全部啟動')}
                      </button>
                    )}
                    {canStop && (
                      <button
                        onClick={() => void stopAllLoadedAgents()}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-amber-200 dark:border-amber-800/40 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-all"
                      >
                        <Pause size={8} />{t('common.stopAll', '全部停止')}
                      </button>
                    )}
                    {canClear && (
                      <button
                        onClick={() => {
                          const count = visible.filter(a => !a.running && !a.loaded).length;
                          setDeleteConfirm({ name: t('common.deleteAllCount', '全部 {{count}} 個已停止', { count }), onConfirm: () => void deleteAllStoppedAgents() });
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-rose-200 dark:border-rose-800/40 text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-500 transition-all"
                      >
                        <Trash2 size={8} />{t('common.clearAll', '全部清除')}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <DeleteConfirmDialog
        open={deleteConfirm !== null}
        itemName={deleteConfirm?.name ?? ''}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => { deleteConfirm?.onConfirm(); setDeleteConfirm(null); }}
        t={t}
      />

      {logErrorJob && (
        <ErrorLogDialog
          jobName={logErrorJob.name}
          errorLog={fetchedLog || logErrorJob.state?.lastError || (isFetchingLog ? '正在從會話日誌追蹤詳細內容...' : '')}
          onClose={() => { setLogErrorJob(null); setFetchedLog(null); }}
          onChatToFix={() => openChatToFix(logErrorJob)}
          onFixAndRetry={() => void fixAndRetry(logErrorJob.id)}
        />
      )}
    </div>
  );
};
