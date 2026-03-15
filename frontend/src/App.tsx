import { useState, useEffect, useRef } from 'react';
import { Layout, Settings, Activity, CheckCircle2, Play, Square, Loader2, Boxes, MonitorPlay, BarChart3, LogOut, AlertCircle, X, FolderOpen, RefreshCw } from 'lucide-react';
import { MiniView } from './components/MiniView';
import { SkillManager } from './components/SkillManager';
import { ActionCenter } from './components/ActionCenter';
import { StaffGrid } from './components/StaffGrid';
import { Analytics } from './components/Analytics';
import { ThemeToggle } from './components/ThemeToggle';
import { LanguageToggle } from './components/LanguageToggle';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import SetupWizard from './components/onboarding/SetupWizard';
import UpdateBanner from './components/UpdateBanner';
import { useStore } from './store';
import { execInTerminal } from './utils/terminal';

type TelegramPairingRequest = {
  id: string;
  code: string;
  createdAt?: string;
  lastSeenAt?: string;
  meta?: {
    username?: string;
    firstName?: string;
    lastName?: string;
    accountId?: string;
  };
};

type TelegramAuthorizedUser = {
  id: string;
};

function App() {
  const { running, setRunning, logs, addLog, envStatus, setEnvStatus, config, setConfig, detectedConfig, setDetectedConfig, setCoreSkills, setWorkspaceSkills } = useStore();
  const [viewMode, setViewMode] = useState<'mini' | 'expanded'>('expanded');
  const [activeTab, setActiveTab] = useState('monitor'); // Default to monitor if onboarding finished
  const [onboardingFinished, setOnboardingFinished] = useState(
    () => localStorage.getItem('onboarding_finished') === 'true'
  );
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [gatewayConflictModal, setGatewayConflictModal] = useState<{ message: string; detail: string } | null>(null);
  const [runtimeProfile, setRuntimeProfile] = useState<any>(null);
  const [runtimeDraftModel, setRuntimeDraftModel] = useState('');
  const [runtimeDraftBotToken, setRuntimeDraftBotToken] = useState('');
  const [telegramPairingRequests, setTelegramPairingRequests] = useState<TelegramPairingRequest[]>([]);
  const [telegramAuthorizedUsers, setTelegramAuthorizedUsers] = useState<TelegramAuthorizedUser[]>([]);
  const [telegramPairingLoading, setTelegramPairingLoading] = useState(false);
  const [telegramPairingApprovingCode, setTelegramPairingApprovingCode] = useState('');
  const [telegramPairingRejectingCode, setTelegramPairingRejectingCode] = useState('');
  const [telegramPairingClearing, setTelegramPairingClearing] = useState(false);
  const [telegramPairingError, setTelegramPairingError] = useState('');
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const { t } = useTranslation();
  const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;
  const normalizeConfigDir = (rawPath: string) => {
    const trimmed = (rawPath || '').trim();
    if (!trimmed) return '';
    return trimmed.replace(/[\\/]openclaw\.json$/i, '');
  };
  const resolvedConfigDir = normalizeConfigDir(config.configPath);
  const resolvedConfigFilePath = resolvedConfigDir ? `${resolvedConfigDir}/openclaw.json` : '';
  const effectiveRuntimeModel = String(runtimeProfile?.model || detectedConfig?.model || '').trim();
  const effectiveRuntimeBotToken = String(runtimeProfile?.botToken || detectedConfig?.botToken || '').trim();

  const PROVIDER_MODEL_CATALOGUE: Record<string, { label: string; models: string[] }> = {
    anthropic: { label: 'Anthropic (Claude)', models: ['claude-3-7-sonnet-latest', 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-3-5-haiku-latest'] },
    openai:    { label: 'OpenAI (GPT)',       models: ['openai/gpt-4o', 'openai/gpt-4-turbo', 'openai/o3'] },
    google:    { label: 'Google (Gemini)',     models: ['gemini-2.0-flash', 'google/gemini-2.5-pro', 'google/gemini-2.0-flash-thinking'] },
    gemini:    { label: 'Google (Gemini)',     models: ['gemini-2.0-flash', 'google/gemini-2.5-pro'] },
    minimax:   { label: 'MiniMax',             models: ['MiniMax-M2.5'] },
    moonshot:  { label: 'Moonshot (Kimi)',     models: ['kimi-k2.5'] },
    openrouter:{ label: 'OpenRouter',          models: ['openrouter/auto', 'openrouter/anthropic/claude-opus-4'] },
    ollama:    { label: 'Ollama (Local)',       models: ['ollama/llama3', 'ollama/qwen2.5:14b', 'ollama/deepseek-r1:7b'] },
    chutes:    { label: 'Chutes',              models: ['chutes/deepseek-ai/DeepSeek-R2'] },
    xai:       { label: 'xAI (Grok)',          models: ['xai/grok-3', 'xai/grok-2-vision'] },
  };

  const runtimeProviders: string[] = (runtimeProfile as any)?.providers ?? [];
  const availableModelOptions: { group: string; models: string[] }[] = runtimeProviders.length > 0
    ? runtimeProviders
        .map((p: string) => {
          const entry = PROVIDER_MODEL_CATALOGUE[p.toLowerCase()];
          return entry ? { group: entry.label, models: entry.models } : null;
        })
        .filter(Boolean) as { group: string; models: string[] }[]
    : Object.values(PROVIDER_MODEL_CATALOGUE).map((e) => ({ group: e.label, models: e.models }));

  const buildOpenClawEnvPrefix = (cfg?: any) => {
    const configDir = normalizeConfigDir(cfg?.configPath ?? config.configPath);
    const configFilePath = configDir ? `${configDir}/openclaw.json` : '';
    const stateDirEnv = configDir ? `OPENCLAW_STATE_DIR=${shellQuote(configDir)} ` : '';
    const configPathEnv = configFilePath ? `OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} ` : '';
    return `${stateDirEnv}${configPathEnv}`;
  };

  const resolveGatewayPortArg = (cfg?: any): string | null => {
    const raw = String(cfg?.gatewayPort ?? config.gatewayPort ?? '').trim();
    if (!raw) return '';
    if (!/^\d+$/.test(raw)) return null;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return ` --port ${port}`;
  };

  const resolveGatewayPortForPrecheck = (cfg?: any): { port: number; isDefault: boolean } | null => {
    const raw = String(cfg?.gatewayPort ?? config.gatewayPort ?? '').trim();
    if (!raw) {
      // UI 未指定時先檢查 OpenClaw 常用預設埠，避免最常見衝突。
      return { port: 18789, isDefault: true };
    }
    if (!/^\d+$/.test(raw)) return null;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { port, isDefault: false };
  };

  const shouldUseExternalTerminal = (cfg?: any) => (cfg?.useExternalTerminal ?? config.useExternalTerminal) !== false;

  const gatewayRuntimeZones = [
    {
      key: 'core',
      label: t('monitor.zoneCore'),
      value: config.corePath,
      folderPath: config.corePath,
      accent: 'from-sky-500/15 to-cyan-500/10 dark:from-sky-500/10 dark:to-cyan-500/5',
      border: 'border-sky-200/80 dark:border-sky-700/50'
    },
    {
      key: 'config',
      label: t('monitor.zoneConfig'),
      value: resolvedConfigFilePath,
      folderPath: resolvedConfigDir,
      accent: 'from-indigo-500/15 to-blue-500/10 dark:from-indigo-500/10 dark:to-blue-500/5',
      border: 'border-indigo-200/80 dark:border-indigo-700/50'
    },
    {
      key: 'workspace',
      label: t('monitor.zoneWorkspace'),
      value: config.workspacePath,
      folderPath: config.workspacePath,
      accent: 'from-emerald-500/15 to-teal-500/10 dark:from-emerald-500/10 dark:to-teal-500/5',
      border: 'border-emerald-200/80 dark:border-emerald-700/50'
    }
  ];

  const openZoneFolder = async (zoneLabel: string, folderPath?: string) => {
    const target = (folderPath || '').trim();
    if (!target) {
      addLog(`${zoneLabel}: ${t('monitor.pathUnset')}`, 'system');
      return;
    }
    if (!window.electronAPI?.openPath) {
      addLog(t('monitor.openFolderUnavailable'), 'stderr');
      return;
    }
    const result = await window.electronAPI.openPath(target);
    if (!result?.success) {
      addLog(t('monitor.openFolderFailed', { zone: zoneLabel, msg: result?.error || 'unknown error' }), 'stderr');
    }
  };

  useEffect(() => {
    if (!initPromiseRef.current) {
      initPromiseRef.current = initializeApp();
    }

    let unsubscribe: (() => void) | undefined;
    if (window.electronAPI) {
      unsubscribe = window.electronAPI.onLog((payload) => {
        addLog(payload.data, payload.source as any);
      });
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []); // Run ONLY once on mount

  // Separate effect for snapshot sync
  useEffect(() => {
    if (!running) return;
    if (!config.configPath && !config.workspacePath && !config.corePath) return;

    const interval = setInterval(() => {
        syncSnapshot();
    }, 15000); // Sync every 15 seconds while gateway is running

    return () => clearInterval(interval);
  }, [running, config.configPath, config.workspacePath, config.corePath]);

  const { theme } = useStore();
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    if (activeTab !== 'settings') return;
    const probeRuntimeConfig = async () => {
      const configDir = normalizeConfigDir(config.configPath);
      if (!configDir || !window.electronAPI) {
        setRuntimeProfile(null);
        return;
      }

      try {
        const res = await window.electronAPI.exec(`config:probe ${shellQuote(configDir)}`);
        if (res.code === 0 && res.stdout) {
          setRuntimeProfile(JSON.parse(res.stdout));
        } else {
          setRuntimeProfile(null);
        }
      } catch {
        setRuntimeProfile(null);
      }
    };

    probeRuntimeConfig();
  }, [activeTab, config.configPath]);

  useEffect(() => {
    if (activeTab !== 'settings') return;
    setRuntimeDraftModel(effectiveRuntimeModel);
    setRuntimeDraftBotToken(effectiveRuntimeBotToken);
  }, [activeTab, effectiveRuntimeModel, effectiveRuntimeBotToken]);

  const loadTelegramPairingRequests = async () => {
    if (!window.electronAPI || !resolvedConfigDir) {
      setTelegramPairingRequests([]);
      setTelegramAuthorizedUsers([]);
      setTelegramPairingError('');
      return;
    }

    setTelegramPairingLoading(true);
    setTelegramPairingError('');
    try {
      const pairingFile = `${resolvedConfigDir}/credentials/telegram-pairing.json`;
      const allowFromFile = `${resolvedConfigDir}/credentials/telegram-default-allowFrom.json`;
      const [pairingRes, allowFromRes] = await Promise.all([
        window.electronAPI.exec(`test -f ${shellQuote(pairingFile)} && cat ${shellQuote(pairingFile)}`),
        window.electronAPI.exec(`test -f ${shellQuote(allowFromFile)} && cat ${shellQuote(allowFromFile)}`),
      ]);

      const pairingCode = pairingRes.code ?? pairingRes.exitCode;
      const pairingStdout = String(pairingRes.stdout || '').trim();
      const parsedPairing = pairingCode === 0 && pairingStdout ? JSON.parse(pairingRes.stdout) : { requests: [] };
      const requests = Array.isArray(parsedPairing?.requests) ? parsedPairing.requests : [];
      setTelegramPairingRequests(
        requests.map((request: any) => ({
          id: String(request?.id || ''),
          code: String(request?.code || ''),
          createdAt: request?.createdAt,
          lastSeenAt: request?.lastSeenAt,
          meta: request?.meta || {},
        })),
      );

      const allowFromCode = allowFromRes.code ?? allowFromRes.exitCode;
      const allowFromStdout = String(allowFromRes.stdout || '').trim();
      const parsedAllowFrom = allowFromCode === 0 && allowFromStdout ? JSON.parse(allowFromRes.stdout) : { allowFrom: [] };
      const allowFrom = Array.isArray(parsedAllowFrom?.allowFrom) ? parsedAllowFrom.allowFrom : [];
      setTelegramAuthorizedUsers(
        allowFrom.map((entry: any) => ({
          id: String(entry || '').replace(/^(telegram:|tg:)/i, ''),
        })).filter((entry: TelegramAuthorizedUser) => entry.id),
      );
    } catch (e: any) {
      setTelegramPairingRequests([]);
      setTelegramAuthorizedUsers([]);
      setTelegramPairingError(e?.message || 'Failed to load pairing requests');
    } finally {
      setTelegramPairingLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'monitor') return;
    void loadTelegramPairingRequests();
    const interval = window.setInterval(() => {
      void loadTelegramPairingRequests();
    }, 15000);
    return () => window.clearInterval(interval);
  }, [activeTab, resolvedConfigDir]);

  const approveTelegramPairing = async (request: TelegramPairingRequest) => {
    if (!window.electronAPI) {
      addLog(t('logs.commFailed', { msg: 'Electron API not available' }), 'stderr');
      return;
    }
    const corePath = String(config.corePath || '').trim();
    if (!corePath) {
      setTelegramPairingError(t('monitor.telegramPairing.missingCorePath'));
      return;
    }

    setTelegramPairingApprovingCode(request.code);
    setTelegramPairingError('');
    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const cmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw pairing approve telegram ${shellQuote(request.code)}`;
      const res = await window.electronAPI.exec(cmd);
      const code = res.code ?? res.exitCode;
      if (code !== 0) {
        throw new Error(res.stderr || res.stdout || `exit ${code}`);
      }
      addLog(t('monitor.telegramPairing.approvedLog', { id: request.id }), 'system');
      await loadTelegramPairingRequests();
    } catch (e: any) {
      const message = e?.message || t('monitor.telegramPairing.approveFailed');
      setTelegramPairingError(message);
      addLog(message, 'stderr');
    } finally {
      setTelegramPairingApprovingCode('');
    }
  };

  const rejectTelegramPairing = async (request: TelegramPairingRequest) => {
    if (!window.electronAPI || !resolvedConfigDir) {
      setTelegramPairingError(t('monitor.telegramPairing.missingConfig'));
      return;
    }

    setTelegramPairingRejectingCode(request.code);
    setTelegramPairingError('');
    try {
      const pairingFile = `${resolvedConfigDir}/credentials/telegram-pairing.json`;
      const cmd = `PAIRING_FILE=${shellQuote(pairingFile)} TARGET_CODE=${shellQuote(request.code)} node - <<'NODE'
const fs = require('fs');
const file = process.env.PAIRING_FILE;
const targetCode = process.env.TARGET_CODE;
let data = { version: 1, requests: [] };
if (fs.existsSync(file)) {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
}
const requests = Array.isArray(data.requests) ? data.requests : [];
data.requests = requests.filter((entry) => String(entry?.code || '') !== String(targetCode || ''));
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
NODE`;
      const res = await window.electronAPI.exec(cmd);
      const code = res.code ?? res.exitCode;
      if (code !== 0) {
        throw new Error(res.stderr || res.stdout || `exit ${code}`);
      }
      addLog(t('monitor.telegramPairing.rejectedLog', { id: request.id }), 'system');
      await loadTelegramPairingRequests();
    } catch (e: any) {
      const message = e?.message || t('monitor.telegramPairing.rejectFailed');
      setTelegramPairingError(message);
      addLog(message, 'stderr');
    } finally {
      setTelegramPairingRejectingCode('');
    }
  };

  const clearTelegramPairingRequests = async () => {
    if (!window.electronAPI || !resolvedConfigDir) {
      setTelegramPairingError(t('monitor.telegramPairing.missingConfig'));
      return;
    }

    setTelegramPairingClearing(true);
    setTelegramPairingError('');
    try {
      const pairingFile = `${resolvedConfigDir}/credentials/telegram-pairing.json`;
      const cmd = `PAIRING_FILE=${shellQuote(pairingFile)} node - <<'NODE'
const fs = require('fs');
const file = process.env.PAIRING_FILE;
let data = { version: 1, requests: [] };
if (fs.existsSync(file)) {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
}
data.requests = [];
fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
NODE`;
      const res = await window.electronAPI.exec(cmd);
      const code = res.code ?? res.exitCode;
      if (code !== 0) {
        throw new Error(res.stderr || res.stdout || `exit ${code}`);
      }
      addLog(t('monitor.telegramPairing.clearedLog'), 'system');
      await loadTelegramPairingRequests();
    } catch (e: any) {
      const message = e?.message || t('monitor.telegramPairing.clearFailed');
      setTelegramPairingError(message);
      addLog(message, 'stderr');
    } finally {
      setTelegramPairingClearing(false);
    }
  };

  const initializeApp = async () => {
    const loadedConfig = await loadConfig();
    // Fast path: decide onboarding immediately to avoid blocking on slow checks.
    checkOnboardingStatus(loadedConfig);

    const [detected] = await Promise.all([
      detectPaths(), // 只偵測但不修補，待用戶選擇模式後再決定
      checkEnvironment(),
      syncGatewayStatus(loadedConfig)
    ]);

    // Reconcile once detection finishes (e.g., if local config is empty but paths exist).
    checkOnboardingStatus(loadedConfig, detected);
  };

  const detectPaths = async () => {
    const { setDetectingPaths } = useStore.getState();
    setDetectingPaths(true);
    let detectedResult: any = null;
    
    if (window.electronAPI) {
      try {
          const res = await window.electronAPI.exec('detect:paths');
          if (res.code === 0 && res.stdout) {
            let detected: any = { coreSkills: [], existingConfig: null };
            try {
                detected = JSON.parse(res.stdout);
            } catch (e) {
                console.warn("Detected paths but result was not valid JSON", res.stdout);
            }
            detectedResult = detected;
            
            // [NEW] 僅緩存偵測結果，不直接修改 config
            if (detected && detected.existingConfig) {
                setDetectedConfig({
                    ...detected.existingConfig,
                    corePath: detected.existingConfig.corePath || '',
                    configPath: detected.existingConfig.configPath || '',
                    workspacePath: detected.existingConfig.workspacePath || detected.existingConfig.configPath || ''
                });
            }

            if (detected.coreSkills) setCoreSkills(detected.coreSkills);
            if (detected.existingConfig?.workspaceSkills) setWorkspaceSkills(detected.existingConfig.workspaceSkills);
          }
      } catch (e) {
          console.error("Auto detection failed", e);
      }
    }
    setDetectingPaths(false);
    return detectedResult;
  };

  const loadConfig = async () => {
    if (window.electronAPI) {
      try {
        const res = await window.electronAPI.exec('config:read');
        if (res.code === 0 && res.stdout) {
          let savedConfig: any = {};
          try {
            savedConfig = JSON.parse(res.stdout);
          } catch(e) {
            console.error("Config JSON parse failed", res.stdout);
          }
          const { setConfig } = useStore.getState(); // Directly get from store to avoid stale closure
          setConfig(savedConfig);
          return savedConfig;
        }
      } catch (e) {
        console.error("Failed to load config", e);
      }
    }
    return null;
  };

  const checkOnboardingStatus = (loadedConfig?: any, detected?: any) => {
    const persisted = loadedConfig || {};
    const detectedExisting = detected?.existingConfig || {};
    const hasAnyConfiguredPath = Boolean(
      (persisted.corePath && String(persisted.corePath).trim()) ||
      (persisted.configPath && String(persisted.configPath).trim()) ||
      (persisted.workspacePath && String(persisted.workspacePath).trim()) ||
      (detectedExisting.corePath && String(detectedExisting.corePath).trim()) ||
      (detectedExisting.configPath && String(detectedExisting.configPath).trim()) ||
      (detectedExisting.workspacePath && String(detectedExisting.workspacePath).trim())
    );

    // If runtime paths already exist, treat onboarding as finished even when
    // localStorage flag is missing (e.g., fresh renderer profile or cleared storage).
    const finished = localStorage.getItem('onboarding_finished') === 'true' || hasAnyConfiguredPath;
    if (finished) localStorage.setItem('onboarding_finished', 'true');
    setOnboardingFinished(finished);
    if (!finished) {
      setActiveTab('onboarding');
    } else {
      setActiveTab('monitor');
    }
  };

  const handleOnboardingComplete = () => {
    localStorage.setItem('onboarding_finished', 'true');
    setOnboardingFinished(true);
    setActiveTab('monitor');
  };

  const toggleViewMode = () => {
    const newMode = viewMode === 'expanded' ? 'mini' : 'expanded';
    setViewMode(newMode);
    window.electronAPI.resize(newMode);
  };

  const syncSnapshot = async () => {
    if (window.electronAPI) {
      try {
        // Prefer user-selected config/workspace runtime, then fall back to corePath for compatibility.
        const snapshotCandidates = [
          resolvedConfigDir ? `${resolvedConfigDir}/runtime/last-snapshot.json` : '',
          config.workspacePath ? `${config.workspacePath}/runtime/last-snapshot.json` : '',
          config.corePath ? `${config.corePath}/runtime/last-snapshot.json` : ''
        ].filter(Boolean);

        for (const snapshotPath of snapshotCandidates) {
          const res = await window.electronAPI.exec(`test -f ${shellQuote(snapshotPath)} && cat ${shellQuote(snapshotPath)}`);
          if (res.code === 0 && res.stdout) {
            try {
              const snapshot = JSON.parse(res.stdout);
              const { setSnapshot } = useStore.getState();
              setSnapshot(snapshot);
              break;
            } catch (e) {
              console.warn("Snapshot corrupted or empty", e);
            }
          }
        }
      } catch (e) {
        // Silent fail if not exists yet
      }
    }
  };

  const syncGatewayStatus = async (runtimeConfig?: any) => {
      try {
          const effectiveConfig = runtimeConfig || config;
          const envPrefix = buildOpenClawEnvPrefix(effectiveConfig);
        const portArg = resolveGatewayPortArg(effectiveConfig);
        if (portArg === null) {
          addLog(t('logs.invalidGatewayPort'), 'stderr');
          return;
        }
          const cmd = effectiveConfig.corePath 
        ? `cd ${shellQuote(effectiveConfig.corePath)} && ${envPrefix}pnpm openclaw gateway status${portArg}` 
        : `${envPrefix}pnpm openclaw gateway status${portArg}`;
          const res = await window.electronAPI.exec(cmd);
          if (res.stdout.includes('online') || res.stdout.includes('running')) {
              setRunning(true);
          }
      } catch(e) {}
  }

  const checkEnvironment = async () => {
    const check = async (cmd: string) => {
        try {
            const res = await window.electronAPI.exec(cmd);
            return res.exitCode === 0 || res.code === 0 ? 'ok' : 'error';
        } catch (e) {
            return 'error';
        }
    };

    const node = await check('node -v');
    const git = await check('git --version');
    const pnpm = await check('pnpm -v');

    setEnvStatus({ node, git, pnpm });
  };

  const toggleGateway = async () => {
    if (!window.electronAPI) {
      addLog(t('logs.commFailed', { msg: 'Electron API not available' }), 'stderr');
      return;
    }

    // 前置驗證：corePath 必須已設定
    if (!config.corePath || !config.corePath.trim()) {
      addLog('錯誤: 尚未設定 Core Path，請至「配置編輯」填入 OpenClaw 主核心區絕對路徑後再試。', 'stderr');
      return;
    }

    if (running) {
      addLog(t('logs.stoppingGateway'), 'system');
      try {
        const envPrefix = buildOpenClawEnvPrefix();
        const portArg = resolveGatewayPortArg();
        if (portArg === null) {
          addLog(t('logs.invalidGatewayPort'), 'stderr');
          return;
        }
        // 安全守衛：防止誤停其他並行 OpenClaw 實例。
        // 必須至少有一個隔離手段：
        //   - configPath 有値 → envPrefix 含 OPENCLAW_STATE_DIR/CONFIG_PATH，透過 state dir 判斷實例
        //   - gatewayPort 有値 → portArg 含 --port，透過埠口判斷實例
        const hasConfigIsolation = !!config.configPath?.trim();
        const hasPortIsolation = portArg !== '';
        if (!hasConfigIsolation && !hasPortIsolation) {
          addLog('錯誤: 未設定 Config Path 且未指定 Gateway Port，無法安全識別目標實例，拒絕停止以避免誤停其他並行服務。', 'stderr');
          return;
        }
        const cmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway stop${portArg}`;
        const resRaw: any = shouldUseExternalTerminal()
          ? await execInTerminal(cmd, {
              title: 'Stopping OpenClaw Gateway',
              holdOpen: false,
              cwd: config.corePath,
            })
          : await window.electronAPI.exec(cmd);
        const code = resRaw.code ?? resRaw.exitCode;
        if (code === 0) {
          setRunning(false);
          addLog(t('logs.gatewayStopped'), 'system');
        } else {
          addLog(t('logs.stopGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
        }
      } catch (e: any) {
        addLog(t('logs.stopGatewayFailed', { msg: e.message }), 'stderr');
      }
    } else {
      addLog(t('logs.startingGateway'), 'system');
      try {
        const envPrefix = buildOpenClawEnvPrefix();
        const portArg = resolveGatewayPortArg();
        if (portArg === null) {
          addLog(t('logs.invalidGatewayPort'), 'stderr');
          return;
        }

        // 啟動前先檢查目標埠是否已有 LISTEN 程序。
        const precheck = resolveGatewayPortForPrecheck();
        if (!precheck) {
          addLog(t('logs.invalidGatewayPort'), 'stderr');
          return;
        }
        const precheckRes: any = await window.electronAPI.exec(
          `lsof -nP -iTCP:${precheck.port} -sTCP:LISTEN`,
        );
        const precheckCode = precheckRes.code ?? precheckRes.exitCode;
        const precheckOutput = String(precheckRes.stdout || '').trim();
        if (precheckCode === 0 && precheckOutput) {
          const hint = precheck.isDefault ? '（目前使用預設埠）' : '';
          const message = `錯誤: 啟動前檢查到 Port ${precheck.port} 已被占用${hint}，請改用其他 Gateway Port。`;
          addLog(message, 'stderr');
          addLog(precheckOutput, 'stderr');
          setGatewayConflictModal({ message, detail: precheckOutput });
          return;
        }

        // 先確認 corePath 目錄存在
        const checkDir = await window.electronAPI.exec(`test -d ${shellQuote(config.corePath)}`);
        if ((checkDir.code ?? checkDir.exitCode) !== 0) {
          addLog(`錯誤: Core Path 目錄不存在：${config.corePath}`, 'stderr');
          return;
        }

        const useExternalTerminal = shouldUseExternalTerminal();
        if (useExternalTerminal) {
          const startCmd = config.installDaemon
            ? `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway start${portArg}`
            : `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway run${portArg} --verbose --force`;

          const resRaw: any = await execInTerminal(startCmd, {
            title: 'Starting OpenClaw Gateway',
            holdOpen: true,
            cwd: config.corePath,
          });
          const code = resRaw.code ?? resRaw.exitCode;
          if (typeof code === 'number' && code !== 0) {
            addLog(t('logs.startGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
            return;
          }
          addLog(t('logs.gatewayStartCmdSent'), 'system');
          await new Promise((r) => setTimeout(r, 2000));
        } else if (config.installDaemon) {
          // daemon 模式：gateway start 是 launchd/systemd 控制指令，快速退出
          const cmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway start${portArg}`;
          const resRaw: any = await window.electronAPI.exec(cmd);
          const code = resRaw.code ?? resRaw.exitCode;
          if (code === 0) {
            addLog(t('logs.gatewayStartCmdSent'), 'system');
          } else {
            addLog(t('logs.startGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
            return;
          }
        } else {
          // 非 daemon 模式：gateway run 是前台長駐進程，需透過 gateway:start-bg 背景 spawn
          const runCmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway run${portArg} --verbose --force`;
          const resRaw: any = await window.electronAPI.exec(`gateway:start-bg ${runCmd}`);
          const code = resRaw.code ?? resRaw.exitCode;
          if (code !== 0) {
            addLog(t('logs.startGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
            return;
          }
          addLog(t('logs.gatewayStartCmdSent'), 'system');
          // 等待 port 綁定
          await new Promise((r) => setTimeout(r, 2000));
        }

        // 用 gateway status 真實確認服務已 online
        const statusCmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway status${portArg}`;
        const statusRes: any = await window.electronAPI.exec(statusCmd);
        const statusOut = String(statusRes.stdout || '') + String(statusRes.stderr || '');
        if (statusOut.includes('online') || statusOut.includes('running')) {
          setRunning(true);
          addLog(t('logs.gatewayStarted'), 'system');
        } else {
          addLog(t('logs.startGatewayFailed', { msg: statusRes.stderr || 'gateway status 未顯示 online' }), 'stderr');
        }
      } catch (e: any) {
        addLog(t('logs.startGatewayFailed', { msg: e.message }), 'stderr');
      }
    }
  };

  const handleBrowsePath = async (key: 'corePath' | 'configPath' | 'workspacePath') => {
    if (!window.electronAPI?.selectDirectory) return;
    const selectedPath = await window.electronAPI.selectDirectory();
    if (!selectedPath) return;
    setConfig({ [key]: selectedPath } as any);
  };

  const handleSaveConfig = async () => {
    if (!window.electronAPI) return;
    addLog(t('logs.savingConfig'), 'system');
    try {
      const modelChanged = runtimeDraftModel.trim() !== effectiveRuntimeModel;
      const tokenChanged = runtimeDraftBotToken !== effectiveRuntimeBotToken;

      if (modelChanged || tokenChanged) {
        const corePath = String(config.corePath || '').trim();
        if (!corePath) {
          throw new Error('缺少 Core Path，無法更新 OpenClaw 動態設定');
        }
        if (!resolvedConfigDir) {
          throw new Error('缺少 Config Path，無法更新 OpenClaw 動態設定');
        }

        const envPrefix = buildOpenClawEnvPrefix();
        const cdCorePath = `cd ${shellQuote(corePath)}`;

        if (modelChanged) {
          const nextModel = runtimeDraftModel.trim();
          if (!nextModel) {
            throw new Error('Model 不能是空值');
          }
          const setModelCmd = `${cdCorePath} && ${envPrefix}pnpm openclaw config set agents.defaults.model.primary ${shellQuote(JSON.stringify(nextModel))} --json`;
          const setModelRes = await window.electronAPI.exec(setModelCmd);
          if ((setModelRes.code ?? setModelRes.exitCode) !== 0) {
            throw new Error(setModelRes.stderr || '更新模型設定失敗');
          }
        }

        if (tokenChanged) {
          const setTokenCmd = `${cdCorePath} && ${envPrefix}pnpm openclaw config set channels.telegram.botToken ${shellQuote(JSON.stringify(runtimeDraftBotToken))} --json`;
          const setTokenRes = await window.electronAPI.exec(setTokenCmd);
          if ((setTokenRes.code ?? setTokenRes.exitCode) !== 0) {
            throw new Error(setTokenRes.stderr || '更新 Telegram Bot Token 失敗');
          }
        }

        const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
        if (probeRes.code === 0 && probeRes.stdout) {
          setRuntimeProfile(JSON.parse(probeRes.stdout));
        }
      }

      const {
        model: _model,
        botToken: _botToken,
        authChoice: _authChoice,
        apiKey: _apiKey,
        ...launcherConfig
      } = config as any;
      const res = await window.electronAPI.exec(`config:write ${JSON.stringify(launcherConfig)}`);
      if (res.code === 0) {
        addLog(t('logs.configSaved'), 'system');
      } else {
        addLog(t('logs.saveConfigFailed', { msg: res.stderr }), 'stderr');
      }
    } catch (e: any) {
      addLog(t('logs.commFailed', { msg: e.message }), 'stderr');
    }
  };

  const handleResetOnboarding = async () => {
    // 登出前先嘗試停止 Gateway，避免殭屍進程占用 port
    if (running && config.corePath && window.electronAPI) {
      let stopped = false;
      try {
        const envPrefix = buildOpenClawEnvPrefix();
        const portArg = resolveGatewayPortArg();
        // 多實例並行安全守衛：必須有 configPath 或 gatewayPort 才能安全識別實例
        const hasConfigIsolation = !!config.configPath?.trim();
        const hasPortIsolation = portArg !== null && portArg !== '';

        if (portArg === null) {
          addLog(t('logs.invalidGatewayPort'), 'stderr');
        } else if (!hasConfigIsolation && !hasPortIsolation) {
          addLog('錯誤: 未設定 Config Path 且未指定 Gateway Port，為避免誤停其他並行服務，本次重設不會主動停止 Gateway。', 'stderr');
        } else {
          const stopCmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway stop${portArg}`;
          const stopRes: any = await window.electronAPI.exec(stopCmd);
          const stopCode = stopRes.code ?? stopRes.exitCode;
          if (stopCode !== 0) {
            addLog(t('logs.stopGatewayFailed', { msg: stopRes.stderr || `exit ${stopCode}` }), 'stderr');
          }

          // 停止後做狀態驗證，避免 UI 顯示已停止但實際仍占用埠
          const statusCmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway status${portArg}`;
          const statusRes: any = await window.electronAPI.exec(statusCmd);
          const statusText = String(statusRes.stdout || '') + String(statusRes.stderr || '');
          stopped = !(statusText.includes('online') || statusText.includes('running'));
        }
      } catch (err: any) {
        addLog(t('logs.stopGatewayFailed', { msg: err?.message || 'unknown error' }), 'stderr');
      }

      if (stopped) {
        setRunning(false);
      } else {
        addLog('警告: Gateway 仍在執行中，可能持續占用目前 Port。', 'stderr');
      }
    }
    localStorage.removeItem('onboarding_finished');
    setOnboardingFinished(false);
    setActiveTab('monitor');
    setShowLogoutConfirm(false);
  };

  if (viewMode === 'mini') {
    return <MiniView running={running} onToggle={toggleGateway} onExpand={toggleViewMode} />;
  }

  // If not finished onboarding, show the wizard
  if (!onboardingFinished) {
    return <SetupWizard onFinished={handleOnboardingComplete} />;
  }

  return (
    <div className="flex h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden animate-in fade-in duration-700">
      {/* Sidebar */}
      <div className="w-64 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col p-4 space-y-6">
        <div className="flex items-center space-y-1 py-4 px-2">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center mr-3 shadow-xl shadow-blue-500/20">
            <Layout size={20} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-lg leading-none tracking-tight">NT-Claw</div>
            <div className="text-[10px] text-blue-500 font-mono uppercase tracking-widest">Launch Pad</div>
          </div>
        </div>
        
        <nav className="flex-1 space-y-1">
          <NavItem icon={<Activity size={18}/>} label={t('app.tabs.monitor')} active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} />
          <NavItem icon={<BarChart3 size={18}/>} label={t('app.tabs.analytics')} active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} />
          <NavItem icon={<Boxes size={18}/>} label={t('app.tabs.skills')} active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} />
          <NavItem icon={<Settings size={18}/>} label={t('app.tabs.settings')} active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} />
        </nav>

        <div onClick={toggleViewMode} className="p-4 bg-blue-600/10 rounded-2xl border border-blue-500/20 cursor-pointer hover:bg-blue-600/20 transition-all flex items-center justify-between group">
            <div className="text-[10px] text-blue-400 uppercase font-black tracking-widest">{t('app.switchMiniMode')}</div>
            <MonitorPlay size={14} className="text-blue-400 group-hover:scale-110 transition-transform" />
        </div>

        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-600 px-2 flex justify-between items-center font-mono">
          <span>{t('app.version')}</span>
          <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-1 animate-pulse"></div> {t('app.online')}</span>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#020617] relative">
        <header className="h-20 border-b border-slate-200 dark:border-slate-800/50 flex items-center px-10 justify-between relative backdrop-blur-md bg-white/20 dark:bg-slate-950/20">
          <div>
            <h2 className="font-bold text-xl text-slate-900 dark:text-slate-100 uppercase tracking-tight">
                {activeTab === 'monitor' ? t('app.headers.monitor') : activeTab === 'analytics' ? t('app.headers.analytics') : activeTab === 'skills' ? t('app.headers.skills') : t('app.headers.settings')}
            </h2>
          </div>
          <div className="flex items-center space-x-4">
            <LanguageToggle />
            <ThemeToggle />

            <div 
                onClick={() => setShowLogoutConfirm(true)}
                title={t('app.logoutTooltip')}
                className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-all group relative active:scale-95"
            >
                <LogOut size={18} className="text-slate-500 dark:text-slate-400 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors" />
            </div>
          </div>
        </header>

        {/* Custom Logout Confirmation Dialog */}
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setShowLogoutConfirm(false)}></div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-md rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 slide-in-from-bottom-8 duration-300">
              <div className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                  <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500">
                    <AlertCircle size={24} />
                  </div>
                  <button onClick={() => setShowLogoutConfirm(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                    <X size={20} />
                  </button>
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">
                    {t('app.logoutTooltip')}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    {t('app.logoutConfirm')}
                  </p>
                </div>

                <div className="flex gap-4 pt-2">
                  <button 
                    onClick={() => setShowLogoutConfirm(false)}
                    className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
                  >
                    {t('wizard.backBtn').replace('← ', '')}
                  </button>
                  <button 
                    onClick={handleResetOnboarding}
                    className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25 transition-all active:scale-95"
                  >
                    {t('monitor.disconnect')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {gatewayConflictModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={() => setGatewayConflictModal(null)}></div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 slide-in-from-bottom-8 duration-300">
              <div className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                  <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-500">
                    <AlertCircle size={24} />
                  </div>
                  <button onClick={() => setGatewayConflictModal(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">Gateway Port 已被占用</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    {gatewayConflictModal.message}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 p-4">
                  <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400 mb-2">Process Detail</div>
                  <pre className="text-[11px] text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-all font-mono leading-relaxed">
                    {gatewayConflictModal.detail}
                  </pre>
                </div>

                <div className="flex gap-4 pt-2">
                  <button
                    onClick={() => setActiveTab('settings')}
                    className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
                  >
                    前往設定修改 Port
                  </button>
                  <button
                    onClick={() => setGatewayConflictModal(null)}
                    className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-white bg-amber-500 hover:bg-amber-600 shadow-lg shadow-amber-500/25 transition-all active:scale-95"
                  >
                    我知道了
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 p-10 overflow-y-auto relative">
          {activeTab !== 'onboarding' && onboardingFinished && <UpdateBanner />}
          {activeTab === 'skills' && <SkillManager />}

          {activeTab === 'analytics' && <Analytics />}

          {activeTab === 'monitor' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="bg-slate-50 dark:bg-slate-900/30 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-8 rounded-3xl flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between shadow-lg">
                <div className="w-full lg:max-w-[72%]">
                    <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('monitor.gatewayTitle')}</h3>
                    <p className="text-sm text-slate-500 mt-1">{t('monitor.gatewayDesc')}</p>
                    <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white/70 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/50">
                      <div className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        {t('monitor.currentRuntimePathsTitle')}
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        {gatewayRuntimeZones.map((zone) => (
                          <div
                            key={zone.key}
                            className={`rounded-xl border px-3 py-3 bg-gradient-to-br ${zone.accent} ${zone.border}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
                                {zone.label}
                              </div>
                              <button
                                type="button"
                                onClick={() => openZoneFolder(zone.label, zone.folderPath)}
                                className="inline-flex items-center rounded-md border border-slate-300/90 bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-600 transition-colors hover:bg-white dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <FolderOpen size={12} className="mr-1" />
                                {t('monitor.openFolder')}
                              </button>
                            </div>
                            <div className="mt-2 break-all font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-200">
                              {zone.value || t('monitor.pathUnset')}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                </div>
                <button onClick={toggleGateway} className={`self-start lg:self-center px-8 py-4 rounded-2xl font-black flex items-center transition-all ${running ? 'bg-red-500/10 dark:bg-red-500/20 text-red-500 dark:text-red-400 border border-red-500/30 dark:border-red-500/40 hover:bg-red-500/20' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 dark:border-emerald-500/40 hover:bg-emerald-500/20'}`}>
                  {running ? <Square size={18} className="mr-2 fill-current" /> : <Play size={18} className="mr-2 fill-current" />}
                  {running ? t('monitor.disconnect') : t('monitor.startService')}
                  {telegramPairingRequests.length > 0 && (
                    <span className="ml-3 inline-flex min-w-6 items-center justify-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-white">
                      {telegramPairingRequests.length}
                    </span>
                  )}
                </button>
              </div>

              <ActionCenter />
              <StaffGrid />

              <div className="grid grid-cols-3 gap-8">
                <StatusCard label={t('monitor.status.node')} status={envStatus.node} />
                <StatusCard label={t('monitor.status.git')} status={envStatus.git} />
                <StatusCard label={t('monitor.status.pnpm')} status={envStatus.pnpm} />
              </div>

              <div className="bg-slate-50 dark:bg-black/90 rounded-3xl border border-slate-200 dark:border-slate-800 flex flex-col h-[400px] overflow-hidden shadow-2xl">
                 <div className="bg-slate-100 dark:bg-slate-900 px-6 py-3 border-b border-slate-200 dark:border-slate-800 text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest">{t('monitor.liveStream')}</div>
                 <div className="p-6 font-mono text-[12px] space-y-1.5 overflow-y-auto flex-1 text-slate-600 dark:text-slate-300">
                    {logs.map((log, i) => <div key={i} className="flex">
                        <span className="text-slate-400 dark:text-slate-600 mr-3">[{log.time}]</span>
                        <span>{String(log.text || '')}</span>
                    </div>)}
                 </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-900/30 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-8 rounded-3xl shadow-lg space-y-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">{t('monitor.telegramPairing.title')}</h3>
                    <p className="mt-1 text-sm text-slate-500">{t('monitor.telegramPairing.desc')}</p>
                    <div className="mt-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {t('monitor.telegramPairing.pendingCount', { count: telegramPairingRequests.length })}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void loadTelegramPairingRequests()}
                      disabled={telegramPairingLoading}
                      className="inline-flex items-center self-start rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <RefreshCw size={14} className={`mr-2 ${telegramPairingLoading ? 'animate-spin' : ''}`} />
                      {t('monitor.telegramPairing.refresh')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void clearTelegramPairingRequests()}
                      disabled={telegramPairingClearing || telegramPairingRequests.length === 0}
                      className="inline-flex items-center self-start rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-black uppercase tracking-wider text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                    >
                      {telegramPairingClearing ? <Loader2 size={14} className="mr-2 animate-spin" /> : <X size={14} className="mr-2" />}
                      {telegramPairingClearing ? t('monitor.telegramPairing.clearing') : t('monitor.telegramPairing.clearAll')}
                    </button>
                  </div>
                </div>

                {telegramPairingError && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                    {telegramPairingError}
                  </div>
                )}

                {!resolvedConfigDir ? (
                  <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                    {t('monitor.telegramPairing.missingConfig')}
                  </div>
                ) : telegramPairingLoading && telegramPairingRequests.length === 0 ? (
                  <div className="flex items-center rounded-2xl border border-slate-200 bg-white/80 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                    <Loader2 size={16} className="mr-2 animate-spin" />
                    {t('monitor.telegramPairing.loading')}
                  </div>
                ) : telegramPairingRequests.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                    {t('monitor.telegramPairing.empty')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">
                        {t('monitor.telegramPairing.authorizedTitle')}
                      </div>
                      {telegramAuthorizedUsers.length === 0 ? (
                        <div className="mt-3 text-sm text-slate-500 dark:text-slate-300">{t('monitor.telegramPairing.authorizedEmpty')}</div>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {telegramAuthorizedUsers.map((user) => (
                            <span key={user.id} className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-mono text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                              {user.id}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {telegramPairingRequests.map((request) => {
                      const requestedAt = request.createdAt ? new Date(request.createdAt).toLocaleString() : '-';
                      const username = request.meta?.username ? `@${request.meta.username}` : '-';
                      const displayName = [request.meta?.firstName, request.meta?.lastName].filter(Boolean).join(' ') || '-';
                      return (
                        <div key={`${request.id}-${request.code}`} className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{t('monitor.telegramPairing.telegramUserId')}</div>
                                <div className="mt-1 font-mono text-sm text-slate-700 dark:text-slate-100">{request.id || '-'}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{t('monitor.telegramPairing.code')}</div>
                                <div className="mt-1 font-mono text-sm text-slate-700 dark:text-slate-100">{request.code || '-'}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{t('monitor.telegramPairing.username')}</div>
                                <div className="mt-1 text-sm text-slate-700 dark:text-slate-100">{username}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{t('monitor.telegramPairing.displayName')}</div>
                                <div className="mt-1 text-sm text-slate-700 dark:text-slate-100">{displayName}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{t('monitor.telegramPairing.accountId')}</div>
                                <div className="mt-1 text-sm text-slate-700 dark:text-slate-100">{request.meta?.accountId || '-'}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{t('monitor.telegramPairing.requestedAt')}</div>
                                <div className="mt-1 text-sm text-slate-700 dark:text-slate-100">{requestedAt}</div>
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void approveTelegramPairing(request)}
                                disabled={telegramPairingApprovingCode === request.code || telegramPairingRejectingCode === request.code}
                                className="inline-flex items-center self-start rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300"
                              >
                                {telegramPairingApprovingCode === request.code ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
                                {telegramPairingApprovingCode === request.code ? t('monitor.telegramPairing.approving') : t('monitor.telegramPairing.approve')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void rejectTelegramPairing(request)}
                                disabled={telegramPairingRejectingCode === request.code || telegramPairingApprovingCode === request.code}
                                className="inline-flex items-center self-start rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-rose-700 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-300"
                              >
                                {telegramPairingRejectingCode === request.code ? <Loader2 size={14} className="mr-2 animate-spin" /> : <X size={14} className="mr-2" />}
                                {telegramPairingRejectingCode === request.code ? t('monitor.telegramPairing.rejecting') : t('monitor.telegramPairing.reject')}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
              <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
                  <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-8 shadow-xl shadow-slate-200/50 dark:shadow-none">
                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">Runtime Paths</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                          <div className="space-y-2 md:col-span-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.corePath')}</label>
                              <div className="flex items-stretch gap-2">
                                <input 
                                    type="text" 
                              value={config.corePath} 
                              onChange={(e) => setConfig({ corePath: e.target.value })}
                              placeholder={t('settings.corePathPlaceholder')}
                                    className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors" 
                                />
                                <button
                              onClick={() => handleBrowsePath('corePath')}
                                    title="Browse folder"
                                    className="px-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
                                >
                                    <FolderOpen size={15} className="text-slate-500 dark:text-slate-400" />
                                </button>
                              </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.configPath')}</label>
                              <div className="flex items-stretch gap-2">
                                <input 
                                    type="text" 
                              value={config.configPath} 
                              onChange={(e) => setConfig({ configPath: e.target.value })}
                              placeholder={t('settings.configPathPlaceholder')}
                                    className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors" 
                                />
                                <button
                              onClick={() => handleBrowsePath('configPath')}
                                    title="Browse folder"
                                    className="px-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
                                >
                                    <FolderOpen size={15} className="text-slate-500 dark:text-slate-400" />
                                </button>
                              </div>
                          </div>
                          <div className="space-y-2">
                              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.workspacePath')}</label>
                              <div className="flex items-stretch gap-2">
                                <input 
                                    type="text" 
                                    value={config.workspacePath} 
                                    onChange={(e) => setConfig({ workspacePath: e.target.value })}
                                    placeholder={t('settings.workspacePathPlaceholder')}
                                    className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors" 
                                />
                                <button
                                    onClick={() => handleBrowsePath('workspacePath')}
                                    title="Browse folder"
                                    className="px-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
                                >
                                    <FolderOpen size={15} className="text-slate-500 dark:text-slate-400" />
                                </button>
                              </div>
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">Gateway & Model</div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.gatewayPort')}</label>
                            <input 
                              type="text" 
                              value={config.gatewayPort} 
                              onChange={(e) => setConfig({ gatewayPort: e.target.value })}
                              placeholder={t('settings.gatewayPortPlaceholder')}
                              className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors" 
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.inferenceEngine')}</label>
                            <datalist id="model-options">
                              {availableModelOptions.map(({ group, models }) =>
                                models.map((m) => (
                                  <option key={`${group}-${m}`} value={m} label={group} />
                                ))
                              )}
                            </datalist>
                            <input
                              type="text"
                              list="model-options"
                              value={runtimeDraftModel}
                              onChange={(e) => setRuntimeDraftModel(e.target.value)}
                              placeholder="選擇或輸入模型（依授權帳號過濾）"
                              className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-blue-600 dark:text-blue-400 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                            />
                            <div className="text-[10px] text-slate-500 flex items-center gap-2">
                              <span>動態來源：{resolvedConfigFilePath || t('monitor.pathUnset')}</span>
                              {runtimeProviders.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400">
                                  {runtimeProviders.join('、')} 已授權
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{t('settings.externalTerminalTitle')}</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{t('settings.externalTerminalDesc')}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setConfig({ useExternalTerminal: !shouldUseExternalTerminal() })}
                            className={`shrink-0 inline-flex h-7 w-12 items-center rounded-full border transition-all ${shouldUseExternalTerminal() ? 'bg-emerald-500 border-emerald-500 justify-end' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 justify-start'}`}
                            aria-pressed={shouldUseExternalTerminal()}
                            aria-label={t('settings.externalTerminalTitle')}
                            title={t('settings.externalTerminalTitle')}
                          >
                            <span className="mx-1 h-5 w-5 rounded-full bg-white shadow-sm" />
                          </button>
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">Channel Credential</div>
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.botToken')}</label>
                          <input
                            type="text"
                            value={runtimeDraftBotToken}
                            onChange={(e) => setRuntimeDraftBotToken(e.target.value)}
                            placeholder={t('monitor.pathUnset')}
                            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-blue-600 dark:text-blue-400 font-mono outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                          />
                          <div className="text-[10px] text-slate-500">動態來源：{resolvedConfigFilePath || t('monitor.pathUnset')}（儲存時回寫）</div>
                        </div>
                      </div>
                  </div>
                  <button 
                    onClick={handleSaveConfig}
                    className="w-full bg-blue-600 hover:bg-blue-500 active:scale-[0.98] py-4 rounded-2xl font-black text-white shadow-xl shadow-blue-600/20 transition-all"
                  >
                    {t('settings.saveConfig')}
                  </button>
              </div>
          )}
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false, onClick }: { icon: any, label: string, active?: boolean, onClick: () => void }) {
  return (
    <div onClick={onClick} className={`flex items-center px-4 py-4 rounded-2xl cursor-pointer transition-all duration-300 ${active ? 'bg-blue-600/10 text-blue-400 shadow-inner' : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'}`}>
      <span className={`mr-4 ${active ? 'scale-110 opacity-100' : 'opacity-70'}`}>{icon}</span>
      <span className={`text-[13px] font-bold uppercase tracking-wider ${active ? 'opacity-100' : 'opacity-60'}`}>{label}</span>
    </div>
  );
}

function StatusCard({ label, status }: { label: string, status: string }) {
  const { t } = useTranslation();
  return (
    <div className="bg-slate-50 dark:bg-slate-900/20 backdrop-blur-sm border border-slate-200 dark:border-slate-800 p-6 rounded-3xl flex items-center justify-between group shadow-sm transition-all hover:border-slate-300 dark:hover:border-slate-700">
      <div className="flex-1">
        <div className="text-[10px] text-slate-500 dark:text-slate-600 uppercase font-black tracking-[0.2em] mb-2">{label}</div>
        <div className={`font-black tracking-tighter text-2xl ${status === 'ok' ? 'text-slate-800 dark:text-slate-100' : 'text-slate-400 dark:text-slate-600'}`}>{status === 'ok' ? t('monitor.status.verified') : t('monitor.status.analyzing')}</div>
      </div>
      {status === 'ok' ? <CheckCircle2 className="text-emerald-500 transition-transform group-hover:scale-110" /> : <Loader2 className="text-amber-500 animate-spin" />}
    </div>
  );
}

export default App;