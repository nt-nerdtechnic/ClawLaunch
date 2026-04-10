import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Play, Pause, Trash2, RefreshCw, Zap, Activity,
  AlertTriangle, CheckCircle, CalendarClock, Server, Terminal,
  Bell, BellOff, Wrench, MessageSquare, Pencil,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import cronstrue from 'cronstrue/i18n';
import { DeleteConfirmDialog } from '../../dialogs/DeleteConfirmDialog';
import { ErrorLogDialog } from '../../dialogs/ErrorLogDialog';
import { CronEditModal } from '../../cron/CronEditModal';
import type { CronEditDraft } from '../../cron/CronEditModal';
import type { CronJob, CronSchedule } from '../../../types/cron';
import { useStore } from '../../../store';
import { ConfigService } from '../../../services/configService';
import { usePixelOfficeAgents } from '../hooks/usePixelOfficeAgents';

interface AgentControlTabProps {
  agentId: string;
}

// ── Types ────────────────────────────────────────────────────────────────────

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
  totalTokens?: number;
  model?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatInterval(s: CronSchedule): string {
  if (s.kind === 'cron' && s.expr) return s.expr + (s.tz ? ` · ${s.tz}` : '');
  if (s.kind === 'every' && s.everyMs) {
    const m = s.everyMs / 60_000;
    if (m < 1) return `every ${s.everyMs / 1000}s`;
    if (m < 60) return `every ${m.toFixed(0)}m`;
    return `every ${(m / 60).toFixed(0)}h`;
  }
  return '—';
}

function getCronstrueLocale(lang: string): string {
  if (lang.toLowerCase().startsWith('zh-tw')) return 'zh_TW';
  if (lang.toLowerCase().startsWith('zh-cn')) return 'zh_CN';
  return 'en';
}

function describeCron(expr: string, lang: string): string {
  try { return cronstrue.toString(expr, { locale: getCronstrueLocale(lang) }); }
  catch { return ''; }
}

function relTime(ms: number | undefined): string {
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 0) return 'soon';
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function nextTime(ms: number | undefined): string {
  if (!ms) return '—';
  const d = ms - Date.now();
  if (d <= 0) return 'pending';
  if (d < 60_000) return `in ${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `in ${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `in ${Math.floor(d / 3_600_000)}h`;
  return `in ${Math.floor(d / 86_400_000)}d`;
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

function formatLaunchAgentSchedule(agent: LaunchAgent, lang: string): { main: string; next?: string } | null {
  if (agent.scheduleInterval !== undefined) {
    const sec = agent.scheduleInterval;
    const m = sec / 60;
    const val = m < 1 ? `${sec}s` : m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 60)}h`;
    return { main: `every ${val}` };
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
    const hh = cal.Hour   !== undefined ? String(cal.Hour).padStart(2, '0')   : '**';
    const mm = cal.Minute !== undefined ? String(cal.Minute).padStart(2, '0') : '00';
    if (cal.Hour !== undefined || cal.Minute !== undefined) parts.push(`${hh}:${mm}`);
    const nextMs = nextCalendarRun(agent.scheduleCalendar);
    return { main: parts.join(' ') || '—', next: nextMs ? nextTime(nextMs) : undefined };
  }
  if (agent.keepAlive) return { main: lang.toLowerCase().startsWith('zh') ? '常駐服務' : 'Keep-Alive' };
  if (agent.runAtLoad)  return { main: lang.toLowerCase().startsWith('zh') ? '啟動時執行' : 'Run at load' };
  return null;
}

function formatActiveSessionTitle(session: ActiveSession): string {
  const displayName = String(session.displayName || '').trim();
  const lastMessage = String(session.lastMessage || '').trim();
  const sessionKey  = String(session.key || '').trim();
  const parseCron = (text: string) => {
    const m = text.match(/\[cron:([0-9a-f-]{8,})\s+([^\]]+)\]/i);
    if (!m) return null;
    const rawId = String(m[1] || '').trim();
    const name  = String(m[2] || '').trim();
    if (!rawId || !name) return null;
    return { name, shortId: rawId.replace(/-/g, '').slice(0, 8) };
  };
  const parsed = parseCron(lastMessage) || parseCron(displayName) || parseCron(sessionKey);
  if (parsed) return `${parsed.name}(Cron-${parsed.shortId})`;
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (displayName && !/^cron\s+[0-9a-f]{6,}$/i.test(displayName) && !UUID_RE.test(displayName)) return displayName;
  const fallback = String(session.sessionId || session.key || '—');
  return UUID_RE.test(fallback) ? 'Ready to exec' : fallback;
}

const SkeletonItem = ({ className = 'h-12' }: { className?: string }) => (
  <div className={`w-full rounded-xl bg-slate-100/50 dark:bg-slate-800/30 animate-pulse border border-slate-50 dark:border-slate-800/50 ${className}`} />
);

// ── Component ────────────────────────────────────────────────────────────────

export default function AgentControlTab({ agentId }: AgentControlTabProps) {
  const { t, i18n } = useTranslation();
  const config   = useStore(s => s.config);
  const stateDir = ConfigService.normalizeConfigDir(config.configPath);
  const { summaries: allAgents } = usePixelOfficeAgents();

  // Chat integration
  const setChatOpen          = useStore(s => s.setChatOpen);
  const setActiveChatAgent   = useStore(s => s.setActiveChatAgent);
  const setActiveChatSession = useStore(s => s.setActiveChatSession);
  const addChatMessage       = useStore(s => s.addChatMessage);

  // ── Data ──────────────────────────────────────────────────────────────────
  const [cronJobs,        setCronJobs]        = useState<CronJob[]>([]);
  const [activeSessions,  setActiveSessions]  = useState<ActiveSession[]>([]);
  const [crontabEntries,  setCrontabEntries]  = useState<CrontabEntry[]>([]);
  const [launchAgents,    setLaunchAgents]    = useState<LaunchAgent[]>([]);

  const [cronLoading,     setCronLoading]     = useState(false);
  const [systemLoading,   setSystemLoading]   = useState(false);
  const [sessionLoading,  setSessionLoading]  = useState(false);
  const [initialLoading,  setInitialLoading]  = useState(true);
  const [error,           setError]           = useState('');

  const [deleteConfirm,   setDeleteConfirm]   = useState<{ name: string; onConfirm: () => void } | null>(null);
  const [editModalJob,    setEditModalJob]    = useState<CronJob | null>(null);
  const [editModalDraft,  setEditModalDraft]  = useState<CronEditDraft | null>(null);
  const [logErrorJob,     setLogErrorJob]     = useState<CronJob | null>(null);
  const [fetchedLog,      setFetchedLog]      = useState<string | null>(null);
  const [isFetchingLog,   setIsFetchingLog]   = useState(false);

  const [abortingKeys,       setAbortingKeys]       = useState(new Set<string>());
  const [triggeringJobIds,   setTriggeringJobIds]   = useState(new Set<string>());
  const [fixingJobIds,       setFixingJobIds]       = useState(new Set<string>());

  const [sessionFilter, setSessionFilter] = useState<'all' | 'running' | 'stopped'>('running');
  const [cjFilter,      setCjFilter]      = useState<'all' | 'enabled' | 'disabled'>('enabled');
  const [ctFilter,      setCtFilter]      = useState<'all' | 'enabled' | 'disabled'>('enabled');
  const [agentFilter,   setAgentFilter]   = useState<'all' | 'running' | 'stopped'>('running');

  // ── Loaders ───────────────────────────────────────────────────────────────

  const loadCron = useCallback(async () => {
    if (!window.electronAPI?.exec) return;
    try {
      const cmd = stateDir ? `cron:list ${JSON.stringify({ stateDir })}` : 'cron:list';
      const res = await window.electronAPI.exec(cmd);
      const parsed = JSON.parse(res.stdout || '{}');
      const all: CronJob[] = parsed.jobs ?? [];
      setCronJobs(all.filter(j => !j.agentId || j.agentId === agentId));
    } catch { setCronJobs([]); }
  }, [agentId, stateDir]);

  const loadSystem = useCallback(async () => {
    if (!window.electronAPI?.exec) return;
    try {
      const [ctRes, laRes] = await Promise.all([
        window.electronAPI.exec('system:crontab:list'),
        window.electronAPI.exec('system:launchagents:list'),
      ]);
      setCrontabEntries(JSON.parse(ctRes.stdout || '{}').entries ?? []);
      setLaunchAgents(JSON.parse(laRes.stdout || '{}').agents ?? []);
    } catch { /* ignore */ }
  }, []);

  const loadActiveSessions = useCallback(async () => {
    if (!window.electronAPI?.scanActiveSessions) return;
    try {
      setSessionLoading(true);
      const res = await window.electronAPI.scanActiveSessions({ activeMinutes: 15 });
      if (res.code !== 0) { setActiveSessions([]); return; }
      const parsed = JSON.parse(res.stdout || '{}');
      const rawSessions: ActiveSession[] = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      // Dedup by key
      const dedup = new Map<string, ActiveSession>();
      for (const s of rawSessions) {
        const key = String(s.key || s.sessionId || '').trim();
        if (!key) continue;
        const existing = dedup.get(key);
        if (!existing || (existing.ageMs ?? Infinity) > (s.ageMs ?? Infinity)) dedup.set(key, s);
      }
      // Filter by agentId
      const filtered = Array.from(dedup.values()).filter(s => !s.agentId || s.agentId === agentId);
      setActiveSessions(filtered);
    } catch { setActiveSessions([]); }
    finally { setSessionLoading(false); }
  }, [agentId]);

  useEffect(() => {
    const init = async () => {
      setInitialLoading(true);
      try { await Promise.all([loadCron(), loadSystem(), loadActiveSessions()]); }
      finally { setInitialLoading(false); }
    };
    void init();
  }, [loadCron, loadSystem, loadActiveSessions]);

  useEffect(() => {
    const id = setInterval(() => void Promise.all([loadCron(), loadSystem()]), 30_000);
    return () => clearInterval(id);
  }, [loadCron, loadSystem]);

  useEffect(() => {
    const id = setInterval(() => void loadActiveSessions(), 5_000);
    return () => clearInterval(id);
  }, [loadActiveSessions]);

  // ── Filtered lists ────────────────────────────────────────────────────────

  const filteredSessions = useMemo(() => {
    if (sessionFilter === 'running') return activeSessions.filter(s => s.isRunning === true);
    if (sessionFilter === 'stopped') return activeSessions.filter(s => s.isRunning !== true);
    return activeSessions;
  }, [sessionFilter, activeSessions]);

  const filteredCronJobs = useMemo(() => {
    if (cjFilter === 'enabled')  return cronJobs.filter(j => j.enabled);
    if (cjFilter === 'disabled') return cronJobs.filter(j => !j.enabled);
    return cronJobs;
  }, [cjFilter, cronJobs]);

  const filteredCrontab = useMemo(() => {
    if (ctFilter === 'enabled')  return crontabEntries.filter(e => e.enabled !== false);
    if (ctFilter === 'disabled') return crontabEntries.filter(e => e.enabled === false);
    return crontabEntries;
  }, [ctFilter, crontabEntries]);

  const filteredAgents = useMemo(() => {
    if (agentFilter === 'running') return launchAgents.filter(a => a.running || a.loaded);
    if (agentFilter === 'stopped') return launchAgents.filter(a => !a.running && !a.loaded);
    return launchAgents;
  }, [agentFilter, launchAgents]);

  // ── Cron actions ──────────────────────────────────────────────────────────

  const execCmd = useCallback(async (cmd: string) => {
    const res = await window.electronAPI.exec(cmd);
    if ((res.code ?? res.exitCode) !== 0) throw new Error(res.stderr || 'command failed');
    return res;
  }, []);

  const toggleCron = async (jobId: string) => {
    try { await execCmd(`cron:toggle ${JSON.stringify({ jobId, stateDir })}`); await loadCron(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Toggle failed'); }
  };

  const triggerCron = async (jobId: string) => {
    try {
      setTriggeringJobIds(prev => { const n = new Set(prev); n.add(jobId); return n; });
      window.electronAPI.exec(`cron:trigger ${JSON.stringify({ jobId, stateDir, fireAndForget: true })}`);
      await new Promise(r => setTimeout(r, 800));
      await loadCron();
    } catch (e) { setError(e instanceof Error ? e.message : 'Trigger failed'); }
    finally { setTriggeringJobIds(prev => { const n = new Set(prev); n.delete(jobId); return n; }); }
  };

  const deleteCron = async (jobId: string) => {
    try { await execCmd(`cron:delete ${JSON.stringify({ jobId, stateDir })}`); await loadCron(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Delete failed'); }
  };

  const updateCron = async (jobId: string, updates: Record<string, unknown>) => {
    try {
      await execCmd(`cron:update ${JSON.stringify({ jobId, stateDir, ...updates })}`);
      setEditModalJob(null); setEditModalDraft(null);
      await loadCron();
    } catch (e) { setError(e instanceof Error ? e.message : 'Update failed'); }
  };

  const toggleDelivery = async (job: CronJob) => {
    const mode = (job.delivery?.mode || 'none') === 'announce' ? 'none' : 'announce';
    await updateCron(job.id, { delivery: { ...job.delivery, mode } });
  };

  const fixAndRetry = async (jobId: string) => {
    try {
      setFixingJobIds(prev => { const n = new Set(prev); n.add(jobId); return n; });
      setTriggeringJobIds(prev => { const n = new Set(prev); n.add(jobId); return n; });
      await execCmd(`cron:reset-errors ${JSON.stringify({ jobId, stateDir })}`);
      window.electronAPI.exec(`cron:trigger ${JSON.stringify({ jobId, stateDir, fireAndForget: true })}`);
      await new Promise(r => setTimeout(r, 1200));
      await loadCron();
    } catch (e) { setError(e instanceof Error ? e.message : 'Fix failed'); }
    finally {
      setFixingJobIds(prev => { const n = new Set(prev); n.delete(jobId); return n; });
      setTriggeringJobIds(prev => { const n = new Set(prev); n.delete(jobId); return n; });
    }
  };

  const openErrorLog = async (job: CronJob) => {
    setLogErrorJob(job); setFetchedLog(null);
    if (!job.state?.lastError) {
      setIsFetchingLog(true);
      try {
        const res = await window.electronAPI.exec(`cron:get-last-session-log ${JSON.stringify({ jobId: job.id, agentId: job.agentId || 'main', stateDir })}`);
        if (res.code === 0) setFetchedLog(JSON.parse(res.stdout || '{}').log || null);
      } catch { /* ignore */ }
      finally { setIsFetchingLog(false); }
    }
  };

  const openChatToFix = (job: CronJob) => {
    setActiveChatAgent(job.agentId || 'main');
    const sessionKey = `agent:${job.agentId || 'main'}:cron:${job.id}`;
    setActiveChatSession(sessionKey);
    setChatOpen(true);
    addChatMessage({
      id: crypto.randomUUID(), role: 'user',
      content: `【任務故障診斷】\n任務名稱：${job.name}\n任務 ID：${job.id}\n錯誤內容：\n"""\n${job.state?.lastError || '未知錯誤'}\n"""\n\n這項排程任務執行失敗了。請幫我分析以上錯誤原因，並提供具體的修復建議。`,
      sessionKey, agentId: job.agentId || 'main', createdAt: Date.now(),
    });
  };

  // ── Cron edit modal ───────────────────────────────────────────────────────

  const parseCronExpr = (expr: string) => {
    const parts = expr.trim().split(/\s+/);
    const isNum = (s: string) => /^\d+$/.test(s);
    const def = { minute: 0, hour: 0, dow: 0, dom: 1 };
    if (parts.length !== 5) return { freq: 'custom' as const, ...def };
    const [min, hr, dom, , dow] = parts;
    if (isNum(min) && hr === '*' && dom === '*')            return { freq: 'hourly'  as const, minute: +min, hour: 0,   dow: 0,   dom: 1    };
    if (isNum(min) && isNum(hr) && dom === '*' && dow === '*') return { freq: 'daily' as const, minute: +min, hour: +hr, dow: 0,   dom: 1    };
    if (isNum(min) && isNum(hr) && dom === '*' && isNum(dow)) return { freq: 'weekly' as const, minute: +min, hour: +hr, dow: +dow, dom: 1   };
    if (isNum(min) && isNum(hr) && isNum(dom) && dow === '*') return { freq: 'monthly' as const, minute: +min, hour: +hr, dow: 0, dom: +dom };
    return { freq: 'custom' as const, ...def };
  };

  const startEditCronModal = (job: CronJob) => {
    const scheduleKind: 'every' | 'cron' = job.schedule?.kind === 'cron' ? 'cron' : 'every';
    const rawExpr = job.schedule?.expr || '';
    const { freq, minute, hour, dow, dom } = parseCronExpr(rawExpr);
    const intervalMin = job.schedule?.everyMs ? Math.round(job.schedule.everyMs / 60_000) : 10;
    setEditModalDraft({
      name: job.name, agentId: job.agentId || 'main', model: job.payload?.model || '',
      scheduleKind, intervalMin, cronFreq: freq,
      cronMinute: minute, cronHour: hour, cronDow: dow, cronDom: dom,
      cronExpr: freq === 'custom' ? rawExpr : '',
      timeoutMin: job.payload?.timeoutSeconds ? Math.round(job.payload.timeoutSeconds / 60) : '',
      deliveryMode: job.delivery?.mode || 'none',
      deliveryChannel: job.delivery?.channel || '',
      deliveryTo: job.delivery?.to || '',
      payloadMessage: job.payload?.message || '',
    });
    setEditModalJob(job);
  };

  const buildCronExpr = (d: CronEditDraft): string => {
    switch (d.cronFreq) {
      case 'hourly':  return `${d.cronMinute} * * * *`;
      case 'daily':   return `${d.cronMinute} ${d.cronHour} * * *`;
      case 'weekly':  return `${d.cronMinute} ${d.cronHour} * * ${d.cronDow}`;
      case 'monthly': return `${d.cronMinute} ${d.cronHour} ${d.cronDom} * *`;
      default:        return d.cronExpr;
    }
  };

  // ── Session actions ───────────────────────────────────────────────────────

  const abortSession = async (sessionKey: string, sessionAgentId?: string) => {
    const key = String(sessionKey || '').trim();
    if (!key) return;
    try {
      setAbortingKeys(prev => { const n = new Set(prev); n.add(key); return n; });
      const res = await window.electronAPI.abortSession({ sessionKey: key, agentId: sessionAgentId });
      if (!res.success) setError(res.error || 'abort failed');
      else await loadActiveSessions();
    } catch (e) { setError(e instanceof Error ? e.message : 'abort failed'); }
    finally { setAbortingKeys(prev => { const n = new Set(prev); n.delete(key); return n; }); }
  };

  const openChatToSession = (session: ActiveSession) => {
    const sid = session.agentId || 'main';
    const sessionKey = String(session.key || session.sessionId || '').trim() || `agent:${sid}`;
    setActiveChatAgent(sid);
    setActiveChatSession(sessionKey);
    setChatOpen(true);
  };

  // ── Crontab & LaunchAgent actions ─────────────────────────────────────────

  const toggleCrontab     = async (raw: string)   => { try { await execCmd(`system:crontab:toggle ${JSON.stringify({ raw })}`);            await loadSystem(); } catch (e) { setError(String(e)); } };
  const deleteCrontab     = async (raw: string)   => { try { await execCmd(`system:crontab:delete ${JSON.stringify({ raw })}`);            await loadSystem(); } catch (e) { setError(String(e)); } };
  const toggleLaunchAgent = async (label: string) => { try { await execCmd(`system:launchagents:toggle ${JSON.stringify({ label })}`);     await loadSystem(); } catch (e) { setError(String(e)); } };
  const deleteLaunchAgent = async (label: string) => { try { await execCmd(`system:launchagents:delete ${JSON.stringify({ label })}`);     await loadSystem(); } catch (e) { setError(String(e)); } };

  // ── Section card wrapper ──────────────────────────────────────────────────

  const SectionCard = ({ accentColor, children }: { accentColor: string; children: React.ReactNode }) => (
    <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden">
      <div style={{ height: '2px', background: `linear-gradient(to right,transparent,${accentColor},transparent)` }} />
      <div className="p-5 space-y-2">{children}</div>
    </div>
  );

  const FilterBar = ({ value, options, onChange, activeColor }: {
    value: string;
    options: { key: string; icon: React.ReactNode; label: string }[];
    onChange: (v: string) => void;
    activeColor: string;
  }) => (
    <div className="flex items-center gap-1">
      {options.map(({ key, icon, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          title={label}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold transition-all border ${
            value === key
              ? `${activeColor} text-white`
              : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'
          }`}
        >
          {icon}
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 space-y-4 pb-20">

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 px-3 py-2 text-[11px]">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => setError('')}>dismiss</button>
        </div>
      )}

      {/* ── 1. Active Sessions ── */}
      <SectionCard accentColor="rgba(99,102,241,0.5)">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Activity size={12} className="text-indigo-500" />
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">
              {t('controlCenter.activeSessions.title', '執行中工作')}
            </span>
            <span className="text-[9px] text-slate-400">({filteredSessions.length})</span>
          </div>
          <div className="flex items-center gap-1">
            <FilterBar
              value={sessionFilter}
              onChange={v => setSessionFilter(v as typeof sessionFilter)}
              activeColor="bg-indigo-500 border-indigo-500"
              options={[
                { key: 'all',     icon: <Activity size={8} />, label: t('controlCenter.timeline.tabs.all', 'All')     },
                { key: 'running', icon: <Play size={8} />,     label: t('controlCenter.services.filterRunning', 'Running') },
                { key: 'stopped', icon: <Pause size={8} />,    label: t('controlCenter.services.filterStopped', 'Stopped') },
              ]}
            />
            <button
              type="button"
              onClick={() => void loadActiveSessions()}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
            >
              <RefreshCw size={9} className={sessionLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-0.5">
          {initialLoading ? (
            [0, 1, 2].map(i => <SkeletonItem key={i} className="h-14" />)
          ) : filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <Activity size={22} className="mb-2 opacity-25" />
              <span className="text-[11px]">
                {sessionFilter === 'running'
                  ? t('controlCenter.activeSessions.emptyRunning', '目前沒有執行中的工作')
                  : sessionFilter === 'stopped'
                    ? t('controlCenter.activeSessions.emptyStopped', '目前沒有已停止的工作')
                    : t('controlCenter.activeSessions.empty', '無執行中工作')}
              </span>
            </div>
          ) : filteredSessions.map((session, i) => {
            const isRunning = session.isRunning === true;
            const effectiveKey = String(session.key || session.sessionId || '').trim();
            const isAborting = effectiveKey ? abortingKeys.has(effectiveKey) : false;
            const canAbort = !!effectiveKey && (isRunning || session.source === 'memory');
            return (
              <div
                key={`session-${session.key}-${i}`}
                className={`rounded-2xl border px-3 py-2.5 transition-all ${
                  isRunning
                    ? 'border-violet-200 dark:border-violet-800/40 bg-violet-50/30 dark:bg-violet-950/10'
                    : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`shrink-0 w-5 h-5 rounded-lg flex items-center justify-center ${isRunning ? 'bg-violet-100 dark:bg-violet-900/40' : 'bg-slate-100 dark:bg-slate-800/40'}`}>
                    {isRunning ? <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" /> : <Activity size={10} className="text-slate-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="block text-[11px] font-semibold text-slate-800 dark:text-slate-100">{formatActiveSessionTitle(session)}</span>
                    {session.lastMessage
                      ? <span className="block text-[10px] text-slate-500 truncate">{session.lastMessage}</span>
                      : session.model
                        ? <span className="block text-[10px] text-slate-400">{session.model}</span>
                        : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => openChatToSession(session)}
                    title={t('controlCenter.activeSessions.openChat', '開啟對話')}
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-all"
                  >
                    <MessageSquare size={11} />
                  </button>
                  {canAbort ? (
                    <button
                      type="button"
                      onClick={() => void abortSession(effectiveKey, session.agentId)}
                      disabled={isAborting}
                      className="shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-lg bg-rose-100 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-600 hover:text-white transition-all disabled:opacity-60"
                    >
                      {isAborting ? t('controlCenter.actions.stopping', '停止中') : t('controlCenter.actions.abort', '停止')}
                    </button>
                  ) : (
                    <span className="shrink-0 px-2 py-0.5 text-[10px] font-bold rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400">
                      {t('controlCenter.activeSessions.notAbortable', '已停止')}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 pl-7 text-[10px] text-slate-400 flex-wrap">
                  <span className={isRunning ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                    {isRunning ? t('common.status.exec', '執行') : t('controlCenter.activeSessions.recentActivity', '近期活動')}
                  </span>
                  <span className="opacity-30">·</span>
                  <span className="tabular-nums">{(session.ageMs / 1000).toFixed(1)}s ago</span>
                  {session.totalTokens !== undefined && (
                    <><span className="opacity-30">·</span><span className="font-mono">{session.totalTokens} tokens</span></>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {filteredSessions.filter(s => s.isRunning === true).length > 0 && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => void Promise.all(filteredSessions.filter(s => s.isRunning === true).map(s => abortSession(String(s.key || s.sessionId || '').trim(), s.agentId)))}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-rose-200 dark:border-rose-800/40 text-rose-500 hover:bg-rose-50 transition-all"
            >
              <Pause size={8} />{t('common.stopAll', '全部停止')}
            </button>
          </div>
        )}
      </SectionCard>

      {/* ── 2. App Cron Jobs ── */}
      <SectionCard accentColor="rgba(139,92,246,0.45)">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <CalendarClock size={12} className="text-violet-500" />
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">
              {t('controlCenter.cronJobs.title', '應用排程')}
            </span>
            <span className="text-[9px] text-slate-400">({filteredCronJobs.length})</span>
          </div>
          <div className="flex items-center gap-1">
            <FilterBar
              value={cjFilter}
              onChange={v => setCjFilter(v as typeof cjFilter)}
              activeColor="bg-violet-500 border-violet-500"
              options={[
                { key: 'all',      icon: <Activity size={8} />, label: t('controlCenter.timeline.tabs.all', 'All')     },
                { key: 'enabled',  icon: <Play size={8} />,     label: t('controlCenter.cronJobs.filterEnabled', 'On') },
                { key: 'disabled', icon: <Pause size={8} />,    label: t('controlCenter.cronJobs.filterDisabled', 'Off') },
              ]}
            />
            <button
              type="button"
              onClick={async () => { setCronLoading(true); await loadCron(); setCronLoading(false); }}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
            >
              <RefreshCw size={9} className={cronLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-0.5">
          {initialLoading ? (
            [0, 1, 2, 3].map(i => <SkeletonItem key={i} className="h-14" />)
          ) : filteredCronJobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <CalendarClock size={22} className="mb-2 opacity-30" />
              <span className="text-[11px]">
                {cjFilter === 'enabled'  ? t('controlCenter.cronJobs.emptyEnabled', '目前沒有運作中的任務') :
                 cjFilter === 'disabled' ? t('controlCenter.cronJobs.emptyDisabled', '目前沒有停止的任務') :
                 t('pixelOffice.drawer.cron.noJobs', 'No cron jobs for this agent')}
              </span>
            </div>
          ) : [...filteredCronJobs].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(job => {
            const cronSessionPrefix = `agent:${job.agentId || 'main'}:cron:${job.id}`;
            const hasRunningCronSession = activeSessions.some(s => {
              const k = String(s.key || '').trim();
              return s.isRunning === true && (k === cronSessionPrefix || k.startsWith(`${cronSessionPrefix}:`));
            });
            const runningAtMs = job.state?.runningAtMs ?? 0;
            const lastRunAtMs = job.state?.lastRunAtMs ?? 0;
            const isCurrentlyRunning = hasRunningCronSession || (triggeringJobIds.has(job.id) || (runningAtMs > lastRunAtMs && Date.now() - runningAtMs < 60_000));
            const hasError = !isCurrentlyRunning && (job.state?.consecutiveErrors ?? 0) > 0;
            return (
              <div key={job.id} className={`rounded-xl border px-3 py-2.5 transition-all ${
                !job.enabled ? 'border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 opacity-60'
                : isCurrentlyRunning ? 'border-emerald-100 dark:border-emerald-900/30 bg-white dark:bg-slate-900/50'
                : hasError ? 'border-rose-100 dark:border-rose-900/30 bg-white dark:bg-slate-900/50'
                : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
              }`}>
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                    job.enabled
                      ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800/40'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                  }`}>
                    {job.enabled ? t('controlCenter.cronJobs.filterEnabled', 'ON') : t('controlCenter.cronJobs.filterDisabled', 'OFF')}
                  </span>
                  <div className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
                    <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">{job.name}</span>
                    <button
                      type="button"
                      onClick={() => void toggleDelivery(job)}
                      title={job.delivery?.mode === 'announce' ? t('controlCenter.cronJobs.notifyOn', '通知已開啟') : t('controlCenter.cronJobs.notifyOff', '通知已關閉')}
                      className={`shrink-0 p-0.5 rounded transition-all ${job.delivery?.mode === 'announce' ? 'text-violet-500' : 'text-slate-300 dark:text-slate-600 hover:text-violet-400'}`}
                    >
                      {job.delivery?.mode === 'announce' ? <Bell size={9} /> : <BellOff size={9} />}
                    </button>
                  </div>
                  {isCurrentlyRunning && (
                    <span className="shrink-0 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-md border bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800/40">
                      <Activity size={8} className="animate-pulse" />
                      {t('common.status.exec', '執行')}
                    </span>
                  )}
                  {!isCurrentlyRunning && (job.state?.lastRunAtMs ?? 0) > 0 && (
                    (hasError || job.state?.lastStatus === 'error') ? (
                      <div className="shrink-0 flex items-center">
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-l-md border-y border-l bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/20 text-[9px] font-bold">
                          <AlertTriangle size={8} />
                          {job.state?.consecutiveErrors ? `(${job.state.consecutiveErrors})` : t('controlCenter.cronJobs.lastFail', 'FAIL')}
                        </div>
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); void openErrorLog(job); }}
                          disabled={fixingJobIds.has(job.id)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-r-md border bg-rose-500 text-white border-rose-500 hover:bg-rose-600 text-[9px] font-bold disabled:opacity-50"
                        >
                          <Wrench size={8} className={fixingJobIds.has(job.id) ? 'animate-spin' : ''} />
                          {fixingJobIds.has(job.id) ? t('controlCenter.cronJobs.fixing', '修復中') : t('controlCenter.cronJobs.fix', '修復')}
                        </button>
                      </div>
                    ) : job.state?.lastStatus === 'ok' ? (
                      <span className="shrink-0 flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md border bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40">
                        <CheckCircle size={8} />{t('controlCenter.cronJobs.lastOk', 'OK')}
                      </span>
                    ) : null
                  )}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button type="button" title={t('controlCenter.cronJobs.triggerNow', 'Run now')} onClick={() => void triggerCron(job.id)} disabled={triggeringJobIds.has(job.id)}
                      className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-emerald-500 disabled:opacity-40 transition-all">
                      <Zap size={10} className={triggeringJobIds.has(job.id) ? 'animate-pulse text-emerald-500' : ''} />
                    </button>
                    <button type="button" onClick={() => startEditCronModal(job)} title="Edit"
                      className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-violet-500 transition-all">
                      <Pencil size={10} />
                    </button>
                    <button type="button" onClick={() => void toggleCron(job.id)} title={job.enabled ? t('controlCenter.cronJobs.pause') : t('controlCenter.cronJobs.start')}
                      className={`p-1 rounded-lg transition-all ${job.enabled ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-violet-600'}`}>
                      {job.enabled ? <Pause size={10} /> : <Play size={10} />}
                    </button>
                    <button type="button" onClick={() => setDeleteConfirm({ name: job.name, onConfirm: () => void deleteCron(job.id) })}
                      className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all">
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-400 flex-wrap">
                  <span className="font-mono text-violet-400/70">{formatInterval(job.schedule)}</span>
                  {job.payload?.model && (
                    <><span className="opacity-40">·</span><span className="text-sky-500/80 font-mono">{job.payload.model}</span></>
                  )}
                  {(job.state?.lastRunAtMs ?? 0) > 0 && (
                    <><span className="opacity-40">·</span><span>{relTime(job.state.lastRunAtMs)}</span></>
                  )}
                  {job.enabled && job.state?.nextRunAtMs && (
                    <><span className="opacity-40">·</span><span className="text-violet-400">{nextTime(job.state.nextRunAtMs)}</span></>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {(() => {
          const canEnable  = filteredCronJobs.some(j => !j.enabled);
          const canDisable = filteredCronJobs.some(j => j.enabled);
          if (!canEnable && !canDisable) return null;
          return (
            <div className="flex justify-end items-center gap-1.5 pt-1">
              {canEnable && (
                <button type="button" onClick={() => void Promise.all(filteredCronJobs.filter(j => !j.enabled).map(j => toggleCron(j.id)))}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-emerald-200 dark:border-emerald-800/40 text-emerald-500 hover:bg-emerald-50 transition-all">
                  <Play size={8} />{t('common.enableAll', '全部啟用')}
                </button>
              )}
              {canDisable && (
                <button type="button" onClick={() => void Promise.all(filteredCronJobs.filter(j => j.enabled).map(j => toggleCron(j.id)))}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-amber-200 dark:border-amber-800/40 text-amber-500 hover:bg-amber-50 transition-all">
                  <Pause size={8} />{t('common.disableAll', '全部停用')}
                </button>
              )}
            </div>
          );
        })()}
      </SectionCard>

      {/* ── 3. System Crontab ── */}
      <SectionCard accentColor="rgba(245,158,11,0.45)">
        <div className="flex items-center gap-2 mb-1">
          <Terminal size={12} className="text-amber-500" />
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">
            {t('controlCenter.crontab.title', '系統排程')}
          </span>
          <span className="text-[9px] text-slate-400">({filteredCrontab.length})</span>
          <div className="flex items-center gap-1 ml-auto">
            <FilterBar
              value={ctFilter}
              onChange={v => setCtFilter(v as typeof ctFilter)}
              activeColor="bg-amber-500 border-amber-500"
              options={[
                { key: 'all',      icon: <Activity size={8} />, label: t('controlCenter.timeline.tabs.all', 'All')        },
                { key: 'enabled',  icon: <Play size={8} />,     label: t('controlCenter.crontab.filterEnabled', 'On')     },
                { key: 'disabled', icon: <Pause size={8} />,    label: t('controlCenter.crontab.filterDisabled', 'Off')   },
              ]}
            />
            <button type="button"
              onClick={async () => { setSystemLoading(true); await loadSystem(); setSystemLoading(false); }}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all">
              <RefreshCw size={9} className={systemLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-0.5">
          {initialLoading ? (
            [0, 1, 2].map(i => <SkeletonItem key={i} className="h-12" />)
          ) : filteredCrontab.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <Terminal size={22} className="mb-2 opacity-30" />
              <span className="text-[11px]">
                {ctFilter === 'enabled'  ? t('controlCenter.crontab.emptyEnabled', '目前沒有啟用中的系統排程') :
                 ctFilter === 'disabled' ? t('controlCenter.crontab.emptyDisabled', '目前沒有停用的系統排程') :
                 t('controlCenter.crontab.empty', '無系統排程項目')}
              </span>
            </div>
          ) : [...filteredCrontab].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((entry, i) => (
            <div key={i} className={`rounded-xl border px-3 py-2.5 transition-all ${
              entry.enabled !== false
                ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                : 'border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 opacity-60'
            }`}>
              <div className="flex items-center gap-2">
                <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                  entry.enabled !== false
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/40'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                }`}>
                  {entry.enabled !== false ? t('controlCenter.crontab.filterEnabled', 'ON') : t('controlCenter.crontab.filterDisabled', 'OFF')}
                </span>
                <span className="flex-1 min-w-0 text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">{entry.name}</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button type="button" onClick={() => void toggleCrontab(entry.raw)}
                    className="p-1 rounded-lg text-slate-400 hover:text-amber-600 transition-all">
                    {entry.enabled !== false ? <Pause size={10} /> : <Play size={10} />}
                  </button>
                  <button type="button" onClick={() => setDeleteConfirm({ name: entry.name, onConfirm: () => void deleteCrontab(entry.raw) })}
                    className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all">
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-400 flex-wrap">
                <span className="font-mono text-amber-400/80 bg-amber-50/50 dark:bg-amber-950/20 px-1.5 py-0.5 rounded"
                  title={describeCron(entry.schedule, i18n.language)}>
                  {entry.schedule}
                </span>
                {describeCron(entry.schedule, i18n.language) && (
                  <><span className="opacity-40">·</span><span className="truncate max-w-[120px]">{describeCron(entry.schedule, i18n.language)}</span></>
                )}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ── 4. System Services / LaunchAgents ── */}
      <SectionCard accentColor="rgba(16,185,129,0.45)">
        <div className="flex items-center gap-2 mb-1">
          <Server size={12} className="text-emerald-500" />
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">
            {t('controlCenter.services.title', '系統服務')}
          </span>
          <span className="text-[9px] text-slate-400">LaunchAgents · {filteredAgents.length}</span>
          <div className="flex items-center gap-1 ml-auto">
            <FilterBar
              value={agentFilter}
              onChange={v => setAgentFilter(v as typeof agentFilter)}
              activeColor="bg-emerald-500 border-emerald-500"
              options={[
                { key: 'all',     icon: <Activity size={8} />, label: t('controlCenter.timeline.tabs.all', 'All')       },
                { key: 'running', icon: <Play size={8} />,     label: t('controlCenter.services.filterRunning', 'Running') },
                { key: 'stopped', icon: <Pause size={8} />,    label: t('controlCenter.services.filterStopped', 'Stopped') },
              ]}
            />
            <button type="button"
              onClick={async () => { setSystemLoading(true); await loadSystem(); setSystemLoading(false); }}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all">
              <RefreshCw size={9} className={systemLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-0.5">
          {initialLoading ? (
            [0, 1, 2, 3, 4].map(i => <SkeletonItem key={i} className="h-14" />)
          ) : filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400">
              <Server size={22} className="mb-2 opacity-30" />
              <span className="text-[11px]">
                {agentFilter === 'running' ? t('controlCenter.services.emptyRunning', '目前沒有執行中的服務') :
                 agentFilter === 'stopped' ? t('controlCenter.services.emptyStopped', '目前沒有已停止的服務') :
                 t('controlCenter.services.empty', '未偵測到系統服務')}
              </span>
            </div>
          ) : [...filteredAgents].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(agent => (
            <div key={agent.label} className={`rounded-xl border px-3 py-2.5 transition-all ${
              agent.running || agent.loaded
                ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                : 'border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 opacity-60'
            }`}>
              <div className="flex items-center gap-2">
                <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                  agent.running || agent.loaded
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                }`}>
                  {agent.running || agent.loaded ? t('controlCenter.services.filterRunning', 'Running') : t('controlCenter.services.filterStopped', 'Stopped')}
                </span>
                <span className="flex-1 min-w-0 text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">{agent.name}</span>
                {agent.running && agent.pid != null && (
                  <span className="shrink-0 text-[9px] font-mono text-slate-400 px-1.5 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                    PID {agent.pid}
                  </span>
                )}
                {agent.plistExists && (
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button type="button" onClick={() => void toggleLaunchAgent(agent.label)}
                      className={`p-1 rounded-lg transition-all ${agent.loaded ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-emerald-600'}`}>
                      {agent.loaded ? <Pause size={10} /> : <Play size={10} />}
                    </button>
                    <button type="button" onClick={() => setDeleteConfirm({ name: agent.name, onConfirm: () => void deleteLaunchAgent(agent.label) })}
                      className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all">
                      <Trash2 size={10} />
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-400 flex-wrap">
                <span className="truncate font-mono">{agent.label}</span>
                {(() => {
                  const sched = formatLaunchAgentSchedule(agent, i18n.language);
                  if (!sched) return null;
                  return (
                    <>
                      <span className="opacity-40">·</span>
                      <span className="font-mono text-violet-400/80">{sched.main}</span>
                      {sched.next && <><span className="opacity-40">·</span><span className="text-emerald-400/80">{sched.next}</span></>}
                    </>
                  );
                })()}
              </div>
            </div>
          ))}
        </div>

        {(() => {
          const canStart = filteredAgents.some(a => !a.loaded);
          const canStop  = filteredAgents.some(a => a.loaded);
          if (!canStart && !canStop) return null;
          return (
            <div className="flex justify-end items-center gap-1.5 pt-1">
              {canStart && (
                <button type="button" onClick={() => void Promise.all(filteredAgents.filter(a => !a.loaded).map(a => toggleLaunchAgent(a.label)))}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-emerald-200 dark:border-emerald-800/40 text-emerald-500 hover:bg-emerald-50 transition-all">
                  <Play size={8} />{t('common.startAll', '全部啟動')}
                </button>
              )}
              {canStop && (
                <button type="button" onClick={() => void Promise.all(filteredAgents.filter(a => a.loaded).map(a => toggleLaunchAgent(a.label)))}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold border border-amber-200 dark:border-amber-800/40 text-amber-500 hover:bg-amber-50 transition-all">
                  <Pause size={8} />{t('common.stopAll', '全部停止')}
                </button>
              )}
            </div>
          );
        })()}
      </SectionCard>

      {/* Dialogs */}
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

      {editModalJob && editModalDraft && (
        <CronEditModal
          draft={editModalDraft}
          onChange={setEditModalDraft}
          allAgents={allAgents}
          modelOptionGroups={[]}
          configuredBotChannels={[]}
          authorizedRecipients={{}}
          buildCronExpr={buildCronExpr}
          onSave={() => {
            void updateCron(editModalJob.id, {
              name: editModalDraft.name,
              agentId: editModalDraft.agentId,
              ...(editModalDraft.model ? { model: editModalDraft.model } : { model: '' }),
              ...(editModalDraft.scheduleKind === 'cron'
                ? { scheduleExpr: buildCronExpr(editModalDraft) }
                : { everyMs: (Number(editModalDraft.intervalMin) || 10) * 60_000 }),
              ...(editModalDraft.timeoutMin !== '' ? { timeoutSeconds: Number(editModalDraft.timeoutMin) * 60 } : {}),
              delivery: {
                mode: editModalDraft.deliveryMode,
                ...(editModalDraft.deliveryChannel ? { channel: editModalDraft.deliveryChannel } : {}),
                ...(editModalDraft.deliveryTo ? { to: editModalDraft.deliveryTo } : {}),
              },
              ...(editModalDraft.payloadMessage ? { payloadMessage: editModalDraft.payloadMessage } : {}),
            });
          }}
          onCancel={() => { setEditModalJob(null); setEditModalDraft(null); }}
        />
      )}
    </div>
  );
}
