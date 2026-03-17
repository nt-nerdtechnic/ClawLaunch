import React from 'react';
import { Play, Square, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DecisionDashboard } from '../components/monitor/DecisionDashboard';
import { ActionCenter } from '../components/ActionCenter';
import { StaffGrid } from '../components/StaffGrid';
import TerminalLog from '../components/common/TerminalLog';

interface MonitorPageProps {
  running: boolean;
  onToggleGateway: () => Promise<void>;
  onOpenRuntimeSettings: () => void;
  config: any;
  resolvedConfigDir: string;
  snapshot: any;
  envStatus: {
    node: 'loading' | 'ok' | 'error';
    git: 'loading' | 'ok' | 'error';
    pnpm: 'loading' | 'ok' | 'error';
  };
  logs: any[];
  auditTimeline: any[];
  dailyDigest: string;
  gatewayRuntimeZones: Array<{
    key: string;
    label: string;
    value: string;
    folderPath?: string;
    accent: string;
    border: string;
  }>;
  onOpenZoneFolder: (zoneLabel: string, folderPath?: string) => void;
}

// Status Card Component
const StatusCard: React.FC<{ label: string; status: 'loading' | 'ok' | 'error' }> = ({ label, status }) => (
  <div className={`rounded-2xl border px-6 py-4 flex items-center justify-between ${
    status === 'ok'
      ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-700/60 dark:bg-emerald-950/40'
      : status === 'error'
        ? 'border-red-200 bg-red-50 dark:border-red-700/60 dark:bg-red-950/40'
        : 'border-amber-200 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/40'
  }`}>
    <span className={`text-sm font-bold ${
      status === 'ok'
        ? 'text-emerald-700 dark:text-emerald-300'
        : status === 'error'
          ? 'text-red-700 dark:text-red-300'
          : 'text-amber-700 dark:text-amber-300'
    }`}>
      {label}
    </span>
    <div className={`w-3 h-3 rounded-full ${status === 'ok' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
  </div>
);

export const MonitorPage: React.FC<MonitorPageProps> = ({
  running,
  onToggleGateway,
  onOpenRuntimeSettings,
  config,
  resolvedConfigDir,
  snapshot,
  envStatus,
  logs,
  auditTimeline,
  dailyDigest,
  gatewayRuntimeZones,
  onOpenZoneFolder,
}) => {
  const { t } = useTranslation();

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
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
            OpenClaw Access 未設定
          </div>
          <div className="mt-2 text-sm text-amber-800 dark:text-amber-200">
            偵測到 Gateway 回報 access 尚未配置。請先到 Runtime 設定補齊 `Config Path` 與授權設定，之後再啟動服務。
          </div>
          <div className="mt-4 grid gap-2 text-xs text-amber-900 dark:text-amber-100">
            <div>Telegram User ID：{accessIssue.userId || '未解析到'}</div>
            <div>Pairing Code：{accessIssue.pairingCode || '未解析到'}</div>
            {accessIssue.approveCmd ? (
              <div className="rounded-xl border border-amber-300/70 bg-white/80 px-3 py-2 font-mono dark:border-amber-700/60 dark:bg-amber-950/40">
                {accessIssue.approveCmd}
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onOpenRuntimeSettings}
              className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-500"
            >
              前往 Runtime 設定
            </button>
            <button
              type="button"
              onClick={() => onOpenZoneFolder(t('monitor.zoneConfig'), resolvedConfigDir)}
              className="rounded-xl border border-amber-300/80 bg-white/80 px-4 py-2 text-xs font-bold text-amber-800 transition-colors hover:bg-white dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200"
            >
              打開 Config 目錄
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
                      onClick={() => onOpenZoneFolder(zone.label, zone.folderPath)}
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

        {/* Toggle Button */}
        <button
          onClick={onToggleGateway}
          className={`self-start lg:self-center px-8 py-4 rounded-2xl font-black flex items-center transition-all ${
            running
              ? 'bg-red-500/10 dark:bg-red-500/20 text-red-500 dark:text-red-400 border border-red-500/30 dark:border-red-500/40 hover:bg-red-500/20'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 dark:border-emerald-500/40 hover:bg-emerald-500/20'
          }`}
        >
          {running ? (
            <>
              <Square size={18} className="mr-2 fill-current" />
              {t('monitor.disconnect')}
            </>
          ) : (
            <>
              <Play size={18} className="mr-2 fill-current" />
              {t('monitor.startService')}
            </>
          )}
        </button>
      </div>

      {/* Decision Dashboard */}
      <DecisionDashboard
        running={running}
        envStatus={envStatus}
        config={config}
        resolvedConfigDir={resolvedConfigDir}
        snapshot={snapshot}
      />

      {/* Action Center */}
      <div id="monitor-action-center">
        <ActionCenter />
      </div>

      {/* Staff Grid */}
      <div id="monitor-staff-grid">
        <StaffGrid />
      </div>

      {/* Environment Status */}
      <div className="grid grid-cols-3 gap-8">
        <StatusCard label={t('monitor.status.node')} status={envStatus.node} />
        <StatusCard label={t('monitor.status.git')} status={envStatus.git} />
        <StatusCard label={t('monitor.status.pnpm')} status={envStatus.pnpm} />
      </div>

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
