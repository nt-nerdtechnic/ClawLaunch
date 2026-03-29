/** Governance 服務：任務逾時檢查、事件生成、稽核時間軸、ack 持久化。 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { t } from '../utils/i18n.js';
import { normalizeArray, normalizeString, normalizeNumber, pickFirst, safeJsonParse } from '../utils/normalize.js';

// ── Governance 型別 ────────────────────────────────────────────────────────

export type GovernanceEventLevel = 'info' | 'warn' | 'action-required';

export type GovernanceEvent = {
  id: string;
  level: GovernanceEventLevel;
  title: string;
  detail: string;
  source: string;
  createdAt: string;
  entityId?: string;
  status?: 'pending' | 'acked' | 'expired';
  ackedAt?: string;
  ackExpiresAt?: string;
};

export type AuditTimelineEntry = {
  id: string;
  level: GovernanceEventLevel;
  source: string;
  message: string;
  timestamp: string;
};

export type EventAckRecord = {
  ackedAt: string;
  expiresAt: string;
};

// ── Governance 邏輯 ────────────────────────────────────────────────────────

export const computeTaskGovernance = (readModel: unknown, timeoutMs: number, nowIso: string) => {
  const rm = readModel as Record<string, unknown>;
  const tasks = normalizeArray(rm?.tasks) as Record<string, unknown>[];
  const now = new Date(nowIso).getTime();
  const normalizedTasks = tasks.map((task) => ({ ...task }));
  const events: GovernanceEvent[] = [];

  for (const task of normalizedTasks) {
    const status = normalizeString(task?.status, '').toLowerCase();
    if (status !== 'in_progress') continue;
    const updatedAt = normalizeString(task?.updatedAt, '');
    const updatedTs = new Date(updatedAt).getTime();
    if (Number.isNaN(updatedTs)) continue;

    const ageMs = Math.max(0, now - updatedTs);
    if (ageMs < timeoutMs) continue;

    task.status = 'blocked';
    events.push({
      id: `task-blocked:${normalizeString(task?.id, 'unknown-task')}`,
      level: 'action-required',
      title: 'Task heartbeat timeout',
      detail: t('main.activity.task.timeout', { title: normalizeString(task?.title, 'Task') }),
      source: 'task-heartbeat',
      createdAt: nowIso,
      entityId: normalizeString(task?.id, ''),
    });
  }

  return { tasks: normalizedTasks, events };
};

export const buildGovernanceEvents = (readModel: unknown, nowIso: string): GovernanceEvent[] => {
  const rm = readModel as Record<string, unknown>;
  const events: GovernanceEvent[] = [];
  const approvals = normalizeArray(rm?.approvals) as Record<string, unknown>[];
  const statuses = normalizeArray(rm?.statuses) as Record<string, unknown>[];
  const budgetEvaluations = normalizeArray((rm?.budgetSummary as Record<string, unknown>)?.evaluations) as Record<string, unknown>[];

  const pendingApprovals = approvals.filter((item) => {
    const status = normalizeString(item?.status, '').toLowerCase();
    return status === '' || status === 'pending' || status === 'requested';
  });

  if (pendingApprovals.length > 0) {
    events.push({
      id: 'approval-pending',
      level: 'action-required',
      title: 'Pending approvals',
      detail: t('main.activity.approvals.pending', { count: pendingApprovals.length }),
      source: 'approval',
      createdAt: nowIso,
    });
  }

  const blockedCount = statuses.filter((s) => normalizeString(s?.state, '').toLowerCase() === 'blocked').length;
  const errorCount = statuses.filter((s) => normalizeString(s?.state, '').toLowerCase() === 'error').length;
  if (blockedCount > 0 || errorCount > 0) {
    events.push({
      id: 'runtime-risk',
      level: 'action-required',
      title: 'Runtime risk detected',
      detail: t('main.activity.errors.summary', { blocked: blockedCount, error: errorCount }),
      source: 'runtime',
      createdAt: nowIso,
    });
  }

  const overBudget = budgetEvaluations.filter((b) => normalizeString(b?.status, '').toLowerCase() === 'over').length;
  const warnBudget = budgetEvaluations.filter((b) => normalizeString(b?.status, '').toLowerCase() === 'warn').length;
  if (overBudget > 0 || warnBudget > 0) {
    events.push({
      id: 'budget-risk',
      level: overBudget > 0 ? 'action-required' : 'warn',
      title: 'Budget risk',
      detail: t('main.activity.budget.summary', { over: overBudget, warn: warnBudget }),
      source: 'budget',
      createdAt: nowIso,
    });
  }

  if (events.length === 0) {
    events.push({
      id: 'system-all-clear',
      level: 'info',
      title: 'All clear',
      detail: t('main.activity.risk.noRisks'),
      source: 'system',
      createdAt: nowIso,
    });
  }

  return events;
};

export const resolveRuntimeDirFromCandidates = async (candidatePaths: string[]) => {
  for (const candidate of candidatePaths) {
    const trimmed = normalizeString(candidate, '');
    if (!trimmed) continue;
    try {
      const stats = await fs.stat(trimmed);
      if (stats.isDirectory()) return trimmed;
    } catch {
      continue;
    }
  }
  return '';
};

export const loadEventAcks = async (runtimeDir: string): Promise<Record<string, EventAckRecord>> => {
  if (!runtimeDir) return {};
  const ackPath = path.join(runtimeDir, 'event-acks.json');
  try {
    const raw = await fs.readFile(ackPath, 'utf-8');
    const parsed = safeJsonParse(raw, {});
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, EventAckRecord>;
  } catch {
    return {};
  }
};

export const saveEventAcks = async (runtimeDir: string, acks: Record<string, EventAckRecord>) => {
  if (!runtimeDir) return;
  await fs.mkdir(runtimeDir, { recursive: true });
  const ackPath = path.join(runtimeDir, 'event-acks.json');
  await fs.writeFile(ackPath, `${JSON.stringify(acks, null, 2)}\n`, 'utf-8');
};

export const applyAckStateToEvents = (events: GovernanceEvent[], acks: Record<string, EventAckRecord>, nowIso: string) => {
  const now = new Date(nowIso).getTime();
  const activeEvents: GovernanceEvent[] = [];
  const ackedEvents: GovernanceEvent[] = [];

  for (const event of events) {
    const ack = acks[event.id];
    if (!ack) {
      activeEvents.push({ ...event, status: 'pending' });
      continue;
    }

    const expiresTs = new Date(ack.expiresAt).getTime();
    if (!Number.isNaN(expiresTs) && expiresTs > now) {
      ackedEvents.push({
        ...event,
        status: 'acked',
        ackedAt: ack.ackedAt,
        ackExpiresAt: ack.expiresAt,
      });
      continue;
    }

    activeEvents.push({ ...event, status: 'pending' });
  }

  return { activeEvents, ackedEvents };
};

export const parseAuditLine = (line: string, source: string): AuditTimelineEntry | null => {
  const trimmed = normalizeString(line, '');
  if (!trimmed) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    parsed = null;
  }

  if (parsed && typeof parsed === 'object') {
    const timestamp = normalizeString(pickFirst(parsed, ['timestamp', 'generatedAt', 'updatedAt', 'createdAt', 'at'], new Date().toISOString()));
    const severityRaw = normalizeString(pickFirst(parsed, ['severity', 'level', 'status'], 'info')).toLowerCase();
    const level: GovernanceEventLevel = severityRaw === 'error' || severityRaw === 'critical' ? 'action-required' : severityRaw === 'warn' || severityRaw === 'warning' ? 'warn' : 'info';
    const message = normalizeString(pickFirst(parsed, ['message', 'detail', 'summary', 'title'], trimmed));
    return {
      id: `${source}:${timestamp}:${message.slice(0, 30)}`,
      level,
      source,
      message,
      timestamp,
    };
  }

  return {
    id: `${source}:${Date.now()}:${trimmed.slice(0, 30)}`,
    level: 'info',
    source,
    message: trimmed,
    timestamp: new Date().toISOString(),
  };
};

export const buildAuditTimeline = async (runtimeDir: string, governanceEvents: GovernanceEvent[]) => {
  const entries: AuditTimelineEntry[] = governanceEvents.map((event) => ({
    id: `event:${event.id}:${event.createdAt}`,
    level: event.level,
    source: `event:${event.source}`,
    message: `${event.title} - ${event.detail}`,
    timestamp: event.createdAt,
  }));

  const candidates: Array<{ path: string; source: string }> = [
    { path: path.join(runtimeDir, 'timeline.log'), source: 'timeline' },
    { path: path.join(runtimeDir, 'audit.log'), source: 'audit' },
    { path: path.join(runtimeDir, 'approvals.log'), source: 'approvals' },
    { path: path.join(runtimeDir, 'task-heartbeat.log'), source: 'task-heartbeat' },
  ];

  for (const candidate of candidates) {
    try {
      const raw = await fs.readFile(candidate.path, 'utf-8');
      const lines = raw.split(/\r?\n/).filter(Boolean).slice(-120);
      for (const line of lines) {
        const item = parseAuditLine(line, candidate.source);
        if (item) entries.push(item);
      }
    } catch {
      continue;
    }
  }

  return entries
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(-200);
};

export const buildDailyDigestMarkdown = (timeline: AuditTimelineEntry[]) => {
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayItems = timeline.filter((item) => normalizeString(item.timestamp, '').startsWith(dateKey));
  const counts = { info: 0, warn: 0, 'action-required': 0 };
  for (const item of todayItems) {
    counts[item.level] += 1;
  }

  const topItems = todayItems.slice(-5).map((item) => `- [${item.level}] ${item.message}`);

  return [
    `# Daily Digest (${dateKey})`,
    '',
    `- info: ${counts.info}`,
    `- warn: ${counts.warn}`,
    `- action-required: ${counts['action-required']}`,
    '',
    '## Latest Signals',
    ...(topItems.length > 0 ? topItems : ['- no significant signals']),
    '',
  ].join('\n');
};
