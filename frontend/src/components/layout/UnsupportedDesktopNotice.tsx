export function UnsupportedDesktopNotice() {
  return (
    <div className="flex h-screen items-center justify-center bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center px-6">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/20">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        </div>
        <div className="text-lg font-bold">NT-ClawLaunch</div>
        <div className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
          此應用程式僅支援 Mac 桌面版本。<br />
          請執行 <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-xs">npm run dev</code> 啟動完整應用。
        </div>
      </div>
    </div>
  );
}
