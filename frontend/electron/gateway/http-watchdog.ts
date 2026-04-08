import { sleep } from '../utils/shell-utils.js';
import { isGatewayOnlineFromStatus } from '../services/openclaw-runtime.js';
import { launchGatewayViaTerminal, spawnWatchedGatewayProcess, stopGatewayWatchdog } from './watchdog.js';

export interface GatewayHttpWatchdogOptions {
  enabled: boolean;
  healthCheckCommand: string;
  restartCommand: string;
  intervalMs: number;
  failThreshold: number;
  maxRestarts: number;
  startupGraceMs: number;
  restartCooldownMs: number;
  restartMode: 'terminal' | 'spawn';
}

export interface GatewayHttpWatchdogState {
  timer: NodeJS.Timeout | null;
  checking: boolean;
  consecutiveFailures: number;
  restartAttempts: number;
  suppressChecksUntil: number;
  options: GatewayHttpWatchdogOptions;
}

export const DEFAULT_GATEWAY_HTTP_WATCHDOG_OPTIONS: GatewayHttpWatchdogOptions = {
  enabled: false,
  healthCheckCommand: '',
  restartCommand: '',
  intervalMs: 15000,
  failThreshold: 2,
  maxRestarts: 5,
  startupGraceMs: 20000,
  restartCooldownMs: 20000,
  restartMode: 'terminal',
};

export const gatewayHttpWatchdog: GatewayHttpWatchdogState = {
  timer: null,
  checking: false,
  consecutiveFailures: 0,
  restartAttempts: 0,
  suppressChecksUntil: 0,
  options: { ...DEFAULT_GATEWAY_HTTP_WATCHDOG_OPTIONS },
};

// ── Injected dependencies ───────────────────────────────────────────────────
type EmitFn = (data: string, source?: 'stdout' | 'stderr') => void;
type RunCmdFn = (command: string) => Promise<{ code: number; stdout: string; stderr: string }>;

let _emit: EmitFn = () => {};
let _runShellCommand: RunCmdFn = async () => ({ code: 0, stdout: '', stderr: '' });

export function initGatewayHttpWatchdog(emit: EmitFn, runShellCommand: RunCmdFn): void {
  _emit = emit;
  _runShellCommand = runShellCommand;
}

// ── Watchdog lifecycle ───────────────────────────────────────────────────────

export const clearGatewayHttpWatchdogTimer = (): void => {
  if (gatewayHttpWatchdog.timer) {
    clearInterval(gatewayHttpWatchdog.timer);
    gatewayHttpWatchdog.timer = null;
  }
};

export const stopGatewayHttpWatchdog = (reason = 'manual stop'): void => {
  clearGatewayHttpWatchdogTimer();
  gatewayHttpWatchdog.checking = false;
  gatewayHttpWatchdog.consecutiveFailures = 0;
  gatewayHttpWatchdog.restartAttempts = 0;
  gatewayHttpWatchdog.suppressChecksUntil = 0;
  gatewayHttpWatchdog.options = { ...DEFAULT_GATEWAY_HTTP_WATCHDOG_OPTIONS };
  _emit(`[gateway-http-watchdog] stopped: ${reason}\n`, 'stdout');
};

export const runGatewayHttpWatchdogCheck = async (): Promise<void> => {
  if (gatewayHttpWatchdog.checking) return;
  if (!gatewayHttpWatchdog.options.enabled) return;
  if (Date.now() < gatewayHttpWatchdog.suppressChecksUntil) return;
  const healthCheckCommand = String(gatewayHttpWatchdog.options.healthCheckCommand || '').trim();
  const restartCommand = String(gatewayHttpWatchdog.options.restartCommand || '').trim();
  if (!healthCheckCommand || !restartCommand) return;

  gatewayHttpWatchdog.checking = true;
  try {
    const healthRes = await _runShellCommand(healthCheckCommand);
    const online = isGatewayOnlineFromStatus(healthRes);
    if (online) {
      gatewayHttpWatchdog.consecutiveFailures = 0;
      // 健康時重置重啟計數，避免長期累積導致後續崩潰無法重啟
      if (gatewayHttpWatchdog.restartAttempts > 0) {
        gatewayHttpWatchdog.restartAttempts = 0;
        _emit('[gateway-http-watchdog] gateway healthy, restart counter reset\n', 'stdout');
      }
      return;
    }

    gatewayHttpWatchdog.consecutiveFailures += 1;
    const failStdout = String(healthRes.stdout || '').trim();
    const failStderr = String(healthRes.stderr || '').trim();
    _emit(
      `[gateway-http-watchdog] health check failed (${gatewayHttpWatchdog.consecutiveFailures}/${gatewayHttpWatchdog.options.failThreshold}) code=${String(healthRes.code)} stdout=${failStdout ? 'non-empty' : 'empty'} stderr=${failStderr ? 'non-empty' : 'empty'}\n`,
      'stderr',
    );

    if (gatewayHttpWatchdog.consecutiveFailures < gatewayHttpWatchdog.options.failThreshold) {
      return;
    }

    // Double confirmation before restart to reduce misjudgment caused by transient jitter.
    await sleep(1200);
    const recheckRes = await _runShellCommand(healthCheckCommand);
    const recheckOnline = isGatewayOnlineFromStatus(recheckRes);
    if (recheckOnline) {
      gatewayHttpWatchdog.consecutiveFailures = 0;
      _emit('[gateway-http-watchdog] false alarm recovered on recheck, skip restart\n', 'stdout');
      return;
    }

    gatewayHttpWatchdog.consecutiveFailures = 0;

    if (gatewayHttpWatchdog.restartAttempts >= gatewayHttpWatchdog.options.maxRestarts) {
      _emit(
        `[gateway-http-watchdog] max restart attempts reached (${gatewayHttpWatchdog.options.maxRestarts}), stop restarting\n`,
        'stderr',
      );
      return;
    }

    gatewayHttpWatchdog.restartAttempts += 1;
    _emit(
      `[gateway-http-watchdog] restart attempt ${gatewayHttpWatchdog.restartAttempts}/${gatewayHttpWatchdog.options.maxRestarts} via ${gatewayHttpWatchdog.options.restartMode === 'spawn' ? 'background spawn' : process.platform === 'win32' ? 'Windows cmd.exe' : process.platform === 'linux' ? 'Linux terminal' : 'macOS Terminal'}\n`,
      'stdout',
    );

    if (gatewayHttpWatchdog.options.restartMode === 'spawn') {
      stopGatewayWatchdog('pre-restart by http-watchdog');
      spawnWatchedGatewayProcess(restartCommand);
      gatewayHttpWatchdog.suppressChecksUntil = Date.now() + gatewayHttpWatchdog.options.restartCooldownMs;
      _emit('[gateway-http-watchdog] restart command sent (background spawn)\n', 'stdout');
    } else {
      const ok = await launchGatewayViaTerminal(restartCommand);
      // 無論成功與否都設 cooldown，避免開啟 Terminal 失敗時每 15s 快速耗盡 maxRestarts
      gatewayHttpWatchdog.suppressChecksUntil = Date.now() + gatewayHttpWatchdog.options.restartCooldownMs;
      if (ok) {
        _emit('[gateway-http-watchdog] restart command sent to Terminal\n', 'stdout');
      } else {
        _emit('[gateway-http-watchdog] failed to open Terminal for restart (will retry after cooldown)\n', 'stderr');
      }
    }
  } catch (e) {
    _emit(`[gateway-http-watchdog] check error: ${String((e as Error)?.message || e)}\n`, 'stderr');
  } finally {
    gatewayHttpWatchdog.checking = false;
  }
};

export const startGatewayHttpWatchdog = (options: Partial<GatewayHttpWatchdogOptions>): void => {
  const nextOptions: GatewayHttpWatchdogOptions = {
    enabled: Boolean(options.enabled),
    healthCheckCommand: String(options.healthCheckCommand || '').trim(),
    restartCommand: String(options.restartCommand || '').trim(),
    intervalMs: Number.isFinite(Number(options.intervalMs)) ? Math.max(5000, Number(options.intervalMs)) : 15000,
    failThreshold: Number.isFinite(Number(options.failThreshold)) ? Math.max(1, Number(options.failThreshold)) : 2,
    maxRestarts: Number.isFinite(Number(options.maxRestarts)) ? Math.max(1, Number(options.maxRestarts)) : 5,
    startupGraceMs: Number.isFinite(Number(options.startupGraceMs)) ? Math.max(3000, Number(options.startupGraceMs)) : 20000,
    restartCooldownMs: Number.isFinite(Number(options.restartCooldownMs)) ? Math.max(3000, Number(options.restartCooldownMs)) : 20000,
    restartMode: options.restartMode === 'spawn' ? 'spawn' : 'terminal',
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
  _emit(
    `[gateway-http-watchdog] started (interval=${nextOptions.intervalMs}ms, threshold=${nextOptions.failThreshold})\n`,
    'stdout',
  );

  gatewayHttpWatchdog.timer = setInterval(() => {
    void runGatewayHttpWatchdogCheck();
  }, nextOptions.intervalMs);

  void runGatewayHttpWatchdogCheck();
};
