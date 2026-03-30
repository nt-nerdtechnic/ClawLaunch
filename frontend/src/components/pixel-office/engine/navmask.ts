import type { RoomConfig, Vec2 } from './types';
import { TILE_SIZE } from './constants';

interface NavMaskOptions {
  walkableMinAlpha?: number;
  inflateBlockedTiles?: number;
}

function isWalkableMaskPixel(r: number, g: number, b: number, a: number, minAlpha: number): boolean {
  if (a < minAlpha) return false;

  // Supported walkable colors in mask:
  // 1) Green lanes (#00FF00-ish)
  // 2) White zones (#FFFFFF-ish)
  const isGreenLane = g >= 170 && r <= 150 && b <= 150;
  const isWhiteZone = r >= 220 && g >= 220 && b >= 220;
  return isGreenLane || isWhiteZone;
}

function sampleMaskWalkable(
  imageData: ImageData,
  tileX: number,
  tileY: number,
  tilesW: number,
  tilesH: number,
  minAlpha: number,
): boolean {
  const { width, height, data } = imageData;
  const samplePoints = [
    [0.5, 0.5],
    [0.25, 0.5],
    [0.75, 0.5],
    [0.5, 0.25],
    [0.5, 0.75],
  ] as const;

  let walkableVotes = 0;
  for (const [ox, oy] of samplePoints) {
    const u = (tileX + ox) / tilesW;
    const v = (tileY + oy) / tilesH;
    const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
    const idx = (py * width + px) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];
    if (isWalkableMaskPixel(r, g, b, a, minAlpha)) {
      walkableVotes += 1;
    }
  }

  // Majority vote avoids tiny aliasing noise.
  return walkableVotes >= 3;
}

function inflateBlocked(grid: boolean[][], radiusTiles: number): boolean[][] {
  if (radiusTiles <= 0) return grid;
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  const out = grid.map((row) => row.slice());

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x]) continue;
      for (let dy = -radiusTiles; dy <= radiusTiles; dy++) {
        for (let dx = -radiusTiles; dx <= radiusTiles; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          out[ny][nx] = false;
        }
      }
    }
  }

  return out;
}

function ensureCriticalPointsWalkable(room: RoomConfig, walkable: boolean[][]): void {
  const keepWalkable = (tile: Vec2) => {
    if (tile.y < 0 || tile.y >= room.heightTiles || tile.x < 0 || tile.x >= room.widthTiles) return;
    walkable[tile.y][tile.x] = true;
  };

  keepWalkable({
    x: Math.floor(room.spawnPoint.x / TILE_SIZE),
    y: Math.floor(room.spawnPoint.y / TILE_SIZE),
  });

  for (const slot of room.deskSlots) {
    keepWalkable(slot.seatTile);
  }
}

export function applyNavMaskToRoom(room: RoomConfig, maskImage: HTMLImageElement, options: NavMaskOptions = {}): RoomConfig {
  const walkableMinAlpha = options.walkableMinAlpha ?? 32;
  const inflateBlockedTiles = options.inflateBlockedTiles ?? 1;

  const canvas = document.createElement('canvas');
  canvas.width = maskImage.naturalWidth || maskImage.width;
  canvas.height = maskImage.naturalHeight || maskImage.height;
  if (canvas.width <= 0 || canvas.height <= 0) return room;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return room;

  ctx.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const nextWalkable: boolean[][] = [];
  for (let y = 0; y < room.heightTiles; y++) {
    nextWalkable[y] = [];
    for (let x = 0; x < room.widthTiles; x++) {
      // Keep a hard border so agents never clip outside the room frame.
      const isRoomBorder = y < 2 || y >= room.heightTiles - 1 || x < 1 || x >= room.widthTiles - 1;
      if (isRoomBorder) {
        nextWalkable[y][x] = false;
        continue;
      }

      nextWalkable[y][x] = sampleMaskWalkable(
        imageData,
        x,
        y,
        room.widthTiles,
        room.heightTiles,
        walkableMinAlpha,
      );
    }
  }

  const withPadding = inflateBlocked(nextWalkable, inflateBlockedTiles);
  ensureCriticalPointsWalkable(room, withPadding);

  return {
    ...room,
    walkable: withPadding,
  };
}
