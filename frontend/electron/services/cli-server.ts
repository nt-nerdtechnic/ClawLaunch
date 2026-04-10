/**
 * NT-ClawLaunch CLI HTTP Server
 *
 * 監聽 127.0.0.1:19827，提供 CLI binary (scripts/clawlaunch.mjs) 呼叫入口。
 * 目前支援命令：gateway:start、gateway:stop、gateway:restart
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import { resolveOpenClawRuntime } from './openclaw-runtime.js';

// ── Context 型別 ─────────────────────────────────────────────────────────────

export interface CliServerContext {
  spawnWatchedGatewayProcess: (command: string) => ReturnType<typeof spawn>;
  stopGatewayWatchdog: (reason?: string) => void;
  stopGatewayHttpWatchdog: (reason?: string) => void;
  runShellCommand: (command: string) => Promise<{ code: number; stdout: string; stderr: string }>;
}

// ── 常數 ─────────────────────────────────────────────────────────────────────

const CLI_SERVER_PORT = 19827;

// ── 模組狀態 ─────────────────────────────────────────────────────────────────

let server: http.Server | null = null;
let startedAt = 0;

// ── Port file 工具 ────────────────────────────────────────────────────────────

function getPortFilePath(): string {
  return path.join(app.getPath('home'), '.clawlaunch', '.cli-server.port');
}

async function writePortFile(port: number): Promise<void> {
  const dir = path.join(app.getPath('home'), '.clawlaunch');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getPortFilePath(), String(port), { mode: 0o600 });
}

async function deletePortFile(): Promise<void> {
  try { await fs.unlink(getPortFilePath()); } catch { /* ignore */ }
}

// ── Gateway 指令實作 ──────────────────────────────────────────────────────────

type ExecResult = { code: number; stdout: string; stderr: string };

async function doGatewayStart(ctx: CliServerContext): Promise<ExecResult> {
  const runtime = await resolveOpenClawRuntime();
  if (!runtime.corePath) {
    return { code: 78, stdout: '', stderr: 'corePath not configured. Please complete onboarding first.' };
  }
  const runCmd = `${runtime.openclawPrefix} gateway run --verbose --force`;
  ctx.stopGatewayWatchdog('cli:gateway:start');
  ctx.stopGatewayHttpWatchdog('cli:gateway:start');
  const child = ctx.spawnWatchedGatewayProcess(runCmd);
  return {
    code: 0,
    stdout: JSON.stringify({ pid: child.pid ?? null, command: runCmd, status: 'started' }),
    stderr: '',
  };
}

async function doGatewayStop(ctx: CliServerContext): Promise<ExecResult> {
  ctx.stopGatewayWatchdog('cli:gateway:stop');
  ctx.stopGatewayHttpWatchdog('cli:gateway:stop');

  const runtime = await resolveOpenClawRuntime();
  if (runtime.corePath) {
    const stopCmd = `${runtime.openclawPrefix} gateway stop${runtime.gatewayUrlArg}${runtime.gatewayAuthArg}`;
    await ctx.runShellCommand(stopCmd).catch(() => {});
  }

  return { code: 0, stdout: JSON.stringify({ stopped: true }), stderr: '' };
}

async function doGatewayRestart(ctx: CliServerContext): Promise<ExecResult> {
  await doGatewayStop(ctx);
  // 等待 gateway port 釋放（最多 8 秒）
  const runtime = await resolveOpenClawRuntime();
  if (runtime.gatewayPort && /^\d+$/.test(runtime.gatewayPort)) {
    const port = runtime.gatewayPort;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const check = await ctx.runShellCommand(
        `lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null | wc -l`,
      ).catch(() => ({ code: 0, stdout: '0', stderr: '' }));
      if (String(check.stdout || '0').trim() === '0') break;
      await new Promise<void>((r) => setTimeout(r, 500));
    }
  } else {
    await new Promise<void>((r) => setTimeout(r, 2000));
  }
  return doGatewayStart(ctx);
}

// ── 路由分發 ─────────────────────────────────────────────────────────────────

async function dispatchCommand(command: string, ctx: CliServerContext): Promise<ExecResult> {
  switch (command) {
    case 'gateway:start':   return doGatewayStart(ctx);
    case 'gateway:stop':    return doGatewayStop(ctx);
    case 'gateway:restart': return doGatewayRestart(ctx);
    default:
      return { code: 2, stdout: '', stderr: `Unknown command: ${command}. Available: gateway:start, gateway:stop, gateway:restart` };
  }
}

// ── Server 生命週期 ───────────────────────────────────────────────────────────

export function startCliServer(ctx: CliServerContext): void {
  if (server) return;

  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-CLI-Server', 'NT-ClawLaunch');

    // GET /health
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        version: app.getVersion(),
        uptime: Math.floor(process.uptime()),
        serverUptime: Math.floor((Date.now() - startedAt) / 1000),
        port: CLI_SERVER_PORT,
      }));
      return;
    }

    // GET /commands
    if (req.method === 'GET' && req.url === '/commands') {
      res.writeHead(200);
      res.end(JSON.stringify({
        commands: [
          { command: 'gateway:start',   description: '背景啟動 OpenClaw Gateway（含 watchdog）' },
          { command: 'gateway:stop',    description: '停止 OpenClaw Gateway 與所有 watchdog' },
          { command: 'gateway:restart', description: '重啟 OpenClaw Gateway（stop → wait → start）' },
        ],
      }));
      return;
    }

    // POST /exec
    if (req.method === 'POST' && req.url === '/exec') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const command = String(parsed?.command || '').trim();
          if (!command) {
            res.writeHead(400);
            res.end(JSON.stringify({ code: 2, stdout: '', stderr: 'Missing command' }));
            return;
          }
          const result = await dispatchCommand(command, ctx);
          res.writeHead(result.code === 0 ? 200 : (result.code === 2 ? 400 : 500));
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ code: 1, stdout: '', stderr: String((e as Error)?.message || 'parse error') }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(CLI_SERVER_PORT, '127.0.0.1', async () => {
    startedAt = Date.now();
    await writePortFile(CLI_SERVER_PORT).catch(() => {});
    console.log(`[cli-server] Listening on 127.0.0.1:${CLI_SERVER_PORT}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[cli-server] Port ${CLI_SERVER_PORT} already in use, CLI server not started`);
    } else {
      console.error('[cli-server] Server error:', err);
    }
  });
}

export async function stopCliServer(): Promise<void> {
  await deletePortFile();
  if (!server) return;
  await new Promise<void>((resolve) => {
    server!.close(() => resolve());
    server = null;
  });
}
