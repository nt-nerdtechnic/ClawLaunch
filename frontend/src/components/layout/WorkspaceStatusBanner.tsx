import type { TFunction } from 'i18next';

type WorkspaceStatusBannerProps = {
  activeTab: string;
  onboardingFinished: boolean;
  dismissed: boolean;
  corePath?: string;
  configPath?: string;
  workspacePath?: string;
  runtimeProfileError?: string;
  onOpenSettings: () => void;
  onRelogout: () => void;
  onDismiss: () => void;
  t: TFunction;
};

export function WorkspaceStatusBanner({
  activeTab,
  onboardingFinished,
  dismissed,
  corePath,
  configPath,
  workspacePath,
  runtimeProfileError,
  onOpenSettings,
  onRelogout,
  onDismiss,
  t,
}: WorkspaceStatusBannerProps) {
  if (activeTab !== 'monitor' && activeTab !== 'launcherSettings') return null;
  if (!onboardingFinished || dismissed) return null;

  const missing: string[] = [];
  if (!corePath?.trim()) missing.push('Core Path');
  if (!configPath?.trim()) missing.push('Config Path');
  if (!workspacePath?.trim()) missing.push('Workspace Path');

  const hasPathError = Boolean(runtimeProfileError && runtimeProfileError.length > 0);
  if (missing.length === 0 && !hasPathError) return null;

  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 dark:border-amber-700/60 dark:bg-amber-950/20">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-black text-amber-800 dark:text-amber-300 uppercase tracking-widest">
          {t('app.workspace.error')}
        </div>
        <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
          {missing.length > 0 && (
            <span>{t('app.workspace.missingPaths', { paths: missing.join(t('common.punctuation.comma', '、')) })}</span>
          )}
          {hasPathError && (
            <span className={missing.length > 0 ? ' ' : ''}>{runtimeProfileError}</span>
          )}
          {' '}{t('app.workspace.reRunWizard')}
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-xl border border-amber-400 bg-amber-100 px-3 py-1.5 text-[11px] font-black text-amber-800 hover:bg-amber-200 transition-colors dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
        >
          {t('app.workspace.fixInSettings')}
        </button>
        <button
          type="button"
          onClick={onRelogout}
          className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-1.5 text-[11px] font-black text-rose-700 hover:bg-rose-100 transition-colors dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50"
        >
          {t('app.workspace.reLogout')}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-xl border border-amber-300 bg-transparent px-3 py-1.5 text-[11px] font-medium text-amber-600 hover:bg-amber-100 transition-colors dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20"
        >
          {t('app.workspace.dismiss')}
        </button>
      </div>
    </div>
  );
}
