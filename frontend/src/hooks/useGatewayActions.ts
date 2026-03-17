import { execInTerminal } from '../utils/terminal';

type LogSource = 'system' | 'stderr' | 'stdout';
type TFn = (key: string, params?: Record<string, any>) => string;

interface GatewayConflictModal {
  message: string;
  detail: string;
  port: number;
}

interface UseGatewayActionsParams {
  config: any;
  running: boolean;
  setRunning: (running: boolean) => void;
  shellQuote: (value: string) => string;
  buildOpenClawEnvPrefix: (cfg?: any) => string;
  resolveGatewayPortArg: (cfg?: any) => string | null;
  resolveGatewayPortForPrecheck: (cfg?: any) => { port: number } | null;
  isGatewayListeningOnConfiguredPort: (cfg?: any) => Promise<boolean | null>;
  addLog: (msg: string, source?: LogSource) => void;
  t: TFn;
  gatewayConflictModal: GatewayConflictModal | null;
  setGatewayConflictModal: (value: GatewayConflictModal | null) => void;
  setKillingGatewayPortHolder: (value: boolean) => void;
  setGatewayConflictActionMessage: (value: string) => void;
  closeGatewayConflictModal: () => void;
}

export function useGatewayActions({
  config,
  running,
  setRunning,
  shellQuote,
  buildOpenClawEnvPrefix,
  resolveGatewayPortArg,
  resolveGatewayPortForPrecheck,
  isGatewayListeningOnConfiguredPort,
  addLog,
  t,
  gatewayConflictModal,
  setGatewayConflictModal,
  setKillingGatewayPortHolder,
  setGatewayConflictActionMessage,
  closeGatewayConflictModal,
}: UseGatewayActionsParams) {
  const shouldUseExternalTerminal = (cfg?: any) =>
    (cfg?.useExternalTerminal ?? config.useExternalTerminal) !== false;

  const syncGatewayStatus = async (runtimeConfig?: any) => {
    try {
      const effectiveConfig = runtimeConfig || config;
      const listening = await isGatewayListeningOnConfiguredPort(effectiveConfig);
      if (listening !== null) {
        setRunning(listening);
      }
    } catch {
    }
  };

  const toggleGateway = async () => {
    if (!window.electronAPI) {
      addLog(t('logs.commFailed', { msg: 'Electron API not available' }), 'stderr');
      return;
    }

    if (!config.corePath || !config.corePath.trim()) {
      addLog('錯誤: 尚未設定 Core Path，請至「配置編輯」填入 OpenClaw 主核心區絕對路徑後再試。', 'stderr');
      return;
    }

    if (running) {
      addLog(t('logs.stoppingGateway'), 'system');
      try {
        await window.electronAPI.exec('gateway:http-watchdog-stop').catch(() => {});
        const envPrefix = buildOpenClawEnvPrefix();
        const portArg = resolveGatewayPortArg();
        if (portArg === null) {
          addLog(t('logs.invalidGatewayPort'), 'stderr');
          return;
        }
        const hasConfigIsolation = !!config.configPath?.trim();
        const hasPortIsolation = portArg !== null;
        if (!hasConfigIsolation && !hasPortIsolation) {
          addLog('錯誤: 未設定 Config Path 且未指定 Gateway Port，無法安全識別目標實例，拒絕停止以避免誤停其他並行服務。', 'stderr');
          return;
        }
        const cmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway stop${portArg}`;
        const resRaw: any = shouldUseExternalTerminal()
          ? await execInTerminal(cmd, {
              title: 'Stopping OpenClaw Gateway',
              holdOpen: false,
              cwd: config.corePath,
            })
          : await window.electronAPI.exec(cmd);
        const code = resRaw.code ?? resRaw.exitCode;
        if (code === 0) {
          setRunning(false);
          addLog(t('logs.gatewayStopped'), 'system');
        } else {
          addLog(t('logs.stopGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
        }
      } catch (e: any) {
        addLog(t('logs.stopGatewayFailed', { msg: e.message }), 'stderr');
      }
      return;
    }

    addLog(t('logs.startingGateway'), 'system');
    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const portArg = resolveGatewayPortArg();
      if (portArg === null) {
        addLog(t('logs.invalidGatewayPort'), 'stderr');
        return;
      }

      const precheck = resolveGatewayPortForPrecheck();
      if (!precheck) {
        addLog(t('logs.invalidGatewayPort'), 'stderr');
        return;
      }
      const precheckRes: any = await window.electronAPI.exec(`lsof -nP -iTCP:${precheck.port} -sTCP:LISTEN`);
      const precheckCode = precheckRes.code ?? precheckRes.exitCode;
      const precheckOutput = String(precheckRes.stdout || '').trim();
      if (precheckCode === 0 && precheckOutput) {
        const message = `錯誤: 啟動前檢查到 Port ${precheck.port} 已被占用，請改用其他 Gateway Port。`;
        addLog(message, 'stderr');
        addLog(precheckOutput, 'stderr');
        setGatewayConflictActionMessage('');
        setKillingGatewayPortHolder(false);
        setGatewayConflictModal({ message, detail: precheckOutput, port: precheck.port });
        return;
      }

      const checkDir = await window.electronAPI.exec(`test -d ${shellQuote(config.corePath)}`);
      if ((checkDir.code ?? checkDir.exitCode) !== 0) {
        addLog(`錯誤: Core Path 目錄不存在：${config.corePath}`, 'stderr');
        return;
      }

      const useExternalTerminal = shouldUseExternalTerminal();
      let startCmd = '';
      if (useExternalTerminal) {
        startCmd = config.installDaemon
          ? `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway start${portArg}`
          : `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway run${portArg} --verbose --force`;

        await window.electronAPI.exec('gateway:http-watchdog-stop').catch(() => {});

        const resRaw: any = await execInTerminal(startCmd, {
          title: 'Starting OpenClaw Gateway',
          holdOpen: true,
          cwd: config.corePath,
        });
        const code = resRaw.code ?? resRaw.exitCode;
        if (typeof code === 'number' && code !== 0) {
          addLog(t('logs.startGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
          return;
        }
        addLog(t('logs.gatewayStartCmdSent'), 'system');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else if (config.installDaemon) {
        await window.electronAPI.exec('gateway:http-watchdog-stop').catch(() => {});
        const cmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway start${portArg}`;
        const resRaw: any = await window.electronAPI.exec(cmd);
        const code = resRaw.code ?? resRaw.exitCode;
        if (code === 0) {
          addLog(t('logs.gatewayStartCmdSent'), 'system');
        } else {
          addLog(t('logs.startGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
          return;
        }
      } else {
        await window.electronAPI.exec('gateway:http-watchdog-stop').catch(() => {});
        const runCmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway run${portArg} --verbose --force`;
        const payload = {
          command: runCmd,
          autoRestart: !!config.autoRestartGateway,
          restartInForegroundTerminal: !!config.restartInForegroundTerminal,
        };
        const resRaw: any = await window.electronAPI.exec(`gateway:start-bg-json ${JSON.stringify(payload)}`);
        const code = resRaw.code ?? resRaw.exitCode;
        if (code !== 0) {
          addLog(t('logs.startGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
          return;
        }
        addLog(t('logs.gatewayStartCmdSent'), 'system');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      const listening = await isGatewayListeningOnConfiguredPort(config);
      if (listening) {
        setRunning(true);
        addLog(t('logs.gatewayStarted'), 'system');

        if (useExternalTerminal && !config.installDaemon) {
          const portInfo = resolveGatewayPortForPrecheck(config);
          const healthCheckCommand = portInfo ? `lsof -nP -iTCP:${portInfo.port} -sTCP:LISTEN` : '';
          const watchdogPayload = {
            enabled: !!config.autoRestartGateway,
            healthCheckCommand,
            restartCommand: startCmd,
            intervalMs: 15000,
            failThreshold: 2,
            maxRestarts: 5,
          };
          const wdRes: any = await window.electronAPI.exec(`gateway:http-watchdog-start-json ${JSON.stringify(watchdogPayload)}`);
          const wdCode = wdRes.code ?? wdRes.exitCode;
          if (wdCode === 0) {
            addLog(
              config.autoRestartGateway
                ? '已啟用外部 Terminal 模式 Gateway watchdog（HTTP 健康檢查 + 自動重啟）'
                : '外部 Terminal 模式 watchdog 已停用（依設定）',
              'system',
            );
          } else {
            addLog(`watchdog 設定失敗：${wdRes.stderr || `exit ${wdCode}`}`, 'stderr');
          }
        }
      } else {
        addLog(t('logs.startGatewayFailed', { msg: '目標埠未進入 LISTEN 狀態' }), 'stderr');
      }
    } catch (e: any) {
      addLog(t('logs.startGatewayFailed', { msg: e.message }), 'stderr');
    }
  };

  const handleKillGatewayPortHolder = async () => {
    if (!window.electronAPI || !gatewayConflictModal) {
      return;
    }

    setKillingGatewayPortHolder(true);
    setGatewayConflictActionMessage('');

    try {
      const result = await window.electronAPI.killPortHolder(gatewayConflictModal.port);
      if (result.success) {
        const allKilled = [...(result.killed || []), ...(result.forceKilled || [])];
        const uniqueKilled = Array.from(new Set(allKilled));
        const partialFailed = (result.failed || []).length > 0;
        const successMsg = uniqueKilled.length > 0
          ? `已強制關閉 Port ${gatewayConflictModal.port} 占用程序（PID: ${uniqueKilled.join(', ')}）${partialFailed ? '，但仍有部分 PID 關閉失敗。' : '。'}`
          : `已嘗試強制關閉 Port ${gatewayConflictModal.port} 占用程序。`;
        setGatewayConflictActionMessage(successMsg);
        addLog(successMsg, partialFailed ? 'stderr' : 'system');
        window.setTimeout(() => {
          closeGatewayConflictModal();
        }, 350);
      } else {
        const errorMsg = result.error || `無法關閉 Port ${gatewayConflictModal.port} 的占用程序`;
        setGatewayConflictActionMessage(errorMsg);
        addLog(errorMsg, 'stderr');
      }
    } catch (e: any) {
      const errorMsg = e?.message || `關閉 Port ${gatewayConflictModal.port} 占用程序時發生錯誤`;
      setGatewayConflictActionMessage(errorMsg);
      addLog(errorMsg, 'stderr');
    } finally {
      setKillingGatewayPortHolder(false);
    }
  };

  return {
    toggleGateway,
    syncGatewayStatus,
    handleKillGatewayPortHolder,
  };
}
