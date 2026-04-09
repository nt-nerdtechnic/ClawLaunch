import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import type { Config } from '../store';
import { ConfigService } from '../services/configService';
import { useRuntimeConfig } from './useRuntimeConfig';
import { useAuthProfiles } from './useAuthProfiles';
import { useGatewayControl } from './useGatewayControl';
import { useGatewayActions } from './useGatewayActions';
import { useSnapshotSync } from './useSnapshotSync';
import { useRuntimeUsageSync } from './useRuntimeUsageSync';
import { useAppBootstrap } from './useAppBootstrap';
import { useAppInteractionHandlers } from './useAppInteractionHandlers';
import { useAppLifecycleEffects } from './useAppLifecycleEffects';

export function useAppOrchestrator() {
  const ONBOARDING_FINISHED_KEY = 'onboarding_finished';
  const ONBOARDING_FORCE_RESET_KEY = 'onboarding_force_reset';

  const {
    running,
    setRunning,
    logs,
    addLog,
    envStatus,
    config,
    setConfig,
    setDetectedConfig,
    detectedConfig,
    snapshot,
    auditTimeline,
    dailyDigest,
    setSnapshot,
    setSnapshotHistory,
    setEventQueue,
    setAckedEvents,
    setAuditTimeline,
    setDailyDigest,
    setRawSnapshot,
    setSnapshotSourcePath,
    theme,
    language,
  } = useStore();

  const [viewMode, setViewMode] = useState<'mini' | 'expanded'>('expanded');

  // Restore mini/expanded state after renderer reload (e.g. Cmd+R)
  useEffect(() => {
    window.electronAPI?.getWindowMode?.().then((mode) => {
      setViewMode(mode);
    });
  }, []);
  const [activeTab, setActiveTab] = useState('monitor');
  const [onboardingFinished, setOnboardingFinished] = useState(() => {
    const forceReset = localStorage.getItem(ONBOARDING_FORCE_RESET_KEY) === 'true';
    return !forceReset && localStorage.getItem(ONBOARDING_FINISHED_KEY) === 'true';
  });
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [workspaceBannerDismissed, setWorkspaceBannerDismissed] = useState(
    () => sessionStorage.getItem('workspace_banner_dismissed') === '1'
  );

  const { t, i18n } = useTranslation();
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

  const {
    runtimeProfile,
    runtimeProfileError,
    runtimeDraftModel,
    setRuntimeDraftModel,
    runtimeDraftBotToken,
    setRuntimeDraftBotToken,
    runtimeDraftGatewayPort,
    setRuntimeDraftGatewayPort,
    runtimeDraftCronMaxConcurrentRuns,
    setRuntimeDraftCronMaxConcurrentRuns,
    dynamicModelOptions,
    dynamicModelLoading,
    loadDynamicModelOptions,
  } = useRuntimeConfig(resolvedConfigDir, activeTab, detectedConfig, config.corePath, config.workspacePath);

  useAuthProfiles(resolvedConfigDir, activeTab);
  const buildOpenClawEnvPrefix = (cfg?: Partial<Config>) =>
    ConfigService.buildOpenClawEnvPrefix(cfg?.configPath ?? config.configPath);
  const buildGatewayProfileArg = (cfg?: Partial<Config>) =>
    ConfigService.buildGatewayProfileArg(cfg?.configPath ?? config.configPath);

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

  useRuntimeUsageSync();

  const {
    toggleGateway,
    stopGateway,
    syncGatewayStatus,
    handleKillGatewayPortHolder,
    restartGateway,
  } = useGatewayActions({
    config,
    runtimeProfile,
    running,
    setRunning,
    shellQuote,
    buildOpenClawEnvPrefix,
    buildGatewayProfileArg,
    addLog,
    t,
    gatewayConflictModal,
    setGatewayConflictModal,
    setKillingGatewayPortHolder,
    setGatewayConflictActionMessage,
    closeGatewayConflictModal,
  });

  useAppLifecycleEffects({
    addLog,
    config,
    theme,
    language,
    i18n,
    runtimeProfile,
    syncGatewayStatus,
  });

  const {
    toggleViewMode,
    handleToggleGatewayWithStopModal,
    handleConfirmStopService,
    handleResetOnboarding,
    dismissWorkspaceBanner,
  } = useAppInteractionHandlers({
    viewMode,
    setViewMode,
    running,
    config,
    setConfig,
    setDetectedConfig,
    setOnboardingFinished,
    setActiveTab,
    setShowLogoutConfirm,
    setWorkspaceBannerDismissed,
    addLog,
    t,
    toggleGateway,
    stopGateway,
    setStopServiceActionMessage,
    setStopServiceModalOpen,
    setStoppingServiceWithCleanup,
    closeStopServiceModal,
  });

  const { bootstrapping, handleOnboardingComplete } = useAppBootstrap({
    setOnboardingFinished,
    setActiveTab,
    syncGatewayStatus,
  });

  return {
    running,
    logs,
    envStatus,
    config,
    setConfig,
    snapshot,
    auditTimeline,
    dailyDigest,
    viewMode,
    activeTab,
    setActiveTab,
    onboardingFinished,
    showLogoutConfirm,
    setShowLogoutConfirm,
    workspaceBannerDismissed,
    gatewayConflictModal,
    killingGatewayPortHolder,
    gatewayConflictActionMessage,
    closeGatewayConflictModal,
    stopServiceModalOpen,
    stoppingServiceWithCleanup,
    stopServiceActionMessage,
    closeStopServiceModal,
    resolvedConfigDir,
    runtimeProfileError,
    runtimeDraftModel,
    setRuntimeDraftModel,
    runtimeDraftBotToken,
    setRuntimeDraftBotToken,
    runtimeDraftGatewayPort,
    setRuntimeDraftGatewayPort,
    runtimeDraftCronMaxConcurrentRuns,
    setRuntimeDraftCronMaxConcurrentRuns,
    dynamicModelOptions,
    dynamicModelLoading,
    syncSnapshot,
    loadDynamicModelOptions,
    handleKillGatewayPortHolder,
    restartGateway,
    toggleViewMode,
    handleToggleGatewayWithStopModal,
    handleConfirmStopService,
    handleResetOnboarding,
    dismissWorkspaceBanner,
    bootstrapping,
    handleOnboardingComplete,
    t,
  };
}
