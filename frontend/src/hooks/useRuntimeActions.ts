import { useEffect, useRef, useState } from 'react';
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
    return () => {
      if (launcherResetTimerRef.current) {
        clearTimeout(launcherResetTimerRef.current);
      }
      if (runtimeResetTimerRef.current) {
        clearTimeout(runtimeResetTimerRef.current);
      }
    };
  }, []);

  const scheduleSaveStateReset = (
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
  };

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
      throw new Error(res.stderr || '保存 Launcher 設定失敗');
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
        addLog(`警告: Workspace Path 目錄不存在：${workspacePathRaw}。儲存將繼續，但請確認路徑正確，否則 Agent 可能無法存取工作區。`, 'stderr');
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
        throw new Error('Gateway Port 格式不正確，請填入正整數或留空（移除設定）。');
      }

      if (modelChanged || tokenChanged || portChanged) {
        const corePath = String(config.corePath || '').trim();
        if (!corePath) {
          throw new Error('缺少 Core Path，無法更新 OpenClaw 動態設定');
        }
        if (!resolvedConfigDir) {
          throw new Error('缺少 Config Path，無法更新 OpenClaw 動態設定');
        }

        const envPrefix = buildOpenClawEnvPrefix();
        const cdCorePath = `cd ${shellQuote(corePath)}`;

        if (modelChanged) {
          const nextModel = runtimeDraftModel.trim();
          if (!nextModel) {
            throw new Error('Model 不能是空值');
          }
          if (!isModelAuthorizedByProvider(nextModel)) {
            throw new Error('所選模型與目前授權 provider 不相符，請改用授權清單中的模型。');
          }
          const setModelCmd = `${cdCorePath} && ${envPrefix}pnpm openclaw config set agents.defaults.model.primary ${shellQuote(JSON.stringify(nextModel))} --json`;
          const setModelRes = await window.electronAPI.exec(setModelCmd);
          if ((setModelRes.code ?? setModelRes.exitCode) !== 0) {
            throw new Error(setModelRes.stderr || '更新模型設定失敗');
          }
        }

        if (tokenChanged) {
          const setTokenCmd = `${cdCorePath} && ${envPrefix}pnpm openclaw config set channels.telegram.botToken ${shellQuote(JSON.stringify(runtimeDraftBotToken))} --json`;
          const setTokenRes = await window.electronAPI.exec(setTokenCmd);
          if ((setTokenRes.code ?? setTokenRes.exitCode) !== 0) {
            throw new Error(setTokenRes.stderr || '更新 Telegram Bot Token 失敗');
          }
        }

        if (portChanged) {
          if (portDraft) {
            const setPortCmd = `${cdCorePath} && ${envPrefix}pnpm openclaw config set gateway.port ${Number(portDraft)} --json`;
            const setPortRes = await window.electronAPI.exec(setPortCmd);
            if ((setPortRes.code ?? setPortRes.exitCode) !== 0) {
              throw new Error(setPortRes.stderr || '更新 Gateway Port 失敗');
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
      addLog('>>> Runtime 設定已寫入 openclaw.json。', 'system');
    } catch (e: any) {
      setRuntimeSaveState('error');
      scheduleSaveStateReset(runtimeResetTimerRef, setRuntimeSaveState);
      addLog(t('logs.commFailed', { msg: e.message }), 'stderr');
    }
  };

  const handleLaunchFullOnboarding = async () => {
    if (!config.corePath?.trim()) {
      setAuthAddError('缺少 Core Path，無法啟動完整導引。');
      return;
    }
    if (!resolvedConfigDir) {
      setAuthAddError('缺少 Config Path，無法啟動完整導引。');
      return;
    }

    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const cmd = `${envPrefix}pnpm openclaw onboard`;
      await execInTerminal(cmd, {
        title: 'OpenClaw 完整授權導引',
        holdOpen: true,
        cwd: config.corePath,
      });
      addLog('已啟動完整導引，完成後可回設定頁刷新授權清單。', 'system');
      await loadAuthProfiles();
    } catch (e: any) {
      const msg = e?.message || '啟動完整導引失敗';
      setAuthAddError(msg);
      addLog(msg, 'stderr');
    }
  };

  const handleOpenClawDoctor = async () => {
    if (!config.corePath?.trim()) {
      addLog('缺少 Core Path，無法執行 doctor 診斷。', 'stderr');
      return;
    }
    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const cmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw doctor --fix`;
      await execInTerminal(cmd, {
        title: 'OpenClaw Doctor — 系統診斷（--fix）',
        holdOpen: true,
        cwd: config.corePath,
      });
      addLog('已啟動 openclaw doctor --fix 診斷視窗。', 'system');
    } catch (e: any) {
      addLog(`啟動 doctor 診斷失敗：${e?.message || e}`, 'stderr');
    }
  };

  const handleSecurityCheck = async () => {
    if (!config.corePath?.trim()) {
      addLog('缺少 Core Path，無法執行資安稽核。', 'stderr');
      return;
    }
    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const cmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw security audit --fix --deep`;
      await execInTerminal(cmd, {
        title: 'OpenClaw 資安稽核 (security audit --fix --deep)',
        holdOpen: true,
        cwd: config.corePath,
      });
      addLog('已啟動資安稽核視窗（--fix 自動收緊設定，--deep 探測 Gateway）。', 'system');
    } catch (e: any) {
      addLog(`啟動資安稽核失敗：${e?.message || e}`, 'stderr');
    }
  };

  const handleRemoveAuthProfile = async (profileId: string) => {
    if (!window.electronAPI || !resolvedConfigDir || !profileId) return;
    setAuthRemovingId(profileId);
    setAuthAddError('');
    try {
      const res = await window.electronAPI.exec(`auth:remove-profile ${JSON.stringify({ configPath: resolvedConfigDir, profileId })}`);
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || '移除授權失敗');
      }
      addLog(`已取消授權：${profileId}`, 'system');
      await loadAuthProfiles();
      const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
      if (probeRes.code === 0 && probeRes.stdout) {
        setRuntimeProfile(JSON.parse(probeRes.stdout));
      }
    } catch (e: any) {
      const msg = e?.message || '移除授權失敗';
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
      setAuthAddError('缺少 Config Path，無法新增授權。');
      return;
    }
    if (!config.corePath?.trim()) {
      setAuthAddError('缺少 Core Path，無法新增授權。');
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
      setAuthAddError('此授權方式需要輸入憑證。');
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
        throw new Error(res.stderr || '新增授權失敗');
      }
      addLog(`新增授權成功：${authAddChoice}`, 'system');
      setAuthAddSecret('');
      await loadAuthProfiles();
      const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
      if (probeRes.code === 0 && probeRes.stdout) {
        setRuntimeProfile(JSON.parse(probeRes.stdout));
      }
    } catch (e: any) {
      const msg = e?.message || '新增授權失敗';
      setAuthAddError(msg);
      addLog(msg, 'stderr');
    } finally {
      setAuthAdding(false);
    }
  };

  const handleRunAuthTokenCommand = async () => {
    const command = (authAddTokenCommand || '').trim();
    if (!command) {
      setAuthAddTokenError('請先輸入要執行的指令');
      return;
    }
    setAuthAddTokenRunning(true);
    setAuthAddTokenError('');
    try {
      const res = await execInTerminal(command, {
        title: 'Claude Token 授權流程',
        holdOpen: true,
        cwd: config.corePath || undefined,
      });
      const code = (res as any)?.code ?? (res as any)?.exitCode;
      if (typeof code === 'number' && code !== 0) {
        throw new Error((res as any)?.stderr || '指令執行失敗');
      }
    } catch (err: any) {
      setAuthAddTokenError(err?.message || '執行指令時發生錯誤');
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
      addLog('缺少 Core Path，無法更新通道 Token。', 'stderr');
      return;
    }
    if (!resolvedConfigDir) {
      addLog('缺少 Config Path，無法更新通道 Token。', 'stderr');
      return;
    }
    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const safeChannelId = channelId.replace(/[^a-z0-9_-]/gi, '');
      const cmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw config set channels.${safeChannelId}.botToken ${shellQuote(JSON.stringify(token))} --json`;
      const res = await window.electronAPI.exec(cmd);
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || `更新 ${channelId} Token 失敗`);
      }
      addLog(`>>> ${channelId} Bot Token 已更新。`, 'system');
      const probeRes = await window.electronAPI.exec(`config:probe ${shellQuote(resolvedConfigDir)}`);
      if (probeRes.code === 0 && probeRes.stdout) {
        setRuntimeProfile(JSON.parse(probeRes.stdout));
      }
    } catch (e: any) {
      addLog(`更新 ${channelId} Token 失敗：${e?.message || e}`, 'stderr');
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
