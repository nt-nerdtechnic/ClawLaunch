import { Trash2, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { DialogShell } from './DialogShell';

type DeleteConfirmDialogProps = {
  open: boolean;
  itemName: string;
  onClose: () => void;
  onConfirm: () => void;
  t: TFunction;
};

export function DeleteConfirmDialog({ open, itemName, onClose, onConfirm, t }: DeleteConfirmDialogProps) {
  if (!open) return null;

  return (
    <DialogShell zIndexClass="z-[100]" maxWidthClass="max-w-sm" onClose={onClose}>
      <div className="p-7 space-y-5">
        <div className="flex justify-between items-start">
          <div className="w-11 h-11 bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-500">
            <Trash2 size={20} />
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            {t('common.deleteConfirm.title', '確認刪除')}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
            {t('common.deleteConfirm.message', '即將刪除「{{name}}」，此操作無法復原。', { name: itemName })}
          </p>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-2xl font-bold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
          >
            {t('common.cancel', '取消')}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-3 rounded-2xl font-bold text-white bg-rose-500 hover:bg-rose-600 shadow-lg shadow-rose-500/20 transition-all active:scale-95"
          >
            {t('common.delete', '刪除')}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
