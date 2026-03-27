import type { RoomConfig, Furniture, DeskSlot } from './types';
import { CANVAS_TILES_W, CANVAS_TILES_H, TILE_SIZE, FURNITURE_SCALE } from './constants';

/** Create the main hall room layout (30x20 tiles). */
export function createMainHall(): RoomConfig {
  const W = CANVAS_TILES_W; // 30
  const H = CANVAS_TILES_H; // 20

  // Initialize walkable grid: true = walkable, false = wall/furniture
  const walkable: boolean[][] = [];
  for (let y = 0; y < H; y++) {
    walkable[y] = [];
    for (let x = 0; x < W; x++) {
      // Walls: top 2 rows, bottom 1 row, left 1 col, right 1 col
      const isWall = y < 2 || y >= H - 1 || x < 1 || x >= W - 1;
      walkable[y][x] = !isWall;
    }
  }

  const furniture: Furniture[] = [];
  const deskSlots: DeskSlot[] = [];

  // ─── Bookshelves along back wall ───
  // 16×20px sprites placed at top of room (tileY=2 = first walkable row)
  const bookshelfPositions = [8, 18];
  for (const bx of bookshelfPositions) {
    furniture.push({ type: 'bookshelf', tileX: bx, tileY: 2, width: 1, height: 2 });
    walkable[2][bx] = false;
    walkable[3][bx] = false;
  }

  // ─── Desk cluster: 3 rows of 2 desks ───
  // Desk sprite is 28×14px (≈1.75 tiles wide), so each desk blocks 2 tile columns.
  // Row 1: desk left-edge at tiles (3,4)  and (16,4)
  // Row 2: desk left-edge at tiles (3,8)  and (16,8)
  // Row 3: desk left-edge at tiles (3,12) and (16,12)
  const deskPositions = [
    { dx: 3,  dy: 4  },
    { dx: 16, dy: 4  },
    { dx: 3,  dy: 8  },
    { dx: 16, dy: 8  },
    { dx: 3,  dy: 12 },
    { dx: 16, dy: 12 },
  ];

  for (const pos of deskPositions) {
    // Desk occupies 2 tile columns (28px sprite)
    furniture.push({ type: 'desk', tileX: pos.dx, tileY: pos.dy, width: 2, height: 1 });
    walkable[pos.dy][pos.dx] = false;
    if (pos.dx + 1 < W) walkable[pos.dy][pos.dx + 1] = false;

    // Chair below desk — slightly offset to center under 28px desk
    // Chair sprite is 16px wide; desk center is at pos.dx*TILE_SIZE+14
    // chair tileX chosen so chair center (~pos.dx+0.375) ≈ desk center
    const chairTileX = pos.dx;
    const chairTileY = pos.dy + 1;
    furniture.push({ type: 'chair', tileX: chairTileX, tileY: chairTileY, width: 1, height: 1 });

    // Seat pixel: desk renders 28×FURNITURE_SCALE px wide; center is at +14*FURNITURE_SCALE
    deskSlots.push({
      deskTile:  { x: pos.dx,                                       y: pos.dy     },
      seatTile:  { x: pos.dx,                                       y: chairTileY },
      seatPixel: { x: pos.dx * TILE_SIZE + 14 * FURNITURE_SCALE,   y: (pos.dy + 1) * TILE_SIZE + 1 },
    });
  }

  // ─── Server racks at right side ───
  // Server sprite is 16×24px (1.5 tiles tall), use height:2 for Z-sort
  furniture.push({ type: 'server', tileX: 26, tileY: 3, width: 1, height: 2 });
  walkable[3][26] = false;
  walkable[4][26] = false;
  furniture.push({ type: 'server', tileX: 28, tileY: 3, width: 1, height: 2 });
  walkable[3][28] = false;
  walkable[4][28] = false;

  // ─── Plants for decoration ───
  const plantPositions = [
    { x: 2,  y: 2  },
    { x: 27, y: 2  },
    { x: 2,  y: 17 },
    { x: 27, y: 17 },
    { x: 13, y: 6  },
  ];
  for (const p of plantPositions) {
    furniture.push({ type: 'plant', tileX: p.x, tileY: p.y, width: 1, height: 1 });
    walkable[p.y][p.x] = false;
  }

  return {
    widthTiles: W,
    heightTiles: H,
    walkable,
    furniture,
    deskSlots,
    spawnPoint: { x: 10 * TILE_SIZE, y: 16 * TILE_SIZE },
  };
}
