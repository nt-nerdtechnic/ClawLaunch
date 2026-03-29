import { create } from 'zustand';

// ─── Slice creators ───────────────────────────────────────────────────────────
import { createSystemSlice } from './stores/systemSlice';
import { createConfigSlice } from './stores/configSlice';
import { createUiSlice } from './stores/uiSlice';
import { createSkillSlice } from './stores/skillSlice';
import { createUsageSlice } from './stores/usageSlice';
import { createSnapshotSlice } from './stores/snapshotSlice';
import { createChatSlice } from './stores/chatSlice';

// ─── Slice type imports ───────────────────────────────────────────────────────
import type { SystemSlice } from './stores/systemSlice';
import type { ConfigSlice } from './stores/configSlice';
import type { UiSlice } from './stores/uiSlice';
import type { SkillSlice } from './stores/skillSlice';
import type { UsageSlice } from './stores/usageSlice';
import type { SnapshotSlice } from './stores/snapshotSlice';
import type { ChatSlice } from './stores/chatSlice';

// ─── Re-exports for backward compatibility ───────────────────────────────────
export type { LogEntry } from './stores/systemSlice';
export type { Config, DetectedConfig } from './stores/configSlice';
export type { SkillItem } from './stores/skillSlice';
export type { RuntimeUsageUpdate, RuntimeUsageEvent } from './stores/usageSlice';
export type {
  ReadModelSession,
  ReadModelTask,
  ReadModelApproval,
  ReadModelStatus,
  ReadModelBudgetEvaluation,
  ReadModelBudgetSummary,
  ReadModelSnapshot,
  ReadModelHistoryPoint,
  EventQueueItem,
  AuditTimelineItem,
} from './stores/snapshotSlice';
export type { ChatMessage } from './stores/chatSlice';

// ─── Composed store ───────────────────────────────────────────────────────────
type AppState = SystemSlice & ConfigSlice & UiSlice & SkillSlice & UsageSlice & SnapshotSlice & ChatSlice;

export const useStore = create<AppState>()((...a) => ({
  ...createSystemSlice(...a),
  ...createConfigSlice(...a),
  ...createUiSlice(...a),
  ...createSkillSlice(...a),
  ...createUsageSlice(...a),
  ...createSnapshotSlice(...a),
  ...createChatSlice(...a),
}));

