/** Electron 主程序的 i18n 翻譯支援，載入 src/locales/ 下的 JSON 語系檔。 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const currentLocale = 'zh-TW';
export const localeCache: Record<string, unknown> = {};

export async function loadLocales(): Promise<void> {
  const localesDir = path.join(__dirname, '../../src/locales');
  const langs = ['zh-TW', 'en', 'zh-CN'];
  for (const lang of langs) {
    try {
      const data = await fs.readFile(path.join(localesDir, `${lang}.json`), 'utf-8');
      localeCache[lang] = JSON.parse(data);
    } catch (e) {
      console.error(`[i18n] Failed to load locale ${lang}:`, e);
    }
  }
}

export function t(key: string, params: Record<string, unknown> = {}): string {
  const parts = key.split('.');
  let value: unknown = localeCache[currentLocale] ?? localeCache['en'] ?? {};
  for (const part of parts) {
    if (!value || typeof value !== 'object') { value = undefined; break; }
    value = (value as Record<string, unknown>)[part];
    if (value === undefined) break;
  }
  if (typeof value !== 'string') return key;

  let result = value;
  for (const [k, v] of Object.entries(params)) {
    result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
  }
  return result;
}
