import type { ReactNode } from 'react';

type DialogShellProps = {
  zIndexClass: string;
  maxWidthClass: string;
  onClose: () => void;
  children: ReactNode;
};

export function DialogShell({ zIndexClass, maxWidthClass, onClose, children }: DialogShellProps) {
  return (
    <div className={`fixed inset-0 ${zIndexClass} flex items-center justify-center p-6 animate-in fade-in duration-300`}>
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full ${maxWidthClass} rounded-[32px] shadow-2xl overflow-hidden relative z-10 animate-in zoom-in-95 slide-in-from-bottom-8 duration-300`}>
        {children}
      </div>
    </div>
  );
}
