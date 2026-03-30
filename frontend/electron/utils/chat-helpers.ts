/** Chat 訊息文字提取輔助函式：純函式，無副作用，用於 OpenClaw WebSocket 訊息解析。 */

export const pickTextFromUnknownContent = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const it = item as Record<string, unknown>;
        if (it.type === 'text' && typeof it.text === 'string') return it.text;
        if ((it.type === 'output_text' || it.type === 'input_text') && typeof it.text === 'string') return it.text;
        if (Array.isArray(it.parts)) return pickTextFromUnknownContent(it.parts);
        if (typeof it.text === 'string') return it.text;
        if (typeof it.value === 'string') return it.value;
        if (typeof it.content === 'string') return it.content;
        if (it.content && typeof it.content === 'object') return pickTextFromUnknownContent(it.content);
        return '';
      })
      .join('');
  }
  if (content && typeof content === 'object') {
    const c = content as Record<string, unknown>;
    if (Array.isArray(c.parts)) return pickTextFromUnknownContent(c.parts);
    if (typeof c.text === 'string') return c.text;
    if (typeof c.value === 'string') return c.value;
    if (typeof c.content === 'string') return c.content;
    if (c.content && typeof c.content === 'object') return pickTextFromUnknownContent(c.content);
  }
  return '';
};

export const extractMessageText = (message: unknown): string => {
  if (!message || typeof message !== 'object') return '';
  const m = message as Record<string, unknown>;
  const direct = pickTextFromUnknownContent(m.content);
  if (direct) return direct;
  if (typeof m.text === 'string') return m.text;
  if (typeof m.message === 'string') return m.message;
  if (typeof m.output_text === 'string') return m.output_text;
  return '';
};

export const extractCronDisplayNameFromText = (text: string): string => {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const matched = raw.match(/\[cron:([0-9a-f-]{8,})\s+([^\]]+)\]/i);
  if (!matched) return '';
  const rawId = String(matched[1] || '').trim();
  const name = String(matched[2] || '').trim();
  if (!rawId || !name) return '';
  const shortId = rawId.replace(/-/g, '').slice(0, 8);
  return `${name}(Cron-${shortId})`;
};

export const deriveSessionDisplayName = (sessionKey: string, meta: unknown): string => {
  const m = meta as { displayName?: string; title?: string; name?: string; prompt?: string; summary?: string } | null;
  const explicit = [m?.displayName, m?.title, m?.name, m?.prompt, m?.summary]
    .find((value) => typeof value === 'string' && String(value).trim());
  if (explicit && typeof explicit === 'string') {
    const parsed = extractCronDisplayNameFromText(explicit);
    if (parsed) return parsed;
    return explicit;
  }
  const parsedFromKey = extractCronDisplayNameFromText(sessionKey);
  if (parsedFromKey) return parsedFromKey;
  const parts = sessionKey.split(':');
  if (parts.length < 3) return sessionKey;
  const type = parts[2];
  const rest = parts.slice(3).join(':');
  if (type === 'main') return 'Direct';
  if (type === 'telegram') return `Telegram ${rest}`;
  if (type === 'cron') return rest ? `Cron ${rest.slice(0, 8)}` : 'Cron';
  return rest || sessionKey;
};

export const isAssistantMessage = (message: unknown): boolean => {
  if (!message || typeof message !== 'object') return false;
  const m = message as Record<string, unknown> & { author?: Record<string, unknown> };
  const role = String(m.role || m.type || m.author?.role || '').toLowerCase();
  return role === 'assistant';
};

export const extractRunIdFromSendPayload = (payload: unknown): string => {
  const p = payload as Record<string, unknown>;
  const result = p?.result ?? p;
  const r = result as Record<string, unknown>;
  const maybeRunId = r?.runId || r?.run_id || r?.id || '';
  return typeof maybeRunId === 'string' ? maybeRunId : '';
};
