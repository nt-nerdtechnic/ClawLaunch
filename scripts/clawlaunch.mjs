#!/usr/bin/env node
/**
 * clawlaunch — NT-ClawLaunch CLI
 *
 * Usage:
 *   clawlaunch gateway:start    啟動 OpenClaw Gateway
 *   clawlaunch gateway:stop     停止 OpenClaw Gateway
 *   clawlaunch gateway:restart  重啟 OpenClaw Gateway
 *   clawlaunch health           確認 App 是否在執行
 *
 * Exit Codes:
 *   0  成功
 *   1  執行錯誤
 *   2  用法錯誤 / 未知命令
 *   69 NT-ClawLaunch App 未執行
 */

import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';

// ── 常數 ─────────────────────────────────────────────────────────────────────

const PORT_FILE = path.join(os.homedir(), '.clawlaunch', '.cli-server.port');
const TIMEOUT_MS = 30000;

// ── 工具函式 ──────────────────────────────────────────────────────────────────

async function readPort() {
  try {
    const content = await fs.readFile(PORT_FILE, 'utf-8');
    const port = parseInt(content.trim(), 10);
    if (isNaN(port) || port < 1 || port > 65535) throw new Error('invalid port');
    return port;
  } catch {
    console.error('NT-ClawLaunch is not running.\nPlease start the app first.');
    console.error(`(port file not found: ${PORT_FILE})`);
    process.exit(69);
  }
}

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ code: 1, stdout: data, stderr: '' }); }
      });
    });
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function execCommand(port, command) {
  const body = JSON.stringify({ command });
  return httpRequest({
    hostname: '127.0.0.1',
    port,
    path: '/exec',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
}

async function getHealth(port) {
  return httpRequest({
    hostname: '127.0.0.1',
    port,
    path: '/health',
    method: 'GET',
  });
}

function formatResult(result) {
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return JSON.stringify(parsed, null, 2);
  } catch {
    return result.stdout || '';
  }
}

// ── 主程式 ────────────────────────────────────────────────────────────────────

const COMMAND = process.argv[2];
const VALID_COMMANDS = ['gateway:start', 'gateway:stop', 'gateway:restart', 'health'];

if (!COMMAND || COMMAND === '--help' || COMMAND === '-h') {
  console.log('Usage: clawlaunch <command>\n');
  console.log('Commands:');
  console.log('  gateway:start    Start OpenClaw Gateway');
  console.log('  gateway:stop     Stop OpenClaw Gateway');
  console.log('  gateway:restart  Restart OpenClaw Gateway');
  console.log('  health           Check if NT-ClawLaunch is running');
  process.exit(COMMAND ? 0 : 2);
}

if (!VALID_COMMANDS.includes(COMMAND)) {
  console.error(`Unknown command: ${COMMAND}`);
  console.error(`Available commands: ${VALID_COMMANDS.join(', ')}`);
  process.exit(2);
}

const port = await readPort();

if (COMMAND === 'health') {
  const result = await getHealth(port).catch((err) => {
    console.error('NT-ClawLaunch CLI server is not responding:', err.message);
    process.exit(69);
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// Execution status hint for long-running commands
if (COMMAND === 'gateway:start') {
  process.stderr.write('Starting OpenClaw Gateway...\n');
} else if (COMMAND === 'gateway:stop') {
  process.stderr.write('Stopping OpenClaw Gateway...\n');
} else if (COMMAND === 'gateway:restart') {
  process.stderr.write('Restarting OpenClaw Gateway (this may take up to 15s)...\n');
}

const result = await execCommand(port, COMMAND).catch((err) => {
  console.error('Failed to connect to NT-ClawLaunch:', err.message);
  process.exit(69);
});

const output = formatResult(result);
if (output) process.stdout.write(output + '\n');
if (result.stderr) process.stderr.write(result.stderr + '\n');

process.exit(result.code ?? 0);
