import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, HeartPulse, PlugZap, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReadModelSnapshot } from '../../store';

type AppConfig = { corePath: string; configPath: string; workspacePath: string };
type AuditLogState = 'loading' | 'connected' | 'degraded' | 'unavailable';

type AuditLogSummary = {
  writes: number;
  changedPaths: number;
  suspicious: number;
  updatedAt: string;
  state: AuditLogState;
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
  const { running, config, resolvedConfigDir, snapshot } = props;
  const [alertsFilter, setAlertsFilter] = useState<'all' | DashboardAlertLevel>('all');
  const [auditLog, setAuditLog] = useState<AuditLogSummary>({
    writes: 0,
    changedPaths: 0,
    suspicious: 0,
    updatedAt: '',
    state: 'loading',
  });

  useEffect(() => {
    let cancelled = false;

    if (!running) {
      setAuditLog({ writes: 0, changedPaths: 0, suspicious: 0, updatedAt: '', state: 'unavailable' });
      return () => {
        cancelled = true;
      };
    }

    const loadAuditLogSummary = async () => {
      if (!window.electronAPI?.exec) {
        if (!cancelled) {
          setAuditLog({ writes: 0, changedPaths: 0, suspicious: 0, updatedAt: '', state: 'unavailable' });
        }
        return;
      }

      const configDir = normalizeConfigDir(config.configPath);
      const candidates = Array.from(
        new Set(
          [
            resolvedConfigDir ? `${resolvedConfigDir}/logs/config-audit.jsonl` : '',
            configDir ? `${configDir}/logs/config-audit.jsonl` : '',
            config.workspacePath ? `${config.workspacePath}/logs/config-audit.jsonl` : '',
            config.corePath ? `${config.corePath}/logs/config-audit.jsonl` : '',
          ].filter(Boolean),
        ),
      );

      if (candidates.length === 0) {
        if (!cancelled) {
          setAuditLog({ writes: 0, changedPaths: 0, suspicious: 0, updatedAt: '', state: 'unavailable' });
        }
        return;
      }

      for (const auditLogPath of candidates) {
        const parserScript = [
          "const fs = require('fs');",
          "const file = process.env.AUDIT_LOG;",
          "if (!file || !fs.existsSync(file)) { process.stdout.write(JSON.stringify({ ok: false, reason: 'missing' })); process.exit(0); }",
          "const raw = fs.readFileSync(file, 'utf8');",
          "const lines = raw.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);",
          "let writes = 0; let changedPaths = 0; let suspicious = 0; let lastTs = 0;",
          "const today = new Date();",
          "const todayKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');",
          "for (const line of lines) {",
          "  let item;",
          "  try { item = JSON.parse(line); } catch { continue; }",
          "  const ts = item?.ts || item?.timestamp || item?.updatedAt || item?.at;",
          "  if (!ts) continue;",
          "  const date = new Date(ts);",
          "  if (Number.isNaN(date.getTime())) continue;",
          "  const tsMs = date.getTime();",
          "  if (tsMs > lastTs) lastTs = tsMs;",
          "  const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');",
          "  if (key !== todayKey) continue;",
          "  writes += 1;",
          "  const changedPathValue = Number(item?.changedPathCount ?? 0);",
          "  changedPaths += Number.isFinite(changedPathValue) ? changedPathValue : 0;",
          "  suspicious += Array.isArray(item?.suspicious) ? item.suspicious.length : 0;",
          "}",
          "process.stdout.write(JSON.stringify({ ok: true, writes, changedPaths, suspicious, updatedAt: lastTs ? new Date(lastTs).toISOString() : '' }));",
        ].join(' ');
        const cmd = `AUDIT_LOG=${shellQuote(auditLogPath)} node -e ${shellQuote(parserScript)}`;

        try {
          const res = await window.electronAPI.exec(cmd);
          const code = res.code ?? res.exitCode;
          if (code !== 0 || !res.stdout) continue;
          const parsed = JSON.parse(res.stdout);
          if (!parsed?.ok) continue;

          if (!cancelled) {
            setAuditLog({
              writes: Number(parsed.writes || 0),
              changedPaths: Number(parsed.changedPaths || 0),
              suspicious: Number(parsed.suspicious || 0),
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
        setAuditLog({ writes: 0, changedPaths: 0, suspicious: 0, updatedAt: '', state: 'degraded' });
      }
    };

    void loadAuditLogSummary();
    const timer = setInterval(() => {
      void loadAuditLogSummary();
    }, 15000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, config.configPath, config.corePath, config.workspacePath, resolvedConfigDir]);

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
        title: t('monitor.decision.alerts.taskBlockedByHeartbeat'),
        detail: t('monitor.decision.alerts.taskBlockedByHeartbeatDesc', { count: blockedTasks }),
        targetId: 'monitor-live-stream',
        targetLabel: t('monitor.decision.targets.liveStream'),
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

  const healthSummary = useMemo(() => {
    const configReadyCount = [config.corePath, config.configPath, config.workspacePath].filter((item) => String(item || '').trim() !== '').length;

    const gatewayState = !config.corePath?.trim() ? 'not_configured' : running ? 'healthy' : 'degraded';
    const configState = configReadyCount >= 3 ? 'healthy' : configReadyCount > 0 ? 'degraded' : 'not_configured';

    const sessions = snapshot?.sessions || [];
    const activeSessions = sessions.filter((s) => {
      const st = String(s?.status || '').toLowerCase();
      return st === 'running' || st === 'active' || st === 'working';
    });
    const sessionsState = !running ? 'not_configured' : activeSessions.length > 0 ? 'healthy' : sessions.length > 0 ? 'degraded' : 'not_configured';

    return {
      gateway: {
        state: gatewayState,
        detail: running
          ? t('monitor.decision.health.gatewayRunning')
          : t('monitor.decision.health.gatewayStopped'),
      },
      config: {
        state: configState,
        detail: t('monitor.decision.health.configState', { count: configReadyCount }),
      },
      sessions: {
        state: sessionsState,
        detail: t('monitor.decision.health.sessionsState', { active: activeSessions.length, total: sessions.length }),
      },
    };
  }, [config.configPath, config.corePath, config.workspacePath, running, snapshot, t]);

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
              { key: 'sessions', label: 'Sessions', ...healthSummary.sessions },
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
                          : item.state === 'not_configured'
                            ? 'bg-slate-100 text-slate-400 border-slate-300 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-600'
                            : 'bg-red-500/10 text-red-600 border-red-500/30'
                    }`}
                  >
                    {item.state === 'not_configured'
                      ? t('monitor.decision.status.notConfigured')
                      : item.state === 'healthy'
                        ? t('monitor.decision.status.connected')
                        : item.state === 'degraded'
                          ? t('monitor.decision.status.degraded')
                          : item.state}
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

      <section id="monitor-config-audit" className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {t('monitor.decision.taskHeartbeat')}
            </h3>
            <HeartPulse size={18} className="text-rose-500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t('monitor.decision.checkedToday')}</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{auditLog.writes}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t('monitor.decision.eligibleToday')}</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{auditLog.changedPaths}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{t('monitor.decision.startedToday')}</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{auditLog.suspicious}</div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>
              {auditLog.state === 'connected'
                ? t('monitor.decision.heartbeatConnected')
                : auditLog.state === 'loading'
                  ? t('monitor.decision.heartbeatLoading')
                  : t('monitor.decision.heartbeatDegraded')}
            </span>
            <span>{auditLog.updatedAt ? new Date(auditLog.updatedAt).toLocaleString() : '-'}</span>
          </div>
      </section>

      <div className="hidden">
        <Activity />
        <AlertTriangle />
        <PlugZap />
      </div>
    </div>
  );
}
