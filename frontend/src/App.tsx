import { useState, useEffect, useRef, Component, type ErrorInfo, type ReactNode } from 'react';
import { Layout, Settings, Activity, CheckCircle2, Play, Square, Loader2, Boxes, MonitorPlay, BarChart3, LogOut, AlertCircle, X, FolderOpen, RefreshCw, Trash2, Plus, ShieldCheck, Brain, Cpu, Globe, Zap, Network, Database, Key } from 'lucide-react';
import { MiniView } from './components/MiniView';
import { SkillManager } from './components/SkillManager';
import { ActionCenter } from './components/ActionCenter';
import { StaffGrid } from './components/StaffGrid';
import { Analytics } from './components/Analytics';
import { ThemeToggle } from './components/ThemeToggle';
import { LanguageToggle } from './components/LanguageToggle';
import { ChatWidget } from './components/chat/ChatWidget';
import { DecisionDashboard } from './components/monitor/DecisionDashboard';
import TerminalLog from './components/common/TerminalLog';
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

type AuthProfileRow = {
  profileId: string;
  provider: string;
  mode: string;
  globalPresent: boolean;
  agentPresent: boolean;
  agentCount: number;
  credentialHealthy: boolean;
  diagnostics?: string[];
  severity?: 'ok' | 'warn' | 'critical';
  repairGuides?: string[];
};

type ModelOptionGroup = {
  provider: string;
  group: string;
  models: string[];
};

type ViewErrorBoundaryProps = {
  children: ReactNode;
  title: string;
  message: string;
};

type ViewErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string;
};

class ViewErrorBoundary extends Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  constructor(props: ViewErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(): ViewErrorBoundaryState {
    return { hasError: true, errorMessage: '' };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ViewErrorBoundary caught error:', error, errorInfo);
    this.setState({ errorMessage: String(error?.message || error || 'unknown error') });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-3xl border border-rose-300/60 bg-rose-50/60 p-6 text-left text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200">
          <div className="text-sm font-black uppercase tracking-widest">{this.props.title}</div>
          <div className="mt-2 text-sm">{this.props.message}</div>
          {this.state.errorMessage ? (
            <div className="mt-3 rounded-xl border border-rose-300/60 bg-white/60 px-3 py-2 font-mono text-xs text-rose-700 dark:border-rose-800/60 dark:bg-rose-900/30 dark:text-rose-200">
              {this.state.errorMessage}
            </div>
          ) : null}
        </div>
      );
    }

    return this.props.children;
  }
}

function App() {
  const ONBOARDING_FINISHED_KEY = 'onboarding_finished';
  const ONBOARDING_FORCE_RESET_KEY = 'onboarding_force_reset';

  const { running, setRunning, logs, addLog, envStatus, setEnvStatus, config, setConfig, detectedConfig, setDetectedConfig, setCoreSkills, setWorkspaceSkills, snapshot, auditTimeline, dailyDigest, setSnapshot, setSnapshotHistory, setEventQueue, setAckedEvents, setAuditTimeline, setDailyDigest, setRawSnapshot, setSnapshotSourcePath } = useStore();
  const [viewMode, setViewMode] = useState<'mini' | 'expanded'>('expanded');
  const [activeTab, setActiveTab] = useState('monitor'); // Default to monitor if onboarding finished
  const [onboardingFinished, setOnboardingFinished] = useState(
    () => {
      const forceReset = localStorage.getItem(ONBOARDING_FORCE_RESET_KEY) === 'true';
      return !forceReset && localStorage.getItem(ONBOARDING_FINISHED_KEY) === 'true';
    }
  );
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [gatewayConflictModal, setGatewayConflictModal] = useState<{ message: string; detail: string; port: number } | null>(null);
  const [killingGatewayPortHolder, setKillingGatewayPortHolder] = useState(false);
  const [gatewayConflictActionMessage, setGatewayConflictActionMessage] = useState('');
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
  const [authProfiles, setAuthProfiles] = useState<AuthProfileRow[]>([]);
  const [authProfileSummary, setAuthProfileSummary] = useState<{ total: number; healthy: number; warn: number; critical: number } | null>(null);
  const [authProfilesLoading, setAuthProfilesLoading] = useState(false);
  const [authProfilesError, setAuthProfilesError] = useState('');
  const [authRemovingId, setAuthRemovingId] = useState('');
  const [authAdding, setAuthAdding] = useState(false);
  const [authAddProvider, setAuthAddProvider] = useState('anthropic');
  const [authAddChoice, setAuthAddChoice] = useState('apiKey');
  const [authAddSecret, setAuthAddSecret] = useState('');
  const [authAddError, setAuthAddError] = useState('');
  const [authAddTokenCommand, setAuthAddTokenCommand] = useState('claude setup-token');
  const [authAddTokenRunning, setAuthAddTokenRunning] = useState(false);
  const [authAddTokenError, setAuthAddTokenError] = useState('');
  const [dynamicModelOptions, setDynamicModelOptions] = useState<ModelOptionGroup[]>([]);
  const [dynamicModelSource, setDynamicModelSource] = useState('');
  const [dynamicModelLoading, setDynamicModelLoading] = useState(false);
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

  const PROVIDER_ALIAS_MAP: Record<string, string[]> = {
    anthropic: ['anthropic'],
    openai: ['openai', 'openai-codex'],
    'openai-codex': ['openai-codex', 'openai'],
    google: ['google', 'gemini'],
    gemini: ['gemini', 'google'],
    minimax: ['minimax'],
    moonshot: ['moonshot'],
    openrouter: ['openrouter'],
    xai: ['xai'],
    ollama: ['ollama'],
    vllm: ['vllm'],
    chutes: ['chutes'],
    qwen: ['qwen', 'qwen-portal'],
    'qwen-portal': ['qwen-portal', 'qwen'],
  };

  const getProviderAliases = (providerRef: string) => {
    const normalized = String(providerRef || '').trim().toLowerCase();
    if (!normalized) return [];
    return PROVIDER_ALIAS_MAP[normalized] || [normalized];
  };

  const providerMatchesFilters = (providerRef: string, filters: string[]) => {
    const providerAliases = getProviderAliases(providerRef);
    if (filters.length === 0) return true;
    return filters.some((filter) => {
      const filterAliases = getProviderAliases(filter);
      return providerAliases.some((alias) => filterAliases.includes(alias));
    });
  };

  const inferProviderFromModel = (modelRef: string) => {
    const model = String(modelRef || '').trim().toLowerCase();
    if (!model) return '';
    if (model.includes('/')) {
      return model.split('/')[0];
    }
    if (model.startsWith('claude')) return 'anthropic';
    if (model.startsWith('gpt') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
    if (model.startsWith('gemini')) return 'google';
    if (model.startsWith('minimax')) return 'minimax';
    if (model.startsWith('kimi')) return 'moonshot';
    if (model.startsWith('grok')) return 'xai';
    if (model.startsWith('ollama')) return 'ollama';
    return '';
  };

  const getProviderDisplayLabel = (providerRef: string, fallbackLabel?: string) => {
    const normalized = String(providerRef || '').trim().toLowerCase();
    return PROVIDER_MODEL_CATALOGUE[normalized]?.label || fallbackLabel || providerRef || 'Unknown';
  };

  const runtimeProviders: string[] = (runtimeProfile as any)?.providers ?? [];

  type AuthChoiceItem = { id: string; name: string; desc: string; reqKey: boolean; oauthFlow?: boolean };
  type ProviderGroupItem = { id: string; label: string; icon: React.ReactNode; choices: AuthChoiceItem[] };
  const SETTINGS_PROVIDER_GROUPS: ProviderGroupItem[] = [
    {
      id: 'anthropic', label: 'Anthropic', icon: <Brain size={13} />,
      choices: [
        { id: 'apiKey', name: 'API Key', desc: 'Anthropic 官方密鑰', reqKey: true },
        { id: 'token', name: 'Setup Token', desc: 'CLI 產生的 Setup-Token', reqKey: true },
      ],
    },
    {
      id: 'openai', label: 'OpenAI', icon: <Cpu size={13} />,
      choices: [
        { id: 'openai-api-key', name: 'API Key', desc: 'OpenAI sk-... 密鑰', reqKey: true },
        { id: 'openai-codex', name: 'Codex OAuth', desc: '瀏覽器登入授權，無須 Key', reqKey: false, oauthFlow: true },
      ],
    },
    {
      id: 'google', label: 'Google', icon: <Globe size={13} />,
      choices: [
        { id: 'gemini-api-key', name: 'API Key', desc: 'AIzaSy... Gemini 密鑰', reqKey: true },
        { id: 'google-gemini-cli', name: 'Gemini OAuth', desc: 'CLI OAuth 非官方授權', reqKey: false, oauthFlow: true },
      ],
    },
    {
      id: 'openrouter', label: 'OpenRouter', icon: <Globe size={13} />,
      choices: [
        { id: 'openrouter-api-key', name: 'API Key', desc: 'OpenRouter 統一閘道密鑰', reqKey: true },
      ],
    },
    {
      id: 'minimax', label: 'MiniMax', icon: <Zap size={13} />,
      choices: [
        { id: 'minimax-api', name: 'API Key', desc: 'MiniMax 官方密鑰', reqKey: true },
        { id: 'minimax-portal', name: 'OAuth', desc: '瀏覽器授權登入', reqKey: false, oauthFlow: true },
      ],
    },
    {
      id: 'moonshot', label: 'Moonshot', icon: <Zap size={13} />,
      choices: [
        { id: 'moonshot-api-key', name: 'Kimi API Key', desc: 'Moonshot 平台密鑰', reqKey: true },
      ],
    },
    {
      id: 'xai', label: 'xAI', icon: <Cpu size={13} />,
      choices: [
        { id: 'xai-api-key', name: 'Grok API Key', desc: 'xAI 平台密鑰', reqKey: true },
      ],
    },
    {
      id: 'chutes', label: 'Chutes', icon: <Network size={13} />,
      choices: [
        { id: 'chutes', name: 'OAuth', desc: 'Chutes 去中心化平台授權', reqKey: false, oauthFlow: true },
      ],
    },
    {
      id: 'local', label: 'Local', icon: <Database size={13} />,
      choices: [
        { id: 'ollama', name: 'Ollama', desc: '本地 11434 端口，隱私至上', reqKey: false },
        { id: 'vllm', name: 'vLLM', desc: '自定義本地伺服器', reqKey: false },
      ],
    },
  ];
  const healthyAuthProviders = Array.from(new Set(
    authProfiles
      .filter((profile) => profile.agentPresent && profile.credentialHealthy)
      .map((profile) => String(profile.provider || profile.profileId.split(':')[0] || '').toLowerCase())
      .filter(Boolean)
  ));

  const effectiveAuthorizedProviders = healthyAuthProviders.length > 0
    ? healthyAuthProviders
    : runtimeProviders.map((provider) => String(provider || '').toLowerCase()).filter(Boolean);

  const fallbackModelOptions: ModelOptionGroup[] = effectiveAuthorizedProviders.length > 0
    ? effectiveAuthorizedProviders
        .map((p: string) => {
          const entry = PROVIDER_MODEL_CATALOGUE[p.toLowerCase()];
          return entry ? { provider: p.toLowerCase(), group: entry.label, models: entry.models } : null;
        })
        .filter(Boolean) as ModelOptionGroup[]
    : Object.entries(PROVIDER_MODEL_CATALOGUE).map(([provider, entry]) => ({ provider, group: entry.label, models: entry.models }));

  const availableModelOptions: ModelOptionGroup[] = dynamicModelOptions.length > 0
    ? dynamicModelOptions
    : fallbackModelOptions;

  const visibleModelOptions: ModelOptionGroup[] = availableModelOptions.filter(({ provider }) => providerMatchesFilters(provider, effectiveAuthorizedProviders));
  const modelOptionGroups = visibleModelOptions.length > 0 ? visibleModelOptions : availableModelOptions;
  const selectedModelProvider = inferProviderFromModel(runtimeDraftModel);
  const selectedModelAuthorized = !runtimeDraftModel.trim() || isModelAuthorizedByProvider(runtimeDraftModel);
  const authorizedProviderBadges = Array.from(new Set(
    (healthyAuthProviders.length > 0 ? healthyAuthProviders : runtimeProviders.map((provider) => String(provider || '').toLowerCase()).filter(Boolean))
  ));

  const buildOpenClawEnvPrefix = (cfg?: any) => {
    const configDir = normalizeConfigDir(cfg?.configPath ?? config.configPath);
    const configFilePath = configDir ? `${configDir}/openclaw.json` : '';
    const stateDirEnv = configDir ? `OPENCLAW_STATE_DIR=${shellQuote(configDir)} ` : '';
    const configPathEnv = configFilePath ? `OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} ` : '';
    return `${stateDirEnv}${configPathEnv}`;
  };

  const resolveGatewayPortArg = (cfg?: any): string | null => {
    const raw = String(cfg?.gatewayPort ?? config.gatewayPort ?? '').trim();
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) return null;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return ` --port ${port}`;
  };

  const resolveGatewayPortForPrecheck = (cfg?: any): { port: number } | null => {
    const raw = String(cfg?.gatewayPort ?? config.gatewayPort ?? '').trim();
    if (!raw) return null;
    if (!/^\d+$/.test(raw)) return null;
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { port };
  };

  const isGatewayListeningOnConfiguredPort = async (cfg?: any): Promise<boolean | null> => {
    if (!window.electronAPI) return null;
    const portInfo = resolveGatewayPortForPrecheck(cfg);
    if (!portInfo) return null;

    try {
      const probeRes: any = await window.electronAPI.exec(`lsof -nP -iTCP:${portInfo.port} -sTCP:LISTEN`);
      const probeCode = probeRes.code ?? probeRes.exitCode;
      const probeOutput = String(probeRes.stdout || '').trim();
      return probeCode === 0 && !!probeOutput;
    } catch {
      return null;
    }
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

  const loadAuthProfiles = async () => {
    if (!window.electronAPI || !resolvedConfigDir) {
      setAuthProfiles([]);
      setAuthProfileSummary(null);
      setAuthProfilesError('');
      return;
    }

    setAuthProfilesLoading(true);
    setAuthProfilesError('');
    try {
      const res = await window.electronAPI.exec(`auth:list-profiles ${JSON.stringify({ configPath: resolvedConfigDir })}`);
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || '讀取授權清單失敗');
      }
      const parsed = JSON.parse(res.stdout || '{}');
      const rows = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
      setAuthProfiles(rows);
      setAuthProfileSummary(parsed?.summary || null);
    } catch (e: any) {
      setAuthProfiles([]);
      setAuthProfileSummary(null);
      setAuthProfilesError(e?.message || '讀取授權清單失敗');
    } finally {
      setAuthProfilesLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'settings') return;
    void loadAuthProfiles();
  }, [activeTab, resolvedConfigDir]);

  useEffect(() => {
    if (activeTab !== 'settings') return;
    setRuntimeDraftModel(effectiveRuntimeModel);
    setRuntimeDraftBotToken(effectiveRuntimeBotToken);
  }, [activeTab, effectiveRuntimeModel, effectiveRuntimeBotToken]);

  const loadDynamicModelOptions = async () => {
    if (!window.electronAPI || !resolvedConfigDir) {
      setDynamicModelOptions([]);
      setDynamicModelSource('');
      return;
    }

    setDynamicModelLoading(true);
    try {
      const payload = {
        corePath: config.corePath,
        configPath: resolvedConfigDir,
        providers: effectiveAuthorizedProviders,
      };
      const res = await window.electronAPI.exec(`config:model-options ${JSON.stringify(payload)}`);
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || '讀取動態模型清單失敗');
      }
      const parsed = JSON.parse(res.stdout || '{}');
      const groups = Array.isArray(parsed?.groups)
        ? parsed.groups
            .map((group: any) => ({
              provider: String(group?.provider || group?.group || '').trim().toLowerCase() || 'unknown',
              group: String(group?.group || group?.provider || '').trim() || 'unknown',
              models: Array.isArray(group?.models) ? group.models.map((m: any) => String(m || '').trim()).filter(Boolean) : [],
            }))
            .filter((group: any) => group.models.length > 0)
        : [];
      setDynamicModelOptions(groups);
      setDynamicModelSource(String(parsed?.source || ''));
    } catch {
      setDynamicModelOptions([]);
      setDynamicModelSource('');
    } finally {
      setDynamicModelLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'settings') return;
    void loadDynamicModelOptions();
  }, [activeTab, resolvedConfigDir, config.corePath, effectiveAuthorizedProviders.join('|')]);

  function isModelAuthorizedByProvider(modelRef: string) {
    const model = String(modelRef || '').trim().toLowerCase();
    if (!model || effectiveAuthorizedProviders.length === 0) return true;

    const runtimeAliases = new Set(effectiveAuthorizedProviders.flatMap((provider) => getProviderAliases(provider)));

    const inferredProvider = inferProviderFromModel(model);

    if (!inferredProvider) return true;
    const inferredAliases = getProviderAliases(inferredProvider);
    return inferredAliases.some((alias) => runtimeAliases.has(alias));
  }

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
    if (activeTab !== 'settings') return;
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

    const forceReset = localStorage.getItem(ONBOARDING_FORCE_RESET_KEY) === 'true';

    // If runtime paths already exist, treat onboarding as finished even when
    // localStorage flag is missing (e.g., fresh renderer profile or cleared storage).
    // But if user explicitly requested reset, force onboarding to show until completed again.
    const finished = !forceReset && (localStorage.getItem(ONBOARDING_FINISHED_KEY) === 'true' || hasAnyConfiguredPath);
    if (finished) {
      localStorage.setItem(ONBOARDING_FINISHED_KEY, 'true');
      localStorage.removeItem(ONBOARDING_FORCE_RESET_KEY);
    }
    setOnboardingFinished(finished);
    if (!finished) {
      setActiveTab('onboarding');
    } else {
      setActiveTab('monitor');
    }
  };

  const handleOnboardingComplete = () => {
    localStorage.setItem(ONBOARDING_FINISHED_KEY, 'true');
    localStorage.removeItem(ONBOARDING_FORCE_RESET_KEY);
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

        const historyCandidates = [
          resolvedConfigDir ? `${resolvedConfigDir}/runtime/usage-cost.jsonl` : '',
          resolvedConfigDir ? `${resolvedConfigDir}/runtime/timeline.log` : '',
          config.workspacePath ? `${config.workspacePath}/runtime/usage-cost.jsonl` : '',
          config.workspacePath ? `${config.workspacePath}/gateway.log` : '',
          config.corePath ? `${config.corePath}/runtime/usage-cost.jsonl` : ''
        ].filter(Boolean);

        const res = await window.electronAPI.exec(`snapshot:read-model ${JSON.stringify({ candidatePaths: snapshotCandidates, historyCandidatePaths: historyCandidates, historyDays: 30 })}`);
        const code = res.code ?? res.exitCode;
        if (code === 0 && res.stdout) {
          const parsed = JSON.parse(res.stdout || '{}');
          setRawSnapshot(parsed.snapshot || null);
          setSnapshot(parsed.readModel || null);
          setSnapshotHistory(Array.isArray(parsed.history) ? parsed.history : []);
          setEventQueue(Array.isArray(parsed.eventQueue) ? parsed.eventQueue : []);
          setAckedEvents(Array.isArray(parsed.ackedEvents) ? parsed.ackedEvents : []);
          setAuditTimeline(Array.isArray(parsed.auditTimeline) ? parsed.auditTimeline : []);
          setDailyDigest(String(parsed.dailyDigest || ''));
          setSnapshotSourcePath(String(parsed.sourcePath || ''));
        }
      } catch (e) {
        // Silent fail if not exists yet
      }
    }
  };

  const syncGatewayStatus = async (runtimeConfig?: any) => {
      try {
        const effectiveConfig = runtimeConfig || config;
        const listening = await isGatewayListeningOnConfiguredPort(effectiveConfig);
        if (listening !== null) {
          setRunning(listening);
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
        // 停止前先關閉外部 Terminal 模式 watchdog，避免手動停止後被誤拉起。
        await window.electronAPI.exec('gateway:http-watchdog-stop').catch(() => {});
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
        const hasPortIsolation = portArg !== null;
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
          const message = `錯誤: 啟動前檢查到 Port ${precheck.port} 已被占用，請改用其他 Gateway Port。`;
          addLog(message, 'stderr');
          addLog(precheckOutput, 'stderr');
          setGatewayConflictActionMessage('');
          setKillingGatewayPortHolder(false);
          setGatewayConflictModal({ message, detail: precheckOutput, port: precheck.port });
          return;
        }

        // 先確認 corePath 目錄存在
        const checkDir = await window.electronAPI.exec(`test -d ${shellQuote(config.corePath)}`);
        if ((checkDir.code ?? checkDir.exitCode) !== 0) {
          addLog(`錯誤: Core Path 目錄不存在：${config.corePath}`, 'stderr');
          return;
        }

        const useExternalTerminal = shouldUseExternalTerminal();
        let startCmd = '';
        if (useExternalTerminal) {
          startCmd = config.installDaemon
            ? `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway start${portArg}`
            : `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway run${portArg} --verbose --force`;

          // 先關閉既有 http watchdog，避免沿用舊命令。
          await window.electronAPI.exec('gateway:http-watchdog-stop').catch(() => {});

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
          await window.electronAPI.exec('gateway:http-watchdog-stop').catch(() => {});
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
          await window.electronAPI.exec('gateway:http-watchdog-stop').catch(() => {});
          // 非 daemon 模式：gateway run 是前台長駐進程，需透過 gateway:start-bg 背景 spawn
          const runCmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway run${portArg} --verbose --force`;
          const payload = {
            command: runCmd,
            autoRestart: !!config.autoRestartGateway,
            restartInForegroundTerminal: !!config.restartInForegroundTerminal,
          };
          const resRaw: any = await window.electronAPI.exec(`gateway:start-bg-json ${JSON.stringify(payload)}`);
          const code = resRaw.code ?? resRaw.exitCode;
          if (code !== 0) {
            addLog(t('logs.startGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
            return;
          }
          addLog(t('logs.gatewayStartCmdSent'), 'system');
          // 等待 port 綁定
          await new Promise((r) => setTimeout(r, 2000));
        }

        // 以目標埠 LISTEN 狀態確認，避免被其他實例/服務狀態輸出干擾。
        const listening = await isGatewayListeningOnConfiguredPort(config);
        if (listening) {
          setRunning(true);
          addLog(t('logs.gatewayStarted'), 'system');

          // 外部 Terminal + 非 daemon 可選擇啟用 HTTP watchdog，實現異常離線自動重啟。
          if (useExternalTerminal && !config.installDaemon) {
            const portInfo = resolveGatewayPortForPrecheck(config);
            const healthCheckCommand = portInfo
              ? `lsof -nP -iTCP:${portInfo.port} -sTCP:LISTEN`
              : '';
            const watchdogPayload = {
              enabled: !!config.autoRestartGateway,
              healthCheckCommand,
              restartCommand: startCmd,
              intervalMs: 15000,
              failThreshold: 2,
              maxRestarts: 5,
            };
            const wdRes: any = await window.electronAPI.exec(`gateway:http-watchdog-start-json ${JSON.stringify(watchdogPayload)}`);
            const wdCode = wdRes.code ?? wdRes.exitCode;
            if (wdCode === 0) {
              addLog(
                config.autoRestartGateway
                  ? '已啟用外部 Terminal 模式 Gateway watchdog（HTTP 健康檢查 + 自動重啟）'
                  : '外部 Terminal 模式 watchdog 已停用（依設定）',
                'system',
              );
            } else {
              addLog(`watchdog 設定失敗：${wdRes.stderr || `exit ${wdCode}`}`, 'stderr');
            }
          }
        } else {
          addLog(t('logs.startGatewayFailed', { msg: '目標埠未進入 LISTEN 狀態' }), 'stderr');
        }
      } catch (e: any) {
        addLog(t('logs.startGatewayFailed', { msg: e.message }), 'stderr');
      }
    }
  };

  const closeGatewayConflictModal = () => {
    setGatewayConflictModal(null);
    setGatewayConflictActionMessage('');
    setKillingGatewayPortHolder(false);
  };

  const handleKillGatewayPortHolder = async () => {
    if (!window.electronAPI || !gatewayConflictModal) {
      return;
    }

    setKillingGatewayPortHolder(true);
    setGatewayConflictActionMessage('');

    try {
      const result = await window.electronAPI.killPortHolder(gatewayConflictModal.port);
      if (result.success) {
        const allKilled = [
          ...(result.killed || []),
          ...(result.forceKilled || []),
        ];
        const uniqueKilled = Array.from(new Set(allKilled));
        const partialFailed = (result.failed || []).length > 0;
        const successMsg = uniqueKilled.length > 0
          ? `已強制關閉 Port ${gatewayConflictModal.port} 占用程序（PID: ${uniqueKilled.join(', ')}）${partialFailed ? '，但仍有部分 PID 關閉失敗。' : '。'}`
          : `已嘗試強制關閉 Port ${gatewayConflictModal.port} 占用程序。`;
        setGatewayConflictActionMessage(successMsg);
        addLog(successMsg, partialFailed ? 'stderr' : 'system');
        // 強制關閉成功後自動關閉衝突視窗，避免使用者再手動關閉。
        window.setTimeout(() => {
          closeGatewayConflictModal();
        }, 350);
      } else {
        const errorMsg = result.error || `無法關閉 Port ${gatewayConflictModal.port} 的占用程序`;
        setGatewayConflictActionMessage(errorMsg);
        addLog(errorMsg, 'stderr');
      }
    } catch (e: any) {
      const errorMsg = e?.message || `關閉 Port ${gatewayConflictModal.port} 占用程序時發生錯誤`;
      setGatewayConflictActionMessage(errorMsg);
      addLog(errorMsg, 'stderr');
    } finally {
      setKillingGatewayPortHolder(false);
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

    const gatewayPortRaw = String(config.gatewayPort ?? '').trim();
    if (!gatewayPortRaw || !/^\d+$/.test(gatewayPortRaw)) {
      addLog('錯誤: Gateway Port 未填或格式不正確，儲存已中止。請先至設定頁填入有效的 Gateway Port（正整數）後再儲存。', 'stderr');
      return;
    }

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
          if (!isModelAuthorizedByProvider(nextModel)) {
            throw new Error('所選模型與目前授權 provider 不相符，請改用授權清單中的模型。');
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

  const handleRemoveAuthProfile = async (profileId: string) => {
    if (!window.electronAPI || !resolvedConfigDir || !profileId) return;
    setAuthRemovingId(profileId);
    setAuthAddError('');
    try {
      const res = await window.electronAPI.exec(`auth:remove-profile ${JSON.stringify({ configPath: resolvedConfigDir, profileId })}`);
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || '移除授權失敗');
      }
      addLog(`已取消授權：${profileId}`, 'system');
      await loadAuthProfiles();
      const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
      if (probeRes.code === 0 && probeRes.stdout) {
        setRuntimeProfile(JSON.parse(probeRes.stdout));
      }
    } catch (e: any) {
      const msg = e?.message || '移除授權失敗';
      setAuthAddError(msg);
      addLog(msg, 'stderr');
    } finally {
      setAuthRemovingId('');
    }
  };

  const handleAddAuthProfile = async () => {
    if (!window.electronAPI) return;
    setAuthAddError('');

    if (!resolvedConfigDir) {
      setAuthAddError('缺少 Config Path，無法新增授權。');
      return;
    }
    if (!config.corePath?.trim()) {
      setAuthAddError('缺少 Core Path，無法新增授權。');
      return;
    }

    // OAuth 選項：委派給終端機執行授權流程
    const _curGroup = SETTINGS_PROVIDER_GROUPS.find(g => g.id === authAddProvider);
    const _curChoice = _curGroup?.choices.find(c => c.id === authAddChoice);
    if (_curChoice?.oauthFlow) {
      await handleLaunchFullOnboarding();
      return;
    }

    const requiresSecret = _curChoice?.reqKey ?? !['ollama', 'vllm'].includes(authAddChoice);
    if (requiresSecret && !authAddSecret.trim()) {
      setAuthAddError('此授權方式需要輸入憑證。');
      return;
    }

    setAuthAdding(true);
    try {
      const payload = {
        corePath: config.corePath,
        configPath: resolvedConfigDir,
        workspacePath: config.workspacePath,
        authChoice: authAddChoice,
        secret: authAddSecret,
      };
      const res = await window.electronAPI.exec(`auth:add-profile ${JSON.stringify(payload)}`);
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || '新增授權失敗');
      }
      addLog(`新增授權成功：${authAddChoice}`, 'system');
      setAuthAddSecret('');
      await loadAuthProfiles();
      const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
      if (probeRes.code === 0 && probeRes.stdout) {
        setRuntimeProfile(JSON.parse(probeRes.stdout));
      }
    } catch (e: any) {
      const msg = e?.message || '新增授權失敗';
      setAuthAddError(msg);
      addLog(msg, 'stderr');
    } finally {
      setAuthAdding(false);
    }
  };

  const handleLaunchFullOnboarding = async () => {
    if (!config.corePath?.trim()) {
      setAuthAddError('缺少 Core Path，無法啟動完整導引。');
      return;
    }
    if (!resolvedConfigDir) {
      setAuthAddError('缺少 Config Path，無法啟動完整導引。');
      return;
    }

    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const cmd = `${envPrefix}pnpm openclaw onboard`;
      await execInTerminal(cmd, {
        title: 'OpenClaw 完整授權導引',
        holdOpen: true,
        cwd: config.corePath,
      });
      addLog('已啟動完整導引，完成後可回設定頁刷新授權清單。', 'system');
      await loadAuthProfiles();
    } catch (e: any) {
      const msg = e?.message || '啟動完整導引失敗';
      setAuthAddError(msg);
      addLog(msg, 'stderr');
    }
  };

  const handleRunAuthTokenCommand = async () => {
    const command = (authAddTokenCommand || '').trim();
    if (!command) {
      setAuthAddTokenError('請先輸入要執行的指令');
      return;
    }
    setAuthAddTokenRunning(true);
    setAuthAddTokenError('');
    try {
      const res = await execInTerminal(command, {
        title: 'Claude Token 授權流程',
        holdOpen: true,
        cwd: config.corePath || undefined,
      });
      const code = (res as any)?.code ?? (res as any)?.exitCode;
      if (typeof code === 'number' && code !== 0) {
        throw new Error(res?.stderr || '指令執行失敗');
      }
    } catch (err: any) {
      setAuthAddTokenError(err?.message || '執行指令時發生錯誤');
    } finally {
      setAuthAddTokenRunning(false);
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
        const hasPortIsolation = portArg !== null;

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

          // 停止後以目標埠 LISTEN 驗證，避免被其他服務輸出誤導。
          const listening = await isGatewayListeningOnConfiguredPort(config);
          stopped = listening === false;
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
    localStorage.removeItem(ONBOARDING_FINISHED_KEY);
    localStorage.setItem(ONBOARDING_FORCE_RESET_KEY, 'true');
    setOnboardingFinished(false);
    setActiveTab('onboarding');
    setShowLogoutConfirm(false);
  };

  if (viewMode === 'mini') {
    return (
      <>
        <MiniView running={running} onToggle={toggleGateway} onExpand={toggleViewMode} />
        <ChatWidget compact />
      </>
    );
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
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={closeGatewayConflictModal}></div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 slide-in-from-bottom-8 duration-300">
              <div className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                  <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center text-amber-500">
                    <AlertCircle size={24} />
                  </div>
                  <button onClick={closeGatewayConflictModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
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

                {!!gatewayConflictActionMessage && (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 p-4 text-sm text-slate-600 dark:text-slate-300">
                    {gatewayConflictActionMessage}
                  </div>
                )}

                <div className="flex gap-4 pt-2">
                  <button
                    onClick={() => setActiveTab('settings')}
                    className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
                  >
                    前往設定修改 Port
                  </button>
                  <button
                    onClick={handleKillGatewayPortHolder}
                    disabled={killingGatewayPortHolder}
                    className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {killingGatewayPortHolder ? '處理中...' : '強制關閉該程序'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 p-10 overflow-y-auto relative">
          {activeTab !== 'onboarding' && onboardingFinished && <UpdateBanner />}
          {activeTab === 'skills' && <SkillManager />}

          {activeTab === 'analytics' && (
            <ViewErrorBoundary
              title={t('app.headers.analytics')}
              message={t('logs.commFailed', { msg: 'Analytics view crashed. Please switch tabs and try again.' })}
            >
              <Analytics />
            </ViewErrorBoundary>
          )}

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
                </button>
              </div>

              <DecisionDashboard
                running={running}
                envStatus={envStatus}
                config={config}
                resolvedConfigDir={resolvedConfigDir}
                snapshot={snapshot}
              />

              <div id="monitor-action-center">
                <ActionCenter />
              </div>
              <div id="monitor-staff-grid">
                <StaffGrid />
              </div>

              <div className="grid grid-cols-3 gap-8">
                <StatusCard label={t('monitor.status.node')} status={envStatus.node} />
                <StatusCard label={t('monitor.status.git')} status={envStatus.git} />
                <StatusCard label={t('monitor.status.pnpm')} status={envStatus.pnpm} />
              </div>

              <div id="monitor-live-stream">
                <TerminalLog
                  logs={logs}
                  height="h-[420px]"
                  title={t('monitor.liveStream')}
                  timeline={auditTimeline}
                  dailyDigest={dailyDigest}
                />
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
                            <div className="flex items-center justify-between gap-3">
                              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">{t('settings.inferenceEngine')}</label>
                              {selectedModelProvider && (
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${selectedModelAuthorized ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300'}`}>
                                  <Key size={11} />
                                  {getProviderDisplayLabel(selectedModelProvider, selectedModelProvider)}
                                </span>
                              )}
                            </div>
                            <div className="rounded-[24px] border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-white via-slate-50 to-sky-50/70 dark:from-slate-950/70 dark:via-slate-900/60 dark:to-sky-950/30 p-4 space-y-4 shadow-lg shadow-slate-200/40 dark:shadow-none">
                              <div className="flex flex-wrap items-center gap-2">
                                {authorizedProviderBadges.length > 0 ? authorizedProviderBadges.map((provider) => (
                                  <span
                                    key={provider}
                                    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                                  >
                                    <ShieldCheck size={11} />
                                    {getProviderDisplayLabel(provider, provider)}
                                  </span>
                                )) : (
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400">尚未偵測到可驗證授權，暫時顯示保底模型目錄。</span>
                                )}
                              </div>

                              {modelOptionGroups.length > 0 ? (
                                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                                  {modelOptionGroups.map(({ provider, group, models }) => (
                                    <div
                                      key={`${provider}-${group}`}
                                      className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 dark:border-slate-700/70 dark:bg-slate-900/60"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">
                                          {getProviderDisplayLabel(provider, group)}
                                        </div>
                                        <div className="text-[10px] text-slate-400 dark:text-slate-500">{models.length} models</div>
                                      </div>
                                      <div className="mt-3 flex flex-wrap gap-2">
                                        {models.slice(0, 6).map((model) => {
                                          const selected = runtimeDraftModel === model;
                                          return (
                                            <button
                                              key={model}
                                              type="button"
                                              onClick={() => setRuntimeDraftModel(model)}
                                              className={`rounded-xl border px-3 py-2 text-left font-mono text-[11px] transition-colors ${selected ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-300' : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-900'}`}
                                            >
                                              {model}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300">
                                  尚未從目前授權狀態取得可選模型。請先確認授權 profile 健康，或重新整理設定頁。
                                </div>
                              )}

                              <datalist id="authorized-model-options">
                                {modelOptionGroups.map(({ group, models }) =>
                                  models.map((model) => (
                                    <option key={`${group}-${model}`} value={model} label={group} />
                                  ))
                                )}
                              </datalist>

                              <div className="space-y-2">
                                <input
                                  type="text"
                                  list="authorized-model-options"
                                  value={runtimeDraftModel}
                                  onChange={(e) => setRuntimeDraftModel(e.target.value)}
                                  placeholder="選擇或輸入模型（依授權帳號過濾）"
                                  className={`w-full rounded-2xl border px-4 py-3 font-mono text-xs outline-none transition-colors ${selectedModelAuthorized ? 'bg-white dark:bg-black/40 border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 focus:border-blue-400 dark:focus:border-blue-500/50' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 focus:border-amber-400 dark:focus:border-amber-600'}`}
                                />
                                <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
                                  <span>模型來源：{dynamicModelOptions.length > 0 ? '動態' : '靜態'} {dynamicModelSource ? `(${dynamicModelSource})` : `(${resolvedConfigFilePath || t('monitor.pathUnset')})`}</span>
                                  {dynamicModelLoading && (
                                    <span className="inline-flex items-center gap-1 text-sky-500">
                                      <Loader2 size={12} className="animate-spin" />
                                      載入中
                                    </span>
                                  )}
                                  {!selectedModelAuthorized && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300">
                                      目前模型不在已授權 provider 範圍
                                    </span>
                                  )}
                                </div>
                              </div>
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

                        <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">自動重啟 Gateway（崩潰時）</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">僅套用於非 daemon 且背景啟動模式，異常退出時自動重啟。</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setConfig({ autoRestartGateway: !config.autoRestartGateway })}
                            className={`shrink-0 inline-flex h-7 w-12 items-center rounded-full border transition-all ${config.autoRestartGateway ? 'bg-emerald-500 border-emerald-500 justify-end' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 justify-start'}`}
                            aria-pressed={config.autoRestartGateway}
                            aria-label="自動重啟 Gateway"
                            title="自動重啟 Gateway"
                          >
                            <span className="mx-1 h-5 w-5 rounded-full bg-white shadow-sm" />
                          </button>
                        </div>

                        <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4">
                          <div>
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">自動重啟改用前台 Terminal</div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">啟用後，發生自動重啟時會以 macOS Terminal 前台視窗重新啟動，避免權限上下文遺失。</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setConfig({ restartInForegroundTerminal: !config.restartInForegroundTerminal })}
                            className={`shrink-0 inline-flex h-7 w-12 items-center rounded-full border transition-all ${config.restartInForegroundTerminal ? 'bg-emerald-500 border-emerald-500 justify-end' : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 justify-start'}`}
                            aria-pressed={config.restartInForegroundTerminal}
                            aria-label="自動重啟改用前台 Terminal"
                            title="自動重啟改用前台 Terminal"
                          >
                            <span className="mx-1 h-5 w-5 rounded-full bg-white shadow-sm" />
                          </button>
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">授權管理</div>
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 p-5 space-y-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">已授權清單（雙層可驗證）</h3>
                              <p className="mt-1 text-sm text-slate-500">同時顯示 openclaw.json 與 agents/*/agent/auth-profiles.json 的一致性。</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => void loadAuthProfiles()}
                              disabled={authProfilesLoading}
                              className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800"
                            >
                              <RefreshCw size={14} className={`mr-2 ${authProfilesLoading ? 'animate-spin' : ''}`} />
                              刷新
                            </button>
                          </div>

                          {authProfilesError && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                              {authProfilesError}
                            </div>
                          )}

                          {authProfileSummary && (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-200">
                              授權健康總覽：total {authProfileSummary.total} / healthy {authProfileSummary.healthy} / warn {authProfileSummary.warn} / critical {authProfileSummary.critical}
                            </div>
                          )}

                          {authProfilesLoading && authProfiles.length === 0 ? (
                            <div className="flex items-center rounded-2xl border border-slate-200 bg-white/80 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                              <Loader2 size={16} className="mr-2 animate-spin" />
                              載入授權清單中...
                            </div>
                          ) : authProfiles.length === 0 ? (
                            <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300">
                              尚未偵測到任何授權 profile。
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {authProfiles.map((row) => {
                                const healthy = row.globalPresent && row.agentPresent && row.credentialHealthy;
                                return (
                                  <div key={row.profileId} className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <span className="font-mono text-sm text-slate-800 dark:text-slate-100">{row.profileId}</span>
                                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${healthy ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300' : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'}`}>
                                            <ShieldCheck size={12} className="mr-1" />
                                            {healthy ? '雙層健康' : '需修復'}
                                          </span>
                                        </div>
                                        <div className="text-xs text-slate-600 dark:text-slate-300">
                                          provider: <span className="font-mono">{row.provider || '-'}</span> / mode: <span className="font-mono">{row.mode || '-'}</span>
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                          global: {row.globalPresent ? 'yes' : 'no'} | agent: {row.agentPresent ? `yes (${row.agentCount})` : 'no'} | credential: {row.credentialHealthy ? 'ok' : 'invalid'}
                                        </div>
                                        {Array.isArray(row.diagnostics) && row.diagnostics.length > 0 && (
                                          <div className="text-[11px] text-amber-600 dark:text-amber-300">
                                            diagnostics: {row.diagnostics.join(', ')}
                                          </div>
                                        )}
                                        {Array.isArray(row.repairGuides) && row.repairGuides.length > 0 && (
                                          <div className="mt-1 text-[11px] text-sky-600 dark:text-sky-300">
                                            修復建議：{row.repairGuides.join('；')}
                                          </div>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => void handleRemoveAuthProfile(row.profileId)}
                                        disabled={authRemovingId === row.profileId}
                                        className="inline-flex items-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-rose-700 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-300"
                                      >
                                        {authRemovingId === row.profileId ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Trash2 size={14} className="mr-2" />}
                                        取消授權
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-950/50 p-4 space-y-4">
                            <div className="text-[11px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-[0.2em]">新增授權（增量）</div>

                            {/* Step 1: 選擇供應商 */}
                            <div className="space-y-2">
                              <div className="text-[9px] font-black text-slate-400 uppercase tracking-[0.25em] flex items-center gap-1">
                                <span className="w-3.5 h-3.5 bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 rounded-full inline-flex items-center justify-center text-[8px] font-black">1</span>
                                選擇供應商
                              </div>
                              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5">
                                {SETTINGS_PROVIDER_GROUPS.map(group => (
                                  <button
                                    key={group.id}
                                    type="button"
                                    onClick={() => {
                                      setAuthAddProvider(group.id);
                                      setAuthAddChoice(group.choices[0].id);
                                      setAuthAddSecret('');
                                      setAuthAddError('');
                                    }}
                                    className={`p-2 rounded-xl border-2 text-left transition-all flex flex-col gap-1 ${
                                      authAddProvider === group.id
                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10 dark:border-blue-400 shadow-sm'
                                        : 'border-slate-200 bg-white hover:border-blue-200 dark:border-slate-700 dark:bg-slate-900/40 dark:hover:border-blue-500/40'
                                    }`}
                                  >
                                    <div className={`w-5 h-5 rounded-lg flex items-center justify-center ${
                                      authAddProvider === group.id
                                        ? 'bg-blue-600 text-white'
                                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                    }`}>
                                      {group.icon}
                                    </div>
                                    <span className={`text-[10px] font-black leading-tight ${
                                      authAddProvider === group.id
                                        ? 'text-blue-900 dark:text-blue-300'
                                        : 'text-slate-700 dark:text-slate-300'
                                    }`}>{group.label}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Step 2: 選擇授權模式（多 choice 才顯示） */}
                            {(() => {
                              const group = SETTINGS_PROVIDER_GROUPS.find(g => g.id === authAddProvider);
                              if (!group || group.choices.length <= 1) return null;
                              return (
                                <div className="space-y-2">
                                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-[0.25em] flex items-center gap-1">
                                    <span className="w-3.5 h-3.5 bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 rounded-full inline-flex items-center justify-center text-[8px] font-black">2</span>
                                    授權模式
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {group.choices.map(choice => (
                                      <div
                                        key={choice.id}
                                        onClick={() => { setAuthAddChoice(choice.id); setAuthAddSecret(''); setAuthAddError(''); }}
                                        className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${
                                          authAddChoice === choice.id
                                            ? 'border-blue-500 bg-white dark:bg-slate-900 shadow-sm scale-[1.01]'
                                            : 'border-transparent bg-white dark:bg-slate-900/50 hover:border-blue-200 dark:hover:border-blue-500/30'
                                        }`}
                                      >
                                        <div className="flex justify-between items-start mb-0.5">
                                          <span className="font-black text-[11px] text-slate-800 dark:text-slate-100">{choice.name}</span>
                                          {choice.oauthFlow && <span className="text-[7px] bg-emerald-500 text-white px-1.5 py-0.5 rounded font-black tracking-widest">OAUTH</span>}
                                          {!choice.reqKey && !choice.oauthFlow && <span className="text-[7px] bg-slate-400 text-white px-1.5 py-0.5 rounded font-black tracking-widest">LOCAL</span>}
                                        </div>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">{choice.desc}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}

                            {/* API Key 輸入（reqKey 時顯示） */}
                            {(() => {
                              const group = SETTINGS_PROVIDER_GROUPS.find(g => g.id === authAddProvider);
                              const choice = group?.choices.find(c => c.id === authAddChoice);
                              if (!choice?.reqKey) return null;
                              return (
                                <div className="space-y-3">
                                  <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                      <Key size={14} />
                                    </div>
                                    <input
                                      type="password"
                                      value={authAddSecret}
                                      onChange={(e) => setAuthAddSecret(e.target.value)}
                                      placeholder="輸入 API Key / Token"
                                      className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                                    />
                                  </div>
                                  {choice.id === 'token' && (
                                    <>
                                      <div className="p-3 bg-blue-50/50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/30 rounded-xl flex items-start gap-2.5">
                                        <div className="mt-0.5 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                                          <span className="text-[10px] text-white font-bold">i</span>
                                        </div>
                                        <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300 leading-relaxed">
                                          可在下方直接執行「claude setup-token」來獲取授權 Token，完成後將產生的 Token 貼到上方輸入框。
                                        </p>
                                      </div>
                                      <div className="p-3 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
                                        <label className="text-[9px] font-black text-slate-500 uppercase tracking-[0.25em] block">CLI 指令（直接取得 Token）</label>
                                        <div className="flex flex-col sm:flex-row gap-2">
                                          <input
                                            type="text"
                                            value={authAddTokenCommand}
                                            onChange={(e) => setAuthAddTokenCommand(e.target.value)}
                                            placeholder="claude setup-token"
                                            className="flex-1 px-3 py-2.5 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono outline-none focus:border-blue-500/50 transition-colors"
                                          />
                                          <button
                                            type="button"
                                            onClick={() => void handleRunAuthTokenCommand()}
                                            disabled={authAddTokenRunning}
                                            className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-900 dark:bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                                          >
                                            {authAddTokenRunning ? (
                                              <><Loader2 size={12} className="animate-spin" /> 執行中</>
                                            ) : '執行指令'}
                                          </button>
                                        </div>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400">執行後請在彈出的終端機完成授權，取得 Token 後貼到上方密鑰欄位。</p>
                                        {authAddTokenError && (
                                          <p className="text-[10px] text-rose-600 dark:text-rose-400 font-medium">{authAddTokenError}</p>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })()}

                            {/* 無憑證提示 */}
                            {(() => {
                              const group = SETTINGS_PROVIDER_GROUPS.find(g => g.id === authAddProvider);
                              const choice = group?.choices.find(c => c.id === authAddChoice);
                              if (choice?.reqKey) return null;
                              if (choice?.oauthFlow) return (
                                <p className="text-[11px] font-black text-emerald-600 dark:text-emerald-400">
                                  ✓ OAuth 模式：點擊「新增授權」將開啟終端機執行授權流程
                                </p>
                              );
                              return (
                                <p className="text-[11px] font-black text-emerald-600 dark:text-emerald-400">
                                  ✓ 本地模式無須憑證，直接新增即可
                                </p>
                              );
                            })()}

                            {authAddError && (
                              <div className="text-sm text-rose-600 dark:text-rose-300">{authAddError}</div>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleAddAuthProfile()}
                              disabled={authAdding}
                              className="inline-flex items-center rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-blue-700 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-blue-300"
                            >
                              {authAdding ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Plus size={14} className="mr-2" />}
                              新增授權
                            </button>
                          </div>
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

                      <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">Telegram Pairing</div>
                        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 p-5 space-y-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{t('monitor.telegramPairing.title')}</h3>
                              <p className="mt-1 text-sm text-slate-500">{t('monitor.telegramPairing.desc')}</p>
                              <div className="mt-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                {t('monitor.telegramPairing.pendingCount', { count: telegramPairingRequests.length })}
                              </div>
                            </div>
                            <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
                              <button
                                type="button"
                                onClick={() => void loadTelegramPairingRequests()}
                                disabled={telegramPairingLoading}
                                className="inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-black uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <RefreshCw size={14} className={`mr-2 ${telegramPairingLoading ? 'animate-spin' : ''}`} />
                                {t('monitor.telegramPairing.refresh')}
                              </button>
                              <button
                                type="button"
                                onClick={() => void clearTelegramPairingRequests()}
                                disabled={telegramPairingClearing || telegramPairingRequests.length === 0}
                                className="inline-flex items-center rounded-xl border border-rose-300 bg-rose-50 px-4 py-2 text-xs font-black uppercase tracking-wider text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
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
                                          className="inline-flex items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-300"
                                        >
                                          {telegramPairingApprovingCode === request.code ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
                                          {telegramPairingApprovingCode === request.code ? t('monitor.telegramPairing.approving') : t('monitor.telegramPairing.approve')}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void rejectTelegramPairing(request)}
                                          disabled={telegramPairingRejectingCode === request.code || telegramPairingApprovingCode === request.code}
                                          className="inline-flex items-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-black uppercase tracking-wider text-rose-700 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-rose-300"
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
      <ChatWidget />
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