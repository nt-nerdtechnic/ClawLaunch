import type { SpriteData } from './types';
import { AGENT_SPRITES, resolveSprite, agentThemeFromColor, FURNITURE_DESK, FURNITURE_CHAIR, FURNITURE_PLANT, FURNITURE_SERVER, FURNITURE_BOOKSHELF } from './sprites';

export type SpriteCache = Map<string, HTMLCanvasElement>;

/** Build the full sprite cache: all agent color variants + all furniture. */
export function buildSpriteCache(agentColors: string[]): SpriteCache {
  const cache: SpriteCache = new Map();

  // Cache agent sprites for each color
  for (const color of agentColors) {
    const theme = agentThemeFromColor(color);
    const states = ['idle', 'walk', 'type'] as const;
    for (const state of states) {
      const frames = AGENT_SPRITES[state];
      for (let i = 0; i < frames.length; i++) {
        const resolved = resolveSprite(frames[i], theme);
        const key = `agent-${state}-${i}-${color}`;
        cache.set(key, rasterize(resolved));
      }
    }
  }

  // Cache furniture sprites
  cache.set('furniture-desk', rasterize(FURNITURE_DESK));
  cache.set('furniture-chair', rasterize(FURNITURE_CHAIR));
  cache.set('furniture-plant', rasterize(FURNITURE_PLANT));
  cache.set('furniture-server', rasterize(FURNITURE_SERVER));
  cache.set('furniture-bookshelf', rasterize(FURNITURE_BOOKSHELF));

  return cache;
}

/** Get a cached sprite canvas by key. */
export function getCachedSprite(cache: SpriteCache, key: string): HTMLCanvasElement | undefined {
  return cache.get(key);
}

/** Rasterize a SpriteData into an offscreen canvas (1:1 pixel scale). */
function rasterize(sprite: SpriteData): HTMLCanvasElement {
  const h = sprite.length;
  const w = h > 0 ? sprite[0].length : 0;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = sprite[y][x];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  return canvas;
}
