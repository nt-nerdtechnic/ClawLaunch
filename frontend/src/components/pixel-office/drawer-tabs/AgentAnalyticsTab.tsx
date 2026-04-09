import { useState } from 'react';
import { BarChart2, TrendingUp, TrendingDown, Minus, RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from 'recharts';
import { useAgentAnalytics, type AnalyticsPeriod } from '../hooks/useAgentAnalytics';
import { useStore } from '../../../store';

interface AgentAnalyticsTabProps {
  agentId: string;
}

const formatCompactNumber = (n: number) =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function StatCard({ label, value, delta }: { label: string; value: string; delta: string }) {
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

export default function AgentAnalyticsTab({ agentId }: AgentAnalyticsTabProps) {
  const { t } = useTranslation();
  const [usageWindow, setUsageWindow] = useState<AnalyticsPeriod>('7d');
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const { modelPrices, setModelPrices } = useStore();
  const {
    daySeries,
    summary,
    modelBreakdown,
    providerBreakdown,
    costHotspots,
    usagePeriods,
    paceStatus,
    hasData,
  } = useAgentAnalytics(agentId, usageWindow);

  const totals = {
    input: daySeries.reduce((s, d) => s + d.tokensIn, 0),
    output: daySeries.reduce((s, d) => s + d.tokensOut, 0),
    cost: daySeries.reduce((s, d) => s + d.cost, 0),
  };

  const getModelPrice = (modelName: string) => {
    const name = modelName.trim().toLowerCase();
    if (!name || name === 'unknown' || !modelPrices || Object.keys(modelPrices).length === 0) return null;
    if (modelPrices[name]) return modelPrices[name];
    const norm = name.replace(/[-_.\s]/g, '');
    let best: { price: { prompt: number; completion: number }; slug: string } | null = null;
    for (const [id, price] of Object.entries(modelPrices)) {
      const slug = (id.split('/')[1] || id).toLowerCase().replace(/[-_.\s]/g, '');
      if (norm === slug) return price;
      if (norm.includes(slug) || slug.includes(norm)) {
        if (!best || slug.length > best.slug.length) best = { price, slug };
      }
    }
    return best?.price ?? null;
  };

  const handleRefreshPrices = async () => {
    setIsRefreshingPrices(true);
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      const data = await res.json() as { data?: Array<{ id: string; pricing?: { prompt: number; completion: number } }> };
      if (data?.data) {
        const newPrices: Record<string, { prompt: number; completion: number }> = {};
        for (const item of data.data) {
          if (item.pricing) {
            newPrices[item.id] = { prompt: Number(item.pricing.prompt) || 0, completion: Number(item.pricing.completion) || 0 };
          }
        }
        setModelPrices(newPrices);
      }
    } catch { /* ignore */ }
    finally { setIsRefreshingPrices(false); }
  };

  if (!hasData) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 py-12 text-slate-400">
        <BarChart2 size={24} className="opacity-30" />
        <p className="text-[11px]">{t('pixelOffice.drawer.analytics.noData', 'No usage data yet')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-20 p-8">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-8 text-left">
        <StatCard
          label={t('analytics.totalInput', 'Input Tokens')}
          value={formatCompactNumber(totals.input)}
          delta="+0.0%"
        />
        <StatCard
          label={t('analytics.totalOutput', 'Output Tokens')}
          value={formatCompactNumber(totals.output)}
          delta="+0.0%"
        />
        <StatCard
          label={t('analytics.estimatedCost', 'Est. Cost')}
          value={`$${totals.cost.toFixed(2)}`}
          delta="+0.0%"
        />
      </div>

      {/* Period windows */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            {t('analytics.window.title', 'Usage Window')}
          </span>
          {paceStatus && (
            <div className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-widest ${paceStatus.color}`}>
              {paceStatus.state === 'rising' ? <TrendingUp size={12} /> : paceStatus.state === 'cooling' ? <TrendingDown size={12} /> : <Minus size={12} />}
              {paceStatus.label}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4 text-left">
          {(['today', '7d', '30d'] as const).map(key => {
            const labels = { today: t('analytics.window.today', 'Today'), '7d': t('analytics.window.7d', '7 Days'), '30d': t('analytics.window.30d', '30 Days') };
            const p = usagePeriods[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setUsageWindow(key)}
                className={`rounded-2xl border px-4 py-4 transition-all text-left ${
                  usageWindow === key
                    ? 'border-blue-500/40 bg-blue-500/5'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/20'
                }`}
              >
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{labels[key]}</div>
                <div className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                  {formatCompactNumber(p.tokens)} {t('analytics.window.tokensUnit', 'tok')}
                </div>
                <div className="text-xs text-slate-500">
                  ${p.cost.toFixed(3)}
                  {p.requestCount > 0 && (
                    <span className="ml-2 opacity-60">· {p.requestCount} {t('analytics.window.requests', 'req')}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-8 text-left">
        {/* Token trend */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">
                {t('analytics.trendTitle', 'Token Trend')}
              </h3>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">
                {t('analytics.labels.dailyTotalStacked', 'Daily Total Stacked')}
              </p>
            </div>
          </div>
          <div className="h-[200px] w-full">
            {daySeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={daySeries}>
                  <defs>
                    <linearGradient id="agColorIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="agColorOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-slate-200 dark:text-slate-800" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'currentColor', fontSize: 10, fontWeight: 700 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: 'currentColor', fontSize: 10, fontWeight: 700 }} tickFormatter={formatCompactNumber} />
                  <Tooltip
                    cursor={{ stroke: 'currentColor', strokeWidth: 2 }}
                    contentStyle={{ backgroundColor: isDark ? '#0f172a' : '#fff', border: '1px solid', borderColor: isDark ? '#1e293b' : '#e2e8f0', borderRadius: 16, fontSize: 11, color: isDark ? '#f1f5f9' : '#0f172a' }}
                    formatter={(v: unknown) => [formatCompactNumber(Number(v) || 0), undefined]}
                  />
                  <Area type="monotone" dataKey="in" name={t('analytics.labels.input', 'Input')} stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#agColorIn)" stackId="1" />
                  <Area type="monotone" dataKey="out" name={t('analytics.labels.output', 'Output')} stroke="#8b5cf6" strokeWidth={3} fillOpacity={1} fill="url(#agColorOut)" stackId="1" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">{t('analytics.noData', 'No data')}</div>
            )}
          </div>
        </div>

        {/* Efficiency */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500/50 to-transparent" />
          <div className="mb-8">
            <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">
              {t('analytics.efficiencyTitle', 'Efficiency')}
            </h3>
            <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">
              {t('analytics.labels.inputOutputRatio', 'Input / Output Ratio')}
            </p>
          </div>
          <div className="h-[200px] w-full">
            {daySeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daySeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#475569', fontSize: 10, fontWeight: 700 }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#475569', fontSize: 10, fontWeight: 700 }} tickFormatter={formatCompactNumber} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: 16, fontSize: 11 }}
                    formatter={(v: unknown) => [formatCompactNumber(Number(v) || 0), undefined]}
                  />
                  <Line type="stepAfter" dataKey="in" name={t('analytics.labels.inputLoad', 'Input')} stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} />
                  <Line type="stepAfter" dataKey="out" name={t('analytics.labels.outputDensity', 'Output')} stroke="#fbbf24" strokeWidth={2} dot={{ r: 4, fill: '#fbbf24', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">{t('analytics.waitingData', 'Waiting…')}</div>
            )}
          </div>
        </div>
      </div>

      {/* Provider breakdown + Cost hotspots */}
      <div className="grid grid-cols-1 gap-8 text-left">
        {providerBreakdown.length > 0 && (
          <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl">
            <div className="mb-6">
              <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">
                {t('analytics.providerBreakdown.title', 'Providers')}
              </h3>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">
                {t('analytics.providerBreakdown.subtitle', 'Cost by provider')}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {providerBreakdown.map(row => (
                <div key={row.provider} className="rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 bg-white/70 dark:bg-slate-900/40">
                  <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">{row.provider}</div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100">${row.cost.toFixed(3)}</div>
                  <div className="text-xs text-slate-500">{formatCompactNumber(row.tokens)} tokens</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cost hotspots */}
        <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">
                {t('analytics.costHotspots.title', 'Cost Hotspots')}
              </h3>
              <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-tight">
                {t('analytics.costHotspots.subtitleRuntime', 'By model')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleRefreshPrices()}
              disabled={isRefreshingPrices}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-[10px] font-bold tracking-widest uppercase rounded-full border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 text-slate-500"
            >
              <RefreshCcw size={12} className={isRefreshingPrices ? 'animate-spin' : ''} />
              {t('analytics.costHotspots.refreshBtn', 'Prices')}
            </button>
          </div>
          <div className="space-y-2">
            {costHotspots.length > 0 ? costHotspots.map(row => {
              const priceObj = getModelPrice(row.name);
              const inPrice = priceObj ? (priceObj.prompt * 1_000_000).toFixed(2) : '--';
              const outPrice = priceObj ? (priceObj.completion * 1_000_000).toFixed(2) : '--';
              return (
                <div key={row.name} className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 bg-white/70 dark:bg-slate-900/40">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-700 dark:text-slate-200 truncate pr-2 font-medium">{row.name}</span>
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-100">${row.cost.toFixed(3)}</span>
                  </div>
                  <div className="text-[9px] text-slate-400 font-normal mt-0.5 tracking-tight truncate">
                    {t('analytics.costHotspots.formulaSpecific', `in: $${inPrice}/M · out: $${outPrice}/M`)}
                  </div>
                </div>
              );
            }) : (
              <div className="h-full flex items-center justify-center text-slate-700 italic">
                {t('analytics.costHotspots.noData', 'No data')}
              </div>
            )}
          </div>
        </div>

        {/* Model breakdown */}
        {modelBreakdown.length > 0 && (
          <div className="bg-slate-50 dark:bg-slate-900/20 border border-slate-200 dark:border-slate-800 p-8 rounded-[32px] shadow-2xl">
            <div className="mb-6">
              <h3 className="text-lg font-black uppercase tracking-widest text-slate-900 dark:text-slate-100">
                {t('pixelOffice.drawer.analytics.models', 'Models')}
              </h3>
            </div>
            <div className="space-y-2">
              {modelBreakdown.map(m => (
                <div key={m.model} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 bg-white/70 dark:bg-slate-900/40">
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-300 truncate flex-1">{m.model}</span>
                  <span className="text-xs text-slate-500 shrink-0">{formatCompactNumber(m.tokens)}</span>
                  <span className="text-xs text-amber-500 shrink-0 font-bold">${m.cost.toFixed(4)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Summary total */}
      <div className="text-center text-xs text-slate-400 font-mono">
        {t('pixelOffice.drawer.analytics.tokens', 'Tokens')}: {formatCompactNumber(summary.tokens)} ·
        {t('pixelOffice.drawer.analytics.cost', 'Cost')}: ${summary.cost.toFixed(4)} ·
        {t('pixelOffice.drawer.analytics.requests', 'Requests')}: {summary.requestCount}
      </div>
    </div>
  );
}
