import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Play, Pause, Trash2, RefreshCw,
  AlertTriangle, CheckCircle, Clock,
  CalendarClock, Activity, Server, Terminal, ClipboardList,
  Code2, FileEdit, Settings, ScanLine,
} from 'lucide-react';
import cronstrue from 'cronstrue/i18n';

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

interface ManualTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: string;
  overall_progress: number;
  updated_at: string;
  created_at: string;
}

interface CrontabEntry {
  schedule: string;
  command: string;
  name: string;
  raw: string;
  enabled?: boolean;
}

interface LaunchAgent {
  label: string;
  name: string;
  plistExists: boolean;
  keepAlive: boolean;
  comment: string;
  loaded: boolean;
  running: boolean;
  pid: number | null;
  exitCode: number | null;
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
}

// Observed activity event from the Activity Engine
interface ObservedEvent {
  id: string;
  timestamp: number;
  source: 'fs' | 'jsonl' | 'cron' | 'system';
  type: string;
  category: 'development' | 'execution' | 'scheduled' | 'task' | 'config' | 'alert' | 'system';
  title: string;
  detail?: string;
  path?: string;
  agent?: string;
  exitCode?: number;
}

// Unified activity entries
type ActivityItem =
  | { type: 'cron'; id: string; name: string; time: number; status?: 'ok' | 'error'; duration?: number; hasError: boolean; error?: string; schedule: CronSchedule }
  | { type: 'task'; id: string; name: string; time: number; taskStatus: TaskStatus; progress: number; priority: string }
  | { type: 'obs'; id: string; name: string; time: number; event: ObservedEvent };

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

function nextTime(ms: number | undefined, t: TFunction): string {
  if (!ms) return '—';
  const d = ms - Date.now();
  if (d <= 0) return t('common.time.pending');
  if (d < 60000) return t('common.time.later', { val: `${Math.floor(d / 1000)}s` });
  if (d < 3600000) return t('common.time.later', { val: `${Math.floor(d / 60000)}m` });
  if (d < 86400000) return t('common.time.later', { val: `${Math.floor(d / 3600000)}h` });
  return t('common.time.later', { val: `${Math.floor(d / 86400000)}d` });
}

const TASK_STATUS_CFG: Record<TaskStatus, { label: string; dot: string; badge: string; bar: string }> = {
  todo:        { label: '', dot: 'bg-slate-400',   badge: 'bg-slate-100 dark:bg-slate-800 text-slate-500',         bar: 'bg-slate-400' },
  in_progress: { label: '', dot: 'bg-blue-500',    badge: 'bg-blue-50 dark:bg-blue-950/50 text-blue-600',          bar: 'bg-blue-500' },
  blocked:     { label: '', dot: 'bg-rose-500',    badge: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600',          bar: 'bg-rose-500' },
  done:        { label: '', dot: 'bg-emerald-500', badge: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600', bar: 'bg-emerald-500' },
};

export const ControlCenterPage: React.FC<ControlCenterPageProps> = ({ onRefreshSnapshot, stateDir }) => {
  const { t } = useTranslation();
  const [cronJobs, setCronJobs]       = useState<CronJob[]>([]);
  const [tasks, setTasks]             = useState<ManualTask[]>([]);
  const [crontabEntries, setCrontabEntries] = useState<CrontabEntry[]>([]);
  const [launchAgents, setLaunchAgents]     = useState<LaunchAgent[]>([]);
  const [observedEvents, setObservedEvents] = useState<ObservedEvent[]>([]);
  const [loading, setLoading]         = useState(false);
  const [cronLoading, setCronLoading] = useState(false);
  const [systemLoading, setSystemLoading] = useState(false);
  const [scanning, setScanning]       = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [error, setError]             = useState('');
  const [view, setView]               = useState<'all' | 'cron' | 'task' | 'obs'>('all');
  const [agentFilter, setAgentFilter] = useState<'all' | 'running' | 'loaded'>('all');
  const [ctFilter, setCtFilter]       = useState<'all' | 'enabled' | 'disabled'>('all');
  const [cjFilter, setCjFilter]       = useState<'all' | 'enabled' | 'disabled' | 'error'>('all');
  const { i18n } = useTranslation();

  // Update TASK_STATUS_CFG to use t after useTranslation is available
  useMemo(() => {
    TASK_STATUS_CFG.todo.label = t('common.status.todo');
    TASK_STATUS_CFG.in_progress.label = t('common.status.in_progress');
    TASK_STATUS_CFG.blocked.label = t('common.status.blocked');
    TASK_STATUS_CFG.done.label = t('common.status.done');
  }, [t]);

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

  const loadTasks = useCallback(async () => {
    try {
      const res = await window.electronAPI.exec('control:tasks:list');
      console.log('[ControlCenter] loadTasks res:', res.stdout);
      const items: ManualTask[] = (JSON.parse(res.stdout || '{}').items || []).map((t: Record<string, unknown>) => ({
        id: String(t.id || ''),
        title: String(t.title || ''),
        status: (['todo','in_progress','blocked','done'].includes(t.status as string) ? t.status as string : 'todo') as TaskStatus,
        priority: String(t.priority || 'medium'),
        overall_progress: Number(t.overall_progress ?? 0),
        updated_at: String(t.updated_at || t.updatedAt || ''),
        created_at: String(t.created_at || t.createdAt || ''),
      }));
      console.log(`[ControlCenter] loadTasks parsed ${items.length} items`);
      setTasks(items);
    } catch (e) { 
      console.error('[ControlCenter] loadTasks failed:', e);
      setTasks([]); 
    }
  }, []);

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

  const loadObservedEvents = useCallback(async () => {
    try {
      if (!window.electronAPI.listActivityEvents) return;
      const res = await window.electronAPI.listActivityEvents({ limit: 200 });
      // res is { code, stdout, stderr } — events are inside stdout JSON
      const parsed = JSON.parse(res?.stdout || '{}');
      if (Array.isArray(parsed?.events)) setObservedEvents(parsed.events);
    } catch { /* non-fatal */ }
  }, []);

  const triggerScan = useCallback(async () => {
    setScanning(true);
    try {
      if (window.electronAPI.scanActivityNow) {
        const r = await window.electronAPI.scanActivityNow();
        void r;
      }
      await loadObservedEvents();
    } finally { setScanning(false); }
  }, [loadObservedEvents]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadCron(), loadTasks(), loadSystem(), loadObservedEvents()]);
      if (onRefreshSnapshot) await onRefreshSnapshot();
      setLastRefreshed(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('controlCenter.errors.genericLoadFailed'));
    } finally { setLoading(false); }
  }, [loadCron, loadTasks, loadSystem, loadObservedEvents, onRefreshSnapshot, t]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => void Promise.all([loadCron(), loadTasks(), loadSystem(), loadObservedEvents()]), 30000);
    return () => clearInterval(id);
  }, [loadCron, loadTasks, loadSystem, loadObservedEvents]);

  // ── Cron actions ───────────────────────────────────────────────────────────

  const toggleCron = async (jobId: string) => {
    await execCmd(`cron:toggle ${JSON.stringify({ jobId, stateDir })}`);
    await loadCron();
  };

  const deleteCron = async (jobId: string) => {
    await execCmd(`cron:delete ${JSON.stringify({ jobId, stateDir })}`);
    await loadCron();
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

  // ── Merged activity feed ───────────────────────────────────────────────────

  const activityFeed = useMemo((): ActivityItem[] => {
    const cronItems: ActivityItem[] = cronJobs
      .filter(j => j.state?.lastRunAtMs)
      .map(j => ({
        type: 'cron',
        id: j.id,
        name: j.name,
        time: j.state.lastRunAtMs!,
        status: j.state.lastStatus,
        duration: j.state.lastDurationMs,
        hasError: (j.state.consecutiveErrors ?? 0) > 0,
        error: j.state.lastError,
        schedule: j.schedule,
      }));

    const taskItems: ActivityItem[] = tasks.map(t => {
      const ts = t.updated_at || t.created_at;
      return {
        type: 'task',
        id: t.id,
        name: t.title,
        time: ts ? new Date(ts).getTime() : 0,
        taskStatus: t.status,
        progress: t.overall_progress,
        priority: t.priority,
      };
    });

    // Deduplicate observed events against cron items (same timestamp+source)
    const cronTimestamps = new Set(cronItems.map(c => c.time));
    const observedItems: ActivityItem[] = observedEvents
      .filter(e => e.source !== 'cron' || !cronTimestamps.has(e.timestamp))
      .map(e => ({
        type: 'obs' as const,
        id: e.id,
        name: e.title,
        time: e.timestamp,
        event: e,
      }));

    const allItems = [...cronItems, ...taskItems, ...observedItems];

    return allItems
      .filter(item => {
        if (view === 'all') return true;
        return item.type === view;
      })
      .sort((a, b) => b.time - a.time);
  }, [cronJobs, tasks, observedEvents, view]);

  // ── KPI ────────────────────────────────────────────────────────────────────

  const kpi = useMemo(() => {
    // 1. 作業紀錄 (Timeline) - 與下方渲染標題旁顯示的 activityFeed.length 一致
    const totalActivities = activityFeed.length;

    // 2. 內部排程 (Cron) - 指下方「系統排程」區塊
    const totalCrons = (cronJobs || []).length;
    const activeCrons = (cronJobs || []).filter(j => j.enabled).length;

    // 3. 系統服務 (LaunchAgents)
    const totalAgents = (launchAgents || []).length;
    const runningAgents = (launchAgents || []).filter(a => a.running).length;

    // 4. 待辦任務 (Tasks) - 用戶改稱為「應用排程」的部分數據？
    // 但根據用戶要求，應用排程應為原先的 cronJobs (內部排程)，系統排程為 crontabEntries
    const totalTasks = (tasks || []).length;

    return {
      activityTimeline: totalActivities,
      systemServices: { running: runningAgents, total: totalAgents },
      crontabEntriesCount: (crontabEntries || []).length,
      cronSchedules: { active: activeCrons, total: totalCrons },
      manualTasks: totalTasks,
    };
  }, [activityFeed, cronJobs, tasks, launchAgents, crontabEntries]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { 
            label: t('controlCenter.kpi.activityTimeline', '作業時間軸'), 
            value: kpi.activityTimeline, 
            color: 'text-indigo-600 dark:text-indigo-400',
            targetId: 'activity-timeline-section'
          },
          { 
            label: t('controlCenter.kpi.systemServices', '系統服務'), 
            value: kpi.systemServices.total, 
            color: kpi.systemServices.running < kpi.systemServices.total ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400',
            targetId: 'system-services-section'
          },
          { 
            label: t('controlCenter.kpi.crontabEntries', '系統排程'), 
            value: kpi.crontabEntriesCount, 
            color: 'text-blue-600 dark:text-blue-400',
            targetId: 'system-crontab-section'
          },
          { 
            label: t('controlCenter.kpi.cronSchedules', '應用排程'), 
            value: kpi.cronSchedules.total, 
            color: 'text-violet-600 dark:text-violet-400',
            targetId: 'application-scheduling-section'
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        {/* ── Left: Mixed activity timeline ──────────────────────────────── */}
        <div id="activity-timeline-section" className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
          <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(99,102,241,0.5),transparent)' }} />
          <div className="p-6 space-y-3">

            {/* Title */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity size={13} className="text-indigo-500" />
                <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-900 dark:text-slate-100">{t('controlCenter.timeline.title')}</h3>
                <span className="text-[10px] text-slate-400">{t('controlCenter.timeline.count', { count: activityFeed.length })}</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Unified Filter Buttons */}
                <div className="flex items-center gap-1 border-r border-slate-200 dark:border-slate-700 pr-2 mr-1">
                    {(['all', 'cron', 'task', 'obs'] as const).map(f => {
                      const isActive = view === f;
                      const color = f === 'cron' ? (isActive ? 'bg-violet-500 border-violet-500' : 'text-violet-400')
                                  : f === 'task' ? (isActive ? 'bg-amber-500 border-amber-500' : 'text-amber-400')
                                  : f === 'obs'  ? (isActive ? 'bg-indigo-500 border-indigo-500' : 'text-indigo-400')
                                  : (isActive ? 'bg-slate-600 border-slate-600' : 'text-slate-400');
                      const Icon = f === 'cron' ? CalendarClock : f === 'task' ? ClipboardList : f === 'obs' ? ScanLine : Activity;
                      const label = f === 'all' ? t('controlCenter.timeline.tabs.all') 
                                  : f === 'cron' ? t('controlCenter.timeline.tabs.cron') 
                                  : f === 'task' ? t('controlCenter.timeline.tabs.task') 
                                  : t('controlCenter.timeline.tabs.observation');
                      return (
                        <button
                          key={f}
                          onClick={() => setView(f)}
                          title={label}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[9px] font-bold transition-all ${
                            isActive ? `${color} text-white` : `bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 ${color}`
                          }`}
                        >
                          <Icon size={8} />
                          <span className="hidden sm:inline">{label}</span>
                        </button>
                      );
                    })}
                </div>
                {lastRefreshed && (
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {lastRefreshed.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
                <button
                  onClick={() => void triggerScan()}
                  title={t('controlCenter.timeline.scanBtn')}
                  className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-all"
                >
                  <ScanLine size={10} className={scanning ? 'animate-pulse' : ''} />
                </button>
                <button
                  onClick={() => void refresh()}
                  title={t('controlCenter.actions.refresh')}
                  className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all"
                >
                  <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>


            {/* Timeline list */}
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-0.5">
              {activityFeed.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Activity size={28} className="mb-2 opacity-25" />
                  <span className="text-sm">{t('controlCenter.timeline.empty')}</span>
                </div>
              ) : activityFeed.map((item, i) => {
                if (item.type === 'cron') {
                  const isOk = item.status === 'ok';
                  const isErr = item.status === 'error';
                  return (
                    <div
                      key={`cron-${item.id}-${i}`}
                      className={`rounded-2xl border px-3.5 py-2.5 transition-all ${
                        item.hasError
                          ? 'border-rose-200 dark:border-rose-800/40 bg-rose-50/30 dark:bg-rose-950/10'
                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {/* Schedule icon */}
                        <div className="shrink-0 w-5 h-5 rounded-lg bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center">
                          <CalendarClock size={10} className="text-violet-500" />
                        </div>
                        <span className="flex-1 min-w-0 text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {item.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{relTime(item.time, t)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 pl-7 text-[10px] flex-wrap">
                        {/* Status */}
                        <span className={`flex items-center gap-0.5 font-medium ${isOk ? 'text-emerald-600 dark:text-emerald-400' : isErr ? 'text-rose-500' : 'text-slate-400'}`}>
                          {isOk ? <CheckCircle size={9} /> : isErr ? <AlertTriangle size={9} /> : <Clock size={9} />}
                          {isOk ? t('common.status.success') : isErr ? t('common.status.failure') : t('common.status.exec')}
                        </span>
                        {item.duration !== undefined && (
                          <>
                            <span className="text-slate-300 dark:text-slate-700">·</span>
                            <span className="text-slate-400">{(item.duration / 1000).toFixed(1)}s</span>
                          </>
                        )}
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        <span className="text-violet-400/80 font-mono">{formatInterval(item.schedule, t)}</span>
                        {item.hasError && item.error && (
                          <>
                            <span className="text-slate-300 dark:text-slate-700">·</span>
                            <span className="text-rose-400 truncate max-w-[140px]">{item.error}</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                } else if (item.type === 'task') {
                  // task item
                  const cfg = TASK_STATUS_CFG[item.taskStatus];
                  const progress = Math.min(100, Math.max(0, item.progress));
                  const isDone = item.taskStatus === 'done';
                  return (
                    <div
                      key={`task-${item.id}-${i}`}
                      className={`rounded-2xl border px-3.5 py-2.5 transition-all ${
                        isDone
                          ? 'border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 opacity-60'
                          : 'border-amber-100 dark:border-amber-900/30 bg-amber-50/20 dark:bg-amber-950/10'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {/* Task icon */}
                        <div className="shrink-0 w-5 h-5 rounded-lg bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
                          <ClipboardList size={10} className="text-amber-500" />
                        </div>
                        <span className={`flex-1 min-w-0 text-[12px] font-semibold truncate ${isDone ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
                          {item.name}
                        </span>
                        <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-lg ${cfg.badge}`}>
                          {cfg.label}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{relTime(item.time, t)}</span>
                      </div>
                      {/* Progress bar */}
                      {progress > 0 && (
                        <div className="mt-1.5 flex items-center gap-2 pl-7">
                          <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-[9px] text-slate-400 font-mono">{progress.toFixed(0)}%</span>
                        </div>
                      )}
                    </div>
                  );
                } else if (item.type === 'obs') {
                  // observed event
                  const ev = item.event;
                  const catIcon = ev.category === 'development'
                    ? <Code2 size={10} className="text-indigo-500" />
                    : ev.category === 'execution'
                    ? <Terminal size={10} className="text-sky-500" />
                    : ev.category === 'config'
                    ? <Settings size={10} className="text-slate-500" />
                    : ev.category === 'alert'
                    ? <AlertTriangle size={10} className="text-rose-500" />
                    : <FileEdit size={10} className="text-slate-400" />;
                  const catColor = ev.category === 'development'
                    ? 'bg-indigo-50 dark:bg-indigo-950/40'
                    : ev.category === 'execution'
                    ? 'bg-sky-50 dark:bg-sky-950/40'
                    : ev.category === 'config'
                    ? 'bg-slate-100 dark:bg-slate-800/60'
                    : ev.category === 'alert'
                    ? 'bg-rose-50 dark:bg-rose-950/30'
                    : 'bg-slate-50 dark:bg-slate-900/40';
                  const borderColor = ev.category === 'development'
                    ? 'border-indigo-100 dark:border-indigo-900/40'
                    : ev.category === 'alert'
                    ? 'border-rose-200 dark:border-rose-800/40'
                    : 'border-slate-100 dark:border-slate-800';
                  const srcLabel = ev.source === 'fs' ? t('common.source.fs')
                    : ev.source === 'jsonl' ? t('common.source.agent')
                    : ev.source === 'cron' ? t('common.source.cron')
                    : t('common.source.system');
                  return (
                    <div
                      key={`obs-${item.id}-${i}`}
                      className={`rounded-2xl border px-3.5 py-2.5 transition-all ${borderColor} ${catColor}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="shrink-0 w-5 h-5 rounded-lg bg-white/60 dark:bg-slate-900/50 flex items-center justify-center">
                          {catIcon}
                        </div>
                        <span className="flex-1 min-w-0 text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {item.name}
                        </span>
                        <span className="shrink-0 text-[9px] text-slate-400 font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800">
                          {srcLabel}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{relTime(item.time, t)}</span>
                      </div>
                      {ev.detail && (
                        <div className="mt-1 pl-7 text-[10px] text-slate-400 truncate max-w-full">
                          {ev.detail.slice(0, 100)}
                        </div>
                      )}
                    </div>
                  );
                } else { return null; }
              })}
            </div>
          </div>
        </div>

        {/* ── Right: Three-layer scheduling ──────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Layer 1: System services */}
          <div id="system-services-section" className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(16,185,129,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Server size={12} className="text-emerald-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{t('controlCenter.services.title')}</span>
                <span className="text-[9px] text-slate-400">LaunchAgents</span>
                <div className="flex items-center gap-1 ml-auto">
                  {(['all', 'running', 'loaded'] as const).map(f => {
                    const isActive = agentFilter === f;
                    const Icon = f === 'all' ? Activity : f === 'running' ? CheckCircle : Clock;
                    const label = f === 'all' ? t('controlCenter.timeline.tabs.all') 
                                : f === 'running' ? t('common.agent.running', { pid: '' }).split(' ')[0] 
                                : t('common.agent.loaded');
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
                  if (agentFilter === 'running') return a.running;
                  if (agentFilter === 'loaded') return a.loaded;
                  return true;
                })
                .map(agent => (
                <div key={agent.label} className={`flex items-center gap-2.5 rounded-xl border border-slate-100 dark:border-slate-800 px-3 py-2 transition-all ${
                  agent.loaded ? 'bg-white dark:bg-slate-900/50' : 'bg-slate-50/60 dark:bg-slate-900/20 opacity-50'
                }`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${agent.running ? 'bg-emerald-500' : agent.loaded ? 'bg-amber-400' : 'bg-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate">{agent.name}</div>
                    <div className="text-[9px] text-slate-400 truncate">{agent.label}</div>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-lg ${
                    agent.running ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                    : agent.loaded ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                  }`}>
                    {agent.running ? t('common.agent.running', { pid: agent.pid }) : agent.loaded ? t('common.agent.loaded') : agent.plistExists ? t('common.agent.unloaded') : t('common.agent.notInstalled')}
                  </span>
                  
                  {agent.plistExists && (
                    <div className="flex items-center gap-0.5 shrink-0 ml-2">
                      <button onClick={() => void toggleLaunchAgent(agent.label)} title={agent.loaded ? t('controlCenter.cronJobs.pause') : t('controlCenter.cronJobs.start')}
                        className={`p-1 rounded-lg transition-all ${agent.loaded ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-emerald-600'}`}>
                        {agent.loaded ? <Pause size={10} /> : <Play size={10} />}
                      </button>
                      <button onClick={() => void deleteLaunchAgent(agent.label)}
                        className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Layer 2: crontab */}
          <div id="system-crontab-section" className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(245,158,11,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Terminal size={12} className="text-amber-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{t('controlCenter.crontab.title')}</span>
                <span className="text-[9px] text-slate-400">{t('controlCenter.crontab.count', { count: crontabEntries.length })}</span>
                <div className="flex items-center gap-1 ml-auto">
                  {(['all', 'enabled', 'disabled'] as const).map(f => {
                    const isActive = ctFilter === f;
                    const Icon = f === 'all' ? Activity : f === 'enabled' ? CheckCircle : Clock;
                    const label = f === 'all' ? t('controlCenter.timeline.tabs.all') 
                                : f === 'enabled' ? t('common.status.success') 
                                : t('common.status.todo');
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
                <div key={i} className={`rounded-xl border px-3 py-2 transition-all ${
                  entry.enabled !== false ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50' : 'border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/20 opacity-50'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${entry.enabled !== false ? 'bg-amber-400' : 'bg-slate-400'}`} />
                    <span className="flex-1 min-w-0 text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate">{entry.name}</span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => void toggleCrontab(entry.raw)} title={entry.enabled !== false ? t('controlCenter.cronJobs.pause') : t('controlCenter.cronJobs.start')}
                        className={`p-1 rounded-lg transition-all ${entry.enabled !== false ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-amber-600'}`}>
                        {entry.enabled !== false ? <Pause size={10} /> : <Play size={10} />}
                      </button>
                      <button onClick={() => void deleteCrontab(entry.raw)}
                        className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all">
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1 pl-3.5 flex items-center gap-2 text-[10px] text-slate-400">
                    <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded" title={describeCron(entry.schedule, i18n.language)}>
                      {entry.schedule}
                    </span>
                    <span className="text-violet-400/80 max-w-[120px] truncate" title={describeCron(entry.schedule, i18n.language)}>
                      {describeCron(entry.schedule, i18n.language)}
                    </span>
                    <span className="truncate max-w-[140px] opacity-60 ml-auto">{entry.command.split('/').slice(-2).join('/')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Layer 3: OpenClaw scheduling */}
          <div id="application-scheduling-section" className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden scroll-mt-2 md:scroll-mt-4">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(139,92,246,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <CalendarClock size={12} className="text-violet-500" />
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">{t('controlCenter.cronJobs.title')}</span>
                  <span className="text-[9px] text-slate-400">{t('controlCenter.cronJobs.count', { count: cronJobs.length })}</span>
                </div>
                <div className="flex items-center gap-1">
                  {(['all', 'enabled', 'disabled', 'error'] as const).map(f => {
                    const isActive = cjFilter === f;
                    const Icon = f === 'all' ? Activity : f === 'enabled' ? CheckCircle : f === 'disabled' ? Clock : AlertTriangle;
                    const label = f === 'all' ? t('controlCenter.timeline.tabs.all') 
                                : f === 'enabled' ? t('common.status.success') 
                                : f === 'disabled' ? t('common.status.todo') 
                                : t('common.status.failure');
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
                    if (cjFilter === 'error') return (j.state?.consecutiveErrors ?? 0) > 0;
                    return true;
                  })
                  .sort((a, b) => (b.state?.lastRunAtMs ?? 0) - (a.state?.lastRunAtMs ?? 0)).map(job => {
                  const hasError = (job.state?.consecutiveErrors ?? 0) > 0;
                  return (
                    <div key={job.id} className={`rounded-xl border px-3 py-2.5 transition-all ${
                      hasError ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/10'
                      : job.enabled ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                      : 'border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/20 opacity-50'
                    }`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${job.enabled ? 'bg-violet-500' : 'bg-slate-400'}`} />
                        <span className="flex-1 min-w-0 text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">{job.name}</span>
                        {hasError && <AlertTriangle size={10} className="text-amber-500 shrink-0" />}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => void toggleCron(job.id)} title={job.enabled ? t('controlCenter.cronJobs.pause') : t('controlCenter.cronJobs.start')}
                            className={`p-1 rounded-lg transition-all ${job.enabled ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-violet-600'}`}>
                            {job.enabled ? <Pause size={10} /> : <Play size={10} />}
                          </button>
                          <button onClick={() => void deleteCron(job.id)}
                            className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all">
                            <Trash2 size={10} />
                          </button>
                        </div>
                      </div>
                      <div className="mt-1 flex items-center gap-2 pl-3.5 text-[9px] text-slate-400 flex-wrap">
                        <span className="font-mono">{formatInterval(job.schedule, t)}</span>
                        {job.state?.lastRunAtMs && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="flex items-center gap-0.5">
                              {job.state.lastStatus === 'ok'
                                ? <CheckCircle size={8} className="text-emerald-500" />
                                : <AlertTriangle size={8} className="text-rose-400" />}
                              {relTime(job.state.lastRunAtMs, t)}
                            </span>
                          </>
                        )}
                        {job.enabled && job.state?.nextRunAtMs && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="text-violet-400">{nextTime(job.state.nextRunAtMs, t)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300 px-4 py-3 text-sm">
          {error}
        </div>
      )}
    </div>
  );
};
