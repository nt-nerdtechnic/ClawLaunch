import { ipcMain, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { resolveOpenClawRuntime, isGatewayOnlineFromStatus } from '../services/openclaw-runtime.js';
import { t } from '../utils/i18n.js';
import { extractMessageText, deriveSessionDisplayName, extractRunIdFromSendPayload } from '../utils/chat-helpers.js';
import { readLauncherConfigPaths } from '../services/activity-watcher.js';

const HOME = process.env['HOME'] || '';

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

    const WS = (globalThis as Record<string, unknown>).WebSocket as (new (url: string) => WebSocket) | undefined;
    if (!WS) {
      this._emit('[gateway-ws] WebSocket not available in this environment\n', 'stderr');
      this.onDisconnected?.();
      return;
    }

    const ws: WebSocket = new WS(wsUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.connectTimer = setTimeout(() => { void this.sendConnect(); }, 1000);
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      let frame: unknown;
      try { frame = JSON.parse(String(event.data)); } catch { return; }
      this.handleFrame(frame);
    });

    ws.addEventListener('close', () => {
      if (this.connectTimer !== null) { clearTimeout(this.connectTimer); this.connectTimer = null; }
      this.ws = null;
      this.rejectAllPending('WebSocket disconnected');
      this.onDisconnected?.();
    });

    ws.addEventListener('error', (err) => {
      this._emit(`[gateway-ws] socket error: ${String((err as ErrorEvent)?.message || err)}\n`, 'stderr');
    });
  }

  disconnect(): void {
    if (this.connectTimer !== null) { clearTimeout(this.connectTimer); this.connectTimer = null; }
    const ws = this.ws;
    this.ws = null;
    try { (ws as WebSocket)?.close(); } catch {}
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
    return this.ws.readyState === 1;
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
        version: app.getVersion() || 'dev',
        platform: process.platform,
        mode: 'cli',
      },
      role: 'operator',
      scopes: ['operator.admin', 'operator.approvals'],
      caps: [],
      auth: this.token ? { token: this.token } : undefined,
    };

    try {
      await this.request<unknown>('connect', params);
      this.onConnected?.();
    } catch (e) {
      this._emit(`[gateway-ws] connect request rejected: ${e instanceof Error ? e.message : String(e)}\n`, 'stderr');
      (this.ws as WebSocket)?.close(4008, 'connect failed');
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
const activeChatRequests = new Map<string, { sessionKey: string; runId?: string; agentId?: string; aborted: boolean }>();

export function disconnectGatewayWs(): void {
  gwsClient?.disconnect();
  gwsClient = null;
}

async function ensureGatewayWsConnected(ctx: ChatHandlerContext): Promise<{ ok: boolean; error?: string }> {
  if (gwsClient?.isConnected) return { ok: true };

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

  const wsUrl = `ws://127.0.0.1:${gatewayPort}`;
  ctx.emitShellStdout(`[gateway-ws] connecting to ${wsUrl}${gatewayToken ? ' (with token)' : ''}\n`, 'stdout');

  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const client = new GatewayWSClient();
    client.setDeps(ctx.emitShellStdout, ctx.sendToRenderer);
    let settled = false;

    const settle = (result: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      if (result.ok) {
        gwsClient = client;
        gwsClient.onDisconnected = () => {
          ctx.emitShellStdout('[gateway-ws] disconnected\n', 'stderr');
          ctx.sendToRenderer('openclaw:gateway.status', { connected: false });
        };
        ctx.emitShellStdout('[gateway-ws] connected\n', 'stdout');
        ctx.sendToRenderer('openclaw:gateway.status', { connected: true });
      } else {
        ctx.emitShellStdout(`[gateway-ws] failed: ${result.error}\n`, 'stderr');
        client.disconnect();
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      settle({ ok: false, error: 'WebSocket connection timeout (15s)' });
    }, 15000);

    client.onConnected = () => {
      clearTimeout(timer);
      settle({ ok: true });
    };

    client.onDisconnected = () => {
      clearTimeout(timer);
      settle({ ok: false, error: `WebSocket connection refused (port ${gatewayPort})` });
    };

    client.connect(wsUrl, gatewayToken || undefined);
  });
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

    const statusRes = await ctx.runShellCommand(`${runtime.openclawPrefix} gateway status --json`);
    const gatewayOnline = isGatewayOnlineFromStatus(statusRes);
    if (!gatewayOnline) {
      return {
        success: false,
        requestId: request.requestId,
        messageId,
        mode: 'gateway' as const,
        reason: 'core-required-gateway-offline',
        error: t('main.ipc.errors.coreNotStarted'),
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
        error: wsResult.error || 'Cannot connect to gateway WebSocket',
      };
    }

    const params: Record<string, unknown> = {
      message: request.message,
      deliver: Boolean(request.deliver),
      idempotencyKey: request.requestId,
    };

    activeChatRequests.set(request.requestId, {
      sessionKey: request.sessionKey,
      agentId: request.agentId,
      aborted: false,
    });

    const emitChunk = (payload: { delta?: string; done?: boolean; state?: string; error?: string }) => {
      ctx.sendToRenderer('openclaw:chat.chunk', {
        requestId: request.requestId,
        messageId,
        delta: payload.delta || '',
        done: payload.done,
        state: payload.state,
        error: payload.error,
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
      return {
        success: false,
        requestId: request.requestId,
        messageId,
        mode: 'gateway' as const,
        reason: '',
        error: (e as Error).message || 'Failed to send chat message',
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

  ipcMain.handle('openclaw:sessions.list', async () => {
    try {
      const { stateDir } = await readLauncherConfigPaths();
      const base = stateDir || path.join(HOME, '.openclaw');
      const agentsDir = path.join(base, 'agents');

      const sessions: Array<{
        sessionKey: string;
        agentId: string;
        sessionId: string;
        displayName: string;
        lastMessage: string;
        lastTimestamp: string;
        messageCount: number;
      }> = [];

      let agentIds: string[] = [];
      try {
        agentIds = await fs.readdir(agentsDir);
      } catch {
        return { code: 0, stdout: JSON.stringify([]), stderr: '' };
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

          let content = '';
          try {
            content = await fs.readFile(sessionFile, 'utf-8');
          } catch {
            sessions.push({
              sessionKey,
              agentId,
              sessionId,
              displayName: deriveSessionDisplayName(sessionKey, meta),
              lastMessage: '',
              lastTimestamp: String(meta?.updatedAt || ''),
              messageCount: 0,
            });
            continue;
          }

          const lines = content.split(/\r?\n/).filter(Boolean);
          let lastMessage = '';
          let lastTimestamp = '';
          let messageCount = 0;

          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.type !== 'message') continue;
              messageCount++;
              if (entry.timestamp) lastTimestamp = String(entry.timestamp);
              const role = entry.message?.role;
              if (role === 'assistant' || role === 'user') {
                const text = extractMessageText(entry.message);
                if (text) lastMessage = text.slice(0, 100);
              }
            } catch { /* skip malformed line */ }
          }

          sessions.push({
            sessionKey,
            agentId,
            sessionId,
            displayName: deriveSessionDisplayName(sessionKey, meta),
            lastMessage,
            lastTimestamp: lastTimestamp || String(meta?.updatedAt || ''),
            messageCount,
          });
        }
      }

      sessions.sort((a, b) => {
        const ta = Number(a.lastTimestamp) || new Date(a.lastTimestamp).getTime() || 0;
        const tb = Number(b.lastTimestamp) || new Date(b.lastTimestamp).getTime() || 0;
        return tb - ta;
      });

      return { code: 0, stdout: JSON.stringify(sessions), stderr: '' };
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
}
