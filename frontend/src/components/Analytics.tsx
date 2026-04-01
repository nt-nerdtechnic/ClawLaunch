import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';

import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, LineChart, Line, PieChart, Pie, Cell, Legend } from 'recharts';
import { TrendingUp, TrendingDown, Minus, RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type DaySeries = {
  name: string;
  in: number;
  out: number;
  tokens: number;
  cost: number;
};

type PeriodAgg = { tokens: number; cost: number; requestCount: number };

const formatDelta = (current: number, previous: number) => {
  if (previous === 0) return current > 0 ? '+100.0%' : '+0.0%';
  const percent = ((current - previous) / previous) * 100;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
};

// Keep as fallback (when runtimeUsageEvents is empty)


const formatCompactNumber = (number: number) => {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(number);
};

const normalizeFinite = (value: unknown, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export function Analytics() {
  const { t } = useTranslation();
  const { setUsage, runtimeUsageEvents, modelPrices, setModelPrices } = useStore();
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  const [usageWindow, setUsageWindow] = useState<'today' | '7d' | '30d'>('7d');
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);

  const handleRefreshPrices = async () => {
    setIsRefreshingPrices(true);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      const data = await res.json();
      if (data && data.data) {
        const newPrices: Record<string, { prompt: number, completion: number }> = {};
        for (const item of data.data) {
          if (item.pricing) {
            newPrices[item.id] = {
              prompt: Number(item.pricing.prompt) || 0,
              completion: Number(item.pricing.completion) || 0,
            };
          }
        }
        setModelPrices(newPrices);
      }
    } catch (e) {
      console.error('Failed to fetch OpenRouter model prices', e);
    } finally {
      setIsRefreshingPrices(false);
    }
  };

  const getModelPrice = (modelName: string) => {
    const name = modelName.trim().toLowerCase();
    if (name === 'unknown' || !name) return null;
    if (!modelPrices || Object.keys(modelPrices).length === 0) return null;
    
    if (modelPrices[name]) return modelPrices[name];
    
    const norm = name.replace(/[-_.\s]/g, '');
    let bestMatch = null;

    for (const [id, price] of Object.entries(modelPrices)) {
      const slug = id.split('/')[1] || id;
      const normSlug = slug.toLowerCase().replace(/[-_.\s]/g, '');
      
      if (norm === normSlug) return price;
      
      if (norm.includes(normSlug) || normSlug.includes(norm)) {
         if (!bestMatch || normSlug.length > bestMatch.slug.length) {
            bestMatch = { price, slug: normSlug };
         }
      }
    }
    return bestMatch?.price || null;
  };

  const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#6366f1'];

  // ── Build per-day DaySeries from runtimeUsageEvents ──
  const chartData = useMemo<DaySeries[]>(() => {
    if (runtimeUsageEvents.length === 0) return [];
    const map = new Map<string, DaySeries>();
    for (const ev of runtimeUsageEvents) {
      const existing = map.get(ev.day) ?? { name: ev.day.slice(5), in: 0, out: 0, tokens: 0, cost: 0 };
      existing.in += ev.tokensIn;
      existing.out += ev.tokensOut;
      existing.tokens += ev.tokens;
      existing.cost += ev.cost;
      map.set(ev.day, existing);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [runtimeUsageEvents]);

  const totals = useMemo(() => {
    return runtimeUsageEvents.reduce(
      (acc, ev) => ({ input: acc.input + ev.tokensIn, output: acc.output + ev.tokensOut, cost: acc.cost + ev.cost }),
      { input: 0, output: 0, cost: 0 },
    );
  }, [runtimeUsageEvents]);

  const usagePeriods = useMemo<Record<'today' | '7d' | '30d', PeriodAgg>>(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const getFrom = (days: number) =>
      new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

    const agg = (from: string): PeriodAgg => {
      const within = runtimeUsageEvents.filter((e) => e.day >= from && e.day <= todayStr);
      return {
        tokens: within.reduce((s, e) => s + e.tokens, 0),
        cost: within.reduce((s, e) => s + e.cost, 0),
        requestCount: within.length,
      };
    };

    return {
      today: agg(todayStr),
      '7d': agg(getFrom(7)),
      '30d': agg(getFrom(30)),
    };
  }, [runtimeUsageEvents]);

  const paceStatus = useMemo(() => {
    if (runtimeUsageEvents.length === 0) return null;
    const avgCost = (daysBack: number, len: number) => {
      const to = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
      const from = new Date(Date.now() - (daysBack + len) * 86_400_000).toISOString().slice(0, 10);
      const evs = runtimeUsageEvents.filter((e) => e.day > from && e.day <= to);
      return evs.reduce((s, e) => s + e.cost, 0) / Math.max(1, len);
    };
    const current = avgCost(0, 7);
    const baseline = avgCost(7, 7);
    const ratio = baseline > 0 ? current / baseline : 1;
    if (ratio >= 1.2) return { label: t('analytics.pace.rising'), state: 'rising' as const, color: 'text-red-500' as const };
    if (ratio <= 0.8) return { label: t('analytics.pace.cooling'), state: 'cooling' as const, color: 'text-blue-400' as const };
    return { label: t('analytics.pace.steady'), state: 'steady' as const, color: 'text-emerald-500' as const };
  }, [runtimeUsageEvents, t]);

  const providerBreakdown = useMemo(() => {
    if (runtimeUsageEvents.length === 0) return [];
    const map = new Map<string, { tokens: number; cost: number }>();
    for (const ev of runtimeUsageEvents) {
      const key = ev.provider || 'Unknown';
      const cur = map.get(key) ?? { tokens: 0, cost: 0 };
      cur.tokens += ev.tokens;
      cur.cost += ev.cost;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .map(([provider, v]) => ({ provider, ...v }))
      .sort((a, b) => b.cost - a.cost);
  }, [runtimeUsageEvents]);

  const stats = useMemo(() => {
    const today = chartData[chartData.length - 1];
    const yesterday = chartData[chartData.length - 2];

    const inDelta = today && yesterday ? formatDelta(today.in, yesterday.in) : '+0.0%';
    const outDelta = today && yesterday ? formatDelta(today.out, yesterday.out) : '+0.0%';
    const todayCost = today ? today.cost : 0;
    const yesterdayCost = yesterday ? yesterday.cost : 0;
    const costDelta = today && yesterday ? formatDelta(todayCost, yesterdayCost) : '+0.0%';

    return {
      input: { value: formatCompactNumber(totals.input), delta: inDelta },
      output: { value: formatCompactNumber(totals.output), delta: outDelta },
      cost: { value: totals.cost.toFixed(2), delta: costDelta },
    };
  }, [chartData, totals.cost, totals.input, totals.output]);

  const windowedChartData = useMemo(() => {
    if (usageWindow === 'today') {
      const todayStr = new Date().toISOString().slice(0, 10);
      const hourlyMap = new Map<string, DaySeries>();
      
      for (let i = 0; i < 24; i++) {
        const hh = String(i).padStart(2, '0');
        hourlyMap.set(`${hh}:00`, { name: `${hh}:00`, in: 0, out: 0, tokens: 0, cost: 0 });
      }

      for (const ev of runtimeUsageEvents) {
        if (ev.day === todayStr) {
          const date = new Date(ev.timestamp);
          if (!Number.isNaN(date.getTime())) {
            const hh = String(date.getHours()).padStart(2, '0');
            const key = `${hh}:00`;
            const cur = hourlyMap.get(key);
            if (cur) {
              cur.in += normalizeFinite(ev.tokensIn, 0);
              cur.out += normalizeFinite(ev.tokensOut, 0);
              cur.tokens += normalizeFinite(ev.tokens, 0);
              cur.cost += normalizeFinite(ev.cost, 0);
            }
          }
        }
      }
      return Array.from(hourlyMap.values());
    }

    if (usageWindow === '7d') return chartData.slice(-7);
    return chartData.slice(-30);
  }, [chartData, usageWindow, runtimeUsageEvents]);

  const costHotspots = useMemo(() => {
    if (runtimeUsageEvents.length === 0) return [];
    const grouped = new Map<string, number>();
    for (const ev of runtimeUsageEvents) {
      const key = String(ev.model || ev.agentId || 'unknown').trim() || 'unknown';
      grouped.set(key, (grouped.get(key) ?? 0) + ev.cost);
    }
    return Array.from(grouped.entries())
      .map(([name, cost]) => ({ name, cost }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);
  }, [runtimeUsageEvents]);

  const agentBreakdown = useMemo(() => {
    if (runtimeUsageEvents.length === 0) return [];
    const grouped = new Map<string, number>();
    for (const ev of runtimeUsageEvents) {
      const agentId = ev.agentId || 'Unknown';
      grouped.set(agentId, (grouped.get(agentId) ?? 0) + ev.tokens);
    }
    return Array.from(grouped.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [runtimeUsageEvents]);

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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('analytics.window.title')}</span>
          {paceStatus && (
            <div className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-widest ${paceStatus.color}`}>
              {paceStatus.state === 'rising' ? <TrendingUp size={12} /> : paceStatus.state === 'cooling' ? <TrendingDown size={12} /> : <Minus size={12} />}
              {paceStatus.label}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-left">
          {([
            { key: 'today', label: t('analytics.window.today') },
            { key: '7d', label: t('analytics.window.7d') },
            { key: '30d', label: t('analytics.window.30d') },
          ] as const).map((item) => {
            const period = usagePeriods[item.key];
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setUsageWindow(item.key)}
                className={`rounded-2xl border px-4 py-4 transition-all text-left ${usageWindow === item.key ? 'border-blue-500/40 bg-blue-500/5' : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/20'}`}
              >
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{item.label}</div>
                <div className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-100">{formatCompactNumber(period.tokens)} {t('analytics.window.tokensUnit')}</div>
                <div className="text-xs text-slate-500">
                  ${period.cost.toFixed(3)}
                  {period.requestCount > 0 && <span className="ml-2 opacity-60">· {period.requestCount} {t('analytics.window.requests')}</span>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-left">
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>

          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">{t('analytics.trendTitle')}</h3>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">{t('analytics.labels.dailyTotalStacked')}</p>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {t('analytics.labels.jsonlSource')}
            </div>
          </div>

          <div className="h-[300px] w-full">
            {windowedChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={windowedChartData}>
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
                    tickFormatter={(value) => formatCompactNumber(value)}
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
                    formatter={(value: unknown) => [formatCompactNumber(Number(value) || 0), undefined]}
                  />
                  <Area type="monotone" dataKey="in" name={t('analytics.labels.input')} stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorIn)" stackId="1" />
                  <Area type="monotone" dataKey="out" name={t('analytics.labels.output')} stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#colorOut)" stackId="1" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">{t('analytics.noData')}</div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent"></div>

          <div className="mb-8">
            <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">{t('analytics.efficiencyTitle')}</h3>
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">{t('analytics.labels.inputOutputRatio')}</p>
          </div>

          <div className="h-[300px] w-full">
            {windowedChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={windowedChartData}>
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
                    tickFormatter={(value) => formatCompactNumber(value)}
                  />
                  <Tooltip
                    contentStyle={{
                        backgroundColor: '#0f172a',
                        border: '1px solid #1e293b',
                        borderRadius: '16px',
                        fontSize: '11px'
                    }}
                    formatter={(value: unknown) => [formatCompactNumber(Number(value) || 0), undefined]}
                  />
                  <Line type="stepAfter" dataKey="in" name={t('analytics.labels.inputLoad')} stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} />
                  <Line type="stepAfter" dataKey="out" name={t('analytics.labels.outputDensity')} stroke="#fbbf24" strokeWidth={2} dot={{ r: 4, fill: '#fbbf24', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">{t('analytics.waitingData')}</div>
            )}
          </div>
        </div>
      </div>


      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-left">
        {providerBreakdown.length > 0 && (
          <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl">
            <div className="mb-6">
              <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">{t('analytics.providerBreakdown.title')}</h3>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">{t('analytics.providerBreakdown.subtitle')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {providerBreakdown.map((row) => (
                <div key={row.provider} className="rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 bg-white/70 dark:bg-slate-900/40">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{row.provider}</div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100">${row.cost.toFixed(3)}</div>
                  <div className="text-xs text-slate-500">{formatCompactNumber(row.tokens)} tokens</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">{t('analytics.costHotspots.title')}</h3>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">
                {t('analytics.costHotspots.subtitleRuntime')}
              </p>
            </div>
            <button
              onClick={handleRefreshPrices}
              disabled={isRefreshingPrices}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 text-slate-500"
            >
              <RefreshCcw size={12} className={isRefreshingPrices ? 'animate-spin' : ''} />
              {t('analytics.costHotspots.refreshBtn')}
            </button>
          </div>
          <div className="space-y-2">
            {costHotspots.length > 0 ? costHotspots.map((row) => {
              const priceObj = getModelPrice(row.name);
              const inPrice = priceObj ? (priceObj.prompt * 1000000).toFixed(2) : '--';
              const outPrice = priceObj ? (priceObj.completion * 1000000).toFixed(2) : '--';
              
              return (
                <div key={row.name} className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 bg-white/70 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-700 dark:text-slate-200 truncate pr-2 font-medium">{row.name}</span>
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-100">${row.cost.toFixed(3)}</span>
                  </div>
                  <div className="text-[9px] text-slate-400 font-normal mt-0.5 tracking-tight truncate">
                    {t('analytics.costHotspots.formulaSpecific', { inPrice, outPrice })}
                  </div>
                </div>
              );
            }) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">{t('analytics.costHotspots.noData')}</div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-pink-500/50 to-transparent"></div>

          <div className="mb-8">
            <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">{t('analytics.agentAttribution')}</h3>
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">{t('analytics.labels.byAgent')}</p>
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
                    {agentBreakdown.map((_, index) => (
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
                    formatter={(value: unknown) => [formatCompactNumber(Number(value) || 0), undefined]}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">{t('analytics.noAgentData')}</div>
            )}
          </div>
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
