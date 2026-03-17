import React, { createContext, useContext, type ReactNode } from 'react';

/**
 * 應用全局性上下文
 * 將 App.tsx 的所有 state 和 handlers 統一管理
 * 便於逐步遷移至各個 Page 組件
 */

type AppContextType = {
  // 路由
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onboardingFinished: boolean;
  setOnboardingFinished: (finished: boolean) => void;

  // Config
  config: any;
  setConfig: (config: any) => void;
  detectedConfig: any;
  setDetectedConfig: (config: any) => void;

  // Gateway
  running: boolean;
  setRunning: (running: boolean) => void;
  envStatus: any;
  setEnvStatus: (status: any) => void;

  // Logs
  logs: any[];
  addLog: (msg: string, source: 'system' | 'stderr' | 'stdout') => void;

  // Snapshot
  snapshot: any;
  auditTimeline: any[];
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
 * 使用應用全局上下文
 * @throws 如果未在 AppProvider 內調用
 */
export const useAppContext = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};
