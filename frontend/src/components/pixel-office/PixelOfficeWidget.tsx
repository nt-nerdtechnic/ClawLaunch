import { useState, useEffect, useCallback } from 'react';
import { Building2, X, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PixelOfficeCanvas from './PixelOfficeCanvas';
import { usePixelOfficeAgents } from './hooks/usePixelOfficeAgents';

interface PixelOfficeWidgetProps {
  compact?: boolean;
}

export default function PixelOfficeWidget({ compact = false }: PixelOfficeWidgetProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const summaries = usePixelOfficeAgents();
  const activeCount = summaries.filter(s => s.snapshotState === 'active').length;

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  return (
    <div
      className={`fixed z-[88] flex flex-col items-end gap-2 ${
        compact
          ? 'bottom-[6.75rem] right-2 sm:bottom-[7.25rem] sm:right-3'
          : 'bottom-[4.5rem] right-3 sm:bottom-[5.5rem] sm:right-5'
      }`}
    >
      {/* ── Floating panel ── */}
      {isOpen && (
        <div
          className={`mb-2 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-sm transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-950/95 ${
            compact ? 'w-[calc(100vw-1rem)] h-[calc(100vh-9.75rem)]' : 'w-[600px] h-[440px]'
          }`}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-gradient-to-r from-indigo-50/80 via-white to-white px-3 py-2 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
            <div className="flex items-center gap-1.5">
              <div className="rounded-lg bg-indigo-500/10 p-1 text-indigo-600 dark:text-indigo-300">
                <Building2 size={13} />
              </div>
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
                {t('pixelOffice.title')}
              </span>
              {summaries.length > 0 && (
                <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
                  <Users size={8} />
                  {summaries.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={toggle}
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X size={14} />
            </button>
          </div>

          {/* Canvas area */}
          <div className="min-h-0 flex-1">
            <PixelOfficeCanvas paused={!isOpen} />
          </div>
        </div>
      )}

      {/* ── Floating button ── */}
      <button
        type="button"
        onClick={toggle}
        className={`group relative inline-flex items-center justify-center rounded-2xl border bg-white/95 shadow-2xl transition-all hover:-translate-y-0.5 hover:bg-white dark:bg-slate-900/95 ${
          isOpen
            ? 'border-indigo-400 text-indigo-600 shadow-indigo-500/20 dark:border-indigo-600 dark:text-indigo-300'
            : 'border-indigo-300/70 text-indigo-500 shadow-indigo-500/10 dark:border-indigo-700 dark:text-indigo-400'
        } ${compact ? 'h-12 w-12' : 'h-12 w-12 sm:h-14 sm:w-14'}`}
        title={isOpen ? t('pixelOffice.close') : t('pixelOffice.open')}
        aria-label={isOpen ? t('pixelOffice.close') : t('pixelOffice.open')}
      >
        <Building2 size={22} />
        {/* Active agent badge */}
        {activeCount > 0 && !isOpen && (
          <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-green-500 px-0.5 text-[8px] font-black text-white">
            {activeCount}
          </span>
        )}
      </button>
    </div>
  );
}
