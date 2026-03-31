import { Layout, Activity, BarChart3, Radar, Brain, Boxes, Database, MonitorPlay } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';

type SidebarProps = {
  activeTab: string;
  onChangeTab: (tab: string) => void;
  onToggleViewMode: () => void;
  appVersion?: string;
  t: TFunction;
};

type NavItemProps = {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
};

function NavItem({ icon, label, active = false, onClick }: NavItemProps) {
  return (
    <div onClick={onClick} className={`flex items-center px-4 py-4 rounded-2xl cursor-pointer transition-all duration-300 ${active ? 'bg-blue-600/10 text-blue-400 shadow-inner' : 'text-slate-500 hover:bg-slate-800/50 hover:text-slate-300'}`}>
      <span className={`mr-4 ${active ? 'scale-110 opacity-100' : 'opacity-70'}`}>{icon}</span>
      <span className={`text-[13px] font-bold uppercase tracking-wider ${active ? 'opacity-100' : 'opacity-60'}`}>{label}</span>
    </div>
  );
}

export function Sidebar({ activeTab, onChangeTab, onToggleViewMode, appVersion, t }: SidebarProps) {
  return (
    <div className="w-64 bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col p-4 space-y-6">
      <div className="flex items-center space-y-1 py-4 px-2">
        <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center mr-3 shadow-xl shadow-blue-500/20">
          <Layout size={20} className="text-white" />
        </div>
        <div>
          <div className="font-bold text-lg leading-none tracking-tight">ClawLaunch</div>
          <div className="text-[10px] text-blue-500 font-mono uppercase tracking-widest">{t('app.version', { version: appVersion || '...' })}</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1">
        <NavItem icon={<Activity size={18} />} label={t('app.tabs.monitor')} active={activeTab === 'monitor'} onClick={() => onChangeTab('monitor')} />
        <NavItem icon={<BarChart3 size={18} />} label={t('app.tabs.analytics')} active={activeTab === 'analytics'} onClick={() => onChangeTab('analytics')} />
        <NavItem icon={<Radar size={18} />} label={t('app.tabs.controlCenter')} active={activeTab === 'controlCenter'} onClick={() => onChangeTab('controlCenter')} />
        <NavItem icon={<Brain size={18} />} label={t('app.tabs.memory')} active={activeTab === 'memory'} onClick={() => onChangeTab('memory')} />
        <NavItem icon={<Boxes size={18} />} label={t('app.tabs.skills')} active={activeTab === 'skills'} onClick={() => onChangeTab('skills')} />
        <NavItem icon={<Database size={18} />} label={t('app.tabs.runtimeSettings')} active={activeTab === 'runtimeSettings'} onClick={() => onChangeTab('runtimeSettings')} />
      </nav>

      <div onClick={onToggleViewMode} className="p-4 bg-blue-600/10 rounded-2xl border border-blue-500/20 cursor-pointer hover:bg-blue-600/20 transition-all flex items-center justify-between group">
        <div className="text-[10px] text-blue-400 uppercase font-black tracking-widest">{t('app.switchMiniMode')}</div>
        <MonitorPlay size={14} className="text-blue-400 group-hover:scale-110 transition-transform" />
      </div>

      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-600 px-2 flex justify-between items-center font-mono">
        <span>{t('app.version', { version: appVersion || '...' })}</span>
        <span className="flex items-center"><div className="w-2 h-2 rounded-full bg-emerald-500 mr-1 animate-pulse"></div> {t('app.online')}</span>
      </div>
    </div>
  );
}
