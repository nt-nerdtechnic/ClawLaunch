import type { StateCreator } from 'zustand';

export interface ReadModelSession {
  sessionKey: string;
  agentId: string;
  status: string;
  tokensIn: number;
  tokensOut: number;
  cost?: number;
  model?: string;
  updatedAt: string;
}

export interface ReadModelTask {
  id: string;
  title: string;
  status: string;
  scope: string;
  updatedAt: string;
}

export interface ReadModelApproval {
  id: string;
  status: string;
  summary: string;
  requestedAt: string;
}

export interface ReadModelStatus {
  sessionKey: string;
  state: string;
  tokensIn: number;
  tokensOut: number;
  cost?: number;
  model?: string;
  contextWindowTokens?: number;
}

export interface ReadModelBudgetEvaluation {
  scope: string;
  status: string;
  usedCost30d: number;
  limitCost30d: number;
}

export interface ReadModelBudgetSummary {
  status: string;
  usedCost30d: number;
  limitCost30d: number;
  burnRatePerDay: number;
  projectedDaysToLimit: number;
  evaluations: ReadModelBudgetEvaluation[];
}

export interface ReadModelSnapshot {
  generatedAt: string;
  sessions: ReadModelSession[];
  tasks: ReadModelTask[];
  approvals: ReadModelApproval[];
  statuses: ReadModelStatus[];
  budgetSummary: ReadModelBudgetSummary;
}

export interface ReadModelHistoryPoint {
  dateKey: string;
  label: string;
  tokensIn: number;
  tokensOut: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface EventQueueItem {
  id: string;
  level: 'info' | 'warn' | 'action-required';
  title: string;
  detail: string;
  source: string;
  createdAt: string;
  status?: 'pending' | 'acked' | 'expired';
  ackedAt?: string;
  ackExpiresAt?: string;
  entityId?: string;
}

export interface AuditTimelineItem {
  id: string;
  level: 'info' | 'warn' | 'action-required';
  source: string;
  message: string;
  timestamp: string;
}

export interface SnapshotSlice {
  snapshot: ReadModelSnapshot | null;
  snapshotHistory: ReadModelHistoryPoint[];
  eventQueue: EventQueueItem[];
  ackedEvents: EventQueueItem[];
  auditTimeline: AuditTimelineItem[];
  dailyDigest: string;
  rawSnapshot: ReadModelSnapshot | null;
  snapshotSourcePath: string;
  setSnapshot: (snapshot: ReadModelSnapshot | null) => void;
  setSnapshotHistory: (history: ReadModelHistoryPoint[]) => void;
  setEventQueue: (items: EventQueueItem[]) => void;
  setAckedEvents: (items: EventQueueItem[]) => void;
  setAuditTimeline: (items: AuditTimelineItem[]) => void;
  setDailyDigest: (digest: string) => void;
  ackEventLocal: (eventId: string, ttlMs?: number) => void;
  setRawSnapshot: (rawSnapshot: ReadModelSnapshot | null) => void;
  setSnapshotSourcePath: (path: string) => void;
}

export const createSnapshotSlice: StateCreator<SnapshotSlice> = (set) => ({
  snapshot: null,
  snapshotHistory: [],
  eventQueue: [],
  ackedEvents: [],
  auditTimeline: [],
  dailyDigest: '',
  rawSnapshot: null,
  snapshotSourcePath: '',
  setSnapshot: (snapshot) => set({ snapshot }),
  setSnapshotHistory: (snapshotHistory) => set({ snapshotHistory }),
  setEventQueue: (eventQueue) => set({ eventQueue }),
  setAckedEvents: (ackedEvents) => set({ ackedEvents }),
  setAuditTimeline: (auditTimeline) => set({ auditTimeline }),
  setDailyDigest: (dailyDigest) => set({ dailyDigest }),
  ackEventLocal: (eventId, ttlMs = 30 * 60 * 1000) =>
    set((state) => {
      const now = Date.now();
      const expiresAt = new Date(now + ttlMs).toISOString();
      const target = state.eventQueue.find((item) => item.id === eventId);
      if (!target) return { eventQueue: state.eventQueue, ackedEvents: state.ackedEvents };
      return {
        eventQueue: state.eventQueue.filter((item) => item.id !== eventId),
        ackedEvents: [
          {
            ...target,
            status: 'acked' as const,
            ackedAt: new Date(now).toISOString(),
            ackExpiresAt: expiresAt,
          },
          ...state.ackedEvents,
        ].slice(0, 200),
      };
    }),
  setRawSnapshot: (rawSnapshot) => set({ rawSnapshot }),
  setSnapshotSourcePath: (snapshotSourcePath) => set({ snapshotSourcePath }),
});
