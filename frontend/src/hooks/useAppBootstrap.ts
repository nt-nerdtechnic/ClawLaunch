import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [bootstrapping, setBootstrapping] = useState(true);

  const checkOnboardingStatus = useCallback((loadedConfig?: any, _detected?: any) => {
    const persisted = loadedConfig || {};
    // Determine onboarding completion based solely on saved config.
    // Detected paths are for wizard pre-filling only; they don't imply the instance is fully configured.
    const hasAnyConfiguredPath = Boolean(
      (persisted.corePath && String(persisted.corePath).trim()) ||
      (persisted.configPath && String(persisted.configPath).trim()) ||
      (persisted.workspacePath && String(persisted.workspacePath).trim()),
    );

    const forceReset = localStorage.getItem(ONBOARDING_FORCE_RESET_KEY) === 'true';
    // Also check the persisted flag in config.json (survives PID-based userData/localStorage wipe on restart)
    const persistedFlag = persisted.onboardingFinished === true;
    const finished = !forceReset && (
      localStorage.getItem(ONBOARDING_FINISHED_KEY) === 'true' ||
      persistedFlag ||
      hasAnyConfiguredPath
    );
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
        const { setConfig, setTheme, setLanguage } = useStore.getState();
        setConfig(savedConfig);
        if (savedConfig?.theme === 'light' || savedConfig?.theme === 'dark') {
          setTheme(savedConfig.theme);
        }
        if (savedConfig?.language) {
          setLanguage(savedConfig.language);
        }
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

    // If all three paths are detected, agent auth is healthy, and the instance has saved config, complete onboarding directly without showing the wizard
    const hasSavedConfig = Boolean(
      loadedConfig && (
        (loadedConfig.corePath && String(loadedConfig.corePath).trim()) ||
        (loadedConfig.configPath && String(loadedConfig.configPath).trim()) ||
        (loadedConfig.workspacePath && String(loadedConfig.workspacePath).trim())
      ),
    );
    const forceReset = localStorage.getItem(ONBOARDING_FORCE_RESET_KEY) === 'true';
    if (!forceReset && !localStorage.getItem(ONBOARDING_FINISHED_KEY) && hasSavedConfig) {
      const detCorePath    = String(detected?.corePath    || '').trim();
      const detConfigPath  = String(detected?.configPath  || '').trim();
      const detWorkspace   = String(detected?.workspacePath || '').trim();
      const detProviders: string[] = Array.isArray(detected?.existingConfig?.providers)
        ? detected.existingConfig.providers
        : [];
      const detBotToken = String(
        detected?.existingConfig?.botToken ||
        loadedConfig?.botToken || ''
      ).trim();
      const hasAllPaths    = Boolean(detCorePath && detConfigPath && detWorkspace);
      const hasHealthyAuth = detProviders.length > 0;
      const hasMessaging   = Boolean(detBotToken);

      if (hasAllPaths && hasHealthyAuth && hasMessaging) {
        // Automatically write detected paths into launcher config (merge with existing settings)
        const { setConfig } = useStore.getState();
        const patch = { corePath: detCorePath, configPath: detConfigPath, workspacePath: detWorkspace };
        setConfig(patch);

        if (window.electronAPI) {
          const currentConfig = useStore.getState().config;
          const { model: _m, botToken: _b, authChoice: _a, apiKey: _k, ...launcherPayload } = currentConfig as any;
          await window.electronAPI.exec(`config:write ${JSON.stringify(launcherPayload)}`).catch(() => {});
        }

        localStorage.setItem(ONBOARDING_FINISHED_KEY, 'true');
        localStorage.removeItem(ONBOARDING_FORCE_RESET_KEY);
        setOnboardingFinished(true);
        setActiveTab('monitor');
        await syncGatewayStatus({ corePath: detCorePath, configPath: detConfigPath, workspacePath: detWorkspace });
        return;
      }
    }

    checkOnboardingStatus(loadedConfig, detected);
  }, [checkEnvironment, checkOnboardingStatus, detectPaths, loadConfig, setOnboardingFinished, setActiveTab, syncGatewayStatus]);

  useEffect(() => {
    if (!initPromiseRef.current) {
      initPromiseRef.current = initializeApp().finally(() => setBootstrapping(false));
    }
  }, [initializeApp]);

  const handleOnboardingComplete = useCallback(() => {
    localStorage.setItem(ONBOARDING_FINISHED_KEY, 'true');
    localStorage.removeItem(ONBOARDING_FORCE_RESET_KEY);
    setOnboardingFinished(true);
    setActiveTab('monitor');
    // Persist the finished flag to config.json so it survives PID-based localStorage/userData wipe on restart
    if (window.electronAPI) {
      const currentConfig = useStore.getState().config;
      const { 
        model: _m, 
        botToken: _b, 
        authChoice: _a, 
        apiKey: _k, 
        platform: _p, 
        appToken: _at, 
        ...launcherPayload 
      } = currentConfig as any;
      window.electronAPI.exec(
        `config:write ${JSON.stringify({ ...launcherPayload, onboardingFinished: true })}`
      ).catch(() => {});
    }
  }, [setActiveTab, setOnboardingFinished]);

  return {
    bootstrapping,
    handleOnboardingComplete,
  };
}
