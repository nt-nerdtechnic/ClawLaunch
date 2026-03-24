import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Play, Pause, Trash2, RefreshCw,
  AlertTriangle, CheckCircle, Clock,
  CalendarClock, Zap, Activity, Server, Terminal, ClipboardList,
  Code2, FileEdit, Settings, ScanLine,
} from 'lucide-react';

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
  | { type: 'observed'; id: string; name: string; time: number; event: ObservedEvent };

interface ControlCenterPageProps {
  onRefreshSnapshot?: () => Promise<void>;
  stateDir?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSchedule(s: CronSchedule): string {
  if (s.kind === 'cron' && s.expr) return s.expr + (s.tz ? ` · ${s.tz}` : '');
  if (s.kind === 'every' && s.everyMs) {
    const m = s.everyMs / 60000;
    if (m < 1) return `每 ${s.everyMs / 1000}s`;
    if (m < 60) return `每 ${m.toFixed(0)}m`;
    return `每 ${(m / 60).toFixed(0)}h`;
  }
  return '—';
}

function relTime(ms?: number): string {
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 0) return '即將';
  if (d < 60000) return `${Math.floor(d / 1000)}s 前`;
  if (d < 3600000) return `${Math.floor(d / 60000)}m 前`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h 前`;
  return `${Math.floor(d / 86400000)}d 前`;
}

function nextTime(ms?: number): string {
  if (!ms) return '—';
  const d = ms - Date.now();
  if (d <= 0) return '待執行';
  if (d < 60000) return `${Math.floor(d / 1000)}s 後`;
  if (d < 3600000) return `${Math.floor(d / 60000)}m 後`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h 後`;
  return `${Math.floor(d / 86400000)}d 後`;
}

const TASK_STATUS_CFG: Record<TaskStatus, { label: string; dot: string; badge: string; bar: string }> = {
  todo:        { label: '待處理', dot: 'bg-slate-400',   badge: 'bg-slate-100 dark:bg-slate-800 text-slate-500',         bar: 'bg-slate-400' },
  in_progress: { label: '執行中', dot: 'bg-blue-500',    badge: 'bg-blue-50 dark:bg-blue-950/50 text-blue-600',          bar: 'bg-blue-500' },
  blocked:     { label: '封鎖中', dot: 'bg-rose-500',    badge: 'bg-rose-50 dark:bg-rose-950/50 text-rose-600',          bar: 'bg-rose-500' },
  done:        { label: '已完成', dot: 'bg-emerald-500', badge: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600', bar: 'bg-emerald-500' },
};

// ── Component ──────────────────────────────────────────────────────────────────

export const ControlCenterPage: React.FC<ControlCenterPageProps> = ({ onRefreshSnapshot, stateDir }) => {
  const [cronJobs, setCronJobs]       = useState<CronJob[]>([]);
  const [tasks, setTasks]             = useState<ManualTask[]>([]);
  const [crontabEntries, setCrontabEntries] = useState<CrontabEntry[]>([]);
  const [launchAgents, setLaunchAgents]     = useState<LaunchAgent[]>([]);
  const [observedEvents, setObservedEvents] = useState<ObservedEvent[]>([]);
  const [loading, setLoading]         = useState(false);
  const [cronLoading, setCronLoading] = useState(false);
  const [scanning, setScanning]       = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [error, setError]             = useState('');

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
      const items: ManualTask[] = (JSON.parse(res.stdout || '{}').items || []).map((t: any) => ({
        id: String(t.id || ''),
        title: String(t.title || ''),
        status: (['todo','in_progress','blocked','done'].includes(t.status) ? t.status : 'todo') as TaskStatus,
        priority: String(t.priority || 'medium'),
        overall_progress: Number(t.overall_progress ?? 0),
        updated_at: String(t.updated_at || t.updatedAt || ''),
        created_at: String(t.created_at || t.createdAt || ''),
      }));
      setTasks(items);
    } catch { setTasks([]); }
  }, []);

  const loadSystem = useCallback(async () => {
    try {
      const [ctRes, laRes] = await Promise.all([
        window.electronAPI.exec('system:crontab:list'),
        window.electronAPI.exec('system:launchagents:list'),
      ]);
      setCrontabEntries(JSON.parse(ctRes.stdout || '{}').entries || []);
      setLaunchAgents(JSON.parse(laRes.stdout || '{}').agents || []);
    } catch { /* non-fatal */ }
  }, []);

  const loadObservedEvents = useCallback(async () => {
    try {
      const api = window.electronAPI as any;
      if (!api.listActivityEvents) return;
      const res = await api.listActivityEvents({ limit: 200 });
      // res is { code, stdout, stderr } — events are inside stdout JSON
      const parsed = JSON.parse(res?.stdout || '{}');
      if (Array.isArray(parsed?.events)) setObservedEvents(parsed.events);
    } catch { /* non-fatal */ }
  }, []);

  const triggerScan = useCallback(async () => {
    setScanning(true);
    try {
      const api = window.electronAPI as any;
      if (api.scanActivityNow) {
        const r = await api.scanActivityNow();
        // scanActivityNow returns { code, stdout } directly from ipcMain.handle
        // just trigger then reload
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
    } catch (e: any) {
      setError(e?.message || '載入失敗');
    } finally { setLoading(false); }
  }, [loadCron, loadTasks, loadSystem, loadObservedEvents, onRefreshSnapshot]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => void Promise.all([loadCron(), loadTasks(), loadObservedEvents()]), 30000);
    return () => clearInterval(id);
  }, [loadCron, loadTasks, loadObservedEvents]);

  // ── Cron actions ───────────────────────────────────────────────────────────

  const toggleCron = async (jobId: string) => {
    await execCmd(`cron:toggle ${JSON.stringify({ jobId, stateDir })}`);
    await loadCron();
  };

  const deleteCron = async (jobId: string) => {
    await execCmd(`cron:delete ${JSON.stringify({ jobId, stateDir })}`);
    await loadCron();
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
        type: 'observed' as const,
        id: e.id,
        name: e.title,
        time: e.timestamp,
        event: e,
      }));

    return [...cronItems, ...taskItems, ...observedItems].sort((a, b) => b.time - a.time);
  }, [cronJobs, tasks, observedEvents]);

  // ── KPI ────────────────────────────────────────────────────────────────────

  const kpi = useMemo(() => {
    const day = Date.now() - 86400000;
    const recentCron = activityFeed.filter(a => a.type === 'cron' && a.time > day);
    const recentObserved = observedEvents.filter(e => e.timestamp > day);
    return {
      recentRuns:   recentCron.length,
      successCount: recentCron.filter(a => a.type === 'cron' && (a as any).status === 'ok').length,
      errorCount:   recentCron.filter(a => a.type === 'cron' && (a as any).hasError).length,
      enabled:      cronJobs.filter(j => j.enabled).length,
      total:        cronJobs.length,
      activeTasks:  tasks.filter(t => t.status === 'in_progress').length,
      pendingTasks: tasks.filter(t => t.status === 'todo').length,
      devEvents:    recentObserved.filter(e => e.category === 'development').length,
    };
  }, [activityFeed, cronJobs, tasks, observedEvents]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '24h 排程執行', value: kpi.recentRuns,   color: 'text-blue-600 dark:text-blue-400' },
          { label: '成功 / 異常',  value: `${kpi.successCount} / ${kpi.errorCount}`, color: kpi.errorCount > 0 ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400' },
          { label: '24h 開發事件', value: kpi.devEvents,    color: 'text-indigo-600 dark:text-indigo-400' },
          { label: '執行中 / 待辦', value: `${kpi.activeTasks} / ${kpi.pendingTasks}`, color: 'text-amber-500 dark:text-amber-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[22px] p-4 shadow-sm text-center">
            <div className={`text-2xl font-black ${color}`}>{value}</div>
            <div className="text-[10px] text-slate-500 mt-0.5 tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        {/* ── Left: Mixed activity timeline ──────────────────────────────── */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-sm overflow-hidden">
          <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(99,102,241,0.5),transparent)' }} />
          <div className="p-6 space-y-3">

            {/* Title */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity size={13} className="text-indigo-500" />
                <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-900 dark:text-slate-100">作業時間軸</h3>
                <span className="text-[10px] text-slate-400">{activityFeed.length} 項</span>
              </div>
              <div className="flex items-center gap-2">
                {/* Legend */}
                <span className="flex items-center gap-1 text-[9px] text-slate-400">
                  <CalendarClock size={9} className="text-violet-400" />排程
                </span>
                <span className="flex items-center gap-1 text-[9px] text-slate-400">
                  <ClipboardList size={9} className="text-amber-400" />任務
                </span>
                <span className="flex items-center gap-1 text-[9px] text-slate-400">
                  <ScanLine size={9} className="text-indigo-400" />觀察
                </span>
                <div className="w-px h-3 bg-slate-200 dark:bg-slate-700" />
                {lastRefreshed && (
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {lastRefreshed.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
                <button
                  onClick={() => void triggerScan()}
                  title="立即掃描 Agent 作業"
                  className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-800 text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-all"
                >
                  <ScanLine size={10} className={scanning ? 'animate-pulse' : ''} />
                </button>
                <button
                  onClick={() => void refresh()}
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
                  <span className="text-sm">尚無作業紀錄</span>
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
                        <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{relTime(item.time)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 pl-7 text-[10px] flex-wrap">
                        {/* Status */}
                        <span className={`flex items-center gap-0.5 font-medium ${isOk ? 'text-emerald-600 dark:text-emerald-400' : isErr ? 'text-rose-500' : 'text-slate-400'}`}>
                          {isOk ? <CheckCircle size={9} /> : isErr ? <AlertTriangle size={9} /> : <Clock size={9} />}
                          {isOk ? '成功' : isErr ? '失敗' : '執行'}
                        </span>
                        {item.duration !== undefined && (
                          <>
                            <span className="text-slate-300 dark:text-slate-700">·</span>
                            <span className="text-slate-400">{(item.duration / 1000).toFixed(1)}s</span>
                          </>
                        )}
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        <span className="text-violet-400/80 font-mono">{formatSchedule(item.schedule)}</span>
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
                        <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{relTime(item.time)}</span>
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
                } else if (item.type === 'observed') {
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
                  const srcLabel = ev.source === 'fs' ? '檔案系統'
                    : ev.source === 'jsonl' ? 'Agent 作業'
                    : ev.source === 'cron' ? '排程'
                    : '系統';
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
                        <span className="shrink-0 text-[10px] text-slate-400 tabular-nums">{relTime(item.time)}</span>
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
          <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(16,185,129,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Server size={12} className="text-emerald-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">系統服務</span>
                <span className="text-[9px] text-slate-400">LaunchAgents</span>
              </div>
              {launchAgents.length === 0 ? (
                <p className="text-[11px] text-slate-400 py-1">未偵測到系統服務</p>
              ) : launchAgents.map(agent => (
                <div key={agent.label} className="flex items-center gap-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50 px-3 py-2">
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
                    {agent.running ? `運行 · ${agent.pid}` : agent.loaded ? '已載入' : agent.plistExists ? '未載入' : '未安裝'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Layer 2: crontab */}
          <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(245,158,11,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center gap-2 mb-3">
                <Terminal size={12} className="text-amber-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">系統排程</span>
                <span className="text-[9px] text-slate-400">crontab · {crontabEntries.length} 項</span>
              </div>
              {crontabEntries.length === 0 ? (
                <p className="text-[11px] text-slate-400 py-1">無 crontab 項目</p>
              ) : crontabEntries.map((entry, i) => (
                <div key={i} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Zap size={10} className="text-amber-400 shrink-0" />
                    <span className="flex-1 min-w-0 text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate">{entry.name}</span>
                  </div>
                  <div className="mt-1 pl-4 flex items-center gap-2 text-[10px] text-slate-400">
                    <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{entry.schedule}</span>
                    <span className="truncate max-w-[160px] opacity-60">{entry.command.split('/').slice(-2).join('/')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Layer 3: OpenClaw scheduling */}
          <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(139,92,246,0.45),transparent)' }} />
            <div className="p-5 space-y-2">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <CalendarClock size={12} className="text-violet-500" />
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">應用排程</span>
                  <span className="text-[9px] text-slate-400">OpenClaw · {cronJobs.length} 個</span>
                </div>
                <button
                  onClick={async () => { setCronLoading(true); await loadCron(); setCronLoading(false); }}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
                >
                  <RefreshCw size={9} className={cronLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-0.5">
                {cronJobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                    <CalendarClock size={22} className="mb-2 opacity-30" />
                    <span className="text-sm">沒有排程任務</span>
                  </div>
                ) : [...cronJobs].sort((a, b) => (b.state?.lastRunAtMs ?? 0) - (a.state?.lastRunAtMs ?? 0)).map(job => {
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
                          <button onClick={() => void toggleCron(job.id)} title={job.enabled ? '暫停' : '啟動'}
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
                        <span className="font-mono">{formatSchedule(job.schedule)}</span>
                        {job.state?.lastRunAtMs && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="flex items-center gap-0.5">
                              {job.state.lastStatus === 'ok'
                                ? <CheckCircle size={8} className="text-emerald-500" />
                                : <AlertTriangle size={8} className="text-rose-400" />}
                              {relTime(job.state.lastRunAtMs)}
                            </span>
                          </>
                        )}
                        {job.enabled && job.state?.nextRunAtMs && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="text-violet-400">{nextTime(job.state.nextRunAtMs)}</span>
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
