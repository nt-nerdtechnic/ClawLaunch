import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import type { Config } from '../store';
import { ConfigService } from '../services/configService';
import { execInTerminal } from '../utils/terminal';

type LogSource = 'system' | 'stderr' | 'stdout';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type UseLauncherSettingsActionsParams = {
  config: Config;
  setConfig: (patch: Partial<Config>) => void;
  addLog: (msg: string, source?: LogSource) => void;
  t: TFunction;
};

export function useLauncherSettingsActions({
  config,
  setConfig,
  addLog,
  t,
}: UseLauncherSettingsActionsParams) {
  const [launcherSaveState, setLauncherSaveState] = useState<SaveState>('idle');
  const launcherResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shellQuote = ConfigService.shellQuote;

  useEffect(() => {
    return () => {
      if (launcherResetTimerRef.current) {
        clearTimeout(launcherResetTimerRef.current);
      }
    };
  }, []);

  const scheduleSaveStateReset = useCallback(() => {
    if (launcherResetTimerRef.current) {
      clearTimeout(launcherResetTimerRef.current);
    }
    launcherResetTimerRef.current = setTimeout(() => {
      setLauncherSaveState('idle');
      launcherResetTimerRef.current = null;
    }, 2200);
  }, []);

  const handleSaveLauncherConfig = useCallback(async () => {
    if (!window.electronAPI) {
      setLauncherSaveState('error');
      scheduleSaveStateReset();
      return;
    }

    const workspacePathRaw = String(config.workspacePath ?? '').trim();
    if (workspacePathRaw) {
      const checkWs = await window.electronAPI.exec(`test -d ${shellQuote(workspacePathRaw)}`);
      if ((checkWs.code ?? checkWs.exitCode) !== 0) {
        addLog(t('runtime.errors.workspaceNotFound', { path: workspacePathRaw }), 'stderr');
      }
    }

    setLauncherSaveState('saving');
    addLog(t('logs.savingConfig'), 'system');
    try {
      const {
        model: _model,
        botToken: _botToken,
        authChoice: _authChoice,
        apiKey: _apiKey,
        ...launcherConfig
      } = config;

      const res = await window.electronAPI.exec(`config:write ${JSON.stringify(launcherConfig)}`);
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || t('runtime.errors.saveLauncherFailed'));
      }

      // Sync workspacePath → openclaw.json agents.defaults.workspace
      const configPathRaw = String(config.configPath ?? '').trim();
      if (configPathRaw && workspacePathRaw) {
        const migratePayload = { configPath: configPathRaw, workspacePath: workspacePathRaw };
        await window.electronAPI.exec(`config:migrate-openclaw ${JSON.stringify(migratePayload)}`);
      }

      setLauncherSaveState('saved');
      scheduleSaveStateReset();
      addLog(t('logs.configSaved'), 'system');
    } catch (e: unknown) {
      setLauncherSaveState('error');
      scheduleSaveStateReset();
      addLog(t('logs.commFailed', { msg: e instanceof Error ? e.message : String(e) }), 'stderr');
    }
  }, [config, shellQuote, addLog, t, scheduleSaveStateReset]);

  const handleBrowsePath = useCallback(async (key: 'corePath' | 'configPath' | 'workspacePath') => {
    if (!window.electronAPI?.selectDirectory) return;
    const selectedPath = await window.electronAPI.selectDirectory();
    if (!selectedPath) return;
    setConfig({ [key]: selectedPath } as Partial<Config>);
  }, [setConfig]);

  const buildOpenClawEnvPrefix = () => ConfigService.buildOpenClawEnvPrefix(config.configPath);

  const handleOpenClawDoctor = async () => {
    if (!config.corePath?.trim()) {
      addLog(t('runtime.actions.doctorMissingCore'), 'stderr');
      return;
    }
    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const cmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw doctor --fix`;
      await execInTerminal(cmd, {
        title: t('runtime.actions.doctorTitle'),
        holdOpen: true,
        cwd: config.corePath,
      });
      addLog(t('runtime.actions.doctorStarted'), 'system');
    } catch (e: unknown) {
      addLog(t('runtime.actions.doctorFailed', { msg: e instanceof Error ? e.message : String(e) }), 'stderr');
    }
  };

  const handleSecurityCheck = async () => {
    if (!config.corePath?.trim()) {
      addLog(t('runtime.actions.auditMissingCore'), 'stderr');
      return;
    }
    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const cmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw security audit --fix --deep`;
      await execInTerminal(cmd, {
        title: t('runtime.actions.auditTitle'),
        holdOpen: true,
        cwd: config.corePath,
      });
      addLog(t('runtime.actions.auditStarted'), 'system');
    } catch (e: unknown) {
      addLog(t('runtime.actions.auditFailed', { msg: e instanceof Error ? e.message : String(e) }), 'stderr');
    }
  };

  return {
    launcherSaveState,
    handleSaveLauncherConfig,
    handleBrowsePath,
    handleOpenClawDoctor,
    handleSecurityCheck,
  };
}
