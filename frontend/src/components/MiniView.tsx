import { Play, Square, Settings2, ShieldCheck, Zap, Activity } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from 'react-i18next';

interface MiniViewProps {
  running: boolean;
  onToggle: () => void;
  onExpand: () => void;
}

export function MiniView({ running, onToggle, onExpand }: MiniViewProps) {
  const { t } = useTranslation();
  const { usage } = useStore();
  
  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#020617] p-6 space-y-8 animate-in fade-in zoom-in-95 duration-300 select-none transition-colors">
      {/* Header & Status Indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="relative">
            <div className={`w-3 h-3 rounded-full ${running ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)] animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
          </div>
          <span className="text-[11px] font-black tracking-[0.2em] text-slate-500 dark:text-slate-400 uppercase">{t('miniView.latticeStatus', 'Lattice Status')}</span>
        </div>
        <button onClick={onExpand} className="text-slate-400 dark:text-slate-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
            <Settings2 size={16} />
        </button>
      </div>

      {/* Big Token Water-tap (Progress Bar) */}
      <div className="space-y-3">
        <div className="flex justify-between items-end">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center">
                <Zap size={10} className="mr-1 fill-amber-500 text-amber-500" /> {t('miniView.tokenBudget')}
            </span>
            <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400">{usage.input > 0 ? (usage.input/1000).toFixed(1) : '0'}K / 5.0k</span>
        </div>
        <div className="h-2.5 bg-slate-100 dark:bg-slate-900 rounded-full border border-slate-200 dark:border-slate-800 p-0.5">
            <div 
                className="h-full bg-gradient-to-r from-blue-600 to-indigo-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,0.3)] transition-all duration-1000"
                style={{ width: `${Math.min(100, (usage.input / 5000) * 100)}%` }}
            ></div>
        </div>
      </div>

      {/* Mini Trend Sparkline */}
      <div className="bg-slate-50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800/50 p-3 rounded-2xl">
        <div className="text-[8px] font-black text-slate-400 dark:text-slate-600 uppercase tracking-widest mb-2">{t('miniView.trend7d')}</div>
        <div className="h-12 flex items-end space-x-1">
          {usage.history.map((h, i) => (
            <div 
              key={i} 
              style={{ height: `${(h.tokens / 40000) * 100}%` }} 
              className={`flex-1 rounded-sm ${i === usage.history.length - 1 ? 'bg-blue-500' : 'bg-slate-200 dark:bg-slate-800'}`}
            ></div>
          ))}
        </div>
      </div>

      {/* Main Action Toggle */}
      <div className="flex-1 flex flex-col justify-center items-center py-4">
        <button 
            onClick={onToggle}
            className={`w-28 h-28 rounded-full border-4 flex items-center justify-center transition-all duration-500 group shadow-2xl
            ${running ? 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20 shadow-emerald-500/10'}`}
        >
            {running ? <Square size={36} className="fill-current" /> : <Play size={36} className="fill-current translate-x-1" />}
        </button>
        <span className={`mt-4 text-[10px] font-black uppercase tracking-widest ${running ? 'text-emerald-500' : 'text-slate-600'}`}>
            {running ? 'Gateway Active' : 'System Standby'}
        </span>
      </div>

      {/* Quick Action Grid */}
      <div className="grid grid-cols-2 gap-3 pb-4">
          <QuickBtn icon={<ShieldCheck size={16}/>} label={t('miniView.security')} active={true} />
          <QuickBtn icon={<Activity size={16}/>} label={t('miniView.logs')} onClick={onExpand} />
      </div>
    </div>
  );
}

function QuickBtn({ icon, label, active = false, onClick }: { icon: any, label: string, active?: boolean, onClick?: () => void }) {
    return (
        <div onClick={onClick} className={`flex flex-col items-center justify-center p-3 rounded-2xl border transition-all cursor-pointer shadow-sm
        ${active ? 'bg-blue-600/10 border-blue-500/30 text-blue-600 dark:text-blue-400' : 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-600 dark:hover:text-slate-300'}`}>
            <div className="mb-1">{icon}</div>
            <span className="text-[9px] font-bold uppercase tracking-tight">{label}</span>
        </div>
    )
}
