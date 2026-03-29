import path from 'node:path';
import fs from 'node:fs/promises';
import { dialog } from 'electron';
import { t } from '../../utils/i18n.js';
import type { CommandResult } from './types.js';
import type { ShellExecContext } from '../shell-exec-handler.js';

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

  if (fullCommand.startsWith('skill:delete')) {
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

  return null;
}
