import { execInTerminal } from '../utils/terminal';

const NT_CLAW_TERMINAL_MARKER_PREFIX = '__NT_CLAWLAUNCH_MANAGED__';

type LogSource = 'system' | 'stderr' | 'stdout';
type TFn = (key: string, params?: Record<string, any>) => string;

interface GatewayConflictModal {
  message: string;
  detail: string;
  port: number;
}

interface UseGatewayActionsParams {
  config: any;
  runtimeProfile: any;
  running: boolean;
  setRunning: (running: boolean) => void;
  shellQuote: (value: string) => string;
  buildOpenClawEnvPrefix: (cfg?: any) => string;
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
  runtimeProfile,
  running,
  setRunning,
  shellQuote,
  buildOpenClawEnvPrefix,
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

  // Get gateway port from openclaw.json (runtimeProfile)
  // overrideProfile: 當 runtimeProfile hook state 尚未載入時可提供備援資料（例如 App 啟動時序問題）
  const getGatewayPort = (overrideProfile?: any): number | null => {
    const source = overrideProfile ?? runtimeProfile;
    const raw = String(source?.gateway?.port ?? '').trim();
    if (!raw || !/^\d+$/.test(raw)) return null;
    const port = Number(raw);
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
  };

  // Check if gateway is listening using lsof (returns null if port is unknown)
  const isGatewayListening = async (overrideProfile?: any): Promise<boolean | null> => {
    if (!window.electronAPI) return null;
    const port = getGatewayPort(overrideProfile);
    if (!port) return null;
    try {
      const res: any = await window.electronAPI.exec(`lsof -nP -iTCP:${port} -sTCP:LISTEN`);
      const code = res.code ?? res.exitCode;
      return code === 0 && !!String(res.stdout || '').trim();
    } catch {
      return null;
    }
  };

  const waitForGatewayListening = async (
    timeoutMs = 15000,
    intervalMs = 500,
  ): Promise<boolean> => {
    // If port is unknown, cannot verify; treat as success (managed by OpenClaw itself)
    if (getGatewayPort() === null) return true;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const listening = await isGatewayListening();
      if (listening === true) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
  };

  // overrideRuntimeProfile: 當 hook state 的 runtimeProfile 尚未載入完成時，
  // 可傳入 openclaw.json probe 的結果以取得正確的 gateway port 進行偵測。
  const syncGatewayStatus = async (overrideRuntimeProfile?: any) => {
    try {
      const listening = await isGatewayListening(overrideRuntimeProfile ?? undefined);
      if (listening !== null) {
        setRunning(listening);
      }
    } catch (_e) {
      void _e;
      // Gateway status check failed silently
    }
  };

  const stopGateway = async (options?: { killTerminalAndPortHolders?: boolean }) => {
    if (!window.electronAPI) {
      addLog(t('logs.commFailed', { msg: 'Electron API not available' }), 'stderr');
      return;
    }

    if (!config.corePath || !config.corePath.trim()) {
      addLog(t('logs.errors.missingCorePath'), 'stderr');
      return;
    }

    if (!config.configPath?.trim()) {
      addLog(t('logs.errors.missingConfigPath'), 'stderr');
      return;
    }

    addLog(t('logs.stoppingGateway'), 'system');
    try {
      await window.electronAPI.exec('gateway:watchdogs-stop').catch(() => {});
      const envPrefix = buildOpenClawEnvPrefix();
      const port = getGatewayPort();

      if (options?.killTerminalAndPortHolders) {
        if (port) {
          try {
            const killRes = await window.electronAPI.killPortHolder(port);
            if (killRes.success) {
              const allKilled = [...(killRes.killed || []), ...(killRes.forceKilled || [])];
              if (allKilled.length > 0) {
                addLog(t('logs.portKilled', { port, pids: Array.from(new Set(allKilled)).join(', ') }), 'system');
              }
            }
          } catch (e: any) {
            addLog(t('logs.errors.killPortError', { port, msg: e?.message || e }), 'stderr');
          }
        }

        await window.electronAPI.exec('process:kill-all').catch(() => {});
        const closeTerminalWindowsCmd = `osascript -e 'tell application "Terminal"' -e 'set targetWindows to {}' -e 'repeat with w in windows' -e 'set shouldClose to false' -e 'repeat with t in tabs of w' -e 'try' -e 'set tabText to (contents of t as text)' -e 'if tabText contains "${NT_CLAW_TERMINAL_MARKER_PREFIX}" then set shouldClose to true' -e 'end try' -e 'end repeat' -e 'if shouldClose then copy w to end of targetWindows' -e 'end repeat' -e 'repeat with w in targetWindows' -e 'try' -e 'close w' -e 'end try' -e 'end repeat' -e 'end tell'`;
        await window.electronAPI.exec(closeTerminalWindowsCmd).catch(() => {});
      }

      // In non-daemon + killTerminalAndPortHolders mode, the process is already killed by killPortHolder,
      // gateway stop only applies to daemon mode; skip to avoid redundant Terminal windows showing "service not loaded"
      const skipGatewayStop = options?.killTerminalAndPortHolders && !config.installDaemon;
      if (!skipGatewayStop) {
        const cmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway stop`;
        const resRaw: any = shouldUseExternalTerminal()
          ? await execInTerminal(cmd, {
              title: 'Stopping OpenClaw Gateway',
              holdOpen: false,
              cwd: config.corePath,
            })
          : await window.electronAPI.exec(cmd);
        const code = resRaw.code ?? resRaw.exitCode;

        if (code !== 0) {
          addLog(t('logs.stopGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
        }
      }

      setRunning(false);
      addLog(t('logs.gatewayStopped'), 'system');
    } catch (e: any) {
      addLog(t('logs.stopGatewayFailed', { msg: e.message }), 'stderr');
    }
  };

  const toggleGateway = async () => {
    if (!window.electronAPI) {
      addLog(t('logs.commFailed', { msg: 'Electron API not available' }), 'stderr');
      return;
    }

    if (!config.corePath || !config.corePath.trim()) {
      addLog(t('logs.errors.missingCorePath'), 'stderr');
      return;
    }

    if (!config.configPath || !config.configPath.trim()) {
      addLog(t('logs.warnings.missingConfigPath'), 'stderr');
    }

    if (running) {
      const useExternalTerminal = shouldUseExternalTerminal();
      await stopGateway({
        killTerminalAndPortHolders: useExternalTerminal && !config.installDaemon,
      });
      return;
    }

    addLog(t('logs.startingGateway'), 'system');
    try {
      const envPrefix = buildOpenClawEnvPrefix();
      const port = getGatewayPort();

      // Port conflict check before startup (only executed if port is set in openclaw.json)
      if (port) {
        const precheckRes: any = await window.electronAPI.exec(`lsof -nP -iTCP:${port} -sTCP:LISTEN`);
        const precheckCode = precheckRes.code ?? precheckRes.exitCode;
        const precheckOutput = String(precheckRes.stdout || '').trim();
        if (precheckCode === 0 && precheckOutput) {
          const message = t('logs.errors.portOccupied', { port });
          addLog(message, 'stderr');
          addLog(precheckOutput, 'stderr');
          setGatewayConflictActionMessage('');
          setKillingGatewayPortHolder(false);
          setGatewayConflictModal({ message, detail: precheckOutput, port });
          return;
        }
      }

      const checkDir = await window.electronAPI.exec(`test -d ${shellQuote(config.corePath)}`);
      if ((checkDir.code ?? checkDir.exitCode) !== 0) {
        addLog(t('logs.errors.corePathNotExist', { path: config.corePath }), 'stderr');
        return;
      }

      const useExternalTerminal = shouldUseExternalTerminal();
      let startCmd = '';
      if (useExternalTerminal) {
        startCmd = config.installDaemon
          ? `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway start`
          : `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway run --verbose --force`;

        await window.electronAPI.exec('gateway:watchdogs-stop').catch(() => {});

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
        await window.electronAPI.exec('gateway:watchdogs-stop').catch(() => {});
        const cmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway start`;
        const resRaw: any = await window.electronAPI.exec(cmd);
        const code = resRaw.code ?? resRaw.exitCode;
        if (code === 0) {
          addLog(t('logs.gatewayStartCmdSent'), 'system');
        } else {
          addLog(t('logs.startGatewayFailed', { msg: resRaw.stderr || `exit ${code}` }), 'stderr');
          return;
        }
      } else {
        await window.electronAPI.exec('gateway:watchdogs-stop').catch(() => {});
        const runCmd = `cd ${shellQuote(config.corePath)} && ${envPrefix}pnpm openclaw gateway run --verbose --force`;
        const payload = {
          command: runCmd,
          autoRestart: !!config.autoRestartGateway,
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

      const listening = await waitForGatewayListening();
      if (listening) {
        setRunning(true);
        addLog(t('logs.gatewayStarted'), 'system');

        if (useExternalTerminal && !config.installDaemon) {
          const healthCheckCommand = port ? `lsof -nP -iTCP:${port} -sTCP:LISTEN` : '';
          const watchdogPayload = {
            enabled: !!config.autoRestartGateway,
            healthCheckCommand,
            restartCommand: startCmd,
            intervalMs: 15000,
            failThreshold: 2,
            maxRestarts: 5,
            startupGraceMs: 20000,
            restartCooldownMs: 20000,
          };
          const wdRes: any = await window.electronAPI.exec(`gateway:http-watchdog-start-json ${JSON.stringify(watchdogPayload)}`);
          const wdCode = wdRes.code ?? wdRes.exitCode;
          if (wdCode === 0) {
            addLog(
              config.autoRestartGateway
                ? t('logs.watchdogEnabled')
                : t('logs.watchdogDisabled'),
              'system',
            );
          } else {
            addLog(t('logs.errors.watchdogFailed', { msg: wdRes.stderr || `exit ${wdCode}` }), 'stderr');
          }
        }
      } else {
        addLog(t('logs.errors.portNotListen'), 'stderr');
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
          ? t('logs.portForceKilled', {
              port: gatewayConflictModal.port,
              pids: uniqueKilled.join(', '),
              suffix: partialFailed ? t('logs.partialKillFailed') : ''
            })
          : t('logs.portKillAttempted', { port: gatewayConflictModal.port });
        setGatewayConflictActionMessage(successMsg);
        addLog(successMsg, partialFailed ? 'stderr' : 'system');
        window.setTimeout(() => {
          closeGatewayConflictModal();
        }, 350);
      } else {
        const errorMsg = result.error || t('logs.errors.portKillFailed', { port: gatewayConflictModal.port });
        setGatewayConflictActionMessage(errorMsg);
        addLog(errorMsg, 'stderr');
      }
    } catch (e: any) {
      const errorMsg = e?.message || t('logs.errors.portKillError', { port: gatewayConflictModal.port });
      setGatewayConflictActionMessage(errorMsg);
      addLog(errorMsg, 'stderr');
    } finally {
      setKillingGatewayPortHolder(false);
    }
  };

  return {
    toggleGateway,
    stopGateway,
    syncGatewayStatus,
    handleKillGatewayPortHolder,
  };
}
