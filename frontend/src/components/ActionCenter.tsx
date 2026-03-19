import { useEffect, useMemo, useState } from 'react';
import { XCircle, Clock, Link2 } from 'lucide-react';
import { useStore } from '../store';
import type { EventQueueItem, ReadModelApproval } from '../store';
import { useTranslation } from 'react-i18next';

const toEpoch = (value: unknown) => {
  const ts = new Date(String(value || '')).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

export function ActionCenter() {
  const { t } = useTranslation();
  const { snapshot, eventQueue, ackedEvents } = useStore();
  const [optimisticResolvedIds, setOptimisticResolvedIds] = useState<Record<string, 'allow-once' | 'deny'>>({});

  const allApprovals: ReadModelApproval[] = useMemo(
    () => (Array.isArray(snapshot?.approvals) ? snapshot.approvals : []),
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

  const hasActionCenterContent =
    pendingApprovals.length > 0 || executionEvidence.length > 0 || sortedEvents.length > 0 || ackedEvents.length > 0;

  if (!hasActionCenterContent) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
          {t('monitor.taskSection.title')} ({pendingApprovals.length + sortedEvents.length})
        </h3>
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
                    <XCircle size={16} className="text-slate-300 dark:text-slate-600" />
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
