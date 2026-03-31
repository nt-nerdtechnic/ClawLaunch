import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { WorkspaceStatusBanner } from './WorkspaceStatusBanner';

type AppContentAreaProps = {
  activeTab: string;
  onboardingFinished: boolean;
  workspaceBannerDismissed: boolean;
  corePath?: string;
  configPath?: string;
  workspacePath?: string;
  runtimeProfileError?: string;
  onOpenSettings: () => void;
  onRelogout: () => void;
  onDismissWorkspaceBanner: () => void;
  t: TFunction;
  controlCenterContent: ReactNode;
  skillsContent: ReactNode;
  memoryContent: ReactNode;
  analyticsContent: ReactNode;
  monitorContent: ReactNode;
  launcherSettingsContent: ReactNode;
  runtimeSettingsContent: ReactNode;
};

export function AppContentArea({
  activeTab,
  onboardingFinished,
  workspaceBannerDismissed,
  corePath,
  configPath,
  workspacePath,
  runtimeProfileError,
  onOpenSettings,
  onRelogout,
  onDismissWorkspaceBanner,
  t,
  controlCenterContent,
  skillsContent,
  memoryContent,
  analyticsContent,
  monitorContent,
  launcherSettingsContent,
  runtimeSettingsContent,
}: AppContentAreaProps) {
  const isFullBleed = activeTab === 'memory';

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <WorkspaceStatusBanner
        activeTab={activeTab}
        onboardingFinished={onboardingFinished}
        dismissed={workspaceBannerDismissed}
        corePath={corePath}
        configPath={configPath}
        workspacePath={workspacePath}
        runtimeProfileError={runtimeProfileError}
        onOpenSettings={onOpenSettings}
        onRelogout={onRelogout}
        onDismiss={onDismissWorkspaceBanner}
        t={t}
      />
      {isFullBleed ? (
        memoryContent
      ) : (
        <div className="flex-1 p-10 overflow-y-auto">
          {activeTab === 'controlCenter' && controlCenterContent}
          {activeTab === 'skills' && skillsContent}
          {activeTab === 'analytics' && analyticsContent}
          {activeTab === 'monitor' && monitorContent}
          {activeTab === 'launcherSettings' && launcherSettingsContent}
          {activeTab === 'runtimeSettings' && runtimeSettingsContent}
        </div>
      )}
    </div>
  );
}
