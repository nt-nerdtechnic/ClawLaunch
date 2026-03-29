import { useState, useEffect, useRef } from 'react';
import { MiniView } from './components/MiniView';
import { ChatWidget } from './components/chat/ChatWidget';
import PixelOfficeWidget from './components/pixel-office/PixelOfficeWidget';
import { useTranslation } from 'react-i18next';
import SetupWizard from './components/onboarding/SetupWizard';
import { useStore } from './store';
import type { Config } from './store';
import { ConfigService, ModelService } from './services/configService';
import { PROVIDER_ALIAS_MAP, PROVIDER_MODEL_CATALOGUE } from './constants/providers';
import { useRuntimeConfig } from './hooks/useRuntimeConfig';
import { useAuthProfiles } from './hooks/useAuthProfiles';
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
import { MemoryPage } from './pages/MemoryPage';
import { ViewErrorBoundary } from './components/common/ViewErrorBoundary';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { AppContentArea } from './components/layout/AppContentArea';
import { UnsupportedDesktopNotice } from './components/layout/UnsupportedDesktopNotice';
import { BootstrappingScreen } from './components/layout/BootstrappingScreen';
import { LogoutConfirmDialog } from './components/dialogs/LogoutConfirmDialog';
import { GatewayConflictDialog } from './components/dialogs/GatewayConflictDialog';
import { StopServiceDialog } from './components/dialogs/StopServiceDialog';

type ModelOptionGroup = {
  provider: string;
  group: string;
  models: string[];
};

function App() {
  const ONBOARDING_FINISHED_KEY = 'onboarding_finished';
  const ONBOARDING_FORCE_RESET_KEY = 'onboarding_force_reset';

  const { running, setRunning, logs, addLog, envStatus, config, setConfig, setDetectedConfig, detectedConfig, snapshot, auditTimeline, dailyDigest, setSnapshot, setSnapshotHistory, setEventQueue, setAckedEvents, setAuditTimeline, setDailyDigest, setRawSnapshot, setSnapshotSourcePath, theme, language } = useStore();
  const [viewMode, setViewMode] = useState<'mini' | 'expanded'>('expanded');
  const [activeTab, setActiveTab] = useState('monitor'); // Default to monitor if onboarding finished
  const [onboardingFinished, setOnboardingFinished] = useState(
    () => {
      const forceReset = localStorage.getItem(ONBOARDING_FORCE_RESET_KEY) === 'true';
      return !forceReset && localStorage.getItem(ONBOARDING_FINISHED_KEY) === 'true';
    }
  );
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [workspaceBannerDismissed, setWorkspaceBannerDismissed] = useState(
    () => sessionStorage.getItem('workspace_banner_dismissed') === '1'
  );
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
  const effectiveRuntimeGatewayPort = String((runtimeProfile?.gateway as Record<string, unknown> | null | undefined)?.port ?? '').trim();
  const { authProfiles } = useAuthProfiles(resolvedConfigDir, activeTab);

  const getProviderDisplayLabel = (providerRef: string, fallbackLabel?: string) => {
    const normalized = String(providerRef || '').trim().toLowerCase();
    return PROVIDER_MODEL_CATALOGUE[normalized]?.label || fallbackLabel || providerRef || 'Unknown';
  };

  const runtimeProviders: string[] = (runtimeProfile?.providers as string[] | undefined) ?? [];


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
  const authorizedProvidersKey = effectiveAuthorizedProviders.join('|');
  const selectedModelProvider = ModelService.inferProviderFromModel(runtimeDraftModel);
  const selectedModelAuthorized = !runtimeDraftModel.trim() || isModelAuthorizedByProvider(runtimeDraftModel);
  const authorizedProviderBadges = Array.from(new Set(
    (healthyAuthProviders.length > 0 ? healthyAuthProviders : runtimeProviders.map((provider) => String(provider || '').toLowerCase()).filter(Boolean))
  ));

  const buildOpenClawEnvPrefix = (cfg?: Partial<Config>) =>
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
        addLog(payload.data, payload.source);
      });
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [addLog]);

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

  // JSONL calculation — directly scan ~/.openclaw/agents/*/sessions/*.jsonl
  useRuntimeUsageSync();

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    // Only sync to config.json when config paths have been loaded.
    // Guards against overwriting valid persisted paths with default empty state
    // before loadConfig() has completed its async IPC call on startup.
    const hasLoadedConfig = Boolean(config.corePath || config.configPath || config.workspacePath);
    if (window.electronAPI && hasLoadedConfig) {
      const { model: _m, botToken: _b, authChoice: _a, apiKey: _k, platform: _p, appToken: _at, ...launcherPayload } = config;
      const updated = { ...launcherPayload, theme, language };
      window.electronAPI.exec(`config:write ${JSON.stringify(updated)}`).catch(() => {});
    }
  }, [theme, language, config]);

  const { i18n } = useTranslation();
  useEffect(() => {
    if (language && i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  useEffect(() => {
    if (!window.electronAPI?.setTitle) return;
    const cp = String(config.configPath || '').trim();
    const versionStr = config.appVersion ? `v${config.appVersion}` : '';
    const title = cp 
      ? `OpenClaw ${versionStr} — ${cp}` 
      : `OpenClaw ${versionStr}`;
    void window.electronAPI.setTitle(title.trim());
  }, [config.configPath, config.appVersion]);

  useEffect(() => {
    if (activeTab !== 'runtimeSettings') return;
    const providers = authorizedProvidersKey ? authorizedProvidersKey.split('|').filter(Boolean) : [];
    void loadDynamicModelOptions(config.corePath, providers);
  }, [activeTab, config.corePath, authorizedProvidersKey, loadDynamicModelOptions]);

  function isModelAuthorizedByProvider(modelRef: string) {
    return ModelService.isModelAuthorizedByProvider(modelRef, effectiveAuthorizedProviders, PROVIDER_ALIAS_MAP);
  }

  const {
    handleSaveLauncherConfig,
    handleSaveConfig,
    launcherSaveState,
    runtimeSaveState,
    handleOpenClawDoctor,
    handleSecurityCheck,
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
    shellQuote,
    buildOpenClawEnvPrefix,
    isModelAuthorizedByProvider,
    setRuntimeProfile,
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

  // 當 runtimeProfile 首次成功載入後，立即觸發一次 Gateway 狀態偵測。
  // 修復啟動時序問題：App bootstrap 呼叫 syncGatewayStatus 時 runtimeProfile 尚為 null，
  // 導致 getGatewayPort() 無法取得 port 而跳過偵測，狀態永遠顯示 STANDBY。
  const prevRuntimeProfileRef = useRef<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => {
    const wasNull = prevRuntimeProfileRef.current === undefined || prevRuntimeProfileRef.current === null;
    const isNowLoaded = runtimeProfile !== null && runtimeProfile !== undefined;
    
    // 初始載入時立即偵測一次
    if (wasNull && isNowLoaded) {
      syncGatewayStatus(runtimeProfile);
    }
    prevRuntimeProfileRef.current = runtimeProfile;

    // 設定定時輪詢（每 10 秒），確保狀態持續同步
    // 即使服務是在外部啟動或因故停止，Dashboard 也能自動更新
    const interval = setInterval(() => {
      syncGatewayStatus();
    }, 10000);

    return () => clearInterval(interval);
  }, [runtimeProfile, syncGatewayStatus]);

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
    setStopServiceActionMessage(t('app.stopService.stopping'));
    try {
      await stopGateway({ killTerminalAndPortHolders: true });
      setStopServiceActionMessage(t('app.stopService.stopped'));
      window.setTimeout(() => {
        closeStopServiceModal();
      }, 350);
    } catch (e: unknown) {
      setStopServiceActionMessage(t('app.stopService.failed', { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setStoppingServiceWithCleanup(false);
    }
  };
  const { bootstrapping, handleOnboardingComplete } = useAppBootstrap({
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
    setConfig({ [key]: selectedPath } as Partial<Config>);
  };

  const handleResetOnboarding = async () => {
    // Try to stop Gateway before logging out to avoid zombie processes occupying the port
    if (running && config.corePath && window.electronAPI) {
      const hasConfigIsolation = !!config.configPath?.trim();
      if (!hasConfigIsolation) {
        addLog(t('logs.noConfigPathReset'), 'stderr');
      } else {
        await stopGateway({ killTerminalAndPortHolders: true });
      }
    }
    localStorage.removeItem(ONBOARDING_FINISHED_KEY);
    localStorage.setItem(ONBOARDING_FORCE_RESET_KEY, 'true');
    // Clear all path-related config and detected paths from the store
    setConfig({ corePath: '', configPath: '', workspacePath: '' });
    setDetectedConfig(null);
    setOnboardingFinished(false);
    setActiveTab('onboarding');
    setShowLogoutConfirm(false);
    // Delete clawlaunch.json so the app starts completely fresh on next launch
    if (window.electronAPI) {
      window.electronAPI.exec('config:reset').catch(() => {});
    }
  };

  if (viewMode === 'mini') {
    return (
      <>
        <MiniView running={running} onToggle={handleToggleGatewayWithStopModal} onExpand={toggleViewMode} />
        <PixelOfficeWidget compact />
        <ChatWidget compact />
      </>
    );
  }

  if (!window.electronAPI) {
    return <UnsupportedDesktopNotice />;
  }

  // If not finished onboarding, show the wizard
  if (bootstrapping) {
    return <BootstrappingScreen />;
  }

  if (!onboardingFinished) {
    return <SetupWizard onFinished={handleOnboardingComplete} />;
  }

  return (
    <div className="flex h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden animate-in fade-in duration-700">
      <Sidebar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        onToggleViewMode={toggleViewMode}
        appVersion={config.appVersion}
        t={t}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#020617] relative">
        <Header
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          onShowLogoutConfirm={() => setShowLogoutConfirm(true)}
          t={t}
        />

        <LogoutConfirmDialog
          open={showLogoutConfirm}
          onClose={() => setShowLogoutConfirm(false)}
          onConfirm={handleResetOnboarding}
          t={t}
        />

        <GatewayConflictDialog
          gatewayConflictModal={gatewayConflictModal}
          gatewayConflictActionMessage={gatewayConflictActionMessage}
          killingGatewayPortHolder={killingGatewayPortHolder}
          onClose={closeGatewayConflictModal}
          onGoToSettings={() => setActiveTab('launcherSettings')}
          onForceClose={handleKillGatewayPortHolder}
          t={t}
        />

        <StopServiceDialog
          open={stopServiceModalOpen}
          stopServiceActionMessage={stopServiceActionMessage}
          stoppingServiceWithCleanup={stoppingServiceWithCleanup}
          onClose={closeStopServiceModal}
          onConfirm={handleConfirmStopService}
          t={t}
        />

        <AppContentArea
          activeTab={activeTab}
          onboardingFinished={onboardingFinished}
          workspaceBannerDismissed={workspaceBannerDismissed}
          corePath={config.corePath}
          configPath={config.configPath}
          workspacePath={config.workspacePath}
          runtimeProfileError={runtimeProfileError}
          onOpenSettings={() => setActiveTab('launcherSettings')}
          onRelogout={() => setShowLogoutConfirm(true)}
          onDismissWorkspaceBanner={() => {
            sessionStorage.setItem('workspace_banner_dismissed', '1');
            setWorkspaceBannerDismissed(true);
          }}
          t={t}
          controlCenterContent={<ControlCenterPage onRefreshSnapshot={syncSnapshot} stateDir={resolvedConfigDir || undefined} />}
          skillsContent={<SkillsPage />}
          memoryContent={<MemoryPage config={config} />}
          analyticsContent={(
            <ViewErrorBoundary
              title={t('app.headers.analytics')}
              message={t('logs.commFailed', { msg: 'Analytics view crashed. Please switch tabs and try again.' })}
            >
              <AnalyticsPage />
            </ViewErrorBoundary>
          )}
          monitorContent={(
            <MonitorPage
              running={running}
              onToggleGateway={handleToggleGatewayWithStopModal}
              onNavigate={(p: string) => setActiveTab(p)}
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
          launcherSettingsContent={(
            <LauncherSettingsPage
              config={config}
              setConfig={setConfig}
              onSave={handleSaveLauncherConfig}
              saveState={launcherSaveState}
              onAddLog={addLog}
              onBrowsePath={handleBrowsePath}
            />
          )}
          runtimeSettingsContent={(
            <RuntimeSettingsPage
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
              onHandleOpenClawDoctor={handleOpenClawDoctor}
              onHandleSecurityCheck={handleSecurityCheck}
              runtimeProfileError={runtimeProfileError}
              onSaveChannelToken={handleSaveChannelToken}
              onSave={handleSaveConfig}
              saveState={runtimeSaveState}
            />
          )}
        />
      </main>
      <PixelOfficeWidget />
      <ChatWidget />
    </div>
  );
}


export default App;