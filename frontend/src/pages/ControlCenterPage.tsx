import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Pause, Trash2, Plus, RefreshCw, AlertTriangle, CheckCircle, Clock, ListTodo, CalendarClock } from 'lucide-react';

type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  scope: string;
  updatedAt: string;
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

interface ControlCenterPageProps {
  onRefreshSnapshot?: () => Promise<void>;
  stateDir?: string;
}

const STATUS_CFG: Record<TaskStatus, { label: string; dot: string; badge: string; text: string }> = {
  todo:        { label: '待處理', dot: 'bg-slate-400',   badge: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',   text: 'text-slate-600 dark:text-slate-400' },
  in_progress: { label: '執行中', dot: 'bg-blue-500',    badge: 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300',      text: 'text-blue-700 dark:text-blue-300' },
  blocked:     { label: '封鎖中', dot: 'bg-rose-500',    badge: 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300',      text: 'text-rose-700 dark:text-rose-300' },
  done:        { label: '已完成', dot: 'bg-emerald-500', badge: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300', text: 'text-emerald-700 dark:text-emerald-300' },
};

function formatSchedule(s: CronSchedule): string {
  if (s.kind === 'cron' && s.expr) return s.expr + (s.tz ? ` · ${s.tz}` : '');
  if (s.kind === 'every' && s.everyMs) {
    const m = s.everyMs / 60000;
    return m < 60 ? `每 ${m} 分鐘` : `每 ${(m / 60).toFixed(0)} 小時`;
  }
  return '-';
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
  if (d < 60000) return `${Math.floor(d / 1000)}s`;
  if (d < 3600000) return `${Math.floor(d / 60000)}m`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h`;
  return `${Math.floor(d / 86400000)}d`;
}

export const ControlCenterPage: React.FC<ControlCenterPageProps> = ({ onRefreshSnapshot, stateDir }) => {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskLoading, setTaskLoading] = useState(false);
  const [cronLoading, setCronLoading] = useState(false);
  const [error, setError] = useState('');

  const execCmd = useCallback(async (cmd: string) => {
    const res = await window.electronAPI.exec(cmd);
    const code = res.code ?? res.exitCode;
    if (code !== 0) throw new Error(res.stderr || 'command failed');
    return res;
  }, []);

  const loadTasks = useCallback(async () => {
    try {
      const res = await window.electronAPI.exec('control:tasks:list');
      const parsed = JSON.parse(res.stdout || '{}');
      setTasks((parsed.items || []).map((item: any) => ({
        id: String(item.id || ''),
        title: String(item.title || ''),
        status: (['todo','in_progress','blocked','done'].includes(item.status) ? item.status : 'todo') as TaskStatus,
        scope: String(item.scope || ''),
        updatedAt: String(item.updatedAt || ''),
      })));
    } catch { setTasks([]); }
  }, []);

  const loadCron = useCallback(async () => {
    try {
      const cmd = stateDir ? `cron:list ${JSON.stringify({ stateDir })}` : 'cron:list';
      const res = await window.electronAPI.exec(cmd);
      const parsed = JSON.parse(res.stdout || '{}');
      setCronJobs(parsed.jobs || []);
    } catch { setCronJobs([]); }
  }, [stateDir]);

  const refreshTasks = useCallback(async () => {
    setTaskLoading(true);
    setError('');
    try {
      await window.electronAPI.exec('control:auto-sync');
      await loadTasks();
      if (onRefreshSnapshot) await onRefreshSnapshot();
    } catch (e: any) {
      setError(e?.message || '載入失敗');
    } finally { setTaskLoading(false); }
  }, [loadTasks, onRefreshSnapshot]);

  const refreshCron = useCallback(async () => {
    setCronLoading(true);
    await loadCron();
    setCronLoading(false);
  }, [loadCron]);

  useEffect(() => { void refreshTasks(); void loadCron(); }, [refreshTasks, loadCron]);

  const addTask = async () => {
    const title = taskTitle.trim();
    if (!title) return;
    await execCmd(`control:tasks:add ${JSON.stringify({ title })}`);
    setTaskTitle('');
    await loadTasks();
  };

  const updateStatus = async (taskId: string, status: TaskStatus) => {
    await execCmd(`control:tasks:update-status ${JSON.stringify({ taskId, status })}`);
    await loadTasks();
  };

  const deleteTask = async (taskId: string) => {
    await execCmd(`control:tasks:delete ${JSON.stringify({ taskId })}`);
    await loadTasks();
  };

  const toggleCron = async (jobId: string) => {
    await execCmd(`cron:toggle ${JSON.stringify({ jobId, stateDir })}`);
    await loadCron();
  };

  const deleteCron = async (jobId: string) => {
    await execCmd(`cron:delete ${JSON.stringify({ jobId, stateDir })}`);
    await loadCron();
  };

  const kpi = useMemo(() => ({
    running:  tasks.filter(t => t.status === 'in_progress').length,
    blocked:  tasks.filter(t => t.status === 'blocked').length,
    todo:     tasks.filter(t => t.status === 'todo').length,
    done:     tasks.filter(t => t.status === 'done').length,
    enabled:  cronJobs.filter(j => j.enabled).length,
    disabled: cronJobs.filter(j => !j.enabled).length,
    errors:   cronJobs.filter(j => (j.state?.consecutiveErrors ?? 0) > 0).length,
  }), [tasks, cronJobs]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">

      {/* KPI 列 */}
      <div className="grid grid-cols-2 gap-4">
        {/* 任務 KPI */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <ListTodo size={14} className="text-slate-500" />
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">任務概況</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {([
              { label: '執行中', value: kpi.running, color: 'text-blue-600 dark:text-blue-400' },
              { label: '封鎖中', value: kpi.blocked, color: 'text-rose-500 dark:text-rose-400' },
              { label: '待處理', value: kpi.todo,    color: 'text-slate-600 dark:text-slate-400' },
              { label: '已完成', value: kpi.done,    color: 'text-emerald-600 dark:text-emerald-400' },
            ] as const).map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <div className={`text-2xl font-black ${color}`}>{value}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 排程 KPI */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <CalendarClock size={14} className="text-slate-500" />
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">排程概況</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {([
              { label: '啟用中', value: kpi.enabled,  color: 'text-emerald-600 dark:text-emerald-400' },
              { label: '已停用', value: kpi.disabled, color: 'text-slate-400 dark:text-slate-500' },
              { label: '有異常', value: kpi.errors,   color: 'text-amber-500 dark:text-amber-400' },
            ] as const).map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <div className={`text-2xl font-black ${color}`}>{value}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 主內容 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* ── 任務管理 ── */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-sm overflow-hidden">
          <div className="absolute-ish h-0.5 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent w-full" style={{height:'2px',background:'linear-gradient(to right,transparent,rgba(59,130,246,0.4),transparent)'}} />
          <div className="p-6 space-y-4">
            {/* 標題列 */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">任務管理</h3>
                <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-tight">{tasks.length} 項任務</p>
              </div>
              <button
                onClick={() => void refreshTasks()}
                className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 transition-all"
              >
                <RefreshCw size={11} className={taskLoading ? 'animate-spin' : ''} />
                {taskLoading ? '同步中' : '重新整理'}
              </button>
            </div>

            {/* 新增欄 */}
            <div className="flex gap-2">
              <input
                value={taskTitle}
                onChange={e => setTaskTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && void addTask()}
                placeholder="輸入任務名稱後按 Enter"
                className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 px-4 py-2.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 dark:focus:border-blue-500 transition-all"
              />
              <button
                onClick={() => void addTask()}
                className="px-3.5 py-2.5 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white transition-all shadow-sm shadow-blue-500/20"
              >
                <Plus size={15} />
              </button>
            </div>

            {/* 任務列表 */}
            <div className="space-y-2 max-h-[460px] overflow-y-auto pr-0.5">
              {tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <ListTodo size={28} className="mb-2 opacity-30" />
                  <span className="text-sm">目前沒有任務</span>
                </div>
              ) : tasks.map(task => {
                const cfg = STATUS_CFG[task.status];
                return (
                  <div key={task.id} className="group flex items-center gap-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-4 py-3 hover:border-slate-200 dark:hover:border-slate-700 transition-all">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{task.title}</div>
                      {task.scope && <div className="text-[11px] text-slate-400 truncate mt-0.5">{task.scope}</div>}
                    </div>
                    <select
                      value={task.status}
                      onChange={e => void updateStatus(task.id, e.target.value as TaskStatus)}
                      className={`shrink-0 rounded-xl border-0 px-2.5 py-1 text-[11px] font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-400/30 ${cfg.badge}`}
                    >
                      <option value="todo">待處理</option>
                      <option value="in_progress">執行中</option>
                      <option value="blocked">封鎖中</option>
                      <option value="done">已完成</option>
                    </select>
                    <button
                      onClick={() => void deleteTask(task.id)}
                      className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 dark:text-slate-600 dark:hover:text-rose-400 transition-all p-1 rounded-lg"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── 排程管理 ── */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-sm overflow-hidden">
          <div style={{height:'2px',background:'linear-gradient(to right,transparent,rgba(16,185,129,0.4),transparent)'}} />
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">排程管理</h3>
                <p className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-tight">{cronJobs.length} 個排程</p>
              </div>
              <button
                onClick={() => void refreshCron()}
                className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 transition-all"
              >
                <RefreshCw size={11} className={cronLoading ? 'animate-spin' : ''} />
                {cronLoading ? '同步中' : '重新整理'}
              </button>
            </div>

            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-0.5">
              {cronJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <CalendarClock size={28} className="mb-2 opacity-30" />
                  <span className="text-sm">沒有排程任務</span>
                </div>
              ) : cronJobs.map(job => {
                const hasError = (job.state?.consecutiveErrors ?? 0) > 0;
                const isOk = job.state?.lastStatus === 'ok';
                return (
                  <div
                    key={job.id}
                    className={`rounded-2xl border px-4 py-3 transition-all ${
                      hasError
                        ? 'border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20'
                        : job.enabled
                          ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-200 dark:hover:border-slate-700'
                          : 'border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/30 opacity-50'
                    }`}
                  >
                    {/* 上排：名稱 + 操作 */}
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${job.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                      <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{job.name}</span>
                      {hasError && <AlertTriangle size={12} className="text-amber-500 shrink-0" />}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => void toggleCron(job.id)}
                          title={job.enabled ? '暫停' : '啟動'}
                          className={`p-1.5 rounded-xl transition-all ${
                            job.enabled
                              ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                              : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'
                          }`}
                        >
                          {job.enabled ? <Pause size={12} /> : <Play size={12} />}
                        </button>
                        <button
                          onClick={() => void deleteCron(job.id)}
                          className="p-1.5 rounded-xl text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* 下排：排程資訊 */}
                    <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400 pl-3.5">
                      <span className="flex items-center gap-1">
                        <Clock size={9} />
                        {formatSchedule(job.schedule)}
                      </span>
                      <span className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="flex items-center gap-1">
                        {isOk
                          ? <CheckCircle size={9} className="text-emerald-500" />
                          : job.state?.lastStatus === 'error'
                            ? <AlertTriangle size={9} className="text-rose-400" />
                            : <Clock size={9} />
                        }
                        {relTime(job.state?.lastRunAtMs)}
                      </span>
                      {job.state?.nextRunAtMs && (
                        <>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <span>下次 {nextTime(job.state.nextRunAtMs)}</span>
                        </>
                      )}
                      {job.state?.lastDurationMs ? (
                        <>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <span>{(job.state.lastDurationMs / 1000).toFixed(1)}s</span>
                        </>
                      ) : null}
                    </div>

                    {/* 錯誤訊息 */}
                    {hasError && job.state?.lastError && (
                      <div className="mt-2 ml-3.5 text-[10px] text-amber-600 dark:text-amber-400 truncate">
                        {job.state.lastError}
                      </div>
                    )}
                  </div>
                );
              })}
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
