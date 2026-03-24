import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { mkdirSync, unlinkSync, watch as fsWatch, existsSync } from 'node:fs';

// ── Multi-instance support ──────────────────────────────────────────────────
// Isolate userData by PID to prevent Chromium singleton lock causing the second instance to crash.
// However, config.json (user settings) is stored in a fixed path PERSISTENT_CONFIG_DIR,
// so that the previous settings can be read on each restart and won't disappear due to PID changes.
app.setPath('userData', `${app.getPath('userData')}-${process.pid}`);
mkdirSync(app.getPath('userData'), { recursive: true });
// Fixed config directory: ~/Library/Application Support/NT-ClawLaunch/
const PERSISTENT_CONFIG_DIR = path.join(
  app.getPath('appData'),
  app.getName().replace(/ /g, '-'),
);
mkdirSync(PERSISTENT_CONFIG_DIR, { recursive: true });
const CONFIG_DIR = PERSISTENT_CONFIG_DIR;
// ───────────────────────────────────────────────────────────────────────────

// Suppress EPIPE errors that occur when concurrently/piped launchers close
// the parent stdout/stderr pipe while Electron tries to write to console.
process.stdout?.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') return; });
process.stderr?.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') return; });
process.on('uncaughtException', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') return; throw err; });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const activeProcesses = new Set<any>();
const activeChatRequests = new Map<string, { sessionKey: string; runId?: string; agentId?: string; aborted: boolean }>();
let activeLockFilePath: string | null = null;

const DEV_PORT_RANGE_START = 5173;
const DEV_PORT_RANGE_END = 5185;
const DEV_SERVER_WAIT_MS = 15000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const NT_CLAW_TERMINAL_MARKER_PREFIX = '__NT_CLAWLAUNCH_MANAGED__';

interface LauncherConfig {
  corePath?: string;
  configPath?: string;
  autoRestartGateway?: boolean;
}

interface GatewayStartOptions {
  autoRestart: boolean;
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
  startupGraceMs: number;
  restartCooldownMs: number;
}

interface GatewayHttpWatchdogState {
  timer: NodeJS.Timeout | null;
  checking: boolean;
  consecutiveFailures: number;
  restartAttempts: number;
  suppressChecksUntil: number;
  options: GatewayHttpWatchdogOptions;
}

const DEFAULT_GATEWAY_WATCHDOG_OPTIONS: GatewayStartOptions = {
  autoRestart: false,
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
  startupGraceMs: 20000,
  restartCooldownMs: 20000,
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
  suppressChecksUntil: 0,
  options: { ...DEFAULT_GATEWAY_HTTP_WATCHDOG_OPTIONS },
};
const shellSingleQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const escapeAppleScriptString = (value: string) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const sendToRenderer = (channel: string, payload: any) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const webContents = mainWindow.webContents;
  if (!webContents || webContents.isDestroyed()) return false;
  try {
    webContents.send(channel, payload);
    return true;
  } catch {
    return false;
  }
};

const emitShellStdout = (data: string, source: 'stdout' | 'stderr' = 'stdout') => {
  sendToRenderer('shell:stdout', { data, source });
};

const buildTerminalLaunchScript = (command: string, title = 'OpenClaw Gateway Auto-Restart') => {
  const marker = `${NT_CLAW_TERMINAL_MARKER_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const finalCmd = `clear; echo '🚀 ${title}...'; echo '${marker}'; ${command}; printf "\\n程序結束。\\n按 Enter 鍵關閉視窗..."; read -r _`;
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
  gatewayHttpWatchdog.suppressChecksUntil = 0;
  gatewayHttpWatchdog.options = { ...DEFAULT_GATEWAY_HTTP_WATCHDOG_OPTIONS };
  emitShellStdout(`[gateway-http-watchdog] stopped: ${reason}\n`, 'stdout');
};

const runGatewayHttpWatchdogCheck = async () => {
  if (gatewayHttpWatchdog.checking) return;
  if (!gatewayHttpWatchdog.options.enabled) return;
  if (Date.now() < gatewayHttpWatchdog.suppressChecksUntil) return;
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
    const failStdout = String(healthRes.stdout || '').trim();
    const failStderr = String(healthRes.stderr || '').trim();
    emitShellStdout(
      `[gateway-http-watchdog] health check failed (${gatewayHttpWatchdog.consecutiveFailures}/${gatewayHttpWatchdog.options.failThreshold}) code=${String(healthRes.code)} stdout=${failStdout ? 'non-empty' : 'empty'} stderr=${failStderr ? 'non-empty' : 'empty'}\n`,
      'stderr',
    );

    if (gatewayHttpWatchdog.consecutiveFailures < gatewayHttpWatchdog.options.failThreshold) {
      return;
    }

    // Double confirmation before restart to reduce misjudgment caused by transient jitter.
    await sleep(1200);
    const recheckRes = await runShellCommand(healthCheckCommand);
    const recheckOnline = isGatewayOnlineFromStatus(recheckRes);
    if (recheckOnline) {
      gatewayHttpWatchdog.consecutiveFailures = 0;
      emitShellStdout('[gateway-http-watchdog] false alarm recovered on recheck, skip restart\n', 'stdout');
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
      gatewayHttpWatchdog.suppressChecksUntil = Date.now() + gatewayHttpWatchdog.options.restartCooldownMs;
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
    startupGraceMs: Number.isFinite(Number(options.startupGraceMs)) ? Math.max(3000, Number(options.startupGraceMs)) : 20000,
    restartCooldownMs: Number.isFinite(Number(options.restartCooldownMs)) ? Math.max(3000, Number(options.restartCooldownMs)) : 20000,
  };

  if (!nextOptions.enabled || !nextOptions.healthCheckCommand || !nextOptions.restartCommand) {
    stopGatewayHttpWatchdog('disabled or missing command');
    return;
  }

  clearGatewayHttpWatchdogTimer();
  gatewayHttpWatchdog.options = nextOptions;
  gatewayHttpWatchdog.consecutiveFailures = 0;
  gatewayHttpWatchdog.restartAttempts = 0;
  gatewayHttpWatchdog.suppressChecksUntil = Date.now() + nextOptions.startupGraceMs;
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

// ── Runtime Usage Event (JSONL Scanner) ───────────────────────────────────

interface RuntimeUsageEvent {
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

const inferProviderFromModel = (model: string | undefined): string => {
  if (!model) return 'Unknown';
  const m = model.toLowerCase();
  if (m.includes('claude')) return 'Anthropic';
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3') || m.includes('o4')) return 'OpenAI';
  if (m.includes('gemini')) return 'Google';
  if (m.includes('llama') || m.includes('mistral') || m.includes('qwen') || m.includes('deepseek')) return 'OSS/Other';
  return 'Unknown';
};

const parseSessionJsonlForUsage = (content: string, agentId: string): RuntimeUsageEvent[] => {
  const events: RuntimeUsageEvent[] = [];
  let currentSessionId = '';
  let currentModel = '';

  for (const line of content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    let entry: any;
    try { entry = JSON.parse(line); } catch { continue; }

    if (entry.type === 'session' && entry.id) currentSessionId = String(entry.id);
    if (entry.sessionId) currentSessionId = String(entry.sessionId);
    if (entry.message?.model) currentModel = String(entry.message.model);

    if (entry.type === 'message' && entry.message?.role === 'assistant' && entry.message?.usage) {
      const usage = entry.message.usage;

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
        usage?.cost?.total ?? usage?.cost ?? usage?.estimatedCost ?? usage?.totalCost ?? 0, 0);

      const timestamp = String(entry.timestamp || entry.message?.timestamp || '');
      const day = timestamp.length >= 10 ? timestamp.slice(0, 10) : new Date().toISOString().slice(0, 10);
      const model: string | undefined = entry.message?.model || currentModel || undefined;
      // Prioritize message.provider (e.g., "minimax", "openai"), use fallback for inference only.
      const provider = typeof entry.message?.provider === 'string' && entry.message.provider
        ? entry.message.provider
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

// ──────────────────────────────────────────────────────────────────────────

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
  let settled = false;

  child.stdout.on('data', (data: any) => {
    stdout += data.toString();
  });
  child.stderr.on('data', (data: any) => {
    stderr += data.toString();
  });

  child.on('error', (error: any) => {
    activeProcesses.delete(child);
    if (settled) return;
    settled = true;
    resolve({ code: 1, stdout, stderr: stderr || String(error?.message || error) });
  });

  child.on('close', (code: number) => {
    activeProcesses.delete(child);
    if (settled) return;
    settled = true;
    resolve({ code: code ?? 1, stdout, stderr });
  });
});

const isGatewayOnlineFromStatus = (statusRes: { code: number; stdout: string; stderr: string }) => {
  if ((statusRes.code ?? 1) !== 0) return false;

  const raw = `${statusRes.stdout || ''}\n${statusRes.stderr || ''}`.toLowerCase();
  if (raw.includes('"online": true') || raw.includes('"online":true') || raw.includes('online') || raw.includes('running')) {
    return true;
  }

  // Supports general shell health checks (e.g., lsof).
  // These commands usually indicate health with code=0 and non-empty stdout.
  if (String(statusRes.stdout || '').trim()) {
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
  const launcherConfigPath = path.join(CONFIG_DIR, 'config.json');
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
  const gatewayUrlArg = buildGatewayUrlArg(String(openclawConfig?.gateway?.port ?? ''));
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
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    const req = http.get(`${normalizedUrl}/@vite/client`, (res) => {
      const statusOk = Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
      if (!statusOk) {
        res.resume();
        resolve(false);
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        // Ensure this is really Vite and not any random HTTP service.
        resolve(body.includes('vite') || body.includes('/@react-refresh'));
      });
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
      const url = `http://localhost:${port}`;
      // eslint-disable-next-line no-await-in-loop
      if (await isDevServerReachable(url)) {
        return url;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }

  return `http://localhost:${DEV_PORT_RANGE_START}`;
}

function killAllSubprocesses() {
  stopGatewayWatchdog('kill-all-subprocesses');
  stopGatewayHttpWatchdog('kill-all-subprocesses');
  for (const proc of activeProcesses) {
    try {
      if (!proc.killed) {
        proc.kill('SIGTERM');
        // Force kill if SIGTERM doesn't work.
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

// ── Lock file helpers for configPath isolation ──────────────────────────────

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function writeLockFile(configPathDir: string): Promise<string | null> {
  const lockFileName = `.nt-clawlaunch-${process.pid}.lock`;
  const lockFilePath = path.join(configPathDir, lockFileName);
  try {
    await fs.writeFile(lockFilePath, String(process.pid), 'utf-8');
    return lockFilePath;
  } catch (e) {
    console.error('[lock] Failed to write lock file:', e);
    return null;
  }
}

async function cleanupLockFile(): Promise<void> {
  if (!activeLockFilePath) return;
  const prev = activeLockFilePath;
  activeLockFilePath = null;
  try {
    await fs.unlink(prev);
  } catch {
    // silently ignore — file may already be gone
  }
}

interface ConfigPathConflictResult {
  conflictPid: number | null;
  suggestionPath: string;
}

async function checkConfigPathConflict(configPathDir: string): Promise<ConfigPathConflictResult> {
  let conflictPid: number | null = null;
  try {
    const entries = await fs.readdir(configPathDir);
    for (const entry of entries) {
      const match = entry.match(/^\.nt-clawlaunch-(\d+)\.lock$/);
      if (!match) continue;
      const pid = Number(match[1]);
      if (pid === process.pid) continue;
      if (isPidAlive(pid)) {
        conflictPid = pid;
        break;
      }
      // Stale lock from dead process — clean up opportunistically
      try { await fs.unlink(path.join(configPathDir, entry)); } catch {}
    }
  } catch {
    return { conflictPid: null, suggestionPath: '' };
  }

  if (conflictPid === null) return { conflictPid: null, suggestionPath: '' };

  const base = configPathDir.replace(/\/+$/, '');
  let suggestionPath = '';
  for (let i = 2; i <= 9; i++) {
    const candidate = `${base}-${i}`;
    let candidateFree = true;
    try {
      const candidateEntries = await fs.readdir(candidate);
      for (const e of candidateEntries) {
        const m = e.match(/^\.nt-clawlaunch-(\d+)\.lock$/);
        if (m && Number(m[1]) !== process.pid && isPidAlive(Number(m[1]))) {
          candidateFree = false;
          break;
        }
      }
    } catch {
      // Candidate directory doesn't exist — definitely free
    }
    if (candidateFree) { suggestionPath = candidate; break; }
  }

  return { conflictPid, suggestionPath };
}

async function activateConfigPath(newConfigPath: string): Promise<void> {
  const normalized = String(newConfigPath || '').trim();

  if (activeLockFilePath) {
    const currentDir = path.dirname(activeLockFilePath);
    if (normalized && currentDir === normalized) return;
  }

  await cleanupLockFile();
  if (!normalized) return;

  const { conflictPid, suggestionPath } = await checkConfigPathConflict(normalized);

  const lockPath = await writeLockFile(normalized);
  if (lockPath) activeLockFilePath = lockPath;

  if (conflictPid !== null) {
    const suggestionLine = suggestionPath ? `\n\n建議改用路徑：\n${suggestionPath}` : '';
    const dialogOptions = {
      type: 'warning' as const,
      title: 'Config Path 衝突警告',
      message: `另一個 NT-ClawLaunch 實例（PID ${conflictPid}）已在使用此 Config Path：\n\n${normalized}\n\n多個實例共用同一 Config Path 可能導致 gateway 設定衝突。建議在「Launcher 設定」中為此視窗指定獨立的 Config Path。${suggestionLine}`,
      buttons: ['知道了'],
    };
    const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (parentWindow) {
      dialog.showMessageBox(parentWindow, dialogOptions).catch(() => {});
    } else {
      dialog.showMessageBox(dialogOptions).catch(() => {});
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Infer the corresponding UI authChoice from the agent auth-profile
 */
function inferAuthChoiceFromProfile(profile: any): string {
  const provider = String(profile?.provider || '').toLowerCase();
  const mode = String(profile?.mode || profile?.type || '').toLowerCase();
  if (provider === 'anthropic') return mode === 'token' ? 'token' : 'apiKey';
  if (provider === 'openai-codex') return 'openai-codex';
  if (provider === 'openai') return mode === 'oauth' ? 'openai-codex' : 'openai-api-key';
  if (provider === 'google' || provider === 'gemini') return mode === 'oauth' ? 'google-gemini-cli' : 'gemini-api-key';
  if (provider === 'google-gemini-cli') return 'google-gemini-cli';
  if (provider === 'minimax-portal') return 'minimax-coding-plan-global-token';
  if (provider === 'minimax') return 'minimax-api';
  if (provider === 'moonshot') return 'moonshot-api-key';
  if (provider === 'openrouter') return 'openrouter-api-key';
  if (provider === 'xai') return 'xai-api-key';
  if (provider === 'ollama') return 'ollama';
  if (provider === 'vllm') return 'vllm';
  if (provider === 'chutes') return 'chutes';
  if (provider === 'qwen-portal' || provider === 'qwen') return 'qwen-portal';
  return '';
}

/**
 * Deeply parse OpenClaw config file
 * Supports extracting model from agents.defaults.model.primary and keys from auth.profiles
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

        // 0. Extract Core Path (if any)
        if (parsed.corePath) corePath = parsed.corePath;

        // 1. Extract model (OpenClaw standard path)
        if (!model && parsed.agents?.defaults?.model?.primary) {
            model = parsed.agents.defaults.model.primary;
        }

        // 2. Extract Workspace (OpenClaw standard path)
        if (parsed.agents?.defaults?.workspace) {
            workspace = parsed.agents.defaults.workspace;
        }

        // 3. Extract Bot Token (OpenClaw standard path)
        if (parsed.channels?.telegram?.botToken) {
            botToken = parsed.channels.telegram.botToken;
        }

        // 4. Extract API Key (iterate profiles) and infer authChoice
        if (!apiKey && parsed.auth?.profiles) {
            for (const key in parsed.auth.profiles) {
                const profile = parsed.auth.profiles[key];
                const possibleKey = profile.apiKey || profile.api_key || profile.token || profile.bearer;
                if (possibleKey && typeof possibleKey === 'string' && possibleKey.length > 5) {
                    apiKey = possibleKey;
                    // If no authChoice is explicitly defined, try to infer it from the profile name
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

        // 4.5 MiniMax Coding Plan Token detection: Do not write to auth.profiles, infer from models.providers
        // (minimax-coding-plan-* uses Provider level authentication, apiKey stored in models.providers.minimax-portal)
        const portalProvider = parsed.models?.providers?.['minimax-portal'];
        if (portalProvider?.apiKey) {
          if (!authChoice) {
            const portalBaseUrl = String(portalProvider.baseUrl || '');
            if (portalBaseUrl.includes('minimaxi.com')) {
              authChoice = 'minimax-coding-plan-cn-token';
            } else {
              authChoice = 'minimax-coding-plan-global-token';
            }
          }
          // Prioritize using provider-level apiKey when importing settings to avoid reading legacy fields.
          apiKey = String(portalProvider.apiKey || apiKey || '');
        }

        // 5. Secondary inference: If authChoice is still missing, infer from the model name
        if (!authChoice && model) {
            const lowModel = model.toLowerCase();
            if (lowModel.includes('claude')) authChoice = 'apiKey';
            else if (lowModel.includes('gpt')) authChoice = 'openai-api-key';
            else if (lowModel.includes('gemini')) authChoice = 'gemini-api-key';
            else if (lowModel.includes('minimax')) authChoice = 'minimax-api';
            else if (lowModel.includes('ollama')) authChoice = 'ollama';
            else if (lowModel.includes('deepseek')) authChoice = 'ollama';
        }
        
        // Final fallback
        if (!authChoice && apiKey) authChoice = 'apiKey';

        // 6. Extract all authorized providers
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
  'minimax-coding-plan-global-token': ['minimax-portal', 'minimax'],
  'minimax-coding-plan-cn-token': ['minimax-portal', 'minimax'],
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
const OAUTH_AUTH_CHOICES = new Set([
  'openai-codex',
  'google-gemini-cli',
  'chutes',
  'qwen-portal',
]);

const sanitizeSecret = (value: string) => String(value || '').replace(/\s+/g, '');

const hasCjkCharacters = (value: string) => /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));

const isLikelyNaturalLanguageSentence = (value: string) => {
  const text = String(value || '').trim();
  if (!text) return false;
  const hasSentencePunctuation = /[。！？：；，、]/.test(text);
  const hasMultipleWords = (text.match(/\s+/g) || []).length >= 2;
  return hasCjkCharacters(text) && (hasSentencePunctuation || hasMultipleWords);
};

const isPlausibleMachineToken = (value: string) => {
  const text = String(value || '').trim();
  if (!text) return false;
  if (text.length < 16) return false;
  if (/\s/.test(text)) return false;
  return /^[\x21-\x7e]+$/.test(text);
};

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

const unwrapCliArg = (rawValue: string) => {
  const value = String(rawValue || '').trim();
  if (!value) return '';

  if (value.startsWith("'") && value.endsWith("'")) {
    const inner = value.slice(1, -1);
    return inner.replace(/'\\''/g, "'");
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    const inner = value.slice(1, -1);
    return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  return value;
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

  const normalizeProfileMeta = (profileId: string, profile: any) => {
    const provider = String((profile as any)?.provider || String(profileId).split(':')[0] || '').toLowerCase();
    const mode = String((profile as any)?.mode || (profile as any)?.type || '').toLowerCase();
    return { provider, mode };
  };

  const findFallbackGlobalKey = (provider: string, mode: string) => {
    if (!provider) return '';
    for (const [key, entry] of merged.entries()) {
      const entryProvider = String(entry?.provider || '').toLowerCase();
      const entryMode = String(entry?.mode || '').toLowerCase();
      if (!entry?.globalPresent || entry?.agentPresent) continue;
      if (!entryProvider || entryProvider !== provider) continue;
      if (mode && entryMode && entryMode !== mode) continue;
      return key;
    }
    return '';
  };

  for (const [profileId, profile] of Object.entries(globalProfiles)) {
    const meta = normalizeProfileMeta(String(profileId), profile);
    merged.set(String(profileId), {
      profileId: String(profileId),
      provider: meta.provider,
      mode: meta.mode,
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
      const meta = normalizeProfileMeta(profileKey, profile);
      const resolvedKey = merged.has(profileKey) ? profileKey : findFallbackGlobalKey(meta.provider, meta.mode);
      const entry = merged.get(resolvedKey || profileKey) || {
        profileId: profileKey,
        provider: meta.provider,
        mode: meta.mode,
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
        entry.mode = meta.mode;
      }
      if (!entry.provider) {
        entry.provider = meta.provider;
      }
      merged.set(resolvedKey || profileKey, entry);
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

/**
 * Recursively copy directory (exclude .git, node_modules)
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
 * Parse YAML Frontmatter from SKILL.md (simple regex matching)
 */
async function parseSkillMetadata(skillDir: string, fallbackId: string) {
    const defaultMeta = { id: fallbackId, name: fallbackId, desc: '工作區擴充技能', category: 'Plugin', details: '無詳細說明' };
    try {
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        const content = await fs.readFile(skillMdPath, 'utf-8');
        // Try to match yaml sections between ---
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (match && match[1]) {
            const yamlStr = match[1];
            // Simple parsing of name/description (does not rely on yaml parser)
            const nameMatch = yamlStr.match(/name:\s*(.+)/i);
            const descMatch = yamlStr.match(/description:\s*(.+)/i) || yamlStr.match(/desc:\s*(.+)/i);
            
            if (nameMatch) defaultMeta.name = nameMatch[1].replace(/['"]/g, '').trim();
            if (descMatch) defaultMeta.desc = descMatch[1].replace(/['"]/g, '').trim();
        }
    } catch (e) {
        // If SKILL.md doesn't exist or reading fails, return default values
    }
    return defaultMeta;
}

/**
 * Scan skill subfolders in the specified directory (skills/ or extensions/ are both allowed)
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
 * Scan installed skills in multiple base paths (including skills in skills/ and extensions/)
 */
async function scanInstalledSkills(...basePaths: string[]): Promise<any[]> {
    const allIds = new Set<string>();
    const allSkills: any[] = [];

    for (const basePath of basePaths) {
        if (!basePath) continue;
        // Scan skills/ subdirectory
        const fromSkills = await scanSkillsInDir(path.join(basePath, 'skills'));
        // Scan extensions/ subdirectory (OpenClaw extensions)
        const extDir = path.join(basePath, 'extensions');
        const fromExtensions: any[] = [];
        try {
            const extItems = await fs.readdir(extDir);
            for (const extPkg of extItems) {
                if (extPkg.startsWith('.')) continue;
                const pkgPath = path.join(extDir, extPkg);
                // extensions might be skills directly, or packages containing skills/
                const nestedSkills = await scanSkillsInDir(path.join(pkgPath, 'skills'));
                if (nestedSkills.length > 0) {
                    fromExtensions.push(...nestedSkills);
                } else {
                    // Try reading directly as a skill (e.g. extensions/lobster/SKILL.md)
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

function uniqueNonEmptyPaths(paths: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const p = String(raw || '').trim();
    if (!p) continue;
    const normalized = path.resolve(p);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

type ControlTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
type ControlProjectStatus = 'active' | 'paused' | 'done';
type ControlQueueSeverity = 'info' | 'warn' | 'critical';
type ControlApprovalStatus = 'pending' | 'approved' | 'rejected';

interface ControlTaskItem {
  id: string;
  title: string;
  status: ControlTaskStatus;
  projectId: string;
  owner: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

interface ControlProjectItem {
  id: string;
  name: string;
  status: ControlProjectStatus;
  createdAt: string;
  updatedAt: string;
}

interface ControlQueueItem {
  id: string;
  title: string;
  detail: string;
  severity: ControlQueueSeverity;
  status: 'pending' | 'acked';
  createdAt: string;
  ackedAt?: string;
}

interface ControlAuditItem {
  id: string;
  action: string;
  targetId: string;
  ok: boolean;
  message: string;
  createdAt: string;
}

interface ControlApprovalItem {
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

interface ControlBudgetPolicy {
  dailyUsdLimit: number;
  warnRatio: number;
}

interface ControlCenterState {
  tasks: ControlTaskItem[];
  projects: ControlProjectItem[];
  queue: ControlQueueItem[];
  audit: ControlAuditItem[];
  approvals: ControlApprovalItem[];
  budgetPolicy: ControlBudgetPolicy;
  controlToken: string;
}

const CONTROL_CENTER_STATE_FILE = () => path.join(app.getPath('userData'), 'control-center-state.json');

const defaultControlCenterState = (): ControlCenterState => ({
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

const nowIso = () => new Date().toISOString();
const buildId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ── Activity Observation Engine ───────────────────────────────────────────────
// Passively observes all agent artifacts without modifying agents.
// Collectors: FileSystem Watcher + JSONL Scanner + Cron State Scanner
// Inference: raw events → semantic ActivityEvent with human-readable title

interface ActivityEvent {
  id: string;
  timestamp: number;        // epoch ms
  source: 'fs' | 'jsonl' | 'cron' | 'system';
  type:
    | 'skill_created' | 'skill_updated' | 'skill_deleted'
    | 'config_changed' | 'task_updated' | 'script_executed'
    | 'agent_action' | 'file_change'
    | 'scheduled_run' | 'service_state';
  category: 'development' | 'execution' | 'scheduled' | 'task' | 'config' | 'alert' | 'system';
  title: string;
  detail?: string;
  path?: string;
  agent?: string;
  exitCode?: number;
}

const ACTIVITY_STORE_FILE = path.join(PERSISTENT_CONFIG_DIR, 'activity-store.json');
const ACTIVITY_MAX = 500;

// In-memory ring buffer — flushed to disk async
let activityBuffer: ActivityEvent[] = [];
let activityFlushPending = false;

async function loadActivityStore(): Promise<void> {
  try {
    const raw = await fs.readFile(ACTIVITY_STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) activityBuffer = parsed.slice(-ACTIVITY_MAX);
  } catch { activityBuffer = []; }
}

async function flushActivityStore(): Promise<void> {
  if (activityFlushPending) return;
  activityFlushPending = true;
  try {
    await fs.writeFile(ACTIVITY_STORE_FILE, JSON.stringify(activityBuffer.slice(-ACTIVITY_MAX)), 'utf-8');
  } catch { /* non-fatal */ }
  finally { activityFlushPending = false; }
}

function pushActivity(event: Omit<ActivityEvent, 'id'>): ActivityEvent {
  const full: ActivityEvent = { id: buildId('act'), ...event };
  // Deduplicate: skip if exact same title+timestamp already exists (avoid double-scan)
  const isDuplicate = activityBuffer.some(
    e => e.title === full.title && e.timestamp === full.timestamp
  );
  if (isDuplicate) return full;
  activityBuffer.push(full);
  if (activityBuffer.length > ACTIVITY_MAX) activityBuffer = activityBuffer.slice(-ACTIVITY_MAX);
  void flushActivityStore();
  return full;
}

// ── Inference Engine ──────────────────────────────────────────────────────────
// Map raw path/event → semantic type + title

function inferFsEvent(
  watchEvent: 'rename' | 'change',
  filePath: string,
  existed: boolean,
): Omit<ActivityEvent, 'id' | 'timestamp'> | null {
  const base = path.basename(filePath);
  const parts = filePath.split(path.sep);

  // Detect if path contains a 'skills' segment followed by a skill name
  const skillsIdx = parts.lastIndexOf('skills');
  const isInSkills = skillsIdx >= 0 && parts.length > skillsIdx + 1;
  const skillName = isInSkills ? parts[skillsIdx + 1] : null;

  // Detect if path contains a 'config' segment
  const isInConfig = parts.includes('config') && !isInSkills;

  if (base === 'SKILL.md' && isInSkills) {
    const type = (watchEvent === 'rename' && !existed) ? 'skill_created' : 'skill_updated';
    return { source: 'fs', type, category: 'development',
      title: `${type === 'skill_created' ? '新技能建立' : '技能更新'}：${skillName}`,
      detail: filePath, path: filePath };
  }
  if ((base.endsWith('.py') || base.endsWith('.ts') || base.endsWith('.js')) && isInSkills) {
    return { source: 'fs', type: 'skill_updated', category: 'development',
      title: `技能程式碼${watchEvent === 'rename' ? '新增' : '修改'}：${skillName}/${base}`,
      detail: filePath, path: filePath };
  }
  if (isInConfig && (base.endsWith('.json') || base.endsWith('.yaml') || base.endsWith('.toml'))) {
    return { source: 'fs', type: 'config_changed', category: 'config',
      title: `設定檔變更：${base}`, detail: filePath, path: filePath };
  }
  if (base === 'tasks.json') {
    return { source: 'fs', type: 'task_updated', category: 'task',
      title: '任務清單更新', detail: filePath, path: filePath };
  }
  if (base.endsWith('.py') && !isInSkills) {
    return { source: 'fs', type: 'script_executed', category: 'execution',
      title: `腳本${watchEvent === 'rename' ? '建立' : '修改'}：${base}`,
      detail: filePath, path: filePath };
  }
  const ext = path.extname(base);
  if (!base.startsWith('.') && ['.md', '.txt', '.json', '.yaml', '.toml', '.sh'].includes(ext)) {
    return { source: 'fs', type: 'file_change', category: 'system',
      title: `檔案${watchEvent === 'rename' ? '建立/刪除' : '修改'}：${path.basename(path.dirname(filePath))}/${base}`,
      detail: filePath, path: filePath };
  }
  return null;
}

// ── FileSystem Watcher ────────────────────────────────────────────────────────
const HOME = process.env['HOME'] || '';

// Read launcher config to derive dynamic paths (corePath, workspacePath, stateDir)
async function readLauncherConfigPaths(): Promise<{
  corePath: string; workspacePath: string; configPath: string; stateDir: string;
}> {
  const fallback = {
    corePath: '', workspacePath: '', configPath: '',
    stateDir: process.env['OPENCLAW_STATE_DIR'] || path.join(HOME, '.openclaw'),
  };
  try {
    const raw = await fs.readFile(path.join(CONFIG_DIR, 'config.json'), 'utf-8');
    const cfg = JSON.parse(raw);
    return {
      corePath:      String(cfg.corePath      || '').trim(),
      workspacePath: String(cfg.workspacePath || '').trim(),
      configPath:    String(cfg.configPath    || '').trim(),
      stateDir:      String(cfg.stateDir      || process.env['OPENCLAW_STATE_DIR'] || path.join(HOME, '.openclaw')).trim(),
    };
  } catch { return fallback; }
}

// Build watch dir list from config — no hardcoded paths
async function buildWatchDirs(): Promise<string[]> {
  const { corePath, workspacePath, stateDir } = await readLauncherConfigPaths();
  const dirs: string[] = [];
  if (corePath) {
    dirs.push(path.join(corePath, 'skills'));
    dirs.push(path.join(corePath, 'config'));
    dirs.push(corePath);
  }
  if (workspacePath) dirs.push(workspacePath);
  if (stateDir)      dirs.push(path.join(stateDir, 'agents'));
  // Remove duplicates and missing dirs
  return [...new Set(dirs)];
}

const activeWatchers: ReturnType<typeof fsWatch>[] = [];

async function startActivityWatcher(extraDirs: string[] = []): Promise<void> {
  // Stop existing watchers first
  for (const w of activeWatchers) { try { w.close(); } catch {} }
  activeWatchers.length = 0;

  const configDirs = await buildWatchDirs();
  const dirsToWatch = [...new Set([...configDirs, ...extraDirs])];

  for (const dir of dirsToWatch) {
    if (!existsSync(dir)) continue;
    try {
      const watcher = fsWatch(dir, { recursive: true }, (watchEvent, filename) => {
        if (!filename) return;
        const fullPath = path.join(dir, String(filename));
        const base = path.basename(fullPath);
        if (base.startsWith('.') || fullPath.endsWith('~') || fullPath.endsWith('.lock')) return;
        const existed = existsSync(fullPath);
        const inferred = inferFsEvent(watchEvent as 'rename' | 'change', fullPath, existed);
        if (inferred) pushActivity({ ...inferred, timestamp: Date.now() });
      });
      activeWatchers.push(watcher);
    } catch { /* dir not watchable */ }
  }
}

// ── JSONL Session Scanner ─────────────────────────────────────────────────────
// Tracks last-seen byte offset per session file to avoid re-reading old lines.
const jsonlOffsets: Map<string, number> = new Map();

async function scanJsonlFile(filePath: string): Promise<void> {
  try {
    const fh = await fs.open(filePath, 'r');
    const stat = await fh.stat();
    const offset = jsonlOffsets.get(filePath) ?? 0;
    if (stat.size <= offset) { await fh.close(); return; }
    const len = stat.size - offset;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, offset);
    await fh.close();
    jsonlOffsets.set(filePath, stat.size);
    const lines = buf.toString('utf-8').split('\n').filter(Boolean);
    const agentMatch = filePath.match(/agents\/([^/]+)\/sessions\//);
    const agentId = agentMatch ? agentMatch[1] : 'unknown';

    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        if (evt?.type !== 'message') continue;
        const ts = evt.timestamp ? new Date(evt.timestamp).getTime() : Date.now();
        const msg = evt.message || {};
        const role = msg.role || '';
        const contentArr: any[] = Array.isArray(msg.content) ? msg.content : [];

        // Extract toolCall entries from assistant messages
        if (role === 'assistant') {
          for (const c of contentArr) {
            if (!c || c.type !== 'toolCall') continue;
            const toolName = String(c.name || '');
            const args = c.arguments || {};

            if (toolName === 'exec') {
              const cmd = String(args.command || '').trim().slice(0, 100);
              if (!cmd) continue;
              pushActivity({
                timestamp: ts, source: 'jsonl', type: 'script_executed', category: 'execution',
                title: `執行指令 [${agentId}]：${cmd}`,
                detail: cmd, agent: agentId,
              });
            } else if (toolName === 'write') {
              const fp = String(args.path || '');
              const base = path.basename(fp);
              if (!fp) continue;
              const fpParts = fp.split(path.sep);
              const isSkill = fpParts.includes('skills');
              const isConfig = fpParts.includes('config') && !isSkill;
              pushActivity({
                timestamp: ts, source: 'jsonl',
                type: isSkill ? 'skill_created' : 'file_change',
                category: isSkill ? 'development' : isConfig ? 'config' : 'execution',
                title: isSkill
                  ? `Agent 建立技能檔案 [${agentId}]：${base}`
                  : `Agent 寫入檔案 [${agentId}]：${base}`,
                detail: fp, agent: agentId, path: fp,
              });
            } else if (toolName === 'edit') {
              const fp = String(args.path || '');
              const base = path.basename(fp);
              if (!fp) continue;
              const fpParts = fp.split(path.sep);
              const isSkill = fpParts.includes('skills');
              pushActivity({
                timestamp: ts, source: 'jsonl',
                type: isSkill ? 'skill_updated' : 'file_change',
                category: isSkill ? 'development' : 'execution',
                title: isSkill
                  ? `Agent 修改技能 [${agentId}]：${base}`
                  : `Agent 編輯檔案 [${agentId}]：${base}`,
                detail: fp, agent: agentId, path: fp,
              });
            } else if (toolName === 'web_fetch' || toolName === 'web_search') {
              const query = String(args.url || args.query || '').slice(0, 80);
              pushActivity({
                timestamp: ts, source: 'jsonl', type: 'agent_action', category: 'execution',
                title: `網路${toolName === 'web_search' ? '搜尋' : '抓取'} [${agentId}]：${query}`,
                detail: query, agent: agentId,
              });
            }
          }
        }
      } catch { /* malformed line */ }
    }
  } catch { /* file not readable */ }
}

async function scanAllSessions(stateDir?: string): Promise<void> {
  const resolved = stateDir || (await readLauncherConfigPaths()).stateDir;
  const base = resolved || path.join(HOME, '.openclaw');
  const agentsDir = path.join(base, 'agents');
  try {
    const agents = await fs.readdir(agentsDir);
    for (const agent of agents) {
      const sessionsDir = path.join(agentsDir, agent, 'sessions');
      try {
        const files = await fs.readdir(sessionsDir);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).map(f => path.join(sessionsDir, f));
        // Only scan last 10 files (most recent)
        const recent = jsonlFiles.sort().slice(-10);
        for (const f of recent) { await scanJsonlFile(f); }
      } catch { /* no sessions dir */ }
    }
  } catch { /* no agents dir */ }
}

// ── Cron State Scanner ────────────────────────────────────────────────────────
// Reads OpenClaw jobs.json and generates events from lastRunAtMs changes.
const cronLastSeen: Map<string, number> = new Map();

async function scanCronJobs(stateDir?: string): Promise<void> {
  const resolved = stateDir || (await readLauncherConfigPaths()).stateDir;
  const base = resolved || path.join(HOME, '.openclaw');
  const cronPath = path.join(base, 'cron', 'jobs.json');
  try {
    const raw = await fs.readFile(cronPath, 'utf-8');
    const data = JSON.parse(raw);
    for (const job of (data.jobs || [])) {
      const lastRun = job.state?.lastRunAtMs;
      if (!lastRun) continue;
      const prev = cronLastSeen.get(job.id);
      if (prev === lastRun) continue;
      cronLastSeen.set(job.id, lastRun);
      if (prev !== undefined) {
        // New run detected
        const isOk = job.state?.lastStatus === 'ok';
        pushActivity({
          timestamp: lastRun,
          source: 'cron', type: 'scheduled_run',
          category: isOk ? 'scheduled' : 'alert',
          title: `排程${isOk ? '執行成功' : '執行失敗'}：${job.name}`,
          detail: job.state?.lastError,
          agent: job.agentId,
          exitCode: isOk ? 0 : 1,
        });
      }
    }
  } catch { /* no jobs.json */ }
}
// ─────────────────────────────────────────────────────────────────────────────

async function readControlCenterState(): Promise<ControlCenterState> {
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
        dailyUsdLimit: Number.isFinite(Number((parsed as any)?.budgetPolicy?.dailyUsdLimit))
          ? Math.max(1, Number((parsed as any).budgetPolicy.dailyUsdLimit))
          : 20,
        warnRatio: Number.isFinite(Number((parsed as any)?.budgetPolicy?.warnRatio))
          ? Math.max(0.1, Math.min(0.95, Number((parsed as any).budgetPolicy.warnRatio)))
          : 0.8,
      },
      controlToken: String((parsed as any)?.controlToken || '').trim(),
    };
  } catch {
    const initial = defaultControlCenterState();
    await fs.writeFile(filePath, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
}

async function writeControlCenterState(state: ControlCenterState): Promise<void> {
  await fs.writeFile(CONTROL_CENTER_STATE_FILE(), JSON.stringify(state, null, 2), 'utf-8');
}

async function appendControlAudit(
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

function buildControlOverview(state: ControlCenterState) {
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

function buildControlBudgetStatus(state: ControlCenterState) {
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

function isControlMutationCommand(fullCommand: string): boolean {
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

function parseControlPayload(fullCommand: string): any {
  const spaceIdx = fullCommand.indexOf(' ');
  if (spaceIdx < 0) return {};
  const raw = fullCommand.slice(spaceIdx + 1).trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function enforceControlMutationTokenGate(fullCommand: string): Promise<{ ok: boolean; message?: string }> {
  if (!isControlMutationCommand(fullCommand)) {
    return { ok: true };
  }
  const state = await readControlCenterState();
  const requiredToken = String(state.controlToken || '').trim();
  if (!requiredToken) {
    return { ok: true };
  }

  let payload: any = {};
  try {
    payload = parseControlPayload(fullCommand);
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

function pushQueueIfMissing(state: ControlCenterState, item: Omit<ControlQueueItem, 'id' | 'createdAt' | 'status'> & { sourceKey?: string }) {
  const sourceKey = String((item as any).sourceKey || '').trim();
  if (sourceKey) {
    const exists = state.queue.some((entry) => (entry as any).sourceKey === sourceKey && entry.status === 'pending');
    if (exists) return state;
  }
  const nextItem: ControlQueueItem = {
    id: buildId('queue'),
    title: item.title,
    detail: item.detail,
    severity: item.severity,
    status: 'pending',
    createdAt: nowIso(),
    ...(sourceKey ? { sourceKey } as any : {}),
  };
  return { ...state, queue: [nextItem, ...state.queue] };
}

function pushApprovalIfMissing(state: ControlCenterState, item: Omit<ControlApprovalItem, 'id' | 'createdAt' | 'updatedAt' | 'status'>) {
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

async function runControlAutoSync(): Promise<{ queueCreated: number; approvalsCreated: number }> {
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


app.whenReady().then(() => {
  createWindow().catch((err) => {
    console.error('Failed to create window:', err);
  });

  // Boot Activity Observation Engine
  void loadActivityStore().then(async () => {
    await startActivityWatcher();
    void scanAllSessions();
    void scanCronJobs();
    setInterval(() => {
      void scanAllSessions();
      void scanCronJobs();
    }, 60000);
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

ipcMain.handle('window:set-title', (_event, title: string) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(String(title || ''));
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

  if (fullCommand === 'app:check-update') {
    try {
      const current = app.getVersion();
      const releases = await new Promise<any[]>((resolve, reject) => {
        const req = https.get(
          'https://api.github.com/repos/nt-nerdtechnic/ClawLaunch/releases?per_page=1',
          { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'NT-ClawLaunch' } },
          (res) => {
            if ((res.statusCode ?? 0) >= 400) {
              reject(new Error(`GitHub API returned ${res.statusCode}`));
              return;
            }
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON response')); }
            });
          },
        );
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
      });
      if (!releases.length) {
        return { code: 0, stdout: JSON.stringify({ current, latest: '', htmlUrl: '', upToDate: true, noReleases: true }), stderr: '', exitCode: 0 };
      }
      const latest = String(releases[0].tag_name || '').replace(/^v/, '');
      const htmlUrl = String(releases[0].html_url || '');
      const isNewer = !!latest && latest !== current;
      return { code: 0, stdout: JSON.stringify({ current, latest, htmlUrl, upToDate: !isNewer }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'update check failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:auth:status') {
    try {
      const state = await readControlCenterState();
      return {
        code: 0,
        stdout: JSON.stringify({ tokenRequired: !!String(state.controlToken || '').trim() }),
        stderr: '',
        exitCode: 0,
      };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'control auth status failed', exitCode: 1 };
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
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'set control token failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:auto-sync') {
    try {
      const result = await runControlAutoSync();
      return { code: 0, stdout: JSON.stringify(result), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'control auto sync failed', exitCode: 1 };
    }
  }

  const gate = await enforceControlMutationTokenGate(fullCommand);
  if (!gate.ok) {
    return { code: 1, stdout: '', stderr: gate.message || 'control mutation blocked by token gate', exitCode: 1 };
  }

  if (fullCommand === 'control:overview') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify(buildControlOverview(state)), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'control overview failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:budget:get') {
    try {
      const state = await readControlCenterState();
      return {
        code: 0,
        stdout: JSON.stringify({ policy: state.budgetPolicy, snapshot: buildControlBudgetStatus(state) }),
        stderr: '',
        exitCode: 0,
      };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'get budget failed', exitCode: 1 };
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
      const next: ControlCenterState = {
        ...state,
        budgetPolicy: {
          dailyUsdLimit: Number(dailyUsdLimit.toFixed(2)),
          warnRatio: Number(warnRatio.toFixed(3)),
        },
      };
      const audited = await appendControlAudit(next, 'budget.setPolicy', 'budget-policy', true, `limit=${dailyUsdLimit}, warn=${warnRatio}`);
      return { code: 0, stdout: JSON.stringify({ policy: audited.budgetPolicy, snapshot: buildControlBudgetStatus(audited) }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'set budget policy failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:approvals:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.approvals }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'list approvals failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:approvals:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:approvals:add ', '').trim() || '{}');
      const title = String(payload?.title || '').trim();
      if (!title) {
        return { code: 1, stdout: '', stderr: 'approval title is required', exitCode: 1 };
      }
      const now = nowIso();
      const item: ControlApprovalItem = {
        id: buildId('approval'),
        title,
        detail: String(payload?.detail || '').trim(),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      const state = await readControlCenterState();
      const next: ControlCenterState = { ...state, approvals: [item, ...state.approvals] };
      const audited = await appendControlAudit(next, 'approval.add', item.id, true, `approval created: ${item.title}`);
      return { code: 0, stdout: JSON.stringify({ item, total: audited.approvals.length }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'add approval failed', exitCode: 1 };
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
      if (!target) {
        return { code: 1, stdout: '', stderr: 'approval not found', exitCode: 1 };
      }

      if (dryRun) {
        const audited = await appendControlAudit(state, 'approval.decide.dryRun', approvalId, true, `dry-run ${decision}`);
        return { code: 0, stdout: JSON.stringify({ dryRun: true, item: target, auditSize: audited.audit.length }), stderr: '', exitCode: 0 };
      }

      const now = nowIso();
      const approvals = state.approvals.map((item) => {
        if (item.id !== approvalId) return item;
        return {
          ...item,
          status: decision as ControlApprovalStatus,
          decisionReason: reason,
          updatedAt: now,
          decidedAt: now,
        };
      });
      const next: ControlCenterState = { ...state, approvals };
      const audited = await appendControlAudit(next, 'approval.decide.live', approvalId, true, `live ${decision}`);
      return { code: 0, stdout: JSON.stringify({ dryRun: false, items: audited.approvals }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'decide approval failed', exitCode: 1 };
    }
  }

  // ── NT_SKILL tasks.json helpers ──────────────────────────────────────────
  // Path derived from saved workspacePath in config — no hardcoded paths
  const getNTTasksFile = async (): Promise<string> => {
    const { workspacePath } = await readLauncherConfigPaths();
    if (workspacePath) return path.join(workspacePath, 'tasks.json');
    // No config found — return a non-existent path so reads return [] gracefully
    return path.join(PERSISTENT_CONFIG_DIR, 'tasks-fallback.json');
  };
  const readNTTasks = async (): Promise<any[]> => {
    try {
      const file = await getNTTasksFile();
      const raw = await fs.readFile(file, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };
  const writeNTTasks = async (tasks: any[]): Promise<void> => {
    const file = await getNTTasksFile();
    await fs.writeFile(file, JSON.stringify(tasks, null, 2), 'utf-8');
  };
  // ─────────────────────────────────────────────────────────────────────────

  if (fullCommand === 'control:tasks:list') {
    try {
      const items = await readNTTasks();
      return { code: 0, stdout: JSON.stringify({ items }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'list tasks failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:tasks:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:tasks:add ', '').trim() || '{}');
      const title = String(payload?.title || '').trim();
      if (!title) {
        return { code: 1, stdout: '', stderr: 'task title is required', exitCode: 1 };
      }
      const now = nowIso();
      const task = {
        id: Math.random().toString(36).slice(2, 10),
        title,
        status: ['todo', 'in_progress', 'blocked', 'done'].includes(String(payload?.status || ''))
          ? payload.status : 'todo',
        priority: String(payload?.priority || 'medium'),
        components: [
          { key: 'initial_purpose', label: '最初目的', content: '', weight: 0.2, progress: 0.0 },
          { key: 'final_goal',      label: '最終目標', content: '', weight: 0.3, progress: 0.0 },
          { key: 'description',     label: '描述',     content: String(payload?.description || ''), weight: 0.5, progress: 0.0 },
        ],
        overall_progress: 0.0,
        created_at: now,
        updated_at: now,
        owner: String(payload?.owner || ''),
        tags: [],
        metadata: {},
      };
      const tasks = await readNTTasks();
      tasks.unshift(task);
      await writeNTTasks(tasks);
      return { code: 0, stdout: JSON.stringify({ item: task, total: tasks.length }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'add task failed', exitCode: 1 };
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
      const tasks = await readNTTasks();
      let found = false;
      const updated = tasks.map((t: any) => {
        if (t.id !== taskId) return t;
        found = true;
        const next = { ...t, status, updated_at: nowIso() };
        if (status === 'done') {
          next.overall_progress = 100.0;
          next.components = (t.components || []).map((c: any) => ({ ...c, progress: 1.0 }));
        }
        return next;
      });
      if (!found) return { code: 1, stdout: '', stderr: 'task not found', exitCode: 1 };
      await writeNTTasks(updated);
      return { code: 0, stdout: JSON.stringify({ items: updated }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'update task status failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:tasks:delete ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:tasks:delete ', '').trim() || '{}');
      const taskId = String(payload?.taskId || '').trim();
      if (!taskId) return { code: 1, stdout: '', stderr: 'taskId is required', exitCode: 1 };
      const tasks = await readNTTasks();
      await writeNTTasks(tasks.filter((t: any) => t.id !== taskId));
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'delete task failed', exitCode: 1 };
    }
  }

  // ── Silently execute shell commands (no renderer log) ────────────────────────────
  const runSilent = (cmd: string): Promise<{ stdout: string; stderr: string; code: number }> =>
    new Promise((resolve) => {
      const child = spawn(cmd, { shell: true });
      let stdout = '', stderr = '';
      child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', (code: number | null) => resolve({ stdout, stderr, code: code ?? 1 }));
      child.on('error', () => resolve({ stdout, stderr, code: 1 }));
    });

  if (fullCommand === 'system:crontab:list') {
    try {
      const res = await runSilent('crontab -l');
      const lines = res.stdout.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      const entries = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        const schedule = parts.slice(0, 5).join(' ');
        const command = parts.slice(5).join(' ');
        const name = command.split('/').pop()?.replace(/\.sh$/, '') || command.slice(0, 40);
        return { schedule, command, name, raw: line.trim() };
      });
      return { code: 0, stdout: JSON.stringify({ entries }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 0, stdout: JSON.stringify({ entries: [] }), stderr: '', exitCode: 0 };
    }
  }

  if (fullCommand === 'system:launchagents:list') {
    try {
      const home = process.env['HOME'] || '';
      const knownAgents = [
        { label: 'ai.openclaw.gateway',  plist: path.join(home, 'Library/LaunchAgents/ai.openclaw.gateway.plist'),  name: 'OpenClaw Gateway' },
        { label: 'ai.openclaw.watchdog', plist: path.join(home, 'Library/LaunchAgents/ai.openclaw.watchdog.plist'), name: 'OpenClaw Watchdog' },
      ];
      const launchctlRes = await runSilent('launchctl list');
      const listOutput = launchctlRes.stdout;

      const agents = await Promise.all(knownAgents.map(async (agent) => {
        // Whether plist exists
        let plistExists = false;
        let keepAlive = false;
        let comment = '';
        try {
          const raw = await fs.readFile(agent.plist, 'utf-8');
          plistExists = true;
          keepAlive = raw.includes('<key>KeepAlive</key>');
          const commentMatch = raw.match(/<key>Comment<\/key>\s*<string>([^<]+)<\/string>/);
          if (commentMatch) comment = commentMatch[1];
        } catch { /* plist missing */ }

        // launchctl status
        const line = listOutput.split('\n').find(l => l.includes(agent.label));
        let running = false;
        let pid: number | null = null;
        let exitCode: number | null = null;
        if (line) {
          const parts = line.trim().split(/\s+/);
          pid = parts[0] && parts[0] !== '-' ? parseInt(parts[0]) : null;
          exitCode = parts[1] ? parseInt(parts[1]) : null;
          running = pid !== null && !isNaN(pid);
        }

        return { label: agent.label, name: agent.name, plistExists, keepAlive, comment, loaded: !!line, running, pid, exitCode };
      }));

      return { code: 0, stdout: JSON.stringify({ agents }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'launchagents list failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'cron:list') {
    try {
      const payload = JSON.parse(fullCommand.replace('cron:list', '').trim() || '{}');
      const stateDir = String(payload?.stateDir || process.env['OPENCLAW_STATE_DIR'] || path.join(process.env['HOME'] || '', '.openclaw')).trim();
      const cronPath = path.join(stateDir, 'cron', 'jobs.json');
      try {
        const raw = await fs.readFile(cronPath, 'utf-8');
        return { code: 0, stdout: raw, stderr: '', exitCode: 0 };
      } catch {
        return { code: 0, stdout: JSON.stringify({ version: 1, jobs: [] }), stderr: '', exitCode: 0 };
      }
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'cron list failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('cron:list ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('cron:list ', '').trim() || '{}');
      const stateDir = String(payload?.stateDir || process.env['OPENCLAW_STATE_DIR'] || path.join(process.env['HOME'] || '', '.openclaw')).trim();
      const cronPath = path.join(stateDir, 'cron', 'jobs.json');
      try {
        const raw = await fs.readFile(cronPath, 'utf-8');
        return { code: 0, stdout: raw, stderr: '', exitCode: 0 };
      } catch {
        return { code: 0, stdout: JSON.stringify({ version: 1, jobs: [] }), stderr: '', exitCode: 0 };
      }
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'cron list failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('cron:toggle ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('cron:toggle ', '').trim() || '{}');
      const jobId = String(payload?.jobId || '').trim();
      const stateDir = String(payload?.stateDir || process.env['OPENCLAW_STATE_DIR'] || path.join(process.env['HOME'] || '', '.openclaw')).trim();
      if (!jobId) return { code: 1, stdout: '', stderr: 'jobId is required', exitCode: 1 };
      const cronPath = path.join(stateDir, 'cron', 'jobs.json');
      const raw = await fs.readFile(cronPath, 'utf-8');
      const data = JSON.parse(raw);
      let toggled = false;
      data.jobs = (data.jobs || []).map((job: any) => {
        if (job.id === jobId) { toggled = true; return { ...job, enabled: !job.enabled, updatedAtMs: Date.now() }; }
        return job;
      });
      if (!toggled) return { code: 1, stdout: '', stderr: `job ${jobId} not found`, exitCode: 1 };
      await fs.writeFile(cronPath, JSON.stringify(data, null, 2), 'utf-8');
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'cron toggle failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('cron:delete ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('cron:delete ', '').trim() || '{}');
      const jobId = String(payload?.jobId || '').trim();
      const stateDir = String(payload?.stateDir || process.env['OPENCLAW_STATE_DIR'] || path.join(process.env['HOME'] || '', '.openclaw')).trim();
      if (!jobId) return { code: 1, stdout: '', stderr: 'jobId is required', exitCode: 1 };
      const cronPath = path.join(stateDir, 'cron', 'jobs.json');
      const raw = await fs.readFile(cronPath, 'utf-8');
      const data = JSON.parse(raw);
      const before = (data.jobs || []).length;
      data.jobs = (data.jobs || []).filter((job: any) => job.id !== jobId);
      if (data.jobs.length === before) return { code: 1, stdout: '', stderr: `job ${jobId} not found`, exitCode: 1 };
      await fs.writeFile(cronPath, JSON.stringify(data, null, 2), 'utf-8');
      return { code: 0, stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'cron delete failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:projects:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.projects }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'list projects failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:projects:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:projects:add ', '').trim() || '{}');
      const name = String(payload?.name || '').trim();
      if (!name) {
        return { code: 1, stdout: '', stderr: 'project name is required', exitCode: 1 };
      }
      const now = nowIso();
      const project: ControlProjectItem = {
        id: buildId('project'),
        name,
        status: ['active', 'paused', 'done'].includes(String(payload?.status || '')) ? payload.status : 'active',
        createdAt: now,
        updatedAt: now,
      };
      const state = await readControlCenterState();
      const next = { ...state, projects: [project, ...state.projects] };
      const audited = await appendControlAudit(next, 'project.add', project.id, true, `project created: ${project.name}`);
      return { code: 0, stdout: JSON.stringify({ item: project, total: audited.projects.length }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'add project failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:queue:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.queue }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'list queue failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:queue:add ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:queue:add ', '').trim() || '{}');
      const title = String(payload?.title || '').trim();
      if (!title) {
        return { code: 1, stdout: '', stderr: 'queue title is required', exitCode: 1 };
      }
      const queueItem: ControlQueueItem = {
        id: buildId('queue'),
        title,
        detail: String(payload?.detail || '').trim(),
        severity: ['info', 'warn', 'critical'].includes(String(payload?.severity || '')) ? payload.severity : 'warn',
        status: 'pending',
        createdAt: nowIso(),
      };
      const state = await readControlCenterState();
      const next = { ...state, queue: [queueItem, ...state.queue] };
      const audited = await appendControlAudit(next, 'queue.add', queueItem.id, true, `queue item created: ${queueItem.title}`);
      return { code: 0, stdout: JSON.stringify({ item: queueItem, total: audited.queue.length }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'add queue failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('control:queue:ack ')) {
    try {
      const payload = JSON.parse(fullCommand.replace('control:queue:ack ', '').trim() || '{}');
      const itemId = String(payload?.itemId || '').trim();
      if (!itemId) {
        return { code: 1, stdout: '', stderr: 'itemId is required', exitCode: 1 };
      }
      const state = await readControlCenterState();
      let found = false;
      const queue = state.queue.map((item) => {
        if (item.id !== itemId) return item;
        found = true;
        return { ...item, status: 'acked' as const, ackedAt: nowIso() };
      });
      if (!found) {
        return { code: 1, stdout: '', stderr: 'queue item not found', exitCode: 1 };
      }
      const next = { ...state, queue };
      const audited = await appendControlAudit(next, 'queue.ack', itemId, true, 'queue item acknowledged');
      return { code: 0, stdout: JSON.stringify({ items: audited.queue }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'ack queue failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'control:audit:list') {
    try {
      const state = await readControlCenterState();
      return { code: 0, stdout: JSON.stringify({ items: state.audit }), stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e?.message || 'list audit failed', exitCode: 1 };
    }
  }

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

  if (fullCommand === 'gateway:watchdogs-stop') {
    stopGatewayWatchdog('manual stop command');
    stopGatewayHttpWatchdog('manual stop command');
    return { code: 0, stdout: 'gateway watchdogs stopped', exitCode: 0 };
  }

  // gateway:start-bg-json { command, autoRestart, maxRestarts?, baseBackoffMs? }
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
      const configFilePath = path.join(CONFIG_DIR, 'config.json');
      await fs.writeFile(configFilePath, JSON.stringify(config, null, 2));
      if (config?.configPath) {
        activateConfigPath(String(config.configPath)).catch(() => {});
      }
      // Restart file watchers so new corePath/workspacePath are watched
      void startActivityWatcher();
      return { code: 0, stdout: `Config saved to ${configFilePath}`, stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand === 'config:read') {
    try {
      const configFilePath = path.join(CONFIG_DIR, 'config.json');
      const content = await fs.readFile(configFilePath, 'utf-8');
      try {
        const parsed = JSON.parse(content);
        if (parsed?.configPath) {
          activateConfigPath(String(parsed.configPath)).catch(() => {});
        }
      } catch {}
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

        // Fix missing models array in each provider (OpenClaw >=2026.3.x requires this field)
        if (parsed.models && typeof parsed.models.providers === 'object' && parsed.models.providers !== null) {
          for (const [providerKey, providerVal] of Object.entries(parsed.models.providers)) {
            if (providerVal && typeof providerVal === 'object' && !Array.isArray((providerVal as any).models)) {
              (providerVal as any).models = [];
              changed = true;
            }
          }
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
    const launcherConfigPath = path.join(CONFIG_DIR, 'config.json');

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
          // Supplementary scan of agent auth-profiles to fill in meta-only cases in global profiles
          const agentAuth = await collectAuthProfiles(savedConfigPath);
          const healthyAgentProfiles = agentAuth.profiles.filter((p: any) => p.credentialHealthy);
          if (healthyAgentProfiles.length > 0) {
            const agentProviders = healthyAgentProfiles.map((p: any) => String(p.provider || '').toLowerCase()).filter(Boolean);
            existingConfig.providers = Array.from(new Set([...(existingConfig.providers || []), ...agentProviders]));
            if (!existingConfig.authChoice) {
              existingConfig.authChoice = inferAuthChoiceFromProfile(healthyAgentProfiles[0]);
            }
          }
        } catch {
          // Keep saved config path even if openclaw.json is not ready yet.
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
        // Supplementary scan of agent auth-profiles (fallback path also applies)
        const agentAuth = await collectAuthProfiles(possibleWorkspace);
        const healthyAgentProfiles = agentAuth.profiles.filter((p: any) => p.credentialHealthy);
        if (healthyAgentProfiles.length > 0) {
          const agentProviders = healthyAgentProfiles.map((p: any) => String(p.provider || '').toLowerCase()).filter(Boolean);
          existingConfig.providers = Array.from(new Set([...(existingConfig.providers || []), ...agentProviders]));
          if (!existingConfig.authChoice) {
            existingConfig.authChoice = inferAuthChoiceFromProfile(healthyAgentProfiles[0]);
          }
        }
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

    // Core skills = only scan corePath/skills/, ignore extensions/ (avoid provider adapter pollution)
    const coreSkills = corePath ? await scanSkillsInDir(path.join(corePath, 'skills')) : [];
    // Workspace skills = only scan user-configured workspacePath, no fallback paths
    const workspaceSkills = workspacePath ? await scanInstalledSkills(workspacePath) : [];

    return { 
        code: 0, 
        stdout: JSON.stringify({ corePath, configPath, workspacePath: workspacePath || possibleWorkspace, existingConfig: { ...existingConfig, workspaceSkills }, coreSkills }),
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
      
      // Verify if it is a valid skill
      try {
        await fs.access(path.join(sourcePath, 'SKILL.md'));
      } catch (e) {
        return { code: 1, stderr: '錯誤：所選資料夾內缺少 SKILL.md，不是有效的技能。', exitCode: 1 };
      }

      // Get target path
      const configPath = path.join(CONFIG_DIR, 'config.json');
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
      
      // Execute copy (fs.cp supported in Node 16+)
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

      const launcherConfigPath = path.join(CONFIG_DIR, 'config.json');
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
    const probePath = unwrapCliArg(fullCommand.replace('config:probe ', '').trim());
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

            // 補充掃描 agent auth-profiles，填補 global profiles 中只有 meta 而無憑證的情況
            const agentAuth = await collectAuthProfiles(finalConfigDirPath);
            const healthyAgentProfiles = agentAuth.profiles.filter((p: any) => p.credentialHealthy);
            if (healthyAgentProfiles.length > 0) {
              // 合併 providers（包含只在 agent 層的 openai-codex 等）
              const agentProviders = healthyAgentProfiles.map((p: any) => String(p.provider || '').toLowerCase()).filter(Boolean);
              configData.providers = Array.from(new Set([...configData.providers, ...agentProviders]));
              // 若 authChoice 未偵測到，從最優先的健康 agent profile 推斷
              if (!configData.authChoice) {
                const first = healthyAgentProfiles[0];
                configData.authChoice = inferAuthChoiceFromProfile(first);
              }
            }

            // Core skills = 只掃 corePath/skills/，不掃 extensions/
            const coreSkills = configData.corePath ? await scanSkillsInDir(path.join(configData.corePath, 'skills')) : [];
            // Workspace skills = 只掃使用者設定的 workspacePath
            const workspaceSkills = configData.workspace ? await scanInstalledSkills(configData.workspace) : [];
            const existingConfig = {
                ...configData,
                workspaceSkills,
            };
            return {
                code: 0,
                stdout: JSON.stringify({ 
                    ...configData,
                    corePath: configData.corePath,
                    configPath: finalConfigDirPath, 
                    workspacePath: configData.workspace,
                    coreSkills, 
                    existingConfig,
                }),
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

      if (authChoice === 'minimax-coding-plan-global-token' || authChoice === 'minimax-coding-plan-cn-token') {
        if (!isPlausibleMachineToken(secret) || isLikelyNaturalLanguageSentence(rawSecret)) {
          return {
            code: 1,
            stdout: '',
            stderr: 'MiniMax Coding Plan Token 格式異常：目前內容看起來像說明文字或無效字串，請重新貼上平台 Token。',
            exitCode: 1,
          };
        }
      }

      const configFilePath = path.join(configDir, 'openclaw.json');

      // MiniMax Coding Plan Token uses Provider-level authentication (different from standard auth.profiles):
      // Core runtime accesses through models.providers.minimax-portal.apiKey directly,
      // no need to create auth.profiles or agent/auth-profiles.json.
      // Verification logic is handled by verifyMiniMaxPortalTokenConfig, no dual-layer profile check.
      // Note: As it's not written to auth.profiles, inferAuthChoiceFromProfile cannot auto-detect this authChoice;
      //       authChoice must be persisted via Launcher settings (config:write) to ensure it's available after restart.
      if (authChoice === 'minimax-coding-plan-global-token' || authChoice === 'minimax-coding-plan-cn-token') {
        const configJson = (await loadJsonFile(configFilePath)) || {};
        const providers = configJson?.models?.providers && typeof configJson.models.providers === 'object'
          ? configJson.models.providers
          : {};
        const portalProvider = providers['minimax-portal'] && typeof providers['minimax-portal'] === 'object'
          ? providers['minimax-portal']
          : {};
        const baseUrl = authChoice === 'minimax-coding-plan-cn-token'
          ? 'https://api.minimaxi.com/anthropic'
          : 'https://api.minimax.io/anthropic';

        const nextJson = {
          ...configJson,
          models: {
            ...(configJson.models || {}),
            providers: {
              ...providers,
              'minimax-portal': {
                ...portalProvider,
                baseUrl,
                apiKey: secret,
                models: Array.isArray(portalProvider.models) ? portalProvider.models : [],
              },
            },
          },
        };

        await saveJsonFile(configFilePath, nextJson);
        return {
          code: 0,
          stdout: JSON.stringify({ authChoice, provider: 'minimax-portal', mode: 'token', baseUrl }),
          stderr: '',
          exitCode: 0,
        };
      }

      const mainAgentDir = path.join(configDir, 'agents', 'main', 'agent');
      const envPrefix = `OPENCLAW_STATE_DIR=${shellQuote(configDir)} OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} OPENCLAW_AGENT_DIR=${shellQuote(mainAgentDir)} `;
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

      // New version of OpenClaw has removed `openclaw auth set`.
      // Authorization writing is handled by onboarding, followed by dual-layer profile check to confirm.

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
                    .filter((v, i, a) => a.indexOf(v) === i) // Deduplicate
                    .reverse(); // Keep latest versions at the front
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

        // Pre-check paths in three zones
        const finalCorePath = await checkAndWrap(corePath, 'openclaw');
        const finalConfigPath = await checkAndWrap(configPath, '.openclaw');
        const finalWorkspacePath = await checkAndWrap(workspacePath, 'openclaw-workspace');

        // 1. Download core source code
        const repoUrl = 'https://github.com/openclaw/openclaw.git';
        const tarballUrl = `https://github.com/openclaw/openclaw/tarball/${encodeURIComponent(targetVersion)}`;
        
        emitShellStdout(`>>> Initializing paths for version ${targetVersion} via ${downloadMethod}...\n`, 'stdout');
        
        await fs.mkdir(finalCorePath, { recursive: true });

        return new Promise((resolve) => {
            let childProcess: any;
          const runCommandWithStreaming = (cmd: string, title: string) => {
            return new Promise<{ code: number; stdout: string; stderr: string }>((resolveStep) => {
              emitShellStdout(`>>> ${title}\n`, 'stdout');
              const proc = spawn(cmd, { shell: true, cwd: finalCorePath });
              activeProcesses.add(proc);
              let stdout = '';
              let stderr = '';

              proc.stdout.on('data', (data: any) => {
                const chunk = data.toString();
                stdout += chunk;
                emitShellStdout(chunk, 'stdout');
              });

              proc.stderr.on('data', (data: any) => {
                const chunk = data.toString();
                stderr += chunk;
                emitShellStdout(chunk, 'stderr');
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
                // Executed directly without osascript to stream logs to the UI "mini view"
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
                emitShellStdout(data.toString(), 'stdout');
            });

            childProcess.stderr.on('data', (data: any) => {
                emitShellStdout(data.toString(), 'stderr');
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

                // [NEW] Automatically clean up Git traces (keep pure core code only)
                if (downloadMethod === 'git') {
                    const gitDirPath = path.join(finalCorePath, '.git');
                    try {
                        emitShellStdout('>>> Detaching from Git (Cleaning up .git directory)...\n', 'stdout');
                        await fs.rm(gitDirPath, { recursive: true, force: true });
                    } catch (e) {
                        emitShellStdout('>>> Note: Could not remove .git folder, skipping...\n', 'stdout');
                    }
                }

                try {
                  const createdItems: string[] = [];
                  const existingItems: string[] = [];
                  const preExistingItems = new Set<string>();

                  const trackPreExisting = async (targetPath: string) => {
                    try {
                      await fs.stat(targetPath);
                      preExistingItems.add(targetPath);
                    } catch {
                      // Path did not exist before initialization started.
                    }
                  };

                  const trackOutcome = (targetPath: string) => {
                    if (preExistingItems.has(targetPath)) {
                      existingItems.push(targetPath);
                    } else {
                      createdItems.push(targetPath);
                    }
                  };

                  const configFilePath = path.join(finalConfigPath, 'openclaw.json');
                  const skillsDir = path.join(finalWorkspacePath, 'skills');
                  const extensionsDir = path.join(finalWorkspacePath, 'extensions');

                  const ensureDirWithTracking = async (dirPath: string) => {
                    await fs.mkdir(dirPath, { recursive: true });
                    trackOutcome(dirPath);
                  };

                  // Take snapshots of all target paths (including bootstrap files) before any CLI execution;
                  // openclaw setup will create some of these files; if snapshots are taken after, they will be
                  // misidentified as "already existed before initialization", causing incorrect Already Existed display.
                  await trackPreExisting(finalConfigPath);
                  await trackPreExisting(configFilePath);
                  await trackPreExisting(finalWorkspacePath);
                  await trackPreExisting(skillsDir);
                  await trackPreExisting(extensionsDir);

                  // Snapshots of bootstrap files must also be completed before openclaw setup
                  const bootstrapFileNames = [
                    'AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md',
                    'USER.md', 'HEARTBEAT.md', 'BOOTSTRAP.md', 'MEMORY.md',
                  ];
                  for (const name of bootstrapFileNames) {
                    await trackPreExisting(path.join(finalWorkspacePath, name));
                  }

                  // 2. Install dependencies (required for CLI availability for subsequent openclaw setup)
                  // Use zsh -ilc so that GUI environment can read .zshrc / nvm / volta PATH
                  const pnpmCheckRes = await runCommandWithStreaming('zsh -ilc "pnpm --version" 2>/dev/null || pnpm --version', 'Checking pnpm availability...');
                  if (pnpmCheckRes.code !== 0) {
                    const detail = [
                      String(pnpmCheckRes.stderr || '').trim(),
                      String(pnpmCheckRes.stdout || '').trim(),
                    ].filter(Boolean).join('\n');
                    resolve({
                      code: 1,
                      stderr: detail || 'pnpm is unavailable. Please install pnpm (https://pnpm.io/) and ensure it is in your PATH.',
                      exitCode: 1,
                    });
                    return;
                  }

                  const installRes = await runCommandWithStreaming('zsh -ilc "pnpm install --no-frozen-lockfile" 2>&1 || pnpm install --no-frozen-lockfile', 'Installing OpenClaw dependencies...');
                  if (installRes.code !== 0) {
                    const detail = [
                      String(installRes.stderr || '').trim(),
                      String(installRes.stdout || '').trim(),
                    ].filter(Boolean).join('\n');
                    resolve({
                      code: 1,
                      stderr: detail || `Dependency installation failed (exit code ${installRes.code}).`,
                      exitCode: 1,
                    });
                    return;
                  }

                  // 3. Warm up CLI execution environment (auto-builds TypeScript if dist is outdated)
                  const warmupRes = await runCommandWithStreaming('zsh -ilc "pnpm openclaw --version" 2>&1 || pnpm openclaw --version', 'Prebuilding OpenClaw runtime...');
                  if (warmupRes.code !== 0) {
                    resolve({ code: 1, stderr: warmupRes.stderr || 'OpenClaw runtime warm-up failed.', exitCode: 1 });
                    return;
                  }

                  // 4. Use openclaw setup to create/update config (handles workspace / gateway fields)
                  //    CLI is now ready; call native commands directly without relying on Launcher manual templates
                  emitShellStdout(`>>> Initializing config at ${finalConfigPath}...\n`, 'stdout');
                  await ensureDirWithTracking(finalConfigPath);

                  const setupEnv = `OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} OPENCLAW_STATE_DIR=${shellQuote(finalConfigPath)}`;
                  const setupRes = await runCommandWithStreaming(
                    `zsh -ilc "${setupEnv} pnpm openclaw setup --workspace ${shellQuote(finalWorkspacePath)}" 2>&1 || ${setupEnv} pnpm openclaw setup --workspace ${shellQuote(finalWorkspacePath)}`,
                    'Initializing OpenClaw config...'
                  );

                  if (setupRes.code !== 0) {
                    resolve({ code: 1, stderr: setupRes.stderr || 'openclaw setup failed.', exitCode: 1 });
                    return;
                  }
                  trackOutcome(configFilePath);

                  // Clean up legacy keys possibly written by older Launcher versions (no impact on openclaw schema)
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
                    // Legacy cleanup failure does not block the flow
                  }

                  // 6. Initialize additional Workspace folders and Launcher-specific bootstrap files
                  // (openclaw setup has created workspace base dir and AGENTS.md; additional Launcher content added here)
                  emitShellStdout(`>>> Setting up workspace at ${finalWorkspacePath}...\n`, 'stdout');
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

                  // trackPreExisting completed before openclaw setup execution (see above); write directly here
                  for (const [name, content] of Object.entries(bootstrapTemplates)) {
                    const targetPath = path.join(finalWorkspacePath, name);
                    const wrote = await writeFileIfMissing(targetPath, content);
                    if (!wrote) {
                      trackOutcome(targetPath);
                    } else {
                      createdItems.push(targetPath);
                    }
                  }

                  const uniqueCreatedItems = Array.from(new Set(createdItems));
                  const uniqueExistingItems = Array.from(new Set(existingItems));

                    emitShellStdout('>>> Initialization complete!\n', 'stdout');
                    resolve({ 
                        code: 0, 
                        stdout: JSON.stringify({ 
                            corePath: finalCorePath, 
                            configPath: finalConfigPath, 
                            workspacePath: finalWorkspacePath,
                            createdItems: uniqueCreatedItems,
                            existingItems: uniqueExistingItems
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
    sendToRenderer('shell:stdout', { data: `[Exec] ${fullCommand}\n`, source: 'system' });
    
    const child = spawn(fullCommand, { shell: true });
    activeProcesses.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      emitShellStdout(chunk, 'stdout');
    });
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      emitShellStdout(chunk, 'stderr');
    });
    child.on('error', (error: any) => {
      activeProcesses.delete(child);
      if (settled) return;
      settled = true;
      resolve({ code: 1, stdout, stderr: stderr || String(error?.message || error), exitCode: 1 });
    });
    child.on('close', (code) => {
      activeProcesses.delete(child);
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 0, stdout, stderr, exitCode: code ?? 0 });
    });
  });
});

ipcMain.handle('port:find-free', async (_event, startPort?: number, endPort?: number) => {
  const start = Math.max(1024, Math.min(65533, Number(startPort) || 10000));
  const end = Math.max(start + 1, Math.min(65535, Number(endPort) || 60000));

  const isPortFree = (port: number): Promise<boolean> => new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });

  for (let port = start; port <= end; port++) {
    const free = await isPortFree(port);
    if (free) return { port };
  }
  return { port: null, error: `No free port found in range ${start}-${end}` };
});

// ── usage:scan-sessions ────────────────────────────────────────────────────
// Directly scan ~/.openclaw/agents/*/sessions/*.jsonl, no backend pre-aggregation required
// Copy openclaw-control-center usage-cost.ts Track 2 (JSONL scan) logic
ipcMain.handle('usage:scan-sessions', async (_event, payload?: string) => {
  try {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    const parsed = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
    const agentsDir: string = parsed.agentsDir || path.join(homeDir, '.openclaw', 'agents');

    const events: RuntimeUsageEvent[] = [];

    let agentIds: string[] = [];
    try { agentIds = await fs.readdir(agentsDir); } catch { /* dir not found */ }

    for (const agentId of agentIds) {
      const sessionsDir = path.join(agentsDir, agentId, 'sessions');
      let files: string[] = [];
      try {
        const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
        files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name);
      } catch { continue; }

      for (const file of files) {
        let content = '';
        try { content = await fs.readFile(path.join(sessionsDir, file), 'utf-8'); } catch { continue; }
        const parsed = parseSessionJsonlForUsage(content, agentId);
        for (const ev of parsed) events.push(ev);
      }
    }

    return { code: 0, stdout: JSON.stringify(events), stderr: '' };
  } catch (e: any) {
    return { code: 1, stdout: '[]', stderr: String(e?.message || 'scan failed') };
  }
});
// ──────────────────────────────────────────────────────────────────────────

ipcMain.handle('shell:kill-port-holder', async (_event, rawPort: number) => {
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { success: false, error: 'Invalid port', port };
  }

  // Try unloading launchctl-managed gateway daemon first to avoid immediate restart after kill
  const launchctlLabel = 'ai.openclaw.gateway';
  const uid = (await runShellCommand('id -u')).stdout.trim();
  if (uid) {
    await runShellCommand(`launchctl bootout gui/${uid}/${launchctlLabel} 2>/dev/null || true`);
    await sleep(300);
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
    return { success: true, error: undefined, port, pids: [], killed: [], forceKilled: [], failed: [] };
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
    sendToRenderer('openclaw:chat.chunk', {
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

// ── Activity Engine IPC ───────────────────────────────────────────────────────

ipcMain.handle('activity:events:list', async (_event, payload?: string) => {
  const opts = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
  const limit = Number(opts?.limit ?? 200);
  const categoryFilter = opts?.category as string | undefined;
  const sourceFilter = opts?.source as string | undefined;
  const since = Number(opts?.since ?? 0);

  let events = activityBuffer.slice(-ACTIVITY_MAX);
  if (since) events = events.filter(e => e.timestamp > since);
  if (categoryFilter) events = events.filter(e => e.category === categoryFilter);
  if (sourceFilter) events = events.filter(e => e.source === sourceFilter);
  events = events.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  return { code: 0, stdout: JSON.stringify({ events, total: events.length }), stderr: '', exitCode: 0 };
});

ipcMain.handle('activity:scan:now', async (_event, payload?: string) => {
  const opts = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
  const stateDir = opts?.stateDir as string | undefined;
  await Promise.all([
    scanAllSessions(stateDir),
    scanCronJobs(stateDir),
  ]);
  return { code: 0, stdout: JSON.stringify({ scanned: true, total: activityBuffer.length }), stderr: '', exitCode: 0 };
});

ipcMain.handle('activity:watch:restart', async (_event, payload?: string) => {
  const opts = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
  const extraDirs: string[] = Array.isArray(opts?.extraDirs) ? opts.extraDirs : [];
  await startActivityWatcher(extraDirs);
  const dirs = await buildWatchDirs();
  return { code: 0, stdout: JSON.stringify({ ok: true, watching: dirs.length + extraDirs.length }), stderr: '', exitCode: 0 };
});
// ─────────────────────────────────────────────────────────────────────────────

app.on('before-quit', () => {
  killAllSubprocesses();
  if (activeLockFilePath) {
    try { unlinkSync(activeLockFilePath); } catch {}
    activeLockFilePath = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
