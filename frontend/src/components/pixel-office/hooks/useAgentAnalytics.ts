import { useMemo } from 'react';
import { useStore } from '../../../store';

export type AnalyticsPeriod = 'today' | '7d' | '30d';

export interface DaySeries {
  name: string;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  cost: number;
  in: number;
  out: number;
}

export interface AnalyticsSummary {
  tokens: number;
  cost: number;
  requestCount: number;
}

export interface ModelBreakdownEntry {
  model: string;
  tokens: number;
  cost: number;
}

export interface ProviderBreakdownEntry {
  provider: string;
  tokens: number;
  cost: number;
}

export interface CostHotspot {
  name: string;
  cost: number;
}

export interface PeriodAgg {
  tokens: number;
  cost: number;
  requestCount: number;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function useAgentAnalytics(agentId: string, period: AnalyticsPeriod) {
  const runtimeUsageEvents = useStore(s => s.runtimeUsageEvents);

  const filtered = useMemo(
    () => runtimeUsageEvents.filter(e => !e.agentId || e.agentId === agentId),
    [runtimeUsageEvents, agentId]
  );

  const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;

  const daySeries: DaySeries[] = useMemo(() => {
    const now = new Date();
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (days - 1 - i));
      const key = dateKey(d);
      const label = days === 1
        ? 'Today'
        : d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      const evs = filtered.filter(e => e.day === key);
      const tokensIn = evs.reduce((s, e) => s + (e.tokensIn ?? 0), 0);
      const tokensOut = evs.reduce((s, e) => s + (e.tokensOut ?? 0), 0);
      const tokens = evs.reduce((s, e) => s + (e.tokens ?? 0), 0);
      const cost = evs.reduce((s, e) => s + (e.cost ?? 0), 0);
      return { name: label, tokensIn, tokensOut, tokens, cost, in: tokensIn, out: tokensOut };
    });
  }, [filtered, days]);

  const summary: AnalyticsSummary = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days + 1);
    const cutoffKey = dateKey(cutoff);
    const evs = filtered.filter(e => (e.day ?? '') >= cutoffKey);
    return {
      tokens: evs.reduce((s, e) => s + (e.tokens ?? 0), 0),
      cost: evs.reduce((s, e) => s + (e.cost ?? 0), 0),
      requestCount: evs.length,
    };
  }, [filtered, days]);

  const modelBreakdown: ModelBreakdownEntry[] = useMemo(() => {
    const map = new Map<string, { tokens: number; cost: number }>();
    for (const e of filtered) {
      const m = e.model || 'unknown';
      const prev = map.get(m) ?? { tokens: 0, cost: 0 };
      map.set(m, {
        tokens: prev.tokens + (e.tokens ?? 0),
        cost: prev.cost + (e.cost ?? 0),
      });
    }
    return [...map.entries()]
      .map(([model, stats]) => ({ model, ...stats }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 6);
  }, [filtered]);

  const providerBreakdown: ProviderBreakdownEntry[] = useMemo(() => {
    if (filtered.length === 0) return [];
    const map = new Map<string, { tokens: number; cost: number }>();
    for (const ev of filtered) {
      const key = ev.provider || 'Unknown';
      const cur = map.get(key) ?? { tokens: 0, cost: 0 };
      cur.tokens += ev.tokens ?? 0;
      cur.cost += ev.cost ?? 0;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .map(([provider, v]) => ({ provider, ...v }))
      .sort((a, b) => b.cost - a.cost);
  }, [filtered]);

  const costHotspots: CostHotspot[] = useMemo(() => {
    if (filtered.length === 0) return [];
    const grouped = new Map<string, number>();
    for (const ev of filtered) {
      const key = String(ev.model || 'unknown').trim() || 'unknown';
      grouped.set(key, (grouped.get(key) ?? 0) + (ev.cost ?? 0));
    }
    return Array.from(grouped.entries())
      .map(([name, cost]) => ({ name, cost }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);
  }, [filtered]);

  const usagePeriods = useMemo<Record<'today' | '7d' | '30d', PeriodAgg>>(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const getFrom = (d: number) =>
      new Date(Date.now() - (d - 1) * 86_400_000).toISOString().slice(0, 10);

    const agg = (from: string): PeriodAgg => {
      const within = filtered.filter(e => (e.day ?? '') >= from && (e.day ?? '') <= todayStr);
      return {
        tokens: within.reduce((s, e) => s + (e.tokens ?? 0), 0),
        cost: within.reduce((s, e) => s + (e.cost ?? 0), 0),
        requestCount: within.length,
      };
    };

    return {
      today: agg(todayStr),
      '7d': agg(getFrom(7)),
      '30d': agg(getFrom(30)),
    };
  }, [filtered]);

  const paceStatus = useMemo(() => {
    if (filtered.length === 0) return null;
    const avgCost = (daysBack: number, len: number) => {
      const to = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
      const from = new Date(Date.now() - (daysBack + len) * 86_400_000).toISOString().slice(0, 10);
      const evs = filtered.filter(e => (e.day ?? '') > from && (e.day ?? '') <= to);
      return evs.reduce((s, e) => s + (e.cost ?? 0), 0) / Math.max(1, len);
    };
    const current = avgCost(0, 7);
    const baseline = avgCost(7, 7);
    const ratio = baseline > 0 ? current / baseline : 1;
    if (ratio >= 1.2) return { label: 'Rising', state: 'rising' as const, color: 'text-red-500' };
    if (ratio <= 0.8) return { label: 'Cooling', state: 'cooling' as const, color: 'text-blue-400' };
    return { label: 'Steady', state: 'steady' as const, color: 'text-emerald-500' };
  }, [filtered]);

  return {
    daySeries,
    summary,
    modelBreakdown,
    providerBreakdown,
    costHotspots,
    usagePeriods,
    paceStatus,
    hasData: filtered.length > 0,
  };
}
