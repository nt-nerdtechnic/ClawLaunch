import { useState, useEffect, Component, type ErrorInfo, type ReactNode } from 'react';
import { Layout, Settings, Activity, Boxes, MonitorPlay, BarChart3, LogOut, AlertCircle, X, Brain, Cpu, Globe, Zap, Network, Database, Radar } from 'lucide-react';
import { MiniView } from './components/MiniView';
import { ThemeToggle } from './components/ThemeToggle';
import { LanguageToggle } from './components/LanguageToggle';
import { ChatWidget } from './components/chat/ChatWidget';
import { useTranslation } from 'react-i18next';
// @ts-ignore
import SetupWizard from './components/onboarding/SetupWizard';
import UpdateBanner from './components/UpdateBanner';
import { useStore } from './store';
import { ConfigService, ModelService } from './services/configService';
import { useRuntimeConfig } from './hooks/useRuntimeConfig';
import { useAuthProfiles } from './hooks/useAuthProfiles';
import { useTelegramPairing } from './hooks/useTelegramPairing';
import { useGatewayControl } from './hooks/useGatewayControl';
import { useGatewayActions } from './hooks/useGatewayActions';
import { useRuntimeActions } from './hooks/useRuntimeActions';
import { useSnapshotSync } from './hooks/useSnapshotSync';
import { useRuntimeUsageSync } from './hooks/useRuntimeUsageSync';
import { useAppBootstrap } from './hooks/useAppBootstrap';
import { LauncherSettingsPage } from './pages/LauncherSettingsPage';
import { RuntimeSettingsPage } from './pages/RuntimeSettingsPage';
import { MonitorPage } from './pages/MonitorPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SkillsPage } from './pages/SkillsPage';
import { ControlCenterPage } from './pages/ControlCenterPage';

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

  const { running, setRunning, logs, addLog, envStatus, config, setConfig, detectedConfig, snapshot, auditTimeline, dailyDigest, setSnapshot, setSnapshotHistory, setEventQueue, setAckedEvents, setAuditTimeline, setDailyDigest, setRawSnapshot, setSnapshotSourcePath } = useStore();
  const [viewMode, setViewMode] = useState<'mini' | 'expanded'>('expanded');
  const [activeTab, setActiveTab] = useState('monitor'); // Default to monitor if onboarding finished
  const [onboardingFinished, setOnboardingFinished] = useState(
    () => {
      const forceReset = localStorage.getItem(ONBOARDING_FORCE_RESET_KEY) === 'true';
      return !forceReset && localStorage.getItem(ONBOARDING_FINISHED_KEY) === 'true';
    }
  );
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const { t } = useTranslation();
  const shellQuote = ConfigService.shellQuote;
  const {
    gatewayConflictModal,
    setGatewayConflictModal,
    killingGatewayPortHolder,
    setKillingGatewayPortHolder,
    gatewayConflictActionMessage,
    setGatewayConflictActionMessage,
    closeGatewayConflictModal,
    stopServiceModalOpen,
    setStopServiceModalOpen,
    stoppingServiceWithCleanup,
    setStoppingServiceWithCleanup,
    stopServiceActionMessage,
    setStopServiceActionMessage,
    closeStopServiceModal,
  } = useGatewayControl();
  const resolvedConfigDir = ConfigService.normalizeConfigDir(config.configPath);
  const resolvedConfigFilePath = resolvedConfigDir ? `${resolvedConfigDir}/openclaw.json` : '';
  const {
    runtimeProfile,
    setRuntimeProfile,
    runtimeProfileError,
    runtimeDraftModel,
    setRuntimeDraftModel,
    runtimeDraftBotToken,
    setRuntimeDraftBotToken,
    runtimeDraftGatewayPort,
    setRuntimeDraftGatewayPort,
    dynamicModelOptions,
    dynamicModelLoading,
    loadDynamicModelOptions,
  } = useRuntimeConfig(resolvedConfigDir, activeTab, detectedConfig, config.corePath, config.workspacePath);
  const effectiveRuntimeModel = String(runtimeProfile?.model || detectedConfig?.model || '').trim();
  const effectiveRuntimeBotToken = String(runtimeProfile?.botToken || detectedConfig?.botToken || '').trim();
  const effectiveRuntimeGatewayPort = String(runtimeProfile?.gateway?.port ?? '').trim();
  const {
    authProfiles,
    authProfileSummary,
    authProfilesLoading,
    authProfilesError,
    authRemovingId,
    setAuthRemovingId,
    authAdding,
    setAuthAdding,
    authAddProvider,
    setAuthAddProvider,
    authAddChoice,
    setAuthAddChoice,
    authAddSecret,
    setAuthAddSecret,
    authAddError,
    setAuthAddError,
    authAddTokenCommand,
    setAuthAddTokenCommand,
    authAddTokenRunning,
    setAuthAddTokenRunning,
    authAddTokenError,
    setAuthAddTokenError,
    loadAuthProfiles,
  } = useAuthProfiles(resolvedConfigDir, activeTab);
  const {
    telegramPairingRequests,
    telegramAuthorizedUsers,
    telegramPairingLoading,
    telegramPairingApprovingCode,
    setTelegramPairingApprovingCode,
    telegramPairingRejectingCode,
    setTelegramPairingRejectingCode,
    telegramPairingClearing,
    setTelegramPairingClearing,
    telegramPairingError,
    setTelegramPairingError,
    loadTelegramPairingRequests,
  } = useTelegramPairing(resolvedConfigDir, activeTab, config, addLog);

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
        { id: 'minimax-coding-plan-global-token', name: 'Coding Plan Token (Global)', desc: '貼上平台 Token，無需 OAuth 瀏覽器流程', reqKey: true },
        { id: 'minimax-coding-plan-cn-token', name: 'Coding Plan Token (CN)', desc: '貼上中國區平台 Token，無需 OAuth 瀏覽器流程', reqKey: true },
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

  const visibleModelOptions: ModelOptionGroup[] = availableModelOptions.filter(({ provider }) =>
    ModelService.providerMatchesFilters(provider, effectiveAuthorizedProviders, PROVIDER_ALIAS_MAP)
  );
  const modelOptionGroups = visibleModelOptions.length > 0 ? visibleModelOptions : availableModelOptions;
  const selectedModelProvider = ModelService.inferProviderFromModel(runtimeDraftModel);
  const selectedModelAuthorized = !runtimeDraftModel.trim() || isModelAuthorizedByProvider(runtimeDraftModel);
  const authorizedProviderBadges = Array.from(new Set(
    (healthyAuthProviders.length > 0 ? healthyAuthProviders : runtimeProviders.map((provider) => String(provider || '').toLowerCase()).filter(Boolean))
  ));

  const buildOpenClawEnvPrefix = (cfg?: any) =>
    ConfigService.buildOpenClawEnvPrefix(cfg?.configPath ?? config.configPath);

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

  const { syncSnapshot } = useSnapshotSync({
    running,
    resolvedConfigDir,
    config,
    setSnapshot,
    setSnapshotHistory,
    setEventQueue,
    setAckedEvents,
    setAuditTimeline,
    setDailyDigest,
    setRawSnapshot,
    setSnapshotSourcePath,
  });

  // JSONL 自算 — 直接掃 ~/.openclaw/agents/*/sessions/*.jsonl
  useRuntimeUsageSync();

  const { theme } = useStore();
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    if (!window.electronAPI?.setTitle) return;
    const cp = String(config.configPath || '').trim();
    void window.electronAPI.setTitle(cp ? `OpenClaw — ${cp}` : 'OpenClaw');
  }, [config.configPath]);

  useEffect(() => {
    if (activeTab !== 'runtimeSettings') return;
    void loadDynamicModelOptions(config.corePath, effectiveAuthorizedProviders);
  }, [activeTab, resolvedConfigDir, config.corePath, effectiveAuthorizedProviders.join('|')]);

  function isModelAuthorizedByProvider(modelRef: string) {
    return ModelService.isModelAuthorizedByProvider(modelRef, effectiveAuthorizedProviders, PROVIDER_ALIAS_MAP);
  }

  const {
    handleSaveLauncherConfig,
    handleSaveConfig,
    launcherSaveState,
    runtimeSaveState,
    handleRemoveAuthProfile,
    handleAddAuthProfile,
    handleRunAuthTokenCommand,
    handleOpenClawDoctor,
    handleSecurityCheck,
    approveTelegramPairing,
    rejectTelegramPairing,
    clearTelegramPairingRequests,
    handleSaveChannelToken,
  } = useRuntimeActions({
    config,
    resolvedConfigDir,
    runtimeDraftModel,
    runtimeDraftBotToken,
    runtimeDraftGatewayPort,
    effectiveRuntimeModel,
    effectiveRuntimeBotToken,
    effectiveRuntimeGatewayPort,
    authAddProvider,
    authAddChoice,
    authAddSecret,
    authAddTokenCommand,
    SETTINGS_PROVIDER_GROUPS,
    shellQuote,
    buildOpenClawEnvPrefix,
    isModelAuthorizedByProvider,
    loadAuthProfiles,
    loadTelegramPairingRequests,
    setRuntimeProfile,
    setAuthRemovingId,
    setAuthAddError,
    setAuthAdding,
    setAuthAddSecret,
    setAuthAddTokenError,
    setAuthAddTokenRunning,
    setTelegramPairingApprovingCode,
    setTelegramPairingRejectingCode,
    setTelegramPairingClearing,
    setTelegramPairingError,
    addLog,
    t,
  });
  const {
    toggleGateway,
    stopGateway,
    syncGatewayStatus,
    handleKillGatewayPortHolder,
  } = useGatewayActions({
    config,
    runtimeProfile,
    running,
    setRunning,
    shellQuote,
    buildOpenClawEnvPrefix,
    addLog,
    t,
    gatewayConflictModal,
    setGatewayConflictModal,
    setKillingGatewayPortHolder,
    setGatewayConflictActionMessage,
    closeGatewayConflictModal,
  });

  const handleToggleGatewayWithStopModal = async () => {
    if (running) {
      setStopServiceActionMessage('');
      setStopServiceModalOpen(true);
      return;
    }
    await toggleGateway();
  };

  const handleConfirmStopService = async () => {
    setStoppingServiceWithCleanup(true);
    setStopServiceActionMessage('正在關閉相關進程與終端機視窗，請稍候...');
    try {
      await stopGateway({ killTerminalAndPortHolders: true });
      setStopServiceActionMessage('已停止服務並完成清理。');
      window.setTimeout(() => {
        closeStopServiceModal();
      }, 350);
    } catch (e: any) {
      setStopServiceActionMessage(`停止服務失敗：${e?.message || e}`);
    } finally {
      setStoppingServiceWithCleanup(false);
    }
  };
  const { handleOnboardingComplete } = useAppBootstrap({
    setOnboardingFinished,
    setActiveTab,
    syncGatewayStatus,
  });

  const toggleViewMode = () => {
    const newMode = viewMode === 'expanded' ? 'mini' : 'expanded';
    setViewMode(newMode);
    window.electronAPI.resize(newMode);
  };

  const handleBrowsePath = async (key: 'corePath' | 'configPath' | 'workspacePath') => {
    if (!window.electronAPI?.selectDirectory) return;
    const selectedPath = await window.electronAPI.selectDirectory();
    if (!selectedPath) return;
    setConfig({ [key]: selectedPath } as any);
  };

  const handleResetOnboarding = async () => {
    // 登出前先嘗試停止 Gateway，避免殭屍進程占用 port
    if (running && config.corePath && window.electronAPI) {
      const hasConfigIsolation = !!config.configPath?.trim();
      if (!hasConfigIsolation) {
        addLog('錯誤: 未設定 Config Path，為避免誤停其他並行服務，本次重設不會主動停止 Gateway。', 'stderr');
      } else {
        await stopGateway({ killTerminalAndPortHolders: true });
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
        <MiniView running={running} onToggle={handleToggleGatewayWithStopModal} onExpand={toggleViewMode} />
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
            <div className="font-bold text-lg leading-none tracking-tight">Openclaw</div>
            <div className="text-[10px] text-blue-500 font-mono uppercase tracking-widest">Launch Pad</div>
          </div>
        </div>
        
        <nav className="flex-1 space-y-1">
          <NavItem icon={<Activity size={18}/>} label={t('app.tabs.monitor')} active={activeTab === 'monitor'} onClick={() => setActiveTab('monitor')} />
          <NavItem icon={<BarChart3 size={18}/>} label={t('app.tabs.analytics')} active={activeTab === 'analytics'} onClick={() => setActiveTab('analytics')} />
          <NavItem icon={<Radar size={18}/>} label={t('app.tabs.controlCenter')} active={activeTab === 'controlCenter'} onClick={() => setActiveTab('controlCenter')} />
          <NavItem icon={<Boxes size={18}/>} label={t('app.tabs.skills')} active={activeTab === 'skills'} onClick={() => setActiveTab('skills')} />
          <NavItem icon={<Database size={18}/>} label={t('app.tabs.runtimeSettings')} active={activeTab === 'runtimeSettings'} onClick={() => setActiveTab('runtimeSettings')} />
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
              {activeTab === 'monitor' ? t('app.headers.monitor') : activeTab === 'controlCenter' ? t('app.headers.controlCenter') : activeTab === 'analytics' ? t('app.headers.analytics') : activeTab === 'skills' ? t('app.headers.skills') : activeTab === 'launcherSettings' ? t('app.headers.launcherSettings') : t('app.headers.runtimeSettings')}
            </h2>
          </div>
          <div className="flex items-center space-x-4">
            <LanguageToggle />
            <ThemeToggle />

            <button
              type="button"
              onClick={() => setActiveTab('launcherSettings')}
              className={`relative w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer transition-colors overflow-hidden ${activeTab === 'launcherSettings' ? 'bg-blue-100 border-blue-300 text-blue-600 hover:bg-blue-200 dark:bg-blue-500/20 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/30' : 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'}`}
              title={t('app.tabs.launcherSettings')}
              aria-label={t('app.tabs.launcherSettings')}
            >
              <Settings size={18} />
            </button>

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
                    onClick={() => setActiveTab('launcherSettings')}
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

        {stopServiceModalOpen && (
          <div className="fixed inset-0 z-[101] flex items-center justify-center p-6 animate-in fade-in duration-300">
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={closeStopServiceModal}></div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-xl rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 slide-in-from-bottom-8 duration-300">
              <div className="p-8 space-y-6">
                <div className="flex justify-between items-start">
                  <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500">
                    <AlertCircle size={24} />
                  </div>
                  <button onClick={closeStopServiceModal} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">停止服務並清理終端機</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                    將先終止相關 Gateway 進程，再關閉已開啟的 Gateway 終端機視窗，最後切回「啟動服務」。
                  </p>
                </div>

                {!!stopServiceActionMessage && (
                  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 p-4 text-sm text-slate-600 dark:text-slate-300">
                    {stopServiceActionMessage}
                  </div>
                )}

                <div className="flex gap-4 pt-2">
                  <button
                    onClick={closeStopServiceModal}
                    disabled={stoppingServiceWithCleanup}
                    className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmStopService}
                    disabled={stoppingServiceWithCleanup}
                    className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {stoppingServiceWithCleanup ? '處理中...' : '停止並清理'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 p-10 overflow-y-auto relative">
          {activeTab !== 'onboarding' && onboardingFinished && <UpdateBanner />}
          {activeTab !== 'onboarding' && onboardingFinished && (() => {
            const missing: string[] = [];
            if (!config.corePath?.trim()) missing.push('Core Path');
            if (!config.configPath?.trim()) missing.push('Config Path');
            if (!config.workspacePath?.trim()) missing.push('Workspace Path');
            const hasPathError = runtimeProfileError && runtimeProfileError.length > 0;
            if (missing.length === 0 && !hasPathError) return null;
            return (
              <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-700/60 dark:bg-amber-950/20">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-black text-amber-800 dark:text-amber-300 uppercase tracking-widest">
                    工作空間設定異常
                  </div>
                  <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                    {missing.length > 0 && (
                      <span>以下路徑尚未設定：<span className="font-bold">{missing.join('、')}</span>。</span>
                    )}
                    {hasPathError && (
                      <span className={missing.length > 0 ? ' ' : ''}>{runtimeProfileError}</span>
                    )}
                    {' '}若路徑已填入仍出現此提示，請重新執行設定或返回引導流程。
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('launcherSettings')}
                    className="rounded-xl border border-amber-400 bg-amber-100 px-3 py-1.5 text-[11px] font-black text-amber-800 hover:bg-amber-200 transition-colors dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
                  >
                    進行設定
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowLogoutConfirm(true)}
                    className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] font-black text-rose-700 hover:bg-rose-100 transition-colors dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50"
                  >
                    重新登出
                  </button>
                </div>
              </div>
            );
          })()}
          {activeTab === 'controlCenter' && <ControlCenterPage onRefreshSnapshot={syncSnapshot} />}
          {activeTab === 'skills' && <SkillsPage />}

          {activeTab === 'analytics' && (
            <ViewErrorBoundary
              title={t('app.headers.analytics')}
              message={t('logs.commFailed', { msg: 'Analytics view crashed. Please switch tabs and try again.' })}
            >
              <AnalyticsPage />
            </ViewErrorBoundary>
          )}

          {activeTab === 'monitor' && (
            <MonitorPage
              running={running}
              onToggleGateway={handleToggleGatewayWithStopModal}
              onOpenRuntimeSettings={() => setActiveTab('runtimeSettings')}
              config={config}
              resolvedConfigDir={resolvedConfigDir}
              snapshot={snapshot}
              envStatus={envStatus}
              logs={logs}
              auditTimeline={auditTimeline}
              dailyDigest={dailyDigest}
              gatewayRuntimeZones={gatewayRuntimeZones}
              onOpenZoneFolder={openZoneFolder}
            />
          )}

          {activeTab === 'launcherSettings' && (
            <LauncherSettingsPage
              config={config}
              setConfig={setConfig}
              onSave={handleSaveLauncherConfig}
              saveState={launcherSaveState}
              onAddLog={addLog}
              onBrowsePath={handleBrowsePath}
            />
          )}

          {activeTab === 'runtimeSettings' && (
            <RuntimeSettingsPage
              config={config}
              setConfig={setConfig}
              runtimeProfile={runtimeProfile}
              runtimeDraftModel={runtimeDraftModel}
              setRuntimeDraftModel={setRuntimeDraftModel}
              runtimeDraftBotToken={runtimeDraftBotToken}
              setRuntimeDraftBotToken={setRuntimeDraftBotToken}
              runtimeDraftGatewayPort={runtimeDraftGatewayPort}
              setRuntimeDraftGatewayPort={setRuntimeDraftGatewayPort}
              dynamicModelOptions={dynamicModelOptions}
              dynamicModelLoading={dynamicModelLoading}
              selectedModelProvider={selectedModelProvider}
              selectedModelAuthorized={selectedModelAuthorized}
              getProviderDisplayLabel={getProviderDisplayLabel}
              authorizedProviderBadges={authorizedProviderBadges}
              modelOptionGroups={modelOptionGroups}
              effectiveAuthorizedProviders={effectiveAuthorizedProviders}
              isModelAuthorizedByProvider={isModelAuthorizedByProvider}
              authProfiles={authProfiles}
              authProfileSummary={authProfileSummary}
              authProfilesLoading={authProfilesLoading}
              authProfilesError={authProfilesError}
              authRemovingId={authRemovingId}
              onHandleRemoveAuthProfile={handleRemoveAuthProfile}
              authAdding={authAdding}
              authAddProvider={authAddProvider}
              setAuthAddProvider={setAuthAddProvider}
              authAddChoice={authAddChoice}
              setAuthAddChoice={setAuthAddChoice}
              authAddSecret={authAddSecret}
              setAuthAddSecret={setAuthAddSecret}
              authAddError={authAddError}
              authAddTokenCommand={authAddTokenCommand}
              setAuthAddTokenCommand={setAuthAddTokenCommand}
              authAddTokenRunning={authAddTokenRunning}
              authAddTokenError={authAddTokenError}
              onHandleAddAuthProfile={handleAddAuthProfile}
              onHandleRunAuthTokenCommand={handleRunAuthTokenCommand}
              onHandleOpenClawDoctor={handleOpenClawDoctor}
              onHandleSecurityCheck={handleSecurityCheck}
              runtimeProfileError={runtimeProfileError}
              telegramPairingRequests={telegramPairingRequests}
              telegramAuthorizedUsers={telegramAuthorizedUsers}
              telegramPairingLoading={telegramPairingLoading}
              telegramPairingApprovingCode={telegramPairingApprovingCode}
              telegramPairingRejectingCode={telegramPairingRejectingCode}
              telegramPairingClearing={telegramPairingClearing}
              telegramPairingError={telegramPairingError}
              onHandleApproveTelegramPairing={approveTelegramPairing}
              onHandleRejectTelegramPairing={rejectTelegramPairing}
              onHandleClearTelegramPairingRequests={clearTelegramPairingRequests}
              onSaveChannelToken={handleSaveChannelToken}
              onSave={handleSaveConfig}
              saveState={runtimeSaveState}
            />
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


export default App;