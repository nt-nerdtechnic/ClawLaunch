import React, { useState, useEffect, useRef } from 'react';
import { FolderOpen, RefreshCw, CheckCircle, AlertCircle, Download, Globe, Play, Info, Loader2, RotateCcw, ChevronDown, ChevronUp, Shield, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import type { Config } from '../store';
import { useLauncherSettingsActions } from '../hooks/useLauncherSettingsActions';
import { ConfigService } from '../services/configService';
import { execInTerminal } from '../utils/terminal';
import TerminalLog from '../components/common/TerminalLog';
import { UninstallModal } from '../components/dialogs/UninstallModal';

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

interface LauncherSettingsPageProps {}

export const LauncherSettingsPage: React.FC<LauncherSettingsPageProps> = () => {
  const { t } = useTranslation();
  const config = useStore((s) => s.config);
  const setConfig = useStore((s) => s.setConfig);
  const addLog = useStore((s) => s.addLog);
  const runtimeProfile = useStore((s) => s.runtimeProfile);
  const logs = useStore((s) => s.logs);
  const {
    launcherSaveState,
    handleSaveLauncherConfig,
    handleBrowsePath,
    handleOpenClawDoctor,
    handleSecurityCheck,
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
  const ocVersion = useStore((s) => s.ocVersion);
  const ocVersionChecking = useStore((s) => s.ocVersionChecking);
  const checkOcVersion = useStore((s) => s.checkOcVersion);

  // OpenClaw update / rollback state
  interface BackupEntry { name: string; path: string; mtime: number; }
  const [availableVersions, setAvailableVersions] = useState<string[]>(['main']);
  const [selectedVersion, setSelectedVersion] = useState('main');
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backupsExpanded, setBackupsExpanded] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState('');
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const wasUpdatingRef = useRef(false);
  const updateLogStartRef = useRef<number>(-1);
  const [showUninstall, setShowUninstall] = useState(false);
  const [dangerExpanded, setDangerExpanded] = useState(false);

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

  const handleCheckOcVersion = () => checkOcVersion(config.corePath);

  const normalizeVersion = (v: string) => v.trim().replace(/^v/i, '');
  const shellQuote = ConfigService.shellQuote;
  const buildOpenClawEnvPrefix = () => ConfigService.buildOpenClawEnvPrefix(config.configPath);
  const buildGatewayProfileArg = () => ConfigService.buildGatewayProfileArg(config.configPath);
  const effectiveRuntimeGatewayPort = String((runtimeProfile?.gateway as Record<string, unknown> | null | undefined)?.port ?? '').trim();

  const fetchAvailableVersions = async () => {
    setVersionsLoading(true);
    const res = await window.electronAPI.exec('project:get-versions');
    if (res.code === 0 && res.stdout?.trim()) {
      try {
        const parsed = JSON.parse(res.stdout);
        if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
          setAvailableVersions(parsed);
          // 自動選取第一個非當前版本，避免使用者誤認 'main' 就是目標版本
          setSelectedVersion((prev) => {
            if (prev !== 'main') return prev; // 使用者已手動選過，不覆蓋
            const currentNorm = normalizeVersion(ocVersion ?? '');
            const firstNonCurrent = parsed.find((v: string) => normalizeVersion(v) !== currentNorm);
            return firstNonCurrent ?? prev;
          });
        }
      } catch { /* keep default */ }
    }
    setVersionsLoading(false);
  };

  const fetchBackups = async () => {
    if (!config.corePath?.trim()) return;
    setBackupsLoading(true);
    const res = await window.electronAPI.exec(`project:list-backups ${JSON.stringify({ corePath: config.corePath })}`);
    if (res.code === 0 && res.stdout?.trim()) {
      try {
        const parsed: BackupEntry[] = JSON.parse(res.stdout);
        setBackups(parsed);
        if (parsed.length > 0 && !selectedBackup) setSelectedBackup(parsed[0].path);
      } catch { /* keep */ }
    }
    setBackupsLoading(false);
  };

  const handleUpdateOpenClaw = async (targetVersion: string) => {
    if (!config.corePath?.trim()) {
      addLog(t('runtime.update.missingCore'), 'stderr');
      return;
    }
    const version = targetVersion.trim() || 'main';
    setIsUpdating(true);
    addLog(t('runtime.update.started', { version }), 'system');

    const unlisten = window.electronAPI.onLog?.((payload) => {
      const text = payload.data.replace(/\n$/, '');
      if (text) addLog(text, payload.source);
    });

    try {
      const payload = { corePath: config.corePath, version };
      const res = await window.electronAPI.exec(`project:update ${JSON.stringify(payload)}`);

      if ((res.code ?? res.exitCode) !== 0) {
        addLog(t('runtime.update.failed', { msg: res.stderr || `exit ${res.code}` }), 'stderr');
        return;
      }

      addLog(t('runtime.update.success'), 'system');
      addLog(t('runtime.update.restartingGateway'), 'system');
      const envPrefix = buildOpenClawEnvPrefix();
      const profileArg = buildGatewayProfileArg();
      const corePath = config.corePath;

      await window.electronAPI.exec(
        `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw ${profileArg}gateway stop`
      ).catch(() => {});

      const gatewayPort = effectiveRuntimeGatewayPort?.trim() || '18789';
      let waited = 0;
      const checkGatewayDown = async (): Promise<boolean> => {
        const r = await window.electronAPI.exec(`lsof -nP -iTCP:${gatewayPort} -sTCP:LISTEN 2>/dev/null | wc -l`).catch(() => ({ stdout: '0' }));
        return String(r.stdout || '0').trim() === '0';
      };
      while (waited < 10000 && !(await checkGatewayDown())) {
        await new Promise<void>((r) => setTimeout(r, 500));
        waited += 500;
      }

      if (config.installDaemon) {
        await window.electronAPI.exec(
          `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw ${profileArg}gateway start`
        ).catch(() => {});
      } else {
        await execInTerminal(
          `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw ${profileArg}gateway run --verbose --force`,
          { title: 'OpenClaw Gateway', holdOpen: false, cwd: corePath }
        );
      }

      await new Promise<void>((r) => setTimeout(r, 3000));
      const statusRes = await window.electronAPI.exec(
        `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw ${profileArg}gateway status`
      ).catch(() => ({ code: 1, stderr: 'status check failed' }));

      if ((statusRes?.code ?? 1) !== 0) {
        addLog(t('runtime.update.gatewayRetrying'), 'system');
        await new Promise<void>((r) => setTimeout(r, 4000));
        const retryRes = await window.electronAPI.exec(
          `cd ${shellQuote(corePath)} && ${envPrefix}pnpm openclaw ${profileArg}gateway status`
        ).catch(() => ({ code: 1 }));
        if ((retryRes?.code ?? 1) !== 0) {
          addLog(t('runtime.update.gatewayWarning', { msg: 'Please manually verify Gateway startup' }), 'stderr');
        } else {
          addLog(t('runtime.update.gatewayRestarted'), 'system');
        }
      } else {
        addLog(t('runtime.update.gatewayRestarted'), 'system');
      }
    } catch (e: unknown) {
      addLog(t('runtime.update.failed', { msg: e instanceof Error ? e.message : String(e) }), 'stderr');
    } finally {
      unlisten?.();
      setIsUpdating(false);
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
    handleCheckOcVersion();
    const timer = setInterval(handleCheckChromeStatus, 10000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void fetchAvailableVersions(); }, []);

  useEffect(() => {
    if (isUpdating) {
      wasUpdatingRef.current = true;
      updateLogStartRef.current = logs.length;
    } else if (wasUpdatingRef.current) {
      wasUpdatingRef.current = false;
      setBackupsExpanded(true);
      void fetchBackups();
      void checkOcVersion(config.corePath);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUpdating]);

  useEffect(() => {
    if (backupsExpanded && !wasUpdatingRef.current) void fetchBackups();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backupsExpanded, config.corePath]);

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
            <div className="space-y-2 md:col-span-2">
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



        {/* Browser Control Section */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4 flex items-center gap-1.5">
            <Globe size={11} />
            Browser Control
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 space-y-3">

            {/* Version support status — hide if compatible (OpenClaw >= 2026.3.13) */}
            {supportsExistingSession !== true && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/50 px-3 py-2.5">
                <div className="text-[11px] text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2">
                  <span className="font-bold">版本支援狀態：</span>
                  {supportsExistingSession === false && (
                    <span className="text-amber-700 dark:text-amber-300 font-bold">
                      {ocVersion ? `OpenClaw v${ocVersion}，目前不支援 Browser Control` : '目前不支援 Browser Control'}
                    </span>
                  )}
                  {supportsExistingSession === null && (
                    <span className="text-slate-500 dark:text-slate-400">
                      {ocVersionChecking ? '背景判斷中…' : '尚未取得版本，背景判斷中'}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                  判斷規則：OpenClaw 版本需 &gt;= 2026.3.13 才支援 Browser Control。
                </div>
              </div>
            )}

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

        {/* Quick Diagnostics Section */}
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500 mb-4 flex items-center gap-1.5">
            <Shield size={11} />
            {t('settings.diag.title')}
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/60 px-4 py-3 space-y-4">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('settings.diag.terminalHelp')}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleOpenClawDoctor}
                disabled={!config?.corePath?.trim()}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-sky-300 bg-sky-50 hover:bg-sky-100 text-sky-700 font-bold text-[11px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:border-sky-700 dark:bg-sky-950/30 dark:hover:bg-sky-950/50 dark:text-sky-300"
              >
                <span>🩺</span>
                <span>doctor --fix</span>
              </button>
              <button
                type="button"
                onClick={handleSecurityCheck}
                disabled={!config?.corePath?.trim()}
                className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-700 font-bold text-[11px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:border-violet-700 dark:bg-violet-950/30 dark:hover:bg-violet-950/50 dark:text-violet-300"
              >
                <span>🔍</span>
                <span>{t('runtime.diag.securityAudit')}</span>
              </button>
            </div>
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

      {/* OpenClaw Core Version & Update Section */}
      <div className="p-8 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] space-y-4 shadow-xl shadow-slate-200/50 dark:shadow-none">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
          {t('runtime.update.title')}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {t('runtime.update.currentVersion')}
          </span>
          {ocVersion ? (
            <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg px-2 py-0.5">
              v{ocVersion}
            </span>
          ) : (
            <span className="text-xs text-slate-400 italic">
              {config.corePath?.trim() ? t('runtime.update.versionLoading') : t('runtime.update.versionUnavailable')}
            </span>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
              {t('runtime.update.selectVersion')}
            </span>
            <div className="flex items-center gap-1.5">
              {versionsLoading && <Loader2 size={11} className="animate-spin text-slate-400" />}
              <button
                type="button"
                onClick={() => void fetchAvailableVersions()}
                disabled={versionsLoading}
                className="text-[10px] font-bold text-sky-500 hover:text-sky-600 disabled:opacity-40 transition-colors"
              >
                {t('runtime.update.refreshVersions')}
              </button>
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0.5">
                {t('setupInitialize.versionSource')}
              </span>
            </div>
          </div>
          <select
            value={selectedVersion}
            onChange={(e) => setSelectedVersion(e.target.value)}
            className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-blue-400 dark:focus:border-blue-500/50 transition-colors"
          >
            {availableVersions.map((v) => {
              const isCurrent = !!ocVersion && normalizeVersion(v) === normalizeVersion(ocVersion);
              const label = isCurrent
                ? `${v}  ✓ ${t('runtime.update.installedLabel')}`
                : v === 'main'
                  ? `${v} ${t('setupInitialize.latestSuffix')}`
                  : v;
              return (
                <option key={v} value={v} disabled={isCurrent}>
                  {label}
                </option>
              );
            })}
          </select>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={() => void handleUpdateOpenClaw(selectedVersion)}
            disabled={!config?.corePath?.trim() || isUpdating || (!!ocVersion && normalizeVersion(selectedVersion) === normalizeVersion(ocVersion))}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:border-emerald-700 dark:bg-emerald-950/30 dark:hover:bg-emerald-950/50 dark:text-emerald-300"
          >
            {isUpdating ? (
              <><Loader2 size={14} className="animate-spin" /><span>{t('runtime.update.updating')}</span></>
            ) : (
              <><span>🔄</span><span>{t('runtime.update.updateBtn')}</span></>
            )}
          </button>
        </div>
        {(isUpdating || logs.length > updateLogStartRef.current) && updateLogStartRef.current >= 0 && (
          <TerminalLog
            logs={logs.slice(updateLogStartRef.current)}
            height="h-52"
            title="Update Output"
          />
        )}
      </div>

      {/* Rollback Section */}
      <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden">
        <button
          type="button"
          onClick={() => setBackupsExpanded(v => !v)}
          className="w-full flex items-center justify-between px-8 py-5 hover:bg-slate-100 dark:hover:bg-slate-800/40 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <RotateCcw size={14} className="text-amber-500" />
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
              {t('runtime.rollback.title')}
            </span>
            {backups.length > 0 && (
              <span className="text-[9px] font-bold bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 rounded-full px-2 py-0.5">
                {backups.length}
              </span>
            )}
          </div>
          {backupsExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </button>

        {backupsExpanded && (
          <div className="px-8 pb-8 space-y-4 border-t border-slate-200 dark:border-slate-800 pt-5">
            <p className="text-[11px] text-slate-400 dark:text-slate-500">{t('runtime.rollback.desc')}</p>

            <div className="flex items-center justify-between px-1">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                {t('runtime.rollback.selectBackup')}
              </span>
              <button
                type="button"
                onClick={() => void fetchBackups()}
                disabled={backupsLoading}
                className="text-[10px] font-bold text-sky-500 hover:text-sky-600 disabled:opacity-40 transition-colors flex items-center gap-1"
              >
                {backupsLoading && <Loader2 size={9} className="animate-spin" />}
                {t('runtime.update.refreshVersions')}
              </button>
            </div>

            {backups.length === 0 && !backupsLoading ? (
              <p className="text-[11px] text-slate-400 italic px-1">{t('runtime.rollback.noBackups')}</p>
            ) : (
              <select
                value={selectedBackup}
                onChange={(e) => setSelectedBackup(e.target.value)}
                className="w-full bg-white dark:bg-black/40 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-slate-700 dark:text-slate-300 font-mono text-xs outline-none focus:border-amber-400 dark:focus:border-amber-500/50 transition-colors"
              >
                {backups.map((b) => (
                  <option key={b.path} value={b.path}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              disabled={!selectedBackup || isRollingBack || isUpdating}
              onClick={async () => {
                if (!selectedBackup || !config.corePath?.trim()) return;
                setIsRollingBack(true);
                try {
                  const payload = { corePath: config.corePath, backupPath: selectedBackup };
                  const res = await window.electronAPI.exec(`project:rollback ${JSON.stringify(payload)}`);
                  if ((res.code ?? res.exitCode) !== 0) {
                    addLog(t('runtime.rollback.failed', { msg: res.stderr || `exit ${res.code}` }), 'stderr');
                  } else {
                    addLog(t('runtime.rollback.success', { path: selectedBackup }), 'system');
                  }
                } finally {
                  setIsRollingBack(false);
                }
              }}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-700 font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:border-amber-700 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 dark:text-amber-300"
            >
              {isRollingBack ? (
                <><Loader2 size={14} className="animate-spin" /><span>{t('runtime.rollback.rollingBack')}</span></>
              ) : (
                <><RotateCcw size={14} /><span>{t('runtime.rollback.rollbackBtn')}</span></>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Danger Zone Section */}
      <div className="bg-rose-50 dark:bg-rose-950/10 border border-rose-200 dark:border-rose-900/40 rounded-[32px] shadow-xl shadow-rose-100/50 dark:shadow-none overflow-hidden">
        <button
          type="button"
          onClick={() => setDangerExpanded(v => !v)}
          className="w-full flex items-center justify-between px-8 py-5 hover:bg-rose-100/60 dark:hover:bg-rose-950/20 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Trash2 size={14} className="text-rose-500" />
            <span className="text-[11px] font-black uppercase tracking-[0.2em] text-rose-500">
              {t('uninstall.dangerZone')}
            </span>
          </div>
          {dangerExpanded ? <ChevronUp size={14} className="text-rose-400" /> : <ChevronDown size={14} className="text-rose-400" />}
        </button>

        {dangerExpanded && (
          <div className="px-8 pb-8 space-y-4 border-t border-rose-200 dark:border-rose-800/40 pt-5">
            <div className="rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-white/80 dark:bg-rose-950/20 px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold text-slate-700 dark:text-slate-200">{t('uninstall.title')}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{t('uninstall.dangerDesc')}</div>
              </div>
              <button
                type="button"
                onClick={() => setShowUninstall(true)}
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 shadow-md shadow-rose-500/20 transition-colors"
              >
                <Trash2 size={13} />
                {t('uninstall.openBtn')}
              </button>
            </div>
          </div>
        )}
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

      <UninstallModal open={showUninstall} onClose={() => setShowUninstall(false)} />
    </div>
  );
};
