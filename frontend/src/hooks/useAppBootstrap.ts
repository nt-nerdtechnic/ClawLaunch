import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store';

interface UseAppBootstrapParams {
  setOnboardingFinished: (finished: boolean) => void;
  setActiveTab: (tab: string) => void;
  syncGatewayStatus: (runtimeConfig?: any) => Promise<void>;
}

const ONBOARDING_FINISHED_KEY = 'onboarding_finished';
const ONBOARDING_FORCE_RESET_KEY = 'onboarding_force_reset';

export function useAppBootstrap({
  setOnboardingFinished,
  setActiveTab,
  syncGatewayStatus,
}: UseAppBootstrapParams) {
  const initPromiseRef = useRef<Promise<void> | null>(null);

  const checkOnboardingStatus = useCallback((loadedConfig?: any, detected?: any) => {
    const persisted = loadedConfig || {};
    const detectedTop = detected || {};
    const detectedExisting = detected?.existingConfig || {};
    const hasAnyConfiguredPath = Boolean(
      (persisted.corePath && String(persisted.corePath).trim()) ||
      (persisted.configPath && String(persisted.configPath).trim()) ||
      (persisted.workspacePath && String(persisted.workspacePath).trim()) ||
      (detectedTop.corePath && String(detectedTop.corePath).trim()) ||
      (detectedTop.configPath && String(detectedTop.configPath).trim()) ||
      (detectedTop.workspacePath && String(detectedTop.workspacePath).trim()) ||
      (detectedExisting.corePath && String(detectedExisting.corePath).trim()) ||
      (detectedExisting.configPath && String(detectedExisting.configPath).trim()) ||
      (detectedExisting.workspacePath && String(detectedExisting.workspacePath).trim()),
    );

    const forceReset = localStorage.getItem(ONBOARDING_FORCE_RESET_KEY) === 'true';
    const finished = !forceReset && (localStorage.getItem(ONBOARDING_FINISHED_KEY) === 'true' || hasAnyConfiguredPath);
    if (finished) {
      localStorage.setItem(ONBOARDING_FINISHED_KEY, 'true');
      localStorage.removeItem(ONBOARDING_FORCE_RESET_KEY);
    }
    setOnboardingFinished(finished);
    setActiveTab(finished ? 'monitor' : 'onboarding');
  }, [setActiveTab, setOnboardingFinished]);

  const loadConfig = useCallback(async () => {
    if (!window.electronAPI) return null;

    try {
      const res = await window.electronAPI.exec('config:read');
      if (res.code === 0 && res.stdout) {
        let savedConfig: any = {};
        try {
          savedConfig = JSON.parse(res.stdout);
        } catch {
          console.error('Config JSON parse failed', res.stdout);
        }
        const { setConfig } = useStore.getState();
        setConfig(savedConfig);
        return savedConfig;
      }
    } catch (e) {
      console.error('Failed to load config', e);
    }

    return null;
  }, []);

  const detectPaths = useCallback(async () => {
    const { setDetectingPaths, setDetectedConfig, setCoreSkills, setWorkspaceSkills } = useStore.getState();
    setDetectingPaths(true);
    let detectedResult: any = null;

    if (window.electronAPI) {
      try {
        const res = await window.electronAPI.exec('detect:paths');
        if (res.code === 0 && res.stdout) {
          let detected: any = { coreSkills: [], existingConfig: null };
          try {
            detected = JSON.parse(res.stdout);
          } catch {
            console.warn('Detected paths but result was not valid JSON', res.stdout);
          }
          detectedResult = detected;

          if (detected && detected.existingConfig) {
            setDetectedConfig({
              ...detected.existingConfig,
              corePath: detected.corePath || detected.existingConfig.corePath || '',
              configPath: detected.configPath || detected.existingConfig.configPath || '',
              workspacePath:
                detected.workspacePath ||
                detected.existingConfig.workspacePath ||
                detected.existingConfig.workspace ||
                detected.configPath ||
                detected.existingConfig.configPath ||
                '',
            });
          }

          if (detected.coreSkills) setCoreSkills(detected.coreSkills);
          if (detected.existingConfig?.workspaceSkills) setWorkspaceSkills(detected.existingConfig.workspaceSkills);
        }
      } catch (e) {
        console.error('Auto detection failed', e);
      }
    }

    setDetectingPaths(false);
    return detectedResult;
  }, []);

  const checkEnvironment = useCallback(async () => {
    const { setEnvStatus } = useStore.getState();
    const check = async (cmd: string) => {
      try {
        const res = await window.electronAPI.exec(cmd);
        return res.exitCode === 0 || res.code === 0 ? 'ok' : 'error';
      } catch {
        return 'error';
      }
    };

    const node = await check('node -v');
    const git = await check('git --version');
    const pnpm = await check('pnpm -v');
    setEnvStatus({ node, git, pnpm });
  }, []);

  const initializeApp = useCallback(async () => {
    const loadedConfig = await loadConfig();
    checkOnboardingStatus(loadedConfig);

    const [detected] = await Promise.all([
      detectPaths(),
      checkEnvironment(),
      syncGatewayStatus(loadedConfig),
    ]);

    checkOnboardingStatus(loadedConfig, detected);
  }, [checkEnvironment, checkOnboardingStatus, detectPaths, loadConfig, syncGatewayStatus]);

  useEffect(() => {
    if (!initPromiseRef.current) {
      initPromiseRef.current = initializeApp();
    }
  }, [initializeApp]);

  const handleOnboardingComplete = useCallback(() => {
    localStorage.setItem(ONBOARDING_FINISHED_KEY, 'true');
    localStorage.removeItem(ONBOARDING_FORCE_RESET_KEY);
    setOnboardingFinished(true);
    setActiveTab('monitor');
  }, [setActiveTab, setOnboardingFinished]);

  return {
    handleOnboardingComplete,
  };
}
