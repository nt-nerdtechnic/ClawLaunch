import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Activity, TrendingUp, CalendarClock, Brain, Boxes, Settings2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PixelAgentSummary } from './hooks/usePixelOfficeAgents';
import AgentMonitorTab from './drawer-tabs/AgentMonitorTab';
import AgentAnalyticsTab from './drawer-tabs/AgentAnalyticsTab';
import AgentControlTab from './drawer-tabs/AgentControlTab';
import AgentMemoryTab from './drawer-tabs/AgentMemoryTab';
import AgentSkillsTab from './drawer-tabs/AgentSkillsTab';
import AgentSettingsTab from './drawer-tabs/AgentSettingsTab';

export type DrawerTab = 'monitor' | 'analytics' | 'control' | 'memory' | 'skills' | 'settings';

interface AgentSettingsDrawerProps {
  agentId: string;
  summary?: PixelAgentSummary;
  agentWorkspace?: string;
  agentDir?: string;
  initialTab?: DrawerTab;
  onClose: () => void;
  onToggleGateway?: () => Promise<void>;
  onRestartGateway?: () => Promise<void>;
}

const TABS: { key: DrawerTab; icon: React.ReactNode; labelKey: string; fallback: string }[] = [
  { key: 'monitor',   icon: <Activity size={10} />,      labelKey: 'app.tabs.monitor',        fallback: 'Monitor'   },
  { key: 'analytics', icon: <TrendingUp size={10} />,    labelKey: 'app.tabs.analytics',      fallback: 'Stats'     },
  { key: 'control',   icon: <CalendarClock size={10} />, labelKey: 'app.tabs.controlCenter',  fallback: 'Tasks'     },
  { key: 'memory',    icon: <Brain size={10} />,         labelKey: 'app.tabs.memory',         fallback: 'Memory'    },
  { key: 'skills',    icon: <Boxes size={10} />,         labelKey: 'app.tabs.skills',         fallback: 'Skills'    },
  { key: 'settings',  icon: <Settings2 size={10} />,     labelKey: 'app.tabs.runtimeSettings', fallback: 'Config'   },
];

export default function AgentSettingsDrawer({
  agentId,
  summary,
  agentWorkspace,
  agentDir,
  initialTab = 'monitor',
  onClose,
  onToggleGateway,
  onRestartGateway,
}: AgentSettingsDrawerProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  return (
    <div className="absolute inset-0 z-20">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 transition-opacity duration-200"
        style={{ opacity: visible ? 1 : 0 }}
        onClick={handleClose}
      />

      {/* Drawer panel */}
      <div
        className="absolute right-0 top-0 bottom-0 w-full flex flex-col bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 shadow-2xl transition-transform duration-200"
        style={{ transform: visible ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 dark:border-slate-800 px-3 py-2.5">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
          >
            <ArrowLeft size={13} />
          </button>
          {summary && (
            <span
              className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
              style={{ backgroundColor: summary.color }}
            />
          )}
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200 truncate flex-1">
            {summary?.displayName ?? agentId}
          </span>
          <span className={`ml-auto inline-flex items-center rounded-full px-1.5 py-0.5 text-[8px] font-bold ${
            summary?.snapshotState === 'active'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          }`}>
            {summary?.snapshotState === 'active'
              ? t('pixelOffice.agentWorking')
              : t('pixelOffice.agentIdle')}
          </span>
        </div>

        {/* Tab bar — 6 equal-width tabs */}
        <div className="flex shrink-0 border-b border-slate-200 dark:border-slate-800">
          {TABS.map(({ key, icon, labelKey, fallback }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex flex-1 items-center justify-center gap-1 py-2 text-[9px] font-bold uppercase tracking-wide border-b-2 transition-colors ${
                tab === key
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              {icon}
              <span>{t(labelKey, fallback)}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'monitor'   && <AgentMonitorTab agentId={agentId} onToggleGateway={onToggleGateway} onRestartGateway={onRestartGateway} />}
          {tab === 'analytics' && <AgentAnalyticsTab agentId={agentId} />}
          {tab === 'control'   && <AgentControlTab agentId={agentId} />}
          {tab === 'memory'    && <AgentMemoryTab agentWorkspace={agentWorkspace} />}
          {tab === 'skills'    && <AgentSkillsTab agentWorkspace={agentWorkspace} />}
          {tab === 'settings'  && (
            <AgentSettingsTab
              agentId={agentId}
              summary={summary}
              agentWorkspace={agentWorkspace}
              agentDir={agentDir}
            />
          )}
        </div>
      </div>
    </div>
  );
}
