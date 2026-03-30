/** shell:exec IPC Handler — 所有 shell 指令的統一路由器。
 *  從 main.ts 提取，透過 ShellExecContext 接收仍需注入的全域狀態。
 *  實際指令邏輯已拆分至 ipc/shell/ 子模組。
 */

import { spawn } from 'node:child_process';
import { ipcMain } from 'electron';
import { safeJsonParse } from '../utils/normalize.js';

import { handleAppCommands } from './shell/app-commands.js';
import { handleControlCommands } from './shell/control-commands.js';
import { handleSystemCommands } from './shell/system-commands.js';
import { handleGatewayCommands } from './shell/gateway-commands.js';
import { handleSnapshotCommands } from './shell/snapshot-commands.js';
import { handleConfigCommands } from './shell/config-commands.js';
import { handleSkillCommands } from './shell/skill-commands.js';
import { handleAuthCommands } from './shell/auth-commands.js';
import { handleProjectCommands } from './shell/project-commands.js';

// ── Local helpers ─────────────────────────────────────────────────────────────

const tryParseJsonObject = (value: string) => {
  const parsed = safeJsonParse(value, null);
  if (parsed && typeof parsed === 'object') return parsed;
  return null;
};

export const parseGatewayCallStdoutJson = (rawStdout: string) => {
  const ansiRegex = /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  const stdout = String(rawStdout || '').replace(ansiRegex, '').trim();
  if (!stdout) return null;
  const fullParsed = tryParseJsonObject(stdout);
  if (fullParsed) return fullParsed;
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsedLine = tryParseJsonObject(lines[i]);
    if (parsedLine) return parsedLine;
  }
  const stripped = lines.filter((line) => !line.startsWith('>')).join('\n');
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliceParsed = tryParseJsonObject(stripped.slice(firstBrace, lastBrace + 1));
    if (sliceParsed) return sliceParsed;
  }
  const firstBraceOrig = stdout.indexOf('{');
  const lastBraceOrig = stdout.lastIndexOf('}');
  if (firstBraceOrig >= 0 && lastBraceOrig > firstBraceOrig) {
    return tryParseJsonObject(stdout.slice(firstBraceOrig, lastBraceOrig + 1));
  }
  return null;
};

// ── Context Interface ────────────────────────────────────────────────────────

export interface ShellExecContext {
  mainWindow: Electron.BrowserWindow | null;
  activeProcesses: Set<ReturnType<typeof spawn>>;
  sendToRenderer: (channel: string, payload: unknown) => void;
  emitShellStdout: (data: string, source?: 'stdout' | 'stderr') => void;
  runShellCommand: (command: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  activateConfigPath: (newConfigPath: string) => Promise<void>;
  spawnWatchedGatewayProcess: (command: string) => ReturnType<typeof spawn>;
  stopGatewayWatchdog: (reason?: string) => void;
  stopGatewayHttpWatchdog: (reason?: string) => void;
  startGatewayHttpWatchdog: (options: Record<string, unknown>) => void;
  gatewayWatchdog: Record<string, unknown>;
  defaultGatewayOptions: Record<string, unknown>;
  killAllSubprocesses: () => void;
  startActivityWatcher: (extraDirs?: string[]) => Promise<void>;
  readLauncherConfigPaths: () => Promise<{ corePath: string; workspacePath: string; configPath: string; stateDir: string }>;
  persistentConfigDir: string;
  getClawlaunchFile: () => string;
  validateVersionRef: (raw: string) => string;
}

// ── Handler Registration ──────────────────────────────────────────────────────

export function registerShellExecHandler(ctx: ShellExecContext): void {
  ipcMain.handle('shell:exec', async (_event, command: string, args: string[] = []) => {
    const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

    return (
      await handleAppCommands(fullCommand) ??
      await handleControlCommands(fullCommand, ctx) ??
      await handleSystemCommands(fullCommand, ctx) ??
      await handleGatewayCommands(fullCommand, ctx) ??
      await handleSnapshotCommands(fullCommand, ctx) ??
      await handleConfigCommands(fullCommand, ctx) ??
      await handleSkillCommands(fullCommand, ctx) ??
      await handleAuthCommands(fullCommand, ctx) ??
      await handleProjectCommands(fullCommand, ctx) ??
      // Fallback: pass through to shell
      await new Promise<{ code: number; stdout: string; stderr: string; exitCode: number }>((resolve) => {
        ctx.sendToRenderer('shell:stdout', { data: `[Exec] ${fullCommand}\n`, source: 'system' });
        const child = spawn(fullCommand, { shell: true });
        ctx.activeProcesses.add(child);
        let stdout = '', stderr = '';
        let settled = false;
        child.stdout.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          ctx.emitShellStdout(chunk, 'stdout');
        });
        child.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;
          ctx.emitShellStdout(chunk, 'stderr');
        });
        child.on('error', (error) => {
          ctx.activeProcesses.delete(child);
          if (settled) return;
          settled = true;
          resolve({ code: 1, stdout, stderr: stderr || String(error?.message || error), exitCode: 1 });
        });
        child.on('close', (code) => {
          ctx.activeProcesses.delete(child);
          if (settled) return;
          settled = true;
          resolve({ code: code ?? 0, stdout, stderr, exitCode: code ?? 0 });
        });
      })
    );
  });

}
