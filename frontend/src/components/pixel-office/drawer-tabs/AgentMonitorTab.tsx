import { useState, useEffect } from 'react';
import { Loader2, Zap, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../../store';
import TerminalLog from '../../common/TerminalLog';

interface AgentMonitorTabProps {
  agentId: string;
  onToggleGateway?: () => Promise<void>;
  onRestartGateway?: () => Promise<void>;
}

export default function AgentMonitorTab({ agentId, onToggleGateway, onRestartGateway }: AgentMonitorTabProps) {
  const { t } = useTranslation();
  const running = useStore(s => s.running);
  const setRunning = useStore(s => s.setRunning);
  const addLog = useStore(s => s.addLog);
  const logs = useStore(s => s.logs);
  const auditTimeline = useStore(s => s.auditTimeline);
  const dailyDigest = useStore(s => s.dailyDigest);

  const [forceReleasing, setForceReleasing] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (running) setToggling(false);
  }, [running]);

  const TOGGLE_TIMEOUT_MS = 35_000;

  const handleToggle = async () => {
    if (running) {
      if (onToggleGateway) await onToggleGateway();
      return;
    }
    if (toggling) return;
    setToggling(true);
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), TOGGLE_TIMEOUT_MS),
    );
    try {
      if (onToggleGateway) {
        await Promise.race([onToggleGateway(), timeoutPromise]);
      }
    } catch {
      // Timeout or error ignored, toggling will clear
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

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* Gateway Control Card (smaller version of MonitorPage) */}
      <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 p-4 rounded-[20px] shadow-sm">
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
          disabled={toggling || !onToggleGateway}
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

        {onRestartGateway && (
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

      {/* Terminal Log */}
      <TerminalLog
        logs={logs}
        height="h-[320px]"
        title={t('monitor.liveStream')}
        timeline={auditTimeline}
        dailyDigest={dailyDigest}
      />
    </div>
  );
}
