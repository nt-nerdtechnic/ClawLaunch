import { useCallback } from 'react';
import type { TFunction } from 'i18next';
import type { Config } from '../store';

type UseAppInteractionHandlersParams = {
  viewMode: 'mini' | 'expanded';
  setViewMode: (mode: 'mini' | 'expanded') => void;
  running: boolean;
  config: Config;
  setConfig: (patch: Partial<Config>) => void;
  setDetectedConfig: (value: Record<string, unknown> | null) => void;
  setOnboardingFinished: (value: boolean) => void;
  setActiveTab: (tab: string) => void;
  setShowLogoutConfirm: (open: boolean) => void;
  setWorkspaceBannerDismissed: (value: boolean) => void;
  addLog: (message: string, source?: 'stdout' | 'stderr' | 'system') => void;
  t: TFunction;
  toggleGateway: () => Promise<unknown>;
  stopGateway: (options: { killTerminalAndPortHolders: boolean }) => Promise<unknown>;
  setStopServiceActionMessage: (message: string) => void;
  setStopServiceModalOpen: (open: boolean) => void;
  setStoppingServiceWithCleanup: (value: boolean) => void;
  closeStopServiceModal: () => void;
};

export function useAppInteractionHandlers({
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
}: UseAppInteractionHandlersParams) {
  const toggleViewMode = useCallback(() => {
    const newMode = viewMode === 'expanded' ? 'mini' : 'expanded';
    setViewMode(newMode);
    window.electronAPI.resize(newMode);
  }, [viewMode, setViewMode]);

  const handleToggleGatewayWithStopModal = useCallback(async () => {
    if (running) {
      setStopServiceActionMessage('');
      setStopServiceModalOpen(true);
      return;
    }
    await toggleGateway();
  }, [running, setStopServiceActionMessage, setStopServiceModalOpen, toggleGateway]);

  const handleConfirmStopService = useCallback(async () => {
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
  }, [setStoppingServiceWithCleanup, setStopServiceActionMessage, t, stopGateway, closeStopServiceModal]);

  const handleBrowsePath = useCallback(async (key: 'corePath' | 'configPath' | 'workspacePath') => {
    if (!window.electronAPI?.selectDirectory) return;
    const selectedPath = await window.electronAPI.selectDirectory();
    if (!selectedPath) return;
    setConfig({ [key]: selectedPath } as Partial<Config>);
  }, [setConfig]);

  const handleResetOnboarding = useCallback(async () => {
    const onboardingFinishedKey = 'onboarding_finished';
    const onboardingForceResetKey = 'onboarding_force_reset';

    // Try to stop Gateway before logging out to avoid zombie processes occupying the port
    if (running && config.corePath && window.electronAPI) {
      const hasConfigIsolation = !!config.configPath?.trim();
      if (!hasConfigIsolation) {
        addLog(t('logs.noConfigPathReset'), 'stderr');
      } else {
        await stopGateway({ killTerminalAndPortHolders: true });
      }
    }

    localStorage.removeItem(onboardingFinishedKey);
    localStorage.setItem(onboardingForceResetKey, 'true');

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
  }, [running, config, addLog, t, stopGateway, setConfig, setDetectedConfig, setOnboardingFinished, setActiveTab, setShowLogoutConfirm]);

  const dismissWorkspaceBanner = useCallback(() => {
    sessionStorage.setItem('workspace_banner_dismissed', '1');
    setWorkspaceBannerDismissed(true);
  }, [setWorkspaceBannerDismissed]);

  return {
    toggleViewMode,
    handleToggleGatewayWithStopModal,
    handleConfirmStopService,
    handleBrowsePath,
    handleResetOnboarding,
    dismissWorkspaceBanner,
  };
}
