export type AgentState = 'idle' | 'walking' | 'working';
export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Vec2 {
  x: number;
  y: number;
}

export interface PixelAgent {
  id: string;
  displayName: string;
  state: AgentState;
  prevState: AgentState;
  color: string;
  x: number;
  y: number;
  direction: Direction;
  path: Vec2[];
  animFrame: number;
  animTimer: number;
  deskIndex: number;
  idleTimer: number;
  idleDelay: number;
  wanderCount: number;
  // Snapshot data for tooltip
  snapshotState: 'active' | 'idle';
  model?: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  sessionCount: number;
  // Dialogue bubble (text overrides dots; bubbleUntil=0 means no active bubble)
  bubbleText: string;
  bubbleUntil: number;
  lastBubbleMessageId: string;
  // Collision / pathfinding
  blockedTimer: number;
}

export type SpriteData = string[][];

export interface SpriteSet {
  idle: SpriteData[];       // 2 frames
  walk: SpriteData[];       // 4 frames (used for all directions)
  type: SpriteData[];       // 2 frames (sitting at desk)
}

export type FurnitureType = 'desk' | 'chair' | 'plant' | 'server' | 'whiteboard' | 'bookshelf';

export interface Furniture {
  type: FurnitureType;
  tileX: number;
  tileY: number;
  width: number;   // in tiles
  height: number;  // in tiles
}

export interface DeskSlot {
  deskTile: Vec2;    // where the desk furniture is
  seatTile: Vec2;    // where agent sits (chair position)
  seatPixel: Vec2;   // pixel position for agent when seated
}

export interface DeskSlotsConfig {
  description?: string;
  slots: Array<{
    id: number;
    x: number;        // seatPixel.x
    y: number;        // seatPixel.y
    label?: string;   // optional label for desk
  }>;
}

export type RenderTheme = 'office' | 'serverRoom' | 'cafe';

export interface RoomConfig {
  widthTiles: number;
  heightTiles: number;
  walkable: boolean[][];
  furniture: Furniture[];
  deskSlots: DeskSlot[];
  spawnPoint: Vec2;
  renderTheme: RenderTheme;
  /** Preferred wander targets — agents preferentially idle-walk to these tiles */
  routeAnchors?: Vec2[];
}

/**
 * Per-frame occupancy context built in the game loop before any agent updates.
 * `occupied` is a snapshot of all agents' foot tiles at frame start.
 * `reserved` accumulates tiles claimed this frame by walking agents (first-come wins).
 */
export interface FrameContext {
  occupied: Set<string>;
  reserved: Map<string, string>;
}
