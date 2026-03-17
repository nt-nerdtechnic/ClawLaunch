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

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
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
