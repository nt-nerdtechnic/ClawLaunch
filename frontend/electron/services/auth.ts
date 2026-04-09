/** Auth 管理服務：OpenClaw config 解析、profile 健康診斷、auth choice 推斷。 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { t } from '../utils/i18n.js';

// ── Provider / Auth 常數 ───────────────────────────────────────────────────

// Choices that use a CLI flag to pass a credential to `openclaw onboard`.
// Add new API-key-based auth choices here AND in AUTH_CHOICE_PROVIDER_ALIASES.
// The `satisfies` constraint ensures every entry in this type has a flag mapped —
// adding to ApiKeyAuthChoice without a mapping entry is a compile error.
type ApiKeyAuthChoice =
  | 'apiKey'
  | 'openai-api-key'
  | 'gemini-api-key'
  | 'minimax-api'
  | 'moonshot-api-key'
  | 'openrouter-api-key'
  | 'xai-api-key';

export const AUTH_CHOICE_FLAG_MAPPING: Record<string, string> = {
  apiKey: '--anthropic-api-key',
  'openai-api-key': '--openai-api-key',
  'gemini-api-key': '--gemini-api-key',
  'minimax-api': '--minimax-api-key',
  'moonshot-api-key': '--moonshot-api-key',
  'openrouter-api-key': '--openrouter-api-key',
  'xai-api-key': '--xai-api-key',
} satisfies Record<ApiKeyAuthChoice, string>;

export const AUTH_CHOICE_PROVIDER_ALIASES: Record<string, string[]> = {
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
  ollama: ['ollama'],
  vllm: ['vllm'],
  chutes: ['chutes'],
  'qwen-portal': ['qwen-portal', 'qwen'],
};

export const SUPPORTED_AUTH_CHOICES = new Set(Object.keys(AUTH_CHOICE_PROVIDER_ALIASES));
export const CREDENTIALLESS_AUTH_CHOICES = new Set(['ollama', 'vllm']);
export const OAUTH_AUTH_CHOICES = new Set([
  'openai-codex',
  'google-gemini-cli',
  'chutes',
  'qwen-portal',
]);

export const providerAliasSets: Record<string, string[]> = {
  google: ['google', 'gemini'],
  gemini: ['gemini', 'google'],
  'google-gemini-cli': ['google-gemini-cli', 'google-gemini', 'gemini', 'google'],
  'google-gemini': ['google-gemini', 'google-gemini-cli', 'gemini', 'google'],
  anthropic: ['anthropic'],
  openai: ['openai', 'openai-codex'],
  'openai-codex': ['openai-codex', 'openai'],
  minimax: ['minimax', 'minimax-portal'],
  'minimax-portal': ['minimax-portal', 'minimax'],
  moonshot: ['moonshot'],
  openrouter: ['openrouter'],
  xai: ['xai'],
  ollama: ['ollama'],
  vllm: ['vllm'],
  chutes: ['chutes'],
  qwen: ['qwen', 'qwen-portal'],
  'qwen-portal': ['qwen-portal', 'qwen'],
};

// ── 純工具函式 ─────────────────────────────────────────────────────────────

export const sanitizeSecret = (value: string): string =>
  String(value || '').replace(/\s+/g, '');

export const hasCjkCharacters = (value: string): boolean =>
  /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(String(value || ''));

export const isLikelyNaturalLanguageSentence = (value: string): boolean => {
  const text = String(value || '').trim();
  if (!text) return false;
  const hasSentencePunctuation = /[\u3002\uff01\uff1f\uff1a\uff1b\uff0c\u3001]/.test(text);
  const hasMultipleWords = (text.match(/\s+/g) || []).length >= 2;
  return hasCjkCharacters(text) && (hasSentencePunctuation || hasMultipleWords);
};

export const isPlausibleMachineToken = (value: string): boolean => {
  const text = String(value || '').trim();
  if (!text) return false;
  if (text.length < 16) return false;
  if (/\s/.test(text)) return false;
  return /^[\x21-\x7e]+$/.test(text);
};

export const hasCredential = (profile: unknown): boolean => {
  const p = profile as Record<string, unknown>;
  const token = String(p?.token || '').trim();
  const key = String(p?.key || p?.apiKey || p?.api_key || '').trim();
  const access = String(p?.access || '').trim();
  if (token) return !/\s/.test(token);
  if (key) return !/\s/.test(key);
  if (access) return true;
  return false;
};

export const unwrapCliArg = (rawValue: string): string => {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  if (value.startsWith("'") && value.endsWith("'")) {
    const inner = value.slice(1, -1);
    return inner.replace(/'\\''/g, "'");
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    const inner = value.slice(1, -1);
    return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
};

export const getProfileProviderAliases = (profileId: string, profile: unknown): string[] => {
  const p = profile as Record<string, unknown>;
  const provider = String(p?.provider || '').toLowerCase();
  const id = String(profileId || '').toLowerCase();
  const aliases = new Set<string>();
  if (provider) aliases.add(provider);
  if (id) aliases.add(id.split(':')[0]);
  return Array.from(aliases).filter(Boolean);
};

export const getChoiceAliases = (authChoice: string): string[] =>
  AUTH_CHOICE_PROVIDER_ALIASES[String(authChoice || '').trim()] || [String(authChoice || '').trim()];

export const providerMatchesAny = (provider: string, filters: string[]): boolean => {
  const normalizedProvider = String(provider || '').toLowerCase();
  if (!normalizedProvider) return false;
  if (!filters.length) return true;
  return filters.some((rawFilter) => {
    const filter = String(rawFilter || '').toLowerCase();
    if (!filter) return false;
    if (normalizedProvider === filter) return true;
    const providerAliases = providerAliasSets[normalizedProvider] || [normalizedProvider];
    const filterAliases = providerAliasSets[filter] || [filter];
    return providerAliases.some((alias) => filterAliases.includes(alias));
  });
};

export const profileMatchesAliases = (profileId: string, profile: unknown, aliases: string[]): boolean => {
  const p = profile as Record<string, unknown>;
  const provider = String(p?.provider || '').toLowerCase();
  const id = String(profileId || '').toLowerCase();
  return aliases.some((alias) => {
    const normalizedAlias = String(alias || '').toLowerCase();
    return normalizedAlias && (provider === normalizedAlias || id.includes(normalizedAlias));
  });
};

// ── Auth Choice 推斷 ───────────────────────────────────────────────────────

export function inferAuthChoiceFromProfile(profile: unknown): string {
  const p = profile as Record<string, unknown>;
  const provider = String(p?.provider || '').toLowerCase();
  const mode = String(p?.mode || p?.type || '').toLowerCase();
  if (provider === 'anthropic') return mode === 'token' ? 'token' : 'apiKey';
  if (provider === 'openai-codex') return 'openai-codex';
  if (provider === 'openai') return mode === 'oauth' ? 'openai-codex' : 'openai-api-key';
  if (provider === 'google' || provider === 'gemini') return mode === 'oauth' ? 'google-gemini-cli' : 'gemini-api-key';
  if (provider === 'google-gemini-cli') return 'google-gemini-cli';
  if (provider === 'minimax-portal') return 'minimax-coding-plan-global-token';
  if (provider === 'minimax') return 'minimax-api';
  if (provider === 'moonshot') return 'moonshot-api-key';
  if (provider === 'openrouter') return 'openrouter-api-key';
  if (provider === 'xai') return 'xai-api-key';
  if (provider === 'ollama') return 'ollama';
  if (provider === 'vllm') return 'vllm';
  if (provider === 'chutes') return 'chutes';
  if (provider === 'qwen-portal' || provider === 'qwen') return 'qwen-portal';
  return '';
}

// ── OpenClaw Config 解析 ────────────────────────────────────────────────────

export function parseOpenClawConfig(content: string) {
  try {
    const parsed = JSON.parse(content);
    let apiKey = parsed.apiKey || parsed.api_key || '';
    let model = parsed.model || '';
    let workspace = '';
    let botToken = '';
    let corePath = '';
    let authChoice = parsed.authChoice || '';
    const gateway = parsed.gateway || null;

    if (parsed.corePath) corePath = parsed.corePath;
    if (!model && parsed.agents?.defaults?.model?.primary) model = parsed.agents.defaults.model.primary;
    if (parsed.agents?.defaults?.workspace) workspace = parsed.agents.defaults.workspace;
    if (parsed.channels?.telegram?.botToken) botToken = parsed.channels.telegram.botToken;

    if (!apiKey && parsed.auth?.profiles) {
      for (const key in parsed.auth.profiles) {
        const profile = parsed.auth.profiles[key];
        const possibleKey = profile.apiKey || profile.api_key || profile.token || profile.bearer;
        if (possibleKey && typeof possibleKey === 'string' && possibleKey.length > 5) {
          apiKey = possibleKey;
          if (!authChoice) {
            const lowKey = key.toLowerCase();
            if (lowKey.includes('anthropic')) authChoice = 'apiKey';
            else if (lowKey.includes('openai')) authChoice = 'openai-api-key';
            else if (lowKey.includes('gemini')) authChoice = 'gemini-api-key';
            else if (lowKey.includes('minimax')) authChoice = 'minimax-api';
            else if (lowKey.includes('deepseek') || lowKey.includes('ollama')) authChoice = 'ollama';
          }
          break;
        }
      }
    }

    const portalProvider = parsed.models?.providers?.['minimax-portal'];
    if (portalProvider?.apiKey) {
      if (!authChoice) {
        const portalBaseUrl = String(portalProvider.baseUrl || '');
        authChoice = portalBaseUrl.includes('minimaxi.com')
          ? 'minimax-coding-plan-cn-token'
          : 'minimax-coding-plan-global-token';
      }
      apiKey = String(portalProvider.apiKey || apiKey || '');
    }

    if (!authChoice && model) {
      const lowModel = model.toLowerCase();
      if (lowModel.includes('claude')) authChoice = 'apiKey';
      else if (lowModel.includes('gpt')) authChoice = 'openai-api-key';
      else if (lowModel.includes('gemini')) authChoice = 'gemini-api-key';
      else if (lowModel.includes('minimax')) authChoice = 'minimax-api';
      else if (lowModel.includes('ollama') || lowModel.includes('deepseek')) authChoice = 'ollama';
    }

    if (!authChoice && apiKey) authChoice = 'apiKey';

    const providers: string[] = [];
    if (parsed.auth?.profiles) {
      for (const key in parsed.auth.profiles) {
        const profile = parsed.auth.profiles[key];
        const provider = profile.provider || key.split(':')[0];
        if (provider && !providers.includes(provider)) providers.push(provider);
      }
    }

    const agentList: Array<{ id: string; name: string; workspace: string; agentDir: string; model: string }> =
      (Array.isArray(parsed.agents?.list) ? parsed.agents.list : [])
        .map((a: Record<string, unknown>) => {
          const id = String(a.id ?? '').trim();
          return {
            id,
            name: String((a.identity as Record<string, unknown>)?.name ?? a.name ?? a.id ?? '').trim(),
            workspace: String(a.workspace ?? parsed.agents?.defaults?.workspace ?? '').trim(),
            agentDir: String(a.agentDir ?? `~/.openclaw/agents/${id}/agent`).trim(),
            model: String(a.model ?? '').trim(),
          };
        })
        .filter((a: { id: string }) => !!a.id);

    return { apiKey, model, workspace, botToken, corePath, authChoice, providers, gateway, agentList };
  } catch (_e) {
    return { apiKey: '', model: '', workspace: '', botToken: '', corePath: '', authChoice: '', providers: [] as string[], gateway: null, agentList: [] as Array<{ id: string; name: string; workspace: string; agentDir: string; model: string }> };
  }
}

// ── JSON 檔案讀寫 ─────────────────────────────────────────────────────────

export async function loadJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function saveJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

// ── Auth Profile 掃描 ─────────────────────────────────────────────────────

export async function getAgentAuthProfilePaths(configDir: string): Promise<string[]> {
  const agentsRoot = path.join(configDir, 'agents');
  let entries: import('node:fs').Dirent[] = [];
  try {
    entries = await fs.readdir(agentsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(agentsRoot, entry.name, 'agent', 'auth-profiles.json');
    try {
      await fs.access(candidate);
      results.push(candidate);
    } catch {
      // Ignore missing auth profiles for this agent.
    }
  }
  return results;
}

export async function collectAuthProfiles(configDir: string) {
  interface MergedProfileEntry {
    profileId: string;
    provider: string;
    mode: string;
    globalPresent: boolean;
    agentPresent: boolean;
    agentCount: number;
    credentialHealthy: boolean;
    diagnostics: string[];
    authChoice?: string;
    synthetic?: boolean;
    severity?: string;
    repairGuides?: string[];
  }

  const configFilePath = path.join(configDir, 'openclaw.json');
  const configJson = (await loadJsonFile(configFilePath)) || {};
  const configAuthBlock = configJson.auth as Record<string, unknown> | undefined;
  const globalProfiles = (configAuthBlock?.profiles as Record<string, unknown>) || {};
  const agentFiles = await getAgentAuthProfilePaths(configDir);

  const merged = new Map<string, MergedProfileEntry>();

  const normalizeProfileMeta = (profileId: string, profile: unknown) => {
    const p = profile as Record<string, unknown>;
    const provider = String(p?.provider || String(profileId).split(':')[0] || '').toLowerCase();
    const mode = String(p?.mode || p?.type || '').toLowerCase();
    return { provider, mode };
  };

  const findFallbackGlobalKey = (provider: string, mode: string) => {
    if (!provider) return '';
    for (const [key, entry] of merged.entries()) {
      const entryProvider = String(entry?.provider || '').toLowerCase();
      const entryMode = String(entry?.mode || '').toLowerCase();
      if (!entry?.globalPresent || entry?.agentPresent) continue;
      if (!entryProvider || entryProvider !== provider) continue;
      if (mode && entryMode && entryMode !== mode) continue;
      return key;
    }
    return '';
  };

  for (const [profileId, profile] of Object.entries(globalProfiles)) {
    const meta = normalizeProfileMeta(String(profileId), profile);
    merged.set(String(profileId), {
      profileId: String(profileId),
      provider: meta.provider,
      mode: meta.mode,
      globalPresent: true,
      agentPresent: false,
      agentCount: 0,
      credentialHealthy: false,
      diagnostics: [],
    });
  }

  // MiniMax Coding Plan token is stored in models.providers['minimax-portal'].apiKey,
  // not under auth.profiles — inject a synthetic profile so it shows up in the count.
  const minimaxPortal = ((configJson.models as Record<string, unknown>)?.providers as Record<string, unknown>)?.['minimax-portal'] as Record<string, unknown> | undefined;
  if (minimaxPortal?.apiKey && typeof minimaxPortal.apiKey === 'string' && minimaxPortal.apiKey.length > 5) {
    const syntheticId = 'minimax-portal:token';
    if (!merged.has(syntheticId)) {
      const portalBaseUrl = String(minimaxPortal.baseUrl || '');
      const authChoice = portalBaseUrl.includes('minimaxi.com')
        ? 'minimax-coding-plan-cn-token'
        : 'minimax-coding-plan-global-token';
      merged.set(syntheticId, {
        profileId: syntheticId,
        provider: 'minimax-portal',
        mode: 'token',
        authChoice,
        globalPresent: true,
        agentPresent: false,
        agentCount: 0,
        credentialHealthy: true,
        diagnostics: [],
        synthetic: true,  // not in auth.profiles — skip dual-layer diagnostics
      });
    }
  }

  for (const authPath of agentFiles) {
    const parsed = (await loadJsonFile(authPath)) || {};
    const profiles = (parsed.profiles as Record<string, unknown>) || {};
    for (const [profileId, profile] of Object.entries(profiles)) {
      const profileKey = String(profileId);
      const meta = normalizeProfileMeta(profileKey, profile);
      const resolvedKey = merged.has(profileKey) ? profileKey : findFallbackGlobalKey(meta.provider, meta.mode);
      const entry = merged.get(resolvedKey || profileKey) || {
        profileId: profileKey,
        provider: meta.provider,
        mode: meta.mode,
        globalPresent: false,
        agentPresent: false,
        agentCount: 0,
        credentialHealthy: false,
        diagnostics: [],
      };
      entry.agentPresent = true;
      entry.agentCount += 1;
      const resolvedProvider = String(entry.provider || meta.provider || '').toLowerCase();
      const isCredentialless = CREDENTIALLESS_AUTH_CHOICES.has(resolvedProvider);
      entry.credentialHealthy = isCredentialless || hasCredential(profile);
      if (!entry.credentialHealthy) {
        entry.diagnostics.push('agent_credential_missing_or_invalid');
      }
      if (!entry.mode) entry.mode = meta.mode;
      if (!entry.provider) entry.provider = meta.provider;
      merged.set(resolvedKey || profileKey, entry);
    }
  }

  const profiles = Array.from(merged.values()).map((entry) => {
    const { diagnostics } = entry;
    if (!entry.synthetic && entry.globalPresent && !entry.agentPresent) diagnostics.push('global_only');
    if (!entry.synthetic && !entry.globalPresent && entry.agentPresent) diagnostics.push('agent_only');

    const severity = diagnostics.includes('agent_credential_missing_or_invalid')
      ? 'critical'
      : diagnostics.length > 0 ? 'warn' : 'ok';

    const repairGuides: string[] = [];
    if (diagnostics.includes('agent_credential_missing_or_invalid')) repairGuides.push(t('main.repair.reauth'));
    if (diagnostics.includes('global_only')) repairGuides.push(t('main.repair.onboardSync'));
    if (diagnostics.includes('agent_only')) repairGuides.push(t('main.repair.agentOnly'));

    entry.severity = severity;
    entry.repairGuides = repairGuides;
    return entry;
  });

  const summary = {
    total: profiles.length,
    healthy: profiles.filter((item) => item.severity === 'ok').length,
    warn: profiles.filter((item) => item.severity === 'warn').length,
    critical: profiles.filter((item) => item.severity === 'critical').length,
  };

  return { configFilePath, configJson, agentFiles, profiles, summary };
}
