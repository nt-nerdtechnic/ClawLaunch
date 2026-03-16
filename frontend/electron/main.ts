import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const activeProcesses = new Set<any>();
const activeChatRequests = new Map<string, { sessionKey: string; runId?: string; agentId?: string; aborted: boolean }>();

const DEV_PORT_RANGE_START = 5173;
const DEV_PORT_RANGE_END = 5185;
const DEV_SERVER_WAIT_MS = 15000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;

interface LauncherConfig {
  corePath?: string;
  configPath?: string;
  gatewayPort?: string;
  autoRestartGateway?: boolean;
  restartInForegroundTerminal?: boolean;
}

interface GatewayStartOptions {
  autoRestart: boolean;
  restartInForegroundTerminal: boolean;
  maxRestarts: number;
  baseBackoffMs: number;
}

interface GatewayWatchdogState {
  child: any | null;
  command: string;
  stopRequested: boolean;
  restartAttempts: number;
  restartTimer: NodeJS.Timeout | null;
  options: GatewayStartOptions;
}

interface GatewayHttpWatchdogOptions {
  enabled: boolean;
  healthCheckCommand: string;
  restartCommand: string;
  intervalMs: number;
  failThreshold: number;
  maxRestarts: number;
}

interface GatewayHttpWatchdogState {
  timer: NodeJS.Timeout | null;
  checking: boolean;
  consecutiveFailures: number;
  restartAttempts: number;
  options: GatewayHttpWatchdogOptions;
}

const DEFAULT_GATEWAY_WATCHDOG_OPTIONS: GatewayStartOptions = {
  autoRestart: false,
  restartInForegroundTerminal: false,
  maxRestarts: 5,
  baseBackoffMs: 1000,
};

const DEFAULT_GATEWAY_HTTP_WATCHDOG_OPTIONS: GatewayHttpWatchdogOptions = {
  enabled: false,
  healthCheckCommand: '',
  restartCommand: '',
  intervalMs: 15000,
  failThreshold: 2,
  maxRestarts: 5,
};

const gatewayWatchdog: GatewayWatchdogState = {
  child: null,
  command: '',
  stopRequested: false,
  restartAttempts: 0,
  restartTimer: null,
  options: { ...DEFAULT_GATEWAY_WATCHDOG_OPTIONS },
};

const gatewayHttpWatchdog: GatewayHttpWatchdogState = {
  timer: null,
  checking: false,
  consecutiveFailures: 0,
  restartAttempts: 0,
  options: { ...DEFAULT_GATEWAY_HTTP_WATCHDOG_OPTIONS },
};
const shellSingleQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const escapeAppleScriptString = (value: string) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const emitShellStdout = (data: string, source: 'stdout' | 'stderr' = 'stdout') => {
  mainWindow?.webContents.send('shell:stdout', { data, source });
};

const buildTerminalLaunchScript = (command: string, title = 'OpenClaw Gateway Auto-Restart') => {
  const finalCmd = `clear; echo '🚀 ${title}...'; ${command}; printf "\\n程序結束。\\n按 Enter 鍵關閉視窗..."; read -r _`;
  const line1 = `tell application "Terminal" to do script "${escapeAppleScriptString(finalCmd)}"`;
  const line2 = 'tell application "Terminal" to activate';
  return `osascript -e ${shellSingleQuote(line1)} -e ${shellSingleQuote(line2)}`;
};

const clearGatewayRestartTimer = () => {
  if (gatewayWatchdog.restartTimer) {
    clearTimeout(gatewayWatchdog.restartTimer);
    gatewayWatchdog.restartTimer = null;
  }
};

const stopGatewayWatchdog = (reason = 'manual stop') => {
  gatewayWatchdog.stopRequested = true;
  clearGatewayRestartTimer();
  if (gatewayWatchdog.child && !gatewayWatchdog.child.killed) {
    try {
      gatewayWatchdog.child.kill('SIGTERM');
    } catch (_) {
      // ignore
    }
  }
  gatewayWatchdog.child = null;
  gatewayWatchdog.command = '';
  gatewayWatchdog.restartAttempts = 0;
  gatewayWatchdog.options = { ...DEFAULT_GATEWAY_WATCHDOG_OPTIONS };
  if (reason) {
    emitShellStdout(`[gateway-watchdog] stopped: ${reason}\n`, 'stdout');
  }
};

const clearGatewayHttpWatchdogTimer = () => {
  if (gatewayHttpWatchdog.timer) {
    clearInterval(gatewayHttpWatchdog.timer);
    gatewayHttpWatchdog.timer = null;
  }
};

const stopGatewayHttpWatchdog = (reason = 'manual stop') => {
  clearGatewayHttpWatchdogTimer();
  gatewayHttpWatchdog.checking = false;
  gatewayHttpWatchdog.consecutiveFailures = 0;
  gatewayHttpWatchdog.restartAttempts = 0;
  gatewayHttpWatchdog.options = { ...DEFAULT_GATEWAY_HTTP_WATCHDOG_OPTIONS };
  emitShellStdout(`[gateway-http-watchdog] stopped: ${reason}\n`, 'stdout');
};

const runGatewayHttpWatchdogCheck = async () => {
  if (gatewayHttpWatchdog.checking) return;
  if (!gatewayHttpWatchdog.options.enabled) return;
  const healthCheckCommand = String(gatewayHttpWatchdog.options.healthCheckCommand || '').trim();
  const restartCommand = String(gatewayHttpWatchdog.options.restartCommand || '').trim();
  if (!healthCheckCommand || !restartCommand) return;

  gatewayHttpWatchdog.checking = true;
  try {
    const healthRes = await runShellCommand(healthCheckCommand);
    const online = isGatewayOnlineFromStatus(healthRes);
    if (online) {
      gatewayHttpWatchdog.consecutiveFailures = 0;
      return;
    }

    gatewayHttpWatchdog.consecutiveFailures += 1;
    emitShellStdout(
      `[gateway-http-watchdog] health check failed (${gatewayHttpWatchdog.consecutiveFailures}/${gatewayHttpWatchdog.options.failThreshold})\n`,
      'stderr',
    );

    if (gatewayHttpWatchdog.consecutiveFailures < gatewayHttpWatchdog.options.failThreshold) {
      return;
    }

    gatewayHttpWatchdog.consecutiveFailures = 0;

    if (gatewayHttpWatchdog.restartAttempts >= gatewayHttpWatchdog.options.maxRestarts) {
      emitShellStdout(
        `[gateway-http-watchdog] max restart attempts reached (${gatewayHttpWatchdog.options.maxRestarts}), stop restarting\n`,
        'stderr',
      );
      return;
    }

    gatewayHttpWatchdog.restartAttempts += 1;
    emitShellStdout(
      `[gateway-http-watchdog] restart attempt ${gatewayHttpWatchdog.restartAttempts}/${gatewayHttpWatchdog.options.maxRestarts} via macOS Terminal\n`,
      'stdout',
    );

    const ok = await launchGatewayViaTerminal(restartCommand);
    if (ok) {
      emitShellStdout('[gateway-http-watchdog] restart command sent to Terminal\n', 'stdout');
    } else {
      emitShellStdout('[gateway-http-watchdog] failed to open Terminal for restart\n', 'stderr');
    }
  } catch (e: any) {
    emitShellStdout(`[gateway-http-watchdog] check error: ${String(e?.message || e)}\n`, 'stderr');
  } finally {
    gatewayHttpWatchdog.checking = false;
  }
};

const startGatewayHttpWatchdog = (options: Partial<GatewayHttpWatchdogOptions>) => {
  const nextOptions: GatewayHttpWatchdogOptions = {
    enabled: Boolean(options.enabled),
    healthCheckCommand: String(options.healthCheckCommand || '').trim(),
    restartCommand: String(options.restartCommand || '').trim(),
    intervalMs: Number.isFinite(Number(options.intervalMs)) ? Math.max(5000, Number(options.intervalMs)) : 15000,
    failThreshold: Number.isFinite(Number(options.failThreshold)) ? Math.max(1, Number(options.failThreshold)) : 2,
    maxRestarts: Number.isFinite(Number(options.maxRestarts)) ? Math.max(1, Number(options.maxRestarts)) : 5,
  };

  if (!nextOptions.enabled || !nextOptions.healthCheckCommand || !nextOptions.restartCommand) {
    stopGatewayHttpWatchdog('disabled or missing command');
    return;
  }

  clearGatewayHttpWatchdogTimer();
  gatewayHttpWatchdog.options = nextOptions;
  gatewayHttpWatchdog.consecutiveFailures = 0;
  gatewayHttpWatchdog.restartAttempts = 0;
  gatewayHttpWatchdog.checking = false;
  emitShellStdout(
    `[gateway-http-watchdog] started (interval=${nextOptions.intervalMs}ms, threshold=${nextOptions.failThreshold})\n`,
    'stdout',
  );

  gatewayHttpWatchdog.timer = setInterval(() => {
    void runGatewayHttpWatchdogCheck();
  }, nextOptions.intervalMs);

  void runGatewayHttpWatchdogCheck();
};

const launchGatewayViaTerminal = async (command: string) => {
  const osascriptCmd = buildTerminalLaunchScript(command);
  const res = await runShellCommand(osascriptCmd);
  return (res.code ?? 1) === 0;
};

const spawnWatchedGatewayProcess = (command: string) => {
  const child = spawn(command, { shell: true });
  gatewayWatchdog.child = child;
  activeProcesses.add(child);

  emitShellStdout(`[gateway-watchdog] process started (pid=${String(child.pid ?? 'unknown')})\n`, 'stdout');

  child.stdout.on('data', (data: any) => {
    emitShellStdout(data.toString(), 'stdout');
  });
  child.stderr.on('data', (data: any) => {
    emitShellStdout(data.toString(), 'stderr');
  });

  child.on('exit', async (code: number | null, signal: NodeJS.Signals | null) => {
    activeProcesses.delete(child);
    if (gatewayWatchdog.child === child) {
      gatewayWatchdog.child = null;
    }

    if (gatewayWatchdog.stopRequested) {
      return;
    }

    const failed = code !== 0 || signal !== null;
    if (!failed) {
      emitShellStdout('[gateway-watchdog] process exited cleanly, no restart required\n', 'stdout');
      return;
    }

    emitShellStdout(
      `[gateway-watchdog] process exited unexpectedly (code=${String(code)}, signal=${String(signal)})\n`,
      'stderr',
    );

    if (!gatewayWatchdog.options.autoRestart) {
      emitShellStdout('[gateway-watchdog] auto-restart is disabled\n', 'stderr');
      return;
    }

    if (gatewayWatchdog.restartAttempts >= gatewayWatchdog.options.maxRestarts) {
      emitShellStdout(
        `[gateway-watchdog] max restart attempts reached (${gatewayWatchdog.options.maxRestarts}), stop restarting\n`,
        'stderr',
      );
      return;
    }

    gatewayWatchdog.restartAttempts += 1;
    const delayMs = Math.min(
      gatewayWatchdog.options.baseBackoffMs * 2 ** (gatewayWatchdog.restartAttempts - 1),
      30000,
    );

    if (gatewayWatchdog.options.restartInForegroundTerminal) {
      emitShellStdout(
        `[gateway-watchdog] restart attempt ${gatewayWatchdog.restartAttempts}/${gatewayWatchdog.options.maxRestarts} via macOS Terminal\n`,
        'stdout',
      );
      const ok = await launchGatewayViaTerminal(gatewayWatchdog.command);
      if (ok) {
        emitShellStdout('[gateway-watchdog] handed over restart to foreground Terminal\n', 'stdout');
      } else {
        emitShellStdout('[gateway-watchdog] failed to launch foreground Terminal restart\n', 'stderr');
      }
      stopGatewayWatchdog('restart handed to foreground terminal');
      return;
    }

    emitShellStdout(
      `[gateway-watchdog] restart attempt ${gatewayWatchdog.restartAttempts}/${gatewayWatchdog.options.maxRestarts} in ${delayMs}ms\n`,
      'stdout',
    );

    clearGatewayRestartTimer();
    gatewayWatchdog.restartTimer = setTimeout(() => {
      if (gatewayWatchdog.stopRequested || !gatewayWatchdog.command) {
        return;
      }
      spawnWatchedGatewayProcess(gatewayWatchdog.command);
    }, delayMs);
  });

  return child;
};

interface OpenClawChatInvokeRequest {
  requestId: string;
  sessionKey: string;
  agentId: string;
  message: string;
  stream?: boolean;
  deliver?: boolean;
  forceLocal?: boolean;
}

const safeJsonParse = (value: string, fallback: any = null) => {
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
};

const normalizeConfigDir = (rawPath?: string) => {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/[\\/]openclaw\.json$/i, '');
};

const normalizeArray = (value: any): any[] => (Array.isArray(value) ? value : []);

const normalizeString = (value: any, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const normalizeNumber = (value: any, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const pickFirst = (input: any, keys: string[], fallback: any = '') => {
  if (!input || typeof input !== 'object') return fallback;
  for (const key of keys) {
    const value = (input as any)[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return fallback;
};

const normalizeBudgetSummary = (budgetSummary: any) => {
  const raw = budgetSummary && typeof budgetSummary === 'object' ? budgetSummary : {};
  const evaluations = normalizeArray(raw.evaluations).map((item: any) => ({
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

const normalizeReadModelSnapshot = (snapshot: any) => {
  const raw = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const sessionsRaw = normalizeArray(raw.sessions);
  const statusesRaw = normalizeArray(raw.statuses);
  const tasksSource = Array.isArray(raw.tasks) ? raw.tasks : normalizeArray(raw.tasks?.tasks);
  const approvalsSource = Array.isArray(raw.approvals) ? raw.approvals : normalizeArray(raw.approvals?.items);

  const statuses = statusesRaw.map((item: any) => ({
    sessionKey: normalizeString(pickFirst(item, ['sessionKey', 'session_id', 'session'], 'unknown')),
    state: normalizeString(pickFirst(item, ['state', 'status'], 'unknown')).toLowerCase(),
    tokensIn: normalizeNumber(pickFirst(item, ['tokensIn', 'inputTokens', 'tokens_in'], 0), 0),
    tokensOut: normalizeNumber(pickFirst(item, ['tokensOut', 'outputTokens', 'tokens_out'], 0), 0),
    cost: normalizeNumber(pickFirst(item, ['cost', 'totalCost', 'estimatedCost', 'costUsd'], 0), 0),
    model: normalizeString(pickFirst(item, ['model', 'modelName'], '')),
    contextWindowTokens: normalizeNumber(pickFirst(item, ['contextWindowTokens', 'contextTokens', 'context_limit_tokens'], 0), 0),
  }));

  const statusMap = new Map<string, any>();
  for (const status of statuses) {
    if (status.sessionKey) statusMap.set(status.sessionKey, status);
  }

  const sessions = sessionsRaw.map((item: any) => {
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

  const tasks = tasksSource.map((item: any) => ({
    id: normalizeString(pickFirst(item, ['id', 'taskId', 'task_id', 'key'], 'unknown-task')),
    title: normalizeString(pickFirst(item, ['title', 'name', 'summary'], 'Untitled Task')),
    status: normalizeString(pickFirst(item, ['status', 'state'], 'unknown')).toLowerCase(),
    scope: normalizeString(pickFirst(item, ['scope', 'projectId', 'agentId'], 'global')),
    updatedAt: normalizeString(
      pickFirst(item, ['updatedAt', 'lastHeartbeatAt', 'createdAt', 'timestamp'], raw.generatedAt || new Date().toISOString()),
    ),
  }));

  const approvals = approvalsSource.map((item: any) => ({
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

const resolveTimestampFromLogEntry = (entry: any): string => {
  return normalizeString(
    pickFirst(entry, ['timestamp', 'session_timestamp', 'generatedAt', 'updatedAt', 'createdAt', 'at'], ''),
    '',
  );
};

const resolveTokensFromLogEntry = (entry: any) => {
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

const estimateUsageCost = (tokensIn: number, tokensOut: number) => ((tokensIn + tokensOut * 2) / 1_000_000) * 0.5;

const resolveCostFromLogEntry = (entry: any, tokensIn: number, tokensOut: number) => {
  const usageCostFromMessage = normalizeNumber(entry?.message?.usage?.cost?.total, NaN);
  const usageCost = normalizeNumber(entry?.usage?.cost?.total, NaN);
  const costObjectTotal = normalizeNumber(entry?.cost?.total, NaN);
  const directCost = normalizeNumber(
    pickFirst(entry, ['estimatedCost', 'totalCost', 'usageCost', 'costUsd', 'usd_cost', 'cost'], NaN),
    NaN,
  );

  const candidates = [usageCostFromMessage, usageCost, costObjectTotal, directCost].filter(
    (value) => Number.isFinite(value) && value >= 0,
  ) as number[];

  if (candidates.length > 0) return candidates[0];
  return estimateUsageCost(tokensIn, tokensOut);
};

const resolveCostFromSessionEntry = (session: any, tokensIn: number, tokensOut: number) => {
  const directCost = normalizeNumber(
    pickFirst(session, ['estimatedCost', 'totalCost', 'usageCost', 'costUsd', 'usd_cost', 'cost'], NaN),
    NaN,
  );
  if (Number.isFinite(directCost) && directCost >= 0) return directCost;
  return estimateUsageCost(tokensIn, tokensOut);
};

const buildReadModelHistoryFromJsonl = (content: string, days = 7) => {
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
    let entry: any = null;
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

const fallbackHistoryFromSnapshot = (readModel: any, days = 7) => {
  const sessions = normalizeArray(readModel?.sessions);
  const daily = new Map<string, { label: string; tokensIn: number; tokensOut: number; totalTokens: number; totalCost: number }>();

  for (const session of sessions) {
    const timestamp = normalizeString(session?.updatedAt || readModel?.generatedAt, '');
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

type GovernanceEventLevel = 'info' | 'warn' | 'action-required';

type GovernanceEvent = {
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

type AuditTimelineEntry = {
  id: string;
  level: GovernanceEventLevel;
  source: string;
  message: string;
  timestamp: string;
};

type EventAckRecord = {
  ackedAt: string;
  expiresAt: string;
};

const computeTaskGovernance = (readModel: any, timeoutMs: number, nowIso: string) => {
  const tasks = normalizeArray(readModel?.tasks);
  const now = new Date(nowIso).getTime();
  const normalizedTasks = tasks.map((task: any) => ({ ...task }));
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
      detail: `${normalizeString(task?.title, 'Task')} 超時未更新，已標記為 blocked。`,
      source: 'task-heartbeat',
      createdAt: nowIso,
      entityId: normalizeString(task?.id, ''),
    });
  }

  return { tasks: normalizedTasks, events };
};

const buildGovernanceEvents = (readModel: any, nowIso: string): GovernanceEvent[] => {
  const events: GovernanceEvent[] = [];
  const approvals = normalizeArray(readModel?.approvals);
  const statuses = normalizeArray(readModel?.statuses);
  const budgetEvaluations = normalizeArray(readModel?.budgetSummary?.evaluations);

  const pendingApprovals = approvals.filter((item: any) => {
    const status = normalizeString(item?.status, '').toLowerCase();
    return status === '' || status === 'pending' || status === 'requested';
  });

  if (pendingApprovals.length > 0) {
    events.push({
      id: 'approval-pending',
      level: 'action-required',
      title: 'Pending approvals',
      detail: `目前有 ${pendingApprovals.length} 筆待審批。`,
      source: 'approval',
      createdAt: nowIso,
    });
  }

  const blockedCount = statuses.filter((s: any) => normalizeString(s?.state, '').toLowerCase() === 'blocked').length;
  const errorCount = statuses.filter((s: any) => normalizeString(s?.state, '').toLowerCase() === 'error').length;
  if (blockedCount > 0 || errorCount > 0) {
    events.push({
      id: 'runtime-risk',
      level: 'action-required',
      title: 'Runtime risk detected',
      detail: `Blocked ${blockedCount} / Error ${errorCount}。`,
      source: 'runtime',
      createdAt: nowIso,
    });
  }

  const overBudget = budgetEvaluations.filter((b: any) => normalizeString(b?.status, '').toLowerCase() === 'over').length;
  const warnBudget = budgetEvaluations.filter((b: any) => normalizeString(b?.status, '').toLowerCase() === 'warn').length;
  if (overBudget > 0 || warnBudget > 0) {
    events.push({
      id: 'budget-risk',
      level: overBudget > 0 ? 'action-required' : 'warn',
      title: 'Budget risk',
      detail: `Over ${overBudget} / Warn ${warnBudget}。`,
      source: 'budget',
      createdAt: nowIso,
    });
  }

  if (events.length === 0) {
    events.push({
      id: 'system-all-clear',
      level: 'info',
      title: 'All clear',
      detail: '目前未檢測到高優先風險事件。',
      source: 'system',
      createdAt: nowIso,
    });
  }

  return events;
};

const resolveRuntimeDirFromCandidates = async (candidatePaths: string[]) => {
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

const loadEventAcks = async (runtimeDir: string): Promise<Record<string, EventAckRecord>> => {
  if (!runtimeDir) return {};
  const ackPath = path.join(runtimeDir, 'event-acks.json');
  try {
    const raw = await fs.readFile(ackPath, 'utf-8');
    const parsed = safeJsonParse(raw, {});
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
};

const saveEventAcks = async (runtimeDir: string, acks: Record<string, EventAckRecord>) => {
  if (!runtimeDir) return;
  await fs.mkdir(runtimeDir, { recursive: true });
  const ackPath = path.join(runtimeDir, 'event-acks.json');
  await fs.writeFile(ackPath, `${JSON.stringify(acks, null, 2)}\n`, 'utf-8');
};

const applyAckStateToEvents = (events: GovernanceEvent[], acks: Record<string, EventAckRecord>, nowIso: string) => {
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

const parseAuditLine = (line: string, source: string): AuditTimelineEntry | null => {
  const trimmed = normalizeString(line, '');
  if (!trimmed) return null;
  let parsed: any = null;
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

const buildAuditTimeline = async (runtimeDir: string, governanceEvents: GovernanceEvent[]) => {
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

const buildDailyDigestMarkdown = (timeline: AuditTimelineEntry[]) => {
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

const buildGatewayUrlArg = (gatewayPort?: string) => {
  const raw = String(gatewayPort || '').trim();
  if (!raw || !/^\d+$/.test(raw)) return '';

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return '';

  return ` --url ${shellQuote(`ws://127.0.0.1:${port}`)}`;
};

const readEnvOverride = (...keys: string[]) => {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
};

const resolveGatewayCredentials = (config: any) => {
  const configToken = String(config?.gateway?.auth?.token || '').trim();
  const configPassword = String(config?.gateway?.auth?.password || '').trim();
  const token = readEnvOverride('OPENCLAW_GATEWAY_TOKEN', 'CLAWDBOT_GATEWAY_TOKEN') || configToken;
  const password = readEnvOverride('OPENCLAW_GATEWAY_PASSWORD') || configPassword;

  return {
    token,
    password: token ? '' : password,
  };
};

const buildGatewayAuthArg = (credentials: { token?: string; password?: string }) => {
  if (credentials.token) {
    return ` --token ${shellQuote(credentials.token)}`;
  }
  if (credentials.password) {
    return ` --password ${shellQuote(credentials.password)}`;
  }
  return '';
};

const runShellCommand = (command: string) => new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
  const child = spawn(command, { shell: true });
  activeProcesses.add(child);
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (data: any) => {
    stdout += data.toString();
  });
  child.stderr.on('data', (data: any) => {
    stderr += data.toString();
  });

  child.on('close', (code: number) => {
    activeProcesses.delete(child);
    resolve({ code: code ?? 1, stdout, stderr });
  });
});

const isGatewayOnlineFromStatus = (statusRes: { code: number; stdout: string; stderr: string }) => {
  if ((statusRes.code ?? 1) !== 0) return false;

  const raw = `${statusRes.stdout || ''}\n${statusRes.stderr || ''}`.toLowerCase();
  if (raw.includes('"online": true') || raw.includes('"online":true') || raw.includes('online') || raw.includes('running')) {
    return true;
  }

  const parsed = safeJsonParse(statusRes.stdout || '', null);
  if (parsed && typeof parsed === 'object') {
    if (parsed.online === true) return true;
    if (parsed.gateway?.online === true) return true;
    if (parsed.probe?.online === true || parsed.probe?.ok === true) return true;
    if (typeof parsed.status === 'string' && /online|running/i.test(parsed.status)) return true;
  }

  return false;
};

const tryParseJsonObject = (value: string) => {
  const parsed = safeJsonParse(value, null);
  if (parsed && typeof parsed === 'object') return parsed;
  return null;
};

const parseGatewayCallStdoutJson = (rawStdout: string) => {
  const stdout = String(rawStdout || '').trim();
  if (!stdout) return null;

  const fullParsed = tryParseJsonObject(stdout);
  if (fullParsed) return fullParsed;

  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsedLine = tryParseJsonObject(lines[i]);
    if (parsedLine) return parsedLine;
  }

  const firstBrace = stdout.indexOf('{');
  const lastBrace = stdout.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliceParsed = tryParseJsonObject(stdout.slice(firstBrace, lastBrace + 1));
    if (sliceParsed) return sliceParsed;
  }

  return null;
};

const pickTextFromUnknownContent = (content: any): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        if (typeof item.text === 'string') return item.text;
        if (typeof item.value === 'string') return item.value;
        if (typeof item.content === 'string') return item.content;
        return '';
      })
      .join('');
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.value === 'string') return content.value;
    if (typeof content.content === 'string') return content.content;
  }
  return '';
};

const extractMessageText = (message: any): string => {
  if (!message || typeof message !== 'object') return '';

  const direct = pickTextFromUnknownContent(message.content);
  if (direct) return direct;

  if (typeof message.text === 'string') return message.text;
  if (typeof message.message === 'string') return message.message;
  if (typeof message.output_text === 'string') return message.output_text;

  return '';
};

const isAssistantMessage = (message: any): boolean => {
  if (!message || typeof message !== 'object') return false;
  const role = String(message.role || message.type || message.author?.role || '').toLowerCase();
  return role === 'assistant';
};

const extractLatestAssistantTextFromHistoryPayload = (payload: any): string => {
  const history = payload?.result ?? payload;
  const candidates: any[] = [
    history?.messages,
    history?.items,
    history?.history,
    history?.data?.messages,
    history?.data?.items,
    history?.output,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (let i = candidate.length - 1; i >= 0; i--) {
      const msg = candidate[i];
      if (!isAssistantMessage(msg)) continue;
      const text = extractMessageText(msg);
      if (text) return text;
    }
  }

  return '';
};

const extractRunIdFromSendPayload = (payload: any): string => {
  const result = payload?.result ?? payload;
  const maybeRunId = result?.runId || result?.run_id || result?.id || '';
  return typeof maybeRunId === 'string' ? maybeRunId : '';
};

const computeDeltaText = (previous: string, current: string): string => {
  if (!current) return '';
  if (!previous) return current;
  if (current.startsWith(previous)) {
    return current.slice(previous.length);
  }

  const maxPrefix = Math.min(previous.length, current.length);
  let sameCount = 0;
  while (sameCount < maxPrefix && previous[sameCount] === current[sameCount]) {
    sameCount++;
  }
  return current.slice(sameCount);
};

const fetchLatestAssistantText = async (runtimePrefix: string, gatewayUrlArg: string, gatewayAuthArg: string, sessionKey: string, agentId?: string) => {
  const historyParams: Record<string, any> = { sessionKey };
  if (agentId) historyParams.agentId = agentId;

  const historyCommand = `${runtimePrefix} gateway call chat.history${gatewayUrlArg}${gatewayAuthArg} --params ${shellQuote(JSON.stringify(historyParams))}`;
  const historyRes = await runShellCommand(historyCommand);
  if (historyRes.code !== 0) {
    return { ok: false as const, text: '', error: historyRes.stderr || 'chat.history failed' };
  }

  const parsed = parseGatewayCallStdoutJson(historyRes.stdout);
  if (!parsed) {
    return { ok: false as const, text: '', error: 'chat.history returned non-JSON output' };
  }

  return { ok: true as const, text: extractLatestAssistantTextFromHistoryPayload(parsed), error: '' };
};

const waitForAssistantFinalByHistory = async ({
  request,
  runtimePrefix,
  gatewayUrlArg,
  gatewayAuthArg,
  baseline,
  emitChunk,
}: {
  request: OpenClawChatInvokeRequest;
  runtimePrefix: string;
  gatewayUrlArg: string;
  gatewayAuthArg: string;
  baseline: string;
  emitChunk: (payload: { delta?: string; done?: boolean; error?: string; mode: 'gateway' | 'local'; reason: string }) => void;
}) => {
  const pollIntervalMs = 550;
  const stableWindowMs = 1500;
  const timeoutMs = 65000;
  const startAt = Date.now();
  let lastObserved = baseline;
  let lastChangeAt = Date.now();

  while (Date.now() - startAt < timeoutMs) {
    const chatState = activeChatRequests.get(request.requestId);
    if (!chatState) {
      emitChunk({ done: true, mode: 'gateway', reason: '' });
      return;
    }

    if (chatState.aborted) {
      emitChunk({ done: true, mode: 'gateway', reason: '' });
      return;
    }

    const historyRes = await fetchLatestAssistantText(runtimePrefix, gatewayUrlArg, gatewayAuthArg, request.sessionKey, request.agentId);
    if (!historyRes.ok) {
      emitChunk({
        error: historyRes.error,
        done: true,
        mode: 'gateway',
        reason: '',
      });
      return;
    }

    if (historyRes.text !== lastObserved) {
      const delta = computeDeltaText(lastObserved, historyRes.text);
      lastObserved = historyRes.text;
      lastChangeAt = Date.now();
      if (delta) {
        emitChunk({ delta, mode: 'gateway', reason: '' });
      }
    }

    if (Date.now() - lastChangeAt >= stableWindowMs) {
      emitChunk({ done: true, mode: 'gateway', reason: '' });
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(pollIntervalMs);
  }

  emitChunk({ done: true, mode: 'gateway', reason: '' });
};

async function resolveOpenClawRuntime() {
  const launcherConfigPath = path.join(app.getPath('userData'), 'config.json');
  let launcherConfig: LauncherConfig = {};
  try {
    const raw = await fs.readFile(launcherConfigPath, 'utf-8');
    launcherConfig = safeJsonParse(raw, {}) || {};
  } catch (_) {
    launcherConfig = {};
  }

  const corePath = String(launcherConfig.corePath || '').trim();
  const configDir = normalizeConfigDir(launcherConfig.configPath);
  const configFilePath = configDir ? path.join(configDir, 'openclaw.json') : '';
  let openclawConfig: any = {};
  if (configFilePath) {
    try {
      const raw = await fs.readFile(configFilePath, 'utf-8');
      openclawConfig = safeJsonParse(raw, {}) || {};
    } catch (_) {
      openclawConfig = {};
    }
  }

  const gatewayCredentials = resolveGatewayCredentials(openclawConfig);
  const gatewayUrlArg = buildGatewayUrlArg(launcherConfig.gatewayPort);
  const gatewayAuthArg = buildGatewayAuthArg(gatewayCredentials);
  const envPrefix = `${configDir ? `OPENCLAW_STATE_DIR=${shellQuote(configDir)} ` : ''}${configFilePath ? `OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} ` : ''}`;
  const cdPrefix = corePath ? `cd ${shellQuote(corePath)} && ` : '';
  return {
    corePath,
    configDir,
    configFilePath,
    gatewayUrlArg,
    gatewayAuthArg,
    openclawPrefix: `${cdPrefix}${envPrefix}pnpm openclaw`,
  };
}

function validateVersionRef(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) {
    throw new Error('Invalid version: empty');
  }
  if (value.length > 128) {
    throw new Error('Invalid version: too long');
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
    throw new Error(`Invalid version format: ${value}`);
  }
  return value;
}

function isDevServerReachable(url: string, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500));
    });

    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function resolveDevServerUrl(): Promise<string> {
  const envUrl = process.env.VITE_DEV_SERVER_URL;
  if (envUrl && await isDevServerReachable(envUrl)) {
    return envUrl;
  }

  const deadline = Date.now() + DEV_SERVER_WAIT_MS;
  while (Date.now() < deadline) {
    for (let port = DEV_PORT_RANGE_START; port <= DEV_PORT_RANGE_END; port++) {
      const candidate = `http://localhost:${port}`;
      // eslint-disable-next-line no-await-in-loop
      if (await isDevServerReachable(candidate)) {
        return candidate;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }

  // Fallback for clearer diagnostics in renderer load failure.
  return 'http://localhost:5173';
}

function killAllSubprocesses() {
  stopGatewayWatchdog('kill-all-subprocesses');
  stopGatewayHttpWatchdog('kill-all-subprocesses');
  for (const proc of activeProcesses) {
    try {
      if (!proc.killed) {
        proc.kill('SIGTERM');
        // 強制殺死如果 SIGTERM 沒用
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 2000);
      }
    } catch (e) {
      console.error('Failed to kill subprocess:', e);
    }
  }
  activeProcesses.clear();
}

async function createWindow() {
  const iconPath = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '../public/icon.png')
    : path.join(__dirname, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 320,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#020617',
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.platform === 'darwin') {
    app.dock?.setIcon(iconPath);
  }

  if (process.env.NODE_ENV === 'development') {
    const devServerUrl = await resolveDevServerUrl();
    console.log(`[dev] Loading renderer from ${devServerUrl}`);
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
}

/**
 * 深度解析 OpenClaw 配置檔
 * 支援從 agents.defaults.model.primary 提取模型，並從 auth.profiles 提取金鑰
 */
function parseOpenClawConfig(content: string) {
    try {
        const parsed = JSON.parse(content);
        let apiKey = parsed.apiKey || parsed.api_key || '';
        let model = parsed.model || '';
        let workspace = '';
        let botToken = '';
        let corePath = '';
        let authChoice = parsed.authChoice || '';

        // 0. 提取 Core Path (如果有的話)
        if (parsed.corePath) corePath = parsed.corePath;

        // 1. 提取模型 (OpenClaw 標準路徑)
        if (!model && parsed.agents?.defaults?.model?.primary) {
            model = parsed.agents.defaults.model.primary;
        }

        // 2. 提取 Workspace (OpenClaw 標準路徑)
        if (parsed.agents?.defaults?.workspace) {
            workspace = parsed.agents.defaults.workspace;
        }

        // 3. 提取 Bot Token (OpenClaw 標準路徑)
        if (parsed.channels?.telegram?.botToken) {
            botToken = parsed.channels.telegram.botToken;
        }

        // 4. 提取 API Key (遍歷 profiles) 並推斷 authChoice
        if (!apiKey && parsed.auth?.profiles) {
            for (const key in parsed.auth.profiles) {
                const profile = parsed.auth.profiles[key];
                const possibleKey = profile.apiKey || profile.api_key || profile.token || profile.bearer;
                if (possibleKey && typeof possibleKey === 'string' && possibleKey.length > 5) {
                    apiKey = possibleKey;
                    // 如果沒有明確定義 authChoice，嘗試根據 profile 名稱推斷
                    if (!authChoice) {
                        const lowKey = key.toLowerCase();
                        if (lowKey.includes('anthropic')) authChoice = 'apiKey';
                        else if (lowKey.includes('openai')) authChoice = 'openai-api-key';
                        else if (lowKey.includes('gemini')) authChoice = 'gemini-api-key';
                        else if (lowKey.includes('minimax')) authChoice = 'minimax-api';
                        else if (lowKey.includes('deepseek') || lowKey.includes('ollama')) authChoice = 'ollama';
                    }
                    break;
                }
            }
        }

        // 5. 二次推斷：如果還是沒有 authChoice，根據模型名稱推斷
        if (!authChoice && model) {
            const lowModel = model.toLowerCase();
            if (lowModel.includes('claude')) authChoice = 'apiKey';
            else if (lowModel.includes('gpt')) authChoice = 'openai-api-key';
            else if (lowModel.includes('gemini')) authChoice = 'gemini-api-key';
            else if (lowModel.includes('minimax')) authChoice = 'minimax-api';
            else if (lowModel.includes('ollama')) authChoice = 'ollama';
            else if (lowModel.includes('deepseek')) authChoice = 'ollama';
        }
        
        // 最終保底
        if (!authChoice && apiKey) authChoice = 'apiKey';

        // 6. 提取所有已授權的 providers
        const providers: string[] = [];
        if (parsed.auth?.profiles) {
            for (const key in parsed.auth.profiles) {
                const profile = parsed.auth.profiles[key];
                const provider = profile.provider || key.split(':')[0];
                if (provider && !providers.includes(provider)) {
                    providers.push(provider);
                }
            }
        }

        return { apiKey, model, workspace, botToken, corePath, authChoice, providers };
    } catch (e) {
        return { apiKey: '', model: '', workspace: '', botToken: '', corePath: '', authChoice: '', providers: [] as string[] };
    }
}

const AUTH_CHOICE_FLAG_MAPPING: Record<string, string> = {
  apiKey: '--anthropic-api-key',
  'openai-api-key': '--openai-api-key',
  'gemini-api-key': '--gemini-api-key',
  'minimax-api': '--minimax-api-key',
  'moonshot-api-key': '--moonshot-api-key',
  'openrouter-api-key': '--openrouter-api-key',
  'xai-api-key': '--xai-api-key',
};

const AUTH_CHOICE_PROVIDER_ALIASES: Record<string, string[]> = {
  apiKey: ['anthropic'],
  token: ['anthropic'],
  'openai-api-key': ['openai'],
  'openai-codex': ['openai-codex', 'openai'],
  'gemini-api-key': ['gemini', 'google'],
  'google-gemini-cli': ['google-gemini-cli', 'google-gemini', 'gemini', 'google'],
  'minimax-api': ['minimax'],
  'minimax-portal': ['minimax-portal', 'minimax'],
  'moonshot-api-key': ['moonshot'],
  'openrouter-api-key': ['openrouter'],
  'xai-api-key': ['xai'],
  ollama: ['ollama'],
  vllm: ['vllm'],
  chutes: ['chutes'],
  'qwen-portal': ['qwen-portal', 'qwen'],
};

const SUPPORTED_AUTH_CHOICES = new Set(Object.keys(AUTH_CHOICE_PROVIDER_ALIASES));
const CREDENTIALLESS_AUTH_CHOICES = new Set(['ollama', 'vllm']);
const OAUTH_AUTH_CHOICES = new Set(['openai-codex', 'google-gemini-cli', 'chutes', 'qwen-portal', 'minimax-portal']);

const sanitizeSecret = (value: string) => String(value || '').replace(/\s+/g, '');

const normalizeConfigDirectory = (rawPath: string) => String(rawPath || '').trim().replace(/[\\/]openclaw\.json$/i, '');

const getProfileProviderAliases = (profileId: string, profile: any) => {
  const provider = String(profile?.provider || '').toLowerCase();
  const id = String(profileId || '').toLowerCase();
  const aliases = new Set<string>();
  if (provider) aliases.add(provider);
  if (id) aliases.add(id.split(':')[0]);
  return Array.from(aliases).filter(Boolean);
};

const getChoiceAliases = (authChoice: string) => AUTH_CHOICE_PROVIDER_ALIASES[String(authChoice || '').trim()] || [String(authChoice || '').trim()];

const providerAliasSets: Record<string, string[]> = {
  google: ['google', 'gemini'],
  gemini: ['gemini', 'google'],
  anthropic: ['anthropic'],
  openai: ['openai', 'openai-codex'],
  'openai-codex': ['openai-codex', 'openai'],
  minimax: ['minimax'],
  moonshot: ['moonshot'],
  openrouter: ['openrouter'],
  xai: ['xai'],
  ollama: ['ollama'],
  vllm: ['vllm'],
  chutes: ['chutes'],
  qwen: ['qwen', 'qwen-portal'],
  'qwen-portal': ['qwen-portal', 'qwen'],
};

const providerMatchesAny = (provider: string, filters: string[]) => {
  const normalizedProvider = String(provider || '').toLowerCase();
  if (!normalizedProvider) return false;
  if (!filters.length) return true;

  return filters.some((rawFilter) => {
    const filter = String(rawFilter || '').toLowerCase();
    if (!filter) return false;
    if (normalizedProvider === filter) return true;
    const providerAliases = providerAliasSets[normalizedProvider] || [normalizedProvider];
    const filterAliases = providerAliasSets[filter] || [filter];
    return providerAliases.some((alias) => filterAliases.includes(alias));
  });
};

const profileMatchesAliases = (profileId: string, profile: any, aliases: string[]) => {
  const provider = String(profile?.provider || '').toLowerCase();
  const id = String(profileId || '').toLowerCase();
  return aliases.some((alias) => {
    const normalizedAlias = String(alias || '').toLowerCase();
    return normalizedAlias && (provider === normalizedAlias || id.includes(normalizedAlias));
  });
};

const hasCredential = (profile: any) => {
  const token = String(profile?.token || '').trim();
  const key = String(profile?.key || profile?.apiKey || profile?.api_key || '').trim();
  const access = String(profile?.access || '').trim();
  if (token) return !/\s/.test(token);
  if (key) return !/\s/.test(key);
  if (access) return true;
  return false;
};

async function loadJsonFile(filePath: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveJsonFile(filePath: string, data: any): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

async function getAgentAuthProfilePaths(configDir: string): Promise<string[]> {
  const agentsRoot = path.join(configDir, 'agents');
  let entries: any[] = [];
  try {
    entries = await fs.readdir(agentsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(agentsRoot, entry.name, 'agent', 'auth-profiles.json');
    try {
      await fs.access(candidate);
      results.push(candidate);
    } catch {
      // Ignore missing auth profiles for this agent.
    }
  }
  return results;
}

async function collectAuthProfiles(configDir: string) {
  const configFilePath = path.join(configDir, 'openclaw.json');
  const configJson = (await loadJsonFile(configFilePath)) || {};
  const globalProfiles = configJson?.auth?.profiles || {};
  const agentFiles = await getAgentAuthProfilePaths(configDir);

  const merged = new Map<string, any>();

  for (const [profileId, profile] of Object.entries(globalProfiles)) {
    merged.set(String(profileId), {
      profileId: String(profileId),
      provider: String((profile as any)?.provider || String(profileId).split(':')[0] || ''),
      mode: String((profile as any)?.mode || (profile as any)?.type || ''),
      globalPresent: true,
      agentPresent: false,
      agentCount: 0,
      credentialHealthy: false,
      diagnostics: [],
    });
  }

  for (const authPath of agentFiles) {
    const parsed = (await loadJsonFile(authPath)) || {};
    const profiles = parsed?.profiles || {};
    for (const [profileId, profile] of Object.entries(profiles)) {
      const profileKey = String(profileId);
      const entry = merged.get(profileKey) || {
        profileId: profileKey,
        provider: String((profile as any)?.provider || profileKey.split(':')[0] || ''),
        mode: String((profile as any)?.mode || (profile as any)?.type || ''),
        globalPresent: false,
        agentPresent: false,
        agentCount: 0,
        credentialHealthy: false,
        diagnostics: [],
      };
      entry.agentPresent = true;
      entry.agentCount += 1;
      entry.credentialHealthy = hasCredential(profile);
      if (!entry.credentialHealthy) {
        entry.diagnostics.push('agent_credential_missing_or_invalid');
      }
      if (!entry.mode) {
        entry.mode = String((profile as any)?.mode || (profile as any)?.type || '');
      }
      if (!entry.provider) {
        entry.provider = String((profile as any)?.provider || profileKey.split(':')[0] || '');
      }
      merged.set(profileKey, entry);
    }
  }

  const profiles = Array.from(merged.values()).map((entry) => {
    if (entry.globalPresent && !entry.agentPresent) {
      entry.diagnostics.push('global_only');
    }
    if (!entry.globalPresent && entry.agentPresent) {
      entry.diagnostics.push('agent_only');
    }

    const severity = entry.diagnostics.includes('agent_credential_missing_or_invalid')
      ? 'critical'
      : entry.diagnostics.length > 0
        ? 'warn'
        : 'ok';

    const repairGuides: string[] = [];
    if (entry.diagnostics.includes('agent_credential_missing_or_invalid')) {
      repairGuides.push('重新執行授權流程，確保 agent/auth-profiles.json 有有效 token。');
    }
    if (entry.diagnostics.includes('global_only')) {
      repairGuides.push('目前只有 global profile，請執行一次 onboarding/auth set 同步 agent 層。');
    }
    if (entry.diagnostics.includes('agent_only')) {
      repairGuides.push('目前只有 agent profile，請補齊 openclaw.json 的 auth.profiles。');
    }

    entry.severity = severity;
    entry.repairGuides = repairGuides;
    return entry;
  });

  const summary = {
    total: profiles.length,
    healthy: profiles.filter((item: any) => item.severity === 'ok').length,
    warn: profiles.filter((item: any) => item.severity === 'warn').length,
    critical: profiles.filter((item: any) => item.severity === 'critical').length,
  };

  return { configFilePath, configJson, agentFiles, profiles, summary };
}

// 系統級核心技能 (不可異動)
const CORE_SKILLS = [
  { id: 'aesthetic-expert', name: 'Aesthetic Expert', desc: '高端視覺設計與 CSS 專家，專精於精品品牌美學', category: 'Core', details: '提供排版與現代 UI 技術指導。' },
  { id: 'browser-navigator', name: 'Browser Navigator', desc: '瀏覽器自動化與測試專家', category: 'Core', details: '執行 E2E 流程與網頁操作。' },
  { id: 'bug-buster', name: 'Bug Buster', desc: '智能除錯助手', category: 'Core', details: '分析錯誤日誌並提供修復方案。' },
  { id: 'clean-code-architect', name: 'Clean Code Architect', desc: '專案結構設計指導', category: 'Core', details: '確保代碼保持高內聚、低耦合，符合 Clean Architecture。' },
  { id: 'code-review-expert', name: 'Code Review Expert', desc: '專業代碼審查', category: 'Core', details: '寫完程式碼後執行審查，確保符合安全、效能規範。' },
  { id: 'code-translator', name: 'Code Translator', desc: '代碼翻譯與命名規範化工具', category: 'Core', details: '支援中英互轉與變數命名建議。' },
  { id: 'data-analyst', name: 'Data Analyst', desc: 'Excel 與 CSV 數據處理技能', category: 'Core', details: '包含讀取、寫入、清洗與分析。' },
  { id: 'doc-generator', name: 'Doc Generator', desc: '自動生成標準化文檔與註釋', category: 'Core', details: '支援 PHPDoc, JSDoc, Markdown。' },
  { id: 'docker-captain', name: 'Docker Captain', desc: 'Docker 容器管理專家', category: 'Core', details: '協助除錯、服務檢查與配置優化。' },
  { id: 'git-commit-helper', name: 'Git Commit Helper', desc: '自動分析 Git 變動與生成提交訊息', category: 'Core', details: '根據 Conventional Commits 生成帶有 Emoji 的訊息。' },
  { id: 'i18n-manager', name: 'i18n Manager', desc: '多語系同步與管理工具', category: 'Core', details: '確保翻譯完整性與一致性。' },
  { id: 'laravel-expert', name: 'Laravel Expert', desc: 'Laravel 開發專家', category: 'Core', details: '提供最佳實踐、架構指導與代碼生成。' },
  { id: 'pdf-wizard', name: 'PDF Wizard', desc: 'PDF 文件處理技能', category: 'Core', details: '包含文字提取、合併、分割與 OCR 前處理。' },
  { id: 'readme-updater', name: 'Readme Updater', desc: '自動更新專案文件', category: 'Core', details: '保持 README.md 與實際程式碼同步。' },
  { id: 'tailwind-styler', name: 'Tailwind Styler', desc: 'Tailwind CSS 專家', category: 'Core', details: '協助轉換樣式與優化 Class 排序。' },
  { id: 'test-writer', name: 'Test Writer', desc: '自動化測試生成專家', category: 'Core', details: '支援 PHPUnit, Pest, Vitest, Jest。' },
  { id: 'ui-designer', name: 'UI Designer', desc: 'UI/UX 設計輔助專家', category: 'Core', details: '專精於生成介面 Mockup 與素材。' },
  { id: 'wordpress-architect', name: 'WordPress Architect', desc: 'WordPress 核心與架構專家', category: 'Core', details: '專精於主題開發、Hooks 機制與 WP-CLI。' },
];

/**
 * 遞迴複製目錄 (排除 .git, node_modules)
 */
async function copyDir(src: string, dest: string, progressCallback?: (msg: string) => void) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '.git' || entry.name === 'node_modules') continue;
            await copyDir(srcPath, destPath, progressCallback);
        } else {
            if (progressCallback) progressCallback(`Copying ${entry.name}...`);
            await fs.copyFile(srcPath, destPath);
        }
    }
}

async function writeFileIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.writeFile(filePath, content, { flag: 'wx', encoding: 'utf-8' });
    return true;
  } catch (error: any) {
    if (error?.code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

/**
 * 從 SKILL.md 解析 YAML Frontmatter (簡單正則匹配)
 */
async function parseSkillMetadata(skillDir: string, fallbackId: string) {
    const defaultMeta = { id: fallbackId, name: fallbackId, desc: '工作區擴充技能', category: 'Plugin', details: '無詳細說明' };
    try {
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        const content = await fs.readFile(skillMdPath, 'utf-8');
        // 嘗試匹配 --- 之間的 yaml 區段
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (match && match[1]) {
            const yamlStr = match[1];
            // 簡易解析 name/description (不依賴 yaml 解析器)
            const nameMatch = yamlStr.match(/name:\s*(.+)/i);
            const descMatch = yamlStr.match(/description:\s*(.+)/i) || yamlStr.match(/desc:\s*(.+)/i);
            
            if (nameMatch) defaultMeta.name = nameMatch[1].replace(/['"]/g, '').trim();
            if (descMatch) defaultMeta.desc = descMatch[1].replace(/['"]/g, '').trim();
        }
    } catch (e) {
        // 如果沒有 SKILL.md 或讀取失敗，回傳預設值
    }
    return defaultMeta;
}

/**
 * 掃描指定目錄下的技能子資料夾 (skills/ 或 extensions/ 皆可)
 */
async function scanSkillsInDir(dir: string): Promise<any[]> {
    const results = [];
    try {
        const stats = await fs.stat(dir);
        if (!stats.isDirectory()) return [];
        const items = await fs.readdir(dir);
        for (const item of items) {
            if (item.startsWith('.')) continue;
            const fullPath = path.join(dir, item);
            try {
                const itemStats = await fs.stat(fullPath);
                if (itemStats.isDirectory()) {
                    const meta = await parseSkillMetadata(fullPath, item);
                    results.push(meta);
                }
            } catch (e) {}
        }
    } catch (e) {}
    return results;
}

/**
 * 掃描多個基礎路徑中的已安裝技能 (包含 skills/ 與 extensions/ 下的技能)
 */
async function scanInstalledSkills(...basePaths: string[]): Promise<any[]> {
    const allIds = new Set<string>();
    const allSkills: any[] = [];

    for (const basePath of basePaths) {
        if (!basePath) continue;
        // 掃描 skills/ 子目錄
        const fromSkills = await scanSkillsInDir(path.join(basePath, 'skills'));
        // 掃描 extensions/ 子目錄 (OpenClaw 的擴充包)
        const extDir = path.join(basePath, 'extensions');
        const fromExtensions: any[] = [];
        try {
            const extItems = await fs.readdir(extDir);
            for (const extPkg of extItems) {
                if (extPkg.startsWith('.')) continue;
                const pkgPath = path.join(extDir, extPkg);
                // extensions 可能直接是技能，也可能是包含 skills/ 的套件
                const nestedSkills = await scanSkillsInDir(path.join(pkgPath, 'skills'));
                if (nestedSkills.length > 0) {
                    fromExtensions.push(...nestedSkills);
                } else {
                    // 直接嘗試當成技能讀取 (e.g. extensions/lobster/SKILL.md)
                    const meta = await parseSkillMetadata(pkgPath, extPkg);
                    fromExtensions.push(meta);
                }
            }
        } catch (e) {}

        for (const skill of [...fromSkills, ...fromExtensions]) {
            if (!allIds.has(skill.id)) {
                allIds.add(skill.id);
                allSkills.push(skill);
            }
        }
    }

    return allSkills;
}


app.whenReady().then(() => {
  createWindow().catch((err) => {
    console.error('Failed to create window:', err);
  });
});

ipcMain.on('window:resize', (event, mode: 'mini' | 'expanded') => {
  if (!mainWindow) return;
  if (mode === 'mini') {
    mainWindow.setSize(320, 550, true);
    mainWindow.setResizable(false);
  } else {
    mainWindow.setSize(1100, 750, true);
    mainWindow.setResizable(true);
  }
});

ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('shell:exec', async (_event, command: string, args: string[] = []) => {
  const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

  // gateway:http-watchdog-start-json { enabled, healthCheckCommand, restartCommand, intervalMs?, failThreshold?, maxRestarts? }
  if (fullCommand.startsWith('gateway:http-watchdog-start-json ')) {
    try {
      const payloadStr = fullCommand.replace(/^gateway:http-watchdog-start-json\s+/, '').trim();
      const payload = JSON.parse(payloadStr || '{}');
      startGatewayHttpWatchdog(payload || {});
      return { code: 0, stdout: 'gateway http watchdog configured', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stderr: e?.message || 'Invalid gateway:http-watchdog-start-json payload', exitCode: 1 };
    }
  }

  if (fullCommand === 'gateway:http-watchdog-stop') {
    stopGatewayHttpWatchdog('manual stop command');
    return { code: 0, stdout: 'gateway http watchdog stopped', exitCode: 0 };
  }

  // gateway:start-bg-json { command, autoRestart, restartInForegroundTerminal, maxRestarts?, baseBackoffMs? }
  if (fullCommand.startsWith('gateway:start-bg-json ')) {
    try {
      const payloadStr = fullCommand.replace(/^gateway:start-bg-json\s+/, '').trim();
      const payload = JSON.parse(payloadStr || '{}');
      const actualCmd = String(payload?.command || '').trim();
      if (!actualCmd) {
        return { code: 1, stderr: 'Missing command for gateway:start-bg-json', exitCode: 1 };
      }

      stopGatewayWatchdog('replace previous gateway process');
      stopGatewayHttpWatchdog('switch to process watchdog mode');
      gatewayWatchdog.command = actualCmd;
      gatewayWatchdog.stopRequested = false;
      gatewayWatchdog.restartAttempts = 0;
      gatewayWatchdog.options = {
        autoRestart: Boolean(payload?.autoRestart),
        restartInForegroundTerminal: Boolean(payload?.restartInForegroundTerminal),
        maxRestarts: Number.isInteger(payload?.maxRestarts) ? Math.max(1, Number(payload.maxRestarts)) : 5,
        baseBackoffMs: Number.isInteger(payload?.baseBackoffMs) ? Math.max(200, Number(payload.baseBackoffMs)) : 1000,
      };

      const child = spawnWatchedGatewayProcess(actualCmd);
      return { code: 0, stdout: String(child.pid ?? ''), exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stderr: e?.message || 'Invalid gateway:start-bg-json payload', exitCode: 1 };
    }
  }

  // gateway:start-bg <cmd> — spawn the command in background and return immediately.
  // Used for `gateway run` which is a long-running foreground process.
  if (fullCommand.startsWith('gateway:start-bg ')) {
    const actualCmd = fullCommand.replace(/^gateway:start-bg\s+/, '').trim();
    if (!actualCmd) {
      return { code: 1, stderr: 'Missing command for gateway:start-bg', exitCode: 1 };
    }
    stopGatewayWatchdog('replace previous gateway process');
    stopGatewayHttpWatchdog('switch to process watchdog mode');
    gatewayWatchdog.command = actualCmd;
    gatewayWatchdog.stopRequested = false;
    gatewayWatchdog.restartAttempts = 0;
    gatewayWatchdog.options = { ...DEFAULT_GATEWAY_WATCHDOG_OPTIONS };
    const child = spawnWatchedGatewayProcess(actualCmd);
    return { code: 0, stdout: String(child.pid ?? ''), exitCode: 0 };
  }

  if (fullCommand.startsWith('snapshot:read-model')) {
    try {
      const payloadStr = fullCommand.replace('snapshot:read-model', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const historyCandidatePaths: string[] = Array.isArray(payload?.historyCandidatePaths)
        ? payload.historyCandidatePaths.map((item: any) => String(item || '').trim()).filter(Boolean)
        : [];
      const historyDays = Math.max(1, Math.min(30, Number(payload?.historyDays || 7)));
      const taskHeartbeatTimeoutMs = Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Number(payload?.taskHeartbeatTimeoutMs || 10 * 60 * 1000)));
      const candidatePaths: string[] = Array.isArray(payload?.candidatePaths)
        ? payload.candidatePaths.map((item: any) => String(item || '').trim()).filter(Boolean)
        : [];

      for (const snapshotPath of candidatePaths) {
        try {
          await fs.access(snapshotPath);
          const content = await fs.readFile(snapshotPath, 'utf-8');
          const rawSnapshot = JSON.parse(content);
          const readModel = normalizeReadModelSnapshot(rawSnapshot);
          const nowIso = new Date().toISOString();
          const taskGovernance = computeTaskGovernance(readModel, taskHeartbeatTimeoutMs, nowIso);
          readModel.tasks = taskGovernance.tasks;

          const runtimeDir = path.dirname(snapshotPath);
          const ackMap = await loadEventAcks(runtimeDir);
          const governanceEvents = [
            ...taskGovernance.events,
            ...buildGovernanceEvents(readModel, nowIso),
          ];
          const { activeEvents, ackedEvents } = applyAckStateToEvents(governanceEvents, ackMap, nowIso);

          const auditTimeline = await buildAuditTimeline(runtimeDir, governanceEvents);
          const dailyDigest = buildDailyDigestMarkdown(auditTimeline);
          let history: any[] = [];
          let historySourcePath = '';

          for (const historyPath of historyCandidatePaths) {
            try {
              await fs.access(historyPath);
              const historyRaw = await fs.readFile(historyPath, 'utf-8');
              const parsedHistory = buildReadModelHistoryFromJsonl(historyRaw, historyDays);
              if (parsedHistory.length > 0) {
                history = parsedHistory;
                historySourcePath = historyPath;
                break;
              }
            } catch {
              continue;
            }
          }

          if (history.length === 0) {
            history = fallbackHistoryFromSnapshot(readModel, historyDays);
          }

          return {
            code: 0,
            stdout: JSON.stringify({
              sourcePath: snapshotPath,
              historySourcePath,
              snapshot: rawSnapshot,
              readModel,
              history,
              eventQueue: activeEvents,
              ackedEvents,
              auditTimeline,
              dailyDigest,
            }),
            stderr: '',
            exitCode: 0,
          };
        } catch {
          continue;
        }
      }

      return { code: 1, stdout: '', stderr: 'No readable snapshot found', exitCode: 1 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:write')) {
    try {
      const configStr = fullCommand.replace('config:write ', '');
      const config = JSON.parse(configStr);
      const configPath = path.join(app.getPath('userData'), 'config.json');
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      return { code: 0, stdout: `Config saved to ${configPath}`, stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand === 'config:read') {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      return { code: 0, stdout: content, stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: 'No config file found', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:migrate-openclaw')) {
    try {
      const payloadStr = fullCommand.replace('config:migrate-openclaw ', '').trim();
      const payload = JSON.parse(payloadStr || '{}');
      const configFilePath = payload?.configPath ? path.join(payload.configPath, 'openclaw.json') : '';
      const workspacePath = payload?.workspacePath || '';
      if (!configFilePath) {
        return { code: 1, stderr: 'Missing config path', exitCode: 1 };
      }

      const raw = await fs.readFile(configFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      let changed = false;

      if (parsed && typeof parsed === 'object') {
        if ('version' in parsed) {
          delete parsed.version;
          changed = true;
        }
        if ('corePath' in parsed) {
          delete parsed.corePath;
          changed = true;
        }

        if (!parsed.agents || typeof parsed.agents !== 'object') {
          parsed.agents = {};
          changed = true;
        }
        if (!parsed.agents.defaults || typeof parsed.agents.defaults !== 'object') {
          parsed.agents.defaults = {};
          changed = true;
        }
        if (workspacePath && !parsed.agents.defaults.workspace) {
          parsed.agents.defaults.workspace = workspacePath;
          changed = true;
        }
      }

      if (changed) {
        await fs.writeFile(configFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
      }

      return { code: 0, stdout: JSON.stringify({ changed }), exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand === 'detect:paths') {
    const home = app.getPath('home');
    const possibleWorkspace = path.join(home, '.openclaw');
    const searchScopes = [home, path.join(home, 'Desktop'), path.join(home, 'Documents'), path.dirname(app.getAppPath())];
    const launcherConfigPath = path.join(app.getPath('userData'), 'config.json');

    let corePath = '';
    let configPath = '';
    let workspacePath = '';
    let existingConfig: any = {};

    // Respect user-selected paths saved by onboarding before falling back to auto-discovery.
    try {
      const launcherRaw = await fs.readFile(launcherConfigPath, 'utf-8');
      const launcherCfg = JSON.parse(launcherRaw);

      if (typeof launcherCfg.workspacePath === 'string' && launcherCfg.workspacePath.trim()) {
        workspacePath = launcherCfg.workspacePath.trim();
      }

      if (typeof launcherCfg.configPath === 'string' && launcherCfg.configPath.trim()) {
        const savedConfigPath = launcherCfg.configPath.trim();
        const savedConfigFile = path.join(savedConfigPath, 'openclaw.json');
        configPath = savedConfigPath;
        try {
          await fs.access(savedConfigFile);
          const content = await fs.readFile(savedConfigFile, 'utf-8');
          existingConfig = parseOpenClawConfig(content);
          if (existingConfig.workspace) {
            workspacePath = existingConfig.workspace;
          }
        } catch {
          // Keep saved config path even if openclaw.json is not ready yet.
        }
      }

      if (typeof launcherCfg.corePath === 'string' && launcherCfg.corePath.trim()) {
        const savedCorePath = launcherCfg.corePath.trim();
        try {
          await fs.access(path.join(savedCorePath, 'package.json'));
          corePath = savedCorePath;
        } catch {
          // Fall back to search scopes if saved core path is stale.
        }
      }
    } catch {
      // Ignore parse/read failures and continue with discovery.
    }

    if (!workspacePath) {
      try {
        await fs.access(possibleWorkspace);
        workspacePath = possibleWorkspace;
      } catch(e) {}
    }

    const possibleConfigPath = path.join(possibleWorkspace, 'openclaw.json');
    if (!configPath) {
      try {
        await fs.access(possibleConfigPath);
        configPath = possibleWorkspace;
        const content = await fs.readFile(possibleConfigPath, 'utf-8');
        existingConfig = parseOpenClawConfig(content);
        if (existingConfig.workspace) workspacePath = existingConfig.workspace;
      } catch(e) {}
    }

    if (!corePath) {
      for (const scope of searchScopes) {
        try {
          const files = await fs.readdir(scope);
          for (const file of files) {
            if (file.toLowerCase().includes('clawdbot') || file.toLowerCase().includes('openclaw')) {
              const fullPath = path.join(scope, file);
              const stats = await fs.stat(fullPath);
              if (stats.isDirectory()) {
                try {
                  await fs.access(path.join(fullPath, 'package.json'));
                  corePath = fullPath;
                  break;
                } catch(e) {}
              }
            }
          }
          if (corePath) break;
        } catch(e) {}
      }
    }

    let workspaceSkills: any[] = [];
    const effectiveWorkspacePath = workspacePath || possibleWorkspace;
    if (effectiveWorkspacePath) {
        workspaceSkills = await scanInstalledSkills(effectiveWorkspacePath);
    }

    return { 
        code: 0, 
        stdout: JSON.stringify({ corePath, configPath, workspacePath: workspacePath || possibleWorkspace, existingConfig: { ...existingConfig, workspaceSkills }, coreSkills: CORE_SKILLS }),
        exitCode: 0
    };
  }

  if (fullCommand === 'skill:import') {
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: '選擇 OpenClaw 技能資料夾',
      });
      if (result.canceled) return { code: 0, stdout: 'Canceled', exitCode: 0 };
      
      const sourcePath = result.filePaths[0];
      const skillName = path.basename(sourcePath);
      
      // 驗證是否為有效技能
      try {
        await fs.access(path.join(sourcePath, 'SKILL.md'));
      } catch (e) {
        return { code: 1, stderr: '錯誤：所選資料夾內缺少 SKILL.md，不是有效的技能。', exitCode: 1 };
      }

      // 取得目標路徑
      const configPath = path.join(app.getPath('userData'), 'config.json');
      let targetBaseDir = '';
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(content);
        targetBaseDir = config.workspacePath || config.configPath;
      } catch (e) {}
      
      if (!targetBaseDir) {
        // Fallback or ask
        targetBaseDir = path.join(app.getPath('home'), '.openclaw');
      }

      const targetPath = path.join(targetBaseDir, 'skills', skillName);
      
      // 執行複製 (fs.cp 在 Node 16+ 支援)
      await fs.mkdir(path.join(targetBaseDir, 'skills'), { recursive: true });
      await fs.cp(sourcePath, targetPath, { recursive: true });
      
      return { code: 0, stdout: `成功匯入技能：${skillName}`, exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('skill:delete')) {
    try {
      const skillPath = fullCommand.replace('skill:delete ', '').trim();
      if (!skillPath) throw new Error('未提供路徑');

      const launcherConfigPath = path.join(app.getPath('userData'), 'config.json');
      let configuredWorkspacePath = '';
      let configuredConfigPath = '';
      try {
        const launcherRaw = await fs.readFile(launcherConfigPath, 'utf-8');
        const launcherCfg = JSON.parse(launcherRaw || '{}');
        configuredWorkspacePath = typeof launcherCfg.workspacePath === 'string' ? launcherCfg.workspacePath.trim() : '';
        configuredConfigPath = typeof launcherCfg.configPath === 'string' ? launcherCfg.configPath.trim() : '';
      } catch {
        // Fallback handled by default paths below.
      }

      const allowedBases = [
        configuredWorkspacePath ? path.resolve(configuredWorkspacePath, 'skills') : '',
        configuredConfigPath ? path.resolve(configuredConfigPath, 'skills') : '',
        path.resolve(app.getPath('home'), '.openclaw', 'skills')
      ].filter(Boolean);

      const resolvedTarget = path.resolve(skillPath);
      const isInsideAllowedBase = allowedBases.some((base) => resolvedTarget === base || resolvedTarget.startsWith(`${base}${path.sep}`));
      if (!isInsideAllowedBase) {
        throw new Error('安全性拒絕：該技能路徑不在允許的 skills 目錄內');
      }

      await fs.rm(resolvedTarget, { recursive: true, force: true });
      return { code: 0, stdout: '技能已成功移除', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:probe')) {
    const probePath = fullCommand.replace('config:probe ', '').trim();
    try {
        const stats = await fs.stat(probePath);
        let finalConfigFilePath = '';
        let finalConfigDirPath = '';
        
        if (stats.isDirectory()) {
            const possible = path.join(probePath, 'openclaw.json');
            try {
                await fs.access(possible);
                finalConfigFilePath = possible;
                finalConfigDirPath = probePath;
            } catch(e) {
                const possibleClaw = path.join(probePath, 'clawdbot.json');
                try {
                    await fs.access(possibleClaw);
                    finalConfigFilePath = possibleClaw;
                    finalConfigDirPath = probePath;
                } catch(e2) {}
            }
        } else if (probePath.endsWith('.json')) {
            finalConfigFilePath = probePath;
            finalConfigDirPath = path.dirname(probePath);
        }

        if (finalConfigFilePath) {
            const content = await fs.readFile(finalConfigFilePath, 'utf-8');
            const configData = parseOpenClawConfig(content);
            const workspaceSkills = await scanInstalledSkills(finalConfigDirPath, configData.corePath || '');
            return {
                code: 0,
                stdout: JSON.stringify({ ...configData, configPath: finalConfigDirPath, workspaceSkills, coreSkills: CORE_SKILLS }),
                exitCode: 0
            };
        }
        return { code: 1, stdout: '', stderr: 'No config found at path', exitCode: 1 };
    } catch(e: any) {
        return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('auth:list-profiles')) {
    try {
      const payloadStr = fullCommand.replace('auth:list-profiles', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const configDir = normalizeConfigDirectory(String(payload?.configPath || ''));
      if (!configDir) {
        return { code: 1, stdout: '', stderr: 'Missing configPath', exitCode: 1 };
      }
      const data = await collectAuthProfiles(configDir);
      return { code: 0, stdout: JSON.stringify({ profiles: data.profiles, summary: data.summary }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('auth:remove-profile')) {
    try {
      const payloadStr = fullCommand.replace('auth:remove-profile', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const configDir = normalizeConfigDirectory(String(payload?.configPath || ''));
      const profileId = String(payload?.profileId || '').trim();
      if (!configDir || !profileId) {
        return { code: 1, stdout: '', stderr: 'Missing configPath or profileId', exitCode: 1 };
      }
      if (!/^[A-Za-z0-9._:-]+$/.test(profileId)) {
        return { code: 1, stdout: '', stderr: 'Invalid profileId', exitCode: 1 };
      }

      const configFilePath = path.join(configDir, 'openclaw.json');
      const configJson = (await loadJsonFile(configFilePath)) || {};
      let removedGlobal = false;
      if (configJson?.auth?.profiles && Object.prototype.hasOwnProperty.call(configJson.auth.profiles, profileId)) {
        delete configJson.auth.profiles[profileId];
        removedGlobal = true;
      }
      if (removedGlobal) {
        await saveJsonFile(configFilePath, configJson);
      }

      const agentFiles = await getAgentAuthProfilePaths(configDir);
      let removedAgentFiles = 0;
      for (const authPath of agentFiles) {
        const parsed = (await loadJsonFile(authPath)) || {};
        if (parsed?.profiles && Object.prototype.hasOwnProperty.call(parsed.profiles, profileId)) {
          delete parsed.profiles[profileId];
          await saveJsonFile(authPath, parsed);
          removedAgentFiles += 1;
        }
      }

      return {
        code: 0,
        stdout: JSON.stringify({ removedGlobal, removedAgentFiles }),
        stderr: '',
        exitCode: 0,
      };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('auth:add-profile')) {
    try {
      const payloadStr = fullCommand.replace('auth:add-profile', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const corePath = String(payload?.corePath || '').trim();
      const configDir = normalizeConfigDirectory(String(payload?.configPath || ''));
      const authChoice = String(payload?.authChoice || '').trim();
      const rawSecret = String(payload?.secret || '');
      const secret = sanitizeSecret(rawSecret);

      if (!corePath || !configDir || !authChoice) {
        return { code: 1, stdout: '', stderr: 'Missing corePath/configPath/authChoice', exitCode: 1 };
      }
      if (!SUPPORTED_AUTH_CHOICES.has(authChoice)) {
        return { code: 1, stdout: '', stderr: `Unsupported authChoice: ${authChoice}`, exitCode: 1 };
      }
      if (OAUTH_AUTH_CHOICES.has(authChoice)) {
        return { code: 1, stdout: '', stderr: 'OAuth requires full onboarding flow in terminal', exitCode: 1 };
      }
      if (!CREDENTIALLESS_AUTH_CHOICES.has(authChoice) && !secret) {
        return { code: 1, stdout: '', stderr: 'Credential is required for this authChoice', exitCode: 1 };
      }

      const configFilePath = path.join(configDir, 'openclaw.json');
      const envPrefix = `OPENCLAW_STATE_DIR=${shellQuote(configDir)} OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} `;
      const workspaceFlag = String(payload?.workspacePath || '').trim() ? ` --workspace ${shellQuote(String(payload.workspacePath).trim())}` : '';

      let authFlags = '';
      if (authChoice === 'token') {
        authFlags = ` --token-provider anthropic --token ${shellQuote(secret)}`;
      } else if (!CREDENTIALLESS_AUTH_CHOICES.has(authChoice)) {
        const flag = AUTH_CHOICE_FLAG_MAPPING[authChoice];
        if (!flag) {
          return { code: 1, stdout: '', stderr: `No auth flag mapping for ${authChoice}`, exitCode: 1 };
        }
        authFlags = ` ${flag} ${shellQuote(secret)}`;
      }

      const onboardCmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw onboard --auth-choice ${shellQuote(authChoice)}${authFlags}${workspaceFlag} --no-install-daemon --skip-daemon --skip-health --non-interactive --accept-risk`;
      const onboardRes = await runShellCommand(onboardCmd);
      if ((onboardRes.code ?? 0) !== 0) {
        return { code: onboardRes.code ?? 1, stdout: onboardRes.stdout || '', stderr: onboardRes.stderr || 'onboard failed', exitCode: onboardRes.code ?? 1 };
      }

      // 新版 OpenClaw 已移除 `openclaw auth set`。
      // 授權寫入由 onboard 負責，後續以 dual-layer profile 檢查確認結果。

      const aliases = getChoiceAliases(authChoice);
      const listed = await collectAuthProfiles(configDir);
      const hasMatched = listed.profiles.some((profile: any) => profileMatchesAliases(profile.profileId, { provider: profile.provider }, aliases) && (CREDENTIALLESS_AUTH_CHOICES.has(authChoice) || profile.agentPresent));
      if (!hasMatched) {
        return { code: 1, stdout: '', stderr: 'Auth write finished but no matched profile found in dual layers', exitCode: 1 };
      }

      return { code: 0, stdout: JSON.stringify({ authChoice, aliases, secretSanitized: secret !== rawSecret }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:model-options')) {
    try {
      const payloadStr = fullCommand.replace('config:model-options', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const corePath = String(payload?.corePath || '').trim();
      const configDir = normalizeConfigDirectory(String(payload?.configPath || ''));
      if (!configDir) {
        return { code: 1, stdout: '', stderr: 'Missing configPath', exitCode: 1 };
      }

      const filters = Array.isArray(payload?.providers)
        ? payload.providers.map((item: any) => String(item || '').toLowerCase()).filter(Boolean)
        : [];

      const authOverview = await collectAuthProfiles(configDir);
      const healthyProviders = Array.from(new Set(
        authOverview.profiles
          .filter((profile: any) => profile.agentPresent && profile.credentialHealthy)
          .flatMap((profile: any) => getProfileProviderAliases(profile.profileId, { provider: profile.provider }))
      ));
      const effectiveFilters = healthyProviders.length > 0 ? healthyProviders : filters;

      const configFilePath = path.join(configDir, 'openclaw.json');
      const envPrefix = `OPENCLAW_STATE_DIR=${shellQuote(configDir)} OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} `;

      if (corePath) {
        const listCmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw models list --all --json`;
        const listRes = await runShellCommand(listCmd);
        if ((listRes.code ?? 0) === 0 && String(listRes.stdout || '').trim()) {
          const parsedList = JSON.parse(listRes.stdout);
          const rows = Array.isArray(parsedList?.models) ? parsedList.models : [];
          const grouped = new Map<string, Set<string>>();

          for (const row of rows) {
            const key = String(row?.key || '').trim();
            if (!key || row?.available === false) continue;
            const provider = key.includes('/') ? key.split('/')[0].toLowerCase() : '';
            if (!provider) continue;
            if (!providerMatchesAny(provider, effectiveFilters)) continue;
            if (!grouped.has(provider)) {
              grouped.set(provider, new Set<string>());
            }
            grouped.get(provider)?.add(key);
          }

          const groups = Array.from(grouped.entries())
            .map(([provider, models]) => ({
              provider,
              group: provider,
              models: Array.from(models).sort((a, b) => a.localeCompare(b)),
            }))
            .filter((group) => group.models.length > 0)
            .sort((a, b) => a.group.localeCompare(b.group));

          if (groups.length > 0) {
            return {
              code: 0,
              stdout: JSON.stringify({ groups, source: 'openclaw models list --all --json' }),
              stderr: '',
              exitCode: 0,
            };
          }
        }
      }

      const agentsRoot = path.join(configDir, 'agents');
      let entries: any[] = [];
      try {
        entries = await fs.readdir(agentsRoot, { withFileTypes: true });
      } catch {
        return { code: 0, stdout: JSON.stringify({ groups: [], source: '' }), stderr: '', exitCode: 0 };
      }

      const modelFiles: string[] = [];
      const mainFirst = entries
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => {
          if (a.name === 'main') return -1;
          if (b.name === 'main') return 1;
          return a.name.localeCompare(b.name);
        });

      for (const entry of mainFirst) {
        const candidate = path.join(agentsRoot, entry.name, 'agent', 'models.json');
        try {
          await fs.access(candidate);
          modelFiles.push(candidate);
        } catch {
          // Ignore agents without model file.
        }
      }

      if (!modelFiles.length) {
        return { code: 0, stdout: JSON.stringify({ groups: [], source: '' }), stderr: '', exitCode: 0 };
      }

      const grouped = new Map<string, Set<string>>();
      for (const modelFile of modelFiles) {
        const parsed = (await loadJsonFile(modelFile)) || {};
        const providers = parsed?.providers || {};
        for (const [providerKey, providerConfig] of Object.entries(providers)) {
          const provider = String(providerKey || '').toLowerCase();
          if (!providerMatchesAny(provider, effectiveFilters)) continue;

          const rawModels = Array.isArray((providerConfig as any)?.models) ? (providerConfig as any).models : [];
          const resolvedModels: string[] = rawModels
            .map((item: any) => String(item?.id || item?.name || '').trim())
            .filter(Boolean);

          if (!grouped.has(provider)) {
            grouped.set(provider, new Set<string>());
          }
          for (const model of resolvedModels) {
            grouped.get(provider)?.add(model);
          }
        }
      }

      const groups = Array.from(grouped.entries())
        .map(([provider, models]) => ({
          provider,
          group: provider,
          models: Array.from(models).sort((a, b) => a.localeCompare(b)),
        }))
        .filter((group) => group.models.length > 0)
        .sort((a, b) => a.group.localeCompare(b.group));

      return {
        code: 0,
        stdout: JSON.stringify({ groups, source: modelFiles[0] }),
        stderr: '',
        exitCode: 0,
      };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('project:check-empty')) {
    const targetPath = fullCommand.replace('project:check-empty ', '').trim();
    try {
        const stats = await fs.stat(targetPath);
        if (!stats.isDirectory()) return { code: 1, stderr: 'Not a directory', exitCode: 1 };
        const files = await fs.readdir(targetPath);
        const isEmpty = files.filter(f => !f.startsWith('.')).length === 0;
        return { code: 0, stdout: JSON.stringify({ isEmpty }), exitCode: 0 };
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            return { code: 0, stdout: JSON.stringify({ isEmpty: true, notExist: true }), exitCode: 0 };
        }
        return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('project:get-versions')) {
    try {
        const repoUrl = 'https://github.com/openclaw/openclaw.git';
        return new Promise((resolve) => {
            const gitProcess = spawn(`git ls-remote --tags ${repoUrl}`, { shell: true });
            let stdout = '';
            gitProcess.stdout.on('data', (data) => stdout += data.toString());
            gitProcess.on('close', (code) => {
                if (code !== 0) {
                    resolve({ code: 0, stdout: JSON.stringify(['main']), exitCode: 0 }); // Fallback
                    return;
                }
                const tags = stdout
                    .split('\n')
                    .filter(line => line.includes('refs/tags/'))
                    .map(line => line.split('refs/tags/')[1].replace('^{}', ''))
                    .filter((v, i, a) => a.indexOf(v) === i) // 去重
                    .reverse(); // 讓最新的版本在前
                resolve({ code: 0, stdout: JSON.stringify(['main', ...tags]), exitCode: 0 });
            });
        });
    } catch (e: any) {
        return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand === 'process:kill-all') {
    stopGatewayWatchdog('process:kill-all');
    stopGatewayHttpWatchdog('process:kill-all');
    killAllSubprocesses();
    return { code: 0, stdout: 'All tracked subprocesses killed', exitCode: 0 };
  }

  if (fullCommand.startsWith('project:initialize')) {
    try {
        const payloadStr = fullCommand.replace('project:initialize ', '').trim();
        let { corePath, configPath, workspacePath, version, method } = JSON.parse(payloadStr);

        const targetVersion = validateVersionRef(version || 'main');
        const downloadMethod = method || 'git'; // 'git' or 'zip'

        const checkAndWrap = async (dirPath: string, subName: string) => {
            try {
                await fs.mkdir(dirPath, { recursive: true });
                const files = await fs.readdir(dirPath);
                const isEmpty = files.filter(f => !f.startsWith('.')).length === 0;
                return isEmpty ? dirPath : path.join(dirPath, subName);
            } catch (e) {
                return path.join(dirPath, subName);
            }
        };

        // 預檢三區路徑
        const finalCorePath = await checkAndWrap(corePath, 'openclaw');
        const finalConfigPath = await checkAndWrap(configPath, '.openclaw');
        const finalWorkspacePath = await checkAndWrap(workspacePath, 'openclaw-workspace');

        // 1. 下載核心原始碼
        const repoUrl = 'https://github.com/openclaw/openclaw.git';
        const tarballUrl = `https://github.com/openclaw/openclaw/tarball/${encodeURIComponent(targetVersion)}`;
        
        mainWindow?.webContents.send('shell:stdout', { data: `>>> Initializing paths for version ${targetVersion} via ${downloadMethod}...\n`, source: 'stdout' });
        
        await fs.mkdir(finalCorePath, { recursive: true });

        return new Promise((resolve) => {
            let childProcess: any;
          const runCommandWithStreaming = (cmd: string, title: string) => {
            return new Promise<{ code: number; stdout: string; stderr: string }>((resolveStep) => {
              mainWindow?.webContents.send('shell:stdout', { data: `>>> ${title}\n`, source: 'stdout' });
              const proc = spawn(cmd, { shell: true, cwd: finalCorePath });
              activeProcesses.add(proc);
              let stdout = '';
              let stderr = '';

              proc.stdout.on('data', (data: any) => {
                const chunk = data.toString();
                stdout += chunk;
                mainWindow?.webContents.send('shell:stdout', { data: chunk, source: 'stdout' });
              });

              proc.stderr.on('data', (data: any) => {
                const chunk = data.toString();
                stderr += chunk;
                mainWindow?.webContents.send('shell:stdout', { data: chunk, source: 'stderr' });
              });

              proc.on('error', (err: any) => {
                activeProcesses.delete(proc);
                resolveStep({ code: 1, stdout, stderr: stderr || err.message || 'Unknown error' });
              });

              proc.on('close', (code: number) => {
                activeProcesses.delete(proc);
                resolveStep({ code: code ?? 0, stdout, stderr });
              });
            });
          };

            if (downloadMethod === 'zip') {
              const actualCmd = `curl -L ${shellQuote(tarballUrl)} | tar -xz --strip-components=1 -C ${shellQuote(finalCorePath)}`;
                // 改回直接執行，不使用 osascript，以便串流日誌到 UI 的「小視窗」
                childProcess = spawn(actualCmd, { shell: true });
            } else {
              const versionArgs = `--branch ${shellQuote(targetVersion)} --depth 1 --single-branch`;
                const isSubDir = finalCorePath !== corePath;
                const gitCmd = isSubDir 
                ? `git clone ${shellQuote(repoUrl)} ${versionArgs} ${shellQuote(path.basename(finalCorePath))}` 
                    : `git clone ${repoUrl} ${versionArgs} .`;
                const workingDir = isSubDir ? corePath : finalCorePath;

              const actualCmd = `cd ${shellQuote(workingDir)} && ${gitCmd}`;
                childProcess = spawn(actualCmd, { shell: true });
            }

            activeProcesses.add(childProcess);

            childProcess.stdout.on('data', (data: any) => {
                mainWindow?.webContents.send('shell:stdout', { data: data.toString(), source: 'stdout' });
            });

            childProcess.stderr.on('data', (data: any) => {
                mainWindow?.webContents.send('shell:stdout', { data: data.toString(), source: 'stderr' });
            });

            childProcess.on('error', (err: any) => {
              activeProcesses.delete(childProcess);
                resolve({ code: 1, stderr: `Spawn error: ${err.message}`, exitCode: 1 });
            });

            childProcess.on('close', async (code: number) => {
                if (code !== 0) {
                activeProcesses.delete(childProcess);
                    const errorMsg = downloadMethod === 'zip' 
                        ? `Download failed (code ${code}). Check your network connection.`
                        : `Git clone failed (code ${code}). Try switching to "ZIP" method or check your git/network.`;
                    resolve({ code: 1, stderr: errorMsg, exitCode: 1 });
                    return;
                }

                // [NEW] 自動清理 Git 跡象 (僅保留純核心代碼)
                if (downloadMethod === 'git') {
                    const gitDirPath = path.join(finalCorePath, '.git');
                    try {
                        mainWindow?.webContents.send('shell:stdout', { data: `>>> Detaching from Git (Cleaning up .git directory)...\n`, source: 'stdout' });
                        await fs.rm(gitDirPath, { recursive: true, force: true });
                    } catch (e) {
                        mainWindow?.webContents.send('shell:stdout', { data: `>>> Note: Could not remove .git folder, skipping...\n`, source: 'stdout' });
                    }
                }

                try {
                  const createdItems: string[] = [];
                  const existingItems: string[] = [];

                  const ensureDirWithTracking = async (dirPath: string) => {
                    try {
                      const stat = await fs.stat(dirPath);
                      if (stat.isDirectory()) {
                        existingItems.push(dirPath);
                        return;
                      }
                    } catch {}
                    await fs.mkdir(dirPath, { recursive: true });
                    createdItems.push(dirPath);
                  };

                  // 2. 安裝依賴（先安裝才有可用的 CLI，讓後續 openclaw setup 可以執行）
                  const installRes = await runCommandWithStreaming('pnpm install --no-frozen-lockfile', 'Installing OpenClaw dependencies...');
                  if (installRes.code !== 0) {
                    resolve({ code: 1, stderr: installRes.stderr || 'Dependency installation failed.', exitCode: 1 });
                    return;
                  }

                  // 3. 預熱 CLI 執行環境 (會在 dist 過舊時自動建置 TypeScript)
                  const warmupRes = await runCommandWithStreaming('pnpm openclaw --version', 'Prebuilding OpenClaw runtime...');
                  if (warmupRes.code !== 0) {
                    resolve({ code: 1, stderr: warmupRes.stderr || 'OpenClaw runtime warm-up failed.', exitCode: 1 });
                    return;
                  }

                  // 4. 用 openclaw setup 建立/更新 config（處理 workspace / gateway 欄位）
                  //    此時 CLI 已就緒，可直接呼叫原生指令，不再依賴 Launcher 手寫模板
                  mainWindow?.webContents.send('shell:stdout', { data: `>>> Initializing config at ${finalConfigPath}...\n`, source: 'stdout' });
                  await ensureDirWithTracking(finalConfigPath);

                  const configFilePath = path.join(finalConfigPath, 'openclaw.json');
                  let configExistedBefore = false;
                  try { await fs.stat(configFilePath); configExistedBefore = true; } catch {}

                  const setupEnv = `OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} OPENCLAW_STATE_DIR=${shellQuote(finalConfigPath)}`;
                  const setupRes = await runCommandWithStreaming(
                    `${setupEnv} pnpm openclaw setup --workspace ${shellQuote(finalWorkspacePath)} --init-channels`,
                    'Initializing OpenClaw config...'
                  );
                  if (setupRes.code !== 0) {
                    resolve({ code: 1, stderr: setupRes.stderr || 'openclaw setup failed.', exitCode: 1 });
                    return;
                  }
                  if (configExistedBefore) {
                    existingItems.push(configFilePath);
                  } else {
                    createdItems.push(configFilePath);
                  }

                  // 清理 Launcher 舊版可能寫入的 legacy keys（不影響 openclaw schema）
                  try {
                    const raw = await fs.readFile(configFilePath, 'utf-8');
                    const parsed = JSON.parse(raw);
                    let changed = false;
                    if ('version' in parsed) { delete parsed.version; changed = true; }
                    if ('corePath' in parsed) { delete parsed.corePath; changed = true; }
                    if (changed) {
                      await fs.writeFile(configFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
                    }
                  } catch {
                    // legacy cleanup 失敗不阻斷流程
                  }

                  // 6. 初始化 Workspace 附加資料夾與 Launcher 專屬 bootstrap 文件
                  // （openclaw setup 已建立 workspace 基礎目錄與 AGENTS.md；此處補充 Launcher 專屬內容）
                  mainWindow?.webContents.send('shell:stdout', { data: `>>> Setting up workspace at ${finalWorkspacePath}...\n`, source: 'stdout' });
                  const skillsDir = path.join(finalWorkspacePath, 'skills');
                  const extensionsDir = path.join(finalWorkspacePath, 'extensions');
                  await ensureDirWithTracking(finalWorkspacePath);
                  await ensureDirWithTracking(skillsDir);
                  await ensureDirWithTracking(extensionsDir);

                  const bootstrapTemplates: Record<string, string> = {
                    'AGENTS.md': '# AGENTS\n\nList project-specific agents and responsibilities.\n',
                    'SOUL.md': '# SOUL\n\nDefine mission, product values, and non-negotiable principles.\n',
                    'TOOLS.md': '# TOOLS\n\nDocument approved tools, runtime constraints, and workflows.\n',
                    'IDENTITY.md': '# IDENTITY\n\nDescribe team identity, tone, and guardrails.\n',
                    'USER.md': '# USER\n\nCapture user context, personas, and preference assumptions.\n',
                    'HEARTBEAT.md': '# HEARTBEAT\n\nTrack operating rhythm, rituals, and handoff cadence.\n',
                    'BOOTSTRAP.md': '# BOOTSTRAP\n\nOutline startup checklist and first-run expectations.\n',
                    'MEMORY.md': '# MEMORY\n\nPersistent project memory and verify decisions.\n',
                  };

                  for (const [name, content] of Object.entries(bootstrapTemplates)) {
                    const targetPath = path.join(finalWorkspacePath, name);
                    const wrote = await writeFileIfMissing(targetPath, content);
                    if (wrote) {
                      createdItems.push(targetPath);
                    } else {
                      existingItems.push(targetPath);
                    }
                  }

                    mainWindow?.webContents.send('shell:stdout', { data: `>>> Initialization complete!\n`, source: 'stdout' });
                    resolve({ 
                        code: 0, 
                        stdout: JSON.stringify({ 
                            corePath: finalCorePath, 
                            configPath: finalConfigPath, 
                            workspacePath: finalWorkspacePath,
                            createdItems,
                            existingItems
                        }), 
                        exitCode: 0 
                    });
                } catch (e: any) {
                    resolve({ code: 1, stderr: e.message, exitCode: 1 });
                }
                activeProcesses.delete(childProcess);
            });
        });
    } catch (e: any) {
        return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  return new Promise((resolve) => {
    // 輸出指令到 UI 日誌，方便偵錯
    mainWindow?.webContents.send('shell:stdout', { data: `[Exec] ${fullCommand}\n`, source: 'system' });
    
    const child = spawn(fullCommand, { shell: true });
    activeProcesses.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      mainWindow?.webContents.send('shell:stdout', { data: chunk, source: 'stdout' });
    });
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      mainWindow?.webContents.send('shell:stdout', { data: chunk, source: 'stderr' });
    });
    child.on('close', (code) => {
      activeProcesses.delete(child);
      resolve({ code: code ?? 0, stdout, stderr, exitCode: code ?? 0 });
    });
  });
});

ipcMain.handle('shell:kill-port-holder', async (_event, rawPort: number) => {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { success: false, error: 'Invalid port', port };
  }

  const lookupRes = await runShellCommand(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
  const pidLines = String(lookupRes.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const pids = Array.from(new Set(pidLines
    .map((line) => Number(line))
    .filter((pid) => Number.isInteger(pid) && pid > 0)));

  if (!pids.length) {
    return { success: false, error: `No listening process found on port ${port}`, port };
  }

  const termSent: number[] = [];
  const forceKilled: number[] = [];
  const failed: Array<{ pid: number; reason: string }> = [];

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      termSent.push(pid);
    } catch (e: any) {
      failed.push({ pid, reason: e?.message || 'SIGTERM failed' });
    }
  }

  if (termSent.length > 0) {
    await sleep(450);
  }

  for (const pid of termSent) {
    try {
      process.kill(pid, 0);
    } catch {
      continue;
    }

    try {
      process.kill(pid, 'SIGKILL');
      forceKilled.push(pid);
    } catch (e: any) {
      failed.push({ pid, reason: e?.message || 'SIGKILL failed' });
    }
  }

  return {
    success: termSent.length > 0,
    port,
    pids,
    killed: termSent,
    forceKilled,
    failed,
  };
});

ipcMain.handle('shell:open-external', async (_event, url: string) => {
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('openclaw:chat.invoke', async (_event, request: OpenClawChatInvokeRequest) => {
  if (!request?.requestId || !request?.sessionKey || !request?.agentId || !request?.message) {
    return {
      success: false,
      requestId: request?.requestId || '',
      error: 'Missing request parameters',
    };
  }

  const runtime = await resolveOpenClawRuntime();
  if (!runtime.openclawPrefix) {
    return {
      success: false,
      requestId: request.requestId,
      error: 'OpenClaw runtime not configured',
    };
  }

  if (runtime.gatewayUrlArg && !runtime.gatewayAuthArg) {
    return {
      success: false,
      requestId: request.requestId,
      error: '已指定 Gateway 埠號，但找不到顯式 token/password，請檢查 openclaw.json 的 gateway.auth 設定。',
      reason: 'gateway-explicit-auth-missing',
    };
  }

  const messageId = `${request.requestId}-assistant`;
  const params: Record<string, any> = {
    sessionKey: request.sessionKey,
    message: request.message,
    deliver: Boolean(request.deliver),
    idempotencyKey: request.requestId,
  };
  if (request.agentId) params.agentId = request.agentId;

  if (request.forceLocal) {
    return {
      success: false,
      requestId: request.requestId,
      messageId,
      mode: 'gateway' as const,
      reason: 'core-required-force-local-blocked',
      error: '核心對話已啟用強制 Gateway 模式，請先啟動核心（Gateway）後再送出。',
    };
  }

  const statusRes = await runShellCommand(`${runtime.openclawPrefix} gateway status${runtime.gatewayUrlArg}${runtime.gatewayAuthArg} --json`);
  const gatewayOnline = isGatewayOnlineFromStatus(statusRes);
  if (!gatewayOnline) {
    return {
      success: false,
      requestId: request.requestId,
      messageId,
      mode: 'gateway' as const,
      reason: 'core-required-gateway-offline',
      error: '核心尚未啟動，請先啟動 Gateway（Core）後再送出對話。',
    };
  }

  const mode: 'gateway' = 'gateway';
  const reason = '';

  const gatewayCommand = `${runtime.openclawPrefix} gateway call chat.send${runtime.gatewayUrlArg}${runtime.gatewayAuthArg} --params ${shellQuote(JSON.stringify(params))}`;
  const selectedCommand = gatewayCommand;

  const emitChunk = (payload: { delta?: string; done?: boolean; error?: string; mode: 'gateway' | 'local'; reason: string }) => {
    mainWindow?.webContents.send('openclaw:chat.chunk', {
      requestId: request.requestId,
      messageId,
      delta: payload.delta || '',
      done: payload.done,
      error: payload.error,
      mode: payload.mode,
      reason: payload.reason,
    });
  };

  const baselineRes = await fetchLatestAssistantText(runtime.openclawPrefix, runtime.gatewayUrlArg, runtime.gatewayAuthArg, request.sessionKey, request.agentId);
  if (!baselineRes.ok) {
    return {
      success: false,
      requestId: request.requestId,
      messageId,
      mode,
      reason,
      error: baselineRes.error,
    };
  }

  activeChatRequests.set(request.requestId, {
    sessionKey: request.sessionKey,
    agentId: request.agentId,
    aborted: false,
  });

  if (!request.stream) {
    const sendRes = await runShellCommand(selectedCommand);
    if (sendRes.code !== 0) {
      activeChatRequests.delete(request.requestId);
      return {
        success: false,
        requestId: request.requestId,
        messageId,
        mode,
        reason,
        error: sendRes.stderr || 'Chat invoke failed',
      };
    }

    const sendParsed = parseGatewayCallStdoutJson(sendRes.stdout);
    const runId = extractRunIdFromSendPayload(sendParsed);
    if (runId) {
      const state = activeChatRequests.get(request.requestId);
      if (state) activeChatRequests.set(request.requestId, { ...state, runId });
    }

    const timeoutMs = 65000;
    const startAt = Date.now();
    let finalText = baselineRes.text;
    let lastChangeAt = Date.now();
    while (Date.now() - startAt < timeoutMs) {
      const state = activeChatRequests.get(request.requestId);
      if (!state || state.aborted) break;

      // eslint-disable-next-line no-await-in-loop
      const historyRes = await fetchLatestAssistantText(runtime.openclawPrefix, runtime.gatewayUrlArg, runtime.gatewayAuthArg, request.sessionKey, request.agentId);
      if (!historyRes.ok) {
        activeChatRequests.delete(request.requestId);
        return {
          success: false,
          requestId: request.requestId,
          messageId,
          mode,
          reason,
          error: historyRes.error,
        };
      }

      if (historyRes.text !== finalText) {
        finalText = historyRes.text;
        lastChangeAt = Date.now();
      }

      if (Date.now() - lastChangeAt >= 1500) {
        break;
      }

      // eslint-disable-next-line no-await-in-loop
      await sleep(550);
    }

    activeChatRequests.delete(request.requestId);

    return {
      success: true,
      requestId: request.requestId,
      messageId,
      content: finalText,
      mode,
      reason,
    };
  }

  const sendRes = await runShellCommand(selectedCommand);
  if (sendRes.code !== 0) {
    activeChatRequests.delete(request.requestId);
    emitChunk({
      error: sendRes.stderr || 'Chat invoke failed',
      done: true,
      mode,
      reason,
    });
    return {
      success: false,
      requestId: request.requestId,
      messageId,
      mode,
      reason,
      error: sendRes.stderr || 'Chat invoke failed',
    };
  }

  const sendParsed = parseGatewayCallStdoutJson(sendRes.stdout);
  const runId = extractRunIdFromSendPayload(sendParsed);
  if (runId) {
    const state = activeChatRequests.get(request.requestId);
    if (state) activeChatRequests.set(request.requestId, { ...state, runId });
  }

  waitForAssistantFinalByHistory({
    request,
    runtimePrefix: runtime.openclawPrefix,
    gatewayUrlArg: runtime.gatewayUrlArg,
    gatewayAuthArg: runtime.gatewayAuthArg,
    baseline: baselineRes.text,
    emitChunk,
  }).finally(() => {
    activeChatRequests.delete(request.requestId);
  });

  return {
    success: true,
    requestId: request.requestId,
    messageId,
    mode,
    reason,
  };
});

ipcMain.handle('openclaw:chat.abort', async (_event, requestId: string) => {
  const chatState = activeChatRequests.get(requestId);
  if (!chatState) {
    return { success: false, error: 'No active chat request' };
  }

  activeChatRequests.set(requestId, { ...chatState, aborted: true });

  try {
    const runtime = await resolveOpenClawRuntime();
    const abortParams: Record<string, any> = { sessionKey: chatState.sessionKey };
    if (chatState.runId) abortParams.runId = chatState.runId;
    if (chatState.agentId) abortParams.agentId = chatState.agentId;

    const abortCommand = `${runtime.openclawPrefix} gateway call chat.abort${runtime.gatewayUrlArg}${runtime.gatewayAuthArg} --params ${shellQuote(JSON.stringify(abortParams))}`;
    const abortRes = await runShellCommand(abortCommand);
    if (abortRes.code !== 0) {
      return { success: false, error: abortRes.stderr || 'Failed to abort chat run' };
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('events:ack', async (_event, payload: any) => {
  try {
    const eventId = normalizeString(payload?.eventId, '');
    if (!eventId) {
      return { success: false, error: 'Missing eventId' };
    }

    const runtimeCandidates = [
      normalizeString(payload?.runtimeDir, ''),
      normalizeString(payload?.configPath, '') ? path.join(normalizeString(payload?.configPath, ''), 'runtime') : '',
      normalizeString(payload?.workspacePath, '') ? path.join(normalizeString(payload?.workspacePath, ''), 'runtime') : '',
      normalizeString(payload?.corePath, '') ? path.join(normalizeString(payload?.corePath, ''), 'runtime') : '',
    ].filter(Boolean);

    const runtimeDir = (await resolveRuntimeDirFromCandidates(runtimeCandidates)) || runtimeCandidates[0] || '';
    if (!runtimeDir) {
      return { success: false, error: 'No runtimeDir available for ack storage' };
    }

    const ttlMs = Math.max(60_000, Math.min(7 * 24 * 60 * 60 * 1000, Number(payload?.ttlMs || 30 * 60 * 1000)));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    const ackMap = await loadEventAcks(runtimeDir);
    ackMap[eventId] = {
      ackedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await saveEventAcks(runtimeDir, ackMap);

    return {
      success: true,
      eventId,
      ackedAt: ackMap[eventId].ackedAt,
      expiresAt: ackMap[eventId].expiresAt,
      runtimeDir,
    };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('events:state', async (_event, payload: any) => {
  try {
    const runtimeCandidates = [
      normalizeString(payload?.runtimeDir, ''),
      normalizeString(payload?.configPath, '') ? path.join(normalizeString(payload?.configPath, ''), 'runtime') : '',
      normalizeString(payload?.workspacePath, '') ? path.join(normalizeString(payload?.workspacePath, ''), 'runtime') : '',
      normalizeString(payload?.corePath, '') ? path.join(normalizeString(payload?.corePath, ''), 'runtime') : '',
    ].filter(Boolean);

    const runtimeDir = (await resolveRuntimeDirFromCandidates(runtimeCandidates)) || runtimeCandidates[0] || '';
    if (!runtimeDir) {
      return { success: false, error: 'No runtimeDir available' };
    }

    const ackMap = await loadEventAcks(runtimeDir);
    return { success: true, runtimeDir, acks: ackMap };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('shell:open-path', async (_event, targetPath: string) => {
  try {
    if (!targetPath || typeof targetPath !== 'string') {
      return { success: false, error: 'Missing target path' };
    }
    const openError = await shell.openPath(targetPath);
    if (openError) {
      return { success: false, error: openError };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

app.on('before-quit', () => {
  killAllSubprocesses();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
