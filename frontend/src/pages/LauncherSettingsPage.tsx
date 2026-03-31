import React, { useState, useEffect } from 'react';
import { FolderOpen, RefreshCw, CheckCircle, AlertCircle, Download, Globe, Play, Info, Wifi } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import type { Config } from '../store';
import { useLauncherSettingsActions } from '../hooks/useLauncherSettingsActions';

type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error';

interface UpdateInfo {
  current: string;
  latest: string;
  htmlUrl: string;
  upToDate: boolean;
  changelog?: string;
  publishedAt?: string;
  noReleases?: boolean;
}

interface LauncherSettingsPageProps {
  restartGateway?: () => Promise<void>;
}

export const LauncherSettingsPage: React.FC<LauncherSettingsPageProps> = ({ restartGateway }) => {
  const { t } = useTranslation();
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const addLog = useStore((s) => s.addLog);
  const {
    launcherSaveState,
    handleSaveLauncherConfig,
    handleBrowsePath,
  } = useLauncherSettingsActions({
    config,
    setConfig,
    addLog,
    t,
  });
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(() => {
    if (config.appVersion) {
      return {
        current: config.appVersion,
        latest: '',
        htmlUrl: '',
        upToDate: true,
      };
    }
    return null;
  });
  const [updateError, setUpdateError] = useState<string>('');

  const [chromeRunning, setChromeRunning] = useState(false);
  const [chromeLaunching, setChromeLaunching] = useState(false);
  const [chromeChecking, setChromeChecking] = useState(false);
  const [ocVersion, setOcVersion] = useState<string | null>(null);
  const [ocVersionChecking, setOcVersionChecking] = useState(false);
  const [gatewayRestarting, setGatewayRestarting] = useState(false);

  // Version comparison helpers
  const parseVer = (v: string) => v.split(/[.\-]/g).slice(0, 3).map(Number) as [number, number, number];
  const versionGte = (v: string, min: string) => {
    const [a1, a2, a3] = parseVer(v);
    const [b1, b2, b3] = parseVer(min);
    if (a1 !== b1) return a1 > b1;
    if (a2 !== b2) return a2 > b2;
    return a3 >= b3;
  };
  const supportsExistingSession = ocVersion ? versionGte(ocVersion, '2026.3.13') : null;

  const handleRestartGateway = async () => {
    if (!restartGateway) {
      addLog(t('logs.commFailed', { msg: 'Restart function not available' }), 'stderr');
      return;
    }
    setGatewayRestarting(true);
    try {
      await restartGateway();
    } finally {
      setGatewayRestarting(false);
    }
  };

  const handleCheckOcVersion = async () => {
    if (!config.corePath) return;
    setOcVersionChecking(true);
    try {
      const res = await window.electronAPI.exec(
        `cd ${JSON.stringify(config.corePath)} && zsh -ilc "pnpm openclaw --version" 2>&1 || pnpm openclaw --version 2>&1`
      );
      const match = (res.stdout || '').match(/\d{4}\.\d+\.\d+/);
      setOcVersion(match ? match[0] : null);
    } catch {
      setOcVersion(null);
    } finally {
      setOcVersionChecking(false);
    }
  };

  const handleCheckChromeStatus = async () => {
    setChromeChecking(true);
    try {
      const res = await window.electronAPI.checkChromeDebug(config.chromeDebugPort ?? 9222);
      setChromeRunning(res.running);
    } finally {
      setChromeChecking(false);
    }
  };

  const handleLaunchChrome = async () => {
    setChromeLaunching(true);
    try {
      addLog(`[Browser] 正在關閉 Chrome 並以除錯模式重新啟動（port ${config.chromeDebugPort ?? 9222}）…`);
      const res = await window.electronAPI.launchChromeDebug(config.chromeDebugPort ?? 9222);
      if (!res.success) {
        addLog(`[Browser] Chrome 啟動失敗: ${res.error}`);
      } else {
        addLog(`[Browser] Chrome 已重新啟動，--remote-debugging-port=${config.chromeDebugPort ?? 9222}`);
        // Poll until port is bound (Chrome needs a few seconds after spawn)
        let retries = 0;
        const pollStatus = async () => {
          const r = await window.electronAPI.checkChromeDebug(config.chromeDebugPort ?? 9222);
          setChromeRunning(r.running);
          if (!r.running && retries < 5) {
            retries++;
            setTimeout(pollStatus, 2000);
          }
        };
        setTimeout(pollStatus, 3000);
      }
    } finally {
      setChromeLaunching(false);
    }
  };

  useEffect(() => {
    handleCheckChromeStatus();
    detectOcVersion();
    const timer = setInterval(handleCheckChromeStatus, 10000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveButtonLabel =
    launcherSaveState === 'saving'
      ? t('settings.savingConfigButton')
      : launcherSaveState === 'saved'
        ? t('settings.configSavedButton')
        : launcherSaveState === 'error'
          ? t('settings.saveConfigFailedButton')
          : t('settings.saveConfig');

  const shouldUseExternalTerminal = (cfg?: Config) =>
    (cfg?.useExternalTerminal ?? config?.useExternalTerminal) !== false;

  const handleCheckUpdate = async () => {
    setUpdateState('checking');
    setUpdateInfo(null);
    setUpdateError('');
    try {
      const res = await window.electronAPI.exec('app:check-update');
      if ((res.code ?? res.exitCode) !== 0) throw new Error(res.stderr || 'unknown error');
      const info: UpdateInfo = JSON.parse(res.stdout);
      setUpdateInfo(info);
      setUpdateState(info.upToDate ? 'up-to-date' : 'available');
    } catch (e: unknown) {
      setUpdateError(e instanceof Error ? e.message : 'unknown error');
      setUpdateState('error');
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-8 shadow-xl shadow-slate-200/50 dark:shadow-none">
        {/* Runtime Paths Section */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">
            Launcher Runtime Paths
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Core Path */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                {t('settings.corePath')}
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={config.corePath || ''}
                  onChange={(e) => setConfig({ corePath: e.target.value })}
                  placeholder={t('settings.corePathPlaceholder')}
                  className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                />
                <button
                  onClick={() => handleBrowsePath('corePath')}
                  title={t('settings.browseFolder', 'Browse folder')}
                  className="px-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
                >
                  <FolderOpen size={15} className="text-slate-500 dark:text-slate-400" />
                </button>
              </div>
            </div>

            {/* Config Path */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                {t('settings.configPath')}
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={config.configPath || ''}
                  onChange={(e) => setConfig({ configPath: e.target.value })}
                  placeholder={t('settings.configPathPlaceholder')}
                  className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                />
                <button
                  onClick={() => handleBrowsePath('configPath')}
                  title={t('settings.browseFolder', 'Browse folder')}
                  className="px-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
                >
                  <FolderOpen size={15} className="text-slate-500 dark:text-slate-400" />
                </button>
              </div>
            </div>

            {/* Workspace Path */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                {t('settings.workspacePath')}
              </label>
              <div className="flex items-stretch gap-2">
                <input
                  type="text"
                  value={config.workspacePath || ''}
                  onChange={(e) => setConfig({ workspacePath: e.target.value })}
                  placeholder={t('settings.workspacePathPlaceholder')}
                  className="flex-1 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                />
                <button
                  onClick={() => handleBrowsePath('workspacePath')}
                  title={t('settings.browseFolder', 'Browse folder')}
                  className="px-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center"
                >
                  <FolderOpen size={15} className="text-slate-500 dark:text-slate-400" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Launch Behavior Section */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">
            Launcher Start Behavior
          </div>
          {/* External Terminal Toggle */}
          <div className="mt-5 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {t('settings.externalTerminalTitle')}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {t('settings.externalTerminalDesc')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfig({ useExternalTerminal: !shouldUseExternalTerminal() })}
              className={`shrink-0 inline-flex h-7 w-12 items-center rounded-full border transition-all ${
                shouldUseExternalTerminal()
                  ? 'bg-emerald-500 border-emerald-500 justify-end'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 justify-start'
              }`}
              aria-pressed={shouldUseExternalTerminal()}
              aria-label={t('settings.externalTerminalTitle')}
              title={t('settings.externalTerminalTitle')}
            >
              <span className="mx-1 h-5 w-5 rounded-full bg-white shadow-sm" />
            </button>
          </div>

          {/* Auto Restart Gateway */}
          <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {t('launcher.autoRestart.label')}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {t('launcher.autoRestart.desc')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfig({ autoRestartGateway: !config.autoRestartGateway })}
              className={`shrink-0 inline-flex h-7 w-12 items-center rounded-full border transition-all ${
                config.autoRestartGateway
                  ? 'bg-emerald-500 border-emerald-500 justify-end'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 justify-start'
              }`}
              aria-pressed={config.autoRestartGateway}
              aria-label={t('settings.autoRestartGatewayTitle')}
              title={t('settings.autoRestartGatewayTitle')}
            >
              <span className="mx-1 h-5 w-5 rounded-full bg-white shadow-sm" />
            </button>
          </div>

          {/* Background Service (Daemon) */}
          <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {t('settings.installDaemonTitle')}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {t('settings.installDaemonDesc')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfig({ installDaemon: !config.installDaemon })}
              className={`shrink-0 inline-flex h-7 w-12 items-center rounded-full border transition-all ${
                config.installDaemon
                  ? 'bg-emerald-500 border-emerald-500 justify-end'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 justify-start'
              }`}
              aria-pressed={config.installDaemon}
              aria-label={t('settings.installDaemonTitle')}
              title={t('settings.installDaemonTitle')}
            >
              <span className="mx-1 h-5 w-5 rounded-full bg-white shadow-sm" />
            </button>
          </div>

          {/* Unrestricted Mode */}
          <div className="mt-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {t('settings.unrestrictedModeTitle')}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {t('settings.unrestrictedModeDesc')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfig({ unrestrictedMode: !config.unrestrictedMode })}
              className={`shrink-0 inline-flex h-7 w-12 items-center rounded-full border transition-all ${
                config.unrestrictedMode
                  ? 'bg-emerald-500 border-emerald-500 justify-end'
                  : 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600 justify-start'
              }`}
              aria-pressed={config.unrestrictedMode}
              aria-label={t('settings.unrestrictedModeTitle')}
              title={t('settings.unrestrictedModeTitle')}
            >
              <span className="mx-1 h-5 w-5 rounded-full bg-white shadow-sm" />
            </button>
          </div>
        </div>

        {/* Gateway Communication Hub Section */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4 flex items-center gap-1.5">
            <Wifi size={11} />
            Gateway Communication Hub
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  重新啟動通訊中樞 (Hot Restart)
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  暫停後立即重新啟動 Gateway，保持通訊鏈路穩定性
                </div>
              </div>
              <button
                type="button"
                onClick={handleRestartGateway}
                disabled={gatewayRestarting}
                className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-60 disabled:cursor-wait"
              >
                <RefreshCw size={12} className={gatewayRestarting ? 'animate-spin' : ''} />
                {gatewayRestarting ? '重新啟動中…' : '重新啟動'}
              </button>
            </div>
          </div>
        </div>

        {/* Browser Control Section */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4 flex items-center gap-1.5">
            <Globe size={11} />
            Browser Control
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 space-y-3">

            {/* Version detection row */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500">OpenClaw 版本</span>
                {ocVersion ? (
                  <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-lg ${
                    supportsExistingSession
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                  }`}>
                    v{ocVersion}
                  </span>
                ) : ocVersionChecking ? (
                  <span className="text-[11px] text-slate-400">偵測中…</span>
                ) : (
                  <span className="text-[11px] text-slate-400">未偵測</span>
                )}
                {ocVersion && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${
                    supportsExistingSession
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                  }`}>
                    {supportsExistingSession ? '✓ 支援瀏覽器控制' : '需升級至 2026.3.13+'}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={detectOcVersion}
                disabled={ocVersionChecking || !config.corePath}
                title="重新偵測版本"
                className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
              >
                <RefreshCw size={11} className={`text-slate-500 dark:text-slate-400 ${ocVersionChecking ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Version too old: show upgrade notice */}
            {supportsExistingSession === false && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 px-3 py-2.5">
                <AlertCircle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                <div className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                  <span className="font-bold">版本過舊，不支援瀏覽器控制。</span>
                  <br />
                  2026.3.13 以前需透過 Chrome 擴充功能連線（現已移除）。請升級 OpenClaw 後再使用此功能。
                </div>
              </div>
            )}

            {/* Chrome launch controls — only when version supports or unknown */}
            {supportsExistingSession !== false && (
              <div className={supportsExistingSession === null ? '' : 'pt-1 border-t border-slate-100 dark:border-slate-800'}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Chrome 遠端除錯模式</span>
                      <div className="relative group">
                        <Info size={12} className="text-slate-400 dark:text-slate-500 cursor-help" />
                        <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-72 opacity-0 group-hover:opacity-100 transition-opacity z-50">
                          <div className="bg-slate-900 dark:bg-slate-800 text-slate-100 text-[10px] font-mono rounded-xl px-3 py-2.5 shadow-xl space-y-0.5">
                            <div className="text-[9px] uppercase tracking-widest text-slate-400 font-sans font-bold mb-1.5">執行步驟</div>
                            <div>1. pkill -9 -f "Google Chrome"</div>
                            <div>2. pgrep 確認已關閉</div>
                            <div>3. rm SingletonLock / SingletonCookie</div>
                            <div>4. "/Applications/…/Google Chrome" \</div>
                            <div className="pl-3 text-slate-300">--remote-debugging-port=9222 \</div>
                            <div className="pl-3 text-slate-300">--user-data-dir="~/…/ChromeDebugging" \</div>
                            <div className="pl-3 text-slate-300">--no-first-run</div>
                          </div>
                          <div className="w-2 h-2 bg-slate-900 dark:bg-slate-800 rotate-45 mx-auto -mt-1" />
                        </div>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      透過 <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">chrome-devtools-mcp</code> attach 你正在使用的 Chrome
                    </div>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-lg ${
                    chromeRunning
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}>
                    {chromeRunning ? '運行中' : '未啟動'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold text-slate-500 shrink-0">Port</label>
                  <input
                    type="number"
                    value={config.chromeDebugPort ?? 9222}
                    onChange={(e) => setConfig({ chromeDebugPort: Number(e.target.value) })}
                    className="w-24 bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
                    min={1024}
                    max={65535}
                  />
                  <button
                    type="button"
                    onClick={handleCheckChromeStatus}
                    disabled={chromeChecking}
                    title="檢查狀態"
                    className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-60"
                  >
                    <RefreshCw size={12} className={`text-slate-500 dark:text-slate-400 ${chromeChecking ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={handleLaunchChrome}
                    disabled={chromeLaunching}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-60 disabled:cursor-wait"
                  >
                    <Play size={12} />
                    {chromeLaunching ? '重新啟動中…' : '重新啟動 Chrome（除錯模式）'}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Check for Updates Section */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4">
            {t('settings.checkUpdateTitle')}
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                {t('settings.checkUpdateCurrentVersion')}
                {updateInfo && (
                  <span className="font-mono font-normal text-slate-500 dark:text-slate-400">v{updateInfo.current}</span>
                )}
              </div>
              {updateState === 'up-to-date' && (
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                  <CheckCircle size={12} />
                  {updateInfo?.noReleases 
                    ? t('settings.checkUpdateNoReleases') 
                    : t('settings.checkUpdateUpToDate', { version: updateInfo?.current })}
                </div>
              )}
              {updateState === 'available' && updateInfo && (
                <div className="mt-3 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                      <AlertCircle size={12} />
                      {t('settings.checkUpdateAvailable', { version: updateInfo.latest })}
                    </span>
                    <button
                      type="button"
                      onClick={() => window.electronAPI.openExternal(updateInfo.htmlUrl)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <Download size={11} />
                      {t('settings.checkUpdateDownload')}
                    </button>
                  </div>
                  
                  {updateInfo.changelog && (
                    <div className="rounded-xl bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-slate-700/50 p-4 animate-in fade-in slide-in-from-top-1 duration-300">
                      <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 flex justify-between items-center">
                        <span>{t('settings.checkUpdateChangelog')}</span>
                        {updateInfo.publishedAt && (
                          <span>{new Date(updateInfo.publishedAt).toLocaleDateString()}</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed font-sans whitespace-pre-wrap max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                        {updateInfo.changelog}
                      </div>
                    </div>
                  )}
                </div>
              )}
              {updateState === 'error' && (
                <div className="mt-1 flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400 font-semibold">
                    <AlertCircle size={12} />
                    {t('settings.checkUpdateError')}
                  </div>
                  {updateError && (
                    <div className="text-[10px] font-mono text-rose-500/80 dark:text-rose-400/60 truncate max-w-xs" title={updateError}>
                      {updateError}
                    </div>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleCheckUpdate}
              disabled={updateState === 'checking'}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              <RefreshCw size={13} className={updateState === 'checking' ? 'animate-spin' : ''} />
              {updateState === 'checking' ? t('settings.checkUpdateChecking') : t('settings.checkUpdateBtn')}
            </button>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSaveLauncherConfig}
        disabled={launcherSaveState === 'saving'}
        className={`w-full py-4 rounded-2xl font-black text-white shadow-xl transition-all ${
          launcherSaveState === 'saved'
            ? 'bg-emerald-600 shadow-emerald-600/20'
            : launcherSaveState === 'error'
              ? 'bg-rose-600 shadow-rose-600/20'
              : 'bg-blue-600 shadow-blue-600/20 hover:bg-blue-500 active:scale-[0.98]'
        } disabled:cursor-wait disabled:opacity-80`}
      >
        {saveButtonLabel}
      </button>
    </div>
  );
};
