/** Shell 操作相關純工具函式，無全域狀態依賴。 */

import path from 'node:path';

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** 將字串以適當引號包裝，可安全嵌入 shell 命令。 */
export const shellQuote = (value: string): string => {
  if (process.platform === 'win32') {
    // Windows CMD 使用雙引號，若內部有雙引號則以雙倍引號 "" 跳脫
    return `"${String(value).replace(/"/g, '""')}"`;
  }
  // POSIX 使用單引號
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
};

/** 用於 AppleScript 字串跳脫。 */
export const escapeAppleScriptString = (value: string): string =>
  String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * 以信號 0 探測 PID 是否存活（不送任何信號，僅檢查存在）。
 * 回傳 false 代表程序不存在或無權限存取。
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 過濾掉空字串、以 path.resolve 正規化後去重，保留非空唯一路徑。 */
export function uniqueNonEmptyPaths(paths: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of paths) {
    const p = String(raw || '').trim();
    if (!p) continue;
    const normalized = path.resolve(p);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}
