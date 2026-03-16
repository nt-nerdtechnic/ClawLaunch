import { useEffect, useMemo, useState } from 'react';
import { XCircle, Clock } from 'lucide-react';
import { useStore } from '../store';
import type { EventQueueItem, ReadModelApproval } from '../store';
import { useTranslation } from 'react-i18next';

export function ActionCenter() {
  const { t } = useTranslation();
  const { config, snapshot, eventQueue, ackedEvents, ackEventLocal, addLog } = useStore();
  const [optimisticResolvedIds, setOptimisticResolvedIds] = useState<Record<string, 'allow-once' | 'deny'>>({});
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [ackingIds, setAckingIds] = useState<Record<string, boolean>>({});

  const allApprovals: ReadModelApproval[] = snapshot?.approvals || [];

  useEffect(() => {
    // 清理已不在最新快照中的 optimistic/pending id，避免狀態長期殘留。
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
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [eventQueue]);

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
      if (!res?.success) {
        throw new Error(res?.error || 'Ack failed');
      }
      addLog(`Event ${eventId} 已確認，TTL=${Math.floor(ttlMs / 1000)}s`, 'system');
    } catch (e: any) {
      addLog(`Event ${eventId} Ack 失敗：${e?.message || 'unknown error'}`, 'stderr');
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
      if (code !== 0) {
        throw new Error(res.stderr || res.stdout || `exit ${code}`);
      }
      addLog(`Approval ${id} 已送出 ${decision}（optimistic 已套用）`, 'system');
    } catch (e) {
      setOptimisticResolvedIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      addLog(`Approval ${id} 操作失敗，已回滾 optimistic 狀態`, 'stderr');
      console.error("Failed to resolve approval", e);
    } finally {
      setPendingIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  };

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between px-2">
          <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            {t('monitor.actionQueue', '待處理事項')} ({sortedEvents.length + pendingApprovals.length})
          </h3>
        </div>

        <div className="space-y-3">
          <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 px-2">Event Queue</div>
          {sortedEvents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-4 text-sm text-slate-500 dark:text-slate-400">
              目前沒有待確認事件。
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {sortedEvents.map((event) => {
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
                          {ackingIds[event.id] ? 'Ack...' : 'Ack 30m'}
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(ackingIds[event.id])}
                          onClick={() => ackEvent(event.id, 24 * 60 * 60 * 1000)}
                          className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
                        >
                          {ackingIds[event.id] ? 'Ack...' : 'Ack 24h'}
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
              已確認事件：{ackedEvents.length} 筆（TTL 內暫時不再進入待辦）。
            </div>
          )}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pendingApprovals.map((action) => (
            <div key={action.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-[24px] shadow-lg hover:border-blue-500/30 transition-all group relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
              
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center text-blue-500">
                    <Clock size={20} />
                  </div>
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{String(action.status || 'pending')}</div>
                    <div className="font-bold text-slate-900 dark:text-slate-100">{String(action.summary || '需要審批')}</div>
                  </div>
                </div>
                <div className="px-2 py-1 bg-amber-500/10 text-amber-500 text-[10px] font-black rounded-lg uppercase tracking-widest">
                  Pending
                </div>
              </div>
              
              <p className="text-sm text-slate-500 dark:text-slate-400 line-clamp-2 mb-6">
                {String(action.summary || 'Agent 正在請求執行一項工具或作業，需要您的授權。')}
              </p>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => handleAction(action.id, 'allow-once')}
                  disabled={Boolean(pendingIds[action.id])}
                  className="flex-1 bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                >
                  {pendingIds[action.id] ? t('monitor.processing', '處理中...') : t('monitor.approve', '批准')}
                </button>
                <button 
                  onClick={() => handleAction(action.id, 'deny')}
                  disabled={Boolean(pendingIds[action.id])}
                  className="px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95"
                >
                  <XCircle size={16} />
                </button>
              </div>
            
          </div>
        ))}
      </div>
    </div>
  );
}
