import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Play, Pause, Trash2, RefreshCw,
  AlertTriangle, CheckCircle,
  CalendarClock, Activity, Server, Terminal,
  Pencil, Save, X,
} from 'lucide-react';
import cronstrue from 'cronstrue/i18n';
import { DeleteConfirmDialog } from '../components/dialogs/DeleteConfirmDialog';

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

interface CronSchedule {
  kind: 'cron' | 'every';
  expr?: string;
  tz?: string;
  everyMs?: number;
}

interface CronState {
  lastRunAtMs?: number;
  lastStatus?: 'ok' | 'error';
  lastDurationMs?: number;
  consecutiveErrors?: number;
  lastError?: string;
  nextRunAtMs?: number;
}

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  agentId: string;
  schedule: CronSchedule;
  state: CronState;
  delivery: { mode: string; channel?: string };
  payload?: { timeoutSeconds?: number; model?: string; kind?: string };
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

export const ControlCenterPage: React.FC<ControlCenterPageProps> = ({ onRefreshSnapshot, stateDir }) => {
  const { t, i18n } = useTranslation();
  const [cronJobs, setCronJobs]       = useState<CronJob[]>([]);
  const [crontabEntries, setCrontabEntries] = useState<CrontabEntry[]>([]);
  const [launchAgents, setLaunchAgents]     = useState<LaunchAgent[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [cronLoading, setCronLoading] = useState(false);
  const [systemLoading, setSystemLoading] = useState(false);
  const [sessionScanLoading, setSessionScanLoading] = useState(false);
  const [lastSessionsScanned, setLastSessionsScanned] = useState<Date | null>(null);
  const [abortingSessionKeys, setAbortingSessionKeys] = useState<Set<string>>(new Set());
  const [error, setError]             = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ name: string; onConfirm: () => void } | null>(null);
  const [activeSessionFilter, setActiveSessionFilter] = useState<'all' | 'running' | 'stopped'>('running');
  const [agentFilter, setAgentFilter] = useState<'all' | 'running' | 'stopped'>('running');
  const [ctFilter, setCtFilter]       = useState<'all' | 'enabled' | 'disabled'>('enabled');
  const [cjFilter, setCjFilter]       = useState<'all' | 'enabled' | 'disabled'>('enabled');
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; intervalMin: number; timeoutMin: number | '' } | null>(null);

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

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadCron = useCallback(async () => {
    try {
      const cmd = stateDir ? `cron:list ${JSON.stringify({ stateDir })}` : 'cron:list';
      const res = await window.electronAPI.exec(cmd);
      setCronJobs(JSON.parse(res.stdout || '{}').jobs || []);
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

  const refresh = useCallback(async () => {
    setError('');
    try {
      await Promise.all([loadCron(), loadSystem()]);
      if (onRefreshSnapshot) await onRefreshSnapshot();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('controlCenter.errors.genericLoadFailed'));
    }
  }, [loadCron, loadSystem, onRefreshSnapshot, t]);

  useEffect(() => {
    refresh();
    loadActiveSessions();
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

  const deleteCron = async (jobId: string) => {
    try {
      setError('');
      await execCmd(`cron:delete ${JSON.stringify({ jobId, stateDir })}`);
      await loadCron();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Delete cron job failed');
    }
  };

  const updateCron = async (jobId: string, updates: { name?: string; everyMs?: number; timeoutSeconds?: number }) => {
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

  const startEditCron = (job: CronJob) => {
    const intervalMin = job.schedule?.everyMs ? Math.round(job.schedule.everyMs / 60000) : 10;
    const timeoutMin = job.payload?.timeoutSeconds ? Math.round(job.payload.timeoutSeconds / 60) : '';
    setEditDraft({ name: job.name, intervalMin, timeoutMin });
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
    const totalCrons = (cronJobs || []).length;
    const activeCrons = (cronJobs || []).filter(j => j.enabled).length;
    const totalAgents = (launchAgents || []).length;
    const runningAgents = (launchAgents || []).filter(a => a.running || a.loaded).length;
    const activeSessionsCount = (activeSessions || []).filter(s => s.isRunning === true).length;

    return {
      activeSessions: activeSessionsCount,
      systemServices: { running: runningAgents, total: totalAgents },
      crontabEntriesCount: (crontabEntries || []).length,
      cronSchedules: { active: activeCrons, total: totalCrons },
    };
  }, [activeSessions, cronJobs, launchAgents, crontabEntries]);

  const filteredActiveSessions = useMemo(() => {
    if (activeSessionFilter === 'all') return activeSessions;
    if (activeSessionFilter === 'running') return activeSessions.filter((session) => session.isRunning === true);
    return activeSessions.filter((session) => session.isRunning !== true);
  }, [activeSessionFilter, activeSessions]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { 
            label: t('controlCenter.kpi.activeSessions', '執行中工作'), 
            value: kpi.activeSessions, 
            color: 'text-indigo-600 dark:text-indigo-400',
            targetId: 'active-sessions-section'
          },
          { 
            label: t('controlCenter.kpi.cronSchedules', '應用排程'), 
            value: kpi.cronSchedules.total, 
            color: 'text-violet-600 dark:text-violet-400',
            targetId: 'application-scheduling-section'
          },
          { 
            label: t('controlCenter.kpi.crontabEntries', '系統排程'), 
            value: kpi.crontabEntriesCount, 
            color: 'text-amber-600 dark:text-amber-400',
            targetId: 'system-crontab-section'
          },
          { 
            label: t('controlCenter.kpi.systemServices', '系統服務'), 
            value: kpi.systemServices.total, 
            color: kpi.systemServices.running < kpi.systemServices.total ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400',
            targetId: 'system-services-section'
          },
        ].map(({ label, value, color, targetId }) => (
          <button 
            key={label} 
            onClick={() => scrollToSection(targetId)}
            className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[22px] p-4 shadow-sm text-center transition-all hover:scale-[1.02] hover:shadow-md hover:bg-white dark:hover:bg-slate-800/40 group active:scale-95"
          >
            <div className={`text-2xl font-black ${color} group-hover:drop-shadow-[0_0_8px_rgba(99,102,241,0.3)] transition-all`}>{value}</div>
            <div className="text-[10px] text-slate-500 mt-0.5 tracking-wide group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">{label}</div>
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
                <div className="w-px h-3 bg-slate-200 dark:bg-slate-700" />
                {lastSessionsScanned && (
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {lastSessionsScanned.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
                <button
                  onClick={() => void loadActiveSessions()}
                  title={t('controlCenter.actions.refresh')}
                  className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all"
                >
                  <RefreshCw size={10} className={sessionScanLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Sessions list */}
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-0.5">
              {filteredActiveSessions.length === 0 ? (
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
                        <span className="block text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {formatActiveSessionTitle(session)}
                        </span>
                        {session.lastMessage ? (
                          <span className="block text-[10px] text-slate-500 truncate">{session.lastMessage}</span>
                        ) : session.agentId ? (
                          <span className="block text-[10px] text-slate-400 truncate">agent: {session.agentId}</span>
                        ) : session.model ? (
                          <span className="block text-[10px] text-slate-400 truncate">{session.model}</span>
                        ) : null}
                        {session.agentId && (
                          <span className="block text-[10px] text-slate-400/80 truncate">{session.agentId}</span>
                        )}
                      </div>
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
          </div>
        </div>

        {/* ── Three-layer scheduling ──────────────────────────────────────── */}
        <div className="contents">

          {/* Layer 1: System services */}
          <div id="system-services-section" className="order-4 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(16,185,129,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Server size={12} className="text-emerald-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{t('controlCenter.services.title')}</span>
                <span className="text-[9px] text-slate-400">LaunchAgents · {launchAgents.length} {t('controlCenter.services.countSuffix', '項')}</span>
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
                    title={t('controlCenter.actions.refresh')}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
                  >
                    <RefreshCw size={9} className={systemLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              {launchAgents.length === 0 ? (
                <p className="text-[11px] text-slate-400 py-1">{t('controlCenter.services.empty')}</p>
              ) : launchAgents
                .filter(a => {
                  if (agentFilter === 'running') return a.running || a.loaded;
                  if (agentFilter === 'stopped') return !a.running && !a.loaded;
                  return true;
                })
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
                const visible = launchAgents.filter(a => {
                  if (agentFilter === 'running') return a.running || a.loaded;
                  if (agentFilter === 'stopped') return !a.running && !a.loaded;
                  return true;
                });
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

          {/* Layer 2: crontab */}
          <div id="system-crontab-section" className="order-3 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(245,158,11,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Terminal size={12} className="text-amber-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{t('controlCenter.crontab.title')}</span>
                <span className="text-[9px] text-slate-400">{t('controlCenter.crontab.count', { count: crontabEntries.length })}</span>
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
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
                  >
                    <RefreshCw size={9} className={systemLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              {crontabEntries.length === 0 ? (
                <p className="text-[11px] text-slate-400 py-1">{t('controlCenter.crontab.empty')}</p>
              ) : crontabEntries
                .filter(e => {
                  if (ctFilter === 'enabled') return e.enabled !== false;
                  if (ctFilter === 'disabled') return e.enabled === false;
                  return true;
                })
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
                const visible = crontabEntries.filter(e => {
                  if (ctFilter === 'enabled') return e.enabled !== false;
                  if (ctFilter === 'disabled') return e.enabled === false;
                  return true;
                });
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

          {/* Layer 3: OpenClaw scheduling */}
          <div id="application-scheduling-section" className="order-2 bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(139,92,246,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <CalendarClock size={12} className="text-violet-500" />
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{t('controlCenter.cronJobs.title')}</span>
                  <span className="text-[9px] text-slate-400">{t('controlCenter.cronJobs.count', { count: cronJobs.length })}</span>
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
                    title={t('controlCenter.actions.refresh')}
                    className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
                  >
                    <RefreshCw size={9} className={cronLoading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-0.5">
                {cronJobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                    <CalendarClock size={22} className="mb-2 opacity-30" />
                    <span className="text-sm">{t('controlCenter.cronJobs.empty')}</span>
                  </div>
                ) : [...cronJobs]
                  .filter(j => {
                    if (cjFilter === 'enabled') return j.enabled;
                    if (cjFilter === 'disabled') return !j.enabled;
                    return true;
                  })
                  .sort((a, b) => (b.state?.lastRunAtMs ?? 0) - (a.state?.lastRunAtMs ?? 0)).map(job => {
                  const hasError = (job.state?.consecutiveErrors ?? 0) > 0;
                  return (
                    <div key={job.id} className={`rounded-xl border px-3 py-2.5 transition-all ${
                      !job.enabled
                        ? 'border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 opacity-60'
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
                        {/* 名稱 */}
                        <span className="flex-1 min-w-0 text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">{job.name}</span>
                        {/* 上次執行結果 badge */}
                        {job.state?.lastRunAtMs && (
                          <span className={`shrink-0 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                            job.state.lastStatus === 'ok'
                              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40'
                              : 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/40'
                          }`}>
                            {job.state.lastStatus === 'ok'
                              ? <CheckCircle size={8} />
                              : <AlertTriangle size={8} />}
                            {job.state.lastStatus === 'ok' ? t('controlCenter.cronJobs.lastOk') : t('controlCenter.cronJobs.lastFail')}
                          </span>
                        )}
                        {/* 連續錯誤次數 badge */}
                        {hasError && (
                          <span className="shrink-0 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-md border bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/40">
                            <AlertTriangle size={8} />
                            {t('controlCenter.cronJobs.errorCount', { count: job.state?.consecutiveErrors })}
                          </span>
                        )}
                        {/* 操作按鈕 */}
                        <div className="flex items-center gap-0.5 shrink-0">
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
                      {/* 副資訊列：排程 · 上次時間 · 下次時間 */}
                      <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-400 flex-wrap">
                        <span className="font-mono text-violet-400/70">{formatInterval(job.schedule, t)}</span>
                        {job.state?.lastRunAtMs && (
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
                        {job.payload?.timeoutSeconds && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="text-amber-400/70">timeout {Math.round(job.payload.timeoutSeconds / 60)}m</span>
                          </>
                        )}
                      </div>
                      {/* 內嵌編輯表單 */}
                      {editingJobId === job.id && editDraft && (
                        <div className="mt-2 pt-2 border-t border-violet-100 dark:border-violet-900/30 space-y-2">
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
                              <label className="block text-[9px] font-bold text-slate-500 mb-0.5">排程（分鐘）</label>
                              <input
                                type="number"
                                min={1}
                                max={1440}
                                value={editDraft.intervalMin}
                                onChange={e => setEditDraft(d => d ? { ...d, intervalMin: Math.max(1, Number(e.target.value)) } : d)}
                                className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                              />
                            </div>
                            <div>
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
                            <div className="flex items-end gap-1">
                              <button
                                onClick={() => void updateCron(job.id, {
                                  name: editDraft.name,
                                  everyMs: editDraft.intervalMin * 60000,
                                  ...(editDraft.timeoutMin !== '' ? { timeoutSeconds: editDraft.timeoutMin * 60 } : {}),
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
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {(() => {
                const visible = cronJobs.filter(j => {
                  if (cjFilter === 'enabled') return j.enabled;
                  if (cjFilter === 'disabled') return !j.enabled;
                  return true;
                });
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
    </div>
  );
};
