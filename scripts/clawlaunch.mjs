#!/usr/bin/env node
/**
 * clawlaunch — NT-ClawLaunch CLI
 *
 * Usage:
 *   clawlaunch <command> [--json]
 *
 * Commands:
 *   health           Check if NT-ClawLaunch is running
 *   gateway:start    Start OpenClaw Gateway (background + watchdog)
 *   gateway:stop     Stop OpenClaw Gateway and all watchdogs
 *   gateway:restart  Restart the gateway (stop → wait → start)
 *   commands         List all available commands (add --json for machine-readable output)
 *
 * Exit Codes:
 *   0  success
 *   1  execution error
 *   2  usage error / unknown command
 *   69 NT-ClawLaunch app is not running
 *   78 configuration error (onboarding not complete)
 *
 * Agent Workflow:
 *   1. Run `clawlaunch health` first — exit 69 means the app is not open.
 *   2. Run `clawlaunch gateway:start` to start the gateway.
 *   3. Run `clawlaunch gateway:stop` to shut it down cleanly.
 *   4. Run `clawlaunch commands --json` to discover all commands programmatically.
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

async function getCommands(port) {
  return httpRequest({
    hostname: '127.0.0.1',
    port,
    path: '/commands',
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
const FLAGS = process.argv.slice(3);
const JSON_FLAG = FLAGS.includes('--json');
const VALID_COMMANDS = ['gateway:start', 'gateway:stop', 'gateway:restart', 'health', 'commands'];

if (!COMMAND || COMMAND === '--help' || COMMAND === '-h') {
  console.log('Usage: clawlaunch <command> [--json]\n');
  console.log('Commands:');
  console.log('  health              Check if NT-ClawLaunch is running');
  console.log('  gateway:start       Start OpenClaw Gateway (background + watchdog)');
  console.log('  gateway:stop        Stop OpenClaw Gateway and all watchdogs');
  console.log('  gateway:restart     Restart the gateway (stop → wait → start)');
  console.log('  commands            List all available commands');
  console.log('  commands --json     Machine-readable command list (for agents)');
  console.log('\nExit Codes:');
  console.log('  0   success');
  console.log('  1   execution error');
  console.log('  2   usage error / unknown command');
  console.log('  69  NT-ClawLaunch app is not running');
  console.log('  78  configuration error (onboarding not complete)');
  console.log('\nAgent Workflow:');
  console.log('  1. clawlaunch health           → confirm app is open (exit 69 = not running)');
  console.log('  2. clawlaunch gateway:start    → start the gateway');
  console.log('  3. clawlaunch gateway:stop     → shut down cleanly');
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

if (COMMAND === 'commands') {
  const result = await getCommands(port).catch((err) => {
    console.error('NT-ClawLaunch CLI server is not responding:', err.message);
    process.exit(69);
  });
  if (JSON_FLAG) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`NT-ClawLaunch v${result.version ?? '?'} — Available Commands\n`);
    for (const cmd of result.commands ?? []) {
      console.log(`  ${cmd.command.padEnd(22)} ${cmd.description}`);
      if (cmd.when)  console.log(`  ${''.padEnd(22)} When: ${cmd.when}`);
      if (cmd.notes) console.log(`  ${''.padEnd(22)} Note: ${cmd.notes}`);
    }
    if (result.workflow?.length) {
      console.log('\nWorkflow:');
      result.workflow.forEach((w, i) => console.log(`  ${i + 1}. ${w}`));
    }
    if (result.exitCodes) {
      console.log('\nExit Codes:');
      for (const [code, meaning] of Object.entries(result.exitCodes)) {
        console.log(`  ${String(code).padEnd(4)} ${meaning}`);
      }
    }
  }
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
