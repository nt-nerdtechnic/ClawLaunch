import { useState, useCallback } from 'react';
import { Building2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PixelOfficePanel from './PixelOfficePanel';
import { usePixelOfficeAgents } from './hooks/usePixelOfficeAgents';

interface PixelOfficeWidgetProps {
  compact?: boolean;
  restartGateway?: () => Promise<void>;
}

export default function PixelOfficeWidget({ compact = false, restartGateway }: PixelOfficeWidgetProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const { summaries } = usePixelOfficeAgents();
  const activeCount = summaries.filter(s => s.snapshotState === 'active').length;

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
          className={`relative mb-2 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-sm transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-950/95 ${
            compact ? 'w-[calc(100vw-1rem)] h-[calc(100vh-9.75rem)]' : 'w-[600px] h-[440px]'
          }`}
        >
          <PixelOfficePanel
            restartGateway={restartGateway}
            onClose={toggle}
          />
        </div>
      )}

      {/* ── Floating button (hidden: managed via AgentOfficePage) ── */}
      {false && (
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
          {activeCount > 0 && !isOpen && (
            <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-green-500 px-0.5 text-[8px] font-black text-white">
              {activeCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
