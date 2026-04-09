import { useState, useEffect, useCallback, useMemo } from 'react';
import { Building2, X, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PixelOfficeCanvas from './PixelOfficeCanvas';
import OfficeHUD from './OfficeHUD';
import AgentContextMenu from './AgentContextMenu';
import AgentSettingsDrawer, { type DrawerTab } from './AgentSettingsDrawer';
import AddAgentModal from './AddAgentModal';
import ScenePicker from './ScenePicker';
import { usePixelOfficeAgents } from './hooks/usePixelOfficeAgents';
import { useStore } from '../../store';
import { DeleteConfirmDialog } from '../dialogs/DeleteConfirmDialog';

const SESSION_REUSE_WINDOW_MS = 5 * 60 * 1000;

interface ContextMenuState {
  agentId: string;
  agentName: string;
  /** 0–1 fraction of canvas width */
  x: number;
  /** 0–1 fraction of canvas height */
  y: number;
}

interface DrawerState {
  agentId: string;
  initialTab: DrawerTab;
}

interface DeleteConfirmState {
  agentId: string;
  agentName: string;
}

interface RenameState {
  agentId: string;
  currentName: string;
  inputValue: string;
}

interface PixelOfficePanelProps {
  restartGateway?: () => Promise<void>;
  /** Called when the panel should close itself (widget usage). Omit for page usage. */
  onClose?: () => void;
  className?: string;
}

export default function PixelOfficePanel({ restartGateway, onClose, className = '' }: PixelOfficePanelProps) {
  const { t } = useTranslation();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [drawerState, setDrawerState] = useState<DrawerState | null>(null);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [deleteConfirmState, setDeleteConfirmState] = useState<DeleteConfirmState | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);

  const { summaries, refreshAgents } = usePixelOfficeAgents();
  const activeCount = summaries.filter(s => s.snapshotState === 'active').length;

  const { setChatOpen, setActiveChatAgent, setActiveChatSession, setDetectedConfig, setSnapshot } = useStore();
  const running = useStore(s => s.running);
  const snapshotHistory = useStore(s => s.snapshotHistory);
  const snapshot = useStore(s => s.snapshot);
  const detectedConfig = useStore(s => s.detectedConfig);
  const configPath = useStore(s => s.config?.configPath);
  const corePath = useStore(s => s.config?.corePath);

  const todayCost = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const fromHistory = snapshotHistory?.find(h => h.dateKey === today)?.estimatedCost;
    if (fromHistory != null) return fromHistory;
    return (snapshot?.sessions ?? []).reduce((acc, s) => acc + (s.cost ?? 0), 0);
  }, [snapshotHistory, snapshot]);

  // Escape key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAddAgent) { setShowAddAgent(false); return; }
        if (deleteConfirmState) { setDeleteConfirmState(null); return; }
        if (renameState) { setRenameState(null); return; }
        if (contextMenu) { setContextMenu(null); return; }
        if (drawerState) { setDrawerState(null); return; }
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu, drawerState, showAddAgent, deleteConfirmState, renameState, onClose]);

  // ── Agent click (left) → open chat ──────────────────────────────────────────
  const buildSessionKeyForAgent = useCallback((agentId: string) => {
    return `agent:${agentId}:local:${crypto.randomUUID()}`;
  }, []);

  const resolveSessionKeyForAgent = useCallback(async (agentId: string) => {
    try {
      if (!window.electronAPI?.listChatSessions) {
        return buildSessionKeyForAgent(agentId);
      }
      const res = await window.electronAPI.listChatSessions({ limit: 50, offset: 0 });
      if (res.code !== 0) return buildSessionKeyForAgent(agentId);
      const parsed = JSON.parse(res.stdout || '{}') as {
        sessions?: Array<{ sessionKey: string; agentId: string; lastTimestamp: string }>;
      };
      const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
      const now = Date.now();
      const reusable = sessions.find((s) => {
        if ((s.agentId || '').trim() !== agentId) return false;
        const lastTs = Date.parse(s.lastTimestamp || '');
        if (!Number.isFinite(lastTs)) return false;
        return now - lastTs <= SESSION_REUSE_WINDOW_MS;
      });
      const key = (reusable?.sessionKey || '').trim();
      return key || buildSessionKeyForAgent(agentId);
    } catch {
      return buildSessionKeyForAgent(agentId);
    }
  }, [buildSessionKeyForAgent]);

  const handleAgentClick = useCallback(async (agentId: string) => {
    const targetSessionKey = await resolveSessionKeyForAgent(agentId);
    setActiveChatAgent(agentId);
    setActiveChatSession(targetSessionKey);
    setChatOpen(true);
    onClose?.();
  }, [resolveSessionKeyForAgent, setActiveChatAgent, setActiveChatSession, setChatOpen, onClose]);

  // ── Agent right-click → context menu ────────────────────────────────────────
  // x/y from canvas are already 0-1 fractions of the container (relX/width, relY/height).
  const handleAgentContextMenu = useCallback(
    (agentId: string, agentName: string, x: number, y: number) => {
      setContextMenu({ agentId, agentName, x, y });
    }, []);

  // ── Context menu actions ────────────────────────────────────────────────────
  const handleContextMenuChat = useCallback(async () => {
    if (!contextMenu) return;
    const targetSessionKey = await resolveSessionKeyForAgent(contextMenu.agentId);
    setActiveChatAgent(contextMenu.agentId);
    setActiveChatSession(targetSessionKey);
    setChatOpen(true);
    onClose?.();
    setContextMenu(null);
  }, [contextMenu, resolveSessionKeyForAgent, setActiveChatAgent, setActiveChatSession, setChatOpen, onClose]);

  const handleContextMenuSettings = useCallback((tab: DrawerTab) => {
    if (!contextMenu) return;
    setDrawerState({ agentId: contextMenu.agentId, initialTab: tab });
    setContextMenu(null);
  }, [contextMenu]);

  const handleContextMenuStopAll = useCallback(async () => {
    if (!contextMenu) return;
    const agentId = contextMenu.agentId;
    setContextMenu(null);
    if (!window.electronAPI?.abortSession) return;
    const sessions = snapshot?.sessions?.filter(s => s.agentId === agentId) ?? [];
    for (const s of sessions) {
      await window.electronAPI.abortSession({ sessionKey: s.sessionKey, agentId });
    }
  }, [contextMenu, snapshot]);

  const handleContextMenuRename = useCallback(() => {
    if (!contextMenu) return;
    setRenameState({ agentId: contextMenu.agentId, currentName: contextMenu.agentName, inputValue: contextMenu.agentName });
    setContextMenu(null);
  }, [contextMenu]);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameState || !configPath || !corePath || !renameState.inputValue.trim()) return;
    try {
      const res = await window.electronAPI?.exec(`agent:set-name ${JSON.stringify({
        agentId: renameState.agentId,
        name: renameState.inputValue.trim(),
        configPath,
        corePath,
      })}`);
      if (!res || (res.exitCode !== 0 && res.code !== 0)) {
        console.error('[agent:set-name] failed', res?.stderr);
        return;
      }
      setRenameState(null);
      refreshAgents();
    } catch (e) {
      console.error('[agent:set-name] failed', e);
    }
  }, [renameState, configPath, corePath, refreshAgents]);

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenu) return;
    setDeleteConfirmState({ agentId: contextMenu.agentId, agentName: contextMenu.agentName });
    setContextMenu(null);
  }, [contextMenu]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmState || !configPath) return;
    const { agentId } = deleteConfirmState;
    setDeleteConfirmState(null);
    try {
      await window.electronAPI?.exec('agent:delete', [
        JSON.stringify({ agentId, configPath }),
      ]);
      if (detectedConfig) {
        setDetectedConfig({
          ...detectedConfig,
          agentList: (detectedConfig.agentList ?? []).filter(a => a.id !== agentId),
        });
      }
      if (snapshot) {
        setSnapshot({
          ...snapshot,
          sessions: snapshot.sessions.filter(s => s.agentId !== agentId),
          statuses: snapshot.statuses?.filter(s =>
            !snapshot.sessions.some(sess => sess.agentId === agentId && sess.sessionKey === s.sessionKey)
          ) ?? [],
        });
      }
      refreshAgents();
    } catch (e) {
      console.error('[agent:delete] failed', e);
    }
  }, [deleteConfirmState, configPath, detectedConfig, setDetectedConfig, snapshot, setSnapshot, refreshAgents]);

  return (
    <div className={`relative flex flex-col w-full h-full overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-gradient-to-r from-indigo-50/80 via-white to-white px-3 py-2 dark:border-slate-800 dark:from-slate-900 dark:via-slate-950 dark:to-slate-950">
        <div className="flex items-center gap-1.5">
          <div className="rounded-lg bg-indigo-500/10 p-1 text-indigo-600 dark:text-indigo-300">
            <Building2 size={13} />
          </div>
          <span className="text-[11px] font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
            {t('pixelOffice.title')}
          </span>
          {summaries.length > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-bold text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-300">
              <Users size={8} />
              {summaries.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <ScenePicker />
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Canvas area */}
      <div className="relative min-h-0 flex-1">
        <PixelOfficeCanvas
          paused={false}
          onAgentClick={(agentId) => { void handleAgentClick(agentId); }}
          onAgentContextMenu={handleAgentContextMenu}
        />

        <OfficeHUD
          running={running}
          activeCount={activeCount}
          totalCount={summaries.length}
          todayCost={todayCost}
          onAddAgent={() => setShowAddAgent(true)}
        />

        {contextMenu && (
          <AgentContextMenu
            agentId={contextMenu.agentId}
            agentName={contextMenu.agentName}
            x={contextMenu.x}
            y={contextMenu.y}
            isActive={summaries.find(s => s.id === contextMenu.agentId)?.snapshotState === 'active'}
            onChat={() => { void handleContextMenuChat(); }}
            onStopAll={() => void handleContextMenuStopAll()}
            onSettings={handleContextMenuSettings}
            onRename={handleContextMenuRename}
            onDelete={handleContextMenuDelete}
            onClose={() => setContextMenu(null)}
          />
        )}

        {showAddAgent && (
          <AddAgentModal
            onClose={() => setShowAddAgent(false)}
            onCreated={() => {
              refreshAgents();
              setShowAddAgent(false);
            }}
            restartGateway={restartGateway}
          />
        )}
      </div>

      {/* Settings drawer covers the whole panel */}
      {drawerState && (
        <AgentSettingsDrawer
          agentId={drawerState.agentId}
          summary={summaries.find(s => s.id === drawerState.agentId)}
          agentWorkspace={
            detectedConfig?.agentList?.find(a => a.id === drawerState.agentId)?.workspace
            || summaries.find(s => s.id === drawerState.agentId)?.workspace
          }
          agentDir={
            detectedConfig?.agentList?.find(a => a.id === drawerState.agentId)?.agentDir
            || summaries.find(s => s.id === drawerState.agentId)?.agentDir
          }
          initialTab={drawerState.initialTab}
          onClose={() => setDrawerState(null)}
        />
      )}

      <DeleteConfirmDialog
        open={deleteConfirmState !== null}
        itemName={deleteConfirmState?.agentName ?? ''}
        onClose={() => setDeleteConfirmState(null)}
        onConfirm={() => { void handleDeleteConfirm(); }}
        t={t}
      />

      {renameState && (
        <div className="absolute inset-0 z-40 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setRenameState(null)} />
          <div className="relative z-10 w-[280px] rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950 p-4 space-y-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">{t('pixelOffice.rename.title', '重新命名 Agent')}</p>
            <input
              type="text"
              autoFocus
              value={renameState.inputValue}
              onChange={e => setRenameState(prev => prev ? { ...prev, inputValue: e.target.value } : null)}
              onKeyDown={e => { if (e.key === 'Enter') void handleRenameConfirm(); if (e.key === 'Escape') setRenameState(null); }}
              placeholder={renameState.currentName}
              maxLength={40}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-[12px] text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-400"
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setRenameState(null)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">{t('common.cancel', '取消')}</button>
              <button type="button" onClick={() => void handleRenameConfirm()} disabled={!renameState.inputValue.trim()} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors">{t('common.confirm', '確認')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
