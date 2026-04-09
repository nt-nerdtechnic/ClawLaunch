import { useEffect, useRef, useState, useCallback } from 'react';
import { execInTerminal } from '../utils/terminal';
import type { Config } from '../store';

type LogSource = 'system' | 'stderr' | 'stdout';

type TFn = (key: string, params?: Record<string, unknown>) => string;

interface UseRuntimeActionsParams {
  config: Config;
  resolvedConfigDir: string;
  runtimeDraftModel: string;
  runtimeDraftBotToken: string;
  runtimeDraftGatewayPort: string;
  runtimeDraftCronMaxConcurrentRuns: number;
  effectiveRuntimeModel: string;
  effectiveRuntimeBotToken: string;
  effectiveRuntimeGatewayPort: string;
  effectiveRuntimeCronMaxConcurrentRuns: number;
  shellQuote: (value: string) => string;
  buildOpenClawEnvPrefix: (cfg?: Partial<Config>) => string;
  isModelAuthorizedByProvider: (modelRef: string) => boolean;
  setRuntimeProfile: (profile: Record<string, unknown> | null) => void;
  addLog: (msg: string, source?: LogSource) => void;
  t: TFn;
}

export function useRuntimeActions(params: UseRuntimeActionsParams) {
  const {
    config,
    resolvedConfigDir,
    runtimeDraftModel,
    runtimeDraftBotToken,
    runtimeDraftGatewayPort,
    runtimeDraftCronMaxConcurrentRuns,
    effectiveRuntimeModel,
    effectiveRuntimeBotToken,
    effectiveRuntimeGatewayPort,
    effectiveRuntimeCronMaxConcurrentRuns,
    shellQuote,
    buildOpenClawEnvPrefix,
    isModelAuthorizedByProvider,
    setRuntimeProfile,
    addLog,
    t,
  } = params;

  const [launcherSaveState, setLauncherSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [runtimeSaveState, setRuntimeSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [isUpdating, setIsUpdating] = useState(false);
  const launcherResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runtimeResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const launcherTimer = launcherResetTimerRef.current;
    const runtimeTimer = runtimeResetTimerRef.current;
    return () => {
      if (launcherTimer) {
        clearTimeout(launcherTimer);
      }
      if (runtimeTimer) {
        clearTimeout(runtimeTimer);
      }
    };
  }, []);

  const scheduleSaveStateReset = useCallback((
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    setter: (value: 'idle' | 'saving' | 'saved' | 'error') => void,
  ) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setter('idle');
      timerRef.current = null;
    }, 2200);
  }, []);

  const persistLauncherConfig = async () => {
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
    const workspacePathRaw = String(config.workspacePath ?? '').trim();
    if (configPathRaw && workspacePathRaw) {
      const migratePayload = { configPath: configPathRaw, workspacePath: workspacePathRaw };
      await window.electronAPI.exec(`config:migrate-openclaw ${JSON.stringify(migratePayload)}`);
    }
  };

  const handleSaveLauncherConfig = async () => {
    if (!window.electronAPI) {
      setLauncherSaveState('error');
      scheduleSaveStateReset(launcherResetTimerRef, setLauncherSaveState);
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
      await persistLauncherConfig();
      setLauncherSaveState('saved');
      scheduleSaveStateReset(launcherResetTimerRef, setLauncherSaveState);
      addLog(t('logs.configSaved'), 'system');
    } catch (e: unknown) {
      setLauncherSaveState('error');
      scheduleSaveStateReset(launcherResetTimerRef, setLauncherSaveState);
      addLog(t('logs.commFailed', { msg: e instanceof Error ? e.message : String(e) }), 'stderr');
    }
  };

  const handleSaveConfig = async () => {
    if (!window.electronAPI) {
      setRuntimeSaveState('error');
      scheduleSaveStateReset(runtimeResetTimerRef, setRuntimeSaveState);
      return;
    }

    setRuntimeSaveState('saving');
    addLog(t('logs.savingConfig'), 'system');
    try {
      await persistLauncherConfig();

      const modelChanged = runtimeDraftModel.trim() !== effectiveRuntimeModel;
      const tokenChanged = runtimeDraftBotToken !== effectiveRuntimeBotToken;
      const portDraft = runtimeDraftGatewayPort.trim();
      const portChanged = portDraft !== effectiveRuntimeGatewayPort;
      const cronMaxConcurrentRunsChanged = runtimeDraftCronMaxConcurrentRuns !== effectiveRuntimeCronMaxConcurrentRuns;

      if (portDraft && !/^\d+$/.test(portDraft)) {
        throw new Error(t('runtime.errors.invalidPort'));
      }

      if (modelChanged || tokenChanged || portChanged || cronMaxConcurrentRunsChanged) {
        const corePath = String(config.corePath || '').trim();
        if (!corePath) {
          throw new Error(t('runtime.errors.missingCorePathAction'));
        }
        if (!resolvedConfigDir) {
          throw new Error(t('runtime.errors.missingConfigPathAction'));
        }

        const envPrefix = buildOpenClawEnvPrefix();
        const cdCorePath = `cd ${shellQuote(corePath)}`;

        if (modelChanged) {
          const nextModel = runtimeDraftModel.trim();
          if (!nextModel) {
            throw new Error(t('runtime.errors.emptyModel'));
          }
          if (!isModelAuthorizedByProvider(nextModel)) {
            throw new Error(t('runtime.errors.unauthorizedModel'));
          }
          const setModelCmd = `${cdCorePath} && ${envPrefix}pnpm openclaw config set agents.defaults.model.primary ${shellQuote(JSON.stringify(nextModel))} --json`;
          const setModelRes = await window.electronAPI.exec(setModelCmd);
          if ((setModelRes.code ?? setModelRes.exitCode) !== 0) {
            throw new Error(setModelRes.stderr || t('runtime.errors.updateModelFailed'));
          }
        }

        if (tokenChanged) {
          const setTokenCmd = `${cdCorePath} && ${envPrefix}pnpm openclaw config set channels.telegram.botToken ${shellQuote(JSON.stringify(runtimeDraftBotToken))} --json`;
          const setTokenRes = await window.electronAPI.exec(setTokenCmd);
          if ((setTokenRes.code ?? setTokenRes.exitCode) !== 0) {
            throw new Error(setTokenRes.stderr || t('runtime.errors.updateTokenFailed'));
          }
        }

        if (portChanged) {
          if (portDraft) {
            const setPortCmd = `${cdCorePath} && ${envPrefix}pnpm openclaw config set gateway.port ${Number(portDraft)} --json`;
            const setPortRes = await window.electronAPI.exec(setPortCmd);
            if ((setPortRes.code ?? setPortRes.exitCode) !== 0) {
              throw new Error(setPortRes.stderr || t('runtime.errors.updatePortFailed'));
            }
          } else {
            const delPortCmd = `${cdCorePath} && ${envPrefix}pnpm openclaw config delete gateway.port --json`;
            const delPortRes = await window.electronAPI.exec(delPortCmd);
            if ((delPortRes.code ?? delPortRes.exitCode) !== 0) {
              throw new Error(delPortRes.stderr || t('runtime.errors.updatePortFailed'));
            }
          }
        }

        if (cronMaxConcurrentRunsChanged) {
          const maxRuns = Math.max(1, Math.floor(runtimeDraftCronMaxConcurrentRuns));
          const setCronCmd = `${cdCorePath} && ${envPrefix}pnpm openclaw config set cron.maxConcurrentRuns ${maxRuns} --json`;
          const setCronRes = await window.electronAPI.exec(setCronCmd);
          if ((setCronRes.code ?? setCronRes.exitCode) !== 0) {
            throw new Error(setCronRes.stderr || t('runtime.errors.updateCronMaxConcurrentRunsFailed'));
          }
        }

        const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
        if (probeRes.code === 0 && probeRes.stdout) {
          setRuntimeProfile(JSON.parse(probeRes.stdout));
        }
      }

      setRuntimeSaveState('saved');
      scheduleSaveStateReset(runtimeResetTimerRef, setRuntimeSaveState);
      addLog(t('logs.configSaved'), 'system');
      addLog(t('runtime.errors.configApplied'), 'system');
    } catch (e: unknown) {
      setRuntimeSaveState('error');
      scheduleSaveStateReset(runtimeResetTimerRef, setRuntimeSaveState);
      addLog(t('logs.commFailed', { msg: e instanceof Error ? e.message : String(e) }), 'stderr');
    }
  };

  const handleUpdateOpenClaw = async (targetVersion: string) => {
    if (!config.corePath?.trim()) {
      addLog(t('runtime.update.missingCore'), 'stderr');
      return;
    }
    const version = targetVersion.trim() || 'main';
    setIsUpdating(true);
    addLog(t('runtime.update.started', { version }), 'system');

    const unlisten = window.electronAPI.onLog?.((payload) => {
      const text = payload.data.replace(/\n$/, '');
      if (text) addLog(text, payload.source);
    });

    try {
      const payload = { corePath: config.corePath, version };
      const res = await window.electronAPI.exec(`project:update ${JSON.stringify(payload)}`);

      if ((res.code ?? res.exitCode) !== 0) {
        addLog(t('runtime.update.failed', { msg: res.stderr || `exit ${res.code}` }), 'stderr');
        return;
      }

      addLog(t('runtime.update.success'), 'system');

      // Auto-restart gateway with verification
      addLog(t('runtime.update.restartingGateway'), 'system');
      const envPrefix = buildOpenClawEnvPrefix();
      const corePath = config.corePath;

      // Stop gateway
      await window.electronAPI.exec(
        `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw gateway stop`
      ).catch(() => {});

      // Wait for gateway to fully stop (max 10 seconds)
      const gatewayPort = effectiveRuntimeGatewayPort?.trim() || '18789';
      let waited = 0;
      const checkGatewayDown = async (): Promise<boolean> => {
        const res = await window.electronAPI.exec(`lsof -nP -iTCP:${gatewayPort} -sTCP:LISTEN 2>/dev/null | wc -l`).catch(() => ({ stdout: '0' }));
        return String(res.stdout || '0').trim() === '0';
      };
      while (waited < 10000 && !(await checkGatewayDown())) {
        await new Promise<void>((r) => setTimeout(r, 500));
        waited += 500;
      }

      // Start gateway
      if (config.installDaemon) {
        await window.electronAPI.exec(
          `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw gateway start`
        ).catch(() => {});
      } else {
        await execInTerminal(
          `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw gateway run --verbose --force`,
          { title: 'OpenClaw Gateway', holdOpen: false, cwd: corePath }
        );
      }

      // Verify gateway restarted successfully
      await new Promise<void>((r) => setTimeout(r, 3000));
      const statusRes = await window.electronAPI.exec(
        `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw gateway status`
      ).catch(() => ({ code: 1, stderr: 'status check failed' }));

      if ((statusRes?.code ?? 1) !== 0) {
        // Retry once after an additional wait
        addLog(t('runtime.update.gatewayRetrying'), 'system');
        await new Promise<void>((r) => setTimeout(r, 4000));
        const retryRes = await window.electronAPI.exec(
          `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw gateway status`
        ).catch(() => ({ code: 1 }));
        if ((retryRes?.code ?? 1) !== 0) {
          addLog(t('runtime.update.gatewayWarning', { msg: 'Please manually verify Gateway startup' }), 'stderr');
        } else {
          addLog(t('runtime.update.gatewayRestarted'), 'system');
        }
      } else {
        addLog(t('runtime.update.gatewayRestarted'), 'system');
      }
    } catch (e: unknown) {
      addLog(t('runtime.update.failed', { msg: e instanceof Error ? e.message : String(e) }), 'stderr');
    } finally {
      unlisten?.();
      setIsUpdating(false);
    }
  };

  const handleSaveChannelToken = async (channelId: string, token: string) => {
    if (!window.electronAPI) return;
    const corePath = String(config.corePath || '').trim();
    if (!corePath) {
      addLog(t('runtime.errors.missingCorePathToken'), 'stderr');
      return;
    }
    if (!resolvedConfigDir) {
      addLog(t('runtime.errors.missingConfigPathToken'), 'stderr');
      return;
    }
    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const safeChannelId = channelId.replace(/[^a-z0-9_-]/gi, '');
      const cmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw config set channels.${safeChannelId}.botToken ${shellQuote(JSON.stringify(token))} --json`;
      const res = await window.electronAPI.exec(cmd);
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || t('runtime.errors.updateChannelTokenFailed', { channel: channelId, msg: '' }));
      }
      addLog(t('runtime.actions.channelTokenUpdated', { id: channelId }), 'system');
      const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
      if (probeRes.code === 0 && probeRes.stdout) {
        setRuntimeProfile(JSON.parse(probeRes.stdout));
      }
    } catch (e: unknown) {
      addLog(t('runtime.errors.updateChannelTokenFailed', { channel: channelId, msg: e instanceof Error ? e.message : String(e) }), 'stderr');
    }
  };

  return {
    handleSaveLauncherConfig,
    handleSaveConfig,
    launcherSaveState,
    runtimeSaveState,
    handleUpdateOpenClaw,
    isUpdating,
    handleSaveChannelToken,
  };
}
