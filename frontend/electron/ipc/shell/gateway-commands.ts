import type { CommandResult } from './types.js';
import type { ShellExecContext } from '../shell-exec-handler.js';

export async function handleGatewayCommands(fullCommand: string, ctx: ShellExecContext): Promise<CommandResult | null> {
  if (!fullCommand.startsWith('gateway:')) return null;

  if (fullCommand.startsWith('gateway:http-watchdog-start-json ')) {
    try {
      const payloadStr = fullCommand.replace(/^gateway:http-watchdog-start-json\s+/, '').trim();
      const payload = JSON.parse(payloadStr || '{}');
      ctx.startGatewayHttpWatchdog(payload || {});
      return { code: 0, stdout: 'gateway http watchdog configured', exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'Invalid gateway:http-watchdog-start-json payload', exitCode: 1 };
    }
  }

  if (fullCommand === 'gateway:http-watchdog-stop') {
    ctx.stopGatewayHttpWatchdog('manual stop command');
    return { code: 0, stdout: 'gateway http watchdog stopped', exitCode: 0 };
  }

  if (fullCommand === 'gateway:watchdogs-stop') {
    ctx.stopGatewayWatchdog('ipc:gateway:watchdogs-stop');
    ctx.stopGatewayHttpWatchdog('ipc:gateway:watchdogs-stop');
    return { code: 0, stdout: 'gateway watchdogs stopped', exitCode: 0 };
  }

  if (fullCommand.startsWith('gateway:start-bg-json ')) {
    try {
      const payloadStr = fullCommand.replace(/^gateway:start-bg-json\s+/, '').trim();
      const payload = JSON.parse(payloadStr || '{}');
      const actualCmd = String(payload?.command || '').trim();
      if (!actualCmd) {
        return { code: 1, stderr: 'Missing command for gateway:start-bg-json', exitCode: 1 };
      }
      ctx.stopGatewayWatchdog('replace previous gateway process');
      ctx.stopGatewayHttpWatchdog('replace previous watchdog');
      ctx.gatewayWatchdog['command'] = actualCmd;
      ctx.gatewayWatchdog['stopRequested'] = false;
      ctx.gatewayWatchdog['restartAttempts'] = 0;
      ctx.gatewayWatchdog['options'] = {
        autoRestart: Boolean(payload?.autoRestart),
        maxRestarts: Number.isInteger(payload?.maxRestarts) ? Math.max(1, Number(payload.maxRestarts)) : 5,
        baseBackoffMs: Number.isInteger(payload?.baseBackoffMs) ? Math.max(200, Number(payload.baseBackoffMs)) : 1000,
      };
      const child = ctx.spawnWatchedGatewayProcess(actualCmd);
      return { code: 0, stdout: String(child.pid ?? ''), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'Invalid gateway:start-bg-json payload', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('gateway:start-bg ')) {
    const actualCmd = fullCommand.replace(/^gateway:start-bg\s+/, '').trim();
    if (!actualCmd) {
      return { code: 1, stderr: 'Missing command for gateway:start-bg', exitCode: 1 };
    }
    ctx.stopGatewayWatchdog('replace previous gateway process');
    ctx.stopGatewayHttpWatchdog('replace previous watchdog');
    ctx.gatewayWatchdog['command'] = actualCmd;
    ctx.gatewayWatchdog['stopRequested'] = false;
    ctx.gatewayWatchdog['restartAttempts'] = 0;
    ctx.gatewayWatchdog['options'] = { ...ctx.defaultGatewayOptions };
    const child = ctx.spawnWatchedGatewayProcess(actualCmd);
    return { code: 0, stdout: String(child.pid ?? ''), exitCode: 0 };
  }

  return null;
}
