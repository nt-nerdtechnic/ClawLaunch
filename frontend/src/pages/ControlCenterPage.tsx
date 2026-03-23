import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Play, Pause, Trash2, RefreshCw,
  AlertTriangle, CheckCircle, Clock,
  CalendarClock, Zap, Activity,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSchedule(s: CronSchedule): string {
  if (s.kind === 'cron' && s.expr) return s.expr + (s.tz ? ` · ${s.tz}` : '');
  if (s.kind === 'every' && s.everyMs) {
    const m = s.everyMs / 60000;
    if (m < 1) return `每 ${s.everyMs / 1000} 秒`;
    if (m < 60) return `每 ${m.toFixed(0)} 分鐘`;
    return `每 ${(m / 60).toFixed(0)} 小時`;
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


// ── Component ─────────────────────────────────────────────────────────────────

export const ControlCenterPage: React.FC<ControlCenterPageProps> = ({ onRefreshSnapshot, stateDir }) => {
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [cronLoading, setCronLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const execCmd = useCallback(async (cmd: string) => {
    const res = await window.electronAPI.exec(cmd);
    const code = res.code ?? res.exitCode;
    if (code !== 0) throw new Error(res.stderr || 'command failed');
    return res;
  }, []);

  // ── Data loading ──────────────────────────────────────────────────────────

  const loadCron = useCallback(async () => {
    try {
      const cmd = stateDir ? `cron:list ${JSON.stringify({ stateDir })}` : 'cron:list';
      const res = await window.electronAPI.exec(cmd);
      const parsed = JSON.parse(res.stdout || '{}');
      setCronJobs(parsed.jobs || []);
    } catch { setCronJobs([]); }
  }, [stateDir]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await loadCron();
      if (onRefreshSnapshot) await onRefreshSnapshot();
      setLastRefreshed(new Date());
    } catch (e: any) {
      setError(e?.message || '載入失敗');
    } finally { setLoading(false); }
  }, [loadCron, onRefreshSnapshot]);

  const refreshCron = useCallback(async () => {
    setCronLoading(true);
    await loadCron();
    setCronLoading(false);
  }, [loadCron]);

  // 每 30 秒自動刷新
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => void loadCron(), 30000);
    return () => clearInterval(id);
  }, [loadCron]);

  // ── Cron actions ──────────────────────────────────────────────────────────

  const toggleCron = async (jobId: string) => {
    await execCmd(`cron:toggle ${JSON.stringify({ jobId, stateDir })}`);
    await loadCron();
  };

  const deleteCron = async (jobId: string) => {
    await execCmd(`cron:delete ${JSON.stringify({ jobId, stateDir })}`);
    await loadCron();
  };

  // ── Derived data ──────────────────────────────────────────────────────────

  // 執行紀錄：有 lastRunAtMs 的 job，按時間倒序
  const executionRecords = useMemo(() =>
    [...cronJobs]
      .filter(j => j.state?.lastRunAtMs)
      .sort((a, b) => (b.state.lastRunAtMs ?? 0) - (a.state.lastRunAtMs ?? 0)),
    [cronJobs]
  );

  const kpi = useMemo(() => {
    const day = Date.now() - 86400000;
    const recentRuns = executionRecords.filter(j => (j.state.lastRunAtMs ?? 0) > day);
    return {
      recentRuns:   recentRuns.length,
      successCount: recentRuns.filter(j => j.state.lastStatus === 'ok').length,
      errorCount:   recentRuns.filter(j => j.state.lastStatus === 'error').length,
      enabled:      cronJobs.filter(j => j.enabled).length,
      total:        cronJobs.length,
    };
  }, [executionRecords, cronJobs]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">

      {/* KPI */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '24h 執行', value: kpi.recentRuns,   color: 'text-blue-600 dark:text-blue-400' },
          { label: '成功',     value: kpi.successCount,  color: 'text-emerald-600 dark:text-emerald-400' },
          { label: '失敗',     value: kpi.errorCount,    color: kpi.errorCount > 0 ? 'text-rose-500 dark:text-rose-400' : 'text-slate-400' },
          { label: `啟用 / ${kpi.total} 排程`, value: kpi.enabled, color: 'text-violet-600 dark:text-violet-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[22px] p-4 shadow-sm text-center">
            <div className={`text-2xl font-black ${color}`}>{value}</div>
            <div className="text-[10px] text-slate-500 mt-0.5 tracking-wide">{label}</div>
          </div>
        ))}
      </div>

      {/* 主內容 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        {/* ── 左：作業監控 ──────────────────────────────────────── */}
        <div className="flex flex-col gap-5">

          {/* 執行紀錄 */}
          <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-sm overflow-hidden">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(59,130,246,0.45),transparent)' }} />
            <div className="p-6 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity size={13} className="text-blue-500" />
                  <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-900 dark:text-slate-100">作業執行紀錄</h3>
                  <span className="text-[10px] text-slate-400">{executionRecords.length} 筆</span>
                </div>
                <div className="flex items-center gap-2">
                  {lastRefreshed && (
                    <span className="text-[10px] text-slate-400">
                      {lastRefreshed.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  )}
                  <button
                    onClick={() => void refresh()}
                    className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-all"
                  >
                    <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
                    {loading ? '同步中' : '重新整理'}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-0.5">
                {executionRecords.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                    <Activity size={24} className="mb-2 opacity-30" />
                    <span className="text-sm">尚無執行紀錄</span>
                  </div>
                ) : executionRecords.map(job => {
                  const isOk = job.state.lastStatus === 'ok';
                  const isErr = job.state.lastStatus === 'error';
                  const hasErr = (job.state.consecutiveErrors ?? 0) > 0;
                  return (
                    <div
                      key={job.id}
                      className={`rounded-2xl border px-3.5 py-2.5 transition-all ${
                        hasErr
                          ? 'border-rose-200 dark:border-rose-800/50 bg-rose-50/40 dark:bg-rose-950/15'
                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {isOk
                          ? <CheckCircle size={11} className="text-emerald-500 shrink-0" />
                          : isErr
                            ? <AlertTriangle size={11} className="text-rose-400 shrink-0" />
                            : <Clock size={11} className="text-slate-400 shrink-0" />
                        }
                        <span className="flex-1 min-w-0 text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {job.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-400 font-mono">
                          {relTime(job.state.lastRunAtMs)}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 pl-[19px] text-[10px] text-slate-400">
                        {isOk && <span className="text-emerald-600 dark:text-emerald-400 font-medium">成功</span>}
                        {isErr && <span className="text-rose-500 font-medium">失敗</span>}
                        {job.state.lastDurationMs ? (
                          <span>{(job.state.lastDurationMs / 1000).toFixed(1)}s</span>
                        ) : null}
                        <span className="opacity-50">{job.agentId}</span>
                        {hasErr && job.state.lastError && (
                          <span className="text-rose-400 truncate max-w-[160px]">{job.state.lastError}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>

        {/* ── 右：排程 ─────────────────────────────────────────── */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-sm overflow-hidden">
          <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(139,92,246,0.45),transparent)' }} />
          <div className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CalendarClock size={13} className="text-violet-500" />
                <h3 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-900 dark:text-slate-100">排程管理</h3>
                <span className="text-[10px] text-slate-400">{cronJobs.length} 個</span>
              </div>
              <button
                onClick={() => void refreshCron()}
                className="flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-all"
              >
                <RefreshCw size={10} className={cronLoading ? 'animate-spin' : ''} />
                {cronLoading ? '同步中' : '重新整理'}
              </button>
            </div>

            <div className="space-y-1.5 max-h-[700px] overflow-y-auto pr-0.5">
              {cronJobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <CalendarClock size={26} className="mb-2 opacity-30" />
                  <span className="text-sm">沒有排程任務</span>
                </div>
              ) : cronJobs.map(job => {
                const hasError = (job.state?.consecutiveErrors ?? 0) > 0;
                return (
                  <div
                    key={job.id}
                    className={`rounded-2xl border px-3.5 py-3 transition-all ${
                      hasError
                        ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/40 dark:bg-amber-950/15'
                        : job.enabled
                          ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50 hover:border-slate-200 dark:hover:border-slate-700'
                          : 'border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/20 opacity-50'
                    }`}
                  >
                    {/* 上行：名稱 + 控制 */}
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${job.enabled ? 'bg-violet-500' : 'bg-slate-400'}`} />
                      <span className="flex-1 min-w-0 text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate">{job.name}</span>
                      {hasError && <AlertTriangle size={11} className="text-amber-500 shrink-0" />}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => void toggleCron(job.id)}
                          title={job.enabled ? '暫停' : '啟動'}
                          className={`p-1.5 rounded-xl transition-all ${
                            job.enabled
                              ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'
                              : 'text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20'
                          }`}
                        >
                          {job.enabled ? <Pause size={11} /> : <Play size={11} />}
                        </button>
                        <button
                          onClick={() => void deleteCron(job.id)}
                          className="p-1.5 rounded-xl text-slate-300 dark:text-slate-600 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-all"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>

                    {/* 下行：排程資訊 */}
                    <div className="mt-1.5 flex items-center gap-2.5 pl-4 text-[10px] text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Zap size={8} />
                        {formatSchedule(job.schedule)}
                      </span>
                      {job.state?.lastRunAtMs && (
                        <>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="flex items-center gap-1">
                            {job.state.lastStatus === 'ok'
                              ? <CheckCircle size={8} className="text-emerald-500" />
                              : job.state.lastStatus === 'error'
                                ? <AlertTriangle size={8} className="text-rose-400" />
                                : <Clock size={8} />
                            }
                            {relTime(job.state.lastRunAtMs)}
                          </span>
                        </>
                      )}
                      {job.enabled && job.state?.nextRunAtMs && (
                        <>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span className="text-violet-500">{nextTime(job.state.nextRunAtMs)}</span>
                        </>
                      )}
                      {job.state?.lastDurationMs ? (
                        <>
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                          <span>{(job.state.lastDurationMs / 1000).toFixed(1)}s</span>
                        </>
                      ) : null}
                    </div>

                    {/* 錯誤訊息 */}
                    {hasError && job.state?.lastError && (
                      <div className="mt-1.5 ml-4 text-[10px] text-amber-600 dark:text-amber-400 truncate">
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
