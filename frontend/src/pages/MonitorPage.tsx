import React from 'react';
import { FolderOpen, Settings, Zap, RotateCcw, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DecisionDashboard } from '../components/monitor/DecisionDashboard';
import TerminalLog from '../components/common/TerminalLog';
import { useStore } from '../store';
import { useMonitorComputedValues } from '../hooks/useMonitorComputedValues';
import type { Config, LogEntry, AuditTimelineItem, ReadModelSnapshot } from '../store';

interface MonitorPageProps {
  running: boolean;
  onToggleGateway: () => Promise<void>;
  onRestartGateway?: () => Promise<void>;
  onNavigate?: (path: string) => void;
  config: Config;
  resolvedConfigDir: string;
  snapshot: ReadModelSnapshot | null;
  logs: LogEntry[];
  auditTimeline: AuditTimelineItem[];
  dailyDigest: string;
}

// Status Card Component

export const MonitorPage: React.FC<MonitorPageProps> = ({
  running,
  onToggleGateway,
  onRestartGateway,
  onNavigate,
  config,
  resolvedConfigDir,
  snapshot,
  logs,
  auditTimeline,
  dailyDigest,
}) => {
  const { t } = useTranslation();
  const addLog = useStore((s) => s.addLog);
  const setRunning = useStore((s) => s.setRunning);
  const resolvedConfigFilePath = resolvedConfigDir ? `${resolvedConfigDir}/openclaw.json` : '';
  const [forceReleasing, setForceReleasing] = React.useState(false);
  const [restarting, setRestarting] = React.useState(false);
  const [toggling, setToggling] = React.useState(false);

  // Clear loading if running state resolves from an external source (watchdog, auto-sync, etc.)
  React.useEffect(() => {
    if (running) setToggling(false);
  }, [running]);

  const TOGGLE_TIMEOUT_MS = 35_000;

  const handleToggle = async () => {
    if (running) {
      // Stop path: opens a confirmation modal, no loading on this button
      await onToggleGateway();
      return;
    }
    if (toggling) return;
    setToggling(true);
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), TOGGLE_TIMEOUT_MS),
    );
    try {
      await Promise.race([onToggleGateway(), timeoutPromise]);
    } catch {
      // timeout or unexpected error — just clear loading
    } finally {
      setToggling(false);
    }
  };

  const handleForceRelease = async () => {
    if (!window.electronAPI) return;
    setForceReleasing(true);
    addLog(t('monitor.forceReleasing'), 'system');
    try {
      const res = await window.electronAPI.exec('process:force-release');
      if (res.code === 0) {
        const result = JSON.parse(res.stdout || '{}');
        setRunning(false);
        addLog(t('monitor.forceReleased', { remaining: result.remaining ?? '?' }), 'system');
      } else {
        addLog(`[force-release] failed: ${res.stderr || 'unknown'}`, 'stderr');
      }
    } catch (e) {
      addLog(`[force-release] error: ${e instanceof Error ? e.message : String(e)}`, 'stderr');
    } finally {
      setForceReleasing(false);
    }
  };
  const { gatewayRuntimeZones } = useMonitorComputedValues({
    corePath: config.corePath,
    workspacePath: config.workspacePath,
    resolvedConfigDir,
    resolvedConfigFilePath,
    t,
  });

  const openZoneFolder = async (zoneLabel: string, folderPath?: string) => {
    const target = (folderPath || '').trim();
    if (!target) {
      addLog(`${zoneLabel}: ${t('monitor.pathUnset')}`, 'system');
      return;
    }
    if (!window.electronAPI?.openPath) {
      addLog(t('monitor.openFolderUnavailable'), 'stderr');
      return;
    }
    const result = await window.electronAPI.openPath(target);
    if (!result?.success) {
      addLog(t('monitor.openFolderFailed', { zone: zoneLabel, msg: result?.error || 'unknown error' }), 'stderr');
    }
  };

  const accessIssue = React.useMemo(() => {
    const recentLogs = [...logs].slice(-120).reverse();
    const trigger = recentLogs.find((entry) => /openclaw:\s*access not configured/i.test(String(entry?.text || '')));
    if (!trigger) return null;

    const userLine = recentLogs.find((entry) => /your telegram user id\s*:/i.test(String(entry?.text || '')));
    const codeLine = recentLogs.find((entry) => /pairing code\s*:/i.test(String(entry?.text || '')));
    const approveLine = recentLogs.find((entry) => /openclaw pairing approve telegram/i.test(String(entry?.text || '')));

    const userIdMatch = String(userLine?.text || '').match(/your telegram user id\s*:\s*(\d+)/i);
    const codeMatch = String(codeLine?.text || '').match(/pairing code\s*:\s*([A-Z0-9-]+)/i);

    return {
      userId: userIdMatch?.[1] || '',
      pairingCode: codeMatch?.[1] || '',
      approveCmd: String(approveLine?.text || '').trim(),
    };
  }, [logs]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {accessIssue && (
        <div className="rounded-3xl border border-amber-300/80 bg-amber-50/80 p-6 shadow-lg dark:border-amber-700/60 dark:bg-amber-950/30">
          <div className="text-sm font-black text-rose-600 dark:text-rose-400 mb-1">
            {t('monitor.access.title')}
          </div>
          <div className="text-[11px] text-rose-500/80 leading-relaxed mb-3">
            {t('monitor.access.desc')}
          </div>
          <div className="space-y-1 text-[10px] text-rose-400 font-mono mb-4">
            <div>Telegram User ID：{accessIssue.userId || t('common.labels.notParsed')}</div>
            <div>Pairing Code：{accessIssue.pairingCode || t('common.labels.notParsed')}</div>
            {accessIssue.approveCmd ? (
              <div className="rounded-xl border border-amber-300/70 bg-white/80 px-3 py-2 font-mono dark:border-amber-700/60 dark:bg-amber-950/40">
                {accessIssue.approveCmd}
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => onNavigate?.('runtime')} className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors shadow-sm shadow-rose-200 dark:shadow-none">
              <Settings size={12} />
              {t('monitor.access.goToRuntime')}
            </button>
            <button onClick={() => void window.electronAPI.exec('open .')} className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-800 text-rose-500 border border-rose-200 dark:border-rose-900/50 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors">
              <FolderOpen size={12} />
              {t('monitor.access.openConfigDir')}
            </button>
          </div>
        </div>
      )}

      {/* Gateway Control Card */}
      <div className="bg-slate-50 dark:bg-slate-900/30 backdrop-blur-md border border-slate-200 dark:border-slate-800 p-8 rounded-3xl flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between shadow-lg">
        <div className="w-full lg:max-w-[72%]">
          <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {t('monitor.gatewayTitle')}
          </h3>
          <p className="text-sm text-slate-500 mt-1">{t('monitor.gatewayDesc')}</p>

          {/* Runtime Paths Info */}
          <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white/70 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/50">
            <div className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
              {t('monitor.currentRuntimePathsTitle')}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {gatewayRuntimeZones.map((zone) => (
                <div
                  key={zone.key}
                  className={`rounded-xl border px-3 py-3 bg-gradient-to-br ${zone.accent} ${zone.border}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
                      {zone.label}
                    </div>
                    <button
                      type="button"
                      onClick={() => openZoneFolder(zone.label, zone.folderPath)}
                      className="inline-flex items-center rounded-md border border-slate-300/90 bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-600 transition-colors hover:bg-white dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <FolderOpen size={12} className="mr-1" />
                      {t('monitor.openFolder')}
                    </button>
                  </div>
                  <div className="mt-2 break-all font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-200">
                    {zone.value || t('monitor.pathUnset')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="self-start lg:self-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/50 px-6 py-4">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
            Gateway Status
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${running ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            <span className={`text-sm font-bold ${running ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
              {running ? t('app.gatewayActive') : t('app.standby')}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleToggle()}
            disabled={toggling}
            className={`mt-4 w-full flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition-colors disabled:cursor-wait ${
              running
                ? 'bg-rose-600 hover:bg-rose-500'
                : toggling
                  ? 'bg-emerald-600 opacity-75'
                  : 'bg-emerald-600 hover:bg-emerald-500'
            }`}
          >
            {toggling && <Loader2 size={12} className="animate-spin" />}
            {running
              ? t('monitor.disconnect')
              : toggling
                ? t('monitor.starting')
                : t('monitor.startService')}
          </button>
          {onRestartGateway && running && (
            <button
              type="button"
              onClick={async () => {
                if (restarting) return;
                setRestarting(true);
                try {
                  await onRestartGateway();
                } finally {
                  setRestarting(false);
                }
              }}
              disabled={restarting}
              className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold bg-slate-600 text-white hover:bg-slate-500 transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              <RotateCcw size={12} className={restarting ? 'animate-spin' : ''} />
              {restarting ? t('monitor.restarting') : t('monitor.restart')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleForceRelease()}
            disabled={forceReleasing}
            className="mt-2 w-full flex items-center justify-center gap-1 rounded-lg px-2 py-1 text-[10px] text-slate-400 dark:text-slate-600 hover:text-amber-600 dark:hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Zap size={9} />
            {forceReleasing ? t('monitor.forceReleasing') : t('monitor.forceRelease')}
          </button>
        </div>
      </div>

      {/* Decision Dashboard */}
      <DecisionDashboard
        running={running}
        config={config}
        resolvedConfigDir={resolvedConfigDir}
        snapshot={snapshot}
      />

      {/* Terminal Log */}
      <div id="monitor-live-stream">
        <TerminalLog
          logs={logs}
          height="h-[420px]"
          title={t('monitor.liveStream')}
          timeline={auditTimeline}
          dailyDigest={dailyDigest}
        />
      </div>
    </div>
  );
};
