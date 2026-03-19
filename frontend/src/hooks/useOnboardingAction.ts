import { useState, useCallback } from 'react';
import { useStore } from '../store';
import { execInTerminal } from '../utils/terminal';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shellQuote = (value: string) => `'${String(value).replace(/'/g, `'\\''`)}'`;

const DEFAULT_AGENT_ID = 'main';

const resolveIsolatedAgentDir = (configPath: string, agentId: string = DEFAULT_AGENT_ID) => {
  const normalizedConfigPath = String(configPath || '').trim().replace(/[\\/]+$/, '');
  const normalizedAgentId = String(agentId || DEFAULT_AGENT_ID).trim() || DEFAULT_AGENT_ID;
  if (!normalizedConfigPath) return '';
  return `${normalizedConfigPath}/agents/${normalizedAgentId}/agent`;
};

const shortenText = (value: string, maxLen: number = 1200) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)} ...(truncated)`;
};

const SUPPORTED_AUTH_CHOICES = new Set([
  'apiKey',
  'token',
  'openai-api-key',
  'openai-codex',
  'gemini-api-key',
  'google-gemini-cli',
  'minimax-api',
  'minimax-coding-plan-global-token',
  'minimax-coding-plan-cn-token',
  'moonshot-api-key',
  'openrouter-api-key',
  'xai-api-key',
  'ollama',
  'vllm',
  'chutes',
  'qwen-portal'
]);

const AUTH_CHOICE_PROVIDER_ALIASES: Record<string, string[]> = {
  apiKey: ['anthropic'],
  token: ['anthropic'],
  'openai-api-key': ['openai'],
  'openai-codex': ['openai-codex', 'openai'],
  'gemini-api-key': ['gemini', 'google'],
  'google-gemini-cli': ['google-gemini-cli', 'google-gemini', 'gemini', 'google'],
  'minimax-api': ['minimax'],
  'minimax-coding-plan-global-token': ['minimax-portal', 'minimax'],
  'minimax-coding-plan-cn-token': ['minimax-portal', 'minimax'],
  'moonshot-api-key': ['moonshot'],
  'openrouter-api-key': ['openrouter'],
  'xai-api-key': ['xai'],
  'ollama': ['ollama'],
  'vllm': ['vllm'],
  'chutes': ['chutes'],
  'qwen-portal': ['qwen-portal', 'qwen']
};

const CREDENTIALLESS_AUTH_CHOICES = new Set(['ollama', 'vllm']);
const DIRECT_MINIMAX_TOKEN_CHOICES = new Set([
  'minimax-coding-plan-global-token',
  'minimax-coding-plan-cn-token',
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
      'qwen-portal': ['qwen-portal', 'qwen']
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

  const sanitizeSecret = (value: string) => String(value || '').replace(/\s+/g, '');

  const resolveProviderAliases = (authChoice: string) => {
    const key = String(authChoice || '').trim();
    return AUTH_CHOICE_PROVIDER_ALIASES[key] || [key];
  };

  const profileMatchesProvider = (profileId: string, profile: any, aliases: string[]) => {
    const provider = String(profile?.provider || '').toLowerCase();
    const id = String(profileId || '').toLowerCase();
    return aliases.some((alias) => {
      const normalizedAlias = String(alias || '').toLowerCase();
      return normalizedAlias && (provider === normalizedAlias || id.includes(normalizedAlias));
    });
  };

  const hasAgentCredential = (profile: any) => {
    const token = String(profile?.token || '').trim();
    const access = String(profile?.access || '').trim();
    if (token) {
      return { ok: !/\s/.test(token), reason: /\s/.test(token) ? 'token_whitespace' : 'token' };
    }
    if (access) {
      return { ok: true, reason: 'oauth_access' };
    }
    return { ok: false, reason: 'missing' };
  };

  const readAgentAuthProfiles = async (configPath: string) => {
    const agentsDir = `${configPath}/agents`;
    const findCmd = `find ${shellQuote(agentsDir)} -type f -path '*/agent/auth-profiles.json' 2>/dev/null | head -1`;
    const findRes = await (window as any).electronAPI.exec(findCmd);
    if (!isCommandSuccess(findRes) || !findRes.stdout) {
      return null;
    }

    const profilePath = String(findRes.stdout || '').trim().split(/\r?\n/)[0] || '';
    if (!profilePath) return null;

    const readRes = await (window as any).electronAPI.exec(`cat ${shellQuote(profilePath)}`);
    if (!isCommandSuccess(readRes) || !readRes.stdout) {
      return null;
    }

    return {
      profilePath,
      parsed: JSON.parse(readRes.stdout),
    };
  };

  const verifyDualLayerAuthPersistence = async (params: {
    authChoice: string;
    configPath: string;
    addLocalLog: (text: string, source?: string) => void;
  }) => {
    if (CREDENTIALLESS_AUTH_CHOICES.has(String(params.authChoice || '').trim())) {
      params.addLocalLog('ℹ️ 略過雙層憑證檢查：此授權類型不需要 token/profile。', 'system');
      return;
    }

    const aliases = resolveProviderAliases(params.authChoice);
    const parsed = await readOpenClawConfig(params.configPath);
    const globalProfiles = parsed?.auth?.profiles || {};
    const globalEntries = Object.entries(globalProfiles) as Array<[string, any]>;
    const hasGlobalProfile = globalEntries.some(([profileId, profile]) => profileMatchesProvider(profileId, profile, aliases));
    if (!hasGlobalProfile) {
      throw new Error(`授權設定未完成：openclaw.json 的 auth.profiles 找不到 ${aliases.join('/')} profile。`);
    }

    params.addLocalLog('✅ 已確認全域層 auth.profiles profile 指向。', 'system');

    const agentAuth = await readAgentAuthProfiles(params.configPath);
    if (!agentAuth) {
      throw new Error('授權設定未完成：找不到 agents/*/agent/auth-profiles.json，請重新執行模型授權。');
    }

    const agentProfiles = agentAuth.parsed?.profiles || {};
    const agentEntries = Object.entries(agentProfiles) as Array<[string, any]>;
    const matchedAgentEntry = agentEntries.find(([profileId, profile]) => profileMatchesProvider(profileId, profile, aliases));
    if (!matchedAgentEntry) {
      throw new Error(
        `授權設定未完成：已寫入全域 profile，但 agent 憑證層 (${agentAuth.profilePath}) 找不到 ${aliases.join('/')} 的有效 profile。`,
      );
    }

    const [agentProfileId, agentProfile] = matchedAgentEntry;
    const credentialCheck = hasAgentCredential(agentProfile);
    if (!credentialCheck.ok) {
      if (credentialCheck.reason === 'token_whitespace') {
        throw new Error(
          `授權設定異常：agent 憑證層 (${agentProfileId}) 的 token 含有空白字元，請重新貼上 API Key/Token。`,
        );
      }
      throw new Error(
        `授權設定未完成：agent 憑證層 (${agentProfileId}) 缺少 token/access，請重新執行授權流程。`,
      );
    }

    params.addLocalLog(`✅ 已確認 agent 憑證層 (${agentProfileId}) 可用。`, 'system');
  };

  const verifyAnyDualLayerAuthPersistence = async (params: {
    configPath: string;
    addLocalLog: (text: string, source?: string) => void;
  }) => {
    const parsed = await readOpenClawConfig(params.configPath);
    const globalProfiles = parsed?.auth?.profiles || {};
    const globalEntries = Object.entries(globalProfiles) as Array<[string, any]>;
    if (globalEntries.length === 0) {
      throw new Error('授權設定未完成：openclaw.json 的 auth.profiles 為空。');
    }

    const agentAuth = await readAgentAuthProfiles(params.configPath);
    if (!agentAuth) {
      throw new Error('授權設定未完成：找不到 agents/*/agent/auth-profiles.json。');
    }

    const agentProfiles = agentAuth.parsed?.profiles || {};
    const agentEntries = Object.entries(agentProfiles) as Array<[string, any]>;
    const matched = globalEntries.find(([globalProfileId, globalProfile]) => {
      const provider = String(globalProfile?.provider || '').toLowerCase();
      const profileId = String(globalProfileId || '').toLowerCase();
      return agentEntries.some(([agentProfileId, agentProfile]) => {
        const agentProvider = String(agentProfile?.provider || '').toLowerCase();
        const agentProfileKey = String(agentProfileId || '').toLowerCase();
        const providerMatched = Boolean(
          provider && (provider === agentProvider || agentProfileKey.includes(provider) || profileId.includes(agentProvider)),
        );
        if (!providerMatched) return false;
        return hasAgentCredential(agentProfile).ok;
      });
    });

    if (!matched) {
      throw new Error(
        `授權設定未完成：存在全域 auth.profiles，但在 ${agentAuth.profilePath} 找不到對應且可用的 agent 憑證。`,
      );
    }

    params.addLocalLog('✅ 已確認現有授權符合雙層可驗證（global + agent）。', 'system');
  };

  const verifyMiniMaxPortalTokenConfig = async (params: {
    authChoice: string;
    configPath: string;
    addLocalLog: (text: string, source?: string) => void;
  }) => {
    const parsed = await readOpenClawConfig(params.configPath);
    const provider = parsed?.models?.providers?.['minimax-portal'] || {};
    const apiKey = String(provider?.apiKey || '').trim();
    const baseUrl = String(provider?.baseUrl || '').trim();
    if (!apiKey) {
      throw new Error('MiniMax Coding Plan 設定失敗：models.providers.minimax-portal.apiKey 為空。');
    }

    const expectedBaseUrl =
      params.authChoice === 'minimax-coding-plan-cn-token'
        ? 'https://api.minimaxi.com/anthropic'
        : 'https://api.minimax.io/anthropic';

    if (!baseUrl || baseUrl !== expectedBaseUrl) {
      throw new Error(
        `MiniMax Coding Plan 設定失敗：minimax-portal.baseUrl 應為 ${expectedBaseUrl}，目前為 ${baseUrl || '(empty)'}`,
      );
    }

    params.addLocalLog(`✅ 已確認 MiniMax Coding Plan Token 設定 (${expectedBaseUrl})。`, 'system');
  };

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
    const hasAnyInlinePath = Boolean(runtimePaths.corePath || runtimePaths.configPath || runtimePaths.workspacePath);
    const allowPersistedRecovery = userType === 'existing' || !hasAnyInlinePath;

    const fillMissing = (incoming: { corePath?: string; configPath?: string; workspacePath?: string }) => {
      if (!runtimePaths.corePath && incoming.corePath) runtimePaths.corePath = String(incoming.corePath).trim();
      if (!runtimePaths.configPath && incoming.configPath) runtimePaths.configPath = String(incoming.configPath).trim();
      if (!runtimePaths.workspacePath && incoming.workspacePath) runtimePaths.workspacePath = String(incoming.workspacePath).trim();
    };

    if (allowPersistedRecovery && (!runtimePaths.corePath || !runtimePaths.configPath || !runtimePaths.workspacePath)) {
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

    if (
      allowPersistedRecovery
      && (!runtimePaths.corePath || !runtimePaths.configPath || !runtimePaths.workspacePath)
    ) {
      const detectRes = await (window as any).electronAPI.exec('detect:paths');
      if (isCommandSuccess(detectRes) && detectRes.stdout) {
        try {
          const detected = JSON.parse(detectRes.stdout);
          // 直接使用頂層的 detected 值，已經由 electron 正確計算過
          // 避免從 existingConfig 挖欄位導致欄位名稱不匹配 (workspace 而非 workspacePath)
          fillMissing({
            corePath: detected.corePath,
            configPath: detected.configPath,
            workspacePath: detected.workspacePath,
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
    const rawPort = String(config.gatewayPort || '').trim();
    const commandHint = /^\d+$/.test(rawPort)
      ? `openclaw gateway status --deep --url ws://127.0.0.1:${rawPort}`
      : 'Launcher 尚未設定有效 Gateway Port，請先於設定頁填入埠號後再檢查';
    if (/device signature invalid|signature invalid|1008/i.test(message)) {
      return [
        'Gateway 驗證失敗：偵測到裝置簽章不一致 (1008 / device signature invalid)。',
        `請先執行 ${commandHint} 檢查服務與配對狀態，必要時重啟 gateway 並重新配對裝置。`
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
    const rawPort = String(config.gatewayPort || '').trim();
    if (!/^\d+$/.test(rawPort)) {
      throw new Error('Launcher 尚未設定有效 Gateway Port，請先至設定頁填入埠號。');
    }
    const gatewayPort = Number(rawPort);
    const gatewayUrl = `ws://127.0.0.1:${gatewayPort}`;
    const gatewayRes = await (window as any).electronAPI.exec(
      `cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw gateway status --url ${shellQuote(gatewayUrl)}`,
    );
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
      if (step === 'model' && userType !== 'existing' && !SUPPORTED_AUTH_CHOICES.has(selectedAuthChoice)) {
        throw new Error(`不支援或不安全的授權類型: ${selectedAuthChoice || 'unknown'}`);
      }

      const execCmd = await resolveExecCmd(corePath);
      const stateDirEnv = configPath ? `OPENCLAW_STATE_DIR=${shellQuote(configPath)} ` : '';
      const configPathEnv = configPath ? `OPENCLAW_CONFIG_PATH=${shellQuote(`${configPath}/openclaw.json`)} ` : '';
      const isolatedAgentDir = configPath ? resolveIsolatedAgentDir(configPath) : '';
      const agentDirEnv = isolatedAgentDir ? `OPENCLAW_AGENT_DIR=${shellQuote(isolatedAgentDir)} ` : '';
      const legacyAgentDirEnv = isolatedAgentDir ? `PI_CODING_AGENT_DIR=${shellQuote(isolatedAgentDir)} ` : '';
      const envPrefix = `${stateDirEnv}${configPathEnv}${agentDirEnv}${legacyAgentDirEnv}`;
      const cdCorePath = `cd ${shellQuote(corePath)}`;
      const oauthAuthChoices = new Set([
        'openai-codex',
        'google-gemini-cli',
        'chutes',
        'qwen-portal'
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
        if (isolatedAgentDir) {
          addLocalLog(`🔒 已啟用專案隔離 agent store：${isolatedAgentDir}`, 'system');
        }
      }

      if (userType === 'existing') {
        switch (step) {
          case 'model': {
            addLocalLog('🧠 正在驗證現有模型授權設定...', 'system');
            if (!configPath) throw new Error('缺少 Config Path，無法驗證模型設定');
            if (CREDENTIALLESS_AUTH_CHOICES.has(selectedAuthChoice)) {
              addLocalLog('ℹ️ 目前模型為免憑證模式，略過雙層憑證檢查。', 'system');
              break;
            }
            if (DIRECT_MINIMAX_TOKEN_CHOICES.has(selectedAuthChoice)) {
              await verifyMiniMaxPortalTokenConfig({ authChoice: selectedAuthChoice, configPath, addLocalLog });
              break;
            }
            await verifyAnyDualLayerAuthPersistence({ configPath, addLocalLog });
            break;
          }
          case 'messaging': {
            addLocalLog('📡 正在驗證現有通訊頻道設定...', 'system');
            if (!configPath) throw new Error('缺少 Config Path，無法驗證頻道設定');
            const parsed = await readOpenClawConfig(configPath);
            const channels = parsed?.channels;
            const hasAnyChannel = channels && typeof channels === 'object' && Object.keys(channels).length > 0;
            if (!hasAnyChannel) throw new Error('找不到可用的通訊頻道設定');
            const selectedPlatform = String(config.platform || '').trim().toLowerCase();
            if (selectedPlatform) {
              const selectedChannel = (channels as any)?.[selectedPlatform];
              const hasSelectedChannel =
                !!selectedChannel &&
                (typeof selectedChannel !== 'object' || Object.keys(selectedChannel).length > 0);
              if (!hasSelectedChannel) {
                throw new Error(`目前選擇的通訊頻道未配置: ${selectedPlatform}`);
              }
            }
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

          if (oauthAuthChoices.has(selectedAuthChoice)) {
            addLocalLog('🔐 OAuth 授權需要互動式模式，將開啟終端機與瀏覽器流程。', 'system');
            const oauthProviderMap: Record<string, { provider: string; method?: string }> = {
              'openai-codex': { provider: 'openai-codex', method: 'oauth' },
              'google-gemini-cli': { provider: 'google-gemini-cli', method: 'oauth' },
              chutes: { provider: 'chutes', method: 'oauth' },
              'qwen-portal': { provider: 'qwen-portal', method: 'device' },
            };
            const oauthTarget = oauthProviderMap[selectedAuthChoice];
            if (!oauthTarget) {
              throw new Error(`不支援的 OAuth 授權類型: ${selectedAuthChoice}`);
            }

            if (!configPath) {
              throw new Error('找不到 Config Path，無法驗證 OAuth 授權狀態');
            }

            addLocalLog(`🧹 啟動前清理殘留 OAuth 流程 (${oauthTarget.provider}/${oauthTarget.method || 'default'})...`, 'system');
            await (window as any).electronAPI.exec(
              `pkill -f ${shellQuote(`openclaw models auth login --provider ${oauthTarget.provider}`)} || true`,
            );

            if (selectedAuthChoice === 'openai-codex') {
              addLocalLog('🧹 額外清理 OpenAI callback 埠 (127.0.0.1:1455)...', 'system');
              await (window as any).electronAPI.exec(`lsof -nP -iTCP:1455 -sTCP:LISTEN -t | xargs -I{} kill -TERM {} 2>/dev/null || true`);
            }

            const providerFlag = `--provider ${shellQuote(oauthTarget.provider)}`;
            const methodFlag = oauthTarget.method ? ` --method ${shellQuote(oauthTarget.method)}` : '';
            const interactiveCmd = `${envPrefix}${execCmd} openclaw models auth login ${providerFlag}${methodFlag}`;
            const resRaw: any = await execInTerminal(interactiveCmd, {
              title: 'OpenClaw OAuth 授權流程 (models auth login)',
              holdOpen: true,
              cwd: corePath
            });
            const code = resRaw.code ?? resRaw.exitCode;
            if (typeof code === 'number' && code !== 0) {
              throw new Error(resRaw.stderr || 'OAuth 授權失敗');
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

            await verifyDualLayerAuthPersistence({
              authChoice: selectedAuthChoice,
              configPath,
              addLocalLog,
            });
            addLocalLog('✅ OAuth 授權已完成，已寫入核心設定。', 'system');
            break;
          }

          const sanitizedSecret = sanitizeSecret(config.apiKey || '');
          const secretChanged = Boolean(config.apiKey) && sanitizedSecret !== String(config.apiKey || '');
          if (secretChanged) {
            addLocalLog('ℹ️ 偵測到授權字串包含空白，已自動移除空白字元再寫入。', 'system');
          }

          if (selectedAuthChoice === 'token' && !sanitizedSecret) {
            throw new Error('缺少 Setup-Token，請先貼上由 claude setup-token 產生的 Token');
          }

          const addProfilePayload = {
            corePath,
            configPath,
            workspacePath,
            authChoice: selectedAuthChoice,
            secret: sanitizedSecret,
          };
          const addProfileRes = await (window as any).electronAPI.exec(`auth:add-profile ${JSON.stringify(addProfilePayload)}`);
          if (!isCommandSuccess(addProfileRes)) {
            throw new Error(addProfileRes.stderr || '核心授權失敗');
          }

          // 新版 OpenClaw 已移除 `openclaw auth set`。
          // 非 OAuth 導引改為走 auth:add-profile，內部依 authChoice 映射 provider 參數，
          // 最終仍透過雙層檢查驗證 global + agent 是否一致。

          if (!configPath) {
            throw new Error('缺少 Config Path，無法驗證授權寫入結果');
          }

          if (DIRECT_MINIMAX_TOKEN_CHOICES.has(selectedAuthChoice)) {
            await verifyMiniMaxPortalTokenConfig({
              authChoice: selectedAuthChoice,
              configPath,
              addLocalLog,
            });
            break;
          }

          await verifyDualLayerAuthPersistence({
            authChoice: selectedAuthChoice,
            configPath,
            addLocalLog,
          });
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

            // 將 channel 啟用動作延後到 messaging 步驟，避免 initialize 階段耦合授權/綁定。
            if (platform) {
              const enableChannelCmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw config set channels.${platform}.enabled true --json`;
              const enableRes = await (window as any).electronAPI.exec(enableChannelCmd);
              if (!isCommandSuccess(enableRes)) {
                addLocalLog(`⚠️ 無法預先啟用 channels.${platform}.enabled=true，將直接嘗試綁定頻道。`, 'stderr');
              } else {
                addLocalLog(`✅ 已啟用 channels.${platform}.enabled=true`, 'system');
              }
            }

          let lastErr = '';
          let success = false;
            let lastAttemptSummary = '';
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
              const exitCode = typeof res?.exitCode === 'number' ? res.exitCode : res?.code;
              const stderrText = shortenText(String(res?.stderr || ''));
              const stdoutText = shortenText(String(res?.stdout || ''));
              const detailErr = stderrText || stdoutText || errText;
              lastErr = detailErr || '頻道繫結失敗';
              lastAttemptSummary = `channel=${channelId}, exitCode=${String(exitCode ?? 'unknown')}`;
              addLocalLog(`⚠️ channels add 失敗 (${lastAttemptSummary})`, 'stderr');
              if (stderrText) addLocalLog(`stderr: ${stderrText}`, 'stderr');
              if (stdoutText && stdoutText !== stderrText) addLocalLog(`stdout: ${stdoutText}`, 'stderr');
              const unknownChannel = /unknown channel/i.test(detailErr);
            if (unknownChannel && i < candidates.length - 1) {
              addLocalLog(`↻ Channel ID ${channelId} 不被支援，嘗試相容別名...`, 'system');
              continue;
            }
            break;
          }

          // config set fallback：channels add 因 plugin registry bug 回傳 "Unknown channel" → 直接寫入 botToken
          if (!success && config.botToken) {
            const directConfigKeyMap: Record<string, string> = {
              telegram: 'botToken',
              discord: 'botToken',
              line: 'botToken',
            };
            const directKey = directConfigKeyMap[platform];
            const hadUnknownChannel = /unknown channel/i.test(lastErr || '');
            if (directKey && hadUnknownChannel) {
              addLocalLog(`⚠️ channels add 遭遇 plugin registry 問題（Unknown channel），改以 config set 直接寫入...`, 'system');
              const safeToken = shellQuote(JSON.stringify(config.botToken));
              const configSetCmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw config set channels.${platform}.${directKey} ${safeToken} --json`;
              const configSetRes = await (window as any).electronAPI.exec(configSetCmd);
              if (isCommandSuccess(configSetRes)) {
                success = true;
                addLocalLog(`✅ 已透過 config set 直接寫入 channels.${platform}.${directKey}（繞過 plugin registry 問題）`, 'system');
              } else {
                const fbErr = shortenText(String(configSetRes?.stderr || configSetRes?.stdout || ''));
                if (fbErr) addLocalLog(`config-set fallback 失敗 stderr: ${fbErr}`, 'stderr');
                lastErr = fbErr || lastErr;
                lastAttemptSummary += ' (config-set-fallback-failed)';
              }
            }
          }

          if (!success) {
            const unknownMsg = /unknown channel\s*:\s*([a-z0-9-]+)/i.exec(lastErr || '');
            if (unknownMsg) {
              const unknownId = unknownMsg[1];
              throw new Error(
                [
                  `目前 OpenClaw 不支援 channel: ${unknownId}。`,
                  `請確認 Core Path 指向正確且可用的 OpenClaw（目前：${corePath}），並先在該目錄執行：pnpm openclaw channels add --help 檢查支援清單。`,
                  '若清單沒有 telegram，代表該安裝版本尚未支援 Telegram，需切換/升級 OpenClaw。',
                  `最後一次嘗試：${lastAttemptSummary || 'unknown'}`,
                  `CLI 原始錯誤：${lastErr || 'unknown channel'}`
                ].join(' ')
              );
            }
            throw new Error(
              [
                '頻道繫結失敗。',
                `最後一次嘗試：${lastAttemptSummary || 'unknown'}`,
                `CLI 原始錯誤：${lastErr || 'no stderr/stdout returned'}`
              ].join(' ')
            );
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

          // 最後一步固定不安裝 daemon，Gateway 由儀表板手動啟動。
          addLocalLog('ℹ️ 已停用 daemon 安裝流程，Gateway 將於儀表板手動啟動。', 'system');
          const versionRes = await (window as any).electronAPI.exec(
            `cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw --version`
          );
          if (!isCommandSuccess(versionRes)) {
            throw new Error(versionRes.stderr || 'OpenClaw CLI 無法啟動');
          }
          addLocalLog('✅ OpenClaw CLI 可正常執行，請於儀表板手動啟動 Gateway。', 'system');
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
