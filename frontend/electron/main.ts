import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let clawProcess: any = null;
const activeProcesses = new Set<any>();

const DEV_PORT_RANGE_START = 5173;
const DEV_PORT_RANGE_END = 5185;
const DEV_SERVER_WAIT_MS = 15000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isDevServerReachable(url: string, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(Boolean(res.statusCode && res.statusCode < 500));
    });

    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function resolveDevServerUrl(): Promise<string> {
  const envUrl = process.env.VITE_DEV_SERVER_URL;
  if (envUrl && await isDevServerReachable(envUrl)) {
    return envUrl;
  }

  const deadline = Date.now() + DEV_SERVER_WAIT_MS;
  while (Date.now() < deadline) {
    for (let port = DEV_PORT_RANGE_START; port <= DEV_PORT_RANGE_END; port++) {
      const candidate = `http://localhost:${port}`;
      // eslint-disable-next-line no-await-in-loop
      if (await isDevServerReachable(candidate)) {
        return candidate;
      }
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }

  // Fallback for clearer diagnostics in renderer load failure.
  return 'http://localhost:5173';
}

function killAllSubprocesses() {
  for (const proc of activeProcesses) {
    try {
      if (!proc.killed) {
        proc.kill('SIGTERM');
        // 強制殺死如果 SIGTERM 沒用
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 2000);
      }
    } catch (e) {
      console.error('Failed to kill subprocess:', e);
    }
  }
  activeProcesses.clear();
}

async function createWindow() {
  const iconPath = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, '../public/icon.png')
    : path.join(__dirname, 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 320,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#020617',
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
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
        let corePath = '';
        let authChoice = parsed.authChoice || '';

        // 0. 提取 Core Path (如果有的話)
        if (parsed.corePath) corePath = parsed.corePath;

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

        // 4. 提取 API Key (遍歷 profiles) 並推斷 authChoice
        if (!apiKey && parsed.auth?.profiles) {
            for (const key in parsed.auth.profiles) {
                const profile = parsed.auth.profiles[key];
                const possibleKey = profile.apiKey || profile.api_key || profile.token || profile.bearer;
                if (possibleKey && typeof possibleKey === 'string' && possibleKey.length > 5) {
                    apiKey = possibleKey;
                    // 如果沒有明確定義 authChoice，嘗試根據 profile 名稱推斷
                    if (!authChoice) {
                        const lowKey = key.toLowerCase();
                        if (lowKey.includes('anthropic')) authChoice = 'apiKey';
                        else if (lowKey.includes('openai')) authChoice = 'openai-api-key';
                        else if (lowKey.includes('gemini')) authChoice = 'gemini-api-key';
                        else if (lowKey.includes('minimax')) authChoice = 'minimax-api';
                        else if (lowKey.includes('deepseek') || lowKey.includes('ollama')) authChoice = 'ollama';
                    }
                    break;
                }
            }
        }

        // 5. 二次推斷：如果還是沒有 authChoice，根據模型名稱推斷
        if (!authChoice && model) {
            const lowModel = model.toLowerCase();
            if (lowModel.includes('claude')) authChoice = 'apiKey';
            else if (lowModel.includes('gpt')) authChoice = 'openai-api-key';
            else if (lowModel.includes('gemini')) authChoice = 'gemini-api-key';
            else if (lowModel.includes('minimax')) authChoice = 'minimax-api';
            else if (lowModel.includes('ollama')) authChoice = 'ollama';
            else if (lowModel.includes('deepseek')) authChoice = 'ollama';
        }
        
        // 最終保底
        if (!authChoice && apiKey) authChoice = 'apiKey';

        return { apiKey, model, workspace, botToken, corePath, authChoice };
    } catch (e) {
        return { apiKey: '', model: '', workspace: '', botToken: '', corePath: '', authChoice: '' };
    }
}

// 系統級核心技能 (不可異動)
const CORE_SKILLS = [
  { id: 'aesthetic-expert', name: 'Aesthetic Expert', desc: '高端視覺設計與 CSS 專家，專精於精品品牌美學', category: 'Core', details: '提供排版與現代 UI 技術指導。' },
  { id: 'browser-navigator', name: 'Browser Navigator', desc: '瀏覽器自動化與測試專家', category: 'Core', details: '執行 E2E 流程與網頁操作。' },
  { id: 'bug-buster', name: 'Bug Buster', desc: '智能除錯助手', category: 'Core', details: '分析錯誤日誌並提供修復方案。' },
  { id: 'clean-code-architect', name: 'Clean Code Architect', desc: '專案結構設計指導', category: 'Core', details: '確保代碼保持高內聚、低耦合，符合 Clean Architecture。' },
  { id: 'code-review-expert', name: 'Code Review Expert', desc: '專業代碼審查', category: 'Core', details: '寫完程式碼後執行審查，確保符合安全、效能規範。' },
  { id: 'code-translator', name: 'Code Translator', desc: '代碼翻譯與命名規範化工具', category: 'Core', details: '支援中英互轉與變數命名建議。' },
  { id: 'data-analyst', name: 'Data Analyst', desc: 'Excel 與 CSV 數據處理技能', category: 'Core', details: '包含讀取、寫入、清洗與分析。' },
  { id: 'doc-generator', name: 'Doc Generator', desc: '自動生成標準化文檔與註釋', category: 'Core', details: '支援 PHPDoc, JSDoc, Markdown。' },
  { id: 'docker-captain', name: 'Docker Captain', desc: 'Docker 容器管理專家', category: 'Core', details: '協助除錯、服務檢查與配置優化。' },
  { id: 'git-commit-helper', name: 'Git Commit Helper', desc: '自動分析 Git 變動與生成提交訊息', category: 'Core', details: '根據 Conventional Commits 生成帶有 Emoji 的訊息。' },
  { id: 'i18n-manager', name: 'i18n Manager', desc: '多語系同步與管理工具', category: 'Core', details: '確保翻譯完整性與一致性。' },
  { id: 'laravel-expert', name: 'Laravel Expert', desc: 'Laravel 開發專家', category: 'Core', details: '提供最佳實踐、架構指導與代碼生成。' },
  { id: 'pdf-wizard', name: 'PDF Wizard', desc: 'PDF 文件處理技能', category: 'Core', details: '包含文字提取、合併、分割與 OCR 前處理。' },
  { id: 'readme-updater', name: 'Readme Updater', desc: '自動更新專案文件', category: 'Core', details: '保持 README.md 與實際程式碼同步。' },
  { id: 'tailwind-styler', name: 'Tailwind Styler', desc: 'Tailwind CSS 專家', category: 'Core', details: '協助轉換樣式與優化 Class 排序。' },
  { id: 'test-writer', name: 'Test Writer', desc: '自動化測試生成專家', category: 'Core', details: '支援 PHPUnit, Pest, Vitest, Jest。' },
  { id: 'ui-designer', name: 'UI Designer', desc: 'UI/UX 設計輔助專家', category: 'Core', details: '專精於生成介面 Mockup 與素材。' },
  { id: 'wordpress-architect', name: 'WordPress Architect', desc: 'WordPress 核心與架構專家', category: 'Core', details: '專精於主題開發、Hooks 機制與 WP-CLI。' },
];

/**
 * 遞迴複製目錄 (排除 .git, node_modules)
 */
async function copyDir(src: string, dest: string, progressCallback?: (msg: string) => void) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '.git' || entry.name === 'node_modules') continue;
            await copyDir(srcPath, destPath, progressCallback);
        } else {
            if (progressCallback) progressCallback(`Copying ${entry.name}...`);
            await fs.copyFile(srcPath, destPath);
        }
    }
}

/**
 * 從 SKILL.md 解析 YAML Frontmatter (簡單正則匹配)
 */
async function parseSkillMetadata(skillDir: string, fallbackId: string) {
    const defaultMeta = { id: fallbackId, name: fallbackId, desc: '工作區擴充技能', category: 'Plugin', details: '無詳細說明' };
    try {
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        const content = await fs.readFile(skillMdPath, 'utf-8');
        // 嘗試匹配 --- 之間的 yaml 區段
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (match && match[1]) {
            const yamlStr = match[1];
            // 簡易解析 name/description (不依賴 yaml 解析器)
            const nameMatch = yamlStr.match(/name:\s*(.+)/i);
            const descMatch = yamlStr.match(/description:\s*(.+)/i) || yamlStr.match(/desc:\s*(.+)/i);
            
            if (nameMatch) defaultMeta.name = nameMatch[1].replace(/['"]/g, '').trim();
            if (descMatch) defaultMeta.desc = descMatch[1].replace(/['"]/g, '').trim();
        }
    } catch (e) {
        // 如果沒有 SKILL.md 或讀取失敗，回傳預設值
    }
    return defaultMeta;
}

/**
 * 掃描指定目錄下的技能子資料夾 (skills/ 或 extensions/ 皆可)
 */
async function scanSkillsInDir(dir: string): Promise<any[]> {
    const results = [];
    try {
        const stats = await fs.stat(dir);
        if (!stats.isDirectory()) return [];
        const items = await fs.readdir(dir);
        for (const item of items) {
            if (item.startsWith('.')) continue;
            const fullPath = path.join(dir, item);
            try {
                const itemStats = await fs.stat(fullPath);
                if (itemStats.isDirectory()) {
                    const meta = await parseSkillMetadata(fullPath, item);
                    results.push(meta);
                }
            } catch (e) {}
        }
    } catch (e) {}
    return results;
}

/**
 * 掃描多個基礎路徑中的已安裝技能 (包含 skills/ 與 extensions/ 下的技能)
 */
async function scanInstalledSkills(...basePaths: string[]): Promise<any[]> {
    const allIds = new Set<string>();
    const allSkills: any[] = [];

    for (const basePath of basePaths) {
        if (!basePath) continue;
        // 掃描 skills/ 子目錄
        const fromSkills = await scanSkillsInDir(path.join(basePath, 'skills'));
        // 掃描 extensions/ 子目錄 (OpenClaw 的擴充包)
        const extDir = path.join(basePath, 'extensions');
        const fromExtensions: any[] = [];
        try {
            const extItems = await fs.readdir(extDir);
            for (const extPkg of extItems) {
                if (extPkg.startsWith('.')) continue;
                const pkgPath = path.join(extDir, extPkg);
                // extensions 可能直接是技能，也可能是包含 skills/ 的套件
                const nestedSkills = await scanSkillsInDir(path.join(pkgPath, 'skills'));
                if (nestedSkills.length > 0) {
                    fromExtensions.push(...nestedSkills);
                } else {
                    // 直接嘗試當成技能讀取 (e.g. extensions/lobster/SKILL.md)
                    const meta = await parseSkillMetadata(pkgPath, extPkg);
                    fromExtensions.push(meta);
                }
            }
        } catch (e) {}

        for (const skill of [...fromSkills, ...fromExtensions]) {
            if (!allIds.has(skill.id)) {
                allIds.add(skill.id);
                allSkills.push(skill);
            }
        }
    }

    return allSkills;
}


app.whenReady().then(() => {
  createWindow().catch((err) => {
    console.error('Failed to create window:', err);
  });
});

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
      activeProcesses.delete(clawProcess);
    });
    activeProcesses.add(clawProcess);
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
      return { code: 0, stdout: `Config saved to ${configPath}`, stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand === 'config:read') {
    try {
      const configPath = path.join(app.getPath('userData'), 'config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      return { code: 0, stdout: content, stderr: '', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stdout: '', stderr: 'No config file found', exitCode: 1 };
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

    let workspaceSkills: any[] = [];
    if (configPath || corePath) {
        workspaceSkills = await scanInstalledSkills(configPath, corePath);
    }

    return { 
        code: 0, 
        stdout: JSON.stringify({ corePath, configPath, workspacePath: workspacePath || possibleWorkspace, existingConfig: { ...existingConfig, workspaceSkills }, coreSkills: CORE_SKILLS }),
        exitCode: 0
    };
  }

  if (fullCommand === 'skill:import') {
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openDirectory'],
        title: '選擇 OpenClaw 技能資料夾',
      });
      if (result.canceled) return { code: 0, stdout: 'Canceled', exitCode: 0 };
      
      const sourcePath = result.filePaths[0];
      const skillName = path.basename(sourcePath);
      
      // 驗證是否為有效技能
      try {
        await fs.access(path.join(sourcePath, 'SKILL.md'));
      } catch (e) {
        return { code: 1, stderr: '錯誤：所選資料夾內缺少 SKILL.md，不是有效的技能。', exitCode: 1 };
      }

      // 取得目標路徑
      const configPath = path.join(app.getPath('userData'), 'config.json');
      let targetBaseDir = '';
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(content);
        targetBaseDir = config.workspacePath || config.configPath;
      } catch (e) {}
      
      if (!targetBaseDir) {
        // Fallback or ask
        targetBaseDir = path.join(app.getPath('home'), '.openclaw');
      }

      const targetPath = path.join(targetBaseDir, 'skills', skillName);
      
      // 執行複製 (fs.cp 在 Node 16+ 支援)
      await fs.mkdir(path.join(targetBaseDir, 'skills'), { recursive: true });
      await fs.cp(sourcePath, targetPath, { recursive: true });
      
      return { code: 0, stdout: `成功匯入技能：${skillName}`, exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('skill:delete')) {
    try {
      const skillPath = fullCommand.replace('skill:delete ', '').trim();
      if (!skillPath) throw new Error('未提供路徑');
      
      // 防呆：確保路徑內包含 "skills" 以免誤刪重要資料夾
      if (!skillPath.includes('skills')) {
          throw new Error('安全性拒絕：該路徑不符合技能目錄結構規範');
      }

      await fs.rm(skillPath, { recursive: true, force: true });
      return { code: 0, stdout: '技能已成功移除', exitCode: 0 };
    } catch (e: any) {
      return { code: 1, stderr: e.message, exitCode: 1 };
    }
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
            const workspaceSkills = await scanInstalledSkills(finalConfigDirPath, configData.corePath || '');
            return {
                code: 0,
                stdout: JSON.stringify({ ...configData, configPath: finalConfigDirPath, workspaceSkills, coreSkills: CORE_SKILLS }),
                exitCode: 0
            };
        }
        return { code: 1, stdout: '', stderr: 'No config found at path', exitCode: 1 };
    } catch(e: any) {
        return { code: 1, stdout: '', stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('project:check-empty')) {
    const targetPath = fullCommand.replace('project:check-empty ', '').trim();
    try {
        const stats = await fs.stat(targetPath);
        if (!stats.isDirectory()) return { code: 1, stderr: 'Not a directory', exitCode: 1 };
        const files = await fs.readdir(targetPath);
        const isEmpty = files.filter(f => !f.startsWith('.')).length === 0;
        return { code: 0, stdout: JSON.stringify({ isEmpty }), exitCode: 0 };
    } catch (e: any) {
        if (e.code === 'ENOENT') {
            return { code: 0, stdout: JSON.stringify({ isEmpty: true, notExist: true }), exitCode: 0 };
        }
        return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('project:get-versions')) {
    try {
        const repoUrl = 'https://github.com/openclaw/openclaw.git';
        return new Promise((resolve) => {
            const gitProcess = spawn(`git ls-remote --tags ${repoUrl}`, { shell: true });
            let stdout = '';
            gitProcess.stdout.on('data', (data) => stdout += data.toString());
            gitProcess.on('close', (code) => {
                if (code !== 0) {
                    resolve({ code: 0, stdout: JSON.stringify(['main']), exitCode: 0 }); // Fallback
                    return;
                }
                const tags = stdout
                    .split('\n')
                    .filter(line => line.includes('refs/tags/'))
                    .map(line => line.split('refs/tags/')[1].replace('^{}', ''))
                    .filter((v, i, a) => a.indexOf(v) === i) // 去重
                    .reverse(); // 讓最新的版本在前
                resolve({ code: 0, stdout: JSON.stringify(['main', ...tags]), exitCode: 0 });
            });
        });
    } catch (e: any) {
        return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  if (fullCommand === 'process:kill-all') {
    killAllSubprocesses();
    return { code: 0, stdout: 'All tracked subprocesses killed', exitCode: 0 };
  }

  if (fullCommand.startsWith('project:initialize')) {
    try {
        const payloadStr = fullCommand.replace('project:initialize ', '').trim();
        let { corePath, configPath, workspacePath, version, method } = JSON.parse(payloadStr);

        const targetVersion = version || 'main';
        const downloadMethod = method || 'git'; // 'git' or 'zip'

        const checkAndWrap = async (dirPath: string, subName: string) => {
            try {
                await fs.mkdir(dirPath, { recursive: true });
                const files = await fs.readdir(dirPath);
                const isEmpty = files.filter(f => !f.startsWith('.')).length === 0;
                return isEmpty ? dirPath : path.join(dirPath, subName);
            } catch (e) {
                return path.join(dirPath, subName);
            }
        };

        // 預檢三區路徑
        const finalCorePath = await checkAndWrap(corePath, 'openclaw');
        const finalConfigPath = await checkAndWrap(configPath, '.openclaw');
        const finalWorkspacePath = await checkAndWrap(workspacePath, 'openclaw-workspace');

        // 1. 下載核心原始碼
        const repoUrl = 'https://github.com/openclaw/openclaw.git';
        const tarballUrl = `https://github.com/openclaw/openclaw/tarball/${targetVersion}`;
        
        mainWindow?.webContents.send('shell:stdout', { data: `>>> Initializing paths for version ${targetVersion} via ${downloadMethod}...\n`, source: 'stdout' });
        
        await fs.mkdir(finalCorePath, { recursive: true });

        return new Promise((resolve) => {
            let childProcess: any;

            const wrapInTerminal = (cmd: string, title: string) => {
                // 1. 轉義雙引號以符合 AppleScript 語法 (do script "...")
                const escapedCmd = cmd.replace(/"/g, '\\"');
                
                // 2. 構建互動式指令，加入 read 停留防止閃退
                const interactiveCmd = `clear; echo "🚀 正在執行：${title}"; ${escapedCmd}; echo "\n程序執行完畢。"; read -p "按 Enter 鍵關閉視窗..."`;
                
                // 3. 封裝為 AppleScript
                const appleScript = `tell application "Terminal" to do script "${interactiveCmd.replace(/"/g, '\\"')}"\ntell application "Terminal" to activate`;
                
                // 4. 對外層 Shell 使用單引號包裹，並處理單引號轉義
                const escapedAppleScript = appleScript.replace(/'/g, "'\\''");
                return `osascript -e '${escapedAppleScript}'`;
            };

            if (downloadMethod === 'zip') {
                const actualCmd = `curl -L "${tarballUrl}" | tar -xz --strip-components=1 -C "${finalCorePath}"`;
                // 改回直接執行，不使用 osascript，以便串流日誌到 UI 的「小視窗」
                childProcess = spawn(actualCmd, { shell: true });
            } else {
                const versionArgs = `--branch ${targetVersion} --depth 1 --single-branch`;
                const isSubDir = finalCorePath !== corePath;
                const gitCmd = isSubDir 
                    ? `git clone ${repoUrl} ${versionArgs} "${path.basename(finalCorePath)}"` 
                    : `git clone ${repoUrl} ${versionArgs} .`;
                const workingDir = isSubDir ? corePath : finalCorePath;

                const actualCmd = `cd "${workingDir.replace(/"/g, '\\"')}" && ${gitCmd}`;
                childProcess = spawn(actualCmd, { shell: true });
            }

            activeProcesses.add(childProcess);

            childProcess.stdout.on('data', (data: any) => {
                mainWindow?.webContents.send('shell:stdout', { data: data.toString(), source: 'stdout' });
            });

            childProcess.stderr.on('data', (data: any) => {
                mainWindow?.webContents.send('shell:stdout', { data: data.toString(), source: 'stderr' });
            });

            childProcess.on('error', (err: any) => {
                resolve({ code: 1, stderr: `Spawn error: ${err.message}`, exitCode: 1 });
            });

            childProcess.on('close', async (code: number) => {
                if (code !== 0) {
                    const errorMsg = downloadMethod === 'zip' 
                        ? `Download failed (code ${code}). Check your network connection.`
                        : `Git clone failed (code ${code}). Try switching to "ZIP" method or check your git/network.`;
                    resolve({ code: 1, stderr: errorMsg, exitCode: 1 });
                    return;
                }

                // [NEW] 自動清理 Git 跡象 (僅保留純核心代碼)
                if (downloadMethod === 'git') {
                    const gitDirPath = path.join(finalCorePath, '.git');
                    try {
                        mainWindow?.webContents.send('shell:stdout', { data: `>>> Detaching from Git (Cleaning up .git directory)...\n`, source: 'stdout' });
                        await fs.rm(gitDirPath, { recursive: true, force: true });
                    } catch (e) {
                        mainWindow?.webContents.send('shell:stdout', { data: `>>> Note: Could not remove .git folder, skipping...\n`, source: 'stdout' });
                    }
                }

                try {
                    // 2. 初始化 Config 目錄與 openclaw.json
                    mainWindow?.webContents.send('shell:stdout', { data: `>>> Initializing config at ${finalConfigPath}...\n`, source: 'stdout' });
                    await fs.mkdir(finalConfigPath, { recursive: true });
                    
                    const initialConfig = {
                        version: "2026.3.9",
                        corePath: finalCorePath,
                        agents: {
                            defaults: {
                                workspace: finalWorkspacePath
                            }
                        }
                    };
                    await fs.writeFile(path.join(finalConfigPath, 'openclaw.json'), JSON.stringify(initialConfig, null, 2));

                    // 3. 初始化 Workspace 目錄
                    mainWindow?.webContents.send('shell:stdout', { data: `>>> Setting up workspace at ${finalWorkspacePath}...\n`, source: 'stdout' });
                    await fs.mkdir(path.join(finalWorkspacePath, 'skills'), { recursive: true });
                    await fs.mkdir(path.join(finalWorkspacePath, 'extensions'), { recursive: true });

                    mainWindow?.webContents.send('shell:stdout', { data: `>>> Initialization complete!\n`, source: 'stdout' });
                    resolve({ 
                        code: 0, 
                        stdout: JSON.stringify({ 
                            corePath: finalCorePath, 
                            configPath: finalConfigPath, 
                            workspacePath: finalWorkspacePath 
                        }), 
                        exitCode: 0 
                    });
                } catch (e: any) {
                    resolve({ code: 1, stderr: e.message, exitCode: 1 });
                }
                activeProcesses.delete(childProcess);
            });
        });
    } catch (e: any) {
        return { code: 1, stderr: e.message, exitCode: 1 };
    }
  }

  return new Promise((resolve) => {
    // 輸出指令到 UI 日誌，方便偵錯
    mainWindow?.webContents.send('shell:stdout', { data: `[Exec] ${fullCommand}\n`, source: 'system' });
    
    const child = spawn(fullCommand, { shell: true });
    activeProcesses.add(child);
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
      activeProcesses.delete(child);
      resolve({ code: code ?? 0, stdout, stderr, exitCode: code ?? 0 });
    });
  });
});

ipcMain.handle('shell:open-external', async (_event, url: string) => {
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

app.on('before-quit', () => {
  killAllSubprocesses();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
