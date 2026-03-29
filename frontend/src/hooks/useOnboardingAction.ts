import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { execInTerminal } from '../utils/terminal';
import { AUTH_CHOICE_PROVIDER_ALIASES } from '../constants/providers';
import { shellQuote } from '../utils/shell';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const SUPPORTED_AUTH_CHOICES = new Set(Object.keys(AUTH_CHOICE_PROVIDER_ALIASES));

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
  execute: (step: OnboardingStep, payload?: unknown) => Promise<boolean>;
  reset: () => void;
}

export const useOnboardingAction = (): UseOnboardingActionReturn => {
  const { t } = useTranslation();
  const { config, userType, setConfig } = useStore();
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<{ text: string; source: string; time: string }[]>([]);

  const hasOAuthProfile = (authChoice: string, rawConfig: string) => {
    const parsed = JSON.parse(rawConfig);
    const profiles = parsed?.auth?.profiles || {};
    const entries = Object.entries(profiles) as Array<[string, Record<string, unknown>]>;

    const aliases = AUTH_CHOICE_PROVIDER_ALIASES[authChoice] || [authChoice];
    return entries.some(([profileId, profile]) => {
      const provider = String(profile?.provider || '').toLowerCase();
      const mode = String(profile?.mode || '').toLowerCase();
      const id = String(profileId || '').toLowerCase();
      const providerMatched = aliases.some((alias) => provider === alias || id.includes(alias));
      const modeMatched = mode === 'oauth' || mode === 'token';
      return providerMatched && modeMatched;
    });
  };

  const isCommandSuccess = (res: { code?: number; exitCode?: number }) => res?.exitCode === 0 || res?.code === 0;

  const sanitizeSecret = (value: string) => String(value || '').replace(/\s+/g, '');

  const resolveProviderAliases = (authChoice: string) => {
    const key = String(authChoice || '').trim();
    return AUTH_CHOICE_PROVIDER_ALIASES[key] || [key];
  };

  const profileMatchesProvider = (profileId: string, profile: Record<string, unknown>, aliases: string[]) => {
    const provider = String(profile?.provider || '').toLowerCase();
    const id = String(profileId || '').toLowerCase();
    return aliases.some((alias) => {
      const normalizedAlias = String(alias || '').toLowerCase();
      return normalizedAlias && (provider === normalizedAlias || id.includes(normalizedAlias));
    });
  };

  const hasAgentCredential = (profile: Record<string, unknown>) => {
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
    const findRes = await window.electronAPI.exec(findCmd);
    if (!isCommandSuccess(findRes) || !findRes.stdout) {
      return null;
    }

    const profilePath = String(findRes.stdout || '').trim().split(/\r?\n/)[0] || '';
    if (!profilePath) return null;

    const readRes = await window.electronAPI.exec(`cat ${shellQuote(profilePath)}`);
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
      params.addLocalLog(t('onboarding.logs.skipAuthCheck'), 'system');
      return;
    }

    const aliases = resolveProviderAliases(params.authChoice);
    const parsed = await readOpenClawConfig(params.configPath);
    const globalProfiles = parsed?.auth?.profiles || {};
    const globalEntries = Object.entries(globalProfiles) as Array<[string, Record<string, unknown>]>;
    const hasGlobalProfile = globalEntries.some(([profileId, profile]) => profileMatchesProvider(profileId, profile, aliases));
    if (!hasGlobalProfile) {
      throw new Error(t('onboarding.errors.globalProfileNotFound', { providers: aliases.join('/') }));
    }

    params.addLocalLog(t('onboarding.logs.globalProfileConfirmed'), 'system');

    const agentAuth = await readAgentAuthProfiles(params.configPath);
    if (!agentAuth) {
      throw new Error(t('onboarding.errors.agentAuthNotFound'));
    }

    const agentProfiles = agentAuth.parsed?.profiles || {};
    const agentEntries = Object.entries(agentProfiles) as Array<[string, Record<string, unknown>]>;
    const matchedAgentEntry = agentEntries.find(([profileId, profile]) => profileMatchesProvider(profileId, profile, aliases));
    if (!matchedAgentEntry) {
      throw new Error(
        t('onboarding.errors.agentProfileNotFound', { path: agentAuth.profilePath, providers: aliases.join('/') }),
      );
    }

    const [agentProfileId, agentProfile] = matchedAgentEntry;
    const credentialCheck = hasAgentCredential(agentProfile);
    if (!credentialCheck.ok) {
      if (credentialCheck.reason === 'token_whitespace') {
        throw new Error(
          t('onboarding.errors.tokenWhitespace', { id: agentProfileId }),
        );
      }
      throw new Error(
        t('onboarding.errors.tokenMissing', { id: agentProfileId }),
      );
    }

    params.addLocalLog(t('onboarding.logs.agentProfileAvailable', { id: agentProfileId }), 'system');
  };

  const verifyAnyDualLayerAuthPersistence = async (params: {
    configPath: string;
    addLocalLog: (text: string, source?: string) => void;
  }) => {
    const parsed = await readOpenClawConfig(params.configPath);
    const globalProfiles = parsed?.auth?.profiles || {};
    const globalEntries = Object.entries(globalProfiles) as Array<[string, Record<string, unknown>]>;
    if (globalEntries.length === 0) {
      throw new Error(t('onboarding.errors.globalProfilesEmpty'));
    }

    const agentAuth = await readAgentAuthProfiles(params.configPath);
    if (!agentAuth) {
      throw new Error(t('onboarding.errors.agentAuthNotFoundShort'));
    }

    const agentProfiles = agentAuth.parsed?.profiles || {};
    const agentEntries = Object.entries(agentProfiles) as Array<[string, Record<string, unknown>]>;
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
        t('onboarding.errors.dualLayerMismatch', { path: agentAuth.profilePath }),
      );
    }

    params.addLocalLog(t('onboarding.logs.dualLayerConfirmed'), 'system');
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
      throw new Error(t('onboarding.errors.minimaxApiKeyEmpty'));
    }

    const expectedBaseUrl =
      params.authChoice === 'minimax-coding-plan-cn-token'
        ? 'https://api.minimaxi.com/anthropic'
        : 'https://api.minimax.io/anthropic';

    if (!baseUrl || baseUrl !== expectedBaseUrl) {
      throw new Error(
        t('onboarding.errors.minimaxBaseUrlMismatch', { expected: expectedBaseUrl, current: baseUrl || '(empty)' }),
      );
    }

    params.addLocalLog(t('onboarding.logs.minimaxTokenConfirmed', { url: expectedBaseUrl }), 'system');
  };

  const resolveExecCmd = async (corePath: string): Promise<string> => {
    const hasPnpmLock = await window.electronAPI.exec(`test -f ${shellQuote(`${corePath}/pnpm-lock.yaml`)}`);
    if (isCommandSuccess(hasPnpmLock)) return 'pnpm';

    const hasNpmLock = await window.electronAPI.exec(`test -f ${shellQuote(`${corePath}/package-lock.json`)}`);
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
      const readRes = await window.electronAPI.exec('config:read');
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
      const detectRes = await window.electronAPI.exec('detect:paths');
      if (isCommandSuccess(detectRes) && detectRes.stdout) {
        try {
          const detected = JSON.parse(detectRes.stdout);
          // Use the top-level detected value directly; already correctly calculated by Electron
          // Avoid extracting fields from existingConfig to prevent name mismatch (workspace vs workspacePath)
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
      const mergedConfig = { ...config, ...pathPatch };
      try {
        const persistRes = await window.electronAPI.exec(`config:write ${JSON.stringify(mergedConfig)}`);
        addLocalLog(`[resolveRuntimePaths] Persisted recovered paths: corePath=${mergedConfig.corePath}, configPath=${mergedConfig.configPath}, workspacePath=${mergedConfig.workspacePath}`, 'system');
        if (persistRes.code !== 0) {
          addLocalLog(`[WARNING] config:write returned non-zero: ${persistRes.stderr || 'Unknown error'}`, 'stderr');
        }
      } catch (e) {
        addLocalLog(`[ERROR] config:write failed: ${String(e)}`, 'stderr');
        // Runtime recovery should proceed even if persistence fails.
      }
    }

    addLocalLog(`[resolveRuntimePaths] Final resolved: corePath=${runtimePaths.corePath}, configPath=${runtimePaths.configPath}, workspacePath=${runtimePaths.workspacePath}`, 'system');
    return runtimePaths;
  };

  const readOpenClawConfig = async (configPath: string) => {
    const configFile = `${configPath}/openclaw.json`;
    const res = await window.electronAPI.exec(`cat ${shellQuote(configFile)}`);
    if (!isCommandSuccess(res) || !res.stdout) {
      throw new Error(t('onboarding.errors.readConfigFailed'));
    }
    return JSON.parse(res.stdout);
  };

  const resolveGatewayStatusError = (rawError: string) => {
    const message = String(rawError || '');
    const commandHint = 'openclaw gateway status --deep';
    if (/device signature invalid|signature invalid|1008/i.test(message)) {
      return t('onboarding.errors.gatewaySignatureInvalid', { hint: commandHint });
    }
    if (/auth_token_mismatch|token mismatch|unauthorized/i.test(message)) {
      return t('onboarding.errors.gatewayTokenMismatch');
    }
    return message || t('onboarding.errors.gatewayStatusCheckFailed');
  };

  const verifyLaunchReadiness = async (corePath: string, envPrefix: string, execCmd: string, addLocalLog: (text: string, source?: string) => void) => {
    addLocalLog(t('onboarding.logs.securityModeEnabled'), 'system');

    addLocalLog(t('onboarding.logs.checkingCli'), 'system');
    const versionRes = await window.electronAPI.exec(`cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw --version`);
    if (!isCommandSuccess(versionRes)) {
      throw new Error(versionRes.stderr || t('onboarding.errors.cliNotStarted'));
    }
    addLocalLog(t('onboarding.logs.cliReady'), 'system');

    addLocalLog(t('onboarding.logs.pulseCheck'), 'system');

    // Read gateway.port from openclaw.json to dynamically build --url parameter
    const configPath = String(config.configPath || '').trim();
    let gatewayStatusCmd = `cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw gateway status`;
    if (configPath) {
      try {
        const openclawData = await readOpenClawConfig(configPath);
        const gatewayPort = openclawData?.gateway?.port;
        if (gatewayPort && /^\d+$/.test(String(gatewayPort))) {
          const gatewayUrl = `ws://127.0.0.1:${gatewayPort}`;
          gatewayStatusCmd = `cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw gateway status --url ${shellQuote(gatewayUrl)}`;
        }
      } catch {
        // If reading fails, omit --url and let OpenClaw use the default value
      }
    }

    const gatewayRes = await window.electronAPI.exec(gatewayStatusCmd);
    if (!isCommandSuccess(gatewayRes)) {
      const gatewayErr = gatewayRes.stderr || gatewayRes.stdout || '';
      if (/device signature invalid|signature invalid|1008/i.test(gatewayErr)) {
        addLocalLog(t('onboarding.logs.gatewaySignatureMismatchWarning'), 'stderr');
        return;
      }
      throw new Error(resolveGatewayStatusError(gatewayErr));
    }
    addLocalLog(t('onboarding.logs.gatewayConnected'), 'system');
  };

  const runDoctorPreflight = async (params: {
    corePath: string;
    envPrefix: string;
    execCmd: string;
    addLocalLog: (text: string, source?: string) => void;
    expectedChannel?: string;
  }) => {
    params.addLocalLog(t('onboarding.logs.runningDoctor'), 'system');
    const doctorCmd = `cd ${shellQuote(params.corePath)} && ${params.envPrefix}${params.execCmd} openclaw doctor --non-interactive`;
    const doctorRes = await window.electronAPI.exec(doctorCmd);
    const doctorOutput = `${doctorRes?.stdout || ''}\n${doctorRes?.stderr || ''}`;

    if (!isCommandSuccess(doctorRes)) {
      throw new Error(doctorRes?.stderr || doctorRes?.stdout || t('onboarding.errors.doctorCheckFailed'));
    }

    const riskyChannelMatches = Array.from(
      doctorOutput.matchAll(
        /channels\.(whatsapp|irc|signal|imessage)(?:\.[a-z0-9_.-]+)?\.groupPolicy is "allowlist" but groupAllowFrom(?: \(and allowFrom\))? is empty/gi,
      ),
    ).map((entry) => String(entry[1] || '').toLowerCase());

    if (riskyChannelMatches.length === 0) {
      params.addLocalLog(t('onboarding.logs.doctorPassed'), 'system');
      return;
    }

    const uniqueRiskyChannels = Array.from(new Set(riskyChannelMatches));
    const hasExpectedChannelRisk = params.expectedChannel
      ? uniqueRiskyChannels.includes(params.expectedChannel.toLowerCase())
      : true;

    params.addLocalLog(
      t('onboarding.logs.doctorRiskDetected', { channels: uniqueRiskyChannels.join(', ') }),
      'stderr',
    );

    if (hasExpectedChannelRisk) {
      throw new Error(
        t('onboarding.errors.channelSetupIncomplete', { channel: params.expectedChannel }),
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
      const res = await window.electronAPI.exec(`cat ${shellQuote(configFile)}`);
      if (isCommandSuccess(res) && res.stdout) {
        try {
          if (hasOAuthProfile(params.authChoice, res.stdout)) {
            return true;
          }
        } catch {
          if (!parseWarningLogged) {
            params.addLocalLog?.(t('onboarding.logs.oauthConfigUpdating'), 'stderr');
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

  const execute = async (step: OnboardingStep, _payload?: unknown): Promise<boolean> => {
    setExecuting(true);
    setError(null);
    setLogs([]);

    try {
      const runtimePaths = await resolveRuntimePaths();
      const corePath = runtimePaths.corePath;
      const configPath = runtimePaths.configPath;
      const workspacePath = runtimePaths.workspacePath;
      if (!corePath) throw new Error(t('onboarding.errors.corePathMissing'));

      const selectedAuthChoice = String(config.authChoice || '').trim();
      if (step === 'model' && userType !== 'existing' && !SUPPORTED_AUTH_CHOICES.has(selectedAuthChoice)) {
        throw new Error(t('onboarding.errors.unsupportedAuthType', { type: selectedAuthChoice || 'unknown' }));
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
        const migrateRes = await window.electronAPI.exec(`config:migrate-openclaw ${JSON.stringify(migratePayload)}`);
        if (!isCommandSuccess(migrateRes)) {
          addLocalLog(t('onboarding.logs.migrateConfigFailed'), 'stderr');
        }
        if (isolatedAgentDir) {
          addLocalLog(t('onboarding.logs.isolatedAgentEnabled', { path: isolatedAgentDir }), 'system');
        }
      }

      if (userType === 'existing') {
        switch (step) {
          case 'model': {
            addLocalLog(t('onboarding.logs.verifyingExistingAuth'), 'system');
            if (!configPath) throw new Error(t('onboarding.errors.configPathMissing'));
            if (CREDENTIALLESS_AUTH_CHOICES.has(selectedAuthChoice)) {
              addLocalLog(t('onboarding.logs.credentiallessSkip'), 'system');
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
            addLocalLog(t('onboarding.logs.verifyingExistingChannels'), 'system');
            if (!configPath) throw new Error(t('onboarding.errors.configPathMissingForChannels'));
            const parsed = await readOpenClawConfig(configPath);
            const channels = parsed?.channels;
            const hasAnyChannel = channels && typeof channels === 'object' && Object.keys(channels).length > 0;
            if (!hasAnyChannel) throw new Error(t('onboarding.errors.noChannelsConfigured'));
            const selectedPlatform = String(config.platform || '').trim().toLowerCase();
            if (selectedPlatform) {
              const selectedChannel = (channels as Record<string, unknown>)?.[selectedPlatform];
              const hasSelectedChannel =
                !!selectedChannel &&
                (typeof selectedChannel !== 'object' || Object.keys(selectedChannel).length > 0);
              if (!hasSelectedChannel) {
                throw new Error(t('onboarding.errors.channelNotConfigured', { platform: selectedPlatform }));
              }
              // Verify enabled=true
              if (typeof selectedChannel === 'object' && selectedChannel !== null && (selectedChannel as Record<string, unknown>).enabled === false) {
                throw new Error(t('onboarding.errors.channelDisabled', { platform: selectedPlatform }));
              }
              // Verify token is non-empty (whatsapp/irc/signal/imessage don't need tokens, skip)
              const tokenlessChannels = new Set(['whatsapp', 'irc', 'signal', 'imessage']);
              if (!tokenlessChannels.has(selectedPlatform) && typeof selectedChannel === 'object') {
                const channelTokenKey = selectedPlatform === 'googlechat' ? 'webhookUrl' : 'botToken';
                const storedToken = String(((selectedChannel as Record<string, unknown>)[channelTokenKey]) || '').trim();
                if (!storedToken) {
                  addLocalLog(t('onboarding.logs.channelTokenEmpty', { platform: selectedPlatform, key: channelTokenKey }), 'stderr');
                }
              }
            }
            break;
          }
          case 'launch': {
            addLocalLog(t('onboarding.logs.finalVerification'), 'system');
            if (config.installDaemon) {
              await verifyLaunchReadiness(corePath, envPrefix, execCmd, addLocalLog);
            } else {
              // When installDaemon=false, Gateway isn't started yet (manual start from dashboard); only verify CLI availability
              const versionRes = await window.electronAPI.exec(
                `cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw --version`
              );
              if (!isCommandSuccess(versionRes)) {
                throw new Error(versionRes.stderr || t('onboarding.errors.cliNotStarted'));
              }
              addLocalLog(t('onboarding.logs.cliReadyManualGateway'), 'system');
            }
            break;
          }
          case 'skills': {
            addLocalLog(t('onboarding.logs.existingSkillsNoChange'), 'system');
            break;
          }
        }

        addLocalLog(t('onboarding.logs.executionSuccess'), 'system');
        setExecuting(false);
        return true;
      }

      // [Strategy Pattern]: New project behavior - executing physical CLI commands
      switch (step) {
        case 'model': {
          addLocalLog(t('onboarding.logs.aligningSoul', { choice: selectedAuthChoice }), 'system');

          if (oauthAuthChoices.has(selectedAuthChoice)) {
            addLocalLog(t('onboarding.logs.oauthInteractiveNeeded'), 'system');
            const oauthProviderMap: Record<string, { provider: string; method?: string }> = {
              'openai-codex': { provider: 'openai-codex', method: 'oauth' },
              'google-gemini-cli': { provider: 'google-gemini-cli', method: 'oauth' },
              chutes: { provider: 'chutes', method: 'oauth' },
              'qwen-portal': { provider: 'qwen-portal', method: 'device' },
            };
            const oauthTarget = oauthProviderMap[selectedAuthChoice];
            if (!oauthTarget) {
              throw new Error(t('onboarding.errors.unsupportedOAuthType', { type: selectedAuthChoice }));
            }

            if (!configPath) {
              throw new Error(t('onboarding.errors.configPathMissingForOAuth'));
            }

            addLocalLog(t('onboarding.logs.cleanupOAuth', { provider: oauthTarget.provider, method: oauthTarget.method || 'default' }), 'system');
            await window.electronAPI.exec(
              `pkill -f ${shellQuote(`openclaw models auth login --provider ${oauthTarget.provider}`)} || true`,
            );

            if (selectedAuthChoice === 'openai-codex') {
              addLocalLog(t('onboarding.logs.cleanupOpenAICallback'), 'system');
              await window.electronAPI.exec(`lsof -nP -iTCP:1455 -sTCP:LISTEN -t | xargs -I{} kill -TERM {} 2>/dev/null || true`);
            }

            const providerFlag = `--provider ${shellQuote(oauthTarget.provider)}`;
            const methodFlag = oauthTarget.method ? ` --method ${shellQuote(oauthTarget.method)}` : '';
            const interactiveCmd = `${envPrefix}${execCmd} openclaw models auth login ${providerFlag}${methodFlag}`;
            const resRaw = await execInTerminal(interactiveCmd, {
              title: t('onboarding.oauthTitle'),
              holdOpen: true,
              cwd: corePath
            });
            const code = resRaw.code ?? (resRaw as { code: number; exitCode?: number }).exitCode;
            if (typeof code === 'number' && code !== 0) {
              throw new Error(resRaw.stderr || t('onboarding.errors.oauthFailed'));
            }

            addLocalLog(t('onboarding.logs.oauthStarted'), 'system');
            const oauthDone = await waitForOAuthCompletion({
              authChoice: selectedAuthChoice,
              configPath,
              addLocalLog,
            });
            if (!oauthDone) {
              throw new Error(t('onboarding.errors.oauthTimeout'));
            }

            await verifyDualLayerAuthPersistence({
              authChoice: selectedAuthChoice,
              configPath,
              addLocalLog,
            });
            addLocalLog(t('onboarding.logs.oauthCompleted'), 'system');
            break;
          }

          const sanitizedSecret = sanitizeSecret(config.apiKey || '');
          const secretChanged = Boolean(config.apiKey) && sanitizedSecret !== String(config.apiKey || '');
          if (secretChanged) {
            addLocalLog(t('onboarding.logs.whitespaceRemoved'), 'system');
          }

          if (selectedAuthChoice === 'token' && !sanitizedSecret) {
            throw new Error(t('onboarding.errors.setupTokenMissing'));
          }

          const addProfilePayload = {
            corePath,
            configPath,
            workspacePath,
            authChoice: selectedAuthChoice,
            secret: sanitizedSecret,
          };
          const addProfileRes = await window.electronAPI.exec(`auth:add-profile ${JSON.stringify(addProfilePayload)}`);
          if (!isCommandSuccess(addProfileRes)) {
            throw new Error(addProfileRes.stderr || t('onboarding.errors.coreAuthFailed'));
          }

          // New version of OpenClaw has removed `openclaw auth set`.
          // Non-OAuth flows now use auth:add-profile, with provider parameters mapped internally by authChoice,
          // and finally verified via dual-layer check for global/agent consistency.

          if (!configPath) {
            throw new Error(t('onboarding.errors.configPathMissingForVerification'));
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
          addLocalLog(t('onboarding.logs.aligningChannels', { platform: config.platform }), 'system');
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
            addLocalLog(t('onboarding.logs.channelNormalized', { raw: rawPlatform, canonical: platform }), 'system');
          }

          let channelFlags = '';
          if (config.botToken) {
            if (['telegram', 'line'].includes(platform)) {
              channelFlags = `--token ${shellQuote(config.botToken)}`;
            } else if (platform === 'slack') {
              channelFlags = `--bot-token ${shellQuote(config.botToken)}`;
              // Slack Socket Mode also requires an App-Level Token (xapp-...)
              const appToken = String(config.appToken || '').trim();
              if (appToken) {
                channelFlags += ` --app-token ${shellQuote(appToken)}`;
              }
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

            // Defer channel activation to the messaging step to avoid coupling auth/binding during initialization.
            if (platform) {
              const enableChannelCmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw config set channels.${platform}.enabled true --json`;
              const enableRes = await window.electronAPI.exec(enableChannelCmd);
              if (!isCommandSuccess(enableRes)) {
                addLocalLog(t('onboarding.logs.enableChannelFailed', { platform }), 'stderr');
              } else {
                addLocalLog(t('onboarding.logs.channelEnabled', { platform }), 'system');
              }
            }

          let lastErr = '';
          let success = false;
            let lastAttemptSummary = '';
          for (let i = 0; i < candidates.length; i++) {
            const channelId = candidates[i];
            if (!/^[a-z0-9-]+$/i.test(channelId)) {
              lastErr = t('onboarding.errors.unsafeChannelId', { id: channelId });
              break;
            }
            const channelCmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw channels add --channel ${shellQuote(channelId)} ${channelFlags}`;
            const res = await window.electronAPI.exec(channelCmd);
            if (isCommandSuccess(res)) {
              success = true;
              if (channelId !== platform) {
                addLocalLog(t('onboarding.logs.legacyChannelFallback', { id: channelId }), 'system');
              }
              break;
            }

            const errText = String(res?.stderr || res?.stdout || '');
              const exitCode = typeof res?.exitCode === 'number' ? res.exitCode : res?.code;
              const stderrText = shortenText(String(res?.stderr || ''));
              const stdoutText = shortenText(String(res?.stdout || ''));
              const detailErr = stderrText || stdoutText || errText;
              lastErr = detailErr || t('onboarding.errors.channelBindingFailed');
              lastAttemptSummary = `channel=${channelId}, exitCode=${String(exitCode ?? 'unknown')}`;
              addLocalLog(t('onboarding.logs.channelAddFailed', { summary: lastAttemptSummary }), 'stderr');
              if (stderrText) addLocalLog(`stderr: ${stderrText}`, 'stderr');
              if (stdoutText && stdoutText !== stderrText) addLocalLog(`stdout: ${stdoutText}`, 'stderr');
              const unknownChannel = /unknown channel/i.test(detailErr);
            if (unknownChannel && i < candidates.length - 1) {
              addLocalLog(t('onboarding.logs.unsupportedChannelRetry', { id: channelId }), 'system');
              continue;
            }
            break;
          }

          // config set fallback: if channels add returns "Unknown channel" due to plugin registry bug, write botToken/webhookUrl directly
          if (!success && config.botToken) {
            const directConfigKeyMap: Record<string, string> = {
              telegram: 'botToken',
              discord: 'botToken',
              line: 'botToken',
              googlechat: 'webhookUrl',
            };
            const directKey = directConfigKeyMap[platform];
            const hadUnknownChannel = /unknown channel/i.test(lastErr || '');
            if (directKey && hadUnknownChannel) {
              addLocalLog(t('onboarding.logs.pluginRegistryFallback'), 'system');
              const safeToken = shellQuote(JSON.stringify(config.botToken));
              const configSetCmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw config set channels.${platform}.${directKey} ${safeToken} --json`;
              const configSetRes = await window.electronAPI.exec(configSetCmd);
              if (isCommandSuccess(configSetRes)) {
                success = true;
                addLocalLog(t('onboarding.logs.configSetDirectSuccess', { platform, key: directKey }), 'system');
              } else {
                const fbErr = shortenText(String(configSetRes?.stderr || configSetRes?.stdout || ''));
                if (fbErr) addLocalLog(t('onboarding.logs.configSetFallbackFailed', { err: fbErr }), 'stderr');
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
                  t('onboarding.errors.unsupportedChannelDeep', { id: unknownId, path: corePath }),
                  t('onboarding.errors.lastAttempt', { summary: lastAttemptSummary || 'unknown' }),
                  t('onboarding.errors.cliError', { err: lastErr || 'unknown channel' })
                ].join(' ')
              );
            }
            throw new Error(
              [
                t('onboarding.errors.channelBindingFailedShort'),
                t('onboarding.errors.lastAttempt', { summary: lastAttemptSummary || 'unknown' }),
                t('onboarding.errors.cliError', { err: lastErr || 'no stderr/stdout returned' })
              ].join(' ')
            );
          }

          const channelsRequireSafeGroupDefault = new Set(['whatsapp', 'irc', 'signal', 'imessage']);
          if (channelsRequireSafeGroupDefault.has(platform)) {
            addLocalLog(t('onboarding.logs.applyingGroupPolicy', { platform }), 'system');
            const setPolicyCmd = `${cdCorePath} && ${envPrefix}${execCmd} openclaw config set channels.${platform}.groupPolicy ${shellQuote('"open"')} --json`;
            const setPolicyRes = await window.electronAPI.exec(setPolicyCmd);
            if (!isCommandSuccess(setPolicyRes)) {
              addLocalLog(
                t('onboarding.logs.applyGroupPolicyFailed', { platform }),
                'stderr',
              );
            } else {
              addLocalLog(t('onboarding.logs.groupPolicyApplied', { platform }), 'system');
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
          // As per latest architectural decision, enabledSkills has been removed from config.
          // Skills are now handled via direct filesystem installation/deletion actions.
          addLocalLog(t('onboarding.logs.skillsHandledByFilesystem'), 'system');
          setExecuting(false);
          return true;
        }

        case 'launch': {
          addLocalLog(t('onboarding.logs.finalVerification'), 'system');

          // The final step doesn't install a daemon; Gateway is manually started from the dashboard.
          addLocalLog(t('onboarding.logs.daemonDisabled'), 'system');
          const versionRes = await window.electronAPI.exec(
            `cd ${shellQuote(corePath)} && ${envPrefix}${execCmd} openclaw --version`
          );
          if (!isCommandSuccess(versionRes)) {
            throw new Error(versionRes.stderr || t('onboarding.errors.cliNotStarted'));
          }
          addLocalLog(t('onboarding.logs.cliReadyManualGateway'), 'system');
          break;
        }
      }

      addLocalLog(t('onboarding.logs.executionSuccess'), 'system');
      setExecuting(false);
      return true;

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      addLocalLog(t('onboarding.logs.executionException', { msg: err instanceof Error ? err.message : String(err) }), 'stderr');
      setExecuting(false);
      return false;
    }
  };

  return { executing, error, logs, execute, reset };
};
