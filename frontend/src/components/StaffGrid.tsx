import { useStore } from '../store';
import { useTranslation } from 'react-i18next';
import { Bot, Shield, Zap, Target, Eye, Code } from 'lucide-react';

const ANIMAL_ROLES: Record<string, any> = {
  main: {
    icon: <Shield size={24} />,
    title: 'Lion Captain',
    color: 'from-orange-500 to-red-600',
    desc: '主控中樞 / Lead Supervisor'
  },
  panda: {
    icon: <Target size={24} />,
    title: 'Panda Strategist',
    color: 'from-blue-400 to-indigo-600',
    desc: '策略規劃 / Strategy'
  },
  monkey: {
    icon: <Code size={24} />,
    title: 'Monkey Builder',
    color: 'from-amber-400 to-orange-500',
    desc: '工程實作 / Builder'
  },
  owl: {
    icon: <Eye size={24} />,
    title: 'Owl Analyst',
    color: 'from-purple-500 to-indigo-700',
    desc: '數據審計 / Auditor'
  },
  fox: {
    icon: <Zap size={24} />,
    title: 'Fox Courier',
    color: 'from-orange-400 to-yellow-500',
    desc: '快速響應 / Ops'
  },
  fallback: {
    icon: <Bot size={24} />,
    title: 'Agent Operator',
    color: 'from-slate-400 to-slate-600',
    desc: '執行單元 / Operator'
  }
};

export function StaffGrid() {
  const { t } = useTranslation();
  const { snapshot } = useStore();

  if (!snapshot) return null;

  const sessions = snapshot?.sessions || [];

  // Extract unique agents from sessions and their latest state
  const agentStates = sessions.reduce((acc: any, session: any) => {
    const id = session.agentId;
    if (!acc[id] || session.state === 'running') {
      acc[id] = session.state;
    }
    return acc;
  }, {});

  const agents = Object.keys(agentStates).map(id => ({
    id,
    state: agentStates[id],
    ...(ANIMAL_ROLES[id] || ANIMAL_ROLES.fallback)
  }));

  if (agents.length === 0) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-2">
        <h3 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            {t('monitor.activeStaff', '活躍團隊成員')} ({agents.length})
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {agents.map((agent) => (
          <div key={agent.id} className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 p-6 rounded-[32px] relative transition-all hover:scale-[1.02] hover:shadow-xl dark:shadow-none group overflow-hidden">
            {/* Animated Glow for Running State */}
            {agent.state === 'running' && (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-blue-500 animate-pulse"></div>
            )}
            
            <div className="flex items-start justify-between mb-6">
              <div className={`w-14 h-14 bg-gradient-to-br ${agent.color} rounded-[20px] flex items-center justify-center text-white shadow-lg shadow-current/20 group-hover:scale-110 transition-transform duration-500`}>
                {agent.icon}
              </div>
              
              <div className="flex items-center">
                <div className={`w-2.5 h-2.5 rounded-full mr-2 ${agent.state === 'running' ? 'bg-blue-500 animate-ping' : 'bg-slate-300 dark:bg-slate-700'}`}></div>
                <span className={`text-[10px] font-black uppercase tracking-widest ${agent.state === 'running' ? 'text-blue-500' : 'text-slate-500'}`}>
                  {agent.state === 'running' ? 'Working' : 'Idle'}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <h4 className="font-black text-lg text-slate-900 dark:text-slate-100 tracking-tight">{String(agent.title || 'Agent')}</h4>
              <p className="text-[10px] text-slate-500 dark:text-slate-600 font-bold uppercase tracking-widest border-t border-slate-200 dark:border-slate-800 pt-2 mt-2">
                {String(agent.id || 'N/A')} · {String(agent.desc || 'Operator')}
              </p>
            </div>

            {/* Micro-activity signal */}
            <div className="mt-4 flex space-x-1">
                {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className={`h-1 flex-1 rounded-full ${agent.state === 'running' ? `bg-blue-500/${i*20} animate-pulse` : 'bg-slate-200 dark:bg-slate-800'}`}></div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
