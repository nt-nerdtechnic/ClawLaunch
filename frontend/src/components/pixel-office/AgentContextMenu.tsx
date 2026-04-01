import { useEffect, useRef } from 'react';
import { MessageSquare, StopCircle, Settings, CalendarClock, Key } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface AgentContextMenuProps {
  agentId: string;
  agentName: string;
  x: number;
  y: number;
  isActive: boolean;
  onChat: () => void;
  onStopAll: () => void;
  onSettings: (tab: 'info' | 'cron' | 'auth') => void;
  onClose: () => void;
}

const MENU_W = 168;
const MENU_H = 180;
const CANVAS_AREA_H = 400;

export default function AgentContextMenu({
  agentId: _agentId,
  agentName,
  x,
  y,
  isActive,
  onChat,
  onStopAll,
  onSettings,
  onClose,
}: AgentContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  const left = Math.min(x + 4, MENU_W > 0 ? 600 - MENU_W - 4 : x);
  const top  = Math.min(y, CANVAS_AREA_H - MENU_H - 4);

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
      style={{ left, top, width: MENU_W }}
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

      <button type="button" className={`${itemCls} text-slate-700 dark:text-slate-200`} onClick={() => onSettings('info')}>
        <Settings size={12} className="text-slate-400 shrink-0" />
        {t('pixelOffice.contextMenu.settings', 'Settings')}
      </button>

      <button type="button" className={`${itemCls} text-slate-700 dark:text-slate-200`} onClick={() => onSettings('cron')}>
        <CalendarClock size={12} className="text-amber-500 shrink-0" />
        {t('pixelOffice.contextMenu.cronJobs', 'Cron Jobs')}
      </button>

      <button type="button" className={`${itemCls} text-slate-700 dark:text-slate-200`} onClick={() => onSettings('auth')}>
        <Key size={12} className="text-green-500 shrink-0" />
        {t('pixelOffice.contextMenu.auth', 'Auth')}
      </button>
    </div>
  );
}
