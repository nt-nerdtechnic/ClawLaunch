import { useEffect, useRef } from 'react';
import { MessageSquare, StopCircle, TrendingUp, CalendarClock, Brain, Boxes, Settings2, Trash2, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DrawerTab } from './AgentSettingsDrawer';

interface AgentContextMenuProps {
  agentId: string;
  agentName: string;
  x: number;
  y: number;
  isActive: boolean;
  onChat: () => void;
  onStopAll: () => void;
  onSettings: (tab: DrawerTab) => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

const MENU_W = 168;
const MENU_H = 300;

export default function AgentContextMenu({
  agentId: _agentId,
  agentName,
  x,
  y,
  isActive,
  onChat,
  onStopAll,
  onSettings,
  onRename,
  onDelete,
  onClose,
}: AgentContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  // x/y are 0–1 fractions of the canvas container; use CSS min() to clamp
  // so the menu never overflows regardless of the actual container size.
  const leftStyle = `min(${(x * 100).toFixed(2)}%, calc(100% - ${MENU_W + 4}px))`;
  const topStyle  = `min(${(y * 100).toFixed(2)}%, calc(100% - ${MENU_H + 4}px))`;

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const itemCls = 'flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-left transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div
      ref={menuRef}
      className="absolute z-30 rounded-xl border border-slate-200 bg-white/98 shadow-2xl p-1 dark:border-slate-700 dark:bg-slate-900/98"
      style={{ left: leftStyle, top: topStyle, width: MENU_W }}
    >
      <div className="px-3 py-1 mb-0.5 text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500 truncate">
        {agentName}
      </div>

      <button type="button" className={`${itemCls} text-slate-700 dark:text-slate-200`} onClick={onChat}>
        <MessageSquare size={12} className="text-indigo-500 shrink-0" />
        {t('pixelOffice.contextMenu.chat', 'Chat')}
      </button>

      <button
        type="button"
        className={`${itemCls} text-slate-700 dark:text-slate-200`}
        onClick={onStopAll}
        disabled={!isActive}
      >
        <StopCircle size={12} className="text-red-500 shrink-0" />
        {t('pixelOffice.contextMenu.stopAll', 'Stop All Sessions')}
      </button>

      <div className="my-0.5 h-px bg-slate-100 dark:bg-slate-800 mx-1" />

      <button type="button" className={`${itemCls} text-slate-700 dark:text-slate-200`} onClick={onRename}>
        <Pencil size={12} className="text-sky-500 shrink-0" />
        {t('pixelOffice.contextMenu.rename', 'Rename')}
      </button>

      <button type="button" className={`${itemCls} text-slate-700 dark:text-slate-200`} onClick={() => onSettings('analytics')}>
        <TrendingUp size={12} className="text-blue-500 shrink-0" />
        {t('app.tabs.analytics', 'Stats')}
      </button>

      <button type="button" className={`${itemCls} text-slate-700 dark:text-slate-200`} onClick={() => onSettings('control')}>
        <CalendarClock size={12} className="text-amber-500 shrink-0" />
        {t('app.tabs.controlCenter', 'Tasks')}
      </button>

      <button type="button" className={`${itemCls} text-slate-700 dark:text-slate-200`} onClick={() => onSettings('memory')}>
        <Brain size={12} className="text-purple-500 shrink-0" />
        {t('app.tabs.memory', 'Memory')}
      </button>

      <button type="button" className={`${itemCls} text-slate-700 dark:text-slate-200`} onClick={() => onSettings('skills')}>
        <Boxes size={12} className="text-indigo-500 shrink-0" />
        {t('app.tabs.skills', 'Skills')}
      </button>

      <button type="button" className={`${itemCls} text-slate-700 dark:text-slate-200`} onClick={() => onSettings('settings')}>
        <Settings2 size={12} className="text-slate-400 shrink-0" />
        {t('app.tabs.runtimeSettings', 'Config')}
      </button>

      <div className="my-0.5 h-px bg-slate-100 dark:bg-slate-800 mx-1" />

      <button type="button" className={`${itemCls} text-rose-600 dark:text-rose-400`} onClick={onDelete}>
        <Trash2 size={12} className="text-rose-500 shrink-0" />
        {t('pixelOffice.contextMenu.delete', 'Delete Agent')}
      </button>
    </div>
  );
}
