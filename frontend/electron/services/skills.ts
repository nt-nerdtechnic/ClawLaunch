/** Skill 掃描與解析服務：從 skills/ 及 extensions/ 目錄讀取技能元資料。 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { t } from '../utils/i18n.js';

/**
 * Recursively copy directory (exclude .git, node_modules)
 */
export async function copyDir(src: string, dest: string, progressCallback?: (msg: string) => void): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      await copyDir(srcPath, destPath, progressCallback);
    } else {
      if (progressCallback) progressCallback(`Copying ${entry.name}...`);
      await fs.copyFile(srcPath, destPath);
    }
  }
}

export async function writeFileIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.writeFile(filePath, content, { flag: 'wx', encoding: 'utf-8' });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * Parse YAML Frontmatter from SKILL.md (simple regex matching)
 */
export async function parseSkillMetadata(skillDir: string, fallbackId: string) {
  const defaultMeta = {
    id: fallbackId,
    name: fallbackId,
    desc: t('main.constants.workspaceExtension'),
    category: 'Plugin',
    details: t('main.constants.noDetails'),
  };
  try {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (match?.[1]) {
      const yamlStr = match[1];
      const nameMatch = yamlStr.match(/name:\s*(.+)/i);
      const descMatch = yamlStr.match(/description:\s*(.+)/i) || yamlStr.match(/desc:\s*(.+)/i);
      if (nameMatch) defaultMeta.name = nameMatch[1].replace(/['"]/g, '').trim();
      if (descMatch) defaultMeta.desc = descMatch[1].replace(/['"]/g, '').trim();
    }
  } catch (_e) {
    // If SKILL.md doesn't exist or reading fails, return default values
  }
  return defaultMeta;
}

/**
 * Scan skill subfolders in the specified directory (skills/ or extensions/ are both allowed)
 */
export async function scanSkillsInDir(dir: string): Promise<unknown[]> {
  const results = [];
  try {
    const stats = await fs.stat(dir);
    if (!stats.isDirectory()) return [];
    const items = await fs.readdir(dir);
    for (const item of items) {
      if (item.startsWith('.')) continue;
      const fullPath = path.join(dir, item);
      try {
        const itemStats = await fs.stat(fullPath);
        if (itemStats.isDirectory()) {
          const meta = await parseSkillMetadata(fullPath, item);
          results.push(meta);
        }
      } catch (_e) {}
    }
  } catch (_e) {}
  return results;
}

/**
 * Scan installed skills in multiple base paths (including skills in skills/ and extensions/)
 */
export async function scanInstalledSkills(...basePaths: string[]): Promise<unknown[]> {
  const allIds = new Set<string>();
  const allSkills: unknown[] = [];

  for (const basePath of basePaths) {
    if (!basePath) continue;
    const fromSkills = await scanSkillsInDir(path.join(basePath, 'skills'));
    const extDir = path.join(basePath, 'extensions');
    const fromExtensions: unknown[] = [];
    try {
      const extItems = await fs.readdir(extDir);
      for (const extPkg of extItems) {
        if (extPkg.startsWith('.')) continue;
        const pkgPath = path.join(extDir, extPkg);
        const nestedSkills = await scanSkillsInDir(path.join(pkgPath, 'skills'));
        if (nestedSkills.length > 0) {
          fromExtensions.push(...nestedSkills);
        } else {
          const meta = await parseSkillMetadata(pkgPath, extPkg);
          fromExtensions.push(meta);
        }
      }
    } catch (_e) {}

    for (const skill of [...fromSkills, ...fromExtensions]) {
      const s = skill as Record<string, unknown>;
      if (!allIds.has(s.id as string)) {
        allIds.add(s.id as string);
        allSkills.push(skill);
      }
    }
  }
  return allSkills;
}
