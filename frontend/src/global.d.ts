export {};

declare global {
  interface Window {
    electronAPI: {
      exec: (command: string, args?: string[]) => Promise<{ code: number; stdout: string; stderr: string; exitCode?: number }>;
      onLog: (callback: (payload: { data: string; source: 'stdout' | 'stderr' | 'system' }) => void) => () => void;
      resize: (mode: 'mini' | 'expanded') => void;
      selectDirectory: () => Promise<string | null>;
      openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
      openExternal: (url: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}
