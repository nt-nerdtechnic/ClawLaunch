import { useEffect, useMemo, useState } from 'react';
import { XCircle, Clock, CalendarClock, Link2 } from 'lucide-react';
import { useStore } from '../store';
import type { EventQueueItem, ReadModelApproval, ReadModelTask } from '../store';
import { useTranslation } from 'react-i18next';

const toEpoch = (value: unknown) => {
  const ts = new Date(String(value || '')).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return String(error || 'unknown error');
};

export function ActionCenter() {
  const { t } = useTranslation();
  const { config, snapshot, eventQueue, ackedEvents, ackEventLocal, addLog } = useStore();
  const [optimisticResolvedIds, setOptimisticResolvedIds] = useState<Record<string, 'allow-once' | 'deny'>>({});
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [ackingIds, setAckingIds] = useState<Record<string, boolean>>({});

  const allApprovals: ReadModelApproval[] = useMemo(
    () => (Array.isArray(snapshot?.approvals) ? snapshot.approvals : []),
    [snapshot],
  );
  const tasks: ReadModelTask[] = useMemo(
    () => (Array.isArray(snapshot?.tasks) ? snapshot.tasks : []),
    [snapshot],
  );
  const statuses = useMemo(
    () => (Array.isArray(snapshot?.statuses) ? snapshot.statuses : []),
    [snapshot],
  );

  useEffect(() => {
    const currentIds = new Set(allApprovals.map((item) => item.id));
    setOptimisticResolvedIds((prev) => {
      const next: Record<string, 'allow-once' | 'deny'> = {};
      for (const [id, decision] of Object.entries(prev)) {
        if (currentIds.has(id)) next[id] = decision;
      }
      return next;
    });
    setPendingIds((prev) => {
      const next: Record<string, boolean> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (currentIds.has(id)) next[id] = value;
      }
      return next;
    });
  }, [allApprovals]);

  const pendingApprovals: ReadModelApproval[] = useMemo(() => {
    return allApprovals.filter((approval) => {
      const state = String(approval.status || '').toLowerCase();
      const isPending = state === '' || state === 'pending' || state === 'requested';
      if (!isPending) return false;
      if (optimisticResolvedIds[approval.id]) return false;
      return true;
    });
  }, [allApprovals, optimisticResolvedIds]);

  const sortedEvents: EventQueueItem[] = useMemo(() => {
    const weight = (level: EventQueueItem['level']) => {
      if (level === 'action-required') return 3;
      if (level === 'warn') return 2;
      return 1;
    };
    return [...eventQueue].sort((a, b) => {
      const diff = weight(b.level) - weight(a.level);
      if (diff !== 0) return diff;
      return toEpoch(b.createdAt) - toEpoch(a.createdAt);
    });
  }, [eventQueue]);

  const normalizedTasks = useMemo(() => {
    const rank = (status: string) => {
      if (status.includes('blocked') || status.includes('error') || status.includes('failed')) return 0;
      if (status.includes('running') || status.includes('doing') || status.includes('active')) return 1;
      if (status.includes('queued') || status.includes('pending') || status.includes('waiting') || status.includes('todo')) return 2;
      return 3;
    };

    return tasks
      .map((task) => {
        const status = String(task.status || '').toLowerCase();
        return {
          ...task,
          status,
          rank: rank(status),
          updatedEpoch: toEpoch(task.updatedAt),
        };
      })
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return b.updatedEpoch - a.updatedEpoch;
      });
  }, [tasks]);

  const scheduleBuckets = useMemo(() => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    const out = {
      immediate: 0,
      today: 0,
      backlog: 0,
    };

    for (const task of normalizedTasks) {
      const age = now - task.updatedEpoch;
      if (age <= oneHour) out.immediate += 1;
      else if (age <= oneDay) out.today += 1;
      else out.backlog += 1;
    }

    return out;
  }, [normalizedTasks]);

  const executionEvidence = useMemo(() => {
    const evidenceFromStatus = statuses.slice(0, 6).map((item) => ({
      id: `status-${item.sessionKey}`,
      source: item.sessionKey,
      detail: `${String(item.state || 'unknown')} · in=${Number(item.tokensIn || 0)} · out=${Number(item.tokensOut || 0)}`,
      createdAt: snapshot?.generatedAt || '',
      level: item.state === 'blocked' ? 'warn' : 'info',
    }));

    const evidenceFromEvent = sortedEvents.slice(0, 6).map((item) => ({
      id: `event-${item.id}`,
      source: item.source,
      detail: item.title,
      createdAt: item.createdAt,
      level: item.level,
    }));

    return [...evidenceFromEvent, ...evidenceFromStatus]
      .sort((a, b) => toEpoch(b.createdAt) - toEpoch(a.createdAt))
      .slice(0, 8);
  }, [sortedEvents, snapshot?.generatedAt, statuses]);

  const ackEvent = async (eventId: string, ttlMs: number) => {
    if (!window.electronAPI?.ackEvent) return;
    setAckingIds((prev) => ({ ...prev, [eventId]: true }));
    ackEventLocal(eventId, ttlMs);
    try {
      const res = await window.electronAPI.ackEvent({
        eventId,
        ttlMs,
        configPath: config.configPath,
        workspacePath: config.workspacePath,
        corePath: config.corePath,
      });
      if (!res?.success) throw new Error(res?.error || 'Ack failed');
      addLog(t('monitor.taskSection.logs.eventAcked', { eventId, ttlSec: Math.floor(ttlMs / 1000) }), 'system');
    } catch (error: unknown) {
      addLog(t('monitor.taskSection.logs.eventAckFailed', { eventId, message: getErrorMessage(error) }), 'stderr');
    } finally {
      setAckingIds((prev) => {
        const next = { ...prev };
        delete next[eventId];
        return next;
      });
    }
  };

  const handleAction = async (id: string, decision: 'allow-once' | 'deny') => {
    if (!window.electronAPI) return;

    setPendingIds((prev) => ({ ...prev, [id]: true }));
    setOptimisticResolvedIds((prev) => ({ ...prev, [id]: decision }));

    try {
      const paramsJson = JSON.stringify({ id, decision });
      const escapedParams = paramsJson.replace(/"/g, '\\"');
      const cmd = config.corePath
        ? `cd "${config.corePath}" && pnpm openclaw gateway call exec.approval.resolve --params "${escapedParams}"`
        : `pnpm openclaw gateway call exec.approval.resolve --params "${escapedParams}"`;

      const res = await window.electronAPI.exec(cmd);
      const code = res.code ?? res.exitCode;
      if (code !== 0) throw new Error(res.stderr || res.stdout || `exit ${code}`);
      addLog(t('monitor.taskSection.logs.approvalSent', { id, decision }), 'system');
    } catch {
      setOptimisticResolvedIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      addLog(t('monitor.taskSection.logs.approvalRollback', { id }), 'stderr');
    } finally {
      setPendingIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
          {t('monitor.taskSection.title')} ({normalizedTasks.length + pendingApprovals.length + sortedEvents.length})
        </h3>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 px-1">
            {t('monitor.taskSection.taskBoard')}
          </div>
          {normalizedTasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-500 mt-3">
              {t('monitor.taskSection.emptyTasks')}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {normalizedTasks.slice(0, 8).map((task) => (
                <div key={task.id} className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 bg-slate-50 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate pr-2">{task.title || task.id}</div>
                    <span className="text-[10px] uppercase font-black tracking-wide text-slate-500">{task.status || 'unknown'}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{task.scope || '-'} · {task.updatedAt || '-'}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 px-1">
            <CalendarClock size={14} />
            {t('monitor.taskSection.schedule')}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <MetricChip label={t('monitor.taskSection.scheduleImmediate')} value={scheduleBuckets.immediate} />
            <MetricChip label={t('monitor.taskSection.scheduleToday')} value={scheduleBuckets.today} />
            <MetricChip label={t('monitor.taskSection.scheduleBacklog')} value={scheduleBuckets.backlog} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 px-1">
            {t('monitor.taskSection.approvals')} ({pendingApprovals.length})
          </div>
          {pendingApprovals.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-500 mt-3">
              {t('monitor.taskSection.emptyApprovals')}
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3">
              {pendingApprovals.map((action) => (
                <div key={action.id} className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 p-4 rounded-2xl">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500">
                        <Clock size={16} />
                      </div>
                      <div>
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{String(action.status || 'pending')}</div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">{String(action.summary || t('monitor.taskSection.approvalFallbackTitle'))}</div>
                      </div>
                    </div>
                    <div className="px-2 py-1 bg-amber-500/10 text-amber-500 text-[10px] font-black rounded-lg uppercase tracking-widest">
                      {t('monitor.taskSection.pending')}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => handleAction(action.id, 'allow-once')}
                      disabled={Boolean(pendingIds[action.id])}
                      className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-xl text-xs font-bold transition-all"
                    >
                      {pendingIds[action.id] ? t('monitor.processing') : t('monitor.approve')}
                    </button>
                    <button
                      onClick={() => handleAction(action.id, 'deny')}
                      disabled={Boolean(pendingIds[action.id])}
                      className="px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 py-2 rounded-xl text-xs font-bold transition-all"
                    >
                      <XCircle size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
          <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 px-1">
            <Link2 size={14} />
            {t('monitor.taskSection.executionEvidence')}
          </div>
          {executionEvidence.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-500 mt-3">
              {t('monitor.taskSection.emptyEvidence')}
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {executionEvidence.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 bg-slate-50 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate pr-2">{item.detail}</div>
                    <span className={`text-[10px] uppercase font-black tracking-wide ${item.level === 'action-required' ? 'text-red-500' : item.level === 'warn' ? 'text-amber-500' : 'text-slate-500'}`}>
                      {item.level}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{item.source} · {item.createdAt || '-'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 px-2">
          {t('monitor.taskSection.eventQueue')} ({sortedEvents.length})
        </div>
        {sortedEvents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-500 dark:text-slate-400">
            {t('monitor.taskSection.emptyEvents')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {sortedEvents.slice(0, 8).map((event) => {
              const levelClass = event.level === 'action-required'
                ? 'border-red-500/30 bg-red-500/5 text-red-400'
                : event.level === 'warn'
                  ? 'border-amber-500/30 bg-amber-500/5 text-amber-400'
                  : 'border-blue-500/30 bg-blue-500/5 text-blue-400';
              return (
                <div key={event.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${levelClass}`}>
                          {event.level}
                        </span>
                        <span className="text-[11px] text-slate-500">{event.source}</span>
                      </div>
                      <div className="mt-2 text-sm font-bold text-slate-900 dark:text-slate-100">{event.title}</div>
                      <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">{event.detail}</div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        disabled={Boolean(ackingIds[event.id])}
                        onClick={() => ackEvent(event.id, 30 * 60 * 1000)}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
                      >
                        {ackingIds[event.id] ? t('monitor.taskSection.ackLoading') : t('monitor.taskSection.ack30m')}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(ackingIds[event.id])}
                        onClick={() => ackEvent(event.id, 24 * 60 * 60 * 1000)}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
                      >
                        {ackingIds[event.id] ? t('monitor.taskSection.ackLoading') : t('monitor.taskSection.ack24h')}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {ackedEvents.length > 0 && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/40 p-3 text-[11px] text-slate-500">
            {t('monitor.taskSection.ackedHint', { count: ackedEvents.length })}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-3 text-center">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-black">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}
