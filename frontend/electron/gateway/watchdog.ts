import { spawn } from 'node:child_process';
import { t } from '../utils/i18n.js';
import { shellQuote, escapeAppleScriptString } from '../utils/shell-utils.js';

export const NT_CLAW_TERMINAL_MARKER_PREFIX = '__NT_CLAWLAUNCH_MANAGED__';

export interface GatewayStartOptions {
  autoRestart: boolean;
  maxRestarts: number;
  baseBackoffMs: number;
}

export interface GatewayWatchdogState {
  child: ReturnType<typeof spawn> | null;
  command: string;
  stopRequested: boolean;
  restartAttempts: number;
  restartTimer: NodeJS.Timeout | null;
  options: GatewayStartOptions;
}

export const DEFAULT_GATEWAY_WATCHDOG_OPTIONS: GatewayStartOptions = {
  autoRestart: false,
  maxRestarts: 5,
  baseBackoffMs: 1000,
};

export const gatewayWatchdog: GatewayWatchdogState = {
  child: null,
  command: '',
  stopRequested: false,
  restartAttempts: 0,
  restartTimer: null,
  options: { ...DEFAULT_GATEWAY_WATCHDOG_OPTIONS },
};

// ── Injected dependencies ───────────────────────────────────────────────────
type EmitFn = (data: string, source?: 'stdout' | 'stderr') => void;
type RunCmdFn = (command: string) => Promise<{ code: number; stdout: string; stderr: string }>;

let _emit: EmitFn = () => {};
let _runShellCommand: RunCmdFn = async () => ({ code: 0, stdout: '', stderr: '' });
let _activeProcesses: Set<ReturnType<typeof spawn>> = new Set();

// ── Lifecycle trace helper ───────────────────────────────────────────────────
const traceWatchdogAction = (action: string, details: Record<string, unknown> = {}): void => {
  const stackLines = String(new Error().stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // frame 0 = Error, 1 = traceWatchdogAction, 2 = stopGatewayWatchdog, 3 = actual caller
  const caller = (stackLines[3] ?? stackLines[stackLines.length - 1] ?? 'unknown').replace(/^at\s+/, '');
  const detailText = Object.entries(details)
    .map(([k, v]) => `${k}=${String(v ?? '')}`)
    .join(' ');
  _emit(
    `[launcher-trace] ts=${new Date().toISOString()} action=${action}${detailText ? ' ' + detailText : ''} caller=${caller}\n`,
    'stdout',
  );
};

export function initGatewayWatchdog(
  emit: EmitFn,
  runShellCommand: RunCmdFn,
  activeProcesses: Set<ReturnType<typeof spawn>>,
): void {
  _emit = emit;
  _runShellCommand = runShellCommand;
  _activeProcesses = activeProcesses;
}

// ── Terminal helpers ─────────────────────────────────────────────────────────

export const buildTerminalLaunchScript = (command: string, title = 'OpenClaw Gateway Auto-Restart'): string => {
  const marker = `${NT_CLAW_TERMINAL_MARKER_PREFIX}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const finalCmd = `clear; echo '🚀 ${title}...'; echo '${marker}'; ${command}; printf "\\n${t('main.shell.terminal.footer')}"; read -r _`;
  const line1 = `tell application "Terminal" to do script "${escapeAppleScriptString(finalCmd)}"`;
  const line2 = 'tell application "Terminal" to activate';
  return `osascript -e ${shellQuote(line1)} -e ${shellQuote(line2)}`;
};

export const launchGatewayViaTerminal = async (command: string): Promise<boolean> => {
  const osascriptCmd = buildTerminalLaunchScript(command);
  const res = await _runShellCommand(osascriptCmd);
  return (res.code ?? 1) === 0;
};

// ── Watchdog lifecycle ───────────────────────────────────────────────────────

export const clearGatewayRestartTimer = (): void => {
  if (gatewayWatchdog.restartTimer) {
    clearTimeout(gatewayWatchdog.restartTimer);
    gatewayWatchdog.restartTimer = null;
  }
};

export const stopGatewayWatchdog = (reason = 'manual stop'): void => {
  traceWatchdogAction('stopGatewayWatchdog', {
    reason,
    childPid: gatewayWatchdog.child?.pid ?? 'none',
    childKilled: gatewayWatchdog.child ? String(gatewayWatchdog.child.killed) : 'none',
    stopRequested: String(gatewayWatchdog.stopRequested),
    restartAttempts: gatewayWatchdog.restartAttempts,
  });
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
    _emit(`[gateway-watchdog] stopped: ${reason}\n`, 'stdout');
  }
};

export const spawnWatchedGatewayProcess = (command: string): ReturnType<typeof spawn> => {
  const child = spawn(command, { shell: true });
  gatewayWatchdog.child = child;
  _activeProcesses.add(child);

  _emit(`[gateway-watchdog] process started (pid=${String(child.pid ?? 'unknown')})\n`, 'stdout');

  child.stdout.on('data', (data) => {
    _emit(data.toString(), 'stdout');
  });
  child.stderr.on('data', (data) => {
    _emit(data.toString(), 'stderr');
  });

  child.on('exit', async (code: number | null, signal: NodeJS.Signals | null) => {
    _activeProcesses.delete(child);
    if (gatewayWatchdog.child === child) {
      gatewayWatchdog.child = null;
    }

    if (gatewayWatchdog.stopRequested) {
      return;
    }

    const failed = code !== 0 || signal !== null;
    if (!failed) {
      _emit('[gateway-watchdog] process exited cleanly, no restart required\n', 'stdout');
      return;
    }

    _emit(
      `[gateway-watchdog] process exited unexpectedly (code=${String(code)}, signal=${String(signal)})\n`,
      'stderr',
    );

    if (!gatewayWatchdog.options.autoRestart) {
      _emit('[gateway-watchdog] auto-restart is disabled\n', 'stderr');
      return;
    }

    if (gatewayWatchdog.restartAttempts >= gatewayWatchdog.options.maxRestarts) {
      _emit(
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

    _emit(
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
