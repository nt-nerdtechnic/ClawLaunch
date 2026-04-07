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
import { ModelDiscoveryService } from '../../services/ModelDiscoveryService.js';
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

      // Fix 3: backup openclaw.json before any destructive modification
      try { await fs.copyFile(configFilePath, `${configFilePath}.bak`); } catch { /* first-time or missing, ignore */ }

      const configJson = (await loadJsonFile(configFilePath)) || {};
      let removedGlobal = false;
      const configAuth = configJson.auth as Record<string, unknown> | undefined;
      const configProfiles = configAuth?.profiles as Record<string, unknown> | undefined;
      if (configProfiles && Object.prototype.hasOwnProperty.call(configProfiles, profileId)) {
        // Fix 2: if the removed profile is a minimax-portal type, also clean
        // models.providers['minimax-portal'].apiKey and credentials/minimax.key
        const removedProfileData = configProfiles[profileId] as Record<string, unknown> | undefined;
        const removedProvider = String(removedProfileData?.provider || profileId.split(':')[0]).toLowerCase();
        if (removedProvider === 'minimax-portal' || profileId.startsWith('minimax-portal:')) {
          const configModels = configJson.models as Record<string, unknown> | undefined;
          const configProviders = configModels?.providers as Record<string, unknown> | undefined;
          if (configProviders && typeof configProviders['minimax-portal'] === 'object' && configProviders['minimax-portal']) {
            const portal = configProviders['minimax-portal'] as Record<string, unknown>;
            delete portal.apiKey;
            // remove the whole entry if nothing meaningful remains (only baseUrl left)
            const remainingKeys = Object.keys(portal).filter(k => k !== 'baseUrl' && k !== 'api');
            if (remainingKeys.length === 0) delete configProviders['minimax-portal'];
          }
          try { await fs.unlink(path.join(configDir, 'credentials', 'minimax.key')); } catch { /* ignore if absent */ }
        }
        delete configProfiles[profileId];
        removedGlobal = true;
      }
      if (removedGlobal) await saveJsonFile(configFilePath, configJson);

      const agentFiles = await getAgentAuthProfilePaths(configDir);
      let removedAgentFiles = 0;
      for (const authPath of agentFiles) {
        const parsed = (await loadJsonFile(authPath)) || {};
        const parsedProfiles = parsed.profiles as Record<string, unknown> | undefined;
        let agentFileDirty = false;

        if (parsedProfiles && Object.prototype.hasOwnProperty.call(parsedProfiles, profileId)) {
          delete parsedProfiles[profileId];
          agentFileDirty = true;
          removedAgentFiles += 1;
        }

        // Fix 1: always clean lastGood / usageStats regardless of whether
        // profiles[profileId] existed in this file — a stale lastGood entry
        // can exist even when the profile was already absent from profiles.
        const lastGood = parsed.lastGood as Record<string, unknown> | undefined;
        if (lastGood) {
          for (const provider of Object.keys(lastGood)) {
            if (lastGood[provider] === profileId) {
              delete lastGood[provider];
              agentFileDirty = true;
            }
          }
        }

        const usageStats = parsed.usageStats as Record<string, unknown> | undefined;
        if (usageStats && Object.prototype.hasOwnProperty.call(usageStats, profileId)) {
          delete usageStats[profileId];
          agentFileDirty = true;
        }

        if (agentFileDirty) await saveJsonFile(authPath, parsed);
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
        // 從 main agent 複製 auth.json（含實際憑證）；若 main 沒有則建立空物件
        const mainAuthJsonPath = path.join(configDir, 'agents', 'main', 'agent', 'auth.json');
        const authJsonPath = path.join(agentDir, 'auth.json');
        try {
          const mainAuthContent = await fs.readFile(mainAuthJsonPath, 'utf-8');
          try { await fs.access(authJsonPath); } catch { await fs.writeFile(authJsonPath, mainAuthContent, 'utf-8'); }
        } catch {
          try { await fs.access(authJsonPath); } catch { await saveJsonFile(authJsonPath, {}); }
        }
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

  if (fullCommand.startsWith('agent:delete')) {
    try {
      const payloadStr = fullCommand.replace('agent:delete', '').trim();
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const agentId = String(payload?.agentId || '').trim();
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      if (!agentId) return { code: 1, stdout: '', stderr: 'Missing agentId', exitCode: 1 };
      if (!configDir) return { code: 1, stdout: '', stderr: 'Missing configPath', exitCode: 1 };
      if (agentId === 'main') return { code: 1, stdout: '', stderr: 'Cannot delete the main agent', exitCode: 1 };
      if (!/^[A-Za-z0-9._-]+$/.test(agentId)) return { code: 1, stdout: '', stderr: 'Invalid agentId', exitCode: 1 };

      const configFilePath = path.join(configDir, 'openclaw.json');
      const configJson = (await loadJsonFile(configFilePath)) as Record<string, unknown> || {};

      // Find agentDir from config
      const agentsList = Array.isArray((configJson as any)?.agents?.list) ? (configJson as any).agents.list as Array<Record<string, unknown>> : [];
      const agentEntry = agentsList.find((a) => String(a?.id || '') === agentId);
      const agentDir = String(agentEntry?.agentDir || '').trim() || path.join(configDir, 'agents', agentId);

      // Remove agent directory
      try {
        await fs.rm(agentDir, { recursive: true, force: true });
      } catch (e) {
        // non-fatal, dir may already be gone
        console.warn(`[agent:delete] rm agentDir failed: ${(e as Error)?.message}`);
      }

      // Remove from agents.list
      const newList = agentsList.filter((a) => String(a?.id || '') !== agentId);
      if (!(configJson as any).agents) (configJson as any).agents = {};
      (configJson as any).agents.list = newList;

      try { await fs.copyFile(configFilePath, `${configFilePath}.bak`); } catch { /* ignore */ }
      await saveJsonFile(configFilePath, configJson);

      return { code: 0, stdout: JSON.stringify({ deleted: agentId }), stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'agent:delete failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:model-options')) {
    try {
      const payloadStr = fullCommand.replace('config:model-options', '').trim();
      console.log(`[IPC] config:model-options triggered. payload length: ${payloadStr.length}`);
      const payload = payloadStr ? JSON.parse(payloadStr) : {};
      const corePath = String(payload?.corePath || '').trim();
      const configDir = normalizeConfigDir(String(payload?.configPath || ''));
      if (!configDir) return { code: 1, stdout: '', stderr: 'Missing configPath', exitCode: 1 };
      const filters = Array.isArray(payload?.providers)
        ? payload.providers.map((item: unknown) => String(item || '').toLowerCase()).filter(Boolean)
        : [];
      const authOverview = await collectAuthProfiles(configDir);

      // 收集全域 profile 的 secret（用於 effectiveFilters 推斷）
      const globalProfileSecrets = new Map<string, string>();
      const globalProfilesForFilter = ((authOverview.configJson as any)?.auth?.profiles) || {};
      for (const [pid, p] of Object.entries(globalProfilesForFilter)) {
        const profile = p as any;
        const secret = profile?.apiKey || profile?.api_key || profile?.token || '';
        if (secret) globalProfileSecrets.set(pid, secret);
      }

      // 同時接受：agent 健康的 profile 或有全域 secret 的 profile
      const healthyProviders = Array.from(new Set(
        authOverview.profiles
          .filter((profile) => (profile.agentPresent && profile.credentialHealthy) || globalProfileSecrets.has(String(profile.profileId)))
          .flatMap((profile) => getProfileProviderAliases(String(profile.profileId || ''), { provider: profile.provider }))
      ));
      const effectiveFilters = healthyProviders.length > 0 ? healthyProviders : filters;
      
      const discoveryService = new ModelDiscoveryService();
      let remoteGroups: any[] = [];
      if (payload?.syncRemote) {
        // --- 先建 Secret 快取 Map，再決定哪些 profile 可參與遠端拉取 ---
        const secretsMap = new Map<string, string>();

        // 1. 預填全域 Secrets
        const globalProfiles = (authOverview.configJson as any)?.auth?.profiles || {};
        for (const [pid, p] of Object.entries(globalProfiles)) {
          const profile = p as any;
          const secret = profile?.apiKey || profile?.api_key || profile?.token || '';
          if (secret) secretsMap.set(pid, secret);
        }

        // 2. 批次掃描 Agent 並補全 Secrets
        for (const authPath of authOverview.agentFiles) {
          const parsed = (await loadJsonFile(authPath)) as any || {};
          const agentProfiles = parsed?.profiles || {};
          for (const [pid, p] of Object.entries(agentProfiles)) {
            if (secretsMap.has(pid)) continue;
            const profile = p as any;
            const secret = profile?.apiKey || profile?.api_key || profile?.token || '';
            if (secret) secretsMap.set(pid, secret);
          }
        }

        // 同時接受：agent profile 健康 OR 有全域 secret 的 profile（global-only 也能拉遠端）
        const healthyProfiles = authOverview.profiles.filter(p =>
          (p.agentPresent && p.credentialHealthy) || secretsMap.has(String(p.profileId))
        ) as any[];

        const profilesWithSecrets = healthyProfiles.map(p => ({
          ...p,
          apiKey: secretsMap.get(String(p.profileId)) || ''
        }));

        console.log(`[model-options] secretsMap keys:`, Array.from(secretsMap.keys()));
        console.log(`[model-options] all profiles (${authOverview.profiles.length}):`, authOverview.profiles.map((p: any) => ({
          profileId: String(p.profileId), provider: p.provider,
          agentPresent: p.agentPresent, credentialHealthy: p.credentialHealthy,
          inSecretsMap: secretsMap.has(String(p.profileId)),
        })));
        console.log(`[model-options] profilesWithSecrets (${profilesWithSecrets.length}):`, profilesWithSecrets.map((p: any) => ({
          profileId: String(p.profileId), provider: p.provider, hasApiKey: !!p.apiKey, keyPreview: p.apiKey ? p.apiKey.slice(0, 8) + '...' : '(empty)',
        })));
        console.log(`[model-options] effectiveFilters:`, effectiveFilters);
        console.log(`[config:model-options] Starting remote discovery for ${profilesWithSecrets.length} profiles...`);
        const [authGroups, publicGroups] = await Promise.all([
          discoveryService.fetchAllRemoteModels(profilesWithSecrets),
          discoveryService.fetchPublicCatalogue(effectiveFilters),
        ]);
        // 合併：auth 結果優先，公開目錄補充 auth 沒有的 provider
        const authProviders = new Set(authGroups.map(g => g.provider));
        remoteGroups = [
          ...authGroups,
          ...publicGroups.filter(g => !authProviders.has(g.provider)),
        ];
        console.log(`[config:model-options] Remote discovery finished. auth=${authGroups.length} public=${publicGroups.length} merged=${remoteGroups.length}`);
      }
      
      const configFilePath = path.join(configDir, 'openclaw.json');
      const envPrefix = `OPENCLAW_STATE_DIR=${shellQuote(configDir)} OPENCLAW_CONFIG_PATH=${shellQuote(configFilePath)} `;

      const grouped = new Map<string, Set<string>>();
      
      // 1. 先加入遠端抓到的內容
      for (const rg of remoteGroups) {
        if (!grouped.has(rg.provider)) grouped.set(rg.provider, new Set<string>());
        const models = rg.models || [];
        for (const m of models) {
          const finalM = m.includes('/') ? m : `${rg.provider}/${m}`;
          grouped.get(rg.provider)?.add(finalM);
        }
      }

      let usedCoreCli = false;
      if (corePath) {
        const listCmd = `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw models list --all --json`;
        // 限制 CLI 在 5 秒內完成，不讓它卡住整個 IPC 流程
        const cliTimeout = new Promise<{ code: number; stdout: string; stderr: string }>((resolve) =>
          setTimeout(() => resolve({ code: 124, stdout: '', stderr: '[Launcher] CLI timeout (5s)' }), 5000)
        );
        const listRes = await Promise.race([ctx.runShellCommand(listCmd), cliTimeout]);
        if ((listRes.code ?? 0) === 0 && String(listRes.stdout || '').trim()) {
          const parsedList = JSON.parse(listRes.stdout);
          const rows = Array.isArray(parsedList?.models) ? parsedList.models : [];
          for (const row of rows) {
            const key = String(row?.key || '').trim();
            if (!key || row?.available === false) continue;
            const provider = key.includes('/') ? key.split('/')[0].toLowerCase() : '';
            if (!provider || !providerMatchesAny(provider, effectiveFilters)) continue;
            if (!grouped.has(provider)) grouped.set(provider, new Set<string>());
            grouped.get(provider)?.add(key);
          }
          usedCoreCli = true;
        }
      }

      if (!usedCoreCli) {
        const agentsRoot = path.join(configDir, 'agents');
        let entries: import('node:fs').Dirent[] = [];
        try { entries = await fs.readdir(agentsRoot, { withFileTypes: true }); } catch { /* ignore */ }
        const modelFiles: string[] = [];
        const mainFirst = entries
          .filter((entry) => entry.isDirectory())
          .sort((a, b) => { if (a.name === 'main') return -1; if (b.name === 'main') return 1; return a.name.localeCompare(b.name); });
        for (const entry of mainFirst) {
          const candidate = path.join(agentsRoot, entry.name, 'agent', 'models.json');
          try { await fs.access(candidate); modelFiles.push(candidate); } catch { /* ignore */ }
        }
        for (const modelFile of modelFiles) {
          const parsed = (await loadJsonFile(modelFile)) || {};
          const providers = parsed?.providers || {};
          for (const [providerKey, providerConfig] of Object.entries(providers)) {
            const provider = String(providerKey || '').toLowerCase();
            if (!providerMatchesAny(provider, effectiveFilters)) continue;
            const rawModels = Array.isArray((providerConfig as Record<string, unknown>)?.models) ? (providerConfig as Record<string, unknown>).models as unknown[] : [];
            const resolvedModels = rawModels.map((item) => String((item as Record<string, unknown>)?.id || (item as Record<string, unknown>)?.name || '').trim()).filter(Boolean);
            if (!grouped.has(provider)) grouped.set(provider, new Set<string>());
            for (const model of resolvedModels) {
              const finalM = model.includes('/') ? model : `${provider}/${model}`;
              grouped.get(provider)?.add(finalM);
            }
          }
        }
      }

      const groups = Array.from(grouped.entries())
        .map(([provider, models]) => ({ provider, group: provider, models: Array.from(models).sort((a, b) => a.localeCompare(b)) }))
        .filter((group) => group.models.length > 0)
        .sort((a, b) => a.group.localeCompare(b.group));
      return { code: 0, stdout: JSON.stringify({ groups, source: usedCoreCli ? 'remote + local(cli)' : 'remote + local(fs)' }), stderr: '', exitCode: 0 };
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
