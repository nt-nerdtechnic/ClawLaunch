import { useRef, useEffect, useCallback, type RefObject, type MutableRefObject } from 'react';
import type { PixelAgent, RoomConfig } from '../engine/types';
import type { SpriteCache } from '../engine/spriteCache';
import { updateAgent } from '../engine/agent';
import { renderFrame } from '../engine/renderer';

interface UsePixelOfficeLoopParams {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  agentsRef: MutableRefObject<PixelAgent[]>;
  room: RoomConfig;
  cache: SpriteCache | null;
  hoveredAgentId: string | null;
  paused: boolean;
  dark: boolean;
  bgImage: HTMLImageElement | null;
  scaleX?: number;
  scaleY?: number;
  offsetX?: number;
  offsetY?: number;
}

export function usePixelOfficeLoop({
  canvasRef,
  agentsRef,
  room,
  cache,
  hoveredAgentId,
  paused,
  dark,
  bgImage,
  scaleX = 1,
  scaleY = 1,
  offsetX = 0,
  offsetY = 0,
}: UsePixelOfficeLoopParams): void {
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const loopRef = useRef<((time: number) => void) | null>(null);

  const loop = useCallback((time: number) => {
    if (!canvasRef.current || !cache) return;

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const dt = lastTimeRef.current === 0
      ? 16
      : Math.min(time - lastTimeRef.current, 100); // Cap at 100ms
    lastTimeRef.current = time;

    // Update all agents
    for (const agent of agentsRef.current) {
      updateAgent(agent, dt, room);
    }

    // Render
    renderFrame(ctx, room, agentsRef.current, cache, hoveredAgentId, dark, bgImage, scaleX, scaleY, offsetX, offsetY);

    if (loopRef.current) {
      rafRef.current = requestAnimationFrame(loopRef.current);
    }
  }, [canvasRef, agentsRef, room, cache, hoveredAgentId, dark, bgImage, loopRef, scaleX, scaleY, offsetX, offsetY]);

  // Store latest loop in ref to avoid circular dependency (in effect to prevent render-phase update)
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  useEffect(() => {
    if (paused || !cache) {
      lastTimeRef.current = 0;
      return;
    }

    if (loopRef.current) {
      rafRef.current = requestAnimationFrame(loopRef.current);
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      lastTimeRef.current = 0;
    };
  }, [paused, cache]);
}
