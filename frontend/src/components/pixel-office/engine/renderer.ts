import type { PixelAgent, RoomConfig, Furniture } from './types';
import type { SpriteCache } from './spriteCache';
import { getCachedSprite } from './spriteCache';
import {
  TILE_SIZE, CANVAS_W, CANVAS_H,
  SPRITE_DRAW_W, SPRITE_DRAW_H,
  FURNITURE_SCALE,
  LIGHT_PALETTE, DARK_PALETTE,
} from './constants';

// Window columns (tile X) along north wall, every 6 tiles
const WINDOW_TILE_XS = [3, 9, 15, 21];
const WIN_TW = 4;  // tiles wide
const WIN_TH = 2;  // tiles tall (fills the 2-tile top wall)

// Monitor screen pixel offset within the DESK sprite data (28×14),
// scaled by FURNITURE_SCALE so they match the drawn (56×28) furniture.
// Sprite screen area rows 3-5 from top, cols 4-18 from left:
const DESK_MON_X = 4 * FURNITURE_SCALE;   //  8
const DESK_MON_Y = 3 * FURNITURE_SCALE;   //  6
const DESK_MON_W = 15 * FURNITURE_SCALE;  // 30
const DESK_MON_H = 5 * FURNITURE_SCALE;   // 10

interface Drawable {
  kind: 'furniture' | 'agent';
  y: number;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  room: RoomConfig,
  agents: PixelAgent[],
  cache: SpriteCache,
  hoveredAgentId: string | null,
  dark: boolean,
  bgImage: HTMLImageElement | null = null,
): void {
  const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  if (bgImage) {
    // ─── AI-generated background image ──────────────────────────────────────
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bgImage, 0, 0, CANVAS_W, CANVAS_H);
    // Dark mode tint
    if (dark) {
      ctx.fillStyle = 'rgba(10,12,35,0.58)';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    ctx.imageSmoothingEnabled = false;
  } else {
    // ─── 1. Procedural floor + wall tiles ───────────────────────────────────
    ctx.imageSmoothingEnabled = false;
    for (let ty = 0; ty < room.heightTiles; ty++) {
      for (let tx = 0; tx < room.widthTiles; tx++) {
        const isTopWall    = ty < 2;
        const isSideWall   = tx < 1 || tx >= room.widthTiles - 1;
        const isBottomWall = ty >= room.heightTiles - 1;
        const isWall       = isTopWall || isSideWall || isBottomWall;

        if (isWall) {
          ctx.fillStyle = isTopWall && ty === 0 ? palette.wallTop : palette.wall;
          ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
          if (ty === 1 && !isSideWall) {
            ctx.fillStyle = palette.wallShadow;
            ctx.fillRect(tx * TILE_SIZE, (ty + 1) * TILE_SIZE - 3, TILE_SIZE, 3);
          }
        } else {
          ctx.fillStyle = (tx + ty) % 2 === 0 ? palette.floor1 : palette.floor2;
          ctx.fillRect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // ─── 1b. Floor grout lines ───────────────────────────────────────────────
    ctx.beginPath();
    ctx.strokeStyle = dark ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    for (let tx = 2; tx < room.widthTiles - 1; tx++) {
      ctx.moveTo(tx * TILE_SIZE, 2 * TILE_SIZE);
      ctx.lineTo(tx * TILE_SIZE, (room.heightTiles - 1) * TILE_SIZE);
    }
    for (let ty = 2; ty < room.heightTiles - 1; ty++) {
      ctx.moveTo(1 * TILE_SIZE, ty * TILE_SIZE);
      ctx.lineTo((room.widthTiles - 1) * TILE_SIZE, ty * TILE_SIZE);
    }
    ctx.stroke();

    // ─── 1c. North-wall windows ──────────────────────────────────────────────
    drawNorthWallWindows(ctx, palette, room.widthTiles);
  }

  // ─── 2. Collect drawables for Z-sorting ──────────────────────────────────
  const drawables: Drawable[] = [];

  // Only draw procedural furniture when no background image (image has its own furniture)
  if (!bgImage) {
    for (const f of room.furniture) {
      const spriteH = getSpriteNaturalH(f.type);
      const fy = f.tileY * TILE_SIZE + spriteH * FURNITURE_SCALE;
      drawables.push({ kind: 'furniture', y: fy, draw: (c) => drawFurniture(c, f, cache) });
    }
  }

  for (const agent of agents) {
    drawables.push({ kind: 'agent', y: agent.y - 0.5, draw: (c) => drawAgentShadow(c, agent) });
    drawables.push({ kind: 'agent', y: agent.y,       draw: (c) => drawAgent(c, agent, cache, hoveredAgentId === agent.id) });
  }

  drawables.sort((a, b) => a.y - b.y);

  // ─── 3. Draw all Z-sorted ────────────────────────────────────────────────
  for (const d of drawables) d.draw(ctx);

  // ─── 4. Monitor glows ────────────────────────────────────────────────────
  for (const agent of agents) {
    if (agent.state === 'working' && agent.deskIndex >= 0 && agent.deskIndex < room.deskSlots.length) {
      const slot = room.deskSlots[agent.deskIndex];
      drawMonitorGlow(ctx, slot.deskTile.x * TILE_SIZE, slot.deskTile.y * TILE_SIZE);
    }
  }

  // ─── 5. Name labels ───────────────────────────────────────────────────────
  for (const agent of agents) drawNameLabel(ctx, agent, dark);

  // ─── 6. Working-status bubbles ────────────────────────────────────────────
  for (const agent of agents) drawStatusBubble(ctx, agent, dark);
}

// ─── Sprite natural heights by type (for Z-sort) ─────────────────────────────
function getSpriteNaturalH(type: string): number {
  switch (type) {
    case 'chair':     return 11;
    case 'plant':     return 18;
    case 'server':    return 24;
    case 'bookshelf': return 20;
    case 'desk':
    default:          return 14;
  }
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────

function drawNorthWallWindows(
  ctx: CanvasRenderingContext2D,
  palette: typeof LIGHT_PALETTE,
  widthTiles: number,
): void {
  for (const wx of WINDOW_TILE_XS) {
    if (wx + WIN_TW >= widthTiles - 1) continue;

    const px = wx * TILE_SIZE;
    const py = 0;
    const pw = WIN_TW * TILE_SIZE;
    const ph = WIN_TH * TILE_SIZE;

    // Sky gradient
    const skyGrad = ctx.createLinearGradient(px, py, px, py + ph);
    skyGrad.addColorStop(0, palette.windowSkyTop);
    skyGrad.addColorStop(1, palette.windowSkyBot);
    ctx.fillStyle = skyGrad;
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);

    // Glass tint
    ctx.fillStyle = palette.windowGlass;
    ctx.fillRect(px + 2, py + 2, pw - 4, ph - 4);

    // Dividers (cross)
    ctx.fillStyle = palette.windowFrame;
    ctx.fillRect(px + 2,          py + ph / 2 - 1, pw - 4, 2);  // horizontal
    ctx.fillRect(px + pw / 2 - 1, py + 2,          2, ph - 4);  // vertical

    // Outer frame
    ctx.strokeStyle = palette.windowFrame;
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);

    // Light-ray gradient down from window
    const rayGrad = ctx.createLinearGradient(px, py + ph, px, py + ph + 5 * TILE_SIZE);
    rayGrad.addColorStop(0, 'rgba(200,230,255,0.16)');
    rayGrad.addColorStop(1, 'rgba(200,230,255,0)');
    ctx.fillStyle = rayGrad;
    ctx.fillRect(px + 2, py + ph, pw - 4, 5 * TILE_SIZE);
  }
}

function drawFurniture(ctx: CanvasRenderingContext2D, f: Furniture, cache: SpriteCache): void {
  const key = `furniture-${f.type}`;
  const sprite = getCachedSprite(cache, key);
  if (!sprite) return;

  const px = f.tileX * TILE_SIZE;
  const py = f.tileY * TILE_SIZE;
  const rw = sprite.width  * FURNITURE_SCALE;
  const rh = sprite.height * FURNITURE_SCALE;

  // Drop shadow ellipse beneath furniture
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(px + rw / 2, py + rh + 2, rw * 0.42, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Draw furniture at FURNITURE_SCALE
  ctx.drawImage(sprite, px, py, rw, rh);
}

function drawMonitorGlow(ctx: CanvasRenderingContext2D, deskX: number, deskY: number): void {
  const sx = deskX + DESK_MON_X;
  const sy = deskY + DESK_MON_Y;

  ctx.save();
  ctx.shadowColor = '#3ae0a0';
  ctx.shadowBlur = 18;
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#3ae0a0';
  ctx.fillRect(sx, sy, DESK_MON_W, DESK_MON_H);
  ctx.shadowBlur = 0;
  ctx.shadowColor = '';
  ctx.restore();
}

function drawAgentShadow(ctx: CanvasRenderingContext2D, agent: PixelAgent): void {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(agent.x, agent.y + 2, SPRITE_DRAW_W * 0.40, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  agent: PixelAgent,
  cache: SpriteCache,
  isHovered: boolean,
): void {
  const stateKey = agent.state === 'working' ? 'type' : agent.state === 'walking' ? 'walk' : 'idle';
  const frameCount = stateKey === 'walk' ? 4 : 2;
  const frame = agent.animFrame % frameCount;
  const spriteKey = `agent-${stateKey}-${frame}-${agent.color}`;
  const sprite = getCachedSprite(cache, spriteKey);
  if (!sprite) return;

  const drawX = Math.round(agent.x - SPRITE_DRAW_W / 2);
  const drawY = Math.round(agent.y - SPRITE_DRAW_H);

  if (isHovered) {
    ctx.save();
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;
    ctx.shadowColor = '#ffd700';
    ctx.shadowBlur = 8;
    drawRoundRect(ctx, drawX - 3, drawY - 3, SPRITE_DRAW_W + 6, SPRITE_DRAW_H + 6, 5);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowColor = '';
    ctx.restore();
  }

  ctx.drawImage(sprite, drawX, drawY, SPRITE_DRAW_W, SPRITE_DRAW_H);
}

function drawNameLabel(ctx: CanvasRenderingContext2D, agent: PixelAgent, dark: boolean): void {
  const labelCX = agent.x;
  const labelCY = agent.y - SPRITE_DRAW_H - 6;

  const name = agent.displayName.length > 10
    ? agent.displayName.substring(0, 9) + '…'
    : agent.displayName;

  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const metrics = ctx.measureText(name);
  const bgW = metrics.width + 12;
  const bgH = 13;
  const bgX = labelCX - bgW / 2;
  const bgY = labelCY - bgH / 2;

  ctx.fillStyle = dark ? 'rgba(14,16,32,0.92)' : 'rgba(255,255,255,0.94)';
  drawRoundRect(ctx, bgX, bgY, bgW, bgH, 4);
  ctx.fill();

  const isWorking = agent.state === 'working';
  ctx.strokeStyle = isWorking ? '#2ecc71' : (dark ? '#303058' : '#b8b8cc');
  ctx.lineWidth = isWorking ? 1.5 : 0.8;
  ctx.stroke();

  ctx.fillStyle = isWorking
    ? (dark ? '#7fff9e' : '#1a7a40')
    : (dark ? '#7878aa' : '#4a4a6a');
  ctx.fillText(name, labelCX, labelCY);
}

function drawStatusBubble(ctx: CanvasRenderingContext2D, agent: PixelAgent, dark: boolean): void {
  if (agent.state !== 'working') return;

  const bx = agent.x + SPRITE_DRAW_W / 2 + 2;
  const by = agent.y - SPRITE_DRAW_H - 8;
  const bw = 24;
  const bh = 15;
  const br = 4;

  // Bubble
  ctx.fillStyle = dark ? 'rgba(22,26,46,0.93)' : 'rgba(255,255,255,0.95)';
  drawRoundRect(ctx, bx, by - bh, bw, bh, br);
  ctx.fill();

  ctx.strokeStyle = dark ? '#4a6fa5' : '#c8d5e8';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Tail
  ctx.fillStyle = dark ? 'rgba(22,26,46,0.93)' : 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.moveTo(bx + 4, by);
  ctx.lineTo(bx, by + 5);
  ctx.lineTo(bx + 9, by);
  ctx.closePath();
  ctx.fill();

  // Animated dots
  const time = Date.now();
  for (let i = 0; i < 3; i++) {
    const bounce = Math.sin((time / 280) + i * 1.15) * 2;
    ctx.fillStyle = dark ? '#7cb9f5' : '#4a90d9';
    ctx.beginPath();
    ctx.arc(bx + 4 + i * 7, by - bh / 2 + bounce, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  w: number, h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
