import { Settings, LogOut } from 'lucide-react';
import type { TFunction } from 'i18next';
import { ThemeToggle } from '../ThemeToggle';
import { LanguageToggle } from '../LanguageToggle';

type HeaderProps = {
  activeTab: string;
  onChangeTab: (tab: string) => void;
  onShowLogoutConfirm: () => void;
  t: TFunction;
};

const getHeaderTitle = (activeTab: string, t: TFunction) => {
  if (activeTab === 'monitor') return t('app.headers.monitor');
  if (activeTab === 'controlCenter') return t('app.headers.controlCenter');
  if (activeTab === 'analytics') return t('app.headers.analytics');
  if (activeTab === 'skills') return t('app.headers.skills');
  if (activeTab === 'launcherSettings') return t('app.headers.launcherSettings');
  if (activeTab === 'memory') return t('app.headers.memory');
  if (activeTab === 'agentOffice') return t('app.headers.agentOffice');
  return t('app.headers.runtimeSettings');
};

export function Header({ activeTab, onChangeTab, onShowLogoutConfirm, t }: HeaderProps) {
  return (
    <header className="h-20 border-b border-slate-200 dark:border-slate-800/50 flex items-center px-10 justify-between relative backdrop-blur-md bg-white/20 dark:bg-slate-950/20">
      <div>
        <h2 className="font-bold text-xl text-slate-900 dark:text-slate-100 uppercase tracking-tight">
          {getHeaderTitle(activeTab, t)}
        </h2>
      </div>
      <div className="flex items-center space-x-4">
        <LanguageToggle />
        <ThemeToggle />

        <button
          type="button"
          onClick={() => onChangeTab('launcherSettings')}
          className={`relative w-10 h-10 rounded-full border flex items-center justify-center cursor-pointer transition-colors overflow-hidden ${activeTab === 'launcherSettings' ? 'bg-blue-100 border-blue-300 text-blue-600 hover:bg-blue-200 dark:bg-blue-500/20 dark:border-blue-500/40 dark:text-blue-300 dark:hover:bg-blue-500/30' : 'bg-slate-200 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'}`}
          title={t('app.tabs.launcherSettings')}
          aria-label={t('app.tabs.launcherSettings')}
        >
          <Settings size={18} />
        </button>

        <div
          onClick={onShowLogoutConfirm}
          title={t('app.logoutTooltip')}
          className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition-all group relative active:scale-95"
        >
          <LogOut size={18} className="text-slate-500 dark:text-slate-400 group-hover:text-red-500 dark:group-hover:text-red-400 transition-colors" />
        </div>
      </div>
    </header>
  );
}
