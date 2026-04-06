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

  interface Window {
    electronAPI: {
      exec: (command: string, args?: string[]) => Promise<{ code: number; stdout: string; stderr: string; exitCode?: number }>;
      writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
      readFileEncoded: (filePath: string, encoding: string) => Promise<{ success: boolean; content: string; error?: string }>;
      readFileBase64: (filePath: string) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
      detectEncoding: (filePath: string) => Promise<{ encoding: string; confidence: 'high' | 'medium' | 'low'; method: string; error?: string }>;
      onLog: (callback: (payload: { data: string; source: 'stdout' | 'stderr' | 'system' }) => void) => () => void;
      resize: (mode: 'mini' | 'expanded') => void;
      getWindowMode: () => Promise<'mini' | 'expanded'>;
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
      getGatewayInfo: () => Promise<{ baseUrl: string; token: string }>;
      listChatSessions: (payload?: { limit?: number; offset?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
      loadChatSession: (payload: { sessionKey: string; agentId: string }) => Promise<{ code: number; stdout: string; stderr: string }>;
      onGatewayStatus: (callback: (status: { connected: boolean }) => void) => () => void;
      scanActiveSessions: (payload?: { activeMinutes?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
      abortSession: (payload?: { sessionKey: string; agentId?: string }) => Promise<{ success: boolean; error?: string }>;
      scanSessions: (payload?: string) => Promise<{ code: number; stdout: string; stderr: string }>;
      listActivityEvents: (options: { limit?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
      scanActivityNow: () => Promise<{ code: number; stdout: string }>;
      launchChromeDebug: (port: number) => Promise<{ success: boolean; port?: number; error?: string }>;
      checkChromeDebug: (port: number) => Promise<{ running: boolean; port?: number }>;
    };
  }
}
