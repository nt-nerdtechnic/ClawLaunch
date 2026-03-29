/** Lock file 管理服務：防止多實例同時使用相同 configPath。 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { isPidAlive } from '../utils/shell-utils.js';

/** 目前進程持有的 lock 檔路徑（模組層級狀態）。 */
let activeLockFilePath: string | null = null;

export function getActiveLockFilePath(): string | null {
  return activeLockFilePath;
}

export async function writeLockFile(configPathDir: string): Promise<string | null> {
  const lockFileName = `.nt-clawlaunch-${process.pid}.lock`;
  const lockFilePath = path.join(configPathDir, lockFileName);
  try {
    await fs.writeFile(lockFilePath, String(process.pid), 'utf-8');
    return lockFilePath;
  } catch (e) {
    console.error('[lock] Failed to write lock file:', e);
    return null;
  }
}

export async function cleanupLockFile(): Promise<void> {
  if (!activeLockFilePath) return;
  const prev = activeLockFilePath;
  activeLockFilePath = null;
  try {
    await fs.unlink(prev);
  } catch {
    // silently ignore — file may already be gone
  }
}

export interface ConfigPathConflictResult {
  conflictPid: number | null;
  suggestionPath: string;
}

export async function checkConfigPathConflict(configPathDir: string): Promise<ConfigPathConflictResult> {
  let conflictPid: number | null = null;
  try {
    const entries = await fs.readdir(configPathDir);
    for (const entry of entries) {
      const match = entry.match(/^\.nt-clawlaunch-(\d+)\.lock$/);
      if (!match) continue;
      const pid = Number(match[1]);
      if (pid === process.pid) continue;
      if (isPidAlive(pid)) {
        conflictPid = pid;
        break;
      }
      // Stale lock from dead process — clean up opportunistically
      try { await fs.unlink(path.join(configPathDir, entry)); } catch {}
    }
  } catch {
    return { conflictPid: null, suggestionPath: '' };
  }

  if (conflictPid === null) return { conflictPid: null, suggestionPath: '' };

  const base = configPathDir.replace(/\/+$/, '');
  let suggestionPath = '';
  for (let i = 2; i <= 9; i++) {
    const candidate = `${base}-${i}`;
    let candidateFree = true;
    try {
      const candidateEntries = await fs.readdir(candidate);
      for (const e of candidateEntries) {
        const m = e.match(/^\.nt-clawlaunch-(\d+)\.lock$/);
        if (m && Number(m[1]) !== process.pid && isPidAlive(Number(m[1]))) {
          candidateFree = false;
          break;
        }
      }
    } catch {
      // Candidate directory doesn't exist — definitely free
    }
    if (candidateFree) { suggestionPath = candidate; break; }
  }

  return { conflictPid, suggestionPath };
}

/**
 * 嘗試取得 configPath 的 lock；若有衝突且有後備路徑則建議切換。
 * 回傳最終設定的 lock 路徑（或 null，代表取得失敗）。
 */
export async function acquireConfigPathLock(newConfigPath: string): Promise<{ lockPath: string | null; conflictPid: number | null; suggestionPath: string }> {
  const normalized = String(newConfigPath || '').trim();

  if (activeLockFilePath) {
    const currentDir = path.dirname(activeLockFilePath);
    if (normalized && currentDir === normalized) {
      return { lockPath: activeLockFilePath, conflictPid: null, suggestionPath: '' };
    }
  }

  await cleanupLockFile();
  if (!normalized) return { lockPath: null, conflictPid: null, suggestionPath: '' };

  const { conflictPid, suggestionPath } = await checkConfigPathConflict(normalized);
  const lockPath = await writeLockFile(normalized);
  if (lockPath) activeLockFilePath = lockPath;

  return { lockPath, conflictPid, suggestionPath };
}
