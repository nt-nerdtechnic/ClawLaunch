import { useRef, useEffect } from 'react';
import { Bell, Save, X } from 'lucide-react';
import cronstrue from 'cronstrue/i18n';
import type { ModelOptionGroup } from '../../hooks/useAppComputedValues';
import type { PixelAgentSummary } from '../pixel-office/hooks/usePixelOfficeAgents';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface CronEditDraft {
  name: string;
  agentId: string;
  model: string;
  scheduleKind: 'every' | 'cron';
  intervalMin: number;
  cronFreq: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';
  cronMinute: number;
  cronHour: number;
  cronDow: number;
  cronDom: number;
  cronExpr: string;
  timeoutMin: number | '';
  deliveryMode: string;
  deliveryChannel: string;
  deliveryTo: string;
  payloadMessage: string;
}

const CHANNEL_META: { id: string; name: string }[] = [
  { id: 'telegram',   name: 'Telegram'    },
  { id: 'discord',    name: 'Discord'     },
  { id: 'slack',      name: 'Slack'       },
  { id: 'googlechat', name: 'Google Chat' },
  { id: 'line',       name: 'LINE'        },
];

interface Props {
  draft: CronEditDraft;
  onChange: (draft: CronEditDraft) => void;
  allAgents: PixelAgentSummary[];
  modelOptionGroups: ModelOptionGroup[];
  configuredBotChannels: { id: string; name: string }[];
  authorizedRecipients: Record<string, string[]>;
  buildCronExpr: (d: CronEditDraft) => string;
  onSave: () => void;
  onCancel: () => void;
}

// ── Shared input class names ───────────────────────────────────────────────────

const input = 'w-full text-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400';
const label = 'block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1';

// ── Component ──────────────────────────────────────────────────────────────────

export function CronEditModal({ draft, onChange, allAgents, modelOptionGroups, configuredBotChannels, authorizedRecipients, buildCronExpr, onSave, onCancel }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const set = (updates: Partial<CronEditDraft>) => onChange({ ...draft, ...updates });

  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [draft.payloadMessage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cronPreview = (() => {
    const expr = buildCronExpr(draft);
    try { return { ok: true, text: cronstrue.toString(expr, { locale: 'zh_TW' }) }; }
    catch { return { ok: false, text: draft.cronFreq === 'custom' ? '格式無效' : '' }; }
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-violet-100 dark:border-violet-900/40 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <span className="text-base font-bold text-slate-700 dark:text-slate-100">編輯排程</span>
          <button onClick={onCancel} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* 名稱 */}
          <div>
            <label className={label}>名稱</label>
            <input
              type="text"
              value={draft.name}
              onChange={e => set({ name: e.target.value })}
              className={input}
              maxLength={100}
              placeholder="排程名稱"
            />
          </div>

          {/* Agent + 模型 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Agent 種類</label>
              <select value={draft.agentId} onChange={e => set({ agentId: e.target.value })} className={input}>
                <option value="" disabled>請選擇 Agent...</option>
                {allAgents.map(a => (
                  <option key={a.id} value={a.id}>{a.displayName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>強制指定模型（選填）</label>
              <select value={draft.model} onChange={e => set({ model: e.target.value })} className={input}>
                <option value="">(套用 Agent 預設)</option>
                {modelOptionGroups.map(({ provider, group, models }) => (
                  <optgroup key={provider} label={group}>
                    {models.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          {/* 排程 + 逾時 */}
          <div className="grid grid-cols-3 gap-3">
            <div className={draft.scheduleKind === 'cron' ? 'col-span-3' : 'col-span-2'}>
              <div className="flex items-center justify-between mb-1">
                <label className={label.replace('mb-1', '')}>排程</label>
                <div className="flex items-center gap-1">
                  {(['every', 'cron'] as const).map(k => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => set({ scheduleKind: k })}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-all ${
                        draft.scheduleKind === k
                          ? 'bg-violet-500 text-white border-violet-500'
                          : 'bg-white dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 hover:border-violet-300'
                      }`}
                    >
                      {k === 'every' ? '間隔' : 'Cron'}
                    </button>
                  ))}
                </div>
              </div>

              {draft.scheduleKind === 'every' ? (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={draft.intervalMin}
                    onChange={e => set({ intervalMin: Math.max(1, Number(e.target.value)) })}
                    className={input}
                  />
                  <span className="text-sm text-slate-400 shrink-0">分鐘</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      value={draft.cronFreq}
                      onChange={e => set({ cronFreq: e.target.value as CronEditDraft['cronFreq'] })}
                      className="text-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
                    >
                      <option value="hourly">每小時</option>
                      <option value="daily">每天</option>
                      <option value="weekly">每週</option>
                      <option value="monthly">每月</option>
                      <option value="custom">自訂</option>
                    </select>
                    {draft.cronFreq === 'weekly' && (
                      <select value={draft.cronDow} onChange={e => set({ cronDow: Number(e.target.value) })} className="text-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400">
                        {['週日','週一','週二','週三','週四','週五','週六'].map((lbl, i) => (
                          <option key={i} value={i}>{lbl}</option>
                        ))}
                      </select>
                    )}
                    {draft.cronFreq === 'monthly' && (
                      <select value={draft.cronDom} onChange={e => set({ cronDom: Number(e.target.value) })} className="text-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400">
                        {Array.from({ length: 31 }, (_, i) => (
                          <option key={i + 1} value={i + 1}>{i + 1} 日</option>
                        ))}
                      </select>
                    )}
                    {(draft.cronFreq === 'daily' || draft.cronFreq === 'weekly' || draft.cronFreq === 'monthly') && (
                      <select value={draft.cronHour} onChange={e => set({ cronHour: Number(e.target.value) })} className="text-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400">
                        {Array.from({ length: 24 }, (_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, '0')} 時</option>
                        ))}
                      </select>
                    )}
                    {draft.cronFreq !== 'custom' && (
                      <select value={draft.cronMinute} onChange={e => set({ cronMinute: Number(e.target.value) })} className="text-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400">
                        {Array.from({ length: 60 }, (_, i) => (
                          <option key={i} value={i}>{String(i).padStart(2, '0')} 分</option>
                        ))}
                      </select>
                    )}
                    {draft.cronFreq === 'custom' && (
                      <input
                        type="text"
                        value={draft.cronExpr}
                        placeholder="0 10 * * 0"
                        onChange={e => set({ cronExpr: e.target.value })}
                        className="flex-1 min-w-0 text-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400 font-mono"
                      />
                    )}
                  </div>
                  {cronPreview.text && (
                    <p className={`text-xs truncate ${cronPreview.ok ? 'text-violet-500' : 'text-rose-400'}`}>
                      {cronPreview.text}
                    </p>
                  )}
                </div>
              )}
            </div>

            {draft.scheduleKind !== 'cron' && (
              <div>
                <label className={label}>逾時（分鐘）</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={draft.timeoutMin}
                  placeholder="不設定"
                  onChange={e => set({ timeoutMin: e.target.value === '' ? '' : Math.max(1, Number(e.target.value)) })}
                  className={input}
                />
              </div>
            )}
            {draft.scheduleKind === 'cron' && (
              <div className="col-span-3">
                <label className={label}>逾時（分鐘）</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={draft.timeoutMin}
                  placeholder="不設定"
                  onChange={e => set({ timeoutMin: e.target.value === '' ? '' : Math.max(1, Number(e.target.value)) })}
                  className="w-40 text-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
                />
              </div>
            )}
          </div>

          {/* 通知格式 */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <Bell size={12} />通知格式
              </label>
              <div className="flex items-center gap-1.5">
                {(['none', 'announce'] as const).map(mode => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => set({ deliveryMode: mode })}
                    className={`px-3 py-1 text-xs font-bold rounded-lg border transition-all ${
                      draft.deliveryMode === mode
                        ? 'bg-violet-500 text-white border-violet-500'
                        : 'bg-white dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 hover:border-violet-300'
                    }`}
                  >
                    {mode === 'none' ? '不通知' : '廣播'}
                  </button>
                ))}
              </div>
            </div>

            {draft.deliveryMode === 'announce' && (
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={`${label} flex items-center justify-between`}>
                    <span>頻道</span>
                    {configuredBotChannels.length > 0 && (
                      <span className="text-[10px] text-violet-400 font-normal">{configuredBotChannels.length} 個已綁定</span>
                    )}
                  </label>
                  <select value={draft.deliveryChannel} onChange={e => set({ deliveryChannel: e.target.value })} className={input}>
                    <option value="">— 選擇頻道 —</option>
                    {CHANNEL_META.map(ch => {
                      const isConfigured = configuredBotChannels.some(c => c.id === ch.id);
                      return (
                        <option key={ch.id} value={ch.id}>
                          {isConfigured ? `✓ ${ch.name}` : ch.name}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className={label}>對象（選填）</label>
                  <select
                    value={draft.deliveryTo || ''}
                    onChange={e => {
                      const val = e.target.value;
                      set({ deliveryTo: val, ...(val ? { deliveryChannel: val } : {}) });
                    }}
                    className={input}
                  >
                    <option value="">不指定（使用頻道預設）</option>
                    {draft.deliveryChannel === 'telegram' && (authorizedRecipients['telegram'] || []).map(id => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                    {draft.deliveryTo && !(authorizedRecipients['telegram'] || []).includes(draft.deliveryTo) && (
                      <option value={draft.deliveryTo}>{draft.deliveryTo}</option>
                    )}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* 觸發訊息 */}
          <div>
            <label className={label}>觸發訊息（Prompt）</label>
            <textarea
              ref={promptRef}
              value={draft.payloadMessage}
              onChange={e => {
                const el = e.target;
                const saved = bodyRef.current?.scrollTop ?? 0;
                el.style.height = 'auto';
                el.style.height = el.scrollHeight + 'px';
                if (bodyRef.current) bodyRef.current.scrollTop = saved;
                set({ payloadMessage: e.target.value });
              }}
              rows={1}
              placeholder="每次觸發時送給 agent 的提示，留空則使用任務預設 prompt"
              className="w-full text-sm px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none overflow-hidden"
              style={{ minHeight: '5rem' }}
              maxLength={2000}
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-slate-300 dark:text-slate-600">{draft.payloadMessage.length}/2000</span>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 dark:border-slate-800 shrink-0">
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-all"
          >
            <X size={13} />取消
          </button>
          <button
            onClick={onSave}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-violet-500 text-white hover:bg-violet-600 transition-all"
          >
            <Save size={13} />儲存
          </button>
        </div>

      </div>
    </div>
  );
}
