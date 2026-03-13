import { app, BrowserWindow, ipcMain, dialog } from 'electron';
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

ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  });
  if (result.canceled) return null;
  return result.filePaths[0];
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

  // Config persistence handler
  if (fullCommand.startsWith('config:write')) {
    try {
      const configStr = fullCommand.replace('config:write ', '');
      const config = JSON.parse(configStr);
      const configPath = path.join(app.getPath('userData'), 'config.json');
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      return { code: 0, stdout: `Config saved to ${configPath}`, stderr: '' };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e.message };
    }
  }

  if (fullCommand === 'config:read') {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      return { code: 0, stdout: content, stderr: '' };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: 'No config file found' };
    }
  }

  // Version Check Handler
  if (fullCommand === 'version:check') {
    return new Promise((resolve) => {
      // Execute git rev-parse HEAD to get local version and compare with origin/main
      const cmd = 'git rev-parse --short HEAD && git ls-remote origin main | cut -f1 | cut -c1-7';
      const child = spawn(cmd, { shell: true });
      let output = '';
      child.stdout.on('data', d => output += d.toString());
      child.on('close', (code) => {
        const parts = output.trim().split('\n');
        const local = parts[0] || 'unknown';
        const remote = parts[1] || local;
        resolve({ code: 0, stdout: JSON.stringify({ local, remote, hasUpdate: local !== remote }) });
      });
    });
  }

  // Execute Update Handler
  if (fullCommand === 'execute:update') {
    return new Promise((resolve) => {
      const cmd = 'git pull && pnpm install';
      const child = spawn(cmd, { shell: true });
      child.stdout.on('data', d => mainWindow?.webContents.send('shell:stdout', { data: d.toString(), source: 'stdout' }));
      child.stderr.on('data', d => mainWindow?.webContents.send('shell:stdout', { data: d.toString(), source: 'stderr' }));
      child.on('close', code => resolve({ code: code ?? 0, stdout: 'Update complete' }));
    });
  }

  // Path Discovery Handler
  if (fullCommand === 'detect:paths') {
    const home = app.getPath('home');
    const possibleWorkspace = path.join(home, '.openclaw');
    const searchScopes = [
        home,
        path.join(home, 'Desktop'),
        path.join(home, 'Documents'),
        path.dirname(app.getAppPath())
    ];

    let corePath = '';
    let configPath = '';
    let workspacePath = '';
    let existingConfig: any = {};

    // 1. 偵測工作區 (Workspace) - 預設 ~/.openclaw
    try {
        await fs.access(possibleWorkspace);
        workspacePath = possibleWorkspace;
    } catch(e) {}

    // 2. 偵測設定區 (Config) - 尋找 openclaw.json
    const possibleConfigPath = path.join(possibleWorkspace, 'openclaw.json');
    try {
        await fs.access(possibleConfigPath);
        configPath = possibleConfigPath;
        // 嘗試讀取現有核心配置
        const content = await fs.readFile(possibleConfigPath, 'utf-8');
        const parsed = JSON.parse(content);
        existingConfig.apiKey = parsed.apiKey || parsed.api_key;
        existingConfig.model = parsed.model;
    } catch(e) {}

    // 3. 偵測主核心區 (Core) - 尋找 clawdbot-main 或 openclaw
    for (const scope of searchScopes) {
        try {
            const files = await fs.readdir(scope);
            for (const file of files) {
                if (file.toLowerCase().includes('clawdbot') || file.toLowerCase().includes('openclaw')) {
                    const fullPath = path.join(scope, file);
                    const stats = await fs.stat(fullPath);
                    if (stats.isDirectory()) {
                        try {
                            await fs.access(path.join(fullPath, 'package.json'));
                            corePath = fullPath;
                            break;
                        } catch(e) {}
                    }
                }
            }
            if (corePath) break;
        } catch(e) {}
    }

    return { 
        code: 0, 
        stdout: JSON.stringify({ 
            corePath, 
            configPath,
            workspacePath: workspacePath || possibleWorkspace,
            existingConfig
        }) 
    };
  }

  // Config Probe Handler (New: for manual path selection)
  if (fullCommand.startsWith('config:probe')) {
    const probePath = fullCommand.replace('config:probe ', '').trim();
    try {
        const stats = await fs.stat(probePath);
        let finalConfigPath = '';
        
        if (stats.isDirectory()) {
            const possible = path.join(probePath, 'openclaw.json');
            try {
                await fs.access(possible);
                finalConfigPath = possible;
            } catch(e) {}
        } else if (probePath.endsWith('openclaw.json')) {
            finalConfigPath = probePath;
        }

        if (finalConfigPath) {
            const content = await fs.readFile(finalConfigPath, 'utf-8');
            const parsed = JSON.parse(content);
            return {
                code: 0,
                stdout: JSON.stringify({
                    apiKey: parsed.apiKey || parsed.api_key || '',
                    model: parsed.model || '',
                    configPath: finalConfigPath
                })
            };
        }
        return { code: 1, stdout: '', stderr: 'No config found at path' };
    } catch(e: any) {
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
