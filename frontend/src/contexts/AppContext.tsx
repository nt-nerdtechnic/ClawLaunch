import React, { createContext, useContext, type ReactNode } from 'react';
import type { Config, DetectedConfig, LogEntry, ReadModelSnapshot, AuditTimelineItem } from '../store';

/**
 * Global application context
 * Manages all App.tsx states and handlers centrally
 * Facilitates gradual migration to individual page components
 */

type EnvStatus = { node: 'loading' | 'ok' | 'error'; git: 'loading' | 'ok' | 'error'; pnpm: 'loading' | 'ok' | 'error' };

type AppContextType = {
  // Routing
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onboardingFinished: boolean;
  setOnboardingFinished: (finished: boolean) => void;

  // Config
  config: Config;
  setConfig: (config: Partial<Config>) => void;
  detectedConfig: DetectedConfig | null;
  setDetectedConfig: (config: DetectedConfig | null) => void;

  // Gateway
  running: boolean;
  setRunning: (running: boolean) => void;
  envStatus: EnvStatus;
  setEnvStatus: (status: EnvStatus) => void;

  // Logs
  logs: LogEntry[];
  addLog: (msg: string, source: 'system' | 'stderr' | 'stdout') => void;

  // Snapshot
  snapshot: ReadModelSnapshot | null;
  auditTimeline: AuditTimelineItem[];
  dailyDigest: string;

  // Handlers
  handleSaveLauncherConfig: () => Promise<void>;
  handleSaveConfig: () => Promise<void>;
  handleBrowsePath: (key: 'corePath' | 'configPath' | 'workspacePath') => Promise<void>;
  handleResetOnboarding: () => Promise<void>;
  toggleGateway: () => Promise<void>;
  toggleViewMode: () => void;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode; value: AppContextType }> = ({
  children,
  value,
}) => {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

/**
 * Hook to use global application context
 * @throws Error if called outside of AppProvider
 */
export const useAppContext = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};
