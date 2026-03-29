/** Control Center 狀態管理：任務、專案、隊列、審批、預算政策與控制令牌。 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import { buildId } from '../utils/normalize.js';

// ── 型別宣告 ─────────────────────────────────────────────────────────────────

export type ControlTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export type ControlProjectStatus = 'active' | 'paused' | 'done';
export type ControlQueueSeverity = 'info' | 'warn' | 'critical';
export type ControlApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ControlTaskItem {
  id: string;
  title: string;
  status: ControlTaskStatus;
  projectId: string;
  owner: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface ControlProjectItem {
  id: string;
  name: string;
  status: ControlProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ControlQueueItem {
  id: string;
  title: string;
  detail: string;
  severity: ControlQueueSeverity;
  status: 'pending' | 'acked';
  createdAt: string;
  ackedAt?: string;
  sourceKey?: string;
}

export interface ControlAuditItem {
  id: string;
  action: string;
  targetId: string;
  ok: boolean;
  message: string;
  createdAt: string;
}

export interface ControlApprovalItem {
  id: string;
  title: string;
  detail: string;
  status: ControlApprovalStatus;
  sourceKey?: string;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  decisionReason?: string;
}

export interface ControlBudgetPolicy {
  dailyUsdLimit: number;
  warnRatio: number;
}

export interface ControlCenterState {
  tasks: ControlTaskItem[];
  projects: ControlProjectItem[];
  queue: ControlQueueItem[];
  audit: ControlAuditItem[];
  approvals: ControlApprovalItem[];
  budgetPolicy: ControlBudgetPolicy;
  controlToken: string;
}

// ── 常數 & 工廠函式 ───────────────────────────────────────────────────────────

export const CONTROL_CENTER_STATE_FILE = () => path.join(app.getPath('userData'), 'control-center-state.json');

export const defaultControlCenterState = (): ControlCenterState => ({
  tasks: [],
  projects: [],
  queue: [],
  audit: [],
  approvals: [],
  budgetPolicy: {
    dailyUsdLimit: 20,
    warnRatio: 0.8,
  },
  controlToken: '',
});

export const nowIso = () => new Date().toISOString();

// ── 狀態讀寫 ─────────────────────────────────────────────────────────────────

export async function readControlCenterState(): Promise<ControlCenterState> {
  const filePath = CONTROL_CENTER_STATE_FILE();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw || '{}') as Partial<ControlCenterState>;
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : [],
      approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
      budgetPolicy: {
        dailyUsdLimit: Number.isFinite(Number(parsed.budgetPolicy?.dailyUsdLimit))
          ? Math.max(1, Number(parsed.budgetPolicy?.dailyUsdLimit))
          : 20,
        warnRatio: Number.isFinite(Number(parsed.budgetPolicy?.warnRatio))
          ? Math.max(0.1, Math.min(0.95, Number(parsed.budgetPolicy?.warnRatio)))
          : 0.8,
      },
      controlToken: String(parsed.controlToken || '').trim(),
    };
  } catch {
    const initial = defaultControlCenterState();
    await fs.writeFile(filePath, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
}

export async function writeControlCenterState(state: ControlCenterState): Promise<void> {
  await fs.writeFile(CONTROL_CENTER_STATE_FILE(), JSON.stringify(state, null, 2), 'utf-8');
}

export async function appendControlAudit(
  state: ControlCenterState,
  action: string,
  targetId: string,
  ok: boolean,
  message: string,
): Promise<ControlCenterState> {
  const entry: ControlAuditItem = {
    id: buildId('audit'),
    action,
    targetId,
    ok,
    message,
    createdAt: nowIso(),
  };
  const audit = [entry, ...state.audit].slice(0, 300);
  const next = { ...state, audit };
  await writeControlCenterState(next);
  return next;
}

export function buildControlOverview(state: ControlCenterState) {
  const tasks = state.tasks;
  const queue = state.queue;
  const pendingQueue = queue.filter((item) => item.status === 'pending').length;
  const blockedTasks = tasks.filter((item) => item.status === 'blocked').length;
  const runningTasks = tasks.filter((item) => item.status === 'in_progress').length;
  const doneTasks = tasks.filter((item) => item.status === 'done').length;
  const healthScore = Math.max(0, 100 - blockedTasks * 15 - pendingQueue * 8);
  const budget = buildControlBudgetStatus(state);
  const pendingApprovals = state.approvals.filter((item) => item.status === 'pending').length;
  return {
    generatedAt: nowIso(),
    healthScore,
    pendingQueue,
    blockedTasks,
    runningTasks,
    doneTasks,
    taskCount: tasks.length,
    projectCount: state.projects.length,
    criticalQueue: queue.filter((item) => item.status === 'pending' && item.severity === 'critical').length,
    pendingApprovals,
    budget,
  };
}

export function buildControlBudgetStatus(state: ControlCenterState) {
  const doneTasks = state.tasks.filter((item) => item.status === 'done').length;
  const runningTasks = state.tasks.filter((item) => item.status === 'in_progress').length;
  const estimatedTodayUsd = doneTasks * 0.12 + runningTasks * 0.05;
  const limit = Math.max(1, Number(state.budgetPolicy.dailyUsdLimit || 20));
  const warnRatio = Math.max(0.1, Math.min(0.95, Number(state.budgetPolicy.warnRatio || 0.8)));
  const usedRatio = estimatedTodayUsd / limit;
  const status: 'ok' | 'warn' | 'critical' = usedRatio >= 1 ? 'critical' : usedRatio >= warnRatio ? 'warn' : 'ok';
  return {
    estimatedTodayUsd: Number(estimatedTodayUsd.toFixed(2)),
    dailyUsdLimit: limit,
    warnRatio,
    usedRatio: Number(usedRatio.toFixed(3)),
    status,
  };
}

export function isControlMutationCommand(fullCommand: string): boolean {
  const prefixes = [
    'control:tasks:add ',
    'control:tasks:update-status ',
    'control:tasks:delete ',
    'control:projects:add ',
    'control:queue:add ',
    'control:queue:ack ',
    'control:approvals:add ',
    'control:approvals:decide ',
    'control:budget:set-policy ',
    'cron:toggle ',
    'cron:delete ',
  ];
  return prefixes.some((prefix) => fullCommand.startsWith(prefix));
}

export function parseControlPayload(fullCommand: string): unknown {
  const spaceIdx = fullCommand.indexOf(' ');
  if (spaceIdx < 0) return {};
  const raw = fullCommand.slice(spaceIdx + 1).trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export async function enforceControlMutationTokenGate(fullCommand: string): Promise<{ ok: boolean; message?: string }> {
  if (!isControlMutationCommand(fullCommand)) {
    return { ok: true };
  }
  const state = await readControlCenterState();
  const requiredToken = String(state.controlToken || '').trim();
  if (!requiredToken) {
    return { ok: true };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = parseControlPayload(fullCommand) as Record<string, unknown>;
  } catch {
    return { ok: false, message: 'invalid mutation payload' };
  }

  const providedToken = String(payload?.token || '').trim();
  if (!providedToken) {
    return { ok: false, message: 'missing control token for mutation' };
  }
  if (providedToken !== requiredToken) {
    return { ok: false, message: 'invalid control token' };
  }
  return { ok: true };
}

export function pushQueueIfMissing(state: ControlCenterState, item: Omit<ControlQueueItem, 'id' | 'createdAt' | 'status'> & { sourceKey?: string }) {
  const sourceKey = String(item.sourceKey || '').trim();
  if (sourceKey) {
    const exists = state.queue.some((entry) => entry.sourceKey === sourceKey && entry.status === 'pending');
    if (exists) return state;
  }
  const nextItem: ControlQueueItem = {
    id: buildId('queue'),
    title: item.title,
    detail: item.detail,
    severity: item.severity,
    status: 'pending',
    createdAt: nowIso(),
    ...(sourceKey ? { sourceKey } as Partial<ControlQueueItem> : {}),
  };
  return { ...state, queue: [nextItem, ...state.queue] };
}

export function pushApprovalIfMissing(state: ControlCenterState, item: Omit<ControlApprovalItem, 'id' | 'createdAt' | 'updatedAt' | 'status'>) {
  const sourceKey = String(item.sourceKey || '').trim();
  if (sourceKey) {
    const exists = state.approvals.some((entry) => entry.sourceKey === sourceKey && entry.status === 'pending');
    if (exists) return state;
  }
  const now = nowIso();
  const nextItem: ControlApprovalItem = {
    id: buildId('approval'),
    title: item.title,
    detail: item.detail,
    sourceKey: sourceKey || undefined,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
  return { ...state, approvals: [nextItem, ...state.approvals] };
}

export async function runControlAutoSync(): Promise<{ queueCreated: number; approvalsCreated: number }> {
  let state = await readControlCenterState();
  const beforeQueue = state.queue.length;
  const beforeApprovals = state.approvals.length;
  const now = Date.now();

  for (const task of state.tasks) {
    const updatedAtMs = new Date(task.updatedAt || task.createdAt || nowIso()).getTime();
    const staleMs = now - (Number.isFinite(updatedAtMs) ? updatedAtMs : now);

    if (task.status === 'blocked') {
      state = pushQueueIfMissing(state, {
        title: `Blocked: ${task.title}`,
        detail: `Task ${task.id} is blocked and requires intervention`,
        severity: task.priority >= 5 ? 'critical' : 'warn',
        sourceKey: `task-blocked:${task.id}`,
      });

      if (task.priority >= 5) {
        state = pushApprovalIfMissing(state, {
          title: `Approval required: ${task.title}`,
          detail: `High-priority blocked task requires operator decision`,
          sourceKey: `task-approval:${task.id}`,
        });
      }
    }

    if (task.status === 'in_progress' && staleMs >= 2 * 60 * 60 * 1000) {
      state = pushQueueIfMissing(state, {
        title: `Stalled: ${task.title}`,
        detail: `No updates for ${Math.floor(staleMs / 60000)} min`,
        severity: staleMs >= 4 * 60 * 60 * 1000 ? 'critical' : 'warn',
        sourceKey: `task-stalled:${task.id}`,
      });
    }
  }

  if (state.queue.length !== beforeQueue || state.approvals.length !== beforeApprovals) {
    state = await appendControlAudit(
      state,
      'control.autoSync',
      'runtime-signals',
      true,
      `queue+${state.queue.length - beforeQueue}, approvals+${state.approvals.length - beforeApprovals}`,
    );
  }

  return {
    queueCreated: Math.max(0, state.queue.length - beforeQueue),
    approvalsCreated: Math.max(0, state.approvals.length - beforeApprovals),
  };
}
