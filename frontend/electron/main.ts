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

/**
 * 深度解析 OpenClaw 配置檔
 * 支援從 agents.defaults.model.primary 提取模型，並從 auth.profiles 提取金鑰
 */
function parseOpenClawConfig(content: string) {
    try {
        const parsed = JSON.parse(content);
        let apiKey = parsed.apiKey || parsed.api_key || '';
        let model = parsed.model || '';
        let workspace = '';
        let botToken = '';

        // 1. 提取模型 (OpenClaw 標準路徑)
        if (!model && parsed.agents?.defaults?.model?.primary) {
            model = parsed.agents.defaults.model.primary;
        }

        // 2. 提取 Workspace (OpenClaw 標準路徑)
        if (parsed.agents?.defaults?.workspace) {
            workspace = parsed.agents.defaults.workspace;
        }

        // 3. 提取 Bot Token (OpenClaw 標準路徑)
        if (parsed.channels?.telegram?.botToken) {
            botToken = parsed.channels.telegram.botToken;
        }

        // 4. 提取 API Key (遍歷 profiles)
        if (!apiKey && parsed.auth?.profiles) {
            for (const key in parsed.auth.profiles) {
                const profile = parsed.auth.profiles[key];
                const possibleKey = profile.apiKey || profile.api_key || profile.token || profile.bearer;
                if (possibleKey && typeof possibleKey === 'string' && possibleKey.length > 5) {
                    apiKey = possibleKey;
                    break;
                }
            }
        }

        return { apiKey, model, workspace, botToken };
    } catch (e) {
        return { apiKey: '', model: '', workspace: '', botToken: '' };
    }
}

/**
 * 掃描配置目錄中的已安裝技能
 */
async function scanInstalledSkills(configPath: string): Promise<string[]> {
    if (!configPath) return [];
    try {
        const skillsDir = path.join(configPath, 'skills');
        const stats = await fs.stat(skillsDir);
        if (stats.isDirectory()) {
            const items = await fs.readdir(skillsDir);
            const installed = [];
            for (const item of items) {
                const fullPath = path.join(skillsDir, item);
                const itemStats = await fs.stat(fullPath);
                if (itemStats.isDirectory()) {
                    installed.push(item);
                }
            }
            return installed;
        }
    } catch (e) {}
    return [];
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

  if (fullCommand === 'detect:paths') {
    const home = app.getPath('home');
    const possibleWorkspace = path.join(home, '.openclaw');
    const searchScopes = [home, path.join(home, 'Desktop'), path.join(home, 'Documents'), path.dirname(app.getAppPath())];

    let corePath = '';
    let configPath = '';
    let workspacePath = '';
    let existingConfig: any = {};

    try {
        await fs.access(possibleWorkspace);
        workspacePath = possibleWorkspace;
    } catch(e) {}

    const possibleConfigPath = path.join(possibleWorkspace, 'openclaw.json');
    try {
        await fs.access(possibleConfigPath);
        configPath = possibleWorkspace;
        const content = await fs.readFile(possibleConfigPath, 'utf-8');
        existingConfig = parseOpenClawConfig(content);
        if (existingConfig.workspace) workspacePath = existingConfig.workspace;
    } catch(e) {}

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

    let installedSkills: string[] = [];
    if (configPath) {
        installedSkills = await scanInstalledSkills(configPath);
    }

    return { 
        code: 0, 
        stdout: JSON.stringify({ corePath, configPath, workspacePath: workspacePath || possibleWorkspace, existingConfig: { ...existingConfig, installedSkills } }) 
    };
  }

  if (fullCommand.startsWith('config:probe')) {
    const probePath = fullCommand.replace('config:probe ', '').trim();
    try {
        const stats = await fs.stat(probePath);
        let finalConfigFilePath = '';
        let finalConfigDirPath = '';
        
        if (stats.isDirectory()) {
            const possible = path.join(probePath, 'openclaw.json');
            try {
                await fs.access(possible);
                finalConfigFilePath = possible;
                finalConfigDirPath = probePath;
            } catch(e) {
                const possibleClaw = path.join(probePath, 'clawdbot.json');
                try {
                    await fs.access(possibleClaw);
                    finalConfigFilePath = possibleClaw;
                    finalConfigDirPath = probePath;
                } catch(e2) {}
            }
        } else if (probePath.endsWith('.json')) {
            finalConfigFilePath = probePath;
            finalConfigDirPath = path.dirname(probePath);
        }

        if (finalConfigFilePath) {
            const content = await fs.readFile(finalConfigFilePath, 'utf-8');
            const configData = parseOpenClawConfig(content);
            const installedSkills = await scanInstalledSkills(finalConfigDirPath);
            return {
                code: 0,
                stdout: JSON.stringify({ ...configData, configPath: finalConfigDirPath, installedSkills })
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
      resolve({ code: code ?? 0, stdout, stderr, exitCode: code ?? 0 });
    });
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
