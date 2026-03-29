import { useState } from 'react';
import { Play, Square, Maximize2, Radar, Activity, Zap, TrendingUp, LayoutDashboard, ClipboardList, CheckCircle2, Circle, Clock, AlertCircle } from 'lucide-react';
import { useStore } from '../store';
import { useTranslation } from 'react-i18next';

type MiniTab = 'home' | 'taskBoard' | 'monitor';

interface MiniViewProps {
  running: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onExpandTo: (tab: string) => void;
}

// ─── Task status helpers ───────────────────────────────────────────────────────
function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />;
  if (status === 'in_progress') return <Clock size={12} className="text-blue-500 shrink-0 animate-pulse" />;
  if (status === 'blocked') return <AlertCircle size={12} className="text-red-400 shrink-0" />;
  return <Circle size={12} className="text-slate-300 dark:text-slate-600 shrink-0" />;
}

// ─── Tab content: Home ────────────────────────────────────────────────────────
function TabHome({ running, onToggle }: { running: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const { usage } = useStore();

  const totalTokens = usage.input + usage.output;
  const tokenDisplay = totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : String(totalTokens);
  const budgetPct = Math.min(100, (totalTokens / Math.max(totalTokens, 50000)) * 100);
  const maxHistoryTokens = Math.max(...usage.history.map(x => x.tokens), 1);

  return (
    <div className="flex flex-col gap-4 flex-1 overflow-hidden">
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
        <div className="h-9 flex items-end gap-px overflow-hidden">
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
      <div className="flex flex-col justify-center items-center gap-2 flex-1">
        <div className="relative">
          {running && (
            <div className="absolute inset-0 rounded-full border-2 border-emerald-400/30 animate-ping scale-110 pointer-events-none" />
          )}
          <button
            onClick={onToggle}
            className={`relative w-20 h-20 rounded-full border-4 flex items-center justify-center transition-all duration-500 active:scale-95 shadow-2xl
              ${running
                ? 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20 hover:border-red-500/50'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20 hover:border-emerald-500/50 shadow-emerald-500/10'}`}
          >
            {running ? <Square size={28} className="fill-current" /> : <Play size={28} className="fill-current translate-x-0.5" />}
          </button>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-widest ${running ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`}>
          {running ? t('app.gatewayActive', 'Gateway Active') : t('app.standby', 'System Standby')}
        </span>
      </div>
    </div>
  );
}

// ─── Tab content: Task Board ──────────────────────────────────────────────────
function TabTaskBoard() {
  const snapshot = useStore((s) => s.snapshot);
  const tasks = snapshot?.tasks ?? [];
  const active = tasks.filter(tk => tk.status !== 'done').slice(0, 8);
  const done = tasks.filter(tk => tk.status === 'done').length;

  return (
    <div className="flex flex-col flex-1 overflow-hidden gap-2">
      <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-slate-400 shrink-0">
        <span className="inline-flex items-center gap-1">
          <Clock size={9} className="text-blue-400" /> {active.length} active
        </span>
        <span className="text-slate-200 dark:text-slate-700">·</span>
        <span className="inline-flex items-center gap-1">
          <CheckCircle2 size={9} className="text-emerald-400" /> {done} done
        </span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {active.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-300 dark:text-slate-700">
            <ClipboardList size={26} />
            <span className="text-[10px] font-bold uppercase tracking-widest">No active tasks</span>
          </div>
        ) : active.map(tk => (
          <div key={tk.id} className="flex items-start gap-2 px-2.5 py-2 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40">
            <TaskStatusIcon status={tk.status} />
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate leading-tight">{tk.title}</p>
              <p className="text-[9px] text-slate-400 uppercase tracking-wide mt-0.5">{tk.status.replace('_', ' ')}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab content: Monitor ─────────────────────────────────────────────────────
function TabMonitor() {
  const logs = useStore((s) => s.logs);
  const recent = logs.slice(-20).reverse();

  return (
    <div className="flex-1 overflow-y-auto space-y-0.5 font-mono">
      {recent.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-slate-300 dark:text-slate-700">
          <Activity size={26} />
          <span className="text-[10px] font-bold uppercase tracking-widest">No logs yet</span>
        </div>
      ) : recent.map((log, i) => (
        <div key={i} className={`text-[10px] leading-snug truncate px-2 py-1 rounded-lg ${
          log.source === 'stderr'
            ? 'text-red-400 bg-red-500/5'
            : log.source === 'system'
              ? 'text-blue-400 bg-blue-500/5'
              : 'text-slate-500 dark:text-slate-400'
        }`}>
          {log.text}
        </div>
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function MiniView({ running, onToggle, onExpand, onExpandTo }: MiniViewProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<MiniTab>('home');

  const expandTargets: Record<MiniTab, string> = {
    home: '',
    taskBoard: 'controlCenter',
    monitor: 'monitor',
  };

  const tabs: { id: MiniTab; icon: React.ReactNode; label: string }[] = [
    { id: 'home',      icon: <LayoutDashboard size={14} />, label: t('miniView.home', 'Home') },
    { id: 'taskBoard', icon: <Radar size={14} />,           label: t('miniView.taskBoard', 'Tasks') },
    { id: 'monitor',   icon: <Activity size={14} />,        label: t('miniView.monitor', 'Monitor') },
  ];

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[#020617] select-none transition-colors">

      {/* ── Fixed header ── */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${running ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-slate-300 dark:bg-slate-700'}`} />
          <span className="text-[10px] font-black tracking-[0.18em] text-slate-500 dark:text-slate-400 uppercase">
            {t('miniView.latticeStatus', 'Lattice Status')}
          </span>
        </div>
        <button
          onClick={tab === 'home' ? onExpand : () => onExpandTo(expandTargets[tab])}
          title={t('miniView.expand', 'Expand')}
          className="text-slate-400 dark:text-slate-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <Maximize2 size={14} />
        </button>
      </div>

      {/* ── Scrollable content area ── */}
      <div className="flex-1 overflow-hidden flex flex-col px-5 min-h-0">
        {tab === 'home'      && <TabHome running={running} onToggle={onToggle} />}
        {tab === 'taskBoard' && <TabTaskBoard />}
        {tab === 'monitor'   && <TabMonitor />}
      </div>

      {/* ── Bottom tab bar ── */}
      <div className="shrink-0 grid grid-cols-3 border-t border-slate-100 dark:border-slate-800/60">
        {tabs.map(({ id, icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${
              tab === id
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400'
            }`}
          >
            {icon}
            <span className="text-[8px] font-bold uppercase tracking-wider">{label}</span>
            {tab === id && <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-6 h-0.5 bg-blue-500 rounded-t-full" />}
          </button>
        ))}
      </div>

    </div>
  );
}
