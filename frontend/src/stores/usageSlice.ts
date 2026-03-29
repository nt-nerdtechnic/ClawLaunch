import type { StateCreator } from 'zustand';

export interface RuntimeUsageUpdate {
  input: number;
  output: number;
  history: { name: string; tokens: number }[];
}

export interface RuntimeUsageEvent {
  timestamp: string;
  day: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  tokensIn: number;
  tokensOut: number;
  cacheTokens: number;
  tokens: number;
  cost: number;
}

export interface UsageSlice {
  usage: RuntimeUsageUpdate;
  setUsage: (data: RuntimeUsageUpdate) => void;
  runtimeUsageEvents: RuntimeUsageEvent[];
  setRuntimeUsageEvents: (events: RuntimeUsageEvent[]) => void;
  modelPrices: Record<string, { prompt: number; completion: number }>;
  setModelPrices: (prices: Record<string, { prompt: number; completion: number }>) => void;
}

export const createUsageSlice: StateCreator<UsageSlice> = (set) => ({
  usage: { input: 0, output: 0, history: [] },
  setUsage: (data) => set((state) => ({ usage: { ...state.usage, ...data } })),
  runtimeUsageEvents: [],
  setRuntimeUsageEvents: (runtimeUsageEvents) => set({ runtimeUsageEvents }),
  modelPrices: (() => {
    try {
      const stored = localStorage.getItem('openclaw_model_prices');
      if (stored) return JSON.parse(stored);
    } catch (_e) {
      /* ignore */
    }
    return {};
  })(),
  setModelPrices: (prices) =>
    set((state) => {
      const next = { ...state.modelPrices, ...prices };
      try {
        localStorage.setItem('openclaw_model_prices', JSON.stringify(next));
      } catch (_e) {
        /* ignore */
      }
      return { modelPrices: next };
    }),
});
