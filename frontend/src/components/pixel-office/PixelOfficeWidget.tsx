import { useState, useEffect, useCallback, useMemo } from 'react';
import { Building2, X, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PixelOfficeCanvas from './PixelOfficeCanvas';
import OfficeHUD from './OfficeHUD';
import AgentContextMenu from './AgentContextMenu';
import AgentSettingsDrawer from './AgentSettingsDrawer';
import AddAgentModal from './AddAgentModal';
import ScenePicker from './ScenePicker';
import { usePixelOfficeAgents } from './hooks/usePixelOfficeAgents';
import { useStore } from '../../store';
import { DeleteConfirmDialog } from '../dialogs/DeleteConfirmDialog';

type DrawerTab = 'info' | 'cron' | 'auth';

interface ContextMenuState {
  agentId: string;
  agentName: string;
  x: number;
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

interface PixelOfficeWidgetProps {
  compact?: boolean;
}

const SESSION_REUSE_WINDOW_MS = 5 * 60 * 1000;

export default function PixelOfficeWidget({ compact = false }: PixelOfficeWidgetProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [drawerState, setDrawerState] = useState<DrawerState | null>(null);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [deleteConfirmState, setDeleteConfirmState] = useState<DeleteConfirmState | null>(null);

  const { summaries, refreshAgents } = usePixelOfficeAgents();
  const activeCount = summaries.filter(s => s.snapshotState === 'active').length;

  const { setChatOpen, setActiveChatAgent, setActiveChatSession } = useStore();
  const running = useStore(s => s.running);
  const snapshotHistory = useStore(s => s.snapshotHistory);
  const snapshot = useStore(s => s.snapshot);
  const configAgentList = useStore(s => s.detectedConfig?.agentList);
  const configPath = useStore(s => s.config?.configPath);

  const todayCost = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const fromHistory = snapshotHistory?.find(h => h.dateKey === today)?.estimatedCost;
    if (fromHistory != null) return fromHistory;
    return (snapshot?.sessions ?? []).reduce((acc, s) => acc + (s.cost ?? 0), 0);
  }, [snapshotHistory, snapshot]);

  // Escape to close panel / context menu / drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showAddAgent) { setShowAddAgent(false); return; }
        if (deleteConfirmState) { setDeleteConfirmState(null); return; }
        if (contextMenu) { setContextMenu(null); return; }
        if (drawerState) { setDrawerState(null); return; }
        if (isOpen) setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, contextMenu, drawerState, showAddAgent, deleteConfirmState]);

  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

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
    setIsOpen(false);
  }, [resolveSessionKeyForAgent, setActiveChatAgent, setActiveChatSession, setChatOpen]);

  // ── Agent right-click → context menu ────────────────────────────────────────
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
    setIsOpen(false);
    setContextMenu(null);
  }, [contextMenu, resolveSessionKeyForAgent, setActiveChatAgent, setActiveChatSession, setChatOpen]);

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

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenu) return;
    setDeleteConfirmState({ agentId: contextMenu.agentId, agentName: contextMenu.agentName });
    setContextMenu(null);
  }, [contextMenu]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmState || !configPath) return;
    setDeleteConfirmState(null);
    try {
      await window.electronAPI?.exec('agent:delete', [
        JSON.stringify({ agentId: deleteConfirmState.agentId, configPath }),
      ]);
      refreshAgents();
    } catch (e) {
      console.error('[agent:delete] failed', e);
    }
  }, [deleteConfirmState, configPath, refreshAgents]);

  return (
    <div
      className={`fixed z-[88] flex flex-col items-end gap-2 ${
        compact
          ? 'bottom-[6.75rem] right-2 sm:bottom-[7.25rem] sm:right-3'
          : 'bottom-[4.5rem] right-3 sm:bottom-[5.5rem] sm:right-5'
      }`}
    >
      {/* ── Floating panel ── */}
      {isOpen && (
        <div
          className={`relative mb-2 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-2xl shadow-slate-900/10 backdrop-blur-sm transition-all duration-300 ease-out dark:border-slate-700 dark:bg-slate-950/95 ${
            compact ? 'w-[calc(100vw-1rem)] h-[calc(100vh-9.75rem)]' : 'w-[600px] h-[440px]'
          }`}
        >
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
              <button
                type="button"
                onClick={toggle}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Canvas area */}
          <div className="relative min-h-0 flex-1">
            <PixelOfficeCanvas
              paused={!isOpen}
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
              />
            )}
          </div>

          {/* Settings drawer covers the whole panel */}
          {drawerState && (
            <AgentSettingsDrawer
              agentId={drawerState.agentId}
              summary={summaries.find(s => s.id === drawerState.agentId)}
              agentWorkspace={
                configAgentList?.find(a => a.id === drawerState.agentId)?.workspace
                || summaries.find(s => s.id === drawerState.agentId)?.workspace
              }
              agentDir={
                configAgentList?.find(a => a.id === drawerState.agentId)?.agentDir
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
        </div>
      )}

      {/* ── Floating button ── */}
      <button
        type="button"
        onClick={toggle}
        className={`group relative inline-flex items-center justify-center rounded-2xl border bg-white/95 shadow-2xl transition-all hover:-translate-y-0.5 hover:bg-white dark:bg-slate-900/95 ${
          isOpen
            ? 'border-indigo-400 text-indigo-600 shadow-indigo-500/20 dark:border-indigo-600 dark:text-indigo-300'
            : 'border-indigo-300/70 text-indigo-500 shadow-indigo-500/10 dark:border-indigo-700 dark:text-indigo-400'
        } ${compact ? 'h-12 w-12' : 'h-12 w-12 sm:h-14 sm:w-14'}`}
        title={isOpen ? t('pixelOffice.close') : t('pixelOffice.open')}
        aria-label={isOpen ? t('pixelOffice.close') : t('pixelOffice.open')}
      >
        <Building2 size={22} />
        {activeCount > 0 && !isOpen && (
          <span className="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-green-500 px-0.5 text-[8px] font-black text-white">
            {activeCount}
          </span>
        )}
      </button>
    </div>
  );
}
