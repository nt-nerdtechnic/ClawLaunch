import { ipcMain, dialog, shell, app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import net from 'node:net';
import { spawn } from 'node:child_process';
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

  ipcMain.handle('fs:read-file-encoded', async (_event, filePath: string, encoding: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, content: '', error: 'Missing file path' };
      }
      const resolved = filePath.startsWith('~/')
        ? path.join(app.getPath('home'), filePath.slice(2))
        : filePath;
      const buf = await fs.readFile(resolved);
      const decoder = new TextDecoder(encoding || 'utf-8', { fatal: false });
      return { success: true, content: decoder.decode(buf) };
    } catch (e) {
      return { success: false, content: '', error: (e as Error).message };
    }
  });

  ipcMain.handle('fs:detect-encoding', async (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { encoding: 'utf-8', confidence: 'low', method: 'error' };
      }
      const resolved = filePath.startsWith('~/')
        ? path.join(app.getPath('home'), filePath.slice(2))
        : filePath;

      const SAMPLE = 8192;
      const fh = await fs.open(resolved, 'r');
      const buf = Buffer.alloc(SAMPLE);
      const { bytesRead } = await fh.read(buf, 0, SAMPLE, 0);
      await fh.close();

      if (bytesRead === 0) return { encoding: 'utf-8', confidence: 'high', method: 'empty' };
      const s = buf.subarray(0, bytesRead);

      // ── 1. BOM ───────────────────────────────────────────────────────────────
      if (bytesRead >= 3 && s[0] === 0xEF && s[1] === 0xBB && s[2] === 0xBF)
        return { encoding: 'utf-8',    confidence: 'high', method: 'bom' };
      if (bytesRead >= 4 && s[0] === 0xFF && s[1] === 0xFE && s[2] === 0x00 && s[3] === 0x00)
        return { encoding: 'utf-32le', confidence: 'high', method: 'bom' };
      if (bytesRead >= 4 && s[0] === 0x00 && s[1] === 0x00 && s[2] === 0xFE && s[3] === 0xFF)
        return { encoding: 'utf-32be', confidence: 'high', method: 'bom' };
      if (bytesRead >= 2 && s[0] === 0xFF && s[1] === 0xFE)
        return { encoding: 'utf-16le', confidence: 'high', method: 'bom' };
      if (bytesRead >= 2 && s[0] === 0xFE && s[1] === 0xFF)
        return { encoding: 'utf-16be', confidence: 'high', method: 'bom' };

      // ── 2. Null-byte → binary or UTF-16 without BOM ───────────────────────
      const probe = Math.min(bytesRead, 512);
      let nulls = 0;
      for (let i = 0; i < probe; i++) if (s[i] === 0) nulls++;
      if (nulls / probe > 0.05) return { encoding: 'binary', confidence: 'high', method: 'null-bytes' };

      // ── 3. Valid UTF-8 structural check ───────────────────────────────────
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(s);
        return { encoding: 'utf-8', confidence: 'high', method: 'utf8-valid' };
      } catch { /* fall through to CJK heuristics */ }

      // ── 4. CJK byte-pattern scoring ───────────────────────────────────────
      let gbkOnly = 0; // lead 0x81–0xA0 — GBK exclusive range
      let big5    = 0; // Big5-valid pairs (lead 0xA1–0xFE, trail in Big5 range)
      let sjis    = 0; // Shift-JIS valid pairs
      let euc     = 0; // EUC-JP / EUC-KR pairs (lead 0xA1–0xFE, trail 0xA1–0xFE)

      for (let i = 0; i < bytesRead - 1; i++) {
        const b1 = s[i], b2 = s[i + 1];
        if (b1 < 0x80) continue;

        // Shift-JIS: lead 0x81–0x9F or 0xE0–0xFC; trail 0x40–0x7E or 0x80–0xFC
        if ((b1 >= 0x81 && b1 <= 0x9F) || (b1 >= 0xE0 && b1 <= 0xFC)) {
          if ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0x80 && b2 <= 0xFC)) { sjis++; i++; continue; }
        }
        // EUC: lead 0xA1–0xFE, trail 0xA1–0xFE
        if (b1 >= 0xA1 && b1 <= 0xFE && b2 >= 0xA1 && b2 <= 0xFE) { euc++; i++; continue; }
        // GBK: lead 0x81–0xFE, trail 0x40–0xFE (excl 0x7F)
        if (b1 >= 0x81 && b1 <= 0xFE && b2 >= 0x40 && b2 <= 0xFE && b2 !== 0x7F) {
          if (b1 <= 0xA0) { gbkOnly++; }
          // Big5-compatible trail: 0x40–0x7E or 0xA1–0xFE; lead must be ≥0xA1
          else if (b1 >= 0xA1 && ((b2 >= 0x40 && b2 <= 0x7E) || (b2 >= 0xA1 && b2 <= 0xFE))) { big5++; }
          i++; continue;
        }
      }

      const total = gbkOnly + big5 + sjis + euc;
      if (total > 0) {
        if (sjis > gbkOnly + big5 + euc)    return { encoding: 'shift-jis', confidence: 'medium', method: 'heuristic' };
        if (gbkOnly > 0)                    return { encoding: 'gb18030',   confidence: 'medium', method: 'heuristic' };
        if (big5 > euc)                     return { encoding: 'big5',      confidence: 'medium', method: 'heuristic' };
        return { encoding: 'euc-jp', confidence: 'low', method: 'heuristic' };
      }

      // ── 5. 8-bit fallback ─────────────────────────────────────────────────
      return { encoding: 'windows-1252', confidence: 'low', method: 'fallback' };
    } catch (e) {
      return { encoding: 'utf-8', confidence: 'low', method: 'error', error: (e as Error).message };
    }
  });

  ipcMain.handle('fs:read-file-base64', async (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, dataUrl: '', error: 'Missing file path' };
      }
      const resolved = filePath.startsWith('~/')
        ? path.join(app.getPath('home'), filePath.slice(2))
        : filePath;
      const data = await fs.readFile(resolved);
      const ext = path.extname(resolved).toLowerCase().slice(1);
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
        ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif',
      };
      const mime = mimeMap[ext] ?? 'image/png';
      return { success: true, dataUrl: `data:${mime};base64,${data.toString('base64')}` };
    } catch (e: unknown) {
      return { success: false, dataUrl: '', error: (e as Error).message };
    }
  });

  ipcMain.handle('browser:launch-chrome-debug', async (_event, port: number) => {
    const portNum = Math.max(1024, Math.min(65535, Number(port) || 9222));
    const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    const home = app.getPath('home');
    // Chrome forbids --remote-debugging-port with the default profile dir.
    // Use a dedicated non-default dir so DevTools is allowed.
    const userDataDir = `${home}/Library/Application Support/Google/ChromeDebugging`;

    try {
      // Step 1: Force-kill all Chrome processes (SIGKILL)
      await ctx.runShellCommand('pkill -9 -f "Google Chrome" 2>/dev/null; true');

      // Step 2: Fixed wait then poll until Chrome is gone (max 5s)
      await sleep(1500);
      for (let i = 0; i < 7; i++) {
        const check = await ctx.runShellCommand('pgrep -f "Google Chrome" 2>/dev/null; true');
        if (!check.stdout.trim()) break;
        await sleep(500);
      }

      // Step 3: Remove SingletonLock/Cookie so Chrome won't skip debug flags
      await ctx.runShellCommand(
        `rm -f '${userDataDir}/SingletonLock' '${userDataDir}/SingletonCookie' 2>/dev/null; true`
      );
      await sleep(300);

      // Step 4: Relaunch Chrome with remote debugging and original user data dir
      const child = spawn(chromePath, [
        `--remote-debugging-port=${portNum}`,
        `--user-data-dir=${userDataDir}`,
        '--no-first-run',
      ], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      return { success: true, port: portNum };
    } catch (e) {
      return { success: false, port: portNum, error: (e as Error).message };
    }
  });

  ipcMain.handle('browser:check-chrome-debug', async (_event, port: number) => {
    const portNum = Math.max(1024, Math.min(65535, Number(port) || 9222));
    // lsof requires elevated perms on macOS 15; use curl against the DevTools endpoint instead
    const res = await ctx.runShellCommand(`curl -s --max-time 2 http://localhost:${portNum}/json/version`);
    const running = res.code === 0 && res.stdout.trim().length > 0;
    return { running, port: portNum };
  });
}
