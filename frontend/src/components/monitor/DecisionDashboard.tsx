import { useEffect, useMemo, useState } from 'react';
import { HeartPulse, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReadModelSnapshot } from '../../store';

type AppConfig = { corePath: string; configPath: string; workspacePath: string };
type AuditLogState = 'loading' | 'connected' | 'degraded' | 'unavailable';

type AuditLogEntry = {
  ts: string;
  cmd: string;
  result: string;
  suspicious: number;
};

type AuditLogSummary = {
  writes: number;
  changedPaths: number;
  suspicious: number;
  updatedAt: string;
  state: AuditLogState;
  entries: AuditLogEntry[];
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
export function DecisionDashboard(props: DecisionDashboardProps) {
  const { t } = useTranslation();
  const { running, config, resolvedConfigDir } = props;
  const [chatSessionCount, setChatSessionCount] = useState(0);
  const [auditFilter, setAuditFilter] = useState<'today' | 'all'>('today');
  const [auditLog, setAuditLog] = useState<AuditLogSummary>({
    writes: 0,
    changedPaths: 0,
    suspicious: 0,
    updatedAt: '',
    state: 'loading',
    entries: [],
  });

  useEffect(() => {
    let cancelled = false;

    if (!running) {
      setAuditLog({ writes: 0, changedPaths: 0, suspicious: 0, updatedAt: '', state: 'unavailable', entries: [] });
      return () => {
        cancelled = true;
      };
    }

    const loadAuditLogSummary = async () => {
      if (!window.electronAPI?.exec) {
        if (!cancelled) {
          setAuditLog({ writes: 0, changedPaths: 0, suspicious: 0, updatedAt: '', state: 'unavailable', entries: [] });
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
          setAuditLog({ writes: 0, changedPaths: 0, suspicious: 0, updatedAt: '', state: 'unavailable', entries: [] });
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
          "let writes = 0; let changedPaths = 0; let suspicious = 0; let lastTs = 0; const entries = [];",
          "const filterMode = process.env.FILTER_MODE || 'today';",
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
          "  if (filterMode === 'today' && key !== todayKey) continue;",
          "  writes += 1;",
          "  const changedPathValue = Number(item?.changedPathCount ?? 0);",
          "  changedPaths += Number.isFinite(changedPathValue) ? changedPathValue : 0;",
          "  const suspCount = Array.isArray(item?.suspicious) ? item.suspicious.length : 0;",
          "  suspicious += suspCount;",
          "  const argv = Array.isArray(item?.argv) ? item.argv.slice(2).join(' ') : '';",
          "  entries.push({ ts: ts, cmd: argv, result: item?.result || '', suspicious: suspCount });",
          "}",
          "entries.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());",
          "process.stdout.write(JSON.stringify({ ok: true, writes, changedPaths, suspicious, updatedAt: lastTs ? new Date(lastTs).toISOString() : '', entries: entries.slice(0, 50) }));",
        ].join(' ');
        const cmd = `AUDIT_LOG=${shellQuote(auditLogPath)} FILTER_MODE=${auditFilter} node -e ${shellQuote(parserScript)}`;

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
              entries: Array.isArray(parsed.entries) ? parsed.entries : [],
            });
          }
          return;
        } catch {
          continue;
        }
      }

      if (!cancelled) {
        setAuditLog({ writes: 0, changedPaths: 0, suspicious: 0, updatedAt: '', state: 'degraded', entries: [] });
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
  }, [running, auditFilter, config.configPath, config.corePath, config.workspacePath, resolvedConfigDir]);

  useEffect(() => {
    let cancelled = false;
    const fetchChatSessions = async () => {
      if (!window.electronAPI?.listChatSessions) return;
      try {
        const res = await window.electronAPI.listChatSessions();
        if (!cancelled && res.code === 0 && res.stdout) {
          const parsed = JSON.parse(res.stdout);
          if (Array.isArray(parsed)) setChatSessionCount(parsed.length);
        }
      } catch {
        // ignore
      }
    };
    void fetchChatSessions();
    const timer = setInterval(() => { void fetchChatSessions(); }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const healthSummary = useMemo(() => {
    const configReadyCount = [config.corePath, config.configPath, config.workspacePath].filter((item) => String(item || '').trim() !== '').length;

    const gatewayState = !config.corePath?.trim() ? 'not_configured' : running ? 'healthy' : 'degraded';
    const configState = configReadyCount >= 3 ? 'healthy' : configReadyCount > 0 ? 'degraded' : 'not_configured';

    const chatState = chatSessionCount > 0 ? 'healthy' : 'not_configured';

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
      chat: {
        state: chatState,
        detail: t('monitor.decision.health.chatSessionsState', { count: chatSessionCount }),
      },
    };
  }, [config.configPath, config.corePath, config.workspacePath, running, chatSessionCount, t]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {t('monitor.decision.healthSummary')}
            </h3>
            <ShieldCheck size={18} className="text-emerald-500" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { key: 'config', label: 'Config', ...healthSummary.config },
              { key: 'gateway', label: 'Gateway', ...healthSummary.gateway },
              { key: 'chat', label: 'Chat Sessions', ...healthSummary.chat },
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

      <section id="monitor-config-audit" className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/30 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                {t('monitor.decision.taskHeartbeat')}
              </h3>
              <div className="flex gap-1">
                {(['today', 'all'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setAuditFilter(f)}
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors ${
                      auditFilter === f
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                        : 'bg-white dark:bg-slate-900/60 text-slate-500 border-slate-200 dark:border-slate-700 hover:border-slate-400'
                    }`}
                  >
                    {f === 'today' ? t('monitor.decision.auditFilterToday') : t('monitor.decision.auditFilterAll')}
                  </button>
                ))}
              </div>
            </div>
            <HeartPulse size={18} className="text-rose-500" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{auditFilter === 'today' ? t('monitor.decision.checkedToday') : t('monitor.decision.checkedAll')}</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{auditLog.writes}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{auditFilter === 'today' ? t('monitor.decision.eligibleToday') : t('monitor.decision.eligibleAll')}</div>
              <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-100">{auditLog.changedPaths}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{auditFilter === 'today' ? t('monitor.decision.startedToday') : t('monitor.decision.startedAll')}</div>
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

          {auditLog.entries.length > 0 && (
            <div className="mt-4 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800/60">
                    <th className="px-3 py-2 text-left font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 w-36">{t('monitor.decision.auditColTime')}</th>
                    <th className="px-3 py-2 text-left font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">{t('monitor.decision.auditColCmd')}</th>
                    <th className="px-3 py-2 text-right font-black uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 w-20">{t('monitor.decision.auditColResult')}</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.entries.map((entry, i) => (
                    <tr
                      key={`${entry.ts}-${i}`}
                      className="border-b border-slate-100 dark:border-slate-800 last:border-0 bg-white dark:bg-slate-900/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="px-3 py-2 text-slate-400 dark:text-slate-500 whitespace-nowrap font-mono text-[11px]">
                        {new Date(entry.ts).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300 font-mono text-[11px] max-w-0 truncate">
                        <span title={entry.cmd}>{entry.cmd || '—'}</span>
                        {entry.suspicious > 0 && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold">
                            ⚠ {entry.suspicious}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                          {entry.result}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>

    </div>
  );
}
