import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, HeartPulse, PlugZap, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReadModelSnapshot } from '../../store';

type EnvStatus = { node: string; git: string; pnpm: string };
type AppConfig = { corePath: string; configPath: string; workspacePath: string; gatewayPort?: string };
type HeartbeatState = 'loading' | 'connected' | 'degraded' | 'unavailable';

type HeartbeatSummary = {
  checked: number;
  eligible: number;
  executed: number;
  updatedAt: string;
  state: HeartbeatState;
};

type DashboardAlertLevel = 'info' | 'warn' | 'action-required';

type DashboardAlertItem = {
  id: string;
  level: DashboardAlertLevel;
  title: string;
  detail: string;
  targetId?: string;
  targetLabel?: string;
};

interface DecisionDashboardProps {
  running: boolean;
  envStatus: EnvStatus;
  config: AppConfig;
  resolvedConfigDir: string;
  snapshot: ReadModelSnapshot | null;
}

const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const normalizeConfigDir = (rawPath: string) => {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/[\\/]openclaw\.json$/i, '');
};

function levelClasses(level: DashboardAlertLevel): string {
  if (level === 'action-required') return 'bg-red-500/10 text-red-500 border-red-500/30';
  if (level === 'warn') return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
  return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
}

export function DecisionDashboard(props: DecisionDashboardProps) {
  const { t } = useTranslation();
  const { running, envStatus, config, resolvedConfigDir, snapshot } = props;
  const [alertsFilter, setAlertsFilter] = useState<'all' | DashboardAlertLevel>('all');
  const [heartbeat, setHeartbeat] = useState<HeartbeatSummary>({
    checked: 0,
    eligible: 0,
    executed: 0,
    updatedAt: '',
    state: 'loading',
  });

  useEffect(() => {
    let cancelled = false;

    if (!running) {
      setHeartbeat({ checked: 0, eligible: 0, executed: 0, updatedAt: '', state: 'unavailable' });
      return () => {
        cancelled = true;
      };
    }

    const loadHeartbeatSummary = async () => {
      if (!window.electronAPI?.exec) {
        if (!cancelled) {
          setHeartbeat({ checked: 0, eligible: 0, executed: 0, updatedAt: '', state: 'unavailable' });
        }
        return;
      }

      const configDir = normalizeConfigDir(config.configPath);
      const configFilePath = configDir ? `${configDir}/openclaw.json` : '';
      const stateDirEnv = configDir ? `OPENCLAW_STATE_DIR=${shellQuote(configDir)} ` : '';
      const configPathEnv = configFilePath ? `OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} ` : '';
      const corePrefix = config.corePath ? `cd ${shellQuote(config.corePath)} && ` : '';

      const rawPort = String(config.gatewayPort || '').trim();
      if (!/^\d+$/.test(rawPort)) {
        if (!cancelled) {
          setHeartbeat({ checked: 0, eligible: 0, executed: 0, updatedAt: '', state: 'unavailable' });
        }
        return;
      }
      const gatewayPort = Number(rawPort);
      const gatewayUrl = `ws://127.0.0.1:${gatewayPort}`;
      const statusCmd = `${corePrefix}${stateDirEnv}${configPathEnv}pnpm openclaw gateway status --json --no-probe --url ${shellQuote(gatewayUrl)}`;

      let gatewayReachable = false;
      try {
        const statusRes = await window.electronAPI.exec(statusCmd);
        const statusCode = statusRes.code ?? statusRes.exitCode;
        if (statusCode === 0) {
          gatewayReachable = true;
        }
      } catch {
        gatewayReachable = false;
      }

      const candidates = Array.from(
        new Set(
          [
            resolvedConfigDir ? `${resolvedConfigDir}/runtime/task-heartbeat.log` : '',
            config.workspacePath ? `${config.workspacePath}/runtime/task-heartbeat.log` : '',
            config.corePath ? `${config.corePath}/runtime/task-heartbeat.log` : '',
          ].filter(Boolean),
        ),
      );

      if (candidates.length === 0) {
        if (!cancelled) {
          setHeartbeat({ checked: 0, eligible: 0, executed: 0, updatedAt: '', state: 'unavailable' });
        }
        return;
      }

      for (const heartbeatPath of candidates) {
        const parserScript = [
          "const fs = require('fs');",
          "const file = process.env.HEARTBEAT_LOG;",
          "if (!file || !fs.existsSync(file)) { process.stdout.write(JSON.stringify({ ok: false, reason: 'missing' })); process.exit(0); }",
          "const raw = fs.readFileSync(file, 'utf8');",
          "const lines = raw.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);",
          "let checked = 0; let eligible = 0; let executed = 0; let lastTs = 0;",
          "const today = new Date();",
          "const todayKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');",
          "for (const line of lines) {",
          "  let item;",
          "  try { item = JSON.parse(line); } catch { continue; }",
          "  const ts = item?.generatedAt || item?.timestamp || item?.at || item?.finishedAt || item?.startedAt || item?.updatedAt;",
          "  if (!ts) continue;",
          "  const date = new Date(ts);",
          "  if (Number.isNaN(date.getTime())) continue;",
          "  const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');",
          "  if (key !== todayKey) continue;",
          "  const checkedValue = Number(item?.checked ?? item?.summary?.checked ?? item?.metrics?.checked ?? 0);",
          "  const eligibleValue = Number(item?.eligible ?? item?.summary?.eligible ?? item?.metrics?.eligible ?? 0);",
          "  const executedValue = Number(item?.executed ?? item?.summary?.executed ?? item?.metrics?.executed ?? item?.promoted ?? 0);",
          "  checked += Number.isFinite(checkedValue) ? checkedValue : 0;",
          "  eligible += Number.isFinite(eligibleValue) ? eligibleValue : 0;",
          "  executed += Number.isFinite(executedValue) ? executedValue : 0;",
          "  const tsMs = date.getTime();",
          "  if (tsMs > lastTs) lastTs = tsMs;",
          "}",
          "process.stdout.write(JSON.stringify({ ok: true, checked, eligible, executed, updatedAt: lastTs ? new Date(lastTs).toISOString() : '' }));",
        ].join(' ');
        const cmd = `HEARTBEAT_LOG=${shellQuote(heartbeatPath)} node -e ${shellQuote(parserScript)}`;

        try {
          const res = await window.electronAPI.exec(cmd);
          const code = res.code ?? res.exitCode;
          if (code !== 0 || !res.stdout) continue;
          const parsed = JSON.parse(res.stdout);
          if (!parsed?.ok) continue;

          if (!cancelled) {
            setHeartbeat({
              checked: Number(parsed.checked || 0),
              eligible: Number(parsed.eligible || 0),
              executed: Number(parsed.executed || 0),
              updatedAt: String(parsed.updatedAt || ''),
              state: 'connected',
            });
          }
          return;
        } catch {
          continue;
        }
      }

      if (!cancelled) {
        if (gatewayReachable) {
          setHeartbeat({ checked: 0, eligible: 0, executed: 0, updatedAt: '', state: 'connected' });
        } else {
          setHeartbeat({ checked: 0, eligible: 0, executed: 0, updatedAt: '', state: 'degraded' });
        }
      }
    };

    void loadHeartbeatSummary();
    const timer = setInterval(() => {
      void loadHeartbeatSummary();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, config.corePath, config.workspacePath, resolvedConfigDir]);

  const alerts = useMemo<DashboardAlertItem[]>(() => {
    const out: DashboardAlertItem[] = [];

    const sessions = snapshot?.sessions || [];
    const statuses = snapshot?.statuses || [];
    const tasks = snapshot?.tasks || [];
    const approvals = snapshot?.approvals || [];
    const budgetEvaluations = snapshot?.budgetSummary?.evaluations || [];

    const blockedCount = statuses.filter((s) => String(s?.state || '').toLowerCase() === 'blocked').length;
    const errorCount = statuses.filter((s) => String(s?.state || '').toLowerCase() === 'error').length;
    const blockedTasks = tasks.filter((task) => String(task?.status || '').toLowerCase() === 'blocked').length;
    const pendingApprovals = approvals.filter((a) => {
      const value = String(a?.status || '').toLowerCase();
      return value === '' || value === 'pending' || value === 'requested';
    }).length;
    const overBudget = budgetEvaluations.filter((b) => String(b?.status || '').toLowerCase() === 'over').length;
    const warnBudget = budgetEvaluations.filter((b) => String(b?.status || '').toLowerCase() === 'warn').length;

    if (!snapshot) {
      out.push({
        id: 'snapshot-waiting',
        level: 'info',
        title: t('monitor.decision.alerts.snapshotWaiting'),
        detail: t('monitor.decision.alerts.snapshotWaitingDesc'),
        targetId: 'monitor-live-stream',
        targetLabel: t('monitor.decision.targets.liveStream'),
      });
    }

    if (sessions.length === 0) {
      out.push({
        id: 'sessions-empty',
        level: 'warn',
        title: t('monitor.decision.alerts.noActiveSessions'),
        detail: t('monitor.decision.alerts.noActiveSessionsDesc'),
        targetId: 'monitor-staff-grid',
        targetLabel: t('monitor.decision.targets.staffGrid'),
      });
    }

    if (pendingApprovals > 0) {
      out.push({
        id: 'approvals-pending',
        level: 'action-required',
        title: t('monitor.decision.alerts.pendingApprovals'),
        detail: t('monitor.decision.alerts.pendingApprovalsDesc', { count: pendingApprovals }),
        targetId: 'monitor-action-center',
        targetLabel: t('monitor.decision.targets.actionCenter'),
      });
    }

    if (blockedCount > 0 || errorCount > 0) {
      out.push({
        id: 'runtime-issues',
        level: 'action-required',
        title: t('monitor.decision.alerts.runtimeIssues'),
        detail: t('monitor.decision.alerts.runtimeIssuesDesc', { blocked: blockedCount, error: errorCount }),
        targetId: 'monitor-live-stream',
        targetLabel: t('monitor.decision.targets.liveStream'),
      });
    }

    if (blockedTasks > 0) {
      out.push({
        id: 'task-blocked-by-heartbeat',
        level: 'action-required',
        title: t('monitor.decision.alerts.taskBlockedByHeartbeat', '任務心跳超時'),
        detail: t('monitor.decision.alerts.taskBlockedByHeartbeatDesc', '有 {{count}} 筆任務因長時間未更新被標記為 blocked。', { count: blockedTasks }),
        targetId: 'monitor-task-heartbeat',
        targetLabel: t('monitor.decision.taskHeartbeat'),
      });
    }

    if (overBudget > 0 || warnBudget > 0) {
      out.push({
        id: 'budget-risk',
        level: overBudget > 0 ? 'action-required' : 'warn',
        title: t('monitor.decision.alerts.budgetRisk'),
        detail: t('monitor.decision.alerts.budgetRiskDesc', { over: overBudget, warn: warnBudget }),
        targetId: 'monitor-connection-health',
        targetLabel: t('monitor.decision.targets.connectionHealth'),
      });
    }

    if (out.length === 0) {
      out.push({
        id: 'all-clear',
        level: 'info',
        title: t('monitor.decision.alerts.allClear'),
        detail: t('monitor.decision.alerts.allClearDesc'),
        targetId: 'monitor-health-summary',
        targetLabel: t('monitor.decision.targets.healthSummary'),
      });
    }

    return out;
  }, [snapshot, t]);

  const alertCounters = useMemo(() => {
    const counts = { info: 0, warn: 0, 'action-required': 0 };
    for (const alert of alerts) {
      counts[alert.level] += 1;
    }
    return counts;
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    if (alertsFilter === 'all') return alerts;
    return alerts.filter((alert) => alert.level === alertsFilter);
  }, [alerts, alertsFilter]);

  const alertFilterChips = useMemo(
    () => [
      {
        key: 'all' as const,
        label: t('monitor.decision.filters.all'),
        count: alerts.length,
      },
      {
        key: 'info' as const,
        label: t('monitor.decision.filters.info'),
        count: alertCounters.info,
      },
      {
        key: 'warn' as const,
        label: t('monitor.decision.filters.warn'),
        count: alertCounters.warn,
      },
      {
        key: 'action-required' as const,
        label: t('monitor.decision.filters.actionRequired'),
        count: alertCounters['action-required'],
      },
    ],
    [alertCounters, alerts.length, t],
  );

  const snapshotAgeMs = useMemo(() => {
    if (!snapshot?.generatedAt) return Number.POSITIVE_INFINITY;
    const ts = new Date(snapshot.generatedAt).getTime();
    if (Number.isNaN(ts)) return Number.POSITIVE_INFINITY;
    return Date.now() - ts;
  }, [snapshot]);

  const healthSummary = useMemo(() => {
    const configReadyCount = [config.corePath, config.configPath, config.workspacePath].filter((item) => String(item || '').trim() !== '').length;

    const gatewayState = running ? 'healthy' : 'degraded';
    const configState = configReadyCount >= 3 ? 'healthy' : configReadyCount > 0 ? 'degraded' : 'down';
    const runtimeState = Number.isFinite(snapshotAgeMs) ? (snapshotAgeMs <= 90_000 ? 'healthy' : 'degraded') : 'down';

    return {
      gateway: {
        state: gatewayState,
        detail: running
          ? t('monitor.decision.health.gatewayRunning', 'Gateway 已連線且運行中。')
          : t('monitor.decision.health.gatewayStopped', 'Gateway 未連線或尚未啟動。'),
      },
      config: {
        state: configState,
        detail: t('monitor.decision.health.configState', '已對位 {{count}} / 3 個核心路徑。', { count: configReadyCount }),
      },
      runtime: {
        state: runtimeState,
        detail: Number.isFinite(snapshotAgeMs)
          ? t('monitor.decision.health.runtimeFreshness', '快照更新於 {{sec}} 秒前。', { sec: Math.max(0, Math.floor(snapshotAgeMs / 1000)) })
          : t('monitor.decision.health.runtimeMissing', '尚未取得 runtime 快照。'),
      },
    };
  }, [config.configPath, config.corePath, config.workspacePath, running, snapshotAgeMs, t]);

  const connectionRows = useMemo(() => {
    const sessions = snapshot?.sessions || [];
    const approvals = snapshot?.approvals || [];
    const hasTaskStore = (snapshot?.tasks?.length || 0) > 0;
    const hasBudget = Boolean(snapshot?.budgetSummary);

    return [
      {
        key: 'node',
        name: t('monitor.decision.connection.node', 'Node.js Runtime'),
        status: envStatus.node === 'ok' ? 'connected' : 'degraded',
      },
      {
        key: 'pnpm',
        name: t('monitor.decision.connection.pnpm', 'pnpm Toolchain'),
        status: envStatus.pnpm === 'ok' ? 'connected' : 'degraded',
      },
      {
        key: 'core-path',
        name: t('monitor.decision.connection.corePath', 'Core Path'),
        status: String(config.corePath || '').trim() ? 'connected' : 'degraded',
      },
      {
        key: 'config-path',
        name: t('monitor.decision.connection.configPath', 'Config Path'),
        status: String(config.configPath || '').trim() ? 'connected' : 'degraded',
      },
      {
        key: 'workspace-path',
        name: t('monitor.decision.connection.workspacePath', 'Workspace Path'),
        status: String(config.workspacePath || '').trim() ? 'connected' : 'degraded',
      },
      {
        key: 'sessions',
        name: t('monitor.decision.connection.sessions', 'Session Feed'),
        status: sessions.length > 0 ? 'connected' : 'degraded',
      },
      {
        key: 'approvals',
        name: t('monitor.decision.connection.approvals', 'Approvals Feed'),
        status: snapshot ? 'connected' : 'degraded',
        meta: snapshot ? t('monitor.decision.connection.approvalsCount', '{{count}} 筆', { count: approvals.length }) : undefined,
      },
      {
        key: 'task-store',
        name: t('monitor.decision.connection.taskStore', 'Task Store'),
        status: hasTaskStore ? 'connected' : 'degraded',
      },
      {
        key: 'budget',
        name: t('monitor.decision.connection.budget', 'Budget Summary'),
        status: hasBudget ? 'connected' : 'degraded',
      },
      {
        key: 'heartbeat',
        name: t('monitor.decision.connection.heartbeat', 'Task Heartbeat Log'),
        status: heartbeat.state === 'connected' ? 'connected' : heartbeat.state === 'loading' ? 'degraded' : 'degraded',
      },
    ];
  }, [config.configPath, config.corePath, config.workspacePath, envStatus.node, envStatus.pnpm, heartbeat.state, snapshot, t]);

  const connectedCount = connectionRows.filter((row) => row.status === 'connected').length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {t('monitor.decision.healthSummary')}
            </h3>
            <ShieldCheck size={18} className="text-emerald-500" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { key: 'gateway', label: 'Gateway', ...healthSummary.gateway },
              { key: 'config', label: 'Config', ...healthSummary.config },
              { key: 'runtime', label: 'Runtime', ...healthSummary.runtime },
            ].map((item) => (
              <div key={item.key} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                      item.state === 'healthy'
                        ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                        : item.state === 'degraded'
                          ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                          : 'bg-red-500/10 text-red-600 border-red-500/30'
                    }`}
                  >
                    {item.state}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{item.detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="monitor-health-summary" className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {t('monitor.decision.alertsQueue')}
            </h3>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide">
              <span className="px-2 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-500">{t('monitor.decision.filters.info')} {alertCounters.info}</span>
              <span className="px-2 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-500">{t('monitor.decision.filters.warn')} {alertCounters.warn}</span>
              <span className="px-2 py-1 rounded-full border border-red-500/30 bg-red-500/10 text-red-500">{t('monitor.decision.filters.actionRequired')} {alertCounters['action-required']}</span>
            </div>
          </div>
          <div className="mb-4 flex flex-wrap gap-2">
            {alertFilterChips.map((chip) => {
              const active = alertsFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => setAlertsFilter(chip.key)}
                  className={`rounded-full border px-3 py-1 text-[11px] font-bold transition-colors ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                      : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {chip.label} ({chip.count})
                </button>
              );
            })}
          </div>
          <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
            {filteredAlerts.map((alert) => (
              <div key={alert.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-sm text-slate-800 dark:text-slate-100">{alert.title}</div>
                  <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${levelClasses(alert.level)}`}>
                    {alert.level}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{alert.detail}</p>
                {alert.targetId && (
                  <button
                    type="button"
                    onClick={() => {
                      const element = document.getElementById(alert.targetId!);
                      if (!element) return;
                      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="mt-3 text-xs font-bold text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
                  >
                    {t('monitor.decision.jumpTo', { target: alert.targetLabel || t('monitor.decision.targets.liveStream') })}
                  </button>
                )}
              </div>
            ))}
            {filteredAlerts.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-xs text-slate-500 dark:text-slate-400">
                {t('monitor.decision.filters.empty')}
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section id="monitor-task-heartbeat" className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {t('monitor.decision.taskHeartbeat')}
            </h3>
            <HeartPulse size={18} className="text-rose-500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t('monitor.decision.checkedToday', '今日檢查數')}</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{heartbeat.checked}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t('monitor.decision.eligibleToday', '可執行數')}</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{heartbeat.eligible}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t('monitor.decision.startedToday', '已啟動數')}</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{heartbeat.executed}</div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {heartbeat.state === 'connected'
                ? t('monitor.decision.heartbeatConnected')
                : heartbeat.state === 'loading'
                  ? t('monitor.decision.heartbeatLoading')
                  : t('monitor.decision.heartbeatDegraded')}
            </span>
            <span>{heartbeat.updatedAt ? new Date(heartbeat.updatedAt).toLocaleString() : '-'}</span>
          </div>
        </section>

        <section id="monitor-connection-health" className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {t('monitor.decision.connectionHealth')}
            </h3>
            <div className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-sky-500">
              {t('monitor.decision.connectedRatio', { connected: connectedCount, total: connectionRows.length })}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {connectionRows.map((row) => (
              <div key={row.key} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 px-3 py-2.5 flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {row.name}
                  {row.meta ? <span className="ml-1 text-[11px] text-slate-400">({row.meta})</span> : null}
                </div>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                    row.status === 'connected'
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                  }`}
                >
                  {row.status === 'connected' ? t('monitor.decision.status.connected') : t('monitor.decision.status.degraded')}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="hidden">
        <Activity />
        <AlertTriangle />
        <PlugZap />
      </div>
    </div>
  );
}
