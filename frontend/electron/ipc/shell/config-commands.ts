import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import { parseOpenClawConfig, collectAuthProfiles, unwrapCliArg, inferAuthChoiceFromProfile } from '../../services/auth.js';
import { scanSkillsInDir, scanInstalledSkills } from '../../services/skills.js';
import type { CommandResult } from './types.js';
import type { ShellExecContext } from '../shell-exec-handler.js';

export async function handleConfigCommands(fullCommand: string, ctx: ShellExecContext): Promise<CommandResult | null> {
  if (fullCommand.startsWith('config:write')) {
    try {
      const configStr = fullCommand.replace('config:write ', '');
      const config = JSON.parse(configStr);
      const dir = path.join(app.getPath('home'), '.clawlaunch');
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
      const configFilePath = path.join(dir, 'clawlaunch.json');
      await fs.writeFile(configFilePath, JSON.stringify(config, null, 2));
      if (config?.configPath) {
        ctx.activateConfigPath(String(config.configPath)).catch(() => {});
      }
      void ctx.startActivityWatcher();
      return { code: 0, stdout: `Config saved to ${configFilePath}`, stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'config write failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'config:read') {
    try {
      const dir = path.join(app.getPath('home'), '.clawlaunch');
      const configFilePath = path.join(dir, 'clawlaunch.json');
      let content = '{}';
      try {
        content = await fs.readFile(configFilePath, 'utf-8');
      } catch { /* file missing — return empty */ }
      try {
        const parsed = JSON.parse(content);
        if (parsed?.configPath) {
          ctx.activateConfigPath(String(parsed.configPath)).catch(() => {});
        }
        return { code: 0, stdout: JSON.stringify({ ...parsed, appVersion: app.getVersion() }), stderr: '', exitCode: 0 };
      } catch {
        return { code: 0, stdout: content, stderr: '', exitCode: 0 };
      }
    } catch {
      return { code: 1, stdout: '{}', stderr: 'No config file found', exitCode: 1 };
    }
  }

  if (fullCommand === 'config:reset') {
    try {
      const configFilePath = path.join(app.getPath('home'), '.clawlaunch', 'clawlaunch.json');
      await fs.unlink(configFilePath).catch(() => {});
      return { code: 0, stdout: 'Config file deleted', stderr: '', exitCode: 0 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'config reset failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('config:migrate-openclaw')) {
    try {
      const payloadStr = fullCommand.replace('config:migrate-openclaw ', '').trim();
      const payload = JSON.parse(payloadStr || '{}');
      const configFilePath = payload?.configPath ? path.join(payload.configPath, 'openclaw.json') : '';
      const workspacePath = payload?.workspacePath || '';
      if (!configFilePath) return { code: 1, stderr: 'Missing config path', exitCode: 1 };
      const raw = await fs.readFile(configFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      let changed = false;
      if (parsed && typeof parsed === 'object') {
        if ('version' in parsed) { delete parsed['version']; changed = true; }
        if ('corePath' in parsed) { delete parsed['corePath']; changed = true; }
        if (!parsed.agents || typeof parsed.agents !== 'object') { parsed.agents = {}; changed = true; }
        if (!parsed.agents.defaults || typeof parsed.agents.defaults !== 'object') { parsed.agents.defaults = {}; changed = true; }
        if (workspacePath && parsed.agents.defaults.workspace !== workspacePath) {
          const oldDefault = parsed.agents.defaults.workspace as string | undefined;
          parsed.agents.defaults.workspace = workspacePath;
          changed = true;
          // Also update agents.list entries that were pointing at the old default
          if (Array.isArray(parsed.agents.list)) {
            for (const agent of parsed.agents.list as Array<Record<string, unknown>>) {
              if (agent.workspace === oldDefault) {
                agent.workspace = workspacePath;
              }
            }
          }
        }
        if (parsed.models && typeof parsed.models.providers === 'object' && parsed.models.providers !== null) {
          for (const providerVal of Object.values(parsed.models.providers)) {
            if (providerVal && typeof providerVal === 'object' && !Array.isArray((providerVal as Record<string, unknown>).models)) {
              (providerVal as Record<string, unknown>).models = [];
              changed = true;
            }
          }
        }
      }
      if (changed) {
        await fs.writeFile(configFilePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
      }
      return { code: 0, stdout: JSON.stringify({ changed }), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'config migrate failed', exitCode: 1 };
    }
  }

  if (fullCommand === 'detect:paths' || fullCommand.startsWith('detect:paths ')) {
    const dir = path.join(app.getPath('home'), '.clawlaunch');
    const newConfigPath = path.join(dir, 'clawlaunch.json');
    let corePath = '', configPath = '', workspacePath = '';
    let existingConfig: Record<string, unknown> = {};
    const detectArg = fullCommand.slice('detect:paths'.length).trim();
    if (detectArg) {
      try {
        const explicit = JSON.parse(detectArg);
        if (explicit.corePath) corePath = String(explicit.corePath);
        if (explicit.configPath) configPath = String(explicit.configPath);
        if (explicit.workspacePath) workspacePath = String(explicit.workspacePath);
      } catch { /* ignore */ }
    } else {
      try {
        const raw = await fs.readFile(newConfigPath, 'utf-8');
        const cfg = JSON.parse(raw);
        if (cfg.corePath) corePath = cfg.corePath;
        if (cfg.configPath) configPath = cfg.configPath;
        if (cfg.workspacePath) workspacePath = cfg.workspacePath;
        if (configPath) {
          const openclawFile = path.join(configPath, 'openclaw.json');
          try {
            const content = await fs.readFile(openclawFile, 'utf-8');
            existingConfig = parseOpenClawConfig(content);
            if (existingConfig['workspace'] && !workspacePath) workspacePath = existingConfig['workspace'] as string;
          } catch { /* no openclaw.json */ }
        }
      } catch { /* no clawlaunch.json */ }
    }
    const coreSkills = corePath ? await scanSkillsInDir(path.join(corePath, 'skills')) : [];
    const workspaceSkills = workspacePath ? await scanInstalledSkills(workspacePath) : [];
    const agentList = (existingConfig as Record<string, unknown>)['agentList'] ?? [];
    return {
      code: 0,
      stdout: JSON.stringify({ corePath, configPath, workspacePath, agentList, existingConfig: { ...existingConfig, workspaceSkills }, coreSkills }),
      exitCode: 0,
    };
  }

  if (fullCommand.startsWith('config:probe')) {
    const probePath = unwrapCliArg(fullCommand.replace('config:probe ', '').trim());
    try {
      const stats = await fs.stat(probePath);
      let finalConfigFilePath = '', finalConfigDirPath = '';
      if (stats.isDirectory()) {
        const possible = path.join(probePath, 'openclaw.json');
        try {
          await fs.access(possible);
          finalConfigFilePath = possible;
          finalConfigDirPath = probePath;
        } catch {
          const possibleClaw = path.join(probePath, 'clawdbot.json');
          try {
            await fs.access(possibleClaw);
            finalConfigFilePath = possibleClaw;
            finalConfigDirPath = probePath;
          } catch { /* no config file found */ }
        }
      } else if (probePath.endsWith('.json')) {
        finalConfigFilePath = probePath;
        finalConfigDirPath = path.dirname(probePath);
      }
      if (finalConfigFilePath) {
        const content = await fs.readFile(finalConfigFilePath, 'utf-8');
        const configData = parseOpenClawConfig(content);
        const agentAuth = await collectAuthProfiles(finalConfigDirPath);
        const healthyAgentProfiles = agentAuth.profiles.filter((p) => p.credentialHealthy);
        if (healthyAgentProfiles.length > 0) {
          const agentProviders = healthyAgentProfiles.map((p) => String(p.provider || '').toLowerCase()).filter(Boolean);
          configData.providers = Array.from(new Set([...configData.providers, ...agentProviders]));
          if (!configData.authChoice) {
            const first = healthyAgentProfiles[0];
            configData.authChoice = inferAuthChoiceFromProfile(first);
          }
        }
        const coreSkills = configData.corePath ? await scanSkillsInDir(path.join(configData.corePath, 'skills')) : [];
        const workspaceSkills = configData.workspace ? await scanInstalledSkills(configData.workspace) : [];
        const existingConfig = { ...configData, workspaceSkills };
        return {
          code: 0,
          stdout: JSON.stringify({
            ...configData,
            corePath: configData.corePath,
            configPath: finalConfigDirPath,
            workspacePath: configData.workspace,
            agentList: configData.agentList ?? [],
            coreSkills,
            existingConfig,
          }),
          exitCode: 0,
        };
      }
      return { code: 1, stdout: '', stderr: 'No config found at path', exitCode: 1 };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'config probe failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('agent:auth-list')) {
    const agentDirRaw = unwrapCliArg(fullCommand.replace('agent:auth-list', '').trim());
    const homeDir = app.getPath('home');
    const agentDir = agentDirRaw.startsWith('~') ? agentDirRaw.replace('~', homeDir) : agentDirRaw;
    if (!agentDir) return { code: 1, stdout: JSON.stringify({ profiles: [] }), stderr: 'Missing agentDir', exitCode: 1 };
    try {
      const authProfilesPath = path.join(agentDir, 'auth-profiles.json');
      const content = await fs.readFile(authProfilesPath, 'utf-8');
      const raw = JSON.parse(content);
      const rawObject = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const rawProfiles = rawObject.profiles;
      const profiles = Array.isArray(rawProfiles)
        ? rawProfiles
        : (rawProfiles && typeof rawProfiles === 'object'
          ? Object.values(rawProfiles as Record<string, unknown>)
          : (Array.isArray(raw) ? raw : Object.values(rawObject)));
      const sanitized = profiles.map((p: Record<string, unknown>) => ({
        provider: String(p.provider || p.name || '').toLowerCase(),
        authChoice: String(p.authChoice || ''),
        hasKey: !!(p.apiKey || p.api_key || p.token || p.bearer),
        healthy: p.credentialHealthy !== false,
      })).filter((p: { provider: string }) => !!p.provider);
      return { code: 0, stdout: JSON.stringify({ profiles: sanitized }), exitCode: 0 };
    } catch {
      return { code: 0, stdout: JSON.stringify({ profiles: [] }), exitCode: 0 };
    }
  }

  return null;
}
