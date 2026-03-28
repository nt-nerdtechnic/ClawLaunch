export {};

declare global {
  interface OpenClawSessionEntry {
    sessionKey: string;
    agentId: string;
    sessionId: string;
    displayName: string;
    lastMessage: string;
    lastTimestamp: string;
    messageCount: number;
  }

  interface OpenClawChatRequest {
    requestId: string;
    sessionKey: string;
    agentId: string;
    message: string;
    stream?: boolean;
    deliver?: boolean;
    forceLocal?: boolean;
  }

  interface OpenClawChatResult {
    success: boolean;
    requestId: string;
    messageId?: string;
    content?: string;
    mode?: 'gateway' | 'local';
    reason?: string;
    error?: string;
  }

  interface OpenClawChatChunk {
    requestId: string;
    messageId: string;
    delta: string;
    done?: boolean;
    state?: 'delta' | 'final' | 'aborted' | 'error';
    error?: string;
    mode?: 'gateway' | 'local';
    reason?: string;
  }

  interface Window {
    electronAPI: {
      exec: (command: string, args?: string[]) => Promise<{ code: number; stdout: string; stderr: string; exitCode?: number }>;
      writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
      onLog: (callback: (payload: { data: string; source: 'stdout' | 'stderr' | 'system' }) => void) => () => void;
      resize: (mode: 'mini' | 'expanded') => void;
      selectDirectory: () => Promise<string | null>;
      openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
      killPortHolder: (port: number) => Promise<{
        success: boolean;
        port?: number;
        pids?: number[];
        killed?: number[];
        forceKilled?: number[];
        failed?: Array<{ pid: number; reason: string }>;
        error?: string;
      }>;
      findFreePort: (startPort?: number, endPort?: number) => Promise<{ port: number | null; error?: string }>;
      setTitle: (title: string) => Promise<void>;
      ackEvent: (payload: {
        eventId: string;
        ttlMs?: number;
        runtimeDir?: string;
        configPath?: string;
        workspacePath?: string;
        corePath?: string;
      }) => Promise<{ success: boolean; eventId?: string; ackedAt?: string; expiresAt?: string; runtimeDir?: string; error?: string }>;
      getEventState: (payload: {
        runtimeDir?: string;
        configPath?: string;
        workspacePath?: string;
        corePath?: string;
      }) => Promise<{ success: boolean; runtimeDir?: string; acks?: Record<string, { ackedAt: string; expiresAt: string }>; error?: string }>;
      invokeChat: (request: OpenClawChatRequest) => Promise<OpenClawChatResult>;
      abortChat: (requestId: string) => Promise<{ success: boolean; error?: string }>;
      ensureGatewayWs: () => Promise<{ connected: boolean; error?: string }>;
      listChatSessions: () => Promise<{ code: number; stdout: string; stderr: string }>;
      loadChatSession: (payload: { sessionKey: string; agentId: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
      onChatChunk: (callback: (chunk: OpenClawChatChunk) => void) => () => void;
      onGatewayStatus: (callback: (status: { connected: boolean }) => void) => () => void;
      scanSessions: (payload?: string) => Promise<{ code: number; stdout: string; stderr: string }>;
      listActivityEvents: (options: { limit?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
      scanActivityNow: () => Promise<{ code: number; stdout: string }>;
    };
  }
}
