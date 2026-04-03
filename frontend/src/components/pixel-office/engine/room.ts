import type { RoomConfig, Furniture, DeskSlot, DeskSlotsConfig } from './types';
import { CANVAS_TILES_W, CANVAS_TILES_H, TILE_SIZE, FURNITURE_SCALE } from './constants';

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeWalkableGrid(W: number, H: number): boolean[][] {
  const grid: boolean[][] = [];
  for (let y = 0; y < H; y++) {
    grid[y] = [];
    for (let x = 0; x < W; x++) {
      const isWall = y < 2 || y >= H - 1 || x < 1 || x >= W - 1;
      grid[y][x] = !isWall;
    }
  }
  return grid;
}

function addDesk(
  tileX: number,
  tileY: number,
  furniture: Furniture[],
  deskSlots: DeskSlot[],
  walkable: boolean[][],
  W: number,
): void {
  furniture.push({ type: 'desk', tileX, tileY, width: 2, height: 1 });
  walkable[tileY][tileX] = false;
  if (tileX + 1 < W) walkable[tileY][tileX + 1] = false;

  const chairTileY = tileY + 1;
  furniture.push({ type: 'chair', tileX, tileY: chairTileY, width: 1, height: 1 });

  deskSlots.push({
    deskTile:  { x: tileX, y: tileY },
    seatTile:  { x: tileX, y: chairTileY },
    seatPixel: { x: tileX * TILE_SIZE + 14 * FURNITURE_SCALE, y: chairTileY * TILE_SIZE + 1 },
  });
}

// ─── Room layouts ─────────────────────────────────────────────────────────────

/** Main Hall — 6 desks, 3 rows × 2 cols, 30×20 tiles. */
export function createMainHall(): RoomConfig {
  const W = CANVAS_TILES_W;
  const H = CANVAS_TILES_H;
  const walkable = makeWalkableGrid(W, H);
  const furniture: Furniture[] = [];
  const deskSlots: DeskSlot[] = [];

  // Bookshelves along back wall
  for (const bx of [8, 18]) {
    furniture.push({ type: 'bookshelf', tileX: bx, tileY: 2, width: 1, height: 2 });
    walkable[2][bx] = false;
    walkable[3][bx] = false;
  }

  // 3 rows × 2 desks
  for (const pos of [
    { dx: 3,  dy: 4  }, { dx: 16, dy: 4  },
    { dx: 3,  dy: 8  }, { dx: 16, dy: 8  },
    { dx: 3,  dy: 12 }, { dx: 16, dy: 12 },
  ]) {
    addDesk(pos.dx, pos.dy, furniture, deskSlots, walkable, W);
  }

  // Server racks
  furniture.push({ type: 'server', tileX: 26, tileY: 3, width: 1, height: 2 });
  walkable[3][26] = false; walkable[4][26] = false;
  furniture.push({ type: 'server', tileX: 28, tileY: 3, width: 1, height: 2 });
  walkable[3][28] = false; walkable[4][28] = false;

  // Plants
  for (const p of [{ x: 2, y: 2 }, { x: 27, y: 2 }, { x: 2, y: 17 }, { x: 27, y: 17 }, { x: 13, y: 6 }]) {
    furniture.push({ type: 'plant', tileX: p.x, tileY: p.y, width: 1, height: 1 });
    walkable[p.y][p.x] = false;
  }

  return { widthTiles: W, heightTiles: H, walkable, furniture, deskSlots, spawnPoint: { x: 10 * TILE_SIZE, y: 16 * TILE_SIZE }, renderTheme: 'office' };
}

/** Small Room — 4 desks in a 2×2 grid, intimate layout, 30×20 tiles. */
export function createSmallRoom(): RoomConfig {
  const W = CANVAS_TILES_W;
  const H = CANVAS_TILES_H;
  const walkable = makeWalkableGrid(W, H);
  const furniture: Furniture[] = [];
  const deskSlots: DeskSlot[] = [];

  // Whiteboard on back wall
  furniture.push({ type: 'whiteboard', tileX: 12, tileY: 2, width: 2, height: 1 });
  walkable[2][12] = false; walkable[2][13] = false;

  // 2×2 desk cluster centred in room
  for (const pos of [
    { dx: 5,  dy: 6 }, { dx: 18, dy: 6 },
    { dx: 5,  dy: 12 }, { dx: 18, dy: 12 },
  ]) {
    addDesk(pos.dx, pos.dy, furniture, deskSlots, walkable, W);
  }

  // One server rack
  furniture.push({ type: 'server', tileX: 27, tileY: 10, width: 1, height: 2 });
  walkable[10][27] = false; walkable[11][27] = false;

  // Plants at corners
  for (const p of [{ x: 2, y: 2 }, { x: 27, y: 2 }, { x: 2, y: 17 }, { x: 27, y: 17 }]) {
    furniture.push({ type: 'plant', tileX: p.x, tileY: p.y, width: 1, height: 1 });
    walkable[p.y][p.x] = false;
  }

  return { widthTiles: W, heightTiles: H, walkable, furniture, deskSlots, spawnPoint: { x: 14 * TILE_SIZE, y: 17 * TILE_SIZE }, renderTheme: 'serverRoom' };
}

/** Open Plan — 12 desks in a 4 rows × 3 cols open-floor layout, 30×20 tiles. */
export function createOpenPlan(): RoomConfig {
  const W = CANVAS_TILES_W;
  const H = CANVAS_TILES_H;
  const walkable = makeWalkableGrid(W, H);
  const furniture: Furniture[] = [];
  const deskSlots: DeskSlot[] = [];

  // Bookshelves across back wall
  for (const bx of [5, 13, 21]) {
    furniture.push({ type: 'bookshelf', tileX: bx, tileY: 2, width: 1, height: 2 });
    walkable[2][bx] = false; walkable[3][bx] = false;
  }

  // 4 rows × 3 desks (cols at x=2, 11, 20; rows at y=4,7,10,13)
  for (const dy of [4, 7, 10, 13]) {
    for (const dx of [2, 11, 20]) {
      addDesk(dx, dy, furniture, deskSlots, walkable, W);
    }
  }

  // Server racks right side
  furniture.push({ type: 'server', tileX: 27, tileY: 3, width: 1, height: 2 });
  walkable[3][27] = false; walkable[4][27] = false;
  furniture.push({ type: 'server', tileX: 27, tileY: 8, width: 1, height: 2 });
  walkable[8][27] = false; walkable[9][27] = false;

  // Plants scattered
  for (const p of [{ x: 2, y: 2 }, { x: 28, y: 2 }, { x: 2, y: 17 }, { x: 28, y: 17 }]) {
    furniture.push({ type: 'plant', tileX: p.x, tileY: p.y, width: 1, height: 1 });
    walkable[p.y][p.x] = false;
  }

  return { widthTiles: W, heightTiles: H, walkable, furniture, deskSlots, spawnPoint: { x: 15 * TILE_SIZE, y: 17 * TILE_SIZE }, renderTheme: 'cafe' };
}

/** Override desk slots from an external config object. */
export function applyDeskSlotsConfig(room: RoomConfig, config: DeskSlotsConfig): RoomConfig {
  if (!config?.slots || config.slots.length === 0) return room;

  const newSlots: DeskSlot[] = [];
  for (const slot of config.slots) {
    if (typeof slot.id === 'number' && typeof slot.x === 'number' && typeof slot.y === 'number') {
      const seatPixel = { x: slot.x, y: slot.y };
      const seatTile = {
        x: Math.floor(seatPixel.x / TILE_SIZE),
        y: Math.floor(seatPixel.y / TILE_SIZE),
      };
      newSlots.push({
        deskTile: seatTile,
        seatTile,
        seatPixel,
      });
    }
  }

  if (newSlots.length > 0) {
    return {
      ...room,
      deskSlots: newSlots,
    };
  }

  return room;
}
