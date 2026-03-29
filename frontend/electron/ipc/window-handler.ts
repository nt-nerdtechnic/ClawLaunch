import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import net from 'node:net';
import { sleep } from '../utils/shell-utils.js';

export interface WindowHandlerContext {
  getMainWindow: () => BrowserWindow | null;
  runShellCommand: (cmd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
}

export function registerWindowHandler(ctx: WindowHandlerContext): void {
  ipcMain.on('window:resize', (_event, mode: 'mini' | 'expanded') => {
    const win = ctx.getMainWindow();
    if (!win) return;
    if (mode === 'mini') {
      win.setSize(320, 550, true);
      win.setResizable(false);
    } else {
      win.setSize(1100, 750, true);
      win.setResizable(true);
    }
  });

  ipcMain.handle('window:get-mode', () => {
    const win = ctx.getMainWindow();
    if (!win) return 'expanded';
    const [w] = win.getSize();
    return w <= 400 ? 'mini' : 'expanded';
  });

  ipcMain.handle('window:set-title', (_event, title: string) => {
    const win = ctx.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.setTitle(String(title || ''));
    }
  });

  ipcMain.handle('dialog:selectDirectory', async () => {
    const win = ctx.getMainWindow();
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    return result.filePaths[0];
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

  ipcMain.handle('shell:kill-port-holder', async (_event, rawPort: number) => {
    const port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { success: false, error: 'Invalid port', port };
    }

    const launchctlLabel = 'ai.openclaw.gateway';
    const uid = (await ctx.runShellCommand('id -u')).stdout.trim();
    if (uid) {
      await ctx.runShellCommand(`launchctl bootout gui/${uid}/${launchctlLabel} 2>/dev/null || true`);
      await sleep(300);
    }

    const lookupRes = await ctx.runShellCommand(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`);
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
      } catch (e) {
        failed.push({ pid, reason: (e as Error)?.message || 'SIGTERM failed' });
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
      } catch (e) {
        failed.push({ pid, reason: (e as Error)?.message || 'SIGKILL failed' });
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
    } catch (e) {
      return { success: false, error: (e as Error).message };
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
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('fs:write-file', async (_event, filePath: string, content: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'Missing file path' };
      }
      const resolved = filePath.startsWith('~/')
        ? path.join(app.getPath('home'), filePath.slice(2))
        : filePath;
      await fs.writeFile(resolved, content, 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });
}
