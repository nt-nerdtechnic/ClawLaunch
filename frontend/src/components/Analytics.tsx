import { useEffect, useMemo } from 'react';
import { useStore } from '../store';
import type { ReadModelSession } from '../store';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import { Target, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type DaySeries = {
  name: string;
  in: number;
  out: number;
  tokens: number;
  cost: number;
};

const formatDelta = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? '+100.0%' : '+0.0%';
  const percent = ((current - previous) / previous) * 100;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
};

const estimateCost = (inputTokens: number, outputTokens: number) => {
  return ((inputTokens + outputTokens * 2) / 1_000_000) * 0.5;
};

const normalizeFinite = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toMonthDay = (isoTime: string) => {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return '??-??';
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
};

const toDateKey = (isoTime: string) => {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

export function Analytics() {
  const { t } = useTranslation();
  const { setUsage, snapshot, snapshotHistory } = useStore();
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#6366f1'];

  const sessions: ReadModelSession[] = useMemo(() => {
    if (!Array.isArray(snapshot?.sessions)) return [];
    return snapshot.sessions.filter((item): item is ReadModelSession => !!item && typeof item === 'object');
  }, [snapshot?.sessions]);
  const budget = snapshot?.budgetSummary && typeof snapshot.budgetSummary === 'object' ? snapshot.budgetSummary : null;

  const fallbackChartData = useMemo<DaySeries[]>(() => {
    const dailyMap = new Map<string, { label: string; in: number; out: number; tokens: number }>();

    for (const session of sessions) {
      const updatedAt = typeof session.updatedAt === 'string' ? session.updatedAt : '';
      const key = toDateKey(updatedAt || snapshot?.generatedAt || '');
      if (!key) continue;
      const current = dailyMap.get(key) || { label: toMonthDay(updatedAt || snapshot?.generatedAt || ''), in: 0, out: 0, tokens: 0 };
      const inTokens = normalizeFinite((session as any).tokensIn, 0);
      const outTokens = normalizeFinite((session as any).tokensOut, 0);
      const sessionCostRaw = normalizeFinite((session as any).cost, NaN);
      const sessionCost = Number.isFinite(sessionCostRaw) && sessionCostRaw >= 0 ? sessionCostRaw : estimateCost(inTokens, outTokens);

      current.in += inTokens;
      current.out += outTokens;
      current.tokens += inTokens + outTokens;
      (current as any).cost = normalizeFinite((current as any).cost, 0) + sessionCost;
      dailyMap.set(key, current);
    }

    return Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
        .map(([, value]) => ({ name: value.label, in: value.in, out: value.out, tokens: value.tokens, cost: normalizeFinite((value as any).cost, estimateCost(value.in, value.out)) }));
  }, [sessions, snapshot?.generatedAt]);

  const chartData = useMemo<DaySeries[]>(() => {
    if (Array.isArray(snapshotHistory) && snapshotHistory.length > 0) {
      return snapshotHistory.map((point) => ({
        name: String(point.label || '').trim() || String(point.dateKey || '').slice(5),
        in: normalizeFinite(point.tokensIn, 0),
        out: normalizeFinite(point.tokensOut, 0),
        tokens: normalizeFinite(point.totalTokens, 0),
        cost: (() => {
          const exactCost = normalizeFinite(point.estimatedCost, NaN);
          if (Number.isFinite(exactCost) && exactCost >= 0) return exactCost;
          return estimateCost(normalizeFinite(point.tokensIn, 0), normalizeFinite(point.tokensOut, 0));
        })(),
      }));
    }

    return fallbackChartData;
  }, [fallbackChartData, snapshotHistory]);

  const totals = useMemo(() => {
    return sessions.reduce(
      (acc, session) => {
        const input = normalizeFinite((session as any).tokensIn, 0);
        const output = normalizeFinite((session as any).tokensOut, 0);
        const exactCost = normalizeFinite((session as any).cost, NaN);

        acc.input += input;
        acc.output += output;
        acc.cost += Number.isFinite(exactCost) && exactCost >= 0 ? exactCost : estimateCost(input, output);
        return acc;
      },
      { input: 0, output: 0, cost: 0 },
    );
  }, [sessions]);

  const stats = useMemo(() => {
    const today = chartData[chartData.length - 1];
    const yesterday = chartData[chartData.length - 2];

    const inDelta = today && yesterday ? formatDelta(today.in, yesterday.in) : '+0.0%';
    const outDelta = today && yesterday ? formatDelta(today.out, yesterday.out) : '+0.0%';
    const todayCost = today ? normalizeFinite(today.cost, estimateCost(today.in, today.out)) : 0;
    const yesterdayCost = yesterday ? normalizeFinite(yesterday.cost, estimateCost(yesterday.in, yesterday.out)) : 0;
    const costDelta = today && yesterday ? formatDelta(todayCost, yesterdayCost) : '+0.0%';

    return {
      input: { value: `${(totals.input / 1000).toFixed(1)}K`, delta: inDelta },
      output: { value: `${(totals.output / 1000).toFixed(1)}K`, delta: outDelta },
      cost: { value: totals.cost.toFixed(2), delta: costDelta },
    };
  }, [chartData, totals.cost, totals.input, totals.output]);

  const agentBreakdown = useMemo(() => {
    const grouped = new Map<string, number>();
    for (const session of sessions) {
      const agentId = String(session.agentId || 'Unknown').trim() || 'Unknown';
      const tokens = Number(session.tokensIn || 0) + Number(session.tokensOut || 0);
      grouped.set(agentId, (grouped.get(agentId) || 0) + tokens);
    }

    return Array.from(grouped.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [sessions]);

  const scopedRiskRows = useMemo(() => {
    const evaluations = Array.isArray((budget as any)?.evaluations) ? (budget as any).evaluations : [];
    return [...evaluations]
      .filter((item) => !!item && typeof item === 'object')
      .map((item) => {
        const limit = Number(item.limitCost30d || 0);
        const used = Number(item.usedCost30d || 0);
        const ratio = limit > 0 ? (used / limit) * 100 : 0;
        return {
          scope: item.scope || 'global',
          status: item.status || 'unknown',
          used,
          limit,
          ratio,
        };
      })
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 6);
  }, [budget]);

  const budgetMetrics = useMemo(() => {
    const used = Number(budget?.usedCost30d ?? 0);
    const limit = Number(budget?.limitCost30d ?? 0);
    const burnRatePerDay = Number(budget?.burnRatePerDay ?? 0);
    const projectedDays = Number(budget?.projectedDaysToLimit ?? 0);

    return {
      used: Number.isFinite(used) ? used : 0,
      limit: Number.isFinite(limit) ? limit : 0,
      burnRatePerDay: Number.isFinite(burnRatePerDay) ? burnRatePerDay : 0,
      projectedDays: Number.isFinite(projectedDays) ? projectedDays : 0,
    };
  }, [budget]);

  useEffect(() => {
    setUsage({
      input: totals.input,
      output: totals.output,
      history: chartData,
    });
  }, [chartData, setUsage, totals.input, totals.output]);

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
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Read Model
            </div>
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
                        backgroundColor: (isDark ? '#0f172a' : '#ffffff'), 
                        border: '1px solid currentColor',
                        borderColor: (isDark ? '#1e293b' : '#e2e8f0'),
                        borderRadius: '16px',
                        boxShadow: '0 20px 50px rgba(0,0,0,0.1)',
                        fontSize: '11px',
                        color: (isDark ? '#f1f5f9' : '#0f172a')
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
                      backgroundColor: (isDark ? '#0f172a' : '#ffffff'), 
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
                    <div className="text-2xl font-black text-slate-900 dark:text-slate-100">${budgetMetrics.used.toFixed(2)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Limit</div>
                    <div className="text-sm font-bold text-slate-600 dark:text-slate-400">{budgetMetrics.limit > 0 ? `$${budgetMetrics.limit.toFixed(2)}` : 'No Limit'}</div>
                  </div>
                </div>
                
                <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-1000 ${budget.status === 'over' ? 'bg-red-500' : budget.status === 'warn' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    style={{ width: `${Math.min(100, (budgetMetrics.used / (budgetMetrics.limit || 1)) * 100)}%` }}
                  ></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                    <div className="text-emerald-600 dark:text-emerald-400 mb-2"><TrendingUp size={18} /></div>
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Burn Rate</div>
                  <div className="text-sm font-black text-slate-900 dark:text-slate-100">${budgetMetrics.burnRatePerDay.toFixed(4)}/d</div>
                </div>
                <div className="p-4 bg-blue-500/5 dark:bg-blue-500/10 rounded-2xl border border-blue-500/20">
                    <div className="text-blue-600 dark:text-blue-500 mb-2"><Target size={18} /></div>
                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Proected Days</div>
                  <div className="text-sm font-black text-slate-900 dark:text-slate-100">{budgetMetrics.projectedDays > 0 ? budgetMetrics.projectedDays : '∞'} Days</div>
                </div>
              </div>

              {scopedRiskRows.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Risk Ownership</div>
                  <div className="space-y-2">
                    {scopedRiskRows.map((row) => (
                      <div key={`${row.scope}-${row.status}`} className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 bg-white/80 dark:bg-slate-900/60">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-mono text-xs text-slate-700 dark:text-slate-200">{row.scope}</div>
                          <div className={`text-[10px] font-black uppercase ${row.status === 'over' ? 'text-red-500' : row.status === 'warn' ? 'text-amber-500' : 'text-emerald-500'}`}>
                            {row.status}
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">${row.used.toFixed(2)} / ${row.limit.toFixed(2) || '0.00'} ({row.ratio.toFixed(1)}%)</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="text-xs text-slate-500 italic bg-slate-100 dark:bg-slate-800/30 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                {budget.status === 'over'
                  ? t('analytics.budgetAlertOver', '預算已超限，請優先檢視高消耗會話。')
                  : budget.status === 'warn'
                    ? t('analytics.budgetAlertWarn', '預算接近警戒值，建議調整模型或任務優先序。')
                    : t('analytics.budgetAlertOk', '預算處於健康範圍，可持續觀測。')}
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
