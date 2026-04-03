import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { PixelAgent, RoomConfig } from './engine/types';
import { CANVAS_W, CANVAS_H, AGENT_COLORS, SPRITE_DRAW_W, SPRITE_DRAW_H } from './engine/constants';
import { buildSpriteCache, type SpriteCache } from './engine/spriteCache';
import { createMainHall, applyDeskSlotsConfig } from './engine/room';
import { applyNavMaskToRoom } from './engine/navmask';
import type { DeskSlotsConfig } from './engine/types';
import { getScene } from './engine/scenes';
import { createAgent, syncAgentWithSnapshot } from './engine/agent';
import { hitTestAgent } from './engine/tooltip';
import { usePixelOfficeAgents, type PixelAgentSummary } from './hooks/usePixelOfficeAgents';
import { usePixelOfficeLoop } from './hooks/usePixelOfficeLoop';
import { useStore } from '../../store';
import { useTranslation } from 'react-i18next';

interface PixelOfficeCanvasProps {
  paused: boolean;
  onAgentClick?: (agentId: string, displayName: string) => void;
  onAgentContextMenu?: (agentId: string, displayName: string, relX: number, relY: number) => void;
}

export default function PixelOfficeCanvas({ paused, onAgentClick, onAgentContextMenu }: PixelOfficeCanvasProps) {
  const { t } = useTranslation();
  const theme = useStore(s => s.theme);
  const dark = theme === 'dark';
  const officeSceneId = useStore(s => s.officeSceneId);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsRef = useRef<PixelAgent[]>([]);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [tooltipData, setTooltipData] = useState<{ x: number; y: number; agent: PixelAgentSummary } | null>(null);

  // Load scene assets dynamically based on the selected scene
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [navMaskImage, setNavMaskImage] = useState<HTMLImageElement | null>(null);
  const [deskSlotsConfig, setDeskSlotsConfig] = useState<DeskSlotsConfig | null>(null);

  useEffect(() => {
    const scene = getScene(officeSceneId);
    if (!scene.bg) { setBgImage(null); return; }
    const img = new Image();
    img.onload = () => setBgImage(img);
    img.onerror = () => setBgImage(null);
    img.src = scene.bg;
  }, [officeSceneId]);

  useEffect(() => {
    const scene = getScene(officeSceneId);
    if (!scene.navmask) { setNavMaskImage(null); return; }
    const img = new Image();
    img.onload = () => setNavMaskImage(img);
    img.onerror = () => setNavMaskImage(null);
    img.src = scene.navmask;
  }, [officeSceneId]);

  useEffect(() => {
    const scene = getScene(officeSceneId);
    if (!scene.deskslots) { setDeskSlotsConfig(null); return; }
    fetch(scene.deskslots)
      .then(res => res.json())
      .then(data => setDeskSlotsConfig(data))
      .catch(() => setDeskSlotsConfig(null));
  }, [officeSceneId]);

  // Build room (stable singleton)
  const room = useMemo<RoomConfig>(() => {
    let baseRoom = createMainHall();
    if (deskSlotsConfig) {
      baseRoom = applyDeskSlotsConfig(baseRoom, deskSlotsConfig);
    }
    if (!navMaskImage) return baseRoom;
    return applyNavMaskToRoom(baseRoom, navMaskImage, {
      walkableMinAlpha: 32,
      inflateBlockedTiles: 1,
    });
  }, [navMaskImage, deskSlotsConfig]);

  // Build sprite cache (stable singleton)
  const cache = useMemo<SpriteCache>(() => buildSpriteCache(AGENT_COLORS), []);

  // Get agent summaries from snapshot
  const { summaries } = usePixelOfficeAgents();

  // Sync pixel agents with snapshot summaries
  useEffect(() => {
    const existing = agentsRef.current;
    const existingMap = new Map(existing.map(a => [a.id, a]));
    const newAgents: PixelAgent[] = [];

    for (const summary of summaries) {
      const agent = existingMap.get(summary.id);
      if (agent) {
        // Update existing agent
        agent.displayName = summary.displayName;
        agent.model = summary.model;
        agent.tokensIn = summary.tokensIn;
        agent.tokensOut = summary.tokensOut;
        agent.cost = summary.cost;
        agent.sessionCount = summary.sessionCount;
        syncAgentWithSnapshot(agent, summary.snapshotState, room);
        newAgents.push(agent);
      } else {
        // Create new agent
        const deskIdx = summary.id ? (summaries.indexOf(summary) % room.deskSlots.length) : 0;
        const agent = createAgent(
          summary.id,
          summary.displayName,
          summary.color,
          deskIdx,
          room.spawnPoint,
          summary.snapshotState,
        );
        agent.model = summary.model;
        agent.tokensIn = summary.tokensIn;
        agent.tokensOut = summary.tokensOut;
        agent.cost = summary.cost;
        agent.sessionCount = summary.sessionCount;
        newAgents.push(agent);
      }
    }

    agentsRef.current = newAgents;
  }, [summaries, room]);

  // Run game loop
  usePixelOfficeLoop({
    canvasRef,
    agentsRef,
    room,
    cache,
    hoveredAgentId,
    paused,
    dark,
    bgImage,
  });

  // Mouse hover handler
  const handleMouseMove = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;

    const hit = hitTestAgent(cx, cy, agentsRef.current, SPRITE_DRAW_W, SPRITE_DRAW_H);
    setHoveredAgentId(hit?.id ?? null);

    if (hit) {
      const summary = summaries.find(s => s.id === hit.id);
      if (summary) {
        setTooltipData({
          x: e.clientX - (canvasRef.current?.getBoundingClientRect().left ?? 0),
          y: e.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0),
          agent: summary,
        });
      }
    } else {
      setTooltipData(null);
    }
  }, [summaries]);

  const handleMouseLeave = useCallback(() => {
    setHoveredAgentId(null);
    setTooltipData(null);
  }, []);

  const handleClick = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!onAgentClick) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const hit = hitTestAgent(cx, cy, agentsRef.current, SPRITE_DRAW_W, SPRITE_DRAW_H);
    if (hit) {
      const summary = summaries.find(s => s.id === hit.id);
      onAgentClick(hit.id, summary?.displayName ?? hit.id);
    }
  }, [summaries, onAgentClick]);

  const handleContextMenu = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!onAgentContextMenu) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    const hit = hitTestAgent(cx, cy, agentsRef.current, SPRITE_DRAW_W, SPRITE_DRAW_H);
    if (hit) {
      const summary = summaries.find(s => s.id === hit.id);
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      onAgentContextMenu(hit.id, summary?.displayName ?? hit.id, relX, relY);
    }
  }, [summaries, onAgentContextMenu]);

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="w-full h-full"
        style={{ imageRendering: 'pixelated', cursor: hoveredAgentId ? 'pointer' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />

      {/* Tooltip overlay */}
      {tooltipData && (
        <div
          className="absolute pointer-events-none z-10 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm dark:border-slate-700 dark:bg-slate-900/95"
          style={{
            left: Math.min(tooltipData.x + 12, CANVAS_W - 140),
            top: Math.max(tooltipData.y - 60, 4),
          }}
        >
          <div className="text-[10px] font-bold text-slate-800 dark:text-slate-100">
            {tooltipData.agent.displayName}
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${
              tooltipData.agent.snapshotState === 'active' ? 'bg-green-500' : 'bg-slate-400'
            }`} />
            <span className="text-[9px] text-slate-500 dark:text-slate-400">
              {tooltipData.agent.snapshotState === 'active' ? t('pixelOffice.agentWorking') : t('pixelOffice.agentIdle')}
            </span>
          </div>
          {tooltipData.agent.model && (
            <div className="mt-0.5 text-[8px] font-mono text-slate-400 dark:text-slate-500">
              {tooltipData.agent.model}
            </div>
          )}
          <div className="mt-0.5 text-[8px] text-slate-400 dark:text-slate-500">
            {t('pixelOffice.sessions')}: {tooltipData.agent.sessionCount}
            {tooltipData.agent.cost > 0 && ` · $${tooltipData.agent.cost.toFixed(4)}`}
          </div>
          {(onAgentClick || onAgentContextMenu) && (
            <div className="mt-1 text-[8px] font-medium text-sky-500 dark:text-sky-400">
              {t('pixelOffice.clickToChat', '點擊對話 · 右鍵管理')}
            </div>
          )}
        </div>
      )}

      {/* No agents message */}
      {summaries.length === 0 && !paused && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl bg-white/80 px-4 py-3 text-center shadow-sm dark:bg-slate-900/80">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {t('pixelOffice.noAgents')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
