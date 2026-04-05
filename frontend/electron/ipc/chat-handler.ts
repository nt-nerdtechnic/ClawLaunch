import { ipcMain, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { WebSocket } from 'ws';
import { resolveOpenClawRuntime, isGatewayOnlineFromStatus } from '../services/openclaw-runtime.js';
import { t } from '../utils/i18n.js';
import { extractCronDisplayNameFromText, extractMessageText, deriveSessionDisplayName, extractRunIdFromSendPayload } from '../utils/chat-helpers.js';
import { readLauncherConfigPaths } from '../services/activity-watcher.js';

const HOME = (() => { try { return app.getPath('home'); } catch { return process.env['HOME'] || process.env['USERPROFILE'] || ''; } })();

// ── Tail-read last JSONL message (reads only last TAIL_BYTES, not whole file) ─
const TAIL_BYTES = 8192;
async function readLastJsonlMessage(filePath: string): Promise<{ lastMessage: string; lastTimestamp: string }> {
  let fd: fsSync.promises.FileHandle | null = null;
  let lastMessage = '';
  let lastTimestamp = '';
  try {
    fd = await fs.open(filePath, 'r');
    const stat = await fd.stat();
    const fileSize = stat.size;
    if (fileSize === 0) return { lastMessage: '', lastTimestamp: '' };
    const readSize = Math.min(TAIL_BYTES, fileSize);
    const offset = fileSize - readSize;
    const buf = Buffer.allocUnsafe(readSize);
    await fd.read(buf, 0, readSize, offset);
    const chunk = buf.toString('utf-8');
    // Split into complete lines (skip the first partial line if we didn't start at byte 0)
    const lines = chunk.split(/\n/);
    const start = offset > 0 ? 1 : 0; // first element may be a partial line
    for (let i = lines.length - 1; i >= start; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== 'message') continue;
        const role = entry.message?.role;
        if (role === 'assistant' || role === 'user') {
          lastMessage = String(extractMessageText(entry.message) || '').slice(0, 100);
          lastTimestamp = String(entry.timestamp || '');
          break;
        }
      } catch { continue; }
    }
    return { lastMessage, lastTimestamp };
  } catch {
    return { lastMessage: '', lastTimestamp: '' };
  } finally {
    await fd?.close().catch(() => {});
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

interface OpenClawChatInvokeRequest {
  requestId: string;
  sessionKey: string;
  agentId: string;
  message: string;
  stream?: boolean;
  deliver?: boolean;
  forceLocal?: boolean;
}

export interface ChatHandlerContext {
  sendToRenderer: (channel: string, payload: unknown) => boolean;
  emitShellStdout: (data: string, source?: 'stdout' | 'stderr') => void;
  runShellCommand: (cmd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
}

// ── Gateway WebSocket Client ─────────────────────────────────────────────────

class GatewayWSClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>();
  private reqCounter = 0;
  private chatListeners = new Map<string, (payload: unknown) => void>();
  private connectNonce: string | null = null;
  private connectSent = false;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private token: string | undefined;
  onConnected?: () => void;
  onDisconnected?: () => void;

  private _emit: (data: string, source?: 'stdout' | 'stderr') => void = () => {};
  private _sendToRenderer: (channel: string, payload: unknown) => boolean = () => false;

  setDeps(emit: (data: string, source?: 'stdout' | 'stderr') => void, sendToRenderer: (channel: string, payload: unknown) => boolean): void {
    this._emit = emit;
    this._sendToRenderer = sendToRenderer;
  }

  connect(wsUrl: string, token?: string): void {
    this.token = token;
    this.connectNonce = null;
    this.connectSent = false;

    // Diagnostic log
    this._emit(`[gateway-ws] attempting connection to ${wsUrl}...\n`, 'stdout');

    try {
      const ws = new WebSocket(wsUrl, {
        handshakeTimeout: 5000,
      });
      this.ws = ws;

      ws.on('open', () => {
        this._emit('[gateway-ws] socket opened, waiting for handshake...\n', 'stdout');
        this.connectTimer = setTimeout(() => { void this.sendConnect(); }, 200);
      });

      ws.on('message', (data) => {
        let frame: unknown;
        try { frame = JSON.parse(data.toString()); } catch { return; }
        this.handleFrame(frame);
      });

      ws.on('close', (code, reason) => {
        this._emit(`[gateway-ws] socket closed (code: ${code}, reason: ${reason.toString()})\n`, 'stderr');
        if (this.connectTimer !== null) { clearTimeout(this.connectTimer); this.connectTimer = null; }
        this.ws = null;
        this.rejectAllPending('WebSocket disconnected');
        this.onDisconnected?.();
      });

      ws.on('error', (err) => {
        this._emit(`[gateway-ws] socket error: ${err.message}\n`, 'stderr');
        if (this.connectTimer !== null) { clearTimeout(this.connectTimer); this.connectTimer = null; }
      });
    } catch (e) {
      this._emit(`[gateway-ws] initialization failed: ${(e as Error).message}\n`, 'stderr');
      this.onDisconnected?.();
    }
  }

  disconnect(): void {
    if (this.connectTimer !== null) { clearTimeout(this.connectTimer); this.connectTimer = null; }
    const ws = this.ws;
    this.ws = null;
    try { ws?.terminate(); } catch {}
    this.rejectAllPending('Client disconnected');
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('Gateway WebSocket not connected'));
        return;
      }
      const id = `r${++this.reqCounter}-${Date.now()}`;
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway request timed out: ${method}`));
      }, 30000);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timeoutId });
      try {
        this.ws!.send(JSON.stringify({ type: 'req', id, method, params: params ?? null }));
      } catch (e) {
        clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(new Error(`Gateway send failed: ${(e as Error).message}`));
      }
    });
  }

  subscribeChatEvent(sessionKey: string, listener: (payload: unknown) => void): () => void {
    this.chatListeners.set(sessionKey, listener);
    return () => this.chatListeners.delete(sessionKey);
  }

  get isConnected(): boolean {
    if (!this.ws) return false;
    return this.ws.readyState === WebSocket.OPEN;
  }

  private async sendConnect(): Promise<void> {
    if (this.connectSent) return;
    this.connectSent = true;
    if (this.connectTimer !== null) { clearTimeout(this.connectTimer); this.connectTimer = null; }

    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'cli',
        version: '1.0.0',
        platform: process.platform,
        mode: 'cli',
      },
      role: 'operator',
      scopes: ['*'],
      caps: ['chat.stream', 'chat.buttons', 'chat.history', 'chat.thinking', 'chat.tools'],
      auth: this.token ? { token: this.token } : undefined,
    };

    try {
      await this.request<unknown>('connect', params);
      this.onConnected?.();
    } catch (e) {
      this._emit(`[gateway-ws] connect request rejected: ${e instanceof Error ? e.message : String(e)}\n`, 'stderr');
      this.ws?.close(4008, 'connect failed');
    }
  }

  private handleFrame(frame: unknown): void {
    const f = frame as { type?: string; event?: string; payload?: Record<string, unknown>; id?: string; ok?: boolean; error?: unknown };
    if (f.type === 'event') {
      const evt = f.event;
      if (evt === 'connect.challenge') {
        const nonce = typeof f.payload?.nonce === 'string' ? f.payload.nonce : null;
        if (nonce) {
          this.connectNonce = nonce;
          void this.sendConnect();
        }
        return;
      }
      if (evt === 'chat') {
        this.dispatchChatEvent(f.payload);
      }
      return;
    }

    if (f.type === 'res') {
      const pending = this.pending.get(f.id ?? '');
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pending.delete(f.id ?? '');
        if (f.ok) {
          pending.resolve(f.payload ?? null);
        } else {
          pending.reject(new Error(String((f.error as { message?: string })?.message || f.error || 'Gateway error')));
        }
      }
      return;
    }
  }

  private dispatchChatEvent(payload: unknown): void {
    const p = payload as Record<string, unknown>;
    const sessionKey = String(p?.sessionKey || '');
    if (sessionKey && this.chatListeners.has(sessionKey)) {
      this.chatListeners.get(sessionKey)!(payload);
    } else if (!sessionKey) {
      for (const listener of this.chatListeners.values()) {
        listener(payload);
      }
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

// ── Gateway WebSocket singleton ───────────────────────────────────────────────

let gwsClient: GatewayWSClient | null = null;
const activeChatRequests = new Map<string, { sessionKey: string; runId?: string; agentId?: string; aborted: boolean; startedAtMs: number; preview?: string }>();

// Concurrency lock: ensures only one connection attempt runs at a time.
// Subsequent callers await the same Promise instead of spawning a new client.
let connectingPromise: Promise<{ ok: boolean; error?: string }> | null = null;

export function disconnectGatewayWs(): void {
  connectingPromise = null;
  gwsClient?.disconnect();
  gwsClient = null;
}

async function ensureGatewayWsConnected(ctx: ChatHandlerContext): Promise<{ ok: boolean; error?: string }> {
  if (gwsClient?.isConnected) return { ok: true };

  // Re-use an in-flight connection attempt rather than creating a parallel one.
  if (connectingPromise) return connectingPromise;

  // Tear down any dead (disconnected) client before starting fresh.
  gwsClient?.disconnect();
  gwsClient = null;

  const runtime = await resolveOpenClawRuntime();
  const { gatewayPort, gatewayToken } = runtime;

  if (!gatewayPort || !/^\d+$/.test(gatewayPort)) {
    const err = 'No gateway port configured in openclaw.json (gateway.port)';
    ctx.emitShellStdout(`[gateway-ws] ${err}\n`, 'stderr');
    return { ok: false, error: err };
  }

  const portNum = Number.parseInt(gatewayPort, 10);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return { ok: false, error: `Invalid gateway port: ${gatewayPort}` };
  }

  const wsUrl = `ws://localhost:${gatewayPort}`;
  ctx.emitShellStdout(`[gateway-ws] connecting to ${wsUrl} (using port from openclaw.json)${gatewayToken ? ' (with token)' : ''}\n`, 'stdout');

  connectingPromise = new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const client = new GatewayWSClient();
    client.setDeps(ctx.emitShellStdout, ctx.sendToRenderer);
    let settled = false;

    const settle = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      connectingPromise = null;
      if (result.ok) {
        gwsClient = client;
        gwsClient.onDisconnected = () => {
          ctx.emitShellStdout('[gateway-ws] disconnected\n', 'stderr');
          ctx.sendToRenderer('openclaw:gateway.status', { connected: false });
        };
        ctx.emitShellStdout('[gateway-ws] connected successfully!\n', 'stdout');
        ctx.sendToRenderer('openclaw:gateway.status', { connected: true });
      } else {
        ctx.emitShellStdout(`[gateway-ws] failed to connect to ${wsUrl}: ${result.error}\n`, 'stderr');
        client.disconnect();
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      settle({ ok: false, error: `Connection timeout after 15s (Check if OpenClaw is running on port ${gatewayPort})` });
    }, 15000);

    client.onConnected = () => {
      clearTimeout(timer);
      settle({ ok: true });
    };

    client.onDisconnected = () => {
      clearTimeout(timer);
      settle({ ok: false, error: `Connection refused. Please ensure OpenClaw core is active and listening on port ${gatewayPort}` });
    };

    client.connect(wsUrl, gatewayToken || undefined);
  });

  return connectingPromise;
}

// ── IPC Handlers ─────────────────────────────────────────────────────────────

export function registerChatHandler(ctx: ChatHandlerContext): void {
  ipcMain.handle('openclaw:chat.invoke', async (_event, request: OpenClawChatInvokeRequest) => {
    if (!request?.requestId || !request?.sessionKey || !request?.agentId || !request?.message) {
      return {
        success: false,
        requestId: request?.requestId || '',
        error: 'Missing request parameters',
      };
    }

    const runtime = await resolveOpenClawRuntime();
    if (!runtime.openclawPrefix) {
      return {
        success: false,
        requestId: request.requestId,
        error: 'OpenClaw runtime not configured',
      };
    }

    if (runtime.gatewayUrlArg && !runtime.gatewayAuthArg) {
      return {
        success: false,
        requestId: request.requestId,
        error: t('main.ipc.errors.gatewayAuthMissing'),
        reason: 'gateway-explicit-auth-missing',
      };
    }

    const messageId = `${request.requestId}-assistant`;

    if (request.forceLocal) {
      return {
        success: false,
        requestId: request.requestId,
        messageId,
        mode: 'gateway' as const,
        reason: 'core-required-force-local-blocked',
        error: t('main.ipc.errors.forceGateway'),
      };
    }

    const wsResult = await ensureGatewayWsConnected(ctx);
    if (!wsResult.ok) {
      return {
        success: false,
        requestId: request.requestId,
        messageId,
        mode: 'gateway' as const,
        reason: 'gateway-ws-unavailable',
        error: wsResult.error || t('main.ipc.errors.coreNotStarted'),
      };
    }

    const params: Record<string, unknown> = {
      message: request.message,
      deliver: Boolean(request.deliver),
      idempotencyKey: request.requestId,
      sessionKey: request.sessionKey,
      agentId: request.agentId,
      // Double-down on scope declaration in the request itself
      scope: 'operator.write',
      scopes: ['operator.write', 'chat.write', '*'],
    };

    activeChatRequests.set(request.requestId, {
      sessionKey: String(request.sessionKey || '').trim(),
      agentId: String(request.agentId || '').trim(),
      aborted: false,
      startedAtMs: Date.now(),
      preview: String(request.message || '').trim().slice(0, 140),
    });

    const emitChunk = (payload: { delta?: string; done?: boolean; state?: string; error?: string; toolCall?: unknown }) => {
      ctx.sendToRenderer('openclaw:chat.chunk', {
        requestId: request.requestId,
        messageId,
        delta: payload.delta || '',
        done: payload.done,
        state: payload.state,
        error: payload.error,
        toolCall: payload.toolCall,
        mode: 'gateway' as const,
        reason: '',
      });
    };

    const unsubscribe = gwsClient!.subscribeChatEvent(request.sessionKey, (payload) => {
      const chatState = activeChatRequests.get(request.requestId);
      if (!chatState) return;
      if (chatState.aborted) {
        unsubscribe();
        activeChatRequests.delete(request.requestId);
        return;
      }
      const p = payload as Record<string, unknown>;
      const state = String(p?.state || '');
      if (state === 'delta') {
        const delta = extractMessageText(p?.message);
        if (delta) emitChunk({ delta, state: 'delta' });
      } else if (state === 'tool_use' || state === 'thinking') {
        const toolCall = p?.toolCall || (p?.message as Record<string, unknown>)?.toolCall;
        emitChunk({ state, toolCall });
      } else if (state === 'final') {
        unsubscribe();
        emitChunk({ done: true, state: 'final' });
        activeChatRequests.delete(request.requestId);
      } else if (state === 'aborted') {
        unsubscribe();
        emitChunk({ done: true, state: 'aborted' });
        activeChatRequests.delete(request.requestId);
      } else if (state === 'error') {
        const errorMsg = String(p?.error || p?.message || 'Chat error');
        unsubscribe();
        emitChunk({ error: errorMsg, done: true, state: 'error' });
        activeChatRequests.delete(request.requestId);
      }
    });

    try {
      const sendResult = await gwsClient!.request<unknown>('chat.send', params);
      const runId = extractRunIdFromSendPayload(sendResult);
      if (runId) {
        const state = activeChatRequests.get(request.requestId);
        if (state) activeChatRequests.set(request.requestId, { ...state, runId });
      }
    } catch (e) {
      unsubscribe();
      activeChatRequests.delete(request.requestId);
      const errorMsg = (e as Error).message || 'Failed to send chat message';
      
      // If scopes are missing, force a disconnect so the next attempt will reconnect with new scopes
      if (errorMsg.includes('scope') || errorMsg.includes('permission')) {
        disconnectGatewayWs();
      }

      return {
        success: false,
        requestId: request.requestId,
        messageId,
        mode: 'gateway' as const,
        reason: '',
        error: errorMsg,
      };
    }

    return {
      success: true,
      requestId: request.requestId,
      messageId,
      mode: 'gateway' as const,
      reason: '',
    };
  });

  ipcMain.handle('openclaw:chat.abort', async (_event, requestId: string) => {
    const chatState = activeChatRequests.get(requestId);
    if (!chatState) {
      return { success: false, error: 'No active chat request' };
    }

    activeChatRequests.set(requestId, { ...chatState, aborted: true });

    if (!gwsClient?.isConnected) {
      return { success: false, error: 'Gateway WebSocket not connected' };
    }

    try {
      const abortParams: Record<string, unknown> = { sessionKey: chatState.sessionKey };
      if (chatState.runId) abortParams.runId = chatState.runId;
      if (chatState.agentId) abortParams.agentId = chatState.agentId;

      await gwsClient.request('chat.abort', abortParams);
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  });

  ipcMain.handle('openclaw:gateway.ws-ensure', async () => {
    const result = await ensureGatewayWsConnected(ctx);
    return { connected: result.ok, error: result.error };
  });

  ipcMain.handle('openclaw:gateway.ws-status', () => {
    return { connected: gwsClient?.isConnected ?? false };
  });

  ipcMain.handle('openclaw:sessions.list', async (_event, payloadRaw?: string) => {
    try {
      const opts = payloadRaw ? (() => { try { return JSON.parse(payloadRaw); } catch { return {}; } })() : {};
      const limit = (Number.isFinite(Number(opts?.limit)) && Number(opts.limit) > 0) ? Number(opts.limit) : 20;
      const offset = (Number.isFinite(Number(opts?.offset)) && Number(opts.offset) >= 0) ? Number(opts.offset) : 0;

      const { stateDir } = await readLauncherConfigPaths();
      const base = stateDir || path.join(HOME, '.openclaw');
      const agentsDir = path.join(base, 'agents');

      // ── Phase 1: fast metadata pass — read only sessions.json indexes ─────
      type SessionMeta = {
        sessionKey: string;
        agentId: string;
        sessionId: string;
        displayName: string;
        updatedAt: string;
        sessionFile: string;
        indexMeta: Record<string, unknown>;
      };
      const allMeta: SessionMeta[] = [];

      let agentIds: string[] = [];
      try {
        agentIds = await fs.readdir(agentsDir);
      } catch {
        return { code: 0, stdout: JSON.stringify({ sessions: [], total: 0, hasMore: false }), stderr: '' };
      }

      for (const agentId of agentIds) {
        const sessionsDir = path.join(agentsDir, agentId, 'sessions');
        const sessionsJsonPath = path.join(sessionsDir, 'sessions.json');

        let sessionsIndex: Record<string, unknown> = {};
        try {
          const raw = await fs.readFile(sessionsJsonPath, 'utf-8');
          sessionsIndex = JSON.parse(raw);
        } catch {
          continue;
        }

        for (const [sessionKey, metaRaw] of Object.entries(sessionsIndex) as [string, unknown][]) {
          const meta = metaRaw as Record<string, unknown>;
          const sessionId = String(meta?.sessionId || '');
          if (!sessionId) continue;
          const sessionFile: string = (typeof meta?.sessionFile === 'string' && meta.sessionFile)
            ? (meta.sessionFile as string)
            : path.join(sessionsDir, `${sessionId}.jsonl`);
          allMeta.push({
            sessionKey,
            agentId,
            sessionId,
            displayName: deriveSessionDisplayName(sessionKey, meta),
            updatedAt: String(meta?.updatedAt || ''),
            sessionFile,
            indexMeta: meta,
          });
        }
      }

      // Deduplicate: for cron sessions, group all :run:<uuid> variants under the base
      // job key so each cron job shows only its most recent run.
      const cronBaseKey = (sk: string) => { const i = sk.indexOf(':run:'); return i !== -1 ? sk.slice(0, i) : sk; };
      const dedupMap = new Map<string, SessionMeta>();
      for (const m of allMeta) {
        const groupKey = cronBaseKey(m.sessionKey);
        const existing = dedupMap.get(groupKey);
        if (!existing) {
          dedupMap.set(groupKey, m);
        } else {
          const ta = Number(m.updatedAt) || new Date(m.updatedAt).getTime() || 0;
          const tb = Number(existing.updatedAt) || new Date(existing.updatedAt).getTime() || 0;
          if (ta > tb) dedupMap.set(groupKey, m);
        }
      }
      const dedupedMeta = Array.from(dedupMap.values());

      // Sort descending by updatedAt
      dedupedMeta.sort((a, b) => {
        const ta = Number(a.updatedAt) || new Date(a.updatedAt).getTime() || 0;
        const tb = Number(b.updatedAt) || new Date(b.updatedAt).getTime() || 0;
        return tb - ta;
      });

      const total = dedupedMeta.length;
      const slice = dedupedMeta.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      // ── Phase 2: extract metadata only (no .jsonl read) ────────────────────
      const sessions: Array<{
        sessionKey: string;
        agentId: string;
        sessionId: string;
        displayName: string;
        lastMessage: string;
        lastTimestamp: string;
        messageCount: number;
      }> = new Array(slice.length);

      // Read only the tail of each .jsonl in parallel — no full-file scan
      await Promise.all(slice.map(async (m, idx) => {
        // Prefer metadata fields if available (avoid file I/O entirely)
        const metaMsg = String(m.indexMeta?.lastMessage || m.indexMeta?.preview || '').trim();
        const metaTs  = String(m.indexMeta?.lastTimestamp || m.updatedAt || '');
        const msgCount = Number.isFinite(Number(m.indexMeta?.messageCount))
          ? Number(m.indexMeta.messageCount)
          : -1;

        let lastMessage = metaMsg.slice(0, 100);
        let lastTimestamp = metaTs;

        if (!lastMessage) {
          const tail = await readLastJsonlMessage(m.sessionFile);
          lastMessage = tail.lastMessage;
          if (tail.lastTimestamp) lastTimestamp = tail.lastTimestamp;
        }

        sessions[idx] = {
          sessionKey: m.sessionKey,
          agentId: m.agentId,
          sessionId: m.sessionId,
          displayName: m.displayName,
          lastMessage,
          lastTimestamp,
          messageCount: msgCount,
        };
      }));
      // Preserve sort order (Promise.all preserves index)
      sessions.length = slice.length;

      return { code: 0, stdout: JSON.stringify({ sessions, total, hasMore }), stderr: '' };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'Unknown error' };
    }
  });

  ipcMain.handle('openclaw:session.load', async (_event, payload: { sessionKey: string; agentId: string }) => {
    try {
      const sessionKey = String(payload?.sessionKey || '').trim();
      const agentId = String(payload?.agentId || '').trim();
      if (!sessionKey || !agentId) {
        return { code: 1, stdout: '', stderr: 'Missing sessionKey or agentId' };
      }

      const { stateDir } = await readLauncherConfigPaths();
      const base = stateDir || path.join(HOME, '.openclaw');
      const sessionsDir = path.join(base, 'agents', agentId, 'sessions');

      let sessionFile = '';
      try {
        const raw = await fs.readFile(path.join(sessionsDir, 'sessions.json'), 'utf-8');
        const index = JSON.parse(raw) as Record<string, unknown>;
        const meta = index[sessionKey] as Record<string, unknown>;
        if (meta?.sessionFile && typeof meta.sessionFile === 'string') {
          sessionFile = meta.sessionFile as string;
        } else if (meta?.sessionId) {
          sessionFile = path.join(sessionsDir, `${meta.sessionId}.jsonl`);
        }
      } catch {
        sessionFile = path.join(sessionsDir, `${sessionKey}.jsonl`);
      }
      if (!sessionFile) {
        return { code: 0, stdout: JSON.stringify([]), stderr: '' };
      }

      let content = '';
      try {
        content = await fs.readFile(sessionFile, 'utf-8');
      } catch {
        return { code: 0, stdout: JSON.stringify([]), stderr: '' };
      }

      const messages: Array<{
        id: string;
        role: 'user' | 'assistant';
        content: string;
        timestamp: string;
      }> = [];

      const lines = content.split(/\r?\n/).filter(Boolean);
      let idx = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type !== 'message') continue;
          const role = entry.message?.role as string;
          if (role !== 'user' && role !== 'assistant') continue;
          const text = extractMessageText(entry.message);
          if (!text) continue;
          messages.push({
            id: String(entry.id || entry.message?.id || `loaded-${agentId}-${idx++}`),
            role: role as 'user' | 'assistant',
            content: text,
            timestamp: String(entry.timestamp || ''),
          });
        } catch { /* skip malformed line */ }
      }

      return { code: 0, stdout: JSON.stringify(messages), stderr: '' };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'Unknown error' };
    }
  });

  ipcMain.handle('openclaw:session.abort', async (_event, payload?: string) => {
    try {
      const opts = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
      const sessionKey = String(opts?.sessionKey || '').trim();
      if (!sessionKey) {
        return { success: false, error: 'sessionKey is required' };
      }
      const agentId = String(opts?.agentId || 'main').trim();

      // Ensure gateway WS is connected so we can always attempt a direct abort.
      if (!gwsClient?.isConnected) {
        const wsResult = await ensureGatewayWsConnected(ctx);
        if (!wsResult.ok) {
          return { success: false, error: wsResult.error || 'Gateway WebSocket not connected' };
        }
      }

      for (const [reqId, state] of activeChatRequests.entries()) {
        const stateSessionKey = String(state.sessionKey || '').trim();
        const stateAgentId = String(state.agentId || '').trim();
        if (stateSessionKey === sessionKey && (!opts.agentId || stateAgentId === agentId)) {
          activeChatRequests.set(reqId, { ...state, aborted: true });
          if (gwsClient?.isConnected) {
            try {
              const abortParams: Record<string, unknown> = { sessionKey };
              if (state.runId) abortParams.runId = state.runId;
              if (state.agentId) abortParams.agentId = state.agentId;
              await gwsClient.request('chat.abort', abortParams);
              return { success: true };
            } catch (e) {
              return { success: false, error: (e as Error)?.message || 'abort failed' };
            }
          }
        }
      }

      // Fallback: session may come from scanned index/CLI instead of in-memory map.
      try {
        const abortParams: Record<string, unknown> = { sessionKey };
        if (agentId) abortParams.agentId = agentId;
        await gwsClient!.request('chat.abort', abortParams);
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error)?.message || 'no active chat request found for this session' };
      }
    } catch (e) {
      return { success: false, error: (e as Error)?.message || 'abort session failed' };
    }
  });

  ipcMain.handle('openclaw:sessions.scan', async (_event, payload?: string) => {
    try {
      const opts = payload ? (() => { try { return JSON.parse(payload); } catch { return {}; } })() : {};
      const activeMinutes = Number(opts?.activeMinutes ?? 3);
      const now = Date.now();
      const activeWindowMs = Math.max(1, activeMinutes) * 60 * 1000;
      const indexRunningHeartbeatMs = Number(opts?.runningHeartbeatMs ?? 90_000);
      const byKey = new Map<string, {
        key: string;
        kind: string;
        updatedAt: string;
        ageMs: number;
        sessionId: string;
        agentId?: string;
        displayName?: string;
        lastMessage?: string;
        model?: string;
        source: 'memory' | 'index';
        isRunning: boolean;
      }>();

      // Source 1: track in-flight requests in memory (real running tasks started from this app)
      for (const [, state] of activeChatRequests.entries()) {
        const ts = state.startedAtMs || now;
        const key = String(state.sessionKey || '').trim();
        if (!key) continue;
        byKey.set(key, {
          key,
          kind: 'chat',
          updatedAt: new Date(ts).toISOString(),
          ageMs: Math.max(0, now - ts),
          sessionId: state.runId || key,
          agentId: state.agentId || 'main',
          displayName: extractCronDisplayNameFromText(state.preview || '') || deriveSessionDisplayName(key, { sessionId: state.runId || key, updatedAt: new Date(ts).toISOString() }),
          lastMessage: state.preview || '',
          model: state.agentId || 'main',
          source: 'memory',
          isRunning: !state.aborted,
        });
      }

      // Source 2: scan OpenClaw session indexes so external/CLI tasks can still be observed.
      const { stateDir } = await readLauncherConfigPaths();
      const base = stateDir || path.join(HOME, '.openclaw');
      const agentsDir = path.join(base, 'agents');
      let agentIds: string[] = [];
      try { agentIds = await fs.readdir(agentsDir); } catch { agentIds = []; }

      for (const agentId of agentIds) {
        const sessionsJsonPath = path.join(agentsDir, agentId, 'sessions', 'sessions.json');
        let sessionsIndex: Record<string, unknown> = {};
        try {
          const raw = await fs.readFile(sessionsJsonPath, 'utf-8');
          sessionsIndex = JSON.parse(raw);
        } catch {
          continue;
        }

        for (const [sessionKey, metaRaw] of Object.entries(sessionsIndex) as [string, unknown][]) {
          const meta = metaRaw as Record<string, unknown>;
          const normalizedKey = String(sessionKey || '').trim();
          if (!normalizedKey) continue;
          const updatedAtRaw = String(meta?.updatedAt || '').trim();
          const updatedMs = updatedAtRaw ? (new Date(updatedAtRaw).getTime() || Number(updatedAtRaw) || 0) : 0;
          if (!updatedMs) continue;
          const ageMs = Math.max(0, now - updatedMs);
          if (ageMs > activeWindowMs) continue;

          const existing = byKey.get(normalizedKey);
          // Always keep in-memory live state over indexed historical state.
          if (existing?.source === 'memory') continue;
          if (existing && existing.ageMs <= ageMs) continue;

          const sessionId = String(meta?.sessionId || normalizedKey);
          let displayName = deriveSessionDisplayName(normalizedKey, meta);
          let lastMessage = '';
          let titleHint = '';

          const sessionFile: string = (typeof meta?.sessionFile === 'string' && meta.sessionFile)
            ? String(meta.sessionFile)
            : path.join(agentsDir, agentId, 'sessions', `${sessionId}.jsonl`);

          // Regex for completion markers in assistant messages
          const DONE_PATTERN = /[✅☑️✔️]|完成|已完成|done|finished|completed|succeeded|成功|sprint.*完成|合併.*完成/i;
          let lastAssistantText = '';
          let lastMessageRole = '';
          let isCompletedByContent = false;

          try {
            const content = await fs.readFile(sessionFile, 'utf-8');
            const lines = content.split(/\r?\n/).filter(Boolean);
            // Scan forward: collect title hint, lastMessage, and last assistant text
            for (let i = 0; i < lines.length; i++) {
              try {
                const entry = JSON.parse(lines[i]);
                if (entry?.type !== 'message') continue;
                const role = entry?.message?.role;
                if (role !== 'assistant' && role !== 'user') continue;
                const text = extractMessageText(entry.message);
                if (!text) continue;
                lastMessageRole = role;
                if (!titleHint) titleHint = extractCronDisplayNameFromText(text);
                lastMessage = text.slice(0, 160);
                if (role === 'assistant') lastAssistantText = text;
              } catch {
                continue;
              }
            }
            // Detect completion from last assistant message
            if (lastAssistantText && DONE_PATTERN.test(lastAssistantText)) {
              isCompletedByContent = true;
            }
          } catch {
            lastMessage = '';
          }

          if (titleHint) displayName = titleHint;

          // Determine running state:
          // - 'main' type is a persistent daemon listener (not a one-shot task); only mark
          //   running if in-memory (handled in source-1 above), never from index.
          // - cron/subagent: prefer explicit run state from session index; fallback to heartbeat.
          const sessionType = normalizedKey.split(':')[2] || '';
          const isPersistentMain = sessionType === 'main';
          const runStateText = String(meta?.runState || meta?.status || meta?.state || '').toLowerCase();
          const hasExplicitRunningState = /(^|\b)(running|in_progress|in-progress|pending|initializing|streaming|executing|working)(\b|$)/.test(runStateText);
          const hasExplicitStoppedState = /(^|\b)(done|completed|success|succeeded|failed|error|aborted|stopped|cancelled|canceled|idle)(\b|$)/.test(runStateText);
          const isRunningFromIndex = !isPersistentMain
            && meta?.abortedLastRun !== true
            && !isCompletedByContent;
          const isHeartbeatFresh = ageMs <= Math.max(5_000, indexRunningHeartbeatMs);

          // Persistent main daemon (agent:main:main): exclude from normal isRunning path.
          // Instead, show as running only when it has a fresh updatedAt AND a non-empty
          // deliveryContext target — meaning it recently processed / is processing a message.
          if (isPersistentMain) {
            const dc = meta?.deliveryContext as Record<string, unknown> | undefined;
            const channel = String(dc?.channel || '').trim().toLowerCase();
            const lastTo = String(meta?.lastTo || dc?.to || '').trim();
            const persistentMainHasTarget = Boolean(lastTo);
            const lastAssistantTrimmed = lastAssistantText.trim();
            const isNoReply = lastAssistantTrimmed === 'NO_REPLY';
            const isHeartbeatAck = lastAssistantTrimmed === 'HEARTBEAT_OK';
            const persistentMainHasActiveSignal = hasExplicitRunningState
              || isNoReply
              || isHeartbeatAck
              || (isHeartbeatFresh && lastMessageRole !== 'assistant')
              || (isHeartbeatFresh && !isCompletedByContent);
            const persistentMainIdleThresholdMs = 5 * 60 * 1000; // 5 minutes
            const persistentMainHasStopSignal = meta?.abortedLastRun === true
              || (lastMessageRole === 'assistant' && (hasExplicitStoppedState || isCompletedByContent))
              || (!isHeartbeatFresh && hasExplicitStoppedState)
              || (lastMessageRole === 'assistant' && ageMs > persistentMainIdleThresholdMs);
            const persistentMainIsRunning = persistentMainHasTarget
              && persistentMainHasActiveSignal
              && !persistentMainHasStopSignal;

            // isPersistentMain is a long-lived daemon, so completion/error text in the last
            // reply should only hide it after the heartbeat has gone stale.
            // Keep it in the session list within activeWindowMs so the UI can show it as
            // recently active instead of making the card disappear entirely.
            if (persistentMainHasTarget) {
              const normalizedTarget = channel === 'telegram'
                ? lastTo.replace(/^telegram:/, '')
                : lastTo;
              const targetDisplay = channel === 'telegram'
                ? `Telegram 私訊 ${normalizedTarget}`
                : normalizedTarget;
              const toDisplay = `Main Session · ${targetDisplay}`;
              byKey.set(normalizedKey, {
                key: normalizedKey,
                kind: 'session',
                updatedAt: new Date(updatedMs).toISOString(),
                ageMs,
                sessionId,
                agentId,
                displayName: toDisplay || displayName,
                lastMessage,
                model: String(meta?.model || ''),
                source: 'index',
                isRunning: persistentMainIsRunning,
              });
            }
            continue;
          }

          const isRunning = isRunningFromIndex && (hasExplicitRunningState || (!hasExplicitStoppedState && isHeartbeatFresh));

          byKey.set(normalizedKey, {
            key: normalizedKey,
            kind: 'session',
            updatedAt: new Date(updatedMs).toISOString(),
            ageMs,
            sessionId,
            agentId,
            displayName,
            lastMessage,
            model: String(meta?.model || ''),
            source: 'index',
            isRunning,
          });
        }
      }

      const sessions = Array.from(byKey.values()).sort((a, b) => a.ageMs - b.ageMs);
      return { code: 0, stdout: JSON.stringify({ sessions }), stderr: '' };
    } catch (e) {
      return { code: 1, stdout: '', stderr: (e as Error)?.message || 'scan active sessions failed' };
    }
  });
}
