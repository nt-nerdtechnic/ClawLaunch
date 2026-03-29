import { AlertCircle, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { DialogShell } from './DialogShell';

type StopServiceDialogProps = {
  open: boolean;
  stopServiceActionMessage: string;
  stoppingServiceWithCleanup: boolean;
  onClose: () => void;
  onConfirm: () => void;
  t: TFunction;
};

export function StopServiceDialog({
  open,
  stopServiceActionMessage,
  stoppingServiceWithCleanup,
  onClose,
  onConfirm,
  t,
}: StopServiceDialogProps) {
  if (!open) return null;

  return (
    <DialogShell zIndexClass="z-[101]" maxWidthClass="max-w-xl" onClose={onClose}>
      <div className="p-8 space-y-6">
        <div className="flex justify-between items-start">
          <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500">
            <AlertCircle size={24} />
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">{t('app.stopService.title')}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('app.stopService.desc')}
          </p>
        </div>

        {!!stopServiceActionMessage && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 p-4 text-sm text-slate-600 dark:text-slate-300">
            {stopServiceActionMessage}
          </div>
        )}

        <div className="flex gap-4 pt-2">
          <button
            onClick={onClose}
            disabled={stoppingServiceWithCleanup}
            className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {t('common.labels.cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={stoppingServiceWithCleanup}
            className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {stoppingServiceWithCleanup ? t('app.stopService.stopping') : t('app.stopService.stopped')}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
