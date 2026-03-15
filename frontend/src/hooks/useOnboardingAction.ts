import { useState, useCallback } from 'react';
import { useStore } from '../store';
import { execInTerminal } from '../utils/terminal';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;

const SUPPORTED_AUTH_CHOICES = new Set([
  'apiKey',
  'token',
  'openai-api-key',
  'openai-codex',
  'gemini-api-key',
  'google-gemini-cli',
  'minimax-api',
  'minimax-portal',
  'moonshot-api-key',
  'openrouter-api-key',
  'xai-api-key',
  'ollama',
  'vllm',
  'chutes',
  'qwen-portal'
]);

export type OnboardingStep = 'model' | 'messaging' | 'skills' | 'launch';

interface UseOnboardingActionReturn {
  executing: boolean;
  error: string | null;
  logs: { text: string; source: string; time: string }[];
  execute: (step: OnboardingStep, payload?: any) => Promise<boolean>;
  reset: () => void;
}

export const useOnboardingAction = (): UseOnboardingActionReturn => {
  const { config, userType, setConfig } = useStore();
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ text: string; source: string; time: string }[]>([]);

  const hasOAuthProfile = (authChoice: string, rawConfig: string) => {
    const parsed = JSON.parse(rawConfig);
    const profiles = parsed?.auth?.profiles || {};
    const entries = Object.entries(profiles) as Array<[string, any]>;

    const providerAliases: Record<string, string[]> = {
      'openai-codex': ['openai-codex'],
      'google-gemini-cli': ['google-gemini-cli', 'google-gemini'],
      'chutes': ['chutes'],
      'qwen-portal': ['qwen-portal', 'qwen'],
      'minimax-portal': ['minimax-portal', 'minimax']
    };

    const aliases = providerAliases[authChoice] || [authChoice];
    return entries.some(([profileId, profile]) => {
      const provider = String(profile?.provider || '').toLowerCase();
      const mode = String(profile?.mode || '').toLowerCase();
      const id = String(profileId || '').toLowerCase();
      const providerMatched = aliases.some((alias) => provider === alias || id.includes(alias));
      const modeMatched = mode === 'oauth' || mode === 'token';
      return providerMatched && modeMatched;
    });
  };

  const isCommandSuccess = (res: any) => res?.exitCode === 0 || res?.code === 0;

  const resolveExecCmd = async (corePath: string): Promise<string> => {
    const hasPnpmLock = await (window as any).electronAPI.exec(`test -f ${shellQuote(`${corePath}/pnpm-lock.yaml`)}`);
    if (isCommandSuccess(hasPnpmLock)) return 'pnpm';

    const hasNpmLock = await (window as any).electronAPI.exec(`test -f ${shellQuote(`${corePath}/package-lock.json`)}`);
    if (isCommandSuccess(hasNpmLock)) return 'npm run';

    return 'pnpm';
  };

  const resolveRuntimePaths = async () => {
    const runtimePaths = {
      corePath: (config.corePath || '').trim(),
      configPath: (config.configPath || '').trim(),
      workspacePath: (config.workspacePath || '').trim(),
    };

    const fillMissing = (incoming: { corePath?: string; configPath?: string; workspacePath?: string }) => {
      if (!runtimePaths.corePath && incoming.corePath) runtimePaths.corePath = String(incoming.corePath).trim();
      if (!runtimePaths.configPath && incoming.configPath) runtimePaths.configPath = String(incoming.configPath).trim();
      if (!runtimePaths.workspacePath && incoming.workspacePath) runtimePaths.workspacePath = String(incoming.workspacePath).trim();
    };

    if (!runtimePaths.corePath || !runtimePaths.configPath || !runtimePaths.workspacePath) {
      const readRes = await (window as any).electronAPI.exec('config:read');
      if (isCommandSuccess(readRes) && readRes.stdout) {
        try {
          const saved = JSON.parse(readRes.stdout);
          fillMissing(saved || {});
        } catch {
          // Ignore malformed saved config.
        }
      }
    }

    if (!runtimePaths.corePath || !runtimePaths.configPath || !runtimePaths.workspacePath) {
      const detectRes = await (window as any).electronAPI.exec('detect:paths');
      if (isCommandSuccess(detectRes) && detectRes.stdout) {
        try {
          const detected = JSON.parse(detectRes.stdout);
          const existing = detected?.existingConfig || {};
          fillMissing({
            corePath: existing.corePath,
            configPath: existing.configPath,
            workspacePath: existing.workspacePath,
          });
        } catch {
          // Ignore malformed detect output.
        }
      }
    }

    const pathPatch: Partial<typeof config> = {};
    if (!config.corePath && runtimePaths.corePath) pathPatch.corePath = runtimePaths.corePath;
    if (!config.configPath && runtimePaths.configPath) pathPatch.configPath = runtimePaths.configPath;
    if (!config.workspacePath && runtimePaths.workspacePath) pathPatch.workspacePath = runtimePaths.workspacePath;

    if (Object.keys(pathPatch).length > 0) {
      setConfig(pathPatch);
      try {
        await (window as any).electronAPI.exec(`config:write ${JSON.stringify({ ...config, ...pathPatch })}`);
      } catch {
        // Runtime recovery should proceed even if persistence fails.
      }
    }

    return runtimePaths;
  };

  const readOpenClawConfig = async (configPath: string) => {
    const configFile = `${configPath}/openclaw.json`;
    const res = await (window as any).electronAPI.exec(`cat ${shellQuote(configFile)}`);
    if (!isCommandSuccess(res) || !res.stdout) {
      throw new Error('讀取 openclaw.json 失敗，請確認設定路徑正確');
    }
    return JSON.parse(res.stdout);
  };

  const resolveGatewayStatusError = (rawError: string) => {
    const message = String(rawError || '');
    if (/device signature invalid|signature invalid|1008/i.test(message)) {
      return [
        'Gateway 驗證失敗：偵測到裝置簽章不一致 (1008 / device signature invalid)。',
        '請先執行 openclaw gateway status --deep 檢查服務與配對狀態，必要時重啟 gateway 並重新配對裝置。'
      ].join(' ');
    }
    if (/auth_token_mismatch|token mismatch|unauthorized/i.test(message)) {
      return [
        'Gateway 驗證失敗：Token 不一致或已漂移。',
        '請確認 gateway.auth.token 並在控制台重新輸入，或依序執行 devices rotate/remove/approve 修復。'
      ].join(' ');
    }
    return message || 'Gateway 狀態檢查失敗';
  };

  const verifyLaunchReadiness = async (corePath: string, envPrefix: string, execCmd: string, addLocalLog: (text: string, source?: string) => void) => {
    addLocalLog('🧪 啟用安全驗證模式：不會自動啟動/覆寫既有 Gateway。', 'system');

    addLocalLog('🔍 正在檢查 CLI 可用性...', 'system');
    const versionRes = await (window as any).electronAPI.exec(`cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw --version`);
    if (!isCommandSuccess(versionRes)) {
      throw new Error(versionRes.stderr || 'OpenClaw CLI 無法啟動');
    }
    addLocalLog('✅ OpenClaw CLI 可正常執行。', 'system');

    addLocalLog('🔍 正在進行被動網關探測 (Gateway Pulse Check)...', 'system');
    const gatewayRes = await (window as any).electronAPI.exec(`cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw gateway status`);
    if (!isCommandSuccess(gatewayRes)) {
      const gatewayErr = gatewayRes.stderr || gatewayRes.stdout || '';
      if (/device signature invalid|signature invalid|1008/i.test(gatewayErr)) {
        addLocalLog('⚠️ 偵測到既有 Gateway 與目前設定的裝置簽章不一致（不影響既有服務，略過阻斷）。', 'stderr');
        return;
      }
      throw new Error(resolveGatewayStatusError(gatewayErr));
    }
    addLocalLog('✅ 網關服務連通性正常。', 'system');
  };

  const runDoctorPreflight = async (params: {
    corePath: string;
    envPrefix: string;
    execCmd: string;
    addLocalLog: (text: string, source?: string) => void;
    expectedChannel?: string;
  }) => {
    params.addLocalLog('🩺 正在執行導引前置檢查 (doctor --non-interactive)...', 'system');
    const doctorCmd = `cd ${shellQuote(params.corePath)} && ${params.envPrefix}${params.execCmd} openclaw doctor --non-interactive`;
    const doctorRes = await (window as any).electronAPI.exec(doctorCmd);
    const doctorOutput = `${doctorRes?.stdout || ''}\n${doctorRes?.stderr || ''}`;

    if (!isCommandSuccess(doctorRes)) {
      throw new Error(doctorRes?.stderr || doctorRes?.stdout || 'Doctor 檢查失敗');
    }

    const riskyChannelMatches = Array.from(
      doctorOutput.matchAll(
        /channels\.(whatsapp|irc|signal|imessage)(?:\.[a-z0-9_.-]+)?\.groupPolicy is "allowlist" but groupAllowFrom(?: \(and allowFrom\))? is empty/gi,
      ),
    ).map((entry) => String(entry[1] || '').toLowerCase());

    if (riskyChannelMatches.length === 0) {
      params.addLocalLog('✅ Doctor 前置檢查完成，未發現群組授權風險。', 'system');
      return;
    }

    const uniqueRiskyChannels = Array.from(new Set(riskyChannelMatches));
    const hasExpectedChannelRisk = params.expectedChannel
      ? uniqueRiskyChannels.includes(params.expectedChannel.toLowerCase())
      : true;

    params.addLocalLog(
      `⚠️ Doctor 偵測到群組授權風險：${uniqueRiskyChannels.join(', ')}`,
      'stderr',
    );

    if (hasExpectedChannelRisk) {
      throw new Error(
        `頻道設定尚未完成：channels.${params.expectedChannel}.groupPolicy=allowlist 但 groupAllowFrom 為空。請設定 groupAllowFrom，或改為 groupPolicy=open。`,
      );
    }
  };

  const waitForOAuthCompletion = async (params: {
    authChoice: string;
    configPath: string;
    addLocalLog?: (text: string, source?: string) => void;
    timeoutMs?: number;
    intervalMs?: number;
  }) => {
    const timeoutMs = params.timeoutMs ?? 300000;
    const intervalMs = params.intervalMs ?? 2000;
    const configFile = `${params.configPath}/openclaw.json`;
    const startedAt = Date.now();
    let parseWarningLogged = false;

    while (Date.now() - startedAt < timeoutMs) {
      const res = await (window as any).electronAPI.exec(`cat ${shellQuote(configFile)}`);
      if (isCommandSuccess(res) && res.stdout) {
        try {
          if (hasOAuthProfile(params.authChoice, res.stdout)) {
            return true;
          }
        } catch {
          if (!parseWarningLogged) {
            params.addLocalLog?.('⚠️ OAuth 設定檔仍在更新中，稍後會自動重試解析。', 'stderr');
            parseWarningLogged = true;
          }
        }
      }
      await sleep(intervalMs);
    }

    return false;
  };

  const addLocalLog = useCallback((text: string, source: string = 'system') => {
    setLogs(prev => [...prev.slice(-49), { text, source, time: new Date().toLocaleTimeString() }]);
  }, []);

  const reset = useCallback(() => {
    setExecuting(false);
    setError(null);
    setLogs([]);
  }, []);

  const execute = useCallback(async (step: OnboardingStep, _payload?: any): Promise<boolean> => {
    setExecuting(true);
    setError(null);
    setLogs([]);

    try {
      const runtimePaths = await resolveRuntimePaths();
      const corePath = runtimePaths.corePath;
      const configPath = runtimePaths.configPath;
      const workspacePath = runtimePaths.workspacePath;
      if (!corePath) throw new Error('缺少核心路徑 (Core Path missing)');

      const selectedAuthChoice = String(config.authChoice || '').trim();
      if (step === 'model' && !SUPPORTED_AUTH_CHOICES.has(selectedAuthChoice)) {
        throw new Error(`不支援或不安全的授權類型: ${selectedAuthChoice || 'unknown'}`);
      }

      const execCmd = await resolveExecCmd(corePath);
      const stateDirEnv = configPath ? `OPENCLAW_STATE_DIR=${shellQuote(configPath)} ` : '';
      const configPathEnv = configPath ? `OPENCLAW_CONFIG_PATH=${shellQuote(`${configPath}/openclaw.json`)} ` : '';
      const envPrefix = `${stateDirEnv}${configPathEnv}`;
      const cdCorePath = `cd ${shellQuote(corePath)}`;
      const oauthAuthChoices = new Set([
        'openai-codex',
        'google-gemini-cli',
        'chutes',
        'qwen-portal',
        'minimax-portal'
      ]);

      if (configPath) {
        const migratePayload = {
          configPath,
          workspacePath: workspacePath || ''
        };
        const migrateRes = await (window as any).electronAPI.exec(`config:migrate-openclaw ${JSON.stringify(migratePayload)}`);
        if (!isCommandSuccess(migrateRes)) {
          addLocalLog('⚠️ 設定檔修正失敗，將繼續嘗試執行。', 'stderr');
        }
      }

      if (userType === 'existing') {
        switch (step) {
          case 'model': {
            addLocalLog('🧠 正在驗證現有模型授權設定...', 'system');
            if (!configPath) throw new Error('缺少 Config Path，無法驗證模型設定');
            const parsed = await readOpenClawConfig(configPath);
            const hasProfiles = Object.keys(parsed?.auth?.profiles || {}).length > 0;
            if (!hasProfiles) throw new Error('找不到可用的模型授權設定 (auth.profiles)');
            break;
          }
          case 'messaging': {
            addLocalLog('📡 正在驗證現有通訊頻道設定...', 'system');
            if (!configPath) throw new Error('缺少 Config Path，無法驗證頻道設定');
            const parsed = await readOpenClawConfig(configPath);
            const channels = parsed?.channels;
            const hasAnyChannel = channels && typeof channels === 'object' && Object.keys(channels).length > 0;
            if (!hasAnyChannel) throw new Error('找不到可用的通訊頻道設定');
            break;
          }
          case 'launch': {
            addLocalLog('🚀 啟動最終發射檢查程序 (Final Verification)...', 'system');
            if (config.installDaemon) {
              await verifyLaunchReadiness(corePath, envPrefix, execCmd, addLocalLog);
            } else {
              // installDaemon=false 時 Gateway 尚未啟動（將從儀表板手動啟動），只驗證 CLI 可用性
              const versionRes = await (window as any).electronAPI.exec(
                `cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw --version`
              );
              if (!isCommandSuccess(versionRes)) {
                throw new Error(versionRes.stderr || 'OpenClaw CLI 無法啟動');
              }
              addLocalLog('✅ OpenClaw CLI 可正常執行，Gateway 將於儀表板手動啟動。', 'system');
            }
            break;
          }
          case 'skills': {
            addLocalLog('🛠️ 現有用戶技能設定維持不變。', 'system');
            break;
          }
        }

        addLocalLog('✅ 執行順利完成。', 'system');
        setExecuting(false);
        return true;
      }

      // [策略模式]：新建專案行為 - 執行實體 CLI 指令
      switch (step) {
        case 'model': {
          addLocalLog(`🧠 正在對齊靈魂頻率 (${selectedAuthChoice})...`, 'system');
          const workspaceFlag = workspacePath ? `--workspace ${shellQuote(workspacePath)}` : '';

          if (oauthAuthChoices.has(selectedAuthChoice)) {
            addLocalLog('🔐 OAuth 授權需要互動式模式，將開啟終端機與瀏覽器流程。', 'system');
            const interactiveCmd = `${envPrefix}${execCmd} openclaw onboard --auth-choice ${shellQuote(selectedAuthChoice)} ${workspaceFlag} --no-install-daemon --skip-daemon --skip-health --accept-risk`;
            const resRaw: any = await execInTerminal(interactiveCmd, {
              title: 'OpenClaw OAuth 授權流程',
              holdOpen: true,
              cwd: corePath
            });
            const code = resRaw.code ?? resRaw.exitCode;
            if (typeof code === 'number' && code !== 0) {
              throw new Error(resRaw.stderr || 'OAuth 授權失敗');
            }

            if (!configPath) {
              throw new Error('找不到 Config Path，無法驗證 OAuth 授權狀態');
            }

            addLocalLog('🌐 已啟動 OAuth 流程，等待授權完成...', 'system');
            const oauthDone = await waitForOAuthCompletion({
              authChoice: selectedAuthChoice,
              configPath,
              addLocalLog,
            });
            if (!oauthDone) {
              throw new Error('OAuth 授權逾時或未完成，請在彈出的終端機完成登入後重試');
            }

            addLocalLog('✅ OAuth 授權已完成，已寫入核心設定。', 'system');
            break;
          }

          const authFlagMapping: Record<string, string> = {
            'apiKey': '--anthropic-api-key',
            'openai-api-key': '--openai-api-key',
            'gemini-api-key': '--gemini-api-key',
            'minimax-api': '--minimax-api-key',
            'moonshot-api-key': '--moonshot-api-key',
            'openrouter-api-key': '--openrouter-api-key',
            'xai-api-key': '--xai-api-key'
          };

          let authFlags = '';
          if (selectedAuthChoice === 'token') {
            if (!config.apiKey) {
              throw new Error('缺少 Setup-Token，請先貼上由 claude setup-token 產生的 Token');
            }
            authFlags = `--token-provider anthropic --token ${shellQuote(config.apiKey)}`;
          } else if (config.apiKey) {
            const flag = authFlagMapping[selectedAuthChoice];
            if (!flag) {
              throw new Error(`不支援的授權參數映射: ${selectedAuthChoice || 'unknown'}`);
            }
            authFlags = `${flag} ${shellQuote(config.apiKey)}`;
          }
          const onboardCmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw onboard --auth-choice ${shellQuote(selectedAuthChoice)} ${authFlags} ${workspaceFlag} --no-install-daemon --skip-daemon --skip-health --non-interactive --accept-risk`;

          const res = await (window as any).electronAPI.exec(onboardCmd);
          if (!isCommandSuccess(res)) throw new Error(res.stderr || '核心授權失敗');
          break;
        }

        case 'messaging': {
          addLocalLog(`📡 正在封裝通訊波段 (${config.platform})...`, 'system');
          const rawPlatform = (config.platform || '').trim().toLowerCase();
          const platformCanonicalMap: Record<string, string> = {
            tg: 'telegram',
            'google-chat': 'googlechat',
            gchat: 'googlechat',
            imsg: 'imessage',
            'internet-relay-chat': 'irc'
          };
          const platform = platformCanonicalMap[rawPlatform] || rawPlatform;
          if (rawPlatform && rawPlatform !== platform) {
            addLocalLog(`ℹ️ Channel ID ${rawPlatform} 已正規化為 ${platform}。`, 'system');
          }

          let channelFlags = '';
          if (config.botToken) {
            if (['telegram', 'line'].includes(platform)) {
              channelFlags = `--token ${shellQuote(config.botToken)}`;
            } else if (platform === 'slack') {
              channelFlags = `--bot-token ${shellQuote(config.botToken)}`;
            } else if (platform === 'discord') {
              channelFlags = `--token ${shellQuote(config.botToken)}`;
            } else if (platform === 'googlechat') {
              channelFlags = `--webhook-url ${shellQuote(config.botToken)}`;
            }
          }

          const channelAliasCandidates: Record<string, string[]> = {
            telegram: ['telegram'],
            googlechat: ['googlechat', 'gchat', 'google-chat'],
            imessage: ['imessage', 'imsg'],
            whatsapp: ['whatsapp'],
            line: ['line'],
            discord: ['discord'],
            slack: ['slack'],
            signal: ['signal'],
            irc: ['irc', 'internet-relay-chat']
          };
          const candidates = channelAliasCandidates[platform] || [platform || config.platform];

          let lastErr = '';
          let success = false;
          for (let i = 0; i < candidates.length; i++) {
            const channelId = candidates[i];
            if (!/^[a-z0-9-]+$/i.test(channelId)) {
              lastErr = `不安全的 channel id: ${channelId}`;
              break;
            }
            const channelCmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw channels add --channel ${shellQuote(channelId)} ${channelFlags}`;
            const res = await (window as any).electronAPI.exec(channelCmd);
            if (isCommandSuccess(res)) {
              success = true;
              if (channelId !== platform) {
                addLocalLog(`ℹ️ 偵測到舊版 Channel ID，相容回退為 ${channelId}。`, 'system');
              }
              break;
            }

            const errText = String(res?.stderr || res?.stdout || '');
            lastErr = errText || '頻道繫結失敗';
            const unknownChannel = /unknown channel/i.test(errText);
            if (unknownChannel && i < candidates.length - 1) {
              addLocalLog(`↻ Channel ID ${channelId} 不被支援，嘗試相容別名...`, 'system');
              continue;
            }
            break;
          }

          if (!success) {
            const unknownMsg = /unknown channel\s*:\s*([a-z0-9-]+)/i.exec(lastErr || '');
            if (unknownMsg) {
              const unknownId = unknownMsg[1];
              throw new Error(
                [
                  `目前 OpenClaw 不支援 channel: ${unknownId}。`,
                  `請確認 Core Path 指向正確且可用的 OpenClaw（目前：${corePath}），並先在該目錄執行：pnpm openclaw channels add --help 檢查支援清單。`,
                  '若清單沒有 telegram，代表該安裝版本尚未支援 Telegram，需切換/升級 OpenClaw。'
                ].join(' ')
              );
            }
            throw new Error(lastErr || '頻道繫結失敗');
          }

          const channelsRequireSafeGroupDefault = new Set(['whatsapp', 'irc', 'signal', 'imessage']);
          if (channelsRequireSafeGroupDefault.has(platform)) {
            addLocalLog(`🛡️ 套用 ${platform} 群組授權預設策略 (groupPolicy=open)...`, 'system');
            const setPolicyCmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw config set channels.${platform}.groupPolicy ${shellQuote('"open"')} --json`;
            const setPolicyRes = await (window as any).electronAPI.exec(setPolicyCmd);
            if (!isCommandSuccess(setPolicyRes)) {
              addLocalLog(
                `⚠️ 無法自動套用 ${platform}.groupPolicy=open，將改由 doctor 前置檢查攔截。`,
                'stderr',
              );
            } else {
              addLocalLog(`✅ 已套用 channels.${platform}.groupPolicy="open"。`, 'system');
            }
          }

          await runDoctorPreflight({
            corePath,
            envPrefix,
            execCmd,
            addLocalLog,
            expectedChannel: platform,
          });
          break;
        }

        case 'skills': {
          const selectedSkills = config.enabledSkills || [];
          if (selectedSkills.length === 0) {
            addLocalLog('✨ 無需啟用額外技能。', 'system');
            setExecuting(false);
            return true;
          }
          addLocalLog(`🛠️ 正在啟用技能設定 (${selectedSkills.length} 項模組)...`, 'system');

          for (const skillId of selectedSkills) {
            addLocalLog(`> 正在啟用: ${skillId}...`, "system");
            if (!/^[a-z0-9_-]+$/i.test(skillId)) {
              addLocalLog(`⚠️ 跳過不安全的技能 ID: ${skillId}`, 'stderr');
              continue;
            }
            const cmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw config set skills.entries.${skillId}.enabled true`;
            const res = await (window as any).electronAPI.exec(cmd);
            if (!isCommandSuccess(res)) {
              addLocalLog(`⚠️ 模組 ${skillId} 啟用回報異常: ${res.stderr}`, "stderr");
            }
          }
          break;
        }

        case 'launch': {
          addLocalLog(`🚀 啟動最終發射檢查程序 (Final Verification)...`, 'system');

          if (config.installDaemon) {
            addLocalLog('🧩 依照設定安裝背景 Gateway 服務 (daemon)...', 'system');
            const workspaceFlag = workspacePath ? `--workspace ${shellQuote(workspacePath)}` : '';
            const installDaemonCmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw onboard --auth-choice skip ${workspaceFlag} --install-daemon --skip-health --non-interactive --accept-risk`;
            const daemonRes = await (window as any).electronAPI.exec(installDaemonCmd);
            if (!isCommandSuccess(daemonRes)) {
              throw new Error(daemonRes.stderr || '背景 Gateway 服務安裝失敗');
            }
            addLocalLog('✅ 背景 Gateway 服務安裝完成。', 'system');
            await verifyLaunchReadiness(corePath, envPrefix, execCmd, addLocalLog);
          } else {
            // installDaemon=false 時 Gateway 尚未啟動（將從儀表板手動啟動），只驗證 CLI 可用性
            addLocalLog('ℹ️ 目前設定為不安裝背景 Gateway 服務，Gateway 將於儀表板手動啟動。', 'system');
            const versionRes = await (window as any).electronAPI.exec(
              `cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw --version`
            );
            if (!isCommandSuccess(versionRes)) {
              throw new Error(versionRes.stderr || 'OpenClaw CLI 無法啟動');
            }
            addLocalLog('✅ OpenClaw CLI 可正常執行，請於儀表板手動啟動 Gateway。', 'system');
          }
          break;
        }
      }

      addLocalLog('✅ 執行順利完成。', 'system');
      setExecuting(false);
      return true;

    } catch (err: any) {
      setError(err.message);
      addLocalLog(`❌ 執行回報異常: ${err.message}`, 'stderr');
      setExecuting(false);
      return false;
    }
  }, [addLocalLog, config, resolveExecCmd, resolveRuntimePaths, setConfig, userType, verifyLaunchReadiness, waitForOAuthCompletion]);

  return { executing, error, logs, execute, reset };
};
