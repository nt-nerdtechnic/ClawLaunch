import { AlertCircle, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { DialogShell } from './DialogShell';

type LogoutConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  t: TFunction;
};

export function LogoutConfirmDialog({ open, onClose, onConfirm, t }: LogoutConfirmDialogProps) {
  if (!open) return null;

  return (
    <DialogShell zIndexClass="z-[100]" maxWidthClass="max-w-md" onClose={onClose}>
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
          <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">
            {t('app.logoutTooltip')}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('app.logoutConfirm')}
          </p>
        </div>

        <div className="flex gap-4 pt-2">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
          >
            {t('wizard.backBtn').replace('← ', '')}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-6 py-3.5 rounded-2xl font-bold text-white bg-red-500 hover:bg-red-600 shadow-lg shadow-red-500/25 transition-all active:scale-95"
          >
            {t('monitor.disconnect')}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
