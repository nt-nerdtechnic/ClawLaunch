/** 純資料正規化工具，無副作用、無全域狀態依賴。 */

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (_) {
    return fallback;
  }
}

export const normalizeConfigDir = (rawPath?: string): string => {
  const trimmed = String(rawPath || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/[\\/]openclaw\.json$/i, '');
};

export const normalizeArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? (value as unknown[]) : [];

export const normalizeString = (value: unknown, fallback = ''): string => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

export const normalizeNumber = (value: unknown, fallback = 0): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const pickFirst = (input: unknown, keys: string[], fallback: unknown = ''): unknown => {
  if (!input || typeof input !== 'object') return fallback;
  for (const key of keys) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return fallback;
};

export const estimateUsageCost = (tokensIn: number, tokensOut: number): number =>
  ((tokensIn + tokensOut * 2) / 1_000_000) * 0.5;

export const buildId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
