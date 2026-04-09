import { useState } from 'react';
import {
  Play, Pause, Trash2, RefreshCw, Zap,
  Loader2, AlertCircle, AlertTriangle, CheckCircle,
  CalendarClock, Activity, Pencil, Save, X, Bell,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentCronJobs } from '../hooks/useAgentCronJobs';
import type { CronJob, CronSchedule } from '../../../types/cron';

interface AgentControlTabProps {
  agentId: string;
}

function fmtSchedule(s: CronSchedule): string {
  if (s.kind === 'cron' && s.expr) return s.expr + (s.tz ? ` · ${s.tz}` : '');
  if (s.kind === 'every' && s.everyMs) {
    const m = s.everyMs / 60_000;
    if (m < 1) return `every ${s.everyMs / 1000}s`;
    if (m < 60) return `every ${m.toFixed(0)}m`;
    return `every ${(m / 60).toFixed(0)}h`;
  }
  return '—';
}

function relTime(ms?: number): string {
  if (!ms) return '—';
  const d = Date.now() - ms;
  if (d < 0) return 'soon';
  if (d < 60_000) return `${Math.floor(d / 1000)}s ago`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}

function nextTime(ms?: number): string {
  if (!ms) return '—';
  const d = ms - Date.now();
  if (d <= 0) return 'pending';
  if (d < 60_000) return `in ${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `in ${Math.floor(d / 60_000)}m`;
  return `in ${Math.floor(d / 3_600_000)}h`;
}

interface EditDraft {
  name: string;
  intervalMin: number;
  payloadMessage: string;
}

type CjFilter = 'all' | 'enabled' | 'disabled';

export default function AgentControlTab({ agentId }: AgentControlTabProps) {
  const { t } = useTranslation();
  const { jobs, loading, error, reload, toggle, trigger, remove, update } =
    useAgentCronJobs({ agentId, enabled: true });

  const [cjFilter, setCjFilter] = useState<CjFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [triggeringIds, setTriggeringIds] = useState<Set<string>>(new Set());

  const filteredJobs =
    cjFilter === 'enabled' ? jobs.filter(j => j.enabled) :
    cjFilter === 'disabled' ? jobs.filter(j => !j.enabled) :
    jobs;

  const startEdit = (job: CronJob) => {
    const intervalMin = job.schedule?.everyMs ? Math.round(job.schedule.everyMs / 60_000) : 10;
    setDraft({ name: job.name, intervalMin, payloadMessage: job.payload?.message ?? '' });
    setEditingId(job.id);
  };

  const cancelEdit = () => { setEditingId(null); setDraft(null); };

  const saveEdit = async (jobId: string) => {
    if (!draft) return;
    setSaving(true);
    try {
      await update(jobId, {
        name: draft.name,
        everyMs: draft.intervalMin * 60_000,
        payloadMessage: draft.payloadMessage || undefined,
      });
      setEditingId(null);
      setDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async (jobId: string) => {
    setTriggeringIds(prev => new Set(prev).add(jobId));
    trigger(jobId);
    await new Promise(r => setTimeout(r, 800));
    setTriggeringIds(prev => { const n = new Set(prev); n.delete(jobId); return n; });
    await reload();
  };

  return (
    <div className="p-6 space-y-5 pb-20">
      <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 rounded-[28px] shadow-sm overflow-hidden">
        {/* Violet accent line */}
        <div style={{ height: '2px', background: 'linear-gradient(to right,transparent,rgba(139,92,246,0.45),transparent)' }} />

        <div className="p-5 space-y-2">
          {/* Header */}
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <CalendarClock size={12} className="text-violet-500" />
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-400">
                {t('pixelOffice.drawer.tabs.cron', 'Scheduled Jobs')}
              </span>
              <span className="text-[9px] text-slate-400">({filteredJobs.length})</span>
            </div>
            <div className="flex items-center gap-1">
              {(['all', 'enabled', 'disabled'] as const).map(f => {
                const isActive = cjFilter === f;
                const Icon = f === 'all' ? Activity : f === 'enabled' ? Play : Pause;
                const label = f === 'all' ? t('controlCenter.timeline.tabs.all', 'All')
                            : f === 'enabled' ? t('controlCenter.cronJobs.filterEnabled', 'On')
                            : t('controlCenter.cronJobs.filterDisabled', 'Off');
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setCjFilter(f)}
                    title={label}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[9px] font-bold transition-all border ${
                      isActive
                        ? 'bg-violet-500 text-white border-violet-500'
                        : 'bg-white dark:bg-slate-900 text-slate-400 border-slate-100 dark:border-slate-800'
                    }`}
                  >
                    <Icon size={8} />
                    <span className="hidden sm:inline">{label}</span>
                  </button>
                );
              })}
              <div className="w-px h-3 bg-slate-200 dark:bg-slate-700 mx-1" />
              <button
                type="button"
                onClick={() => void reload()}
                title={t('controlCenter.actions.refresh', 'Refresh')}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
              >
                <RefreshCw size={9} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-2.5 py-2 text-[10px] text-red-600 dark:text-red-400">
              <AlertCircle size={10} />
              {error}
            </div>
          )}

          {/* Job list */}
          <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-0.5">
            {filteredJobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <CalendarClock size={24} className="mb-2 opacity-30" />
                <span className="text-sm">
                  {cjFilter === 'enabled' ? t('controlCenter.cronJobs.emptyEnabled', 'No active jobs') :
                   cjFilter === 'disabled' ? t('controlCenter.cronJobs.emptyDisabled', 'No disabled jobs') :
                   t('pixelOffice.drawer.cron.noJobs', 'No cron jobs for this agent')}
                </span>
              </div>
            ) : [...filteredJobs]
              .sort((a, b) => (b.state?.lastRunAtMs ?? 0) - (a.state?.lastRunAtMs ?? 0))
              .map(job => {
                const hasError = (job.state?.consecutiveErrors ?? 0) > 0;
                return (
                  <div
                    key={job.id}
                    className={`rounded-xl border px-3 py-2.5 transition-all ${
                      !job.enabled
                        ? 'border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/20 opacity-60'
                        : hasError
                        ? 'border-rose-100 dark:border-rose-900/30 bg-white dark:bg-slate-900/50'
                        : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {/* Enabled/disabled badge */}
                      <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                        job.enabled
                          ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800/40'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                      }`}>
                        {job.enabled
                          ? t('controlCenter.cronJobs.filterEnabled', 'ON')
                          : t('controlCenter.cronJobs.filterDisabled', 'OFF')}
                      </span>

                      {/* Name + notification icon */}
                      <div className="flex-1 min-w-0 flex items-center gap-1 overflow-hidden">
                        <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {job.name}
                        </span>
                        {job.delivery?.mode === 'announce' && (
                          <Bell size={9} className="shrink-0 text-violet-400" />
                        )}
                      </div>

                      {/* Last run status */}
                      {!triggeringIds.has(job.id) && job.state?.lastRunAtMs && (
                        <span className={`shrink-0 flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
                          job.state.lastStatus === 'ok'
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40'
                            : 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800/40'
                        }`}>
                          {job.state.lastStatus === 'ok'
                            ? <CheckCircle size={8} />
                            : <AlertTriangle size={8} />}
                          {job.state.lastStatus === 'ok'
                            ? t('controlCenter.cronJobs.lastOk', 'OK')
                            : t('controlCenter.cronJobs.lastFail', 'FAIL')}
                        </span>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          title={t('controlCenter.cronJobs.triggerNow', 'Run now')}
                          onClick={() => void handleTrigger(job.id)}
                          disabled={triggeringIds.has(job.id)}
                          className="p-1 rounded-lg transition-all text-slate-300 dark:text-slate-600 hover:text-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Zap size={10} className={triggeringIds.has(job.id) ? 'animate-pulse text-emerald-500' : ''} />
                        </button>
                        <button
                          type="button"
                          title={editingId === job.id ? 'Cancel edit' : 'Edit'}
                          onClick={() => editingId === job.id ? cancelEdit() : startEdit(job)}
                          className={`p-1 rounded-lg transition-all ${
                            editingId === job.id ? 'text-violet-500' : 'text-slate-300 dark:text-slate-600 hover:text-violet-500'
                          }`}
                        >
                          {editingId === job.id ? <X size={10} /> : <Pencil size={10} />}
                        </button>
                        <button
                          type="button"
                          title={job.enabled ? t('controlCenter.cronJobs.pause', 'Disable') : t('controlCenter.cronJobs.start', 'Enable')}
                          onClick={() => void toggle(job.id)}
                          className={`p-1 rounded-lg transition-all ${
                            job.enabled ? 'text-slate-400 hover:text-amber-600' : 'text-slate-400 hover:text-violet-600'
                          }`}
                        >
                          {job.enabled ? <Pause size={10} /> : <Play size={10} />}
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          onClick={() => void remove(job.id)}
                          className="p-1 rounded-lg text-slate-300 dark:text-slate-600 hover:text-rose-500 transition-all"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </div>

                    {/* Secondary info row */}
                    <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-400 flex-wrap">
                      <span className="font-mono text-violet-400/70">{fmtSchedule(job.schedule)}</span>
                      {job.payload?.model && (
                        <>
                          <span className="opacity-40">·</span>
                          <span className="text-sky-500/80 font-mono">{job.payload.model}</span>
                        </>
                      )}
                      {job.state?.lastRunAtMs && (
                        <>
                          <span className="opacity-40">·</span>
                          <span>{relTime(job.state.lastRunAtMs)}</span>
                        </>
                      )}
                      {job.enabled && job.state?.nextRunAtMs && (
                        <>
                          <span className="opacity-40">·</span>
                          <span className="text-violet-400">{nextTime(job.state.nextRunAtMs)}</span>
                        </>
                      )}
                      {!job.enabled && (
                        <span className="text-amber-500 font-bold uppercase ml-auto">Disabled</span>
                      )}
                    </div>

                    {/* Inline edit form */}
                    {editingId === job.id && draft && (
                      <div className="mt-2 pt-2 border-t border-violet-100 dark:border-violet-900/30 space-y-2">
                        <div>
                          <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
                            {t('pixelOffice.drawer.cron.edit.name', 'Name')}
                          </label>
                          <input
                            type="text"
                            value={draft.name}
                            onChange={e => setDraft(d => d ? { ...d, name: e.target.value } : d)}
                            className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                            maxLength={100}
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
                            {t('pixelOffice.drawer.cron.edit.interval', 'Interval (min)')}
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={1440}
                            value={draft.intervalMin}
                            onChange={e => setDraft(d => d ? { ...d, intervalMin: Math.max(1, Number(e.target.value)) } : d)}
                            className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-slate-500 mb-0.5">
                            {t('pixelOffice.drawer.cron.edit.message', 'Message (Prompt)')}
                          </label>
                          <textarea
                            value={draft.payloadMessage}
                            onChange={e => setDraft(d => d ? { ...d, payloadMessage: e.target.value } : d)}
                            rows={3}
                            className="w-full text-[11px] px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-none"
                            maxLength={2000}
                          />
                        </div>
                        <div className="flex items-center gap-1 pt-0.5">
                          <button
                            type="button"
                            onClick={() => void saveEdit(job.id)}
                            disabled={saving}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-bold bg-violet-500 text-white hover:bg-violet-600 transition-all disabled:opacity-50"
                          >
                            {saving ? <Loader2 size={9} className="animate-spin" /> : <Save size={9} />}
                            {t('common.actions.save', 'Save')}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-bold border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-slate-700 transition-all"
                          >
                            {t('common.actions.cancel', 'Cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}
