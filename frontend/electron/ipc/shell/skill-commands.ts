import path from 'node:path';
import fs from 'node:fs/promises';
import { dialog } from 'electron';
import { t } from '../../utils/i18n.js';
import type { CommandResult } from './types.js';
import type { ShellExecContext } from '../shell-exec-handler.js';

async function moveDirWithFallback(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'EXDEV') throw error;
    await fs.cp(sourcePath, targetPath, { recursive: true });
    await fs.rm(sourcePath, { recursive: true, force: true });
  }
}

export async function handleSkillCommands(fullCommand: string, ctx: ShellExecContext): Promise<CommandResult | null> {
  if (!fullCommand.startsWith('skill:')) return null;

  if (fullCommand === 'skill:import') {
    try {
      const result = await dialog.showOpenDialog(ctx.mainWindow!, {
        properties: ['openDirectory'],
        title: t('main.titles.selectSkillFolder'),
      });
      if (result.canceled) return { code: 0, stdout: 'Canceled', exitCode: 0 };
      const sourcePath = result.filePaths[0];
      const skillName = path.basename(sourcePath);
      try {
        await fs.access(path.join(sourcePath, 'SKILL.md'));
      } catch {
        return { code: 1, stderr: t('main.ipc.errors.skillMissingMd'), exitCode: 1 };
      }
      const configPath = ctx.getClawlaunchFile();
      let targetBaseDir = '';
      try {
        const content = await fs.readFile(configPath, 'utf-8');
        const config = JSON.parse(content);
        targetBaseDir = config.workspacePath || config.configPath;
      } catch { /* no config */ }
      if (!targetBaseDir) {
        return { code: 1, stderr: t('main.ipc.errors.missingPath'), exitCode: 1 };
      }
      const targetPath = path.join(targetBaseDir, 'skills', skillName);
      await fs.mkdir(path.join(targetBaseDir, 'skills'), { recursive: true });
      await fs.cp(sourcePath, targetPath, { recursive: true });
      return { code: 0, stdout: t('main.ipc.success.skillImported', { name: skillName }), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'skill import failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('skill:delete') && !fullCommand.startsWith('skill:delete-core')) {
    try {
      const skillPath = fullCommand.replace('skill:delete ', '').trim();
      if (!skillPath) throw new Error(t('main.ipc.errors.missingPath'));
      const launcherConfigPath = ctx.getClawlaunchFile();
      let configuredWorkspacePath = '', configuredConfigPath = '';
      try {
        const launcherRaw = await fs.readFile(launcherConfigPath, 'utf-8');
        const launcherCfg = JSON.parse(launcherRaw || '{}');
        configuredWorkspacePath = typeof launcherCfg.workspacePath === 'string' ? launcherCfg.workspacePath.trim() : '';
        configuredConfigPath = typeof launcherCfg.configPath === 'string' ? launcherCfg.configPath.trim() : '';
      } catch { /* no config — fallback to empty */ }
      const allowedBases = [
        configuredWorkspacePath ? path.resolve(configuredWorkspacePath, 'skills') : '',
        configuredConfigPath ? path.resolve(configuredConfigPath, 'skills') : '',
      ].filter(Boolean);
      const resolvedTarget = path.resolve(skillPath);
      const isInsideAllowedBase = allowedBases.some((base) => resolvedTarget === base || resolvedTarget.startsWith(`${base}${path.sep}`));
      if (!isInsideAllowedBase) {
        throw new Error(t('main.ipc.errors.securityDenied'));
      }
      await fs.rm(resolvedTarget, { recursive: true, force: true });
      return { code: 0, stdout: t('main.ipc.success.skillRemoved'), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'skill delete failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('skill:move-core')) {
    try {
      const payloadRaw = fullCommand.replace('skill:move-core', '').trim();
      let skillId = '';
      if (payloadRaw) {
        try {
          const payload = JSON.parse(payloadRaw);
          skillId = typeof payload?.skillId === 'string' ? payload.skillId.trim() : '';
        } catch {
          skillId = payloadRaw.trim();
        }
      }

      if (!skillId) {
        throw new Error(t('main.ipc.errors.missingPath'));
      }
      if (skillId !== path.basename(skillId) || skillId.includes('..')) {
        throw new Error(t('main.ipc.errors.securityDenied'));
      }

      const launcherConfigPath = ctx.getClawlaunchFile();
      let configuredWorkspacePath = '', configuredConfigPath = '', configuredCorePath = '';
      try {
        const launcherRaw = await fs.readFile(launcherConfigPath, 'utf-8');
        const launcherCfg = JSON.parse(launcherRaw || '{}');
        configuredWorkspacePath = typeof launcherCfg.workspacePath === 'string' ? launcherCfg.workspacePath.trim() : '';
        configuredConfigPath = typeof launcherCfg.configPath === 'string' ? launcherCfg.configPath.trim() : '';
        configuredCorePath = typeof launcherCfg.corePath === 'string' ? launcherCfg.corePath.trim() : '';
      } catch { /* no config */ }

      const targetBaseDir = configuredWorkspacePath || configuredConfigPath;
      if (!configuredCorePath) {
        throw new Error(t('main.ipc.errors.missingCorePath'));
      }
      if (!targetBaseDir) {
        throw new Error(t('main.ipc.errors.missingPath'));
      }

      const coreSkillsRoot = path.resolve(configuredCorePath, 'skills');
      const workspaceSkillsRoot = path.resolve(targetBaseDir, 'skills');
      const sourcePath = path.resolve(coreSkillsRoot, skillId);
      const targetPath = path.resolve(workspaceSkillsRoot, skillId);

      const sourceAllowed = sourcePath === coreSkillsRoot || sourcePath.startsWith(`${coreSkillsRoot}${path.sep}`);
      const targetAllowed = targetPath === workspaceSkillsRoot || targetPath.startsWith(`${workspaceSkillsRoot}${path.sep}`);
      if (!sourceAllowed || !targetAllowed) {
        throw new Error(t('main.ipc.errors.securityDenied'));
      }

      const sourceStats = await fs.stat(sourcePath).catch(() => null);
      if (!sourceStats || !sourceStats.isDirectory()) {
        throw new Error(t('main.ipc.errors.skillNotFound', { name: skillId }));
      }

      const targetStats = await fs.stat(targetPath).catch(() => null);
      if (targetStats) {
        throw new Error(t('main.ipc.errors.skillAlreadyExists', { name: skillId }));
      }

      await fs.mkdir(workspaceSkillsRoot, { recursive: true });
      await moveDirWithFallback(sourcePath, targetPath);

      return { code: 0, stdout: t('main.ipc.success.skillMoved', { name: skillId }), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'skill move failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('skill:move-to-core')) {
    try {
      const payloadRaw = fullCommand.replace('skill:move-to-core', '').trim();
      let skillId = '';
      if (payloadRaw) {
        try {
          const payload = JSON.parse(payloadRaw);
          skillId = typeof payload?.skillId === 'string' ? payload.skillId.trim() : '';
        } catch {
          skillId = payloadRaw.trim();
        }
      }

      if (!skillId) {
        throw new Error(t('main.ipc.errors.missingPath'));
      }
      if (skillId !== path.basename(skillId) || skillId.includes('..')) {
        throw new Error(t('main.ipc.errors.securityDenied'));
      }

      const launcherConfigPath = ctx.getClawlaunchFile();
      let configuredWorkspacePath = '', configuredConfigPath = '', configuredCorePath = '';
      try {
        const launcherRaw = await fs.readFile(launcherConfigPath, 'utf-8');
        const launcherCfg = JSON.parse(launcherRaw || '{}');
        configuredWorkspacePath = typeof launcherCfg.workspacePath === 'string' ? launcherCfg.workspacePath.trim() : '';
        configuredConfigPath = typeof launcherCfg.configPath === 'string' ? launcherCfg.configPath.trim() : '';
        configuredCorePath = typeof launcherCfg.corePath === 'string' ? launcherCfg.corePath.trim() : '';
      } catch { /* no config */ }

      const sourceBaseDir = configuredWorkspacePath || configuredConfigPath;
      if (!sourceBaseDir) {
        throw new Error(t('main.ipc.errors.missingPath'));
      }
      if (!configuredCorePath) {
        throw new Error(t('main.ipc.errors.missingCorePath'));
      }

      const workspaceSkillsRoot = path.resolve(sourceBaseDir, 'skills');
      const coreSkillsRoot = path.resolve(configuredCorePath, 'skills');
      const sourcePath = path.resolve(workspaceSkillsRoot, skillId);
      const targetPath = path.resolve(coreSkillsRoot, skillId);

      const sourceAllowed = sourcePath === workspaceSkillsRoot || sourcePath.startsWith(`${workspaceSkillsRoot}${path.sep}`);
      const targetAllowed = targetPath === coreSkillsRoot || targetPath.startsWith(`${coreSkillsRoot}${path.sep}`);
      if (!sourceAllowed || !targetAllowed) {
        throw new Error(t('main.ipc.errors.securityDenied'));
      }

      const sourceStats = await fs.stat(sourcePath).catch(() => null);
      if (!sourceStats || !sourceStats.isDirectory()) {
        throw new Error(t('main.ipc.errors.skillNotFound', { name: skillId }));
      }

      const targetStats = await fs.stat(targetPath).catch(() => null);
      if (targetStats) {
        throw new Error(t('main.ipc.errors.skillAlreadyExists', { name: skillId }));
      }

      await fs.mkdir(coreSkillsRoot, { recursive: true });
      await moveDirWithFallback(sourcePath, targetPath);

      return { code: 0, stdout: t('main.ipc.success.skillMovedToCore', { name: skillId }), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'skill move-to-core failed', exitCode: 1 };
    }
  }

  if (fullCommand.startsWith('skill:delete-core')) {
    try {
      const payloadRaw = fullCommand.replace('skill:delete-core', '').trim();
      let skillId = '';
      if (payloadRaw) {
        try {
          const payload = JSON.parse(payloadRaw);
          skillId = typeof payload?.skillId === 'string' ? payload.skillId.trim() : '';
        } catch {
          skillId = payloadRaw.trim();
        }
      }
      if (!skillId) throw new Error(t('main.ipc.errors.missingPath'));
      if (skillId !== path.basename(skillId) || skillId.includes('..')) {
        throw new Error(t('main.ipc.errors.securityDenied'));
      }
      const launcherConfigPath = ctx.getClawlaunchFile();
      let configuredCorePath = '';
      try {
        const launcherRaw = await fs.readFile(launcherConfigPath, 'utf-8');
        const launcherCfg = JSON.parse(launcherRaw || '{}');
        configuredCorePath = typeof launcherCfg.corePath === 'string' ? launcherCfg.corePath.trim() : '';
      } catch { /* no config */ }
      if (!configuredCorePath) throw new Error(t('main.ipc.errors.missingCorePath'));
      const coreSkillsRoot = path.resolve(configuredCorePath, 'skills');
      const resolvedTarget = path.resolve(coreSkillsRoot, skillId);
      const isInsideCore = resolvedTarget === coreSkillsRoot || resolvedTarget.startsWith(`${coreSkillsRoot}${path.sep}`);
      if (!isInsideCore) throw new Error(t('main.ipc.errors.securityDenied'));
      const stats = await fs.stat(resolvedTarget).catch(() => null);
      if (!stats || !stats.isDirectory()) {
        throw new Error(t('main.ipc.errors.skillNotFound', { name: skillId }));
      }
      await fs.rm(resolvedTarget, { recursive: true, force: true });
      return { code: 0, stdout: t('main.ipc.success.skillRemoved'), exitCode: 0 };
    } catch (e) {
      return { code: 1, stderr: (e as Error)?.message || 'skill delete-core failed', exitCode: 1 };
    }
  }

  return null;
}
