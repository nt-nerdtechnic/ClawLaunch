import type { PixelAgent, RoomConfig, Vec2, FrameContext } from './types';
import {
  WALK_SPEED,
  ANIM_FRAME_MS_IDLE, ANIM_FRAME_MS_WALK, ANIM_FRAME_MS_TYPE,
  IDLE_WANDER_DELAY_MIN, IDLE_WANDER_DELAY_MAX, MAX_WANDER_COUNT,
  TILE_SIZE,
  BLOCKED_REPATH_DELAY_MS,
  BUBBLE_PHRASE_MS,
} from './constants';
import { findPath } from './pathfinding';

const WORKING_PHRASES = [
  '正在分析...', '讓我想想...', '整理任務中...', '查找資料...',
  '計算結果...', '撰寫回覆...', '處理中...', '深度思考中...',
];
const BLOCKED_PHRASES = ['稍等一下...', '找個位子...', '等待中...', '路被佔了...'];

export function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function pixelToTile(px: number, py: number): Vec2 {
  return { x: Math.floor(px / TILE_SIZE), y: Math.floor(py / TILE_SIZE) };
}

/** Create a new PixelAgent entity at the spawn point. */
export function createAgent(
  id: string,
  displayName: string,
  color: string,
  deskIndex: number,
  spawnPoint: Vec2,
  snapshotState: 'active' | 'idle',
): PixelAgent {
  return {
    id,
    displayName,
    color,
    state: 'idle',
    prevState: 'idle',
    x: spawnPoint.x + (Math.random() - 0.5) * 32,
    y: spawnPoint.y + (Math.random() - 0.5) * 32,
    direction: 'down',
    path: [],
    animFrame: 0,
    animTimer: 0,
    deskIndex,
    idleTimer: 0,
    idleDelay: randomDelay(),
    wanderCount: 0,
    snapshotState,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0,
    sessionCount: 0,
    bubbleText: '',
    bubbleUntil: 0,
    lastBubbleMessageId: '',
    blockedTimer: 0,
  };
}

/** Update a single agent for one frame. ctx is built in the loop before any agent updates. */
export function updateAgent(
  agent: PixelAgent,
  dtMs: number,
  room: RoomConfig,
  ctx: FrameContext,
): void {
  agent.animTimer += dtMs;

  switch (agent.state) {
    case 'idle':    updateIdle(agent, dtMs, room, ctx); break;
    case 'walking': updateWalking(agent, dtMs, room, ctx); break;
    case 'working': updateWorking(agent, dtMs, room); break;
  }
}

/** Sync agent visual state with snapshot data. Call when snapshot updates. */
export function syncAgentWithSnapshot(
  agent: PixelAgent,
  snapshotState: 'active' | 'idle',
  room: RoomConfig,
): void {
  const prevSnapshot = agent.snapshotState;
  agent.snapshotState = snapshotState;

  if (snapshotState === 'active' && prevSnapshot !== 'active') {
    if (agent.state !== 'working') navigateToDesk(agent, room);
  } else if (snapshotState === 'idle' && prevSnapshot === 'active') {
    if (agent.state === 'working') {
      agent.state = 'idle';
      agent.idleTimer = 0;
      agent.idleDelay = randomDelay();
      agent.wanderCount = 0;
      agent.bubbleText = '';
      agent.bubbleUntil = 0;
    }
  }
}

// ─── State handlers ───────────────────────────────────────────────────────────

function updateIdle(
  agent: PixelAgent,
  dtMs: number,
  room: RoomConfig,
  ctx: FrameContext,
): void {
  if (agent.animTimer >= ANIM_FRAME_MS_IDLE) {
    agent.animFrame = (agent.animFrame + 1) % 2;
    agent.animTimer = 0;
  }

  if (agent.snapshotState === 'active') {
    navigateToDesk(agent, room);
    return;
  }

  agent.idleTimer += dtMs;
  if (agent.idleTimer >= agent.idleDelay) {
    if (agent.wanderCount < MAX_WANDER_COUNT) {
      const target = pickWanderTarget(room, ctx.occupied, agent);
      if (target) {
        const currentTile = pixelToTile(agent.x, agent.y);
        agent.path = findPath(currentTile, target, room.walkable, TILE_SIZE);
        if (agent.path.length > 0) {
          agent.state = 'walking';
          agent.animFrame = 0;
          agent.animTimer = 0;
          agent.wanderCount++;
        }
      }
      agent.idleTimer = 0;
      agent.idleDelay = randomDelay();
    } else {
      agent.wanderCount = 0;
      agent.idleTimer = 0;
      agent.idleDelay = randomDelay() * 2;
    }
  }
}

function updateWalking(
  agent: PixelAgent,
  dtMs: number,
  room: RoomConfig,
  ctx: FrameContext,
): void {
  if (agent.animTimer >= ANIM_FRAME_MS_WALK) {
    agent.animFrame = (agent.animFrame + 1) % 4;
    agent.animTimer = 0;
  }

  if (agent.path.length === 0) {
    // Arrived at destination
    if (agent.snapshotState === 'active' && agent.deskIndex >= 0) {
      const slot = room.deskSlots[agent.deskIndex];
      if (slot) {
        const sk = tileKey(slot.seatTile.x, slot.seatTile.y);
        // Allow entry if: seat is free, already reserved by self, or agent is already standing on it
        const occupiedByOther = ctx.occupied.has(sk) && !isMyCurrentTile(agent, slot.seatTile);
        const reservedByOther = ctx.reserved.has(sk) && ctx.reserved.get(sk) !== agent.id;
        if (!occupiedByOther && !reservedByOther) {
          ctx.reserved.set(sk, agent.id);
          agent.state = 'working';
          agent.animFrame = 0;
          agent.animTimer = 0;
          agent.blockedTimer = 0;
          agent.x = slot.seatPixel.x;
          agent.y = slot.seatPixel.y;
        } else {
          // Seat taken by another — wait, then reroute
          agent.blockedTimer += dtMs;
          if (agent.blockedTimer >= BLOCKED_REPATH_DELAY_MS) {
            agent.blockedTimer = 0;
            navigateToDesk(agent, room);
          }
        }
      }
    } else {
      agent.state = 'idle';
      agent.idleTimer = 0;
      agent.idleDelay = randomDelay();
      agent.blockedTimer = 0;
    }
    return;
  }

  // Collision: check if next waypoint tile is occupied or reserved by another
  const nextWaypoint = agent.path[0];
  const nextTile = pixelToTile(nextWaypoint.x, nextWaypoint.y);
  const sk = tileKey(nextTile.x, nextTile.y);

  const occupiedByOther = ctx.occupied.has(sk) && !isMyCurrentTile(agent, nextTile);
  const reservedByOther = ctx.reserved.has(sk) && ctx.reserved.get(sk) !== agent.id;

  if (occupiedByOther || reservedByOther) {
    agent.blockedTimer += dtMs;
    if (agent.blockedTimer >= BLOCKED_REPATH_DELAY_MS) {
      agent.blockedTimer = 0;
      if (agent.snapshotState === 'active') {
        navigateToDesk(agent, room);
      } else {
        agent.path = [];
        agent.state = 'idle';
        agent.idleTimer = 0;
        agent.idleDelay = randomDelay();
      }
    }
    return;
  }

  // Reserve next tile for this agent this frame
  ctx.reserved.set(sk, agent.id);
  agent.blockedTimer = 0;

  // Move toward next waypoint
  const dx = nextWaypoint.x - agent.x;
  const dy = nextWaypoint.y - agent.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const step = WALK_SPEED * (dtMs / 1000);

  if (dist <= step) {
    agent.x = nextWaypoint.x;
    agent.y = nextWaypoint.y;
    agent.path.shift();
  } else {
    agent.x += (dx / dist) * step;
    agent.y += (dy / dist) * step;
  }

  if (Math.abs(dx) > Math.abs(dy)) {
    agent.direction = dx > 0 ? 'right' : 'left';
  } else {
    agent.direction = dy > 0 ? 'down' : 'up';
  }

  // Mid-walk reroute to desk if snapshot became active
  if (agent.snapshotState === 'active' && agent.path.length > 0) {
    const slot = room.deskSlots[agent.deskIndex];
    if (slot) {
      const last = agent.path[agent.path.length - 1];
      if (
        Math.abs(last.x - slot.seatPixel.x) > TILE_SIZE ||
        Math.abs(last.y - slot.seatPixel.y) > TILE_SIZE
      ) {
        navigateToDesk(agent, room);
      }
    }
  }
}

function updateWorking(agent: PixelAgent, _dtMs: number, room: RoomConfig): void {
  if (agent.animTimer >= ANIM_FRAME_MS_TYPE) {
    agent.animFrame = (agent.animFrame + 1) % 2;
    agent.animTimer = 0;
  }

  // Cycle working phrases when no active bubble
  if (Date.now() >= agent.bubbleUntil) {
    agent.bubbleText = WORKING_PHRASES[Math.floor(Math.random() * WORKING_PHRASES.length)];
    agent.bubbleUntil = Date.now() + BUBBLE_PHRASE_MS;
  }

  if (agent.snapshotState !== 'active') {
    agent.state = 'idle';
    agent.idleTimer = 0;
    agent.idleDelay = randomDelay();
    agent.wanderCount = 0;
    agent.bubbleText = '';
    agent.bubbleUntil = 0;
    standUpFromDesk(agent, room);
  }
}

// ─── Navigation helpers ───────────────────────────────────────────────────────

function navigateToDesk(agent: PixelAgent, room: RoomConfig): void {
  if (agent.deskIndex < 0 || agent.deskIndex >= room.deskSlots.length) return;
  const slot = room.deskSlots[agent.deskIndex];
  const currentTile = pixelToTile(agent.x, agent.y);
  const path = findPath(currentTile, slot.seatTile, room.walkable, TILE_SIZE);
  if (path.length > 0) {
    agent.path = path;
    agent.state = 'walking';
    agent.animFrame = 0;
    agent.animTimer = 0;
    agent.blockedTimer = 0;
  } else {
    // No path found — show blocked bubble and retry via idle cycle
    agent.bubbleText = BLOCKED_PHRASES[Math.floor(Math.random() * BLOCKED_PHRASES.length)];
    agent.bubbleUntil = Date.now() + 2500;
    agent.state = 'idle';
    agent.idleTimer = 0;
    agent.idleDelay = 2000 + Math.random() * 1000;
  }
}

function standUpFromDesk(agent: PixelAgent, room: RoomConfig): void {
  const currentTile = pixelToTile(agent.x, agent.y);
  // Try adjacent tiles below/beside the seat; below is most natural
  const candidates: Vec2[] = [
    { x: currentTile.x,     y: currentTile.y + 1 },
    { x: currentTile.x,     y: currentTile.y + 2 },
    { x: currentTile.x + 1, y: currentTile.y },
    { x: currentTile.x - 1, y: currentTile.y },
  ];
  for (const c of candidates) {
    if (c.y >= 0 && c.y < room.heightTiles && c.x >= 0 && c.x < room.widthTiles && room.walkable[c.y]?.[c.x]) {
      const path = findPath(currentTile, c, room.walkable, TILE_SIZE);
      if (path.length > 0) {
        agent.path = path;
        agent.state = 'walking';
        agent.animFrame = 0;
        agent.animTimer = 0;
        return;
      }
    }
  }
  // All adjacent blocked — stay idle in place (will wander on next cycle)
}

// ─── Tile helpers ─────────────────────────────────────────────────────────────

function isMyCurrentTile(agent: PixelAgent, tile: Vec2): boolean {
  const ft = pixelToTile(agent.x, agent.y);
  return ft.x === tile.x && ft.y === tile.y;
}

/** Pick a wander target: prefer corridor anchors (60%), fall back to random walkable. */
function pickWanderTarget(
  room: RoomConfig,
  occupied: Set<string>,
  agent: PixelAgent,
): Vec2 | null {
  const anchors = room.routeAnchors;
  if (anchors && anchors.length > 0 && Math.random() < 0.6) {
    // Shuffle anchors and return first unoccupied walkable one
    const shuffled = [...anchors].sort(() => Math.random() - 0.5);
    for (const a of shuffled) {
      if (room.walkable[a.y]?.[a.x] && !occupied.has(tileKey(a.x, a.y))) return a;
    }
  }
  return randomWalkableTileUnoccupied(room, occupied, agent);
}

function randomWalkableTileUnoccupied(
  room: RoomConfig,
  occupied: Set<string>,
  agent: PixelAgent,
): Vec2 | null {
  const MIN_Y = 5;
  const MAX_Y = room.heightTiles - 3;
  const MIN_X = 2;
  const MAX_X = room.widthTiles - 3;
  for (let i = 0; i < 30; i++) {
    const x = MIN_X + Math.floor(Math.random() * (MAX_X - MIN_X + 1));
    const y = MIN_Y + Math.floor(Math.random() * (MAX_Y - MIN_Y + 1));
    if (room.walkable[y]?.[x] && !occupied.has(tileKey(x, y))) return { x, y };
  }
  // Fallback: any walkable tile (at least avoids static walls)
  return randomWalkableTile(room, agent);
}

function randomWalkableTile(room: RoomConfig, agent: PixelAgent): Vec2 | null {
  const MIN_Y = 5;
  const MAX_Y = room.heightTiles - 3;
  const MIN_X = 2;
  const MAX_X = room.widthTiles - 3;
  for (let i = 0; i < 20; i++) {
    const x = MIN_X + Math.floor(Math.random() * (MAX_X - MIN_X + 1));
    const y = MIN_Y + Math.floor(Math.random() * (MAX_Y - MIN_Y + 1));
    if (room.walkable[y]?.[x]) return { x, y };
  }
  void agent; // suppress unused warning
  return null;
}

function randomDelay(): number {
  return IDLE_WANDER_DELAY_MIN + Math.random() * (IDLE_WANDER_DELAY_MAX - IDLE_WANDER_DELAY_MIN);
}
