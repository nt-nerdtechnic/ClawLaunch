import { useEffect, useRef } from 'react';
import type { i18n as I18nType } from 'i18next';
import type { Config } from '../store';

// Fields that are actually persisted to config.json via config:write.
// Used as the dep array for the write effect so that volatile runtime fields
// (model, botToken, apiKey, etc.) never trigger unnecessary disk I/O.
type PersistedConfigFields = Pick<
  Config,
  | 'corePath'
  | 'configPath'
  | 'workspacePath'
  | 'installDaemon'
  | 'useExternalTerminal'
  | 'autoRestartGateway'
  | 'unrestrictedMode'
  | 'appVersion'
>;

type UseAppLifecycleEffectsParams = {
  addLog: (text: string, source?: 'stdout' | 'stderr' | 'system') => void;
  config: Config;
  theme: string;
  language: string;
  i18n: I18nType;
  runtimeProfile: Record<string, unknown> | null | undefined;
  syncGatewayStatus: (overrideRuntimeProfile?: Record<string, unknown> | null) => Promise<void>;
};

export function useAppLifecycleEffects({
  addLog,
  config,
  theme,
  language,
  i18n,
  runtimeProfile,
  syncGatewayStatus,
}: UseAppLifecycleEffectsParams) {
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

  // ── Theme DOM update (runs only when theme changes) ──────────────────────
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // ── Config write (runs only when launcher-persisted fields change) ────────
  // Keep a render-synchronous ref so the effect body always reads the latest
  // config snapshot without needing the full object in the dep array.
  // This prevents volatile runtime fields (model, botToken, apiKey, etc.)
  // from triggering disk I/O on every store update.
  const configRef = useRef(config);
  configRef.current = config;

  const {
    corePath, configPath, workspacePath,
    installDaemon, useExternalTerminal, autoRestartGateway,
    unrestrictedMode, appVersion,
  } = config as PersistedConfigFields & Partial<Config>;

  useEffect(() => {
    const cfg = configRef.current;
    // Only sync to config.json when config paths have been loaded.
    // Guards against overwriting valid persisted paths with default empty state
    // before loadConfig() has completed its async IPC call on startup.
    const hasLoadedConfig = Boolean(cfg.corePath || cfg.configPath || cfg.workspacePath);
    if (window.electronAPI && hasLoadedConfig) {
      const { model: _m, botToken: _b, authChoice: _a, apiKey: _k, platform: _p, appToken: _at, ...launcherPayload } = cfg;
      const updated = { ...launcherPayload, theme, language };
      window.electronAPI.exec(`config:write ${JSON.stringify(updated)}`).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    theme, language,
    corePath, configPath, workspacePath,
    installDaemon, useExternalTerminal, autoRestartGateway,
    unrestrictedMode, appVersion,
  ]);

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

  // When runtimeProfile is first available, perform immediate gateway status check,
  // then keep polling to avoid stale dashboard status.
  const prevRuntimeProfileRef = useRef<Record<string, unknown> | null | undefined>(undefined);
  useEffect(() => {
    const wasNull = prevRuntimeProfileRef.current === undefined || prevRuntimeProfileRef.current === null;
    const isNowLoaded = runtimeProfile !== null && runtimeProfile !== undefined;

    if (wasNull && isNowLoaded) {
      void syncGatewayStatus(runtimeProfile);
    }
    prevRuntimeProfileRef.current = runtimeProfile;

    const interval = setInterval(() => {
      void syncGatewayStatus();
    }, 10000);

    return () => clearInterval(interval);
  }, [runtimeProfile, syncGatewayStatus]);
}
