import { useEffect, useRef, useState, useCallback } from 'react';
import { execInTerminal } from '../utils/terminal';
import type { TelegramPairingRequest } from './useTelegramPairing';

type LogSource = 'system' | 'stderr' | 'stdout';

type TFn = (key: string, params?: Record<string, any>) => string;

type ProviderChoice = { id: string; reqKey: boolean; oauthFlow?: boolean };
type ProviderGroup = { id: string; choices: ProviderChoice[] };

interface UseRuntimeActionsParams {
  config: any;
  resolvedConfigDir: string;
  runtimeDraftModel: string;
  runtimeDraftBotToken: string;
  runtimeDraftGatewayPort: string;
  effectiveRuntimeModel: string;
  effectiveRuntimeBotToken: string;
  effectiveRuntimeGatewayPort: string;
  authAddProvider: string;
  authAddChoice: string;
  authAddSecret: string;
  authAddTokenCommand: string;
  SETTINGS_PROVIDER_GROUPS: ProviderGroup[];
  shellQuote: (value: string) => string;
  buildOpenClawEnvPrefix: (cfg?: any) => string;
  isModelAuthorizedByProvider: (modelRef: string) => boolean;
  loadAuthProfiles: () => Promise<void>;
  loadTelegramPairingRequests: () => Promise<void>;
  setRuntimeProfile: (profile: any) => void;
  setAuthRemovingId: (id: string) => void;
  setAuthAddError: (msg: string) => void;
  setAuthAdding: (v: boolean) => void;
  setAuthAddSecret: (s: string) => void;
  setAuthAddTokenError: (msg: string) => void;
  setAuthAddTokenRunning: (v: boolean) => void;
  setTelegramPairingApprovingCode: (code: string) => void;
  setTelegramPairingRejectingCode: (code: string) => void;
  setTelegramPairingClearing: (v: boolean) => void;
  setTelegramPairingError: (msg: string) => void;
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
  } = params;

  const [launcherSaveState, setLauncherSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [runtimeSaveState, setRuntimeSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
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
    } = config as any;

    const res = await window.electronAPI.exec(`config:write ${JSON.stringify(launcherConfig)}`);
    if ((res.code ?? res.exitCode) !== 0) {
      throw new Error(res.stderr || t('runtime.errors.saveLauncherFailed'));
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
    } catch (e: any) {
      setLauncherSaveState('error');
      scheduleSaveStateReset(launcherResetTimerRef, setLauncherSaveState);
      addLog(t('logs.commFailed', { msg: e.message }), 'stderr');
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

      if (portDraft && !/^\d+$/.test(portDraft)) {
        throw new Error(t('runtime.errors.invalidPort'));
      }

      if (modelChanged || tokenChanged || portChanged) {
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

        const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
        if (probeRes.code === 0 && probeRes.stdout) {
          setRuntimeProfile(JSON.parse(probeRes.stdout));
        }
      }

      setRuntimeSaveState('saved');
      scheduleSaveStateReset(runtimeResetTimerRef, setRuntimeSaveState);
      addLog(t('logs.configSaved'), 'system');
      addLog(t('runtime.errors.configApplied'), 'system');
    } catch (e: any) {
      setRuntimeSaveState('error');
      scheduleSaveStateReset(runtimeResetTimerRef, setRuntimeSaveState);
      addLog(t('logs.commFailed', { msg: e.message }), 'stderr');
    }
  };

  const handleLaunchFullOnboarding = async () => {
    if (!config.corePath?.trim()) {
      setAuthAddError(t('auth.errors.missingCorePath'));
      return;
    }
    if (!resolvedConfigDir) {
      setAuthAddError(t('auth.errors.missingConfigPath'));
      return;
    }

    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const cmd = `${envPrefix}pnpm openclaw onboard`;
      await execInTerminal(cmd, {
        title: t('runtime.actions.onboardTitle'),
        holdOpen: true,
        cwd: config.corePath,
      });
      addLog(t('auth.onboardLaunched'), 'system');
      await loadAuthProfiles();
    } catch (e: any) {
      const msg = e?.message || t('auth.errors.onboardFailed');
      setAuthAddError(msg);
      addLog(msg, 'stderr');
    }
  };

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
    } catch (e: any) {
      addLog(t('runtime.actions.doctorFailed', { msg: e?.message || e }), 'stderr');
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
    } catch (e: any) {
      addLog(t('runtime.actions.auditFailed', { msg: e?.message || e }), 'stderr');
    }
  };

  const handleRemoveAuthProfile = async (profileId: string) => {
    if (!window.electronAPI || !resolvedConfigDir || !profileId) return;
    setAuthRemovingId(profileId);
    setAuthAddError('');
    try {
      const res = await window.electronAPI.exec(`auth:remove-profile ${JSON.stringify({ configPath: resolvedConfigDir, profileId })}`);
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || t('auth.errors.removeFailed'));
      }
      addLog(t('runtime.actions.authRemoved', { id: profileId }), 'system');
      await loadAuthProfiles();
      const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
      if (probeRes.code === 0 && probeRes.stdout) {
        setRuntimeProfile(JSON.parse(probeRes.stdout));
      }
    } catch (e: any) {
      const msg = e?.message || t('auth.errors.removeFailed');
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
      setAuthAddError(t('auth.errors.addAuthMissingConfig'));
      return;
    }
    if (!config.corePath?.trim()) {
      setAuthAddError(t('auth.errors.addAuthMissingCore'));
      return;
    }

    const curGroup = SETTINGS_PROVIDER_GROUPS.find((g) => g.id === authAddProvider);
    const curChoice = curGroup?.choices.find((c) => c.id === authAddChoice);
    if (curChoice?.oauthFlow) {
      await handleLaunchFullOnboarding();
      return;
    }

    const requiresSecret = curChoice?.reqKey ?? !['ollama', 'vllm'].includes(authAddChoice);
    if (requiresSecret && !authAddSecret.trim()) {
      setAuthAddError(t('auth.errors.credentialRequired'));
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
        throw new Error(res.stderr || t('auth.errors.addFailed'));
      }
      addLog(t('runtime.actions.authAdded', { choice: authAddChoice }), 'system');
      setAuthAddSecret('');
      await loadAuthProfiles();
      const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
      if (probeRes.code === 0 && probeRes.stdout) {
        setRuntimeProfile(JSON.parse(probeRes.stdout));
      }
    } catch (e: any) {
      const msg = e?.message || t('auth.errors.addFailed');
      setAuthAddError(msg);
      addLog(msg, 'stderr');
    } finally {
      setAuthAdding(false);
    }
  };

  const handleRunAuthTokenCommand = async () => {
    const command = (authAddTokenCommand || '').trim();
    if (!command) {
      setAuthAddTokenError(t('auth.errors.emptyCommand'));
      return;
    }
    setAuthAddTokenRunning(true);
    setAuthAddTokenError('');
    try {
      const res = await execInTerminal(command, {
        title: t('runtime.actions.tokenAuthTitle'),
        holdOpen: true,
        cwd: config.corePath || undefined,
      });
      const code = (res as any)?.code ?? (res as any)?.exitCode;
      if (typeof code === 'number' && code !== 0) {
        throw new Error((res as any)?.stderr || t('auth.errors.commandExecError'));
      }
    } catch (err: any) {
      setAuthAddTokenError(err?.message || t('auth.errors.commandExecError'));
    } finally {
      setAuthAddTokenRunning(false);
    }
  };

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
      const cmd = `PAIRING_FILE=${shellQuote(pairingFile)} TARGET_CODE=${shellQuote(request.code)} node - <<'NODE'\nconst fs = require('fs');\nconst file = process.env.PAIRING_FILE;\nconst targetCode = process.env.TARGET_CODE;\nlet data = { version: 1, requests: [] };\nif (fs.existsSync(file)) {\n  data = JSON.parse(fs.readFileSync(file, 'utf8'));\n}\nconst requests = Array.isArray(data.requests) ? data.requests : [];\ndata.requests = requests.filter((entry) => String(entry?.code || '') !== String(targetCode || ''));\nfs.writeFileSync(file, JSON.stringify(data, null, 2) + '\\n', 'utf8');\nNODE`;
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
      const cmd = `PAIRING_FILE=${shellQuote(pairingFile)} node - <<'NODE'\nconst fs = require('fs');\nconst file = process.env.PAIRING_FILE;\nlet data = { version: 1, requests: [] };\nif (fs.existsSync(file)) {\n  data = JSON.parse(fs.readFileSync(file, 'utf8'));\n}\ndata.requests = [];\nfs.writeFileSync(file, JSON.stringify(data, null, 2) + '\\n', 'utf8');\nNODE`;
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
    } catch (e: any) {
      addLog(t('runtime.errors.updateChannelTokenFailed', { channel: channelId, msg: e?.message || e }), 'stderr');
    }
  };

  return {
    handleSaveLauncherConfig,
    handleSaveConfig,
    launcherSaveState,
    runtimeSaveState,
    handleRemoveAuthProfile,
    handleAddAuthProfile,
    handleLaunchFullOnboarding,
    handleRunAuthTokenCommand,
    handleOpenClawDoctor,
    handleSecurityCheck,
    approveTelegramPairing,
    rejectTelegramPairing,
    clearTelegramPairingRequests,
    handleSaveChannelToken,
  };
}
