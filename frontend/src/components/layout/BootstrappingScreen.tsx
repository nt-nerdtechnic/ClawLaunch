interface BootstrappingScreenProps {
  error?: string;
  onRetry?: () => void;
}

export function BootstrappingScreen({ error, onRetry }: BootstrappingScreenProps) {
  return (
    <div className="flex h-screen items-center justify-center bg-white dark:bg-slate-950">
      <div className="flex flex-col items-center gap-4">
        <div className={`w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/20 ${error ? '' : 'animate-pulse'}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        </div>
        {error ? (
          <div className="flex flex-col items-center gap-2">
            <div className="text-[11px] text-red-400 font-mono">{error}</div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="text-[11px] text-blue-400 hover:text-blue-300 font-mono uppercase tracking-widest"
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-slate-400 font-mono uppercase tracking-widest">Loading...</div>
        )}
      </div>
    </div>
  );
}
