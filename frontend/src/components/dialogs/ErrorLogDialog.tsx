import React from 'react';
import { DialogShell } from './DialogShell';
import { X, FileText, Clipboard, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface ErrorLogDialogProps {
  jobName: string;
  errorLog: string;
  onClose: () => void;
}

export const ErrorLogDialog: React.FC<ErrorLogDialogProps> = ({ jobName, errorLog, onClose }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);

  const copyToClipboard = () => {
    void navigator.clipboard.writeText(errorLog);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <DialogShell zIndexClass="z-[9999]" maxWidthClass="max-w-2xl" onClose={onClose}>
      <div className="flex flex-col h-[70vh]">
        {/* Header */}
        <div className="px-8 pt-8 pb-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-rose-500 shadow-inner">
              <FileText size={20} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800 dark:text-slate-100 tracking-tight">{t('common.errorLog', '任務錯誤日誌')}</h3>
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">{jobName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-300 hover:text-slate-600 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all active:scale-90"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-hidden flex flex-col gap-4">
          <div className="flex-1 rounded-3xl bg-slate-50 dark:bg-slate-950/50 border border-slate-100 dark:border-slate-800/50 p-6 overflow-auto scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
            <pre className="text-[12px] font-mono leading-relaxed text-rose-600 dark:text-rose-400 whitespace-pre-wrap break-all">
              {errorLog || '無詳細錯誤日誌內容...'}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 pt-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-400 italic">
            診斷提示：此日誌由系統自動擷取。
          </p>
          <div className="flex items-center gap-2">
             <button
              onClick={copyToClipboard}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-[12px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all active:scale-95"
            >
              {copied ? <Check size={14} className="text-emerald-500" /> : <Clipboard size={14} />}
              {copied ? '已複製' : '複製日誌'}
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-2xl text-[12px] font-black bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 shadow-lg shadow-slate-200/50 dark:shadow-none hover:bg-slate-900 dark:hover:bg-white transition-all active:scale-95"
            >
              關閉
            </button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
};
