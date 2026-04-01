import { useState, useEffect } from 'react';
import { ArrowLeft, Play, Pause, Trash2, RefreshCw, CalendarClock, Loader2, AlertCircle, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PixelAgentSummary } from './hooks/usePixelOfficeAgents';
import { useAgentCronJobs } from './hooks/useAgentCronJobs';
import { AuthManagementPanel } from '../AuthManagementPanel';
import type { CronSchedule } from '../../types/cron';

type DrawerTab = 'info' | 'cron' | 'auth';

interface AgentSettingsDrawerProps {
  agentId: string;
  summary: PixelAgentSummary | undefined;
  initialTab?: DrawerTab;
  onClose: () => void;
}

function fmtMs(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(0)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function formatSchedule(s: CronSchedule): string {
  if (s.kind === 'cron' && s.expr) return s.expr + (s.tz ? ` · ${s.tz}` : '');
  if (s.kind === 'every' && s.everyMs) return `every ${fmtMs(s.everyMs)}`;
  return '—';
}

export default function AgentSettingsDrawer({
  agentId,
  summary,
  initialTab = 'info',
  onClose,
}: AgentSettingsDrawerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const { jobs, loading: cronLoading, error: cronError, reload, toggle, trigger, remove } =
    useAgentCronJobs({ agentId, enabled: tab === 'cron' });

  const tabs: { key: DrawerTab; label: string }[] = [
    { key: 'info', label: t('pixelOffice.drawer.tabs.info', 'Info') },
    { key: 'cron', label: t('pixelOffice.drawer.tabs.cron', 'Cron Jobs') },
    { key: 'auth', label: t('pixelOffice.drawer.tabs.auth', 'Auth') },
  ];

  return (
    <div className="absolute inset-0 z-20">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={handleClose}
      />

      {/* Drawer panel */}
      <div
        className="absolute right-0 top-0 bottom-0 w-full flex flex-col bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl transition-transform duration-200"
        style={{ transform: visible ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-3 py-2.5">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <ArrowLeft size={13} />
          </button>
          {summary && (
            <span
              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: summary.color }}
            />
          )}
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 truncate">
            {summary?.displayName ?? agentId}
          </span>
          <span className={`ml-auto inline-flex items-center rounded-full px-1.5 py-0.5 text-[8px] font-bold ${
            summary?.snapshotState === 'active'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}>
            {summary?.snapshotState === 'active'
              ? t('pixelOffice.agentWorking')
              : t('pixelOffice.agentIdle')}
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 border-b border-slate-200 dark:border-slate-800 px-2">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider border-b-2 transition-colors ${
                tab === key
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* ── Info tab ── */}
          {tab === 'info' && summary && (
            <div className="p-4 space-y-3">
              <StatRow label={t('pixelOffice.drawer.info.model', 'Model')} value={summary.model || '—'} mono />
              <StatRow label={t('pixelOffice.drawer.info.sessions', 'Sessions')} value={String(summary.sessionCount)} />
              <StatRow label={t('pixelOffice.drawer.info.tokensIn', 'Tokens In')} value={summary.tokensIn.toLocaleString()} />
              <StatRow label={t('pixelOffice.drawer.info.tokensOut', 'Tokens Out')} value={summary.tokensOut.toLocaleString()} />
              <StatRow
                label={t('pixelOffice.drawer.info.cost', 'Cost')}
                value={summary.cost > 0 ? `$${summary.cost.toFixed(6)}` : '—'}
              />
            </div>
          )}

          {/* ── Cron tab ── */}
          {tab === 'cron' && (
            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                  <CalendarClock size={10} />
                  {t('pixelOffice.drawer.tabs.cron')}
                </span>
                <button
                  type="button"
                  onClick={() => void reload()}
                  disabled={cronLoading}
                  className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-40"
                >
                  <RefreshCw size={10} className={cronLoading ? 'animate-spin' : ''} />
                </button>
              </div>

              {cronLoading && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={16} className="animate-spin text-slate-400" />
                </div>
              )}

              {!cronLoading && cronError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-2 text-[10px] text-red-600 dark:text-red-400">
                  <AlertCircle size={10} />
                  {cronError}
                </div>
              )}

              {!cronLoading && !cronError && jobs.length === 0 && (
                <p className="py-6 text-center text-[10px] text-slate-400">
                  {t('pixelOffice.drawer.cron.noJobs', 'No cron jobs for this agent')}
                </p>
              )}

              {!cronLoading && jobs.map(job => (
                <div
                  key={job.id}
                  className="mb-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-slate-700 dark:text-slate-200 truncate">{job.name}</p>
                      <p className="mt-0.5 text-[9px] font-mono text-slate-400">{formatSchedule(job.schedule)}</p>
                      {job.state.lastStatus && (
                        <p className={`mt-0.5 text-[8px] font-bold ${job.state.lastStatus === 'ok' ? 'text-green-500' : 'text-red-500'}`}>
                          {job.state.lastStatus.toUpperCase()}
                          {job.state.lastDurationMs != null && ` · ${fmtMs(job.state.lastDurationMs)}`}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        title={t('pixelOffice.drawer.cron.trigger', 'Run Now')}
                        onClick={() => trigger(job.id)}
                        className="rounded p-1 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                      >
                        <Zap size={10} />
                      </button>
                      <button
                        type="button"
                        title={job.enabled ? t('pixelOffice.drawer.cron.disable', 'Disable') : t('pixelOffice.drawer.cron.enable', 'Enable')}
                        onClick={() => void toggle(job.id)}
                        className="rounded p-1 text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                      >
                        {job.enabled ? <Pause size={10} /> : <Play size={10} />}
                      </button>
                      <button
                        type="button"
                        title={t('pixelOffice.drawer.cron.delete', 'Delete')}
                        onClick={() => void remove(job.id)}
                        className="rounded p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Auth tab ── */}
          {tab === 'auth' && (
            <div className="p-2">
              <AuthManagementPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</span>
      <span className={`text-[10px] text-slate-700 dark:text-slate-200 truncate ${mono ? 'font-mono text-[8px]' : ''}`}>
        {value}
      </span>
    </div>
  );
}
