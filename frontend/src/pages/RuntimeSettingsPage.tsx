import React from 'react';
import { Key, Loader2, ShieldCheck, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface AuthProfileRow {
  profileId: string;
  provider: string;
  mode: string;
  globalPresent: boolean;
  agentPresent: boolean;
  agentCount: number;
  credentialHealthy: boolean;
  diagnostics?: string[];
  severity?: 'ok' | 'warn' | 'critical';
  repairGuides?: string[];
}

interface TelegramPairingRequest {
  id: string;
  code: string;
  createdAt?: string;
  lastSeenAt?: string;
  meta?: {
    username?: string;
    firstName?: string;
    lastName?: string;
    accountId?: string;
  };
}

interface RuntimeSettingsPageProps {
  config: any;
  setConfig: (config: any) => void;
  runtimeProfile: any;
  runtimeDraftModel: string;
  setRuntimeDraftModel: (model: string) => void;
  runtimeDraftBotToken: string;
  setRuntimeDraftBotToken: (token: string) => void;
  dynamicModelOptions: any[];
  dynamicModelLoading: boolean;
  selectedModelProvider: string;
  selectedModelAuthorized: boolean;
  getProviderDisplayLabel: (provider: string, fallback?: string) => string;
  authorizedProviderBadges: string[];
  modelOptionGroups: any[];
  effectiveAuthorizedProviders: string[];
  isModelAuthorizedByProvider: (model: string) => boolean;

  // Auth Profiles
  authProfiles: AuthProfileRow[];
  authProfileSummary: any;
  authProfilesLoading: boolean;
  authProfilesError: string;
  authRemovingId: string;
  onHandleRemoveAuthProfile: (profileId: string) => Promise<void>;

  // Auth Add
  authAdding: boolean;
  authAddProvider: string;
  setAuthAddProvider: (provider: string) => void;
  authAddChoice: string;
  setAuthAddChoice: (choice: string) => void;
  authAddSecret: string;
  setAuthAddSecret: (secret: string) => void;
  authAddError: string;
  authAddTokenCommand: string;
  setAuthAddTokenCommand: (cmd: string) => void;
  authAddTokenRunning: boolean;
  onHandleAddAuthProfile: () => Promise<void>;
  onHandleRunAuthTokenCommand: () => Promise<void>;
  onHandleLaunchFullOnboarding: () => Promise<void>;
  runtimeProfileError?: string;

  // Telegram
  telegramPairingRequests: TelegramPairingRequest[];
  telegramAuthorizedUsers: any[];
  telegramPairingLoading: boolean;
  telegramPairingApprovingCode: string;
  telegramPairingRejectingCode: string;
  telegramPairingClearing: boolean;
  telegramPairingError: string;
  onHandleApproveTelegramPairing: (request: TelegramPairingRequest) => Promise<void>;
  onHandleRejectTelegramPairing: (request: TelegramPairingRequest) => Promise<void>;
  onHandleClearTelegramPairingRequests: () => Promise<void>;

  // Handlers
  onSave: () => Promise<void>;
  saveState?: 'idle' | 'saving' | 'saved' | 'error';
}

export const RuntimeSettingsPage: React.FC<RuntimeSettingsPageProps> = ({
  config,
  setConfig,
  runtimeProfile: _runtimeProfile,
  runtimeDraftModel,
  setRuntimeDraftModel,
  runtimeDraftBotToken,
  setRuntimeDraftBotToken,
  dynamicModelOptions,
  dynamicModelLoading,
  selectedModelProvider,
  selectedModelAuthorized,
  getProviderDisplayLabel,
  authorizedProviderBadges,
  modelOptionGroups,
  effectiveAuthorizedProviders: _effectiveAuthorizedProviders,
  isModelAuthorizedByProvider: _isModelAuthorizedByProvider,
  authProfiles,
  authProfileSummary: _authProfileSummary,
  authProfilesLoading,
  authProfilesError,
  authRemovingId,
  onHandleRemoveAuthProfile,
  authAdding,
  authAddProvider,
  setAuthAddProvider,
  authAddChoice,
  setAuthAddChoice,
  authAddSecret,
  setAuthAddSecret,
  authAddError,
  authAddTokenCommand: _authAddTokenCommand,
  setAuthAddTokenCommand: _setAuthAddTokenCommand,
  authAddTokenRunning: _authAddTokenRunning,
  onHandleAddAuthProfile,
  onHandleRunAuthTokenCommand: _onHandleRunAuthTokenCommand,
  onHandleLaunchFullOnboarding,
  runtimeProfileError,
  telegramPairingRequests,
  telegramAuthorizedUsers,
  telegramPairingLoading,
  telegramPairingApprovingCode,
  telegramPairingRejectingCode,
  telegramPairingClearing,
  telegramPairingError,
  onHandleApproveTelegramPairing,
  onHandleRejectTelegramPairing,
  onHandleClearTelegramPairingRequests,
  onSave,
  saveState = 'idle',
}) => {
  const { t } = useTranslation();
  const dynamicModelSource = dynamicModelOptions.length > 0 ? '動態' : '靜態';
  const isUnrestrictedMode = config?.unrestrictedMode === true;

  const saveButtonLabel =
    saveState === 'saving'
      ? t('settings.savingConfigButton')
      : saveState === 'saved'
        ? t('settings.configSavedButton')
        : saveState === 'error'
          ? t('settings.saveConfigFailedButton')
          : t('settings.saveConfig');

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
      {/* Gateway & Model Section */}
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
              Gateway & Model
            </div>
            <button
              type="button"
              onClick={() => setConfig({ unrestrictedMode: !isUnrestrictedMode })}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                isUnrestrictedMode
                  ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50'
                  : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50'
              }`}
            >
              {isUnrestrictedMode ? '🔓 無限制模式' : '🔒 受限模式'}
            </button>
          </div>
          {runtimeProfileError && (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 dark:border-rose-800/60 dark:bg-rose-950/20">
              <AlertCircle size={15} className="mt-0.5 shrink-0 text-rose-500 dark:text-rose-400" />
              <div className="text-xs text-rose-700 dark:text-rose-300 font-mono leading-relaxed">
                {runtimeProfileError}
              </div>
            </div>
          )}

          <div className="mb-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 p-4 space-y-4">
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
              認證管理
            </div>

            {authProfilesLoading && (
              <div className="flex items-center gap-2 text-slate-500">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">加載授權清單...</span>
              </div>
            )}

            {authProfilesError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-300">
                {authProfilesError}
              </div>
            )}

            {!authProfilesLoading && authProfiles.length > 0 && (
              <div className="space-y-3">
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  已配置 {authProfiles.length} 個授權，其中 {authProfiles.filter((p) => p.credentialHealthy).length} 個健康
                </div>
                <div className="grid gap-3">
                  {authProfiles.map((profile) => (
                    <div
                      key={profile.profileId}
                      className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 p-4 flex items-center justify-between"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                          {profile.profileId}
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-slate-600 dark:text-slate-400">
                          <span className="px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800">
                            {profile.provider}
                          </span>
                          {profile.credentialHealthy && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                              <ShieldCheck size={11} />
                              Healthy
                            </span>
                          )}
                          {!profile.credentialHealthy && (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                              <AlertCircle size={11} />
                              需要修復
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => onHandleRemoveAuthProfile(profile.profileId)}
                        disabled={authRemovingId === profile.profileId || !isUnrestrictedMode}
                        className="ml-4 p-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50 transition-colors disabled:opacity-50"
                        title="移除授權"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-4">新增授權</div>
              {authAddError && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-300">
                  {authAddError}
                </div>
              )}
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Provider</label>
                    <select
                      value={authAddProvider}
                      onChange={(e) => setAuthAddProvider(e.target.value)}
                      disabled={!isUnrestrictedMode}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:border-blue-400"
                    >
                      <option value="anthropic">Anthropic</option>
                      <option value="openai">OpenAI</option>
                      <option value="google">Google</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Choice</label>
                    <select
                      value={authAddChoice}
                      onChange={(e) => setAuthAddChoice(e.target.value)}
                      disabled={!isUnrestrictedMode}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm outline-none focus:border-blue-400"
                    >
                      <option value="apiKey">API Key</option>
                      <option value="token">Setup Token</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">憑證</label>
                  <input
                    type="password"
                    value={authAddSecret}
                    onChange={(e) => setAuthAddSecret(e.target.value)}
                    placeholder="輸入 API Key 或 Token"
                    disabled={!isUnrestrictedMode}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-black/40 px-4 py-3 text-slate-700 dark:text-slate-300 text-xs outline-none focus:border-blue-400"
                  />
                </div>

                <button
                  onClick={onHandleAddAuthProfile}
                  disabled={authAdding || !isUnrestrictedMode}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold transition-colors disabled:opacity-60"
                >
                  <Plus size={16} />
                  {authAdding ? '新增中...' : '新增授權'}
                </button>

                <button
                  onClick={onHandleLaunchFullOnboarding}
                  disabled={!isUnrestrictedMode}
                  className="w-full py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors"
                >
                  或啟動完整導引
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5">
            {/* Model Selection */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  {t('settings.inferenceEngine')}
                </label>
                {selectedModelProvider && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                      selectedModelAuthorized
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300'
                    }`}
                  >
                    <Key size={11} />
                    {getProviderDisplayLabel(selectedModelProvider, selectedModelProvider)}
                  </span>
                )}
              </div>
              <input
                type="text"
                value={runtimeDraftModel}
                onChange={(e) => setRuntimeDraftModel(e.target.value)}
                placeholder="選擇或輸入模型"
                className={`w-full rounded-2xl border px-4 py-3 font-mono text-xs outline-none transition-colors ${
                  selectedModelAuthorized
                    ? 'bg-white dark:bg-black/40 border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 focus:border-blue-400 dark:focus:border-blue-500/50'
                    : 'bg-amber-50 dark:bg-amber-950/20 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 focus:border-amber-400 dark:focus:border-amber-600'
                }`}
              />
            </div>
          </div>

          {/* Model Picker */}
          <div className="mt-5 rounded-[24px] border border-slate-200 dark:border-slate-700 bg-gradient-to-br from-white via-slate-50 to-sky-50/70 dark:from-slate-950/70 dark:via-slate-900/60 dark:to-sky-950/30 p-4 space-y-4 shadow-lg shadow-slate-200/40 dark:shadow-none">
            <div className="flex flex-wrap items-center gap-2">
              {authorizedProviderBadges.length > 0 ? (
                authorizedProviderBadges.map((provider) => (
                  <span
                    key={provider}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    <ShieldCheck size={11} />
                    {getProviderDisplayLabel(provider, provider)}
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  尚未偵測到可驗證授權，暫時顯示保底模型目錄。
                </span>
              )}
            </div>

            {modelOptionGroups.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {modelOptionGroups.map(({ provider, group, models }) => (
                  <div
                    key={`${provider}-${group}`}
                    className="rounded-2xl border border-slate-200/80 bg-white/80 p-3 dark:border-slate-700/70 dark:bg-slate-900/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600 dark:text-slate-300">
                        {getProviderDisplayLabel(provider, group)}
                      </div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500">{models.length} models</div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {models.slice(0, 6).map((model: any) => {
                        const selected = runtimeDraftModel === model;
                        return (
                          <button
                            key={model}
                            type="button"
                            onClick={() => setRuntimeDraftModel(model)}
                            className={`rounded-xl border px-3 py-2 text-left font-mono text-[11px] transition-colors ${
                              selected
                                ? 'border-sky-400 bg-sky-50 text-sky-700 dark:border-sky-500 dark:bg-sky-950/40 dark:text-sky-300'
                                : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-900'
                            }`}
                          >
                            {model}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-950/30 dark:text-slate-300">
                尚未從目前授權狀態取得可選模型。請先確認授權 profile 健康，或重新整理設定頁。
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500">
              <span>
                模型來源：{dynamicModelLoading ? '載入中...' : dynamicModelSource}
              </span>
              {!selectedModelAuthorized && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-300">
                  目前模型不在已授權 provider 範圍
                </span>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Telegram Pairing Section */}
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-6 shadow-xl shadow-slate-200/50 dark:shadow-none">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
              Telegram 配對管理
            </div>
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              管理待核准配對清單與已授權 Telegram 使用者。
            </div>
          </div>
          <button
            type="button"
            onClick={onHandleClearTelegramPairingRequests}
            disabled={telegramPairingClearing || telegramPairingLoading || telegramPairingRequests.length === 0 || !isUnrestrictedMode}
            className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {telegramPairingClearing ? '清空中...' : '清空待配對'}
          </button>
        </div>

        {telegramPairingError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-300">
            {telegramPairingError}
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 p-4 space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            Telegram Bot Token
          </label>
          <input
            type="text"
            value={runtimeDraftBotToken}
            onChange={(e) => setRuntimeDraftBotToken(e.target.value)}
            placeholder="可選：輸入 Telegram Bot Token"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
          />
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            建議先更新 Bot Token，再進行配對審核與授權管理。
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="space-y-3">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">等待配對清單</div>
            {telegramPairingLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 size={14} className="animate-spin" />
                讀取中...
              </div>
            ) : telegramPairingRequests.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                目前沒有待審核配對。
              </div>
            ) : (
              <div className="space-y-2">
                {telegramPairingRequests.map((request) => (
                  <div
                    key={request.id || request.code}
                    className="rounded-xl border border-slate-200 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                  >
                    <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{request.id || 'unknown-id'}</div>
                    <div className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">Code: {request.code || '-'}</div>
                    {request.meta?.accountId && (
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">User ID: {request.meta.accountId}</div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => onHandleApproveTelegramPairing(request)}
                        disabled={telegramPairingApprovingCode === request.code || telegramPairingRejectingCode === request.code || !isUnrestrictedMode}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-60"
                      >
                        {telegramPairingApprovingCode === request.code ? '核准中...' : '核准'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onHandleRejectTelegramPairing(request)}
                        disabled={telegramPairingApprovingCode === request.code || telegramPairingRejectingCode === request.code || !isUnrestrictedMode}
                        className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-rose-500 disabled:opacity-60"
                      >
                        {telegramPairingRejectingCode === request.code ? '拒絕中...' : '拒絕'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="text-xs font-bold text-slate-700 dark:text-slate-200">已授權使用者</div>
            {telegramAuthorizedUsers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                尚無已授權 Telegram 帳號。
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {telegramAuthorizedUsers.map((user: any) => (
                  <span
                    key={String(user?.id || '')}
                    className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-mono text-emerald-700 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:text-emerald-300"
                  >
                    {String(user?.id || '')}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={onSave}
        disabled={saveState === 'saving'}
        className={`w-full py-4 rounded-2xl font-black text-white shadow-xl transition-all ${
          saveState === 'saved'
            ? 'bg-emerald-600 shadow-emerald-600/20'
            : saveState === 'error'
              ? 'bg-rose-600 shadow-rose-600/20'
              : 'bg-blue-600 shadow-blue-600/20 hover:bg-blue-500 active:scale-[0.98]'
        } disabled:cursor-wait disabled:opacity-80`}
      >
        {saveButtonLabel}
      </button>
    </div>
  );
};
