import { Play, Square, Maximize2, Radar, Activity, Zap, TrendingUp } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

interface MiniViewProps {
  running: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onExpandTo: (tab: string) => void;
}

export function MiniView({ running, onToggle, onExpand, onExpandTo }: MiniViewProps) {
  const { t } = useTranslation();
  const { usage } = useStore();

  const totalTokens = usage.input + usage.output;
  const tokenDisplay = totalTokens >= 1000
    ? `${(totalTokens / 1000).toFixed(1)}K`
    : String(totalTokens);
  // Fill bar relative to consumed tokens — caps at 100% once it exceeds the rolling high-water mark
  const budgetCap = Math.max(totalTokens, 50000);
  const budgetPct = Math.min(100, (totalTokens / budgetCap) * 100);

  const maxHistoryTokens = Math.max(...usage.history.map(x => x.tokens), 1);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#020617] p-5 space-y-4 animate-in fade-in zoom-in-95 duration-300 select-none transition-colors">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className={`w-2.5 h-2.5 rounded-full ${running ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)] animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`} />
          <span className="text-[11px] font-black tracking-[0.2em] text-slate-500 dark:text-slate-400 uppercase">
            {t('miniView.latticeStatus', 'Lattice Status')}
          </span>
        </div>
        <button
          onClick={onExpand}
          title={t('miniView.expand', 'Expand')}
          className="text-slate-400 dark:text-slate-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <Maximize2 size={15} />
        </button>
      </div>

      {/* Token Usage */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1">
            <Zap size={10} className="fill-amber-500 text-amber-500" />
            {t('miniView.tokenBudget', 'Tokens Used')}
          </span>
          <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400">{tokenDisplay}</span>
        </div>
        <div className="h-2 bg-slate-100 dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-800 p-px">
          <div
            className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.3)] transition-all duration-1000"
            style={{ width: `${budgetPct}%` }}
          />
        </div>
      </div>

      {/* Trend Sparkline */}
      <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/50 px-3 pt-2.5 pb-3 rounded-2xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[8px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest">
            {t('miniView.trend7d', '7D Trend')}
          </span>
          {usage.history.length > 0 && <TrendingUp size={9} className="text-slate-300 dark:text-slate-700" />}
        </div>
        <div className="h-10 flex items-end gap-px overflow-hidden">
          {usage.history.length === 0
            ? ([45, 30, 60, 40, 70, 50, 35] as const).map((h, i) => (
                <div key={i} style={{ height: `${h}%` }} className="flex-1 rounded-sm bg-slate-100 dark:bg-slate-800/60" />
              ))
            : usage.history.map((h, i) => (
                <div
                  key={i}
                  style={{ height: `${Math.max(8, Math.min(100, (h.tokens / maxHistoryTokens) * 100))}%` }}
                  className={`flex-1 rounded-sm transition-all duration-500 ${i === usage.history.length - 1 ? 'bg-blue-500' : 'bg-slate-200 dark:bg-slate-800'}`}
                />
              ))}
        </div>
      </div>

      {/* Main Toggle Button */}
      <div className="flex-1 flex flex-col justify-center items-center gap-3">
        <div className="relative">
          {running && (
            <div className="absolute inset-0 rounded-full border-2 border-emerald-400/30 animate-ping scale-110 pointer-events-none" />
          )}
          <button
            onClick={onToggle}
            className={`relative w-24 h-24 rounded-full border-4 flex items-center justify-center transition-all duration-500 active:scale-95 shadow-2xl
              ${running
                ? 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20 hover:border-red-500/50'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20 hover:border-emerald-500/50 shadow-emerald-500/10'}`}
          >
            {running
              ? <Square size={32} className="fill-current" />
              : <Play size={32} className="fill-current translate-x-0.5" />}
          </button>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-widest ${running ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`}>
          {running ? t('app.gatewayActive', 'Gateway Active') : t('app.standby', 'System Standby')}
        </span>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-2.5">
        <QuickBtn icon={<Radar size={15} />} label={t('miniView.taskBoard', 'Task Board')} onClick={() => onExpandTo('controlCenter')} />
        <QuickBtn icon={<Activity size={15} />} label={t('miniView.monitor', 'Monitor')} onClick={() => onExpandTo('monitor')} />
      </div>

    </div>
  );
}

function QuickBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex flex-col items-center justify-center p-2.5 rounded-2xl border transition-all cursor-pointer shadow-sm bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-600 dark:hover:text-slate-300"
    >
      <div className="mb-1">{icon}</div>
      <span className="text-[9px] font-bold uppercase tracking-tight">{label}</span>
    </div>
  );
}
