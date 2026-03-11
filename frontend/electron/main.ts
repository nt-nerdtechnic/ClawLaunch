import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let clawProcess: any = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 320,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#020617',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
}

app.whenReady().then(createWindow);

ipcMain.on('window:resize', (event, mode: 'mini' | 'expanded') => {
  if (!mainWindow) return;
  if (mode === 'mini') {
    mainWindow.setSize(320, 550, true);
    mainWindow.setResizable(false);
  } else {
    mainWindow.setSize(1100, 750, true);
    mainWindow.setResizable(true);
  }
});

ipcMain.handle('shell:exec', async (_event, command: string, args: string[] = []) => {
  // Support single string commands with && or cd
  const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;
  
  if (fullCommand.includes('gateway start')) {
    if (clawProcess) return { code: 0, stdout: 'Gateway already running' };
    clawProcess = spawn(fullCommand, { shell: true });
    clawProcess.stdout.on('data', (data: any) => {
      mainWindow?.webContents.send('shell:stdout', { data: data.toString(), source: 'stdout' });
    });
    clawProcess.stderr.on('data', (data: any) => {
      mainWindow?.webContents.send('shell:stdout', { data: data.toString(), source: 'stderr' });
    });
    clawProcess.on('exit', (code: number) => {
      mainWindow?.webContents.send('shell:stdout', { data: `Process exited with code ${code}`, source: 'stderr' });
      clawProcess = null;
    });
    return { code: 0, stdout: 'Gateway starting...' };
  }

  if (fullCommand.includes('gateway stop')) {
    if (clawProcess) {
      clawProcess.kill();
      clawProcess = null;
      return { code: 0, stdout: 'Gateway stopped' };
    }
    return { code: 0, stdout: 'Gateway not running' };
  }

  // Analytics helper
  if (fullCommand.startsWith('cat') && fullCommand.includes('log.jsonl')) {
    const logPath = fullCommand.split(' ')[1].replace(/^~/, app.getPath('home'));
    try {
      const content = await fs.readFile(logPath, 'utf-8');
      return { code: 0, stdout: content, stderr: '' };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e.message };
    }
  }

  return new Promise((resolve) => {
    const child = spawn(fullCommand, { shell: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      mainWindow?.webContents.send('shell:stdout', { data: chunk, source: 'stdout' });
    });
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      mainWindow?.webContents.send('shell:stdout', { data: chunk, source: 'stderr' });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr, exitCode: code ?? 0 }); // fixed: was code: stdout
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
