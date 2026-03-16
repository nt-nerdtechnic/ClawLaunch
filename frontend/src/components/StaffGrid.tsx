import { useStore } from '../store';
import { useTranslation } from 'react-i18next';
import { Bot, Shield, Zap, Target, Eye, Code } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ReadModelSession, ReadModelStatus, ReadModelTask } from '../store';

type RoleDef = {
  icon: ReactNode;
  title: string;
  color: string;
  desc: string;
};

type AgentAccumulator = {
  id: string;
  sessionStates: Set<string>;
  blocked: boolean;
  queue: number;
};

const ANIMAL_ROLES: Record<string, RoleDef> = {
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

  const sessions: ReadModelSession[] = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  const statuses: ReadModelStatus[] = Array.isArray(snapshot.statuses) ? snapshot.statuses : [];
  const tasks: ReadModelTask[] = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];

  const taskIsQueued = (rawStatus: unknown) => {
    const status = String(rawStatus || '').toLowerCase();
    return ['queued', 'queue', 'pending', 'waiting', 'todo'].some((token) => status.includes(token));
  };

  const taskIsBlocked = (rawStatus: unknown) => {
    const status = String(rawStatus || '').toLowerCase();
    return status.includes('blocked') || status.includes('stuck') || status.includes('error');
  };

  const base = sessions.reduce<Record<string, AgentAccumulator>>((acc, session) => {
    const id = String(session?.agentId || '').trim();
    if (!id) return acc;
    if (!acc[id]) {
      acc[id] = {
        id,
        sessionStates: new Set<string>(),
        blocked: false,
        queue: 0,
      };
    }
    acc[id].sessionStates.add(String(session?.status || '').toLowerCase());
    return acc;
  }, {});

  const agentIds = new Set<string>(Object.keys(base));

  for (const status of statuses) {
    const key = String(status?.sessionKey || '');
    const parts = key.split('/').filter(Boolean);
    const guessedId = parts.length > 0 ? parts[0] : '';
    if (!guessedId) continue;
    if (!base[guessedId]) {
      base[guessedId] = {
        id: guessedId,
        sessionStates: new Set<string>(),
        blocked: false,
        queue: 0,
      };
    }
    agentIds.add(guessedId);
    const state = String(status?.state || '').toLowerCase();
    if (state) base[guessedId].sessionStates.add(state);
    if (taskIsBlocked(state)) base[guessedId].blocked = true;
  }

  for (const task of tasks) {
    const scope = String(task?.scope || '').toLowerCase();
    const taskStatus = String(task?.status || '').toLowerCase();
    for (const id of agentIds) {
      if (!scope.includes(id.toLowerCase())) continue;
      if (taskIsQueued(taskStatus)) base[id].queue += 1;
      if (taskIsBlocked(taskStatus)) base[id].blocked = true;
    }
  }

  const agents = Array.from(agentIds).map((id) => {
    const data = base[id] || { sessionStates: new Set<string>(), blocked: false, queue: 0 };
    const sessionStates = Array.from(data.sessionStates) as string[];
    const running = sessionStates.some((state) => state.includes('running') || state.includes('active') || state.includes('working'));
    const blocked = Boolean(data.blocked);
    const tier: 'busy' | 'standby' | 'blocked' = blocked ? 'blocked' : running ? 'busy' : 'standby';
    return {
      id,
      state: tier,
      queue: data.queue,
      ...(ANIMAL_ROLES[id] || ANIMAL_ROLES.fallback),
    };
  });

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
            {/* Animated Glow for Busy/Blocked State */}
            {(agent.state === 'busy' || agent.state === 'blocked') && (
              <div className={`absolute inset-x-0 bottom-0 h-1 animate-pulse ${agent.state === 'blocked' ? 'bg-red-500' : 'bg-blue-500'}`}></div>
            )}
            
            <div className="flex items-start justify-between mb-6">
              <div className={`w-14 h-14 bg-gradient-to-br ${agent.color} rounded-[20px] flex items-center justify-center text-white shadow-lg shadow-current/20 group-hover:scale-110 transition-transform duration-500`}>
                {agent.icon}
              </div>
              
              <div className="flex items-center">
                <div className={`w-2.5 h-2.5 rounded-full mr-2 ${
                  agent.state === 'blocked'
                    ? 'bg-red-500 animate-pulse'
                    : agent.state === 'busy'
                      ? 'bg-blue-500 animate-ping'
                      : 'bg-slate-300 dark:bg-slate-700'
                }`}></div>
                <span className={`text-[10px] font-black uppercase tracking-widest ${
                  agent.state === 'blocked'
                    ? 'text-red-500'
                    : agent.state === 'busy'
                      ? 'text-blue-500'
                      : 'text-slate-500'
                }`}>
                  {agent.state === 'blocked' ? t('monitor.staff.state.blocked') : agent.state === 'busy' ? t('monitor.staff.state.busy') : t('monitor.staff.state.standby')}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <h4 className="font-black text-lg text-slate-900 dark:text-slate-100 tracking-tight">{String(agent.title || 'Agent')}</h4>
              <p className="text-[10px] text-slate-500 dark:text-slate-600 font-bold uppercase tracking-widest border-t border-slate-200 dark:border-slate-800 pt-2 mt-2">
                {String(agent.id || 'N/A')} · {String(agent.desc || 'Operator')}
              </p>
            </div>

            {agent.queue > 0 && (
              <div className="mt-3 inline-flex items-center rounded-full border border-amber-300/70 bg-amber-50 dark:bg-amber-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">
                {t('monitor.staff.queue', { count: agent.queue })}
              </div>
            )}

            {/* Micro-activity signal */}
            <div className="mt-4 flex space-x-1">
                {[1, 2, 3, 4, 5].map(i => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full ${
                        agent.state === 'blocked'
                          ? `bg-red-500/${i * 20} animate-pulse`
                          : agent.state === 'busy'
                            ? `bg-blue-500/${i * 20} animate-pulse`
                            : 'bg-slate-200 dark:bg-slate-800'
                      }`}
                    ></div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
