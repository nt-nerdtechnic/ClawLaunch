import type { PixelAgent, RoomConfig, Vec2 } from './types';
import { WALK_SPEED, ANIM_FRAME_MS_IDLE, ANIM_FRAME_MS_WALK, ANIM_FRAME_MS_TYPE, IDLE_WANDER_DELAY_MIN, IDLE_WANDER_DELAY_MAX, MAX_WANDER_COUNT, TILE_SIZE } from './constants';
import { findPath } from './pathfinding';

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
  };
}

/** Update a single agent for one frame. */
export function updateAgent(agent: PixelAgent, dtMs: number, room: RoomConfig): void {
  agent.animTimer += dtMs;

  switch (agent.state) {
    case 'idle':
      updateIdle(agent, dtMs, room);
      break;
    case 'walking':
      updateWalking(agent, dtMs, room);
      break;
    case 'working':
      updateWorking(agent, dtMs);
      break;
  }
}

/** Sync agent visual state with snapshot data. Call when snapshot updates. */
export function syncAgentWithSnapshot(agent: PixelAgent, snapshotState: 'active' | 'idle', room: RoomConfig): void {
  const prevSnapshot = agent.snapshotState;
  agent.snapshotState = snapshotState;

  if (snapshotState === 'active' && prevSnapshot !== 'active') {
    // Agent became active: walk to desk
    if (agent.state !== 'working') {
      navigateToDesk(agent, room);
    }
  } else if (snapshotState === 'idle' && prevSnapshot === 'active') {
    // Agent became idle: stand up from desk
    if (agent.state === 'working') {
      agent.state = 'idle';
      agent.idleTimer = 0;
      agent.idleDelay = randomDelay();
      agent.wanderCount = 0;
    }
  }
}

// ─── State handlers ───

function updateIdle(agent: PixelAgent, dtMs: number, room: RoomConfig): void {
  // Advance idle animation
  if (agent.animTimer >= ANIM_FRAME_MS_IDLE) {
    agent.animFrame = (agent.animFrame + 1) % 2;
    agent.animTimer = 0;
  }

  // If snapshot says active, go to desk
  if (agent.snapshotState === 'active') {
    navigateToDesk(agent, room);
    return;
  }

  // Wait then wander
  agent.idleTimer += dtMs;
  if (agent.idleTimer >= agent.idleDelay) {
    if (agent.wanderCount < MAX_WANDER_COUNT) {
      // Pick a random walkable tile and navigate there
      const target = randomWalkableTile(room);
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
      // Done wandering, reset
      agent.wanderCount = 0;
      agent.idleTimer = 0;
      agent.idleDelay = randomDelay() * 2;
    }
  }
}

function updateWalking(agent: PixelAgent, dtMs: number, room: RoomConfig): void {
  // Advance walk animation
  if (agent.animTimer >= ANIM_FRAME_MS_WALK) {
    agent.animFrame = (agent.animFrame + 1) % 4;
    agent.animTimer = 0;
  }

  if (agent.path.length === 0) {
    // Arrived at destination
    if (agent.snapshotState === 'active' && agent.deskIndex >= 0) {
      agent.state = 'working';
      agent.animFrame = 0;
      agent.animTimer = 0;
      // Snap to desk seat position
      const slot = room.deskSlots[agent.deskIndex];
      if (slot) {
        agent.x = slot.seatPixel.x;
        agent.y = slot.seatPixel.y;
      }
    } else {
      agent.state = 'idle';
      agent.idleTimer = 0;
      agent.idleDelay = randomDelay();
    }
    return;
  }

  // Move toward next waypoint
  const target = agent.path[0];
  const dx = target.x - agent.x;
  const dy = target.y - agent.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const step = WALK_SPEED * (dtMs / 1000);

  if (dist <= step) {
    agent.x = target.x;
    agent.y = target.y;
    agent.path.shift();
  } else {
    agent.x += (dx / dist) * step;
    agent.y += (dy / dist) * step;
  }

  // Update direction based on movement
  if (Math.abs(dx) > Math.abs(dy)) {
    agent.direction = dx > 0 ? 'right' : 'left';
  } else {
    agent.direction = dy > 0 ? 'down' : 'up';
  }

  // If snapshot became active mid-walk and not heading to desk, reroute
  if (agent.snapshotState === 'active' && agent.path.length > 0) {
    const slot = room.deskSlots[agent.deskIndex];
    if (slot) {
      const lastWaypoint = agent.path[agent.path.length - 1];
      const deskPixel = slot.seatPixel;
      if (Math.abs(lastWaypoint.x - deskPixel.x) > TILE_SIZE || Math.abs(lastWaypoint.y - deskPixel.y) > TILE_SIZE) {
        navigateToDesk(agent, room);
      }
    }
  }
}

function updateWorking(agent: PixelAgent, _dtMs: number): void {
  // Advance typing animation
  if (agent.animTimer >= ANIM_FRAME_MS_TYPE) {
    agent.animFrame = (agent.animFrame + 1) % 2;
    agent.animTimer = 0;
  }

  // If no longer active, stand up
  if (agent.snapshotState !== 'active') {
    agent.state = 'idle';
    agent.idleTimer = 0;
    agent.idleDelay = randomDelay();
    agent.wanderCount = 0;
    // Move slightly away from desk so they're not stuck
    agent.y += TILE_SIZE;
  }
}

// ─── Helpers ───

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
  } else {
    // Can't pathfind, teleport
    agent.x = slot.seatPixel.x;
    agent.y = slot.seatPixel.y;
    agent.state = 'working';
    agent.animFrame = 0;
    agent.animTimer = 0;
  }
}

function pixelToTile(px: number, py: number): Vec2 {
  return {
    x: Math.floor(px / TILE_SIZE),
    y: Math.floor(py / TILE_SIZE),
  };
}

function randomWalkableTile(room: RoomConfig): Vec2 | null {
  // Try up to 20 times to find a random walkable tile
  for (let i = 0; i < 20; i++) {
    const x = 2 + Math.floor(Math.random() * (room.widthTiles - 4));
    const y = 3 + Math.floor(Math.random() * (room.heightTiles - 5));
    if (room.walkable[y]?.[x]) {
      return { x, y };
    }
  }
  return null;
}

function randomDelay(): number {
  return IDLE_WANDER_DELAY_MIN + Math.random() * (IDLE_WANDER_DELAY_MAX - IDLE_WANDER_DELAY_MIN);
}
