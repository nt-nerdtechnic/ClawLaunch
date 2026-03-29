import path from 'node:path';
import fs from 'node:fs/promises';
import { t } from '../../utils/i18n.js';
import { buildId } from '../../utils/normalize.js';
import {
  readControlCenterState, appendControlAudit, buildControlOverview, buildControlBudgetStatus,
  enforceControlMutationTokenGate, runControlAutoSync, nowIso,
  type ControlCenterState, type ControlApprovalItem, type ControlApprovalStatus,
  type ControlProjectItem, type ControlQueueItem,
} from '../../services/control-center.js';
import type { CommandResult } from './types.js';
import type { ShellExecContext } from '../shell-exec-handler.js';

// ── NT tasks helpers ─────────────────────────────────────────────────────────

async function getNTTasksFile(ctx: ShellExecContext): Promise<string> {
  const { workspacePath } = await ctx.readLauncherConfigPaths();
  if (workspacePath) return path.join(workspacePath, 'tasks.json');
  return path.join(ctx.persistentConfigDir, 'tasks-fallback.json');
}

async function readNTTasks(ctx: ShellExecContext): Promise<Record<string, unknown>[]> {
  try {
    const file = await getNTTasksFile(ctx);
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

async function writeNTTasks(ctx: ShellExecContext, tasks: Record<string, unknown>[]): Promise<void> {
  const file = await getNTTasksFile(ctx);
  await fs.writeFile(file, JSON.stringify(tasks, null, 2), 'utf-8');
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleControlCommands(fullCommand: string, ctx: ShellExecContext): Promise<CommandResult | null> {
  // ── Pre-gate commands ────────────────────────────────────────────────────
  if (fullCommand === 'control:auth:status') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ tokenRequired: !!String(state.controlToken || '').trim() }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'control auth status failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:auth:set-token ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:auth:set-token ', '').trim() || '{}');
      const newToken = String(payload?.newToken || '').trim();
      const currentToken = String(payload?.currentToken || '').trim();
      const state = await readControlCenterState();
      const existing = String(state.controlToken || '').trim();
      if (existing && existing !== currentToken) {
        return { code: 1, stdout: '', stderr: 'current token mismatch', exitCode: 1 };
      }
      const next: ControlCenterState = { ...state, controlToken: newToken };
      const audited = await appendControlAudit(next, 'control.auth.setToken', 'control-token', true, newToken ? 'token enabled' : 'token disabled');
      return { code: 0, stdout: JSON.stringify({ tokenRequired: !!audited.controlToken }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'set control token failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:auto-sync') {
    try {
      const result = await runControlAutoSync();
      return { code: 0, stdout: JSON.stringify(result), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'control auto sync failed', exitCode: 1 };
    }
  }

  // Only handle control: prefix further
  if (!fullCommand.startsWith('control:')) return null;

  // ── Token gate ───────────────────────────────────────────────────────────
  const gate = await enforceControlMutationTokenGate(fullCommand);
  if (!gate.ok) {
    return { code: 1, stdout: '', stderr: gate.message || 'control mutation blocked by token gate', exitCode: 1 };
  }

  // ── Gated commands ───────────────────────────────────────────────────────
  if (fullCommand === 'control:overview') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify(buildControlOverview(state)), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'control overview failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:budget:get') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ policy: state.budgetPolicy, snapshot: buildControlBudgetStatus(state) }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'get budget failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:budget:set-policy ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:budget:set-policy ', '').trim() || '{}');
      const dailyUsdLimit = Number(payload?.dailyUsdLimit);
      const warnRatio = Number(payload?.warnRatio);
      if (!Number.isFinite(dailyUsdLimit) || dailyUsdLimit <= 0) {
        return { code: 1, stdout: '', stderr: 'dailyUsdLimit invalid', exitCode: 1 };
      }
      if (!Number.isFinite(warnRatio) || warnRatio <= 0 || warnRatio >= 1) {
        return { code: 1, stdout: '', stderr: 'warnRatio invalid', exitCode: 1 };
      }
      const state = await readControlCenterState();
      const next: ControlCenterState = { ...state, budgetPolicy: { dailyUsdLimit: Number(dailyUsdLimit.toFixed(2)), warnRatio: Number(warnRatio.toFixed(3)) } };
      const audited = await appendControlAudit(next, 'budget.setPolicy', 'budget-policy', true, `limit=${dailyUsdLimit}, warn=${warnRatio}`);
      return { code: 0, stdout: JSON.stringify({ policy: audited.budgetPolicy, snapshot: buildControlBudgetStatus(audited) }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'set budget policy failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:approvals:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.approvals }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'list approvals failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:approvals:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:approvals:add ', '').trim() || '{}');
      const title = String(payload?.title || '').trim();
      if (!title) return { code: 1, stdout: '', stderr: 'approval title is required', exitCode: 1 };
      const now = nowIso();
      const item: ControlApprovalItem = { id: buildId('approval'), title, detail: String(payload?.detail || '').trim(), status: 'pending', createdAt: now, updatedAt: now };
      const state = await readControlCenterState();
      const next: ControlCenterState = { ...state, approvals: [item, ...state.approvals] };
      const audited = await appendControlAudit(next, 'approval.add', item.id, true, `approval created: ${item.title}`);
      return { code: 0, stdout: JSON.stringify({ item, total: audited.approvals.length }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'add approval failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:approvals:decide ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:approvals:decide ', '').trim() || '{}');
      const approvalId = String(payload?.approvalId || '').trim();
      const decision = String(payload?.decision || '').trim();
      const reason = String(payload?.reason || '').trim();
      const dryRun = payload?.dryRun !== false;
      if (!approvalId || !['approved', 'rejected'].includes(decision)) {
        return { code: 1, stdout: '', stderr: 'approvalId/decision invalid', exitCode: 1 };
      }
      const state = await readControlCenterState();
      const target = state.approvals.find((item) => item.id === approvalId);
      if (!target) return { code: 1, stdout: '', stderr: 'approval not found', exitCode: 1 };
      if (dryRun) {
        const audited = await appendControlAudit(state, 'approval.decide.dryRun', approvalId, true, `dry-run ${decision}`);
        return { code: 0, stdout: JSON.stringify({ dryRun: true, item: target, auditSize: audited.audit.length }), stderr: '', exitCode: 0 };
      }
      const now = nowIso();
      const approvals = state.approvals.map((item) => {
        if (item.id !== approvalId) return item;
        return { ...item, status: decision as ControlApprovalStatus, decisionReason: reason, updatedAt: now, decidedAt: now };
      });
      const next: ControlCenterState = { ...state, approvals };
      const audited = await appendControlAudit(next, 'approval.decide.live', approvalId, true, `live ${decision}`);
      return { code: 0, stdout: JSON.stringify({ dryRun: false, items: audited.approvals }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'decide approval failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:tasks:list') {
    try {
      const items = await readNTTasks(ctx);
      return { code: 0, stdout: JSON.stringify({ items }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'list tasks failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:tasks:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:tasks:add ', '').trim() || '{}');
      const title = String(payload?.title || '').trim();
      if (!title) return { code: 1, stdout: '', stderr: 'task title is required', exitCode: 1 };
      const now = nowIso();
      const task = {
        id: Math.random().toString(36).slice(2, 10),
        title,
        status: ['todo', 'in_progress', 'blocked', 'done'].includes(String(payload?.status || '')) ? payload.status : 'todo',
        priority: String(payload?.priority || 'medium'),
        components: [
          { key: 'initial_purpose', label: t('main.constants.initialPurpose'), content: '', weight: 0.2, progress: 0.0 },
          { key: 'final_goal', label: t('main.constants.finalGoal'), content: '', weight: 0.3, progress: 0.0 },
          { key: 'description', label: t('main.constants.description'), content: String(payload?.description || ''), weight: 0.5, progress: 0.0 },
        ],
        overall_progress: 0.0, created_at: now, updated_at: now,
        owner: String(payload?.owner || ''), tags: [], metadata: {},
      };
      const tasks = await readNTTasks(ctx);
      tasks.unshift(task);
      await writeNTTasks(ctx, tasks);
      return { code: 0, stdout: JSON.stringify({ item: task, total: tasks.length }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'add task failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:tasks:update-status ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:tasks:update-status ', '').trim() || '{}');
      const taskId = String(payload?.taskId || '').trim();
      const status = String(payload?.status || '').trim();
      if (!taskId || !['todo', 'in_progress', 'blocked', 'done'].includes(status)) {
        return { code: 1, stdout: '', stderr: 'taskId/status invalid', exitCode: 1 };
      }
      const tasks = await readNTTasks(ctx);
      let found = false;
      const updated = tasks.map((tsk) => {
        if (tsk.id !== taskId) return tsk;
        found = true;
        const next: Record<string, unknown> = { ...tsk, status, updated_at: nowIso() };
        if (status === 'done') {
          next.overall_progress = 100.0;
          next.components = ((tsk.components as Record<string, unknown>[] | undefined) || []).map((c) => ({ ...c, progress: 1.0 }));
        }
        return next;
      });
      if (!found) return { code: 1, stdout: '', stderr: 'task not found', exitCode: 1 };
      await writeNTTasks(ctx, updated);
      return { code: 0, stdout: JSON.stringify({ items: updated }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'update task status failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:tasks:delete ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:tasks:delete ', '').trim() || '{}');
      const taskId = String(payload?.taskId || '').trim();
      if (!taskId) return { code: 1, stdout: '', stderr: 'taskId is required', exitCode: 1 };
      const tasks = await readNTTasks(ctx);
      await writeNTTasks(ctx, tasks.filter((tsk) => tsk.id !== taskId));
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'delete task failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:projects:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.projects }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'list projects failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:projects:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:projects:add ', '').trim() || '{}');
      const name = String(payload?.name || '').trim();
      if (!name) return { code: 1, stdout: '', stderr: 'project name is required', exitCode: 1 };
      const now = nowIso();
      const project: ControlProjectItem = {
        id: buildId('project'), name,
        status: ['active', 'paused', 'done'].includes(String(payload?.status || '')) ? payload.status : 'active',
        createdAt: now, updatedAt: now,
      };
      const state = await readControlCenterState();
      const next = { ...state, projects: [project, ...state.projects] };
      const audited = await appendControlAudit(next, 'project.add', project.id, true, `project created: ${project.name}`);
      return { code: 0, stdout: JSON.stringify({ item: project, total: audited.projects.length }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'add project failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:queue:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.queue }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'list queue failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:queue:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:queue:add ', '').trim() || '{}');
      const title = String(payload?.title || '').trim();
      if (!title) return { code: 1, stdout: '', stderr: 'queue title is required', exitCode: 1 };
      const queueItem: ControlQueueItem = {
        id: buildId('queue'), title, detail: String(payload?.detail || '').trim(),
        severity: ['info', 'warn', 'critical'].includes(String(payload?.severity || '')) ? payload.severity : 'warn',
        status: 'pending', createdAt: nowIso(),
      };
      const state = await readControlCenterState();
      const next = { ...state, queue: [queueItem, ...state.queue] };
      const audited = await appendControlAudit(next, 'queue.add', queueItem.id, true, `queue item created: ${queueItem.title}`);
      return { code: 0, stdout: JSON.stringify({ item: queueItem, total: audited.queue.length }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'add queue failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:queue:ack ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:queue:ack ', '').trim() || '{}');
      const itemId = String(payload?.itemId || '').trim();
      if (!itemId) return { code: 1, stdout: '', stderr: 'itemId is required', exitCode: 1 };
      const state = await readControlCenterState();
      let found = false;
      const queue = state.queue.map((item) => {
        if (item.id !== itemId) return item;
        found = true;
        return { ...item, status: 'acked' as const, ackedAt: nowIso() };
      });
      if (!found) return { code: 1, stdout: '', stderr: 'queue item not found', exitCode: 1 };
      const next = { ...state, queue };
      const audited = await appendControlAudit(next, 'queue.ack', itemId, true, 'queue item acknowledged');
      return { code: 0, stdout: JSON.stringify({ items: audited.queue }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'ack queue failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:audit:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.audit }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'list audit failed', exitCode: 1 };
    }
  }

  return null;
}
