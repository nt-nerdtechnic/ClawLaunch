import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import { t } from '../../utils/i18n.js';
import { shellQuote } from '../../utils/shell-utils.js';
import { normalizeConfigDir } from '../../utils/normalize.js';
import {
  inferAuthChoiceFromProfile, collectAuthProfiles, loadJsonFile, saveJsonFile,
  getAgentAuthProfilePaths, AUTH_CHOICE_FLAG_MAPPING,
  SUPPORTED_AUTH_CHOICES, CREDENTIALLESS_AUTH_CHOICES, OAUTH_AUTH_CHOICES,
  sanitizeSecret, isLikelyNaturalLanguageSentence, isPlausibleMachineToken,
  getProfileProviderAliases, getChoiceAliases, providerMatchesAny, profileMatchesAliases,
} from '../../services/auth.js';
import type { CommandResult } from './types.js';
import type { ShellExecContext } from '../shell-exec-handler.js';

export async function handleAuthCommands(fullCommand: string, ctx: ShellExecContext): Promise<CommandResult | null> {
  if (fullCommand.startsWith('auth:list-profiles')) {
    try {
      const payloadStr = fullCommand.replace('auth:list-profiles', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      if (!configDir) return { code: 1, stdout: '', stderr: 'Missing configPath', exitCode: 1 };
      const data = await collectAuthProfiles(configDir);
      return { code: 0, stdout: JSON.stringify({ profiles: data.profiles, summary: data.summary }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'auth list-profiles failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('auth:remove-profile')) {
    try {
      const payloadStr = fullCommand.replace('auth:remove-profile', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      const profileId = String(payload?.profileId || '').trim();
      if (!configDir || !profileId) return { code: 1, stdout: '', stderr: 'Missing configPath or profileId', exitCode: 1 };
      if (!/^[A-Za-z0-9._:-]+$/.test(profileId)) return { code: 1, stdout: '', stderr: 'Invalid profileId', exitCode: 1 };
      const configFilePath = path.join(configDir, 'openclaw.json');
      const configJson = (await loadJsonFile(configFilePath)) || {};
      let removedGlobal = false;
      const configAuth = configJson.auth as Record<string, unknown> | undefined;
      const configProfiles = configAuth?.profiles as Record<string, unknown> | undefined;
      if (configProfiles && Object.prototype.hasOwnProperty.call(configProfiles, profileId)) {
        delete configProfiles[profileId];
        removedGlobal = true;
      }
      if (removedGlobal) await saveJsonFile(configFilePath, configJson);
      const agentFiles = await getAgentAuthProfilePaths(configDir);
      let removedAgentFiles = 0;
      for (const authPath of agentFiles) {
        const parsed = (await loadJsonFile(authPath)) || {};
        const parsedProfiles = parsed.profiles as Record<string, unknown> | undefined;
        if (parsedProfiles && Object.prototype.hasOwnProperty.call(parsedProfiles, profileId)) {
          delete parsedProfiles[profileId];
          await saveJsonFile(authPath, parsed);
          removedAgentFiles += 1;
        }
      }
      return { code: 0, stdout: JSON.stringify({ removedGlobal, removedAgentFiles }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'auth remove-profile failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('auth:add-profile')) {
    try {
      const payloadStr = fullCommand.replace('auth:add-profile', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const corePath = String(payload?.corePath || '').trim();
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      const authChoice = String(payload?.authChoice || '').trim();
      const rawSecret = String(payload?.secret || '');
      const secret = sanitizeSecret(rawSecret);
      if (!corePath || !configDir || !authChoice) {
        return { code: 1, stdout: '', stderr: 'Missing corePath/configPath/authChoice', exitCode: 1 };
      }
      if (!SUPPORTED_AUTH_CHOICES.has(authChoice)) {
        return { code: 1, stdout: '', stderr: `Unsupported authChoice: ${authChoice}`, exitCode: 1 };
      }
      if (OAUTH_AUTH_CHOICES.has(authChoice)) {
        return { code: 1, stdout: '', stderr: 'OAuth requires full onboarding flow in terminal', exitCode: 1 };
      }
      if (!CREDENTIALLESS_AUTH_CHOICES.has(authChoice) && !secret) {
        return { code: 1, stdout: '', stderr: 'Credential is required for this authChoice', exitCode: 1 };
      }
      if (authChoice === 'minimax-coding-plan-global-token' || authChoice === 'minimax-coding-plan-cn-token') {
        if (!isPlausibleMachineToken(secret) || isLikelyNaturalLanguageSentence(rawSecret)) {
          return { code: 1, stdout: '', stderr: t('main.ipc.errors.minimaxFormat'), exitCode: 1 };
        }
      }
      const configFilePath = path.join(configDir, 'openclaw.json');
      const ensureMainAgentListEntry = async (workspacePath?: string) => {
        try {
          const configJson = (await loadJsonFile(configFilePath)) || {} as Record<string, unknown>;
          if (!configJson.agents || typeof configJson.agents !== 'object') {
            configJson.agents = {};
          }
          const agents = configJson.agents as Record<string, unknown>;
          const defaults = (agents.defaults && typeof agents.defaults === 'object')
            ? (agents.defaults as Record<string, unknown>)
            : {};
          const rawList = Array.isArray(agents.list)
            ? (agents.list as Array<Record<string, unknown>>)
            : [];
          const hasMain = rawList.some((item) => String(item.id || '').trim() === 'main');
          if (hasMain) return;

          const homeDir = app.getPath('home');
          const mainAgentDir = path.join(configDir, 'agents', 'main', 'agent');
          const mainAgentDirTilde = mainAgentDir.startsWith(homeDir)
            ? mainAgentDir.replace(homeDir, '~')
            : mainAgentDir;
          const mainWorkspace = String(workspacePath || defaults.workspace || '~/.openclaw/workspace-main').trim();
          agents.list = [...rawList, { id: 'main', workspace: mainWorkspace, agentDir: mainAgentDirTilde }];
          await fs.writeFile(configFilePath, `${JSON.stringify(configJson, null, 2)}\n`, 'utf-8');
        } catch { /* best-effort */ }
      };
      // MiniMax Coding Plan Token — write directly to models.providers
      if (authChoice === 'minimax-coding-plan-global-token' || authChoice === 'minimax-coding-plan-cn-token') {
        const configJson = (await loadJsonFile(configFilePath)) || {};
        const configModels = (configJson.models as Record<string, unknown>) || {};
        const configProviders = (configModels.providers as Record<string, unknown>) || {};
        const providers: Record<string, unknown> = configProviders && typeof configProviders === 'object' ? configProviders : {};
        const portalProvider: Record<string, unknown> = providers['minimax-portal'] && typeof providers['minimax-portal'] === 'object' ? (providers['minimax-portal'] as Record<string, unknown>) : {};
        const baseUrl = authChoice === 'minimax-coding-plan-cn-token' ? 'https://api.minimaxi.com/anthropic' : 'https://api.minimax.io/anthropic';
        const nextJson = {
          ...configJson,
          models: {
            ...configModels,
            providers: {
              ...configProviders,
              'minimax-portal': {
                ...portalProvider,
                baseUrl,
                apiKey: secret,
                models: Array.isArray(portalProvider.models) ? portalProvider.models : [],
              },
            },
          },
        };
        await saveJsonFile(configFilePath, nextJson);
        return { code: 0, stdout: JSON.stringify({ authChoice, provider: 'minimax-portal', mode: 'token', baseUrl }), stderr: '', exitCode: 0 };
      }
      const mainAgentDir = path.join(configDir, 'agents', 'main', 'agent');
      // cross-env ensures KEY=VALUE syntax works on both POSIX and Windows cmd.exe
      const envPrefix = `cross-env OPENCLAW_STATE_DIR=${shellQuote(configDir)} OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} OPENCLAW_AGENT_DIR=${shellQuote(mainAgentDir)} `;
      const workspaceFlag = String(payload?.workspacePath || '').trim() ? ` --workspace ${shellQuote(String(payload.workspacePath).trim())}` : '';
      let authFlags = '';
      if (authChoice === 'token') {
        authFlags = ` --token-provider anthropic --token ${shellQuote(secret)}`;
      } else if (!CREDENTIALLESS_AUTH_CHOICES.has(authChoice)) {
        const flag = AUTH_CHOICE_FLAG_MAPPING[authChoice];
        if (!flag) return { code: 1, stdout: '', stderr: `No auth flag mapping for ${authChoice}`, exitCode: 1 };
        authFlags = ` ${flag} ${shellQuote(secret)}`;
      }
      const onboardCmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw onboard --auth-choice ${shellQuote(authChoice)}${authFlags}${workspaceFlag} --no-install-daemon --skip-daemon --skip-health --non-interactive --accept-risk`;
      const onboardRes = await ctx.runShellCommand(onboardCmd);
      if ((onboardRes.code ?? 0) !== 0) {
        return { code: onboardRes.code ?? 1, stdout: onboardRes.stdout || '', stderr: onboardRes.stderr || 'onboard failed', exitCode: onboardRes.code ?? 1 };
      }
      await ensureMainAgentListEntry(String(payload?.workspacePath || '').trim() || undefined);
      const aliases = getChoiceAliases(authChoice);
      const listed = await collectAuthProfiles(configDir);
      const hasMatched = listed.profiles.some((profile) => profileMatchesAliases(String(profile.profileId || ''), { provider: profile.provider }, aliases) && (CREDENTIALLESS_AUTH_CHOICES.has(authChoice) || profile.agentPresent));
      if (!hasMatched) {
        return { code: 1, stdout: '', stderr: 'Auth write finished but no matched profile found in dual layers', exitCode: 1 };
      }
      return { code: 0, stdout: JSON.stringify({ authChoice, aliases, secretSanitized: secret !== rawSecret }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'auth add-profile failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('auth:create-agent')) {
    try {
      const payloadStr = fullCommand.replace('auth:create-agent', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const corePath = String(payload?.corePath || '').trim();
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      const agentId = String(payload?.agentId || '').trim().toLowerCase();

      if (!configDir) {
        return { code: 1, stdout: '', stderr: 'Missing configPath', exitCode: 1 };
      }
      if (!agentId || !/^[a-z0-9][a-z0-9-]{0,30}$/.test(agentId)) {
        return { code: 1, stdout: '', stderr: 'Invalid agentId: use lowercase letters, digits, hyphens (max 31 chars)', exitCode: 1 };
      }
      if (agentId === 'main') {
        return { code: 1, stdout: '', stderr: 'Agent ID "main" is reserved — use auth:add-profile instead', exitCode: 1 };
      }

      const configFilePath = path.join(configDir, 'openclaw.json');
      const agentDir = path.join(configDir, 'agents', agentId, 'agent');
      await fs.mkdir(agentDir, { recursive: true });

      const homeDir = app.getPath('home');
      const toTildePath = (value: string) =>
        value.startsWith(homeDir) ? value.replace(homeDir, '~') : value;

      // ── Helper: register agent in agents.list[] of openclaw.json ──────────
      const registerAgentInConfig = async (workspacePath?: string) => {
        try {
          const configJson = (await loadJsonFile(configFilePath)) || {} as Record<string, unknown>;
          if (!configJson.agents || typeof configJson.agents !== 'object') {
            configJson.agents = {};
          }
          const agents = configJson.agents as Record<string, unknown>;
          const defaults = (agents.defaults && typeof agents.defaults === 'object')
            ? (agents.defaults as Record<string, unknown>)
            : {};
          const rawList = Array.isArray(agents.list)
            ? (agents.list as Array<Record<string, unknown>>)
            : [];

          const nextListMap = new Map<string, Record<string, unknown>>();
          for (const item of rawList) {
            const id = String(item.id || '').trim();
            if (!id) continue;
            nextListMap.set(id, { ...item, id });
          }

          const mainWorkspace = String(defaults.workspace || '~/.openclaw/workspace-main').trim();
          const mainAgentDir = toTildePath(path.join(configDir, 'agents', 'main', 'agent'));
          if (!nextListMap.has('main')) {
            nextListMap.set('main', {
              id: 'main',
              workspace: mainWorkspace,
              agentDir: mainAgentDir,
            });
          }

          const existing = nextListMap.get(agentId) || { id: agentId };
          nextListMap.set(agentId, {
            ...existing,
            id: agentId,
            workspace: workspacePath || String(existing.workspace || `~/.openclaw/workspace-${agentId}`).trim(),
            agentDir: toTildePath(agentDir),
          });

          agents.list = Array.from(nextListMap.values());
          await fs.writeFile(configFilePath, `${JSON.stringify(configJson, null, 2)}\n`, 'utf-8');
        } catch { /* best-effort: don't fail the whole operation */ }
      };

      const restoreMainDefaultAgentDir = async () => {
        try {
          const configJson = (await loadJsonFile(configFilePath)) || {} as Record<string, unknown>;
          if (!configJson.agents || typeof configJson.agents !== 'object') return;
          const agents = configJson.agents as Record<string, unknown>;
          if (!agents.defaults || typeof agents.defaults !== 'object') return;
          const defaults = agents.defaults as Record<string, unknown>;
          const current = String(defaults.agentDir || '').trim();
          if (!current) return;

          const normalized = current.replace(/\\/g, '/');
          if (normalized.endsWith('/agents/main/agent') || normalized.endsWith('/agents/main/agent/')) {
            return;
          }

          defaults.agentDir = toTildePath(path.join(configDir, 'agents', 'main', 'agent'));
          await fs.writeFile(configFilePath, `${JSON.stringify(configJson, null, 2)}\n`, 'utf-8');
        } catch { /* best-effort */ }
      };

      // ── Fast path: clone existing global profiles ──────────────────────────
      if (payload?.cloneFromGlobal === true) {
        const configJson = (await loadJsonFile(configFilePath)) || {};
        const globalProfiles = ((configJson?.auth as Record<string, unknown>)?.profiles as Record<string, unknown>) || {};
        const selectedIds: string[] = Array.isArray(payload?.profileIds)
          ? (payload.profileIds as unknown[]).map(String)
          : Object.keys(globalProfiles);
        const toClone: Record<string, unknown> = {};
        for (const id of selectedIds) {
          if (globalProfiles[id]) toClone[id] = globalProfiles[id];
        }
        if (Object.keys(toClone).length === 0) {
          return { code: 1, stdout: '', stderr: 'No matching profiles found in openclaw.json to clone', exitCode: 1 };
        }
        const authProfilesPath = path.join(agentDir, 'auth-profiles.json');
        const existing = (await loadJsonFile(authProfilesPath)) || {};
        const existingProfiles = (existing.profiles as Record<string, unknown>) || {};
        await saveJsonFile(authProfilesPath, { ...existing, profiles: { ...existingProfiles, ...toClone } });
        await registerAgentInConfig();
        return { code: 0, stdout: JSON.stringify({ agentId, cloned: Object.keys(toClone) }), stderr: '', exitCode: 0 };
      }

      // ── Slow path: run openclaw onboard with a new credential ──────────────
      if (!corePath) {
        return { code: 1, stdout: '', stderr: 'Missing corePath (required for onboard)', exitCode: 1 };
      }
      const authChoice = String(payload?.authChoice || '').trim();
      const secret = sanitizeSecret(String(payload?.secret || ''));
      if (!SUPPORTED_AUTH_CHOICES.has(authChoice)) {
        return { code: 1, stdout: '', stderr: `Unsupported authChoice: ${authChoice}`, exitCode: 1 };
      }
      if (OAUTH_AUTH_CHOICES.has(authChoice)) {
        return { code: 1, stdout: '', stderr: 'OAuth requires full onboarding flow in terminal', exitCode: 1 };
      }
      if (!CREDENTIALLESS_AUTH_CHOICES.has(authChoice) && !secret) {
        return { code: 1, stdout: '', stderr: 'Credential is required for this authChoice', exitCode: 1 };
      }
      const envPrefix = `OPENCLAW_STATE_DIR=${shellQuote(configDir)} OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} OPENCLAW_AGENT_DIR=${shellQuote(agentDir)} `;
      const workspaceFlag = String(payload?.workspacePath || '').trim() ? ` --workspace ${shellQuote(String(payload.workspacePath).trim())}` : '';
      let authFlags = '';
      if (authChoice === 'token') {
        authFlags = ` --token-provider anthropic --token ${shellQuote(secret)}`;
      } else if (!CREDENTIALLESS_AUTH_CHOICES.has(authChoice)) {
        const flag = AUTH_CHOICE_FLAG_MAPPING[authChoice];
        if (!flag) return { code: 1, stdout: '', stderr: `No auth flag mapping for ${authChoice}`, exitCode: 1 };
        authFlags = ` ${flag} ${shellQuote(secret)}`;
      }
      const onboardCmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw onboard --auth-choice ${shellQuote(authChoice)}${authFlags}${workspaceFlag} --no-install-daemon --skip-daemon --skip-health --non-interactive --accept-risk`;
      const onboardRes = await ctx.runShellCommand(onboardCmd);
      if ((onboardRes.code ?? 0) !== 0) {
        return { code: onboardRes.code ?? 1, stdout: onboardRes.stdout || '', stderr: onboardRes.stderr || 'onboard failed', exitCode: onboardRes.code ?? 1 };
      }
      await restoreMainDefaultAgentDir();
      await registerAgentInConfig(String(payload?.workspacePath || '').trim() || undefined);
      return { code: 0, stdout: JSON.stringify({ agentId, authChoice }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'auth create-agent failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:model-options')) {
    try {
      const payloadStr = fullCommand.replace('config:model-options', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const corePath = String(payload?.corePath || '').trim();
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      if (!configDir) return { code: 1, stdout: '', stderr: 'Missing configPath', exitCode: 1 };
      const filters = Array.isArray(payload?.providers)
        ? payload.providers.map((item: unknown) => String(item || '').toLowerCase()).filter(Boolean)
        : [];
      const authOverview = await collectAuthProfiles(configDir);
      const healthyProviders = Array.from(new Set(
        authOverview.profiles
          .filter((profile) => profile.agentPresent && profile.credentialHealthy)
          .flatMap((profile) => getProfileProviderAliases(String(profile.profileId || ''), { provider: profile.provider }))
      ));
      const effectiveFilters = healthyProviders.length > 0 ? healthyProviders : filters;
      const configFilePath = path.join(configDir, 'openclaw.json');
      const envPrefix = `OPENCLAW_STATE_DIR=${shellQuote(configDir)} OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} `;
      if (corePath) {
        const listCmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw models list --all --json`;
        const listRes = await ctx.runShellCommand(listCmd);
        if ((listRes.code ?? 0) === 0 && String(listRes.stdout || '').trim()) {
          const parsedList = JSON.parse(listRes.stdout);
          const rows = Array.isArray(parsedList?.models) ? parsedList.models : [];
          const grouped = new Map<string, Set<string>>();
          for (const row of rows) {
            const key = String(row?.key || '').trim();
            if (!key || row?.available === false) continue;
            const provider = key.includes('/') ? key.split('/')[0].toLowerCase() : '';
            if (!provider || !providerMatchesAny(provider, effectiveFilters)) continue;
            if (!grouped.has(provider)) grouped.set(provider, new Set<string>());
            grouped.get(provider)?.add(key);
          }
          const groups = Array.from(grouped.entries())
            .map(([provider, models]) => ({ provider, group: provider, models: Array.from(models).sort((a, b) => a.localeCompare(b)) }))
            .filter((group) => group.models.length > 0)
            .sort((a, b) => a.group.localeCompare(b.group));
          if (groups.length > 0) {
            return { code: 0, stdout: JSON.stringify({ groups, source: 'openclaw models list --all --json' }), stderr: '', exitCode: 0 };
          }
        }
      }
      const agentsRoot = path.join(configDir, 'agents');
      let entries: import('node:fs').Dirent[] = [];
      try { entries = await fs.readdir(agentsRoot, { withFileTypes: true }); } catch {
        return { code: 0, stdout: JSON.stringify({ groups: [], source: '' }), stderr: '', exitCode: 0 };
      }
      const modelFiles: string[] = [];
      const mainFirst = entries
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => { if (a.name === 'main') return -1; if (b.name === 'main') return 1; return a.name.localeCompare(b.name); });
      for (const entry of mainFirst) {
        const candidate = path.join(agentsRoot, entry.name, 'agent', 'models.json');
        try { await fs.access(candidate); modelFiles.push(candidate); } catch { /* ignore */ }
      }
      if (!modelFiles.length) {
        return { code: 0, stdout: JSON.stringify({ groups: [], source: '' }), stderr: '', exitCode: 0 };
      }
      const grouped = new Map<string, Set<string>>();
      for (const modelFile of modelFiles) {
        const parsed = (await loadJsonFile(modelFile)) || {};
        const providers = parsed?.providers || {};
        for (const [providerKey, providerConfig] of Object.entries(providers)) {
          const provider = String(providerKey || '').toLowerCase();
          if (!providerMatchesAny(provider, effectiveFilters)) continue;
          const rawModels = Array.isArray((providerConfig as Record<string, unknown>)?.models) ? (providerConfig as Record<string, unknown>).models as unknown[] : [];
          const resolvedModels = rawModels.map((item) => String((item as Record<string, unknown>)?.id || (item as Record<string, unknown>)?.name || '').trim()).filter(Boolean);
          if (!grouped.has(provider)) grouped.set(provider, new Set<string>());
          for (const model of resolvedModels) grouped.get(provider)?.add(model);
        }
      }
      const groups = Array.from(grouped.entries())
        .map(([provider, models]) => ({ provider, group: provider, models: Array.from(models).sort((a, b) => a.localeCompare(b)) }))
        .filter((group) => group.models.length > 0)
        .sort((a, b) => a.group.localeCompare(b.group));
      return { code: 0, stdout: JSON.stringify({ groups, source: modelFiles[0] }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'config model-options failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('agent:list')) {
    try {
      const payloadStr = fullCommand.replace('agent:list', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      if (!configDir) return { code: 1, stdout: '', stderr: 'Missing configPath', exitCode: 1 };
      const agentsDir = path.join(configDir, 'agents');
      let entries: string[] = [];
      try {
        const dirents = await fs.readdir(agentsDir, { withFileTypes: true });
        entries = dirents.filter(d => d.isDirectory()).map(d => d.name);
      } catch { /* agents dir doesn't exist yet */ }
      const agents = await Promise.all(entries.map(async (agentId) => {
        const authPath = path.join(agentsDir, agentId, 'agent', 'auth-profiles.json');
        let hasAuth = false;
        try { await fs.access(authPath); hasAuth = true; } catch { /* no auth */ }
        return { agentId, hasAuth };
      }));
      return { code: 0, stdout: JSON.stringify({ agents }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'agent:list failed', exitCode: 1 };
    }
  }

  return null;
}
