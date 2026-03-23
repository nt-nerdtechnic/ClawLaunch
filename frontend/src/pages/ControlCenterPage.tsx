import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Play, Pause, Trash2, RefreshCw,
  AlertTriangle, CheckCircle, Clock,
  CalendarClock, Zap, Activity, Server, Terminal,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

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
  const [crontabEntries, setCrontabEntries] = useState<CrontabEntry[]>([]);
  const [launchAgents, setLaunchAgents] = useState<LaunchAgent[]>([]);
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await Promise.all([loadCron(), loadSystem()]);
      if (onRefreshSnapshot) await onRefreshSnapshot();
      setLastRefreshed(new Date());
    } catch (e: any) {
      setError(e?.message || '載入失敗');
    } finally { setLoading(false); }
  }, [loadCron, loadSystem, onRefreshSnapshot]);

  const refreshCron = useCallback(async () => {
    setCronLoading(true);
    await loadCron();
    setCronLoading(false);
  }, [loadCron]);

  // 初始載入 + 每 30 秒自動刷新
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(() => void Promise.all([loadCron(), loadSystem()]), 30000);
    return () => clearInterval(id);
  }, [loadCron, loadSystem]);

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

        {/* ── 右：排程三層 ──────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* 層 1：系統服務 LaunchAgents */}
          <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(16,185,129,0.45),transparent)' }} />
            <div className="p-5 space-y-2.5">
              <div className="flex items-center gap-2">
                <Server size={12} className="text-emerald-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">系統服務</span>
                <span className="text-[9px] text-slate-400">LaunchAgents</span>
              </div>
              {launchAgents.length === 0 ? (
                <p className="text-[11px] text-slate-400 py-2">未偵測到系統服務</p>
              ) : launchAgents.map(agent => (
                <div key={agent.label} className="flex items-center gap-2.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50 px-3 py-2">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${agent.running ? 'bg-emerald-500' : agent.loaded ? 'bg-amber-400' : 'bg-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold text-slate-800 dark:text-slate-100 truncate">{agent.name}</div>
                    <div className="text-[10px] text-slate-400 truncate">{agent.label}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${
                      agent.running
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                        : agent.loaded
                          ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                    }`}>
                      {agent.running ? `運行中 · PID ${agent.pid}` : agent.loaded ? '已載入' : agent.plistExists ? '未載入' : '未安裝'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 層 2：系統 crontab */}
          <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(245,158,11,0.45),transparent)' }} />
            <div className="p-5 space-y-2.5">
              <div className="flex items-center gap-2">
                <Terminal size={12} className="text-amber-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">系統排程</span>
                <span className="text-[9px] text-slate-400">crontab · {crontabEntries.length} 項</span>
              </div>
              {crontabEntries.length === 0 ? (
                <p className="text-[11px] text-slate-400 py-2">無 crontab 項目</p>
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

          {/* 層 3：OpenClaw 應用排程 */}
          <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden">
            <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(139,92,246,0.45),transparent)' }} />
            <div className="p-5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarClock size={12} className="text-violet-500" />
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">應用排程</span>
                  <span className="text-[9px] text-slate-400">OpenClaw · {cronJobs.length} 個</span>
                </div>
                <button
                  onClick={() => void refreshCron()}
                  className="text-[10px] font-bold px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all"
                >
                  <RefreshCw size={9} className={`inline ${cronLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-0.5">
                {cronJobs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                    <CalendarClock size={24} className="mb-2 opacity-30" />
                    <span className="text-sm">沒有排程任務</span>
                  </div>
                ) : cronJobs.map(job => {
                  const hasError = (job.state?.consecutiveErrors ?? 0) > 0;
                  return (
                    <div
                      key={job.id}
                      className={`rounded-xl border px-3 py-2.5 transition-all ${
                        hasError
                          ? 'border-amber-200 dark:border-amber-800/50 bg-amber-50/40 dark:bg-amber-950/15'
                          : job.enabled
                            ? 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                            : 'border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/20 opacity-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${job.enabled ? 'bg-violet-500' : 'bg-slate-400'}`} />
                        <span className="flex-1 min-w-0 text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">{job.name}</span>
                        {hasError && <AlertTriangle size={10} className="text-amber-500 shrink-0" />}
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => void toggleCron(job.id)}
                            title={job.enabled ? '暫停' : '啟動'}
                            className={`p-1 rounded-lg transition-all ${job.enabled ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-violet-600'}`}
                          >
                            {job.enabled ? <Pause size={10} /> : <Play size={10} />}
                          </button>
                          <button
                            onClick={() => void deleteCron(job.id)}
                            className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all"
                          >
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
                                : <AlertTriangle size={8} className="text-rose-400" />
                              }
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
