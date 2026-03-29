/** Snapshot 正規化與 Read Model 轉換：session JSON 解析、JSONL 掃描與使用量統計。 */

import { normalizeArray, normalizeString, normalizeNumber, pickFirst, estimateUsageCost } from '../utils/normalize.js';

export const normalizeBudgetSummary = (budgetSummary: unknown) => {
  const raw = (budgetSummary && typeof budgetSummary === 'object' ? budgetSummary : {}) as Record<string, unknown>;
  const evaluations = normalizeArray(raw.evaluations).map((item) => ({
    scope: normalizeString(pickFirst(item, ['scope', 'target', 'id'], 'global')),
    status: normalizeString(pickFirst(item, ['status', 'state'], 'unknown')).toLowerCase(),
    usedCost30d: normalizeNumber(pickFirst(item, ['usedCost30d', 'used', 'usedCost'], 0), 0),
    limitCost30d: normalizeNumber(pickFirst(item, ['limitCost30d', 'limit', 'budgetLimit'], 0), 0),
  }));

  return {
    status: normalizeString(pickFirst(raw, ['status', 'state'], 'unknown')).toLowerCase(),
    usedCost30d: normalizeNumber(pickFirst(raw, ['usedCost30d', 'used', 'usedCost'], 0), 0),
    limitCost30d: normalizeNumber(pickFirst(raw, ['limitCost30d', 'limit', 'budgetLimit'], 0), 0),
    burnRatePerDay: normalizeNumber(pickFirst(raw, ['burnRatePerDay', 'burnRate', 'dailyBurnRate'], 0), 0),
    projectedDaysToLimit: normalizeNumber(pickFirst(raw, ['projectedDaysToLimit', 'projectedDays', 'daysToLimit'], 0), 0),
    evaluations,
  };
};

export const normalizeReadModelSnapshot = (snapshot: unknown) => {
  const raw = (snapshot && typeof snapshot === 'object' ? snapshot : {}) as Record<string, unknown>;
  const sessionsRaw = normalizeArray(raw.sessions) as Record<string, unknown>[];
  const statusesRaw = normalizeArray(raw.statuses) as Record<string, unknown>[];
  const tasksSource = (Array.isArray(raw.tasks) ? raw.tasks : normalizeArray((raw.tasks as Record<string, unknown>)?.tasks)) as Record<string, unknown>[];
  const approvalsSource = (Array.isArray(raw.approvals) ? raw.approvals : normalizeArray((raw.approvals as Record<string, unknown>)?.items)) as Record<string, unknown>[];

  const statuses = statusesRaw.map((item) => ({
    sessionKey: normalizeString(pickFirst(item, ['sessionKey', 'session_id', 'session'], 'unknown')),
    state: normalizeString(pickFirst(item, ['state', 'status'], 'unknown')).toLowerCase(),
    tokensIn: normalizeNumber(pickFirst(item, ['tokensIn', 'inputTokens', 'tokens_in'], 0), 0),
    tokensOut: normalizeNumber(pickFirst(item, ['tokensOut', 'outputTokens', 'tokens_out'], 0), 0),
    cost: normalizeNumber(pickFirst(item, ['cost', 'totalCost', 'estimatedCost', 'costUsd'], 0), 0),
    model: normalizeString(pickFirst(item, ['model', 'modelName'], '')),
    contextWindowTokens: normalizeNumber(pickFirst(item, ['contextWindowTokens', 'contextTokens', 'context_limit_tokens'], 0), 0),
  }));

  const statusMap = new Map<string, (typeof statuses)[number]>();
  for (const status of statuses) {
    if (status.sessionKey) statusMap.set(status.sessionKey, status);
  }

  const sessions = sessionsRaw.map((item) => {
    const sessionKey = normalizeString(pickFirst(item, ['sessionKey', 'session_id', 'id', 'key'], 'unknown'));
    const mappedStatus = statusMap.get(sessionKey);
    return {
      sessionKey,
      agentId: normalizeString(pickFirst(item, ['agentId', 'agent_id', 'agent', 'owner'], 'main')),
      status: normalizeString(pickFirst(item, ['status', 'state'], mappedStatus?.state || 'unknown')).toLowerCase(),
      tokensIn: normalizeNumber(
        pickFirst(item, ['tokensIn', 'inputTokens', 'tokens_in', 'usageIn'], mappedStatus?.tokensIn || 0),
        0,
      ),
      tokensOut: normalizeNumber(
        pickFirst(item, ['tokensOut', 'outputTokens', 'tokens_out', 'usageOut'], mappedStatus?.tokensOut || 0),
        0,
      ),
      cost: normalizeNumber(
        pickFirst(item, ['cost', 'totalCost', 'estimatedCost', 'costUsd'], mappedStatus?.cost || 0),
        0,
      ),
      model: normalizeString(pickFirst(item, ['model', 'modelName'], mappedStatus?.model || '')),
      updatedAt: normalizeString(
        pickFirst(item, ['updatedAt', 'lastSeenAt', 'timestamp', 'createdAt'], raw.generatedAt || new Date().toISOString()),
      ),
    };
  });

  const tasks = tasksSource.map((item) => ({
    id: normalizeString(pickFirst(item, ['id', 'taskId', 'task_id', 'key'], 'unknown-task')),
    title: normalizeString(pickFirst(item, ['title', 'name', 'summary'], 'Untitled Task')),
    status: normalizeString(pickFirst(item, ['status', 'state'], 'unknown')).toLowerCase(),
    scope: normalizeString(pickFirst(item, ['scope', 'projectId', 'agentId'], 'global')),
    updatedAt: normalizeString(
      pickFirst(item, ['updatedAt', 'lastHeartbeatAt', 'createdAt', 'timestamp'], raw.generatedAt || new Date().toISOString()),
    ),
  }));

  const approvals = approvalsSource.map((item) => ({
    id: normalizeString(pickFirst(item, ['id', 'approvalId', 'requestId'], 'unknown-approval')),
    status: normalizeString(pickFirst(item, ['status', 'state'], 'pending')).toLowerCase(),
    summary: normalizeString(pickFirst(item, ['summary', 'title', 'reason'], 'Approval Request')),
    requestedAt: normalizeString(
      pickFirst(item, ['requestedAt', 'createdAt', 'timestamp'], raw.generatedAt || new Date().toISOString()),
    ),
  }));

  return {
    generatedAt: normalizeString(pickFirst(raw, ['generatedAt', 'updatedAt', 'timestamp'], new Date().toISOString())),
    sessions,
    tasks,
    approvals,
    statuses,
    budgetSummary: normalizeBudgetSummary(raw.budgetSummary),
  };
};

export const resolveTimestampFromLogEntry = (entry: unknown): string => {
  return normalizeString(
    pickFirst(entry, ['timestamp', 'session_timestamp', 'generatedAt', 'updatedAt', 'createdAt', 'at'], ''),
    '',
  );
};

export const resolveTokensFromLogEntry = (entry: unknown) => {
  const tokensIn = normalizeNumber(
    pickFirst(entry, ['input_tokens', 'tokensIn', 'inputTokens', 'tokens_in', 'usageIn'], 0),
    0,
  );
  const tokensOut = normalizeNumber(
    pickFirst(entry, ['output_tokens', 'tokensOut', 'outputTokens', 'tokens_out', 'usageOut'], 0),
    0,
  );
  return { tokensIn, tokensOut };
};

export const resolveCostFromLogEntry = (entry: unknown, tokensIn: number, tokensOut: number) => {
  const e = entry as { message?: { usage?: { cost?: { total?: unknown } } }; usage?: { cost?: { total?: unknown } }; cost?: { total?: unknown } };
  const usageCostFromMessage = normalizeNumber(e?.message?.usage?.cost?.total, NaN);
  const usageCost = normalizeNumber(e?.usage?.cost?.total, NaN);
  const costObjectTotal = normalizeNumber(e?.cost?.total, NaN);
  const directCost = normalizeNumber(
    pickFirst(e, ['estimatedCost', 'totalCost', 'usageCost', 'costUsd', 'usd_cost', 'cost'], NaN),
    NaN,
  );

  const candidates = [usageCostFromMessage, usageCost, costObjectTotal, directCost].filter(
    (value) => Number.isFinite(value) && value >= 0,
  ) as number[];

  if (candidates.length > 0) return candidates[0];
  return estimateUsageCost(tokensIn, tokensOut);
};

export const resolveCostFromSessionEntry = (session: unknown, tokensIn: number, tokensOut: number) => {
  const directCost = normalizeNumber(
    pickFirst(session, ['estimatedCost', 'totalCost', 'usageCost', 'costUsd', 'usd_cost', 'cost'], NaN),
    NaN,
  );
  if (Number.isFinite(directCost) && directCost >= 0) return directCost;
  return estimateUsageCost(tokensIn, tokensOut);
};

// ── Runtime Usage Event (JSONL Scanner) ───────────────────────────────────

export interface RuntimeUsageEvent {
  timestamp: string;
  day: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  tokensIn: number;
  tokensOut: number;
  cacheTokens: number;
  tokens: number;
  cost: number;
}

export const inferProviderFromModel = (model: string | undefined): string => {
  if (!model) return 'Unknown';
  const m = model.toLowerCase();
  if (m.includes('claude')) return 'Anthropic';
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'OpenAI';
  if (m.includes('gemini')) return 'Google';
  if (m.includes('llama') || m.includes('mistral') || m.includes('qwen') || m.includes('deepseek')) return 'OSS/Other';
  return 'Unknown';
};

export const parseSessionJsonlForUsage = (content: string, agentId: string): RuntimeUsageEvent[] => {
  const events: RuntimeUsageEvent[] = [];
  let currentSessionId = '';
  let currentModel = '';

  for (const line of content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    let entry: unknown;
    try { entry = JSON.parse(line) as unknown; } catch { continue; }

    const e = entry as { type?: string; id?: string; sessionId?: string; timestamp?: string; message?: { model?: string; role?: string; usage?: Record<string, unknown>; timestamp?: string; provider?: string } };
    if (e.type === 'session' && e.id) currentSessionId = String(e.id);
    if (e.sessionId) currentSessionId = String(e.sessionId);
    if (e.message?.model) currentModel = String(e.message.model);

    if (e.type === 'message' && e.message?.role === 'assistant' && e.message?.usage) {
      const usage = e.message.usage;

      const tokensIn = normalizeNumber(
        pickFirst(usage, ['input', 'inputTokens', 'input_tokens', 'prompt_tokens', 'promptTokens'], 0), 0);
      const tokensOut = normalizeNumber(
        pickFirst(usage, ['output', 'outputTokens', 'output_tokens', 'completion_tokens', 'completionTokens'], 0), 0);
      const cacheRead = normalizeNumber(
        pickFirst(usage, ['cacheRead', 'cache_read_input_tokens', 'cacheReadInputTokens'], 0), 0);
      const cacheWrite = normalizeNumber(
        pickFirst(usage, ['cacheWrite', 'cache_creation_input_tokens', 'cacheCreationInputTokens'], 0), 0);
      const cacheTokens = cacheRead + cacheWrite;
      const tokens = tokensIn + tokensOut + cacheTokens;

      if (tokens === 0) continue;

      const cost = normalizeNumber(
        (usage?.cost as Record<string, unknown>)?.total ?? usage?.cost ?? usage?.estimatedCost ?? usage?.totalCost ?? 0, 0);

      const timestamp = String(e.timestamp || e.message?.timestamp || '');
      const day = timestamp.length >= 10 ? timestamp.slice(0, 10) : new Date().toISOString().slice(0, 10);
      const model: string | undefined = e.message?.model || currentModel || undefined;
      // Prioritize message.provider (e.g., "minimax", "openai"), use fallback for inference only.
      const provider = typeof e.message?.provider === 'string' && e.message.provider
        ? e.message.provider
        : inferProviderFromModel(model);

      events.push({
        timestamp,
        day,
        sessionId: currentSessionId,
        agentId,
        model,
        provider,
        tokensIn,
        tokensOut,
        cacheTokens,
        tokens,
        cost,
      });
    }
  }
  return events;
};

export const buildReadModelHistoryFromJsonl = (content: string, days = 7) => {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const daily = new Map<
    string,
    {
      label: string;
      tokensIn: number;
      tokensOut: number;
      totalTokens: number;
      totalCost: number;
    }
  >();

  for (const line of lines) {
    let entry: unknown = null;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = resolveTimestampFromLogEntry(entry);
    if (!timestamp) continue;

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) continue;

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;
    const label = `${mm}-${dd}`;

    const { tokensIn, tokensOut } = resolveTokensFromLogEntry(entry);
    if (tokensIn === 0 && tokensOut === 0) continue;

    const cost = resolveCostFromLogEntry(entry, tokensIn, tokensOut);
    const current = daily.get(dateKey) || { label, tokensIn: 0, tokensOut: 0, totalTokens: 0, totalCost: 0 };
    current.tokensIn += tokensIn;
    current.tokensOut += tokensOut;
    current.totalTokens += tokensIn + tokensOut;
    current.totalCost += cost;
    daily.set(dateKey, current);
  }

  return Array.from(daily.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-Math.max(1, days))
    .map(([dateKey, value]) => ({
      dateKey,
      label: value.label,
      tokensIn: value.tokensIn,
      tokensOut: value.tokensOut,
      totalTokens: value.totalTokens,
      estimatedCost: value.totalCost,
    }));
};

export const fallbackHistoryFromSnapshot = (readModel: unknown, days = 7) => {
  const rm = readModel as Record<string, unknown>;
  const sessions = normalizeArray(rm?.sessions) as Record<string, unknown>[];
  const daily = new Map<string, { label: string; tokensIn: number; tokensOut: number; totalTokens: number; totalCost: number }>();

  for (const session of sessions) {
    const timestamp = normalizeString((session?.updatedAt || rm?.generatedAt) as unknown, '');
    if (!timestamp) continue;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) continue;

    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const dateKey = `${yyyy}-${mm}-${dd}`;
    const label = `${mm}-${dd}`;

    const tokensIn = normalizeNumber(session?.tokensIn, 0);
    const tokensOut = normalizeNumber(session?.tokensOut, 0);
    const cost = resolveCostFromSessionEntry(session, tokensIn, tokensOut);
    const current = daily.get(dateKey) || { label, tokensIn: 0, tokensOut: 0, totalTokens: 0, totalCost: 0 };
    current.tokensIn += tokensIn;
    current.tokensOut += tokensOut;
    current.totalTokens += tokensIn + tokensOut;
    current.totalCost += cost;
    daily.set(dateKey, current);
  }

  return Array.from(daily.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-Math.max(1, days))
    .map(([dateKey, value]) => ({
      dateKey,
      label: value.label,
      tokensIn: value.tokensIn,
      tokensOut: value.tokensOut,
      totalTokens: value.totalTokens,
      estimatedCost: value.totalCost,
    }));
};
