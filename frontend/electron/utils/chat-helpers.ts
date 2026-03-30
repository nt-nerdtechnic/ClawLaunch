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

const normalizeTelegramDisplayName = (value: string): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const m = raw.match(/^telegram:(g|group|u|user|dm)-(.+)$/i);
  if (!m) return '';
  const kind = String(m[1] || '').toLowerCase();
  const target = String(m[2] || '').trim();
  if (!target) return 'Telegram';
  if (kind === 'g' || kind === 'group') return `Telegram 群組 (${target})`;
  if (kind === 'u' || kind === 'user' || kind === 'dm') return `Telegram 私訊 (${target})`;
  return `Telegram (${target})`;
};

export const deriveSessionDisplayName = (sessionKey: string, meta: unknown): string => {
  const m = meta as {
    displayName?: string;
    title?: string;
    name?: string;
    label?: string;
    prompt?: string;
    summary?: string;
    channel?: string;
    lastChannel?: string;
    chatType?: string;
    lastTo?: string;
    spawnedBy?: string;
    origin?: Record<string, unknown>;
  } | null;

  const parts = sessionKey.split(':');
  const type = parts.length >= 3 ? parts[2] : '';
  const rest = parts.slice(3).join(':');

  if (type === 'subagent') {
    const label = String(m?.label || m?.displayName || m?.title || m?.name || '').trim();
    if (label) return `觸發任務 (${label})`;
    const shortId = rest ? rest.replace(/-/g, '').slice(0, 8) : '';
    return shortId ? `觸發任務 (${shortId})` : '觸發任務';
  }

  // Check meta channel first — some sessions (e.g. agent:main:main) route Telegram
  // messages but use a generic key; detect them by meta.channel / lastChannel.
  const metaChannel = String(m?.channel || m?.lastChannel || '').toLowerCase();
  if (metaChannel === 'telegram' && (type === 'main' || type === 'telegram' || !type)) {
    const chatType = String(m?.chatType || '').toLowerCase();
    const lastTo = String(m?.lastTo || (m?.origin as Record<string, unknown>)?.to || '');
    const targetId = lastTo.replace(/^telegram:/, '');
    if (!targetId && type === 'main') return '直接執行';
    // negative ID = group, positive = private/direct
    const isGroup = chatType === 'group' || (targetId.startsWith('-'));
    if (isGroup) return `Telegram 群組 (${targetId || '?'})`;
    const fromId = String((m?.origin as Record<string, unknown>)?.from || lastTo).replace(/^telegram:/, '');
    return `Telegram 私訊 (${fromId || targetId || '?'})`;
  }

  const normalizedFromKey = (() => {
    if (type === 'telegram') {
      const tg = normalizeTelegramDisplayName(`telegram:${rest}`);
      return tg || `Telegram ${rest}`;
    }
    if (type === 'main') return '直接執行';
    return '';
  })();

  if (normalizedFromKey) return normalizedFromKey;

  const explicit = [m?.displayName, m?.title, m?.name, m?.prompt, m?.summary]
    .find((value) => typeof value === 'string' && String(value).trim());
  if (explicit && typeof explicit === 'string') {
    const parsed = extractCronDisplayNameFromText(explicit);
    if (parsed) return parsed;
    const telegram = normalizeTelegramDisplayName(explicit);
    if (telegram) return telegram;
    return explicit;
  }
  const parsedFromKey = extractCronDisplayNameFromText(sessionKey);
  if (parsedFromKey) return parsedFromKey;
  if (parts.length < 3) return sessionKey;
  if (type === 'main') return '直接執行';
  if (type === 'telegram') return `Telegram ${rest}`;
  if (type === 'cron') return rest ? `Cron ${rest.slice(0, 8)}` : 'Cron';
  if (type === 'subagent') return rest ? `觸發任務 (${rest.slice(0, 8)})` : '觸發任務';
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
