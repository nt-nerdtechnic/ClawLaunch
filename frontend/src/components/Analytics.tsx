import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import { Loader2, Target, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function Analytics() {
  const { t } = useTranslation();
  const { setUsage, config, snapshot } = useStore();
  const [chartData, setChartData] = useState<any[]>([]);
  const [stats, setStats] = useState({ 
    input: { value: '0', delta: '+0%' }, 
    output: { value: '0', delta: '+0%' }, 
    cost: { value: '0', delta: '+0%' } 
  });
  const [loading, setLoading] = useState(true);

  const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#6366f1'];

  const agentBreakdown = snapshot?.statuses?.reduce((acc: any[], status: any) => {
    const sessions = snapshot?.sessions || [];
    const session = sessions.find((s: any) => s.sessionKey === status.sessionKey);
    const agentId = session?.agentId || 'Unknown';
    const existing = acc.find(item => item.name === agentId);
    const tokens = (status.tokensIn || 0) + (status.tokensOut || 0);
    if (existing) {
      existing.value += tokens;
    } else {
      acc.push({ name: agentId, value: tokens });
    }
    return acc;
  }, []) || [];

  const budget = snapshot?.budgetSummary || null;

  useEffect(() => {
    fetchRealData();
  }, []);

  const fetchRealData = async () => {
    try {
      if (!config.workspacePath) {
        setLoading(false);
        return;
      }
      const logPath = `${config.workspacePath}/gateway.log`; // Optimized for the detected clawdbot structure
      const result = await window.electronAPI.exec(`cat ${logPath}`);
      if (result.code === 0 && result.stdout) {
        const lines = result.stdout.trim().split('\n');
        const dailyMap = new Map();
        let totalIn = 0;
        let totalOut = 0;

        lines.forEach(line => {
          try {
            const entry = JSON.parse(line);
            const date = String(entry.session_timestamp || '').split('T')[0].slice(5) || '??-??'; // MM-DD
            const current = dailyMap.get(date) || { in: 0, out: 0, total: 0 };
            
            current.in += (entry.input_tokens || 0);
            current.out += (entry.output_tokens || 0);
            current.total += (entry.input_tokens || 0) + (entry.output_tokens || 0);

            dailyMap.set(date, current);
            totalIn += entry.input_tokens;
            totalOut += entry.output_tokens;
          } catch (e) {}
        });

        const formatted = Array.from(dailyMap.entries()).map(([name, data]) => ({ name, tokens: data.total, in: data.in, out: data.out })).slice(-7);
        
        // Calculate Deltas (Today vs Yesterday)
        let inDelta = '+0%';
        let outDelta = '+0%';
        let costDelta = '+0%';

        if (formatted.length >= 2) {
            const today = formatted[formatted.length - 1];
            const yesterday = formatted[formatted.length - 2];
            
            const calcP = (t: number, y: number) => {
                if (y === 0) return t > 0 ? '+100%' : '+0%';
                const p = ((t - y) / y) * 100;
                return (p > 0 ? '+' : '') + p.toFixed(1) + '%';
            }
            
            inDelta = calcP(today.in, yesterday.in);
            outDelta = calcP(today.out, yesterday.out);
            const todayCost = (today.in + today.out * 2) / 1000000 * 0.5;
            const yesterdayCost = (yesterday.in + yesterday.out * 2) / 1000000 * 0.5;
            costDelta = calcP(todayCost, yesterdayCost);
        }

        setChartData(formatted);
        setStats({
          input: { value: (totalIn / 1000).toFixed(1) + 'K', delta: inDelta },
          output: { value: (totalOut / 1000).toFixed(1) + 'K', delta: outDelta },
          cost: { value: ( (totalIn + totalOut * 2) / 1000000 * 0.5 ).toFixed(2), delta: costDelta }
        });

        // 同步至全域 Store
        setUsage({
          input: totalIn,
          output: totalOut,
          history: formatted
        });
      }
    } catch (e) {
      console.error("Failed to fetch analytics", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="h-96 flex items-center justify-center text-blue-600 dark:text-blue-500"><Loader2 className="animate-spin mr-2" /> {t('analytics.loading')}</div>;

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-right-4 duration-700 pb-20">
      <div className="grid grid-cols-3 gap-8 text-left">
        <StatCard label={t('analytics.totalInput')} value={stats.input.value} delta={stats.input.delta} />
        <StatCard label={t('analytics.totalOutput')} value={stats.output.value} delta={stats.output.delta} />
        <StatCard label={t('analytics.estimatedCost')} value={`$${stats.cost.value}`} delta={stats.cost.delta} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-left">
        {/* Main Consumption Trend */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
          
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">{t('analytics.trendTitle')}</h3>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">Daily Total Consumption (Stacked)</p>
            </div>
            <button onClick={fetchRealData} className="bg-white dark:bg-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-[10px] font-bold uppercase tracking-widest rounded-full px-4 py-2 text-slate-500 dark:text-slate-400 transition-all">
              Sync
            </button>
          </div>

          <div className="h-[300px] w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-800" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: 'currentColor', className: 'text-slate-400 dark:text-slate-600', fontSize: 10, fontWeight: 700}}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: 'currentColor', className: 'text-slate-400 dark:text-slate-600', fontSize: 10, fontWeight: 700}}
                  />
                  <Tooltip 
                    cursor={{stroke: 'currentColor', className: 'text-slate-200 dark:text-slate-800', strokeWidth: 2}}
                    contentStyle={{ 
                        backgroundColor: (document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff'), 
                        border: '1px solid currentColor',
                        borderColor: (document.documentElement.classList.contains('dark') ? '#1e293b' : '#e2e8f0'),
                        borderRadius: '16px',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.1)',
                        fontSize: '11px',
                        color: (document.documentElement.classList.contains('dark') ? '#f1f5f9' : '#0f172a')
                    }}
                  />
                  <Area type="monotone" dataKey="in" name="Input" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorIn)" stackId="1" />
                  <Area type="monotone" dataKey="out" name="Output" stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorOut)" stackId="1" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">{t('analytics.noData')}</div>
            )}
          </div>
        </div>

        {/* Efficiency Chart */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>
          
          <div className="mb-8">
            <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">{t('analytics.efficiencyTitle')}</h3>
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">Input vs Output Ratio</p>
          </div>

          <div className="h-[300px] w-full">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#475569', fontSize: 10, fontWeight: 700}}
                    dy={10}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{fill: '#475569', fontSize: 10, fontWeight: 700}}
                  />
                  <Tooltip 
                    contentStyle={{ 
                        backgroundColor: '#0f172a', 
                        border: '1px solid #1e293b', 
                        borderRadius: '16px',
                        fontSize: '11px'
                    }}
                  />
                  <Line type="stepAfter" dataKey="in" name="Input Load" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} />
                  <Line type="stepAfter" dataKey="out" name="Output Density" stroke="#fbbf24" strokeWidth={2} dot={{ r: 4, fill: '#fbbf24', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">{t('analytics.waitingData')}</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-left">
        {/* Agent Attribution */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-pink-500/50 to-transparent"></div>
          
          <div className="mb-8">
            <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">{t('analytics.agentAttribution', 'Agent 消耗歸因')}</h3>
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">Token Consumption by Agent</p>
          </div>

          <div className="h-[300px] w-full">
            {agentBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={agentBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {agentBreakdown.map((_entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} strokeWidth={0} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: (document.documentElement.classList.contains('dark') ? '#0f172a' : '#ffffff'), 
                      border: 'none',
                      borderRadius: '16px',
                      boxShadow: '0 10px 30px rgba(0,0,0,0.1)'
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">{t('analytics.noAgentData', '暫無 Agent 消耗數據')}</div>
            )}
          </div>
        </div>

        {/* Governance & Budget */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent"></div>
          
          <div className="mb-8">
            <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">{t('analytics.budgetGovernance', '預算與治理')}</h3>
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">30-Day Budget Policy Enforcement</p>
          </div>

          {budget ? (
            <div className="space-y-8">
              <div className="p-6 bg-white dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700">
                <div className="flex justify-between items-end mb-4">
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Monthly Spent</div>
                    <div className="text-2xl font-black text-slate-900 dark:text-slate-100">${budget.usedCost30d?.toFixed(2)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Limit</div>
                    <div className="text-sm font-bold text-slate-600 dark:text-slate-400">${budget.limitCost30d?.toFixed(2) || 'No Limit'}</div>
                  </div>
                </div>
                
                <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${budget.status === 'over' ? 'bg-red-500' : budget.status === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, (budget.usedCost30d / (budget.limitCost30d || 1)) * 100)}%` }}
                  ></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                    <div className="text-emerald-600 dark:text-emerald-400 mb-2"><TrendingUp size={18} /></div>
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Burn Rate</div>
                    <div className="text-sm font-black text-slate-900 dark:text-slate-100">${budget.burnRatePerDay?.toFixed(4)}/d</div>
                </div>
                <div className="p-4 bg-blue-500/5 dark:bg-blue-500/10 rounded-2xl border border-blue-500/20">
                    <div className="text-blue-600 dark:text-blue-500 mb-2"><Target size={18} /></div>
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Proected Days</div>
                    <div className="text-sm font-black text-slate-900 dark:text-slate-100">{budget.projectedDaysToLimit || '∞'} Days</div>
                </div>
              </div>

              <p className="text-xs text-slate-500 italic bg-slate-100 dark:bg-slate-800/30 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                "{String(budget.message || '')}"
              </p>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-slate-700 italic border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                {t('analytics.waitingBudget', '等待預算數據...')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, delta }: { label: string, value: string, delta: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800/50 p-6 rounded-3xl group hover:border-blue-500/30 transition-all duration-500 shadow-sm dark:shadow-none">
      <div className="text-[10px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-[0.2em] mb-3">{label}</div>
      <div className="flex items-baseline space-x-3">
        <div className="text-3xl font-black text-slate-900 dark:text-slate-100 tracking-tighter">{value}</div>
        <div className={`text-xs font-bold ${delta.startsWith('+') && delta !== '+0%' ? 'text-red-500' : delta.startsWith('-') ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'}`}>{delta}</div>
      </div>
    </div>
  );
}
