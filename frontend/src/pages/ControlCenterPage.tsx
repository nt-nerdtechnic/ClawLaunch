import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

type QueueSeverity = 'info' | 'warn' | 'critical';

interface Overview {
  generatedAt: string;
  healthScore: number;
  pendingQueue: number;
  blockedTasks: number;
  runningTasks: number;
  doneTasks: number;
  taskCount: number;
}

interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  projectId: string;
  owner: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

interface QueueItem {
  id: string;
  title: string;
  detail: string;
  severity: QueueSeverity;
  status: 'pending' | 'acked';
  createdAt: string;
  ackedAt?: string;
}

async function execJson<T>(command: string): Promise<T> {
  const res = await window.electronAPI.exec(command);
  const code = res.code ?? res.exitCode;
  if (code !== 0) {
    throw new Error(res.stderr || 'command failed');
  }
  return JSON.parse(res.stdout || '{}') as T;
}

export const ControlCenterPage: React.FC = () => {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [queueTitle, setQueueTitle] = useState('');
  const [queueDetail, setQueueDetail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const execMutation = useCallback(
    async (prefix: string, payload: Record<string, unknown>) => {
      const res = await window.electronAPI.exec(`${prefix} ${JSON.stringify(payload)}`);
      const code = res.code ?? res.exitCode;
      if (code !== 0) {
        throw new Error(res.stderr || t('controlCenter.errors.mutationFailed'));
      }
      return res;
    },
    [t],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await window.electronAPI.exec('control:auto-sync');
      const [nextOverview, taskRes, queueRes] = await Promise.all([
        execJson<Overview>('control:overview'),
        execJson<{ items: TaskItem[] }>('control:tasks:list'),
        execJson<{ items: QueueItem[] }>('control:queue:list'),
      ]);
      setOverview(nextOverview);
      setTasks(taskRes.items || []);
      setQueueItems(queueRes.items || []);
    } catch (e: any) {
      setError(e?.message || t('controlCenter.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pendingQueue = useMemo(
    () => queueItems.filter((item) => item.status === 'pending'),
    [queueItems],
  );

  const threadSummary = useMemo(() => {
    const running = overview?.runningTasks ?? tasks.filter((item) => item.status === 'in_progress').length;
    const blocked = overview?.blockedTasks ?? tasks.filter((item) => item.status === 'blocked').length;
    const completed = overview?.doneTasks ?? tasks.filter((item) => item.status === 'done').length;
    return { running, blocked, completed };
  }, [overview, tasks]);

  const runningTasks = useMemo(
    () => tasks.filter((item) => item.status === 'in_progress' || item.status === 'blocked'),
    [tasks],
  );

  const addTask = async () => {
    const title = taskTitle.trim();
    if (!title) return;
    await execMutation('control:tasks:add', { title });
    setTaskTitle('');
    await refresh();
  };

  const addQueue = async () => {
    const title = queueTitle.trim();
    if (!title) return;
    await execMutation('control:queue:add', { title, detail: queueDetail, severity: 'warn' });
    setQueueTitle('');
    setQueueDetail('');
    await refresh();
  };

  const updateTaskStatus = async (taskId: string, status: TaskStatus) => {
    await execMutation('control:tasks:update-status', { taskId, status });
    await refresh();
  };

  const ackQueue = async (itemId: string) => {
    await execMutation('control:queue:ack', { itemId });
    await refresh();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">{t('controlCenter.kpi.tasks')}</div>
          <div className="text-2xl font-black">{overview?.taskCount ?? tasks.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">{t('controlCenter.kpi.pendingQueue')}</div>
          <div className="text-2xl font-black">{overview?.pendingQueue ?? pendingQueue.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">Running Threads</div>
          <div className="text-2xl font-black">{threadSummary.running}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">Blocked Threads</div>
          <div className="text-2xl font-black">{threadSummary.blocked}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-black">{t('controlCenter.tasks.title')}</h3>
            <button onClick={() => void refresh()} className="text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700">
              {loading ? t('controlCenter.actions.loading') : t('controlCenter.actions.refresh')}
            </button>
          </div>

          <div className="flex gap-2">
            <input
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              placeholder={t('controlCenter.tasks.newTaskPlaceholder')}
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
            />
            <button onClick={() => void addTask()} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold">
              {t('controlCenter.actions.add')}
            </button>
          </div>

          <div className="space-y-2">
            {tasks.length === 0 && <div className="text-sm text-slate-500">{t('controlCenter.empty.tasks')}</div>}
            {tasks.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-sm">{item.title}</div>
                  <div className="text-[11px] text-slate-500">{item.status} · p{item.priority}</div>
                </div>
                <select
                  value={item.status}
                  onChange={(e) => void updateTaskStatus(item.id, e.target.value as TaskStatus)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                >
                  <option value="todo">todo</option>
                  <option value="in_progress">in_progress</option>
                  <option value="blocked">blocked</option>
                  <option value="done">done</option>
                </select>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-6 space-y-4">
          <h3 className="text-lg font-black">{t('controlCenter.queue.title')}</h3>

          <div className="grid grid-cols-1 gap-2">
            <input
              value={queueTitle}
              onChange={(e) => setQueueTitle(e.target.value)}
              placeholder={t('controlCenter.queue.newQueueTitlePlaceholder')}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
            />
            <input
              value={queueDetail}
              onChange={(e) => setQueueDetail(e.target.value)}
              placeholder={t('controlCenter.queue.newQueueDetailPlaceholder')}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
            />
            <button onClick={() => void addQueue()} className="px-4 py-2 rounded-xl bg-amber-600 text-white text-sm font-bold">
              {t('controlCenter.actions.addQueue')}
            </button>
          </div>

          <div className="space-y-2">
            {pendingQueue.length === 0 && <div className="text-sm text-slate-500">{t('controlCenter.empty.queue')}</div>}
            {pendingQueue.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-sm">{item.title}</div>
                  <div className="text-[11px] text-slate-500">{item.detail || '-'}</div>
                </div>
                <button onClick={() => void ackQueue(item.id)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold">
                  {t('controlCenter.actions.ack')}
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-6 space-y-4">
        <h3 className="text-lg font-black">Thread Board</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Running</div>
            <div className="mt-1 text-xl font-black">{threadSummary.running}</div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Blocked</div>
            <div className="mt-1 text-xl font-black">{threadSummary.blocked}</div>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3">
            <div className="text-xs text-slate-500">Completed</div>
            <div className="mt-1 text-xl font-black">{threadSummary.completed}</div>
          </div>
        </div>

        <div className="space-y-2">
          {runningTasks.length === 0 ? (
            <div className="text-sm text-slate-500">No active thread tasks</div>
          ) : (
            runningTasks.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-sm">{item.title}</div>
                    <div className="text-[11px] text-slate-500">{item.status} · p{item.priority}</div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-[11px] font-bold ${item.status === 'blocked' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>
                    {item.status}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 text-rose-700 px-4 py-3 text-sm">
          {error}
        </div>
      ) : null}
    </div>
  );
};
