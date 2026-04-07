import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdirSync, unlinkSync } from 'node:fs';
import { loadLocales, t } from './utils/i18n.js';
import { sleep } from './utils/shell-utils.js';
import { acquireConfigPathLock, getActiveLockFilePath } from './services/lock.js';
import {
  initGatewayWatchdog,
  gatewayWatchdog,
  DEFAULT_GATEWAY_WATCHDOG_OPTIONS,
  stopGatewayWatchdog,
  spawnWatchedGatewayProcess,
} from './gateway/watchdog.js';
import {
  initGatewayHttpWatchdog,
  stopGatewayHttpWatchdog,
  startGatewayHttpWatchdog,
} from './gateway/http-watchdog.js';
import {
  initActivityWatcher,
  loadActivityStore,
  startActivityWatcher,
  scanAllSessions,
  scanCronJobs,
  readLauncherConfigPaths,
} from './services/activity-watcher.js';
import { registerChatHandler } from './ipc/chat-handler.js';
import { registerWindowHandler } from './ipc/window-handler.js';
import { registerEventsHandler } from './ipc/events-handler.js';
import { registerUsageHandler } from './ipc/usage-handler.js';
import { registerActivityHandler } from './ipc/activity-handler.js';
import { registerShellExecHandler } from './ipc/shell-exec-handler.js';

// ── Multi-instance support ──────────────────────────────────────────────────
// Isolate userData by PID to prevent Chromium singleton lock causing the second instance to crash.
// However, config.json (user settings) is stored in a fixed path PERSISTENT_CONFIG_DIR,
// so that the previous settings can be read on each restart and won't disappear due to PID changes.
app.setPath('userData', `${app.getPath('userData')}-${process.pid}`);
mkdirSync(app.getPath('userData'), { recursive: true });
// Fixed config directory: platform-specific app data path (e.g. ~/Library/Application Support/NT-ClawLaunch/ on macOS,
// %APPDATA%\NT-ClawLaunch on Windows, ~/.config/NT-ClawLaunch on Linux)
const PERSISTENT_CONFIG_DIR = path.join(
  app.getPath('appData'),
  app.getName().replace(/ /g, '-'),
);
mkdirSync(PERSISTENT_CONFIG_DIR, { recursive: true });
const getClawlaunchFile = () => path.join(app.getPath('home'), '.clawlaunch', 'clawlaunch.json');
// ───────────────────────────────────────────────────────────────────────────

// Suppress EPIPE errors that occur when concurrently/piped launchers close
// the parent stdout/stderr pipe while Electron tries to write to console.
process.stdout?.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') return; });
process.stderr?.on('error', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') return; });
process.on('uncaughtException', (err: NodeJS.ErrnoException) => { if (err.code === 'EPIPE') return; throw err; });

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const activeProcesses = new Set<ReturnType<typeof spawn>>();

const DEV_PORT_RANGE_START = 5173;
const DEV_PORT_RANGE_END = 5185;
const DEV_SERVER_WAIT_MS = 15000;

// ── Renderer messaging ───────────────────────────────────────────────────────

const sendToRenderer = (channel: string, payload: unknown): boolean => {
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

// ── Shell command runner ─────────────────────────────────────────────────────

const runShellCommand = (command: string, timeoutMs = 20000) => new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
  const child = spawn(command, { shell: true });
  activeProcesses.add(child);
  let stdout = '';
  let stderr = '';
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    console.warn(`[runShellCommand] Command timed out after ${timeoutMs}ms: ${command}`);
    
    // Attempt graceful kill then force kill
    if (process.platform === 'win32') {
      child.kill();
    } else {
      child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 1000);
    }
    
    activeProcesses.delete(child);
    resolve({ 
      code: 124, 
      stdout: stdout.trim(), 
      stderr: `${stderr}\n[Timeout] Command took over ${timeoutMs}ms` 
    });
  }, timeoutMs);

  child.stdout.on('data', (data) => { stdout += data.toString(); });
  child.stderr.on('data', (data) => { stderr += data.toString(); });

  child.on('error', (error) => {
    clearTimeout(timer);
    activeProcesses.delete(child);
    if (settled) return;
    settled = true;
    resolve({ code: 1, stdout: stdout.trim(), stderr: stderr || String((error as Error)?.message || error) });
  });

  child.on('close', (code: number) => {
    clearTimeout(timer);
    activeProcesses.delete(child);
    if (settled) return;
    settled = true;
    resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
  });
});

// ── Version validator ────────────────────────────────────────────────────────

function validateVersionRef(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) throw new Error('Invalid version: empty');
  if (value.length > 128) throw new Error('Invalid version: too long');
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) throw new Error(`Invalid version format: ${value}`);
  return value;
}

// ── Dev server utilities ─────────────────────────────────────────────────────

function isDevServerReachable(url: string, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    const req = http.get(`${normalizedUrl}/@vite/client`, (res) => {
      const statusOk = Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300);
      if (!statusOk) { res.resume(); resolve(false); return; }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => { resolve(body.includes('vite') || body.includes('/@react-refresh')); });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

async function resolveDevServerUrl(): Promise<string> {
  const envUrl = process.env.VITE_DEV_SERVER_URL;
  if (envUrl && await isDevServerReachable(envUrl)) return envUrl;

  const deadline = Date.now() + DEV_SERVER_WAIT_MS;
  while (Date.now() < deadline) {
    for (let port = DEV_PORT_RANGE_START; port <= DEV_PORT_RANGE_END; port++) {
      const url = `http://localhost:${port}`;
      if (await isDevServerReachable(url)) return url;
    }
    await sleep(250);
  }
  return `http://localhost:${DEV_PORT_RANGE_START}`;
}

// ── Process lifecycle ────────────────────────────────────────────────────────

function killAllSubprocesses() {
  const stackLines = String(new Error().stack ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const caller = (stackLines[2] ?? stackLines[stackLines.length - 1] ?? 'unknown').replace(/^at\s+/, '');
  const detail = `activeProcessCount=${activeProcesses.size} caller=${caller}`;
  emitShellStdout(`[launcher-trace] ts=${new Date().toISOString()} action=killAllSubprocesses ${detail}\n`, 'stdout');
  console.error(`[launcher-trace] killAllSubprocesses ${detail}`);
  stopGatewayWatchdog('kill-all-subprocesses');
  stopGatewayHttpWatchdog('kill-all-subprocesses');
  for (const proc of activeProcesses) {
    try {
      if (!proc.killed) {
        if (process.platform === 'win32') {
          // Windows 不支援 POSIX signal，直接 kill()
          proc.kill();
        } else {
          proc.kill('SIGTERM');
          setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 2000);
        }
      }
    } catch (e) {
      console.error('Failed to kill subprocess:', e);
    }
  }
  activeProcesses.clear();
}

async function activateConfigPath(newConfigPath: string): Promise<void> {
  const { conflictPid, suggestionPath } = await acquireConfigPathLock(newConfigPath);

  if (conflictPid !== null) {
    const suggestionLine = suggestionPath ? t('main.dialogs.configPathConflict.suggestion', { path: suggestionPath }) : '';
    const dialogOptions = {
      type: 'warning' as const,
      title: t('main.dialogs.configPathConflict.title'),
      message: t('main.dialogs.configPathConflict.message', {
        pid: conflictPid,
        path: String(newConfigPath || '').trim(),
        suggestion: suggestionLine,
      }),
      buttons: [t('main.dialogs.configPathConflict.ok')],
    };
    const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (parentWindow) {
      dialog.showMessageBox(parentWindow, dialogOptions).catch(() => {});
    } else {
      dialog.showMessageBox(dialogOptions).catch(() => {});
    }
  }
}

// ── Window creation ──────────────────────────────────────────────────────────

async function createWindow() {
  const iconPath = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '../public/icon.png')
    : path.join(__dirname, 'icon.png');

  // titleBarStyle: 'hiddenInset' is macOS-only; Windows/Linux use 'hidden' with
  // frame:false to achieve a frameless window while still allowing dragging.
  const titleBarStyle: 'hiddenInset' | 'hidden' =
    process.platform === 'darwin' ? 'hiddenInset' : 'hidden';

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 320,
    minHeight: 500,
    titleBarStyle,
    ...(process.platform !== 'darwin' ? { frame: false } : {}),
    backgroundColor: '#020617',
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow renderer to directly fetch localhost gateway (HTTP/SSE)
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

  mainWindow.once('ready-to-show', () => { mainWindow?.show(); });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await loadLocales();

  // Inject dependencies into gateway modules
  initGatewayWatchdog(emitShellStdout, runShellCommand, activeProcesses);
  initGatewayHttpWatchdog(emitShellStdout, runShellCommand);

  // Inject dependencies into activity watcher
  initActivityWatcher({ persistentConfigDir: PERSISTENT_CONFIG_DIR, getClawlaunchFile });

  // createWindow must be called (not awaited) before registerShellExecHandler
  // so that mainWindow is synchronously set before handler context is captured.
  createWindow().catch((err) => { console.error('Failed to create window:', err); });

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

  // Register all IPC handlers
  const baseCtx = { sendToRenderer, emitShellStdout, runShellCommand };

  registerChatHandler(baseCtx);
  registerWindowHandler({ getMainWindow: () => mainWindow, runShellCommand });
  registerEventsHandler();
  registerUsageHandler();
  registerActivityHandler();
  registerShellExecHandler({
    mainWindow,
    activeProcesses,
    sendToRenderer,
    emitShellStdout,
    runShellCommand,
    activateConfigPath,
    spawnWatchedGatewayProcess,
    stopGatewayWatchdog,
    stopGatewayHttpWatchdog,
    startGatewayHttpWatchdog,
    gatewayWatchdog: gatewayWatchdog as unknown as Record<string, unknown>,
    defaultGatewayOptions: DEFAULT_GATEWAY_WATCHDOG_OPTIONS as unknown as Record<string, unknown>,
    readLauncherConfigPaths,
    persistentConfigDir: PERSISTENT_CONFIG_DIR,
    getClawlaunchFile,
    validateVersionRef,
    killAllSubprocesses,
    startActivityWatcher,
  });
});

app.on('before-quit', () => {
  console.error(`[launcher-trace] ts=${new Date().toISOString()} action=before-quit`);
  killAllSubprocesses();
  const lockPath = getActiveLockFilePath();
  if (lockPath) {
    try { unlinkSync(lockPath); } catch {}
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
