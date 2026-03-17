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
  projectCount: number;
  criticalQueue: number;
  pendingApprovals: number;
  budget: {
    estimatedTodayUsd: number;
    dailyUsdLimit: number;
    warnRatio: number;
    usedRatio: number;
    status: 'ok' | 'warn' | 'critical';
  };
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

interface ProjectItem {
  id: string;
  name: string;
  status: 'active' | 'paused' | 'done';
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

interface AuditItem {
  id: string;
  action: string;
  targetId: string;
  ok: boolean;
  message: string;
  createdAt: string;
}

interface ApprovalItem {
  id: string;
  title: string;
  detail: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  decisionReason?: string;
}

interface BudgetResponse {
  policy: {
    dailyUsdLimit: number;
    warnRatio: number;
  };
  snapshot: {
    estimatedTodayUsd: number;
    dailyUsdLimit: number;
    warnRatio: number;
    usedRatio: number;
    status: 'ok' | 'warn' | 'critical';
  };
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
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [approvalTitle, setApprovalTitle] = useState('');
  const [approvalDetail, setApprovalDetail] = useState('');
  const [approvalDryRunMode, setApprovalDryRunMode] = useState(true);
  const [controlToken, setControlToken] = useState('');
  const [controlTokenCurrentInput, setControlTokenCurrentInput] = useState('');
  const [controlTokenNewInput, setControlTokenNewInput] = useState('');
  const [tokenRequired, setTokenRequired] = useState(false);
  const [budgetLimitInput, setBudgetLimitInput] = useState('20');
  const [budgetWarnInput, setBudgetWarnInput] = useState('0.8');
  const [budgetSnapshot, setBudgetSnapshot] = useState<BudgetResponse['snapshot'] | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [queueTitle, setQueueTitle] = useState('');
  const [queueDetail, setQueueDetail] = useState('');
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const execMutation = useCallback(
    async (prefix: string, payload: Record<string, any>) => {
      const nextPayload = { ...payload, token: controlToken };
      const res = await window.electronAPI.exec(`${prefix} ${JSON.stringify(nextPayload)}`);
      const code = res.code ?? res.exitCode;
      if (code !== 0) {
        throw new Error(res.stderr || t('controlCenter.errors.mutationFailed'));
      }
      return res;
    },
    [controlToken, t],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await window.electronAPI.exec('control:auto-sync');
      const [nextOverview, taskRes, projectRes, queueRes, auditRes, approvalRes, budgetRes] = await Promise.all([
        execJson<Overview>('control:overview'),
        execJson<{ items: TaskItem[] }>('control:tasks:list'),
        execJson<{ items: ProjectItem[] }>('control:projects:list'),
        execJson<{ items: QueueItem[] }>('control:queue:list'),
        execJson<{ items: AuditItem[] }>('control:audit:list'),
        execJson<{ items: ApprovalItem[] }>('control:approvals:list'),
        execJson<BudgetResponse>('control:budget:get'),
      ]);
      const authRes = await execJson<{ tokenRequired: boolean }>('control:auth:status');
      setOverview(nextOverview);
      setTasks(taskRes.items || []);
      setProjects(projectRes.items || []);
      setQueueItems(queueRes.items || []);
      setAuditItems(auditRes.items || []);
      setApprovals(approvalRes.items || []);
      setBudgetSnapshot(budgetRes.snapshot);
      setBudgetLimitInput(String(budgetRes.policy.dailyUsdLimit ?? 20));
      setBudgetWarnInput(String(budgetRes.policy.warnRatio ?? 0.8));
      setTokenRequired(!!authRes.tokenRequired);
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

  const addTask = async () => {
    const title = taskTitle.trim();
    if (!title) return;
    await execMutation('control:tasks:add', { title });
    setTaskTitle('');
    await refresh();
  };

  const addProject = async () => {
    const name = projectName.trim();
    if (!name) return;
    await execMutation('control:projects:add', { name });
    setProjectName('');
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

  const addApproval = async () => {
    const title = approvalTitle.trim();
    if (!title) return;
    await execMutation('control:approvals:add', { title, detail: approvalDetail });
    setApprovalTitle('');
    setApprovalDetail('');
    await refresh();
  };

  const decideApproval = async (approvalId: string, decision: 'approved' | 'rejected') => {
    await execMutation('control:approvals:decide', {
      approvalId,
      decision,
      reason: decision === 'approved' ? 'approved by operator' : 'rejected by operator',
      dryRun: approvalDryRunMode,
    });
    await refresh();
  };

  const saveBudgetPolicy = async () => {
    const dailyUsdLimit = Number(budgetLimitInput);
    const warnRatio = Number(budgetWarnInput);
    await execMutation('control:budget:set-policy', { dailyUsdLimit, warnRatio });
    await refresh();
  };

  const saveControlToken = async () => {
    const res = await window.electronAPI.exec(
      `control:auth:set-token ${JSON.stringify({
        currentToken: controlTokenCurrentInput,
        newToken: controlTokenNewInput,
      })}`,
    );
    const code = res.code ?? res.exitCode;
    if (code !== 0) {
      throw new Error(res.stderr || t('controlCenter.errors.tokenUpdateFailed'));
    }
    const parsed = JSON.parse(res.stdout || '{}');
    setTokenRequired(!!parsed.tokenRequired);
    setControlToken(controlTokenNewInput);
    setControlTokenCurrentInput('');
    setControlTokenNewInput('');
    await refresh();
  };

  const budgetStatusClass =
    budgetSnapshot?.status === 'critical'
      ? 'text-rose-600 dark:text-rose-300'
      : budgetSnapshot?.status === 'warn'
        ? 'text-amber-600 dark:text-amber-300'
        : 'text-emerald-600 dark:text-emerald-300';

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">{t('controlCenter.kpi.health')}</div>
          <div className="text-2xl font-black">{overview?.healthScore ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">{t('controlCenter.kpi.tasks')}</div>
          <div className="text-2xl font-black">{overview?.taskCount ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">{t('controlCenter.kpi.projects')}</div>
          <div className="text-2xl font-black">{overview?.projectCount ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">{t('controlCenter.kpi.pendingQueue')}</div>
          <div className="text-2xl font-black">{overview?.pendingQueue ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">{t('controlCenter.kpi.pendingApprovals')}</div>
          <div className="text-2xl font-black">{overview?.pendingApprovals ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <div className="text-xs text-slate-500">{t('controlCenter.kpi.budgetRisk')}</div>
          <div className={`text-2xl font-black uppercase ${budgetStatusClass}`}>
            {budgetSnapshot?.status || 'ok'}
          </div>
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
        <h3 className="text-lg font-black">{t('controlCenter.projects.title')}</h3>
        <div className="flex gap-2">
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder={t('controlCenter.projects.newProjectPlaceholder')}
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
          />
          <button onClick={() => void addProject()} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold">
            {t('controlCenter.actions.add')}
          </button>
        </div>

        <div className="space-y-2">
          {projects.length === 0 && <div className="text-sm text-slate-500">{t('controlCenter.empty.projects')}</div>}
          {projects.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3 text-sm font-bold">
              {item.name}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-6 space-y-4">
        <h3 className="text-lg font-black">{t('controlCenter.security.title')}</h3>
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3 text-sm flex items-center justify-between gap-4">
          <span>{t('controlCenter.security.currentMode')}</span>
          <span className={`font-black ${tokenRequired ? 'text-amber-600 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-300'}`}>
            {tokenRequired ? t('controlCenter.security.tokenRequired') : t('controlCenter.security.tokenNotRequired')}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            value={controlTokenCurrentInput}
            onChange={(e) => setControlTokenCurrentInput(e.target.value)}
            placeholder={t('controlCenter.security.currentTokenPlaceholder')}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
          />
          <input
            value={controlTokenNewInput}
            onChange={(e) => setControlTokenNewInput(e.target.value)}
            placeholder={t('controlCenter.security.newTokenPlaceholder')}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
          />
        </div>
        <div className="text-xs text-slate-500">{t('controlCenter.security.helper')}</div>
        <button onClick={() => void saveControlToken()} className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold">
          {t('controlCenter.security.saveToken')}
        </button>
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black">{t('controlCenter.approvals.title')}</h3>
          <button
            type="button"
            onClick={() => setApprovalDryRunMode((prev) => !prev)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
              approvalDryRunMode
                ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
                : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
            }`}
          >
            {approvalDryRunMode ? t('controlCenter.approvals.modeDryRun') : t('controlCenter.approvals.modeLive')}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <input
            value={approvalTitle}
            onChange={(e) => setApprovalTitle(e.target.value)}
            placeholder={t('controlCenter.approvals.newApprovalTitlePlaceholder')}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
          />
          <input
            value={approvalDetail}
            onChange={(e) => setApprovalDetail(e.target.value)}
            placeholder={t('controlCenter.approvals.newApprovalDetailPlaceholder')}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
          />
          <button onClick={() => void addApproval()} className="px-4 py-2 rounded-xl bg-fuchsia-600 text-white text-sm font-bold">
            {t('controlCenter.actions.addApproval')}
          </button>
        </div>

        <div className="space-y-2">
          {approvals.length === 0 && <div className="text-sm text-slate-500">{t('controlCenter.empty.approvals')}</div>}
          {approvals.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-sm">{item.title}</div>
                  <div className="text-[11px] text-slate-500">{item.status} · {item.detail || '-'}</div>
                </div>
                {item.status === 'pending' ? (
                  <div className="flex items-center gap-2">
                    <button onClick={() => void decideApproval(item.id, 'approved')} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold">
                      {t('controlCenter.actions.approve')}
                    </button>
                    <button onClick={() => void decideApproval(item.id, 'rejected')} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold">
                      {t('controlCenter.actions.reject')}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-6 space-y-4">
        <h3 className="text-lg font-black">{t('controlCenter.budget.title')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-1">
            <div className="text-xs text-slate-500">{t('controlCenter.budget.limitLabel')}</div>
            <input
              value={budgetLimitInput}
              onChange={(e) => setBudgetLimitInput(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
            />
          </label>
          <label className="space-y-1">
            <div className="text-xs text-slate-500">{t('controlCenter.budget.warnRatioLabel')}</div>
            <input
              value={budgetWarnInput}
              onChange={(e) => setBudgetWarnInput(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <button onClick={() => void saveBudgetPolicy()} className="px-4 py-2 rounded-xl bg-sky-600 text-white text-sm font-bold">
          {t('controlCenter.actions.savePolicy')}
        </button>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3 text-sm">
          <div className="text-slate-500">{t('controlCenter.budget.estimatedToday')}</div>
          <div className="mt-1 font-black text-lg">${budgetSnapshot?.estimatedTodayUsd ?? 0}</div>
          <div className={`text-xs mt-1 ${budgetStatusClass}`}>
            {t('controlCenter.budget.riskStatus')}: {budgetSnapshot?.status || 'ok'} ({Math.round((budgetSnapshot?.usedRatio || 0) * 100)}%)
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-6 space-y-4">
        <h3 className="text-lg font-black">{t('controlCenter.audit.title')}</h3>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {auditItems.length === 0 && <div className="text-sm text-slate-500">{t('controlCenter.empty.audit')}</div>}
          {auditItems.map((item) => (
            <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/40 p-3 text-xs">
              <div className="font-bold">{item.action} · {item.ok ? 'ok' : 'failed'}</div>
              <div className="text-slate-500 mt-1">{item.message}</div>
            </div>
          ))}
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
