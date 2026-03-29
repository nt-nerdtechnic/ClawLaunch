import React from 'react';
import { Key, Loader2, AlertCircle, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { useAuthProfiles } from '../hooks/useAuthProfiles';
import { ConfigService } from '../services/configService';
import { getProviderGroups } from '../constants/providers';
import { execInTerminal } from '../utils/terminal';

/**
 * 自包含的 Auth 管理面板。
 * 直接從 Zustand 讀取 config / addLog / setRuntimeProfile，
 * 不需要任何外部 props。
 */
export const AuthManagementPanel: React.FC = () => {
  const { t } = useTranslation();
  const config = useStore((s) => s.config);
  const addLog = useStore((s) => s.addLog);
  const setRuntimeProfile = useStore((s) => s.setRuntimeProfile);

  const resolvedConfigDir = ConfigService.normalizeConfigDir(config.configPath);

  const {
    authProfiles,
    authProfilesLoading,
    authProfilesError,
    authRemovingId,
    setAuthRemovingId,
    authAdding,
    setAuthAdding,
    authAddProvider,
    setAuthAddProvider,
    authAddChoice,
    setAuthAddChoice,
    authAddSecret,
    setAuthAddSecret,
    authAddError,
    setAuthAddError,
    authAddTokenCommand,
    setAuthAddTokenCommand,
    authAddTokenRunning,
    setAuthAddTokenRunning,
    authAddTokenError,
    setAuthAddTokenError,
    loadAuthProfiles,
  } = useAuthProfiles(resolvedConfigDir, 'runtimeSettings');

  const AUTH_PROVIDER_GROUPS = getProviderGroups(t);

  const handleAuthProviderSelect = (pid: string) => {
    setAuthAddProvider(pid);
    const group = AUTH_PROVIDER_GROUPS.find((g) => g.id === pid);
    if (group) setAuthAddChoice(group.choices[0].id);
  };

  const currentAuthProviderGroup =
    AUTH_PROVIDER_GROUPS.find((g) => g.id === authAddProvider) ?? AUTH_PROVIDER_GROUPS[0];
  const currentAuthChoice =
    currentAuthProviderGroup.choices.find((c) => c.id === authAddChoice) ??
    currentAuthProviderGroup.choices[0];

  // --- 刷新 runtimeProfile（auth 操作後呼叫） ---
  const refreshRuntimeProfile = async () => {
    if (!window.electronAPI || !resolvedConfigDir) return;
    const probeRes = await window.electronAPI.exec(
      `config:probe ${ConfigService.shellQuote(resolvedConfigDir)}`
    );
    if (probeRes.code === 0 && probeRes.stdout) {
      setRuntimeProfile(JSON.parse(probeRes.stdout));
    }
  };

  // --- Action handlers ---
  const handleRemoveAuthProfile = async (profileId: string) => {
    if (!window.electronAPI || !resolvedConfigDir || !profileId) return;
    setAuthRemovingId(profileId);
    setAuthAddError('');
    try {
      const res = await window.electronAPI.exec(
        `auth:remove-profile ${JSON.stringify({ configPath: resolvedConfigDir, profileId })}`
      );
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || t('auth.errors.removeFailed'));
      }
      addLog(t('runtime.actions.authRemoved', { id: profileId }), 'system');
      await loadAuthProfiles();
      await refreshRuntimeProfile();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('auth.errors.removeFailed');
      setAuthAddError(msg);
      addLog(msg, 'stderr');
    } finally {
      setAuthRemovingId('');
    }
  };

  const handleLaunchFullOnboarding = async () => {
    if (!config.corePath?.trim()) {
      setAuthAddError(t('auth.errors.missingCorePath'));
      return;
    }
    if (!resolvedConfigDir) {
      setAuthAddError(t('auth.errors.missingConfigPath'));
      return;
    }
    try {
      const envPrefix = ConfigService.buildOpenClawEnvPrefix(config.configPath);
      const cmd = `${envPrefix}pnpm openclaw onboard`;
      await execInTerminal(cmd, {
        title: t('runtime.actions.onboardTitle'),
        holdOpen: true,
        cwd: config.corePath,
      });
      addLog(t('auth.onboardLaunched'), 'system');
      await loadAuthProfiles();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('auth.errors.onboardFailed');
      setAuthAddError(msg);
      addLog(msg, 'stderr');
    }
  };

  const handleAddAuthProfile = async () => {
    if (!window.electronAPI) return;
    setAuthAddError('');

    if (!resolvedConfigDir) {
      setAuthAddError(t('auth.errors.addAuthMissingConfig'));
      return;
    }
    if (!config.corePath?.trim()) {
      setAuthAddError(t('auth.errors.addAuthMissingCore'));
      return;
    }

    const curChoice = currentAuthProviderGroup.choices.find((c) => c.id === authAddChoice);
    if (curChoice?.oauthFlow) {
      await handleLaunchFullOnboarding();
      return;
    }

    const requiresSecret =
      curChoice?.reqKey ?? !['ollama', 'vllm'].includes(authAddChoice);
    if (requiresSecret && !authAddSecret.trim()) {
      setAuthAddError(t('auth.errors.credentialRequired'));
      return;
    }

    setAuthAdding(true);
    try {
      const payload = {
        corePath: config.corePath,
        configPath: resolvedConfigDir,
        workspacePath: config.workspacePath,
        authChoice: authAddChoice,
        secret: authAddSecret,
      };
      const res = await window.electronAPI.exec(
        `auth:add-profile ${JSON.stringify(payload)}`
      );
      if ((res.code ?? res.exitCode) !== 0) {
        throw new Error(res.stderr || t('auth.errors.addFailed'));
      }
      addLog(t('runtime.actions.authAdded', { choice: authAddChoice }), 'system');
      setAuthAddSecret('');
      await loadAuthProfiles();
      await refreshRuntimeProfile();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : t('auth.errors.addFailed');
      setAuthAddError(msg);
      addLog(msg, 'stderr');
    } finally {
      setAuthAdding(false);
    }
  };

  const handleRunAuthTokenCommand = async () => {
    const command = (authAddTokenCommand || '').trim();
    if (!command) {
      setAuthAddTokenError(t('auth.errors.emptyCommand'));
      return;
    }
    setAuthAddTokenRunning(true);
    setAuthAddTokenError('');
    try {
      const res = await execInTerminal(command, {
        title: t('runtime.actions.tokenAuthTitle'),
        holdOpen: true,
        cwd: config.corePath || undefined,
      });
      const code = res.code;
      if (typeof code === 'number' && code !== 0) {
        throw new Error(res.stderr || t('auth.errors.commandExecError'));
      }
    } catch (err: unknown) {
      setAuthAddTokenError(
        err instanceof Error ? err.message : t('auth.errors.commandExecError')
      );
    } finally {
      setAuthAddTokenRunning(false);
    }
  };

  return (
    <div className="mb-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 p-4 space-y-4">
      <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
        {t('runtime.auth.management')}
      </div>

      {authProfilesLoading && (
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">{t('runtime.auth.loadingProfiles')}</span>
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
            {t('runtime.auth.profileStats', {
              total: authProfiles.length,
              healthy: authProfiles.filter((p) => p.credentialHealthy).length,
            })}
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
                        {t('app.online')}
                      </span>
                    )}
                    {!profile.credentialHealthy && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                        <AlertCircle size={11} />
                        {t('runtime.auth.repairNeeded')}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveAuthProfile(profile.profileId)}
                  disabled={authRemovingId === profile.profileId}
                  className="ml-4 p-2 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-950/30 dark:hover:bg-red-950/50 transition-colors disabled:opacity-50"
                  title={t('settings.auth.removeTitle')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-4">
          {t('runtime.auth.addAuth')}
        </div>
        {authAddError && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-300">
            {authAddError}
          </div>
        )}
        <div className="space-y-4">
          {/* Step 1: Select Provider */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-[9px]">
                1
              </span>
              {t('runtime.auth.selectProvider')}
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 xl:grid-cols-5">
              {AUTH_PROVIDER_GROUPS.map((pg) => (
                <button
                  key={pg.id}
                  type="button"
                  onClick={() => handleAuthProviderSelect(pg.id)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 text-center transition-all disabled:opacity-50 ${
                    authAddProvider === pg.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-500'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <span
                    className={
                      authAddProvider === pg.id
                        ? 'text-blue-600 dark:text-blue-400'
                        : 'text-slate-500 dark:text-slate-400'
                    }
                  >
                    {pg.icon}
                  </span>
                  <span
                    className={`text-[9px] font-black truncate w-full ${
                      authAddProvider === pg.id
                        ? 'text-blue-700 dark:text-blue-300'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {pg.label}
                  </span>
                  <span
                    className={`text-[8px] truncate w-full leading-none ${
                      authAddProvider === pg.id
                        ? 'text-blue-400 dark:text-blue-500'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {pg.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Select verification method */}
          {currentAuthProviderGroup.choices.length > 1 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-[9px]">
                  2
                </span>
                {t('runtime.auth.verifyMethod')}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {currentAuthProviderGroup.choices.map((choice) => (
                  <div
                    key={choice.id}
                    onClick={() => setAuthAddChoice(choice.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                      authAddChoice === choice.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-500'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                          {choice.name}
                        </span>
                        {choice.oauthFlow && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-emerald-500 text-white">
                            OAUTH
                          </span>
                        )}
                        {choice.isTokenFlow && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-blue-500 text-white">
                            CLI TOKEN
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {choice.desc}
                      </p>
                    </div>
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors ${
                        authAddChoice === choice.id
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 3: Credentials */}
          {currentAuthChoice.oauthFlow ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-950/20 px-4 py-3 space-y-1">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                {t('settings.auth.oauthFlow')}
              </p>
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                {t('settings.auth.oauthGuide')}
              </p>
            </div>
          ) : !currentAuthChoice.reqKey ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40 px-4 py-3 space-y-1">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                {t('settings.auth.noKeyRequired')}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {t('settings.auth.localServiceGuide')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 text-[9px]">
                  {currentAuthProviderGroup.choices.length > 1 ? '3' : '2'}
                </span>
                {t('runtime.auth.credentials')}
              </div>
              <div className="flex items-center justify-between mb-1">
                {currentAuthChoice.link ? (
                  <a
                    href={currentAuthChoice.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1 font-black uppercase tracking-tighter ml-auto"
                  >
                    {t('runtime.auth.getApiKey')}
                  </a>
                ) : (
                  <span />
                )}
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Key size={14} />
                </div>
                <input
                  type="password"
                  value={authAddSecret}
                  onChange={(e) => setAuthAddSecret(e.target.value)}
                  placeholder={currentAuthChoice.placeholder || t('runtime.auth.inputKey')}
                  className="w-full pl-9 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-black/40 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors disabled:opacity-50"
                />
              </div>
              {currentAuthChoice.helpText && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50/50 border border-blue-100 dark:bg-blue-950/20 dark:border-blue-900/60">
                  <div className="mt-0.5 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                    <span className="text-[9px] text-white font-bold">i</span>
                  </div>
                  <p className="text-[11px] font-medium text-blue-700 dark:text-blue-300 leading-relaxed">
                    {currentAuthChoice.helpText}
                  </p>
                </div>
              )}

              {/* Token CLI command executor */}
              {currentAuthChoice.isTokenFlow && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-2">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    {t('runtime.auth.tokenCmdLabel')}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={authAddTokenCommand}
                      onChange={(e) => setAuthAddTokenCommand(e.target.value)}
                      placeholder="claude setup-token"
                      disabled={authAddTokenRunning}
                      className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-black/40 px-3 py-2 text-xs font-mono text-slate-700 dark:text-slate-300 outline-none focus:border-blue-400 transition-colors disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={handleRunAuthTokenCommand}
                      disabled={authAddTokenRunning}
                      className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-slate-900 dark:bg-slate-700 text-white hover:bg-slate-800 dark:hover:bg-slate-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 transition-all flex items-center gap-1.5"
                    >
                      {authAddTokenRunning ? (
                        <>
                          <Loader2 size={11} className="animate-spin" />{' '}
                          {t('common.labels.executing')}
                        </>
                      ) : (
                        t('common.labels.execute')
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {t('runtime.auth.tokenCmdHelp')}
                  </p>
                  {authAddTokenError && (
                    <p className="text-[10px] text-red-600 dark:text-red-400 font-medium">
                      {authAddTokenError}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={handleAddAuthProfile}
            disabled={authAdding}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold transition-colors disabled:opacity-60"
          >
            <Plus size={16} />
            {authAdding ? t('common.labels.executing') : t('runtime.auth.addAuth')}
          </button>
        </div>
      </div>
    </div>
  );
};
