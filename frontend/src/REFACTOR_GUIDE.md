/**
 * App.tsx 分階段重構指南 (第 4 階段)
 * 
 * 此文件列出 App.tsx 需要進行的修改步驟
 * 允許逐步進行，同時保持應用運行不中斷
 * 
 * ============================================
 * STEP 1: 導入所有新的 Page 組件
 * ============================================
 * 
 * 在檔案頂部 imports 部分，添加：
 * 
 * ```typescript
 * import { LauncherSettingsPage } from './pages/LauncherSettingsPage';
 * import { RuntimeSettingsPage } from './pages/RuntimeSettingsPage';
 * import { MonitorPage } from './pages/MonitorPage';
 * import { AnalyticsPage } from './pages/AnalyticsPage';
 * import { SkillsPage } from './pages/SkillsPage';
 * ```
 * 
 * ============================================
 * STEP 2: 替換 Monitor 頁面渲染邏輯
 * ============================================
 * 
 * 找到現有的 `{activeTab === 'monitor' && (` 塊
 * 
 * 舊代碼（現在的 App.tsx 中約 1600+ 行）:
 * ```typescript
 * {activeTab === 'monitor' && (
 *   <div className="space-y-8 animate-in fade-in...">
 *     {/* 所有 monitor 相關的 JSX */}
 *   </div>
 * )}
 * ```
 * 
 * 新代碼（替換為）:
 * ```typescript
 * {activeTab === 'monitor' && (
 *   <MonitorPage
 *     running={running}
 *     onToggleGateway={toggleGateway}
 *     config={config}
 *     resolvedConfigDir={resolvedConfigDir}
 *     snapshot={snapshot}
 *     envStatus={envStatus}
 *     logs={logs}
 *     auditTimeline={auditTimeline}
 *     dailyDigest={dailyDigest}
 *     gatewayRuntimeZones={gatewayRuntimeZones}
 *     onOpenZoneFolder={openZoneFolder}
 *   />
 * )}
 * ```
 * 
 * ============================================
 * STEP 3: 替換 Analytics 頁面
 * ============================================
 * 
 * 找到現有的 `{activeTab === 'analytics' && (` 塊
 * 
 * 舊代碼:
 * ```typescript
 * {activeTab === 'analytics' && (
 *   <ViewErrorBoundary ...>
 *     <Analytics />
 *   </ViewErrorBoundary>
 * )}
 * ```
 * 
 * 新代碼:
 * ```typescript
 * {activeTab === 'analytics' && (
 *   <ViewErrorBoundary title="..." message="...">
 *     <AnalyticsPage />
 *   </ViewErrorBoundary>
 * )}
 * ```
 * 
 * ============================================
 * STEP 4: 替換 Skills 頁面
 * ============================================
 * 
 * 找到現有的 `{activeTab === 'skills' && (` 塊
 * 
 * 舊代碼:
 * ```typescript
 * {activeTab === 'skills' && <SkillManager />}
 * ```
 * 
 * 新代碼:
 * ```typescript
 * {activeTab === 'skills' && <SkillsPage />}
 * ```
 * 
 * ============================================
 * STEP 5: 替換 LauncherSettings 頁面
 * ============================================
 * 
 * 找到現有的 `{activeTab === 'launcherSettings' && (` 塊（約 1679 行）
 * 
 * 舊代碼（整個配置表單）:
 * ```typescript
 * {activeTab === 'launcherSettings' && (
 *   <div className="max-w-4xl mx-auto space-y-8...">
 *     {/* 所有表單字段 */}
 *   </div>
 * )}
 * ```
 * 
 * 新代碼:
 * ```typescript
 * {activeTab === 'launcherSettings' && (
 *   <LauncherSettingsPage
 *     config={config}
 *     setConfig={setConfig}
 *     onSave={handleSaveLauncherConfig}
 *     onAddLog={addLog}
 *     onBrowsePath={handleBrowsePath}
 *   />
 * )}
 * ```
 * 
 * ============================================
 * STEP 6: 替換 RuntimeSettings 頁面（最複雜）
 * ============================================
 * 
 * 找到現有的 `{activeTab === 'runtimeSettings' && (` 塊（約 1821 行）
 * 
 * 新代碼:
 * ```typescript
 * {activeTab === 'runtimeSettings' && (
 *   <RuntimeSettingsPage
 *     // 運行時配置
 *     config={config}
 *     setConfig={setConfig}
 *     runtimeProfile={runtimeProfile}
 *     runtimeDraftModel={runtimeDraftModel}
 *     setRuntimeDraftModel={setRuntimeDraftModel}
 *     runtimeDraftBotToken={runtimeDraftBotToken}
 *     setRuntimeDraftBotToken={setRuntimeDraftBotToken}
 *     dynamicModelOptions={dynamicModelOptions}
 *     dynamicModelLoading={dynamicModelLoading}
 *     selectedModelProvider={selectedModelProvider}
 *     selectedModelAuthorized={selectedModelAuthorized}
 *     getProviderDisplayLabel={getProviderDisplayLabel}
 *     authorizedProviderBadges={authorizedProviderBadges}
 *     modelOptionGroups={modelOptionGroups}
 *     effectiveAuthorizedProviders={effectiveAuthorizedProviders}
 *     isModelAuthorizedByProvider={isModelAuthorizedByProvider}
 *     
 *     // 認証管理
 *     authProfiles={authProfiles}
 *     authProfileSummary={authProfileSummary}
 *     authProfilesLoading={authProfilesLoading}
 *     authProfilesError={authProfilesError}
 *     authRemovingId={authRemovingId}
 *     onHandleRemoveAuthProfile={handleRemoveAuthProfile}
 *     authAdding={authAdding}
 *     authAddProvider={authAddProvider}
 *     setAuthAddProvider={setAuthAddProvider}
 *     authAddChoice={authAddChoice}
 *     setAuthAddChoice={setAuthAddChoice}
 *     authAddSecret={authAddSecret}
 *     setAuthAddSecret={setAuthAddSecret}
 *     authAddError={authAddError}
 *     authAddTokenCommand={authAddTokenCommand}
 *     setAuthAddTokenCommand={setAuthAddTokenCommand}
 *     authAddTokenRunning={authAddTokenRunning}
 *     onHandleAddAuthProfile={handleAddAuthProfile}
 *     onHandleRunAuthTokenCommand={handleRunAuthTokenCommand}
 *     onHandleLaunchFullOnboarding={handleLaunchFullOnboarding}
 *     
 *     // Telegram (暫留後續)
 *     telegramPairingRequests={telegramPairingRequests}
 *     telegramAuthorizedUsers={telegramAuthorizedUsers}
 *     telegramPairingLoading={telegramPairingLoading}
 *     telegramPairingApprovingCode={telegramPairingApprovingCode}
 *     telegramPairingRejectingCode={telegramPairingRejectingCode}
 *     telegramPairingClearing={telegramPairingClearing}
 *     telegramPairingError={telegramPairingError}
 *     onHandleApproveTelegramPairing={approveTelegramPairing}
 *     onHandleRejectTelegramPairing={rejectTelegramPairing}
 *     onHandleClearTelegramPairingRequests={clearTelegramPairingRequests}
 *     
 *     // Handlers
 *     onSave={handleSaveConfig}
 *     onBrowsePath={handleBrowsePath}
 *   />
 * )}
 * ```
 * 
 * ============================================
 * STEP 7: 驗證編譯和功能
 * ============================================
 * 
 * 執行：
 * ```bash
 * npm run dev
 * ```
 * 
 * 檢查：
 * - ✅ 應用啟動無錯誤
 * - ✅ 所有 5 個標籤頁可切換
 * - ✅ Monitor 頁面功能正常
 * - ✅ Settings 頁面能完整保存
 * - ✅ 無 console errors
 * 
 * ============================================
 * STEP 8: 逐步重構 App.tsx
 * ============================================
 * 
 * 完成上述替換後，可以開始最後的清理工作：
 * 
 * 1. 移除已遷移的 JSX 代碼塊（~900 行）
 * 2. 保留必要的 state 和 handlers（部分）
 * 3. 無限期保留：路由邏輯、Layout、全局狀態
 * 
 * 預計最終 App.tsx 會減至 ~400-500 行
 */

export const MIGRATION_GUIDE = `
這是 App.tsx 重構的逐步指南
`;
