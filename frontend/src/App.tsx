import { MiniView } from './components/MiniView';
import { ChatWidget } from './components/chat/ChatWidget';
import PixelOfficeWidget from './components/pixel-office/PixelOfficeWidget';
import SetupWizard from './components/onboarding/SetupWizard';
import { useAppOrchestrator } from './hooks/useAppOrchestrator';
import { LauncherSettingsPage } from './pages/LauncherSettingsPage';
import { RuntimeSettingsPage } from './pages/RuntimeSettingsPage';
import { MonitorPage } from './pages/MonitorPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SkillsPage } from './pages/SkillsPage';
import { ControlCenterPage } from './pages/ControlCenterPage';
import { MemoryPage } from './pages/MemoryPage';
import { ViewErrorBoundary } from './components/common/ViewErrorBoundary';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { AppContentArea } from './components/layout/AppContentArea';
import { UnsupportedDesktopNotice } from './components/layout/UnsupportedDesktopNotice';
import { BootstrappingScreen } from './components/layout/BootstrappingScreen';
import { LogoutConfirmDialog } from './components/dialogs/LogoutConfirmDialog';
import { GatewayConflictDialog } from './components/dialogs/GatewayConflictDialog';
import { StopServiceDialog } from './components/dialogs/StopServiceDialog';
import UpdateBanner from './components/UpdateBanner';

function App() {
  const {
    running,
    logs,
    config,
    snapshot,
    auditTimeline,
    dailyDigest,
    viewMode,
    activeTab,
    setActiveTab,
    onboardingFinished,
    showLogoutConfirm,
    setShowLogoutConfirm,
    workspaceBannerDismissed,
    gatewayConflictModal,
    killingGatewayPortHolder,
    gatewayConflictActionMessage,
    closeGatewayConflictModal,
    stopServiceModalOpen,
    stoppingServiceWithCleanup,
    stopServiceActionMessage,
    closeStopServiceModal,
    resolvedConfigDir,
    runtimeProfileError,
    runtimeDraftModel,
    setRuntimeDraftModel,
    runtimeDraftBotToken,
    setRuntimeDraftBotToken,
    runtimeDraftGatewayPort,
    setRuntimeDraftGatewayPort,
    runtimeDraftCronMaxConcurrentRuns,
    setRuntimeDraftCronMaxConcurrentRuns,
    dynamicModelOptions,
    dynamicModelLoading,
    syncSnapshot,
    loadDynamicModelOptions,
    handleKillGatewayPortHolder,
    toggleViewMode,
    handleToggleGatewayWithStopModal,
    handleConfirmStopService,
    handleResetOnboarding,
    dismissWorkspaceBanner,
    bootstrapping,
    handleOnboardingComplete,
    t,
  } = useAppOrchestrator();

  if (viewMode === 'mini') {
    return (
      <>
        <MiniView
          running={running}
          onToggle={handleToggleGatewayWithStopModal}
          onExpand={toggleViewMode}
          onExpandTo={(tab) => { toggleViewMode(); setActiveTab(tab); }}
        />
        <PixelOfficeWidget compact />
        <ChatWidget compact />
      </>
    );
  }

  if (!window.electronAPI) {
    return <UnsupportedDesktopNotice />;
  }

  // If not finished onboarding, show the wizard
  if (bootstrapping) {
    return <BootstrappingScreen />;
  }

  if (!onboardingFinished) {
    return <SetupWizard onFinished={handleOnboardingComplete} />;
  }

  return (
    <div className="flex h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden animate-in fade-in duration-700">
      <Sidebar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        onToggleViewMode={toggleViewMode}
        appVersion={config.appVersion}
        t={t}
      />

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-[#020617] relative">
        <Header
          activeTab={activeTab}
          onChangeTab={setActiveTab}
          onShowLogoutConfirm={() => setShowLogoutConfirm(true)}
          t={t}
        />

        <LogoutConfirmDialog
          open={showLogoutConfirm}
          onClose={() => setShowLogoutConfirm(false)}
          onConfirm={handleResetOnboarding}
          t={t}
        />

        <GatewayConflictDialog
          gatewayConflictModal={gatewayConflictModal}
          gatewayConflictActionMessage={gatewayConflictActionMessage}
          killingGatewayPortHolder={killingGatewayPortHolder}
          onClose={closeGatewayConflictModal}
          onGoToSettings={() => setActiveTab('launcherSettings')}
          onForceClose={handleKillGatewayPortHolder}
          t={t}
        />

        <StopServiceDialog
          open={stopServiceModalOpen}
          stopServiceActionMessage={stopServiceActionMessage}
          stoppingServiceWithCleanup={stoppingServiceWithCleanup}
          onClose={closeStopServiceModal}
          onConfirm={handleConfirmStopService}
          t={t}
        />

        {activeTab !== 'onboarding' && onboardingFinished && <UpdateBanner />}

        <AppContentArea
          activeTab={activeTab}
          onboardingFinished={onboardingFinished}
          workspaceBannerDismissed={workspaceBannerDismissed}
          corePath={config.corePath}
          configPath={config.configPath}
          workspacePath={config.workspacePath}
          runtimeProfileError={runtimeProfileError}
          onOpenSettings={() => setActiveTab('launcherSettings')}
          onRelogout={() => setShowLogoutConfirm(true)}
          onDismissWorkspaceBanner={dismissWorkspaceBanner}
          t={t}
          controlCenterContent={<ControlCenterPage onRefreshSnapshot={syncSnapshot} stateDir={resolvedConfigDir || undefined} />}
          skillsContent={<SkillsPage />}
          memoryContent={<MemoryPage config={config} />}
          analyticsContent={(
            <ViewErrorBoundary
              title={t('app.headers.analytics')}
              message={t('logs.commFailed', { msg: 'Analytics view crashed. Please switch tabs and try again.' })}
            >
              <AnalyticsPage />
            </ViewErrorBoundary>
          )}
          monitorContent={(
            <MonitorPage
              running={running}
              onToggleGateway={handleToggleGatewayWithStopModal}
              onNavigate={(p: string) => setActiveTab(p)}
              config={config}
              resolvedConfigDir={resolvedConfigDir}
              snapshot={snapshot}
              logs={logs}
              auditTimeline={auditTimeline}
              dailyDigest={dailyDigest}
            />
          )}
          launcherSettingsContent={(
            <LauncherSettingsPage />
          )}
          runtimeSettingsContent={(
            <RuntimeSettingsPage
              runtimeDraftModel={runtimeDraftModel}
              setRuntimeDraftModel={setRuntimeDraftModel}
              runtimeDraftBotToken={runtimeDraftBotToken}
              setRuntimeDraftBotToken={setRuntimeDraftBotToken}
              runtimeDraftGatewayPort={runtimeDraftGatewayPort}
              setRuntimeDraftGatewayPort={setRuntimeDraftGatewayPort}
              runtimeDraftCronMaxConcurrentRuns={runtimeDraftCronMaxConcurrentRuns}
              setRuntimeDraftCronMaxConcurrentRuns={setRuntimeDraftCronMaxConcurrentRuns}
              dynamicModelOptions={dynamicModelOptions}
              dynamicModelLoading={dynamicModelLoading}
              loadDynamicModelOptions={loadDynamicModelOptions}
              runtimeProfileError={runtimeProfileError}
            />
          )}
        />
      </main>
      <PixelOfficeWidget />
      <ChatWidget />
    </div>
  );
}


export default App;