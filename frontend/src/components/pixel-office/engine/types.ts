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
  /** Timer for how long agent has been idle before wandering */
  idleTimer: number;
  /** How long to wait before starting to wander */
  idleDelay: number;
  /** Number of wanders done in current idle cycle */
  wanderCount: number;
  // Snapshot data for tooltip
  snapshotState: 'active' | 'idle';
  model?: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  sessionCount: number;
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

export interface RoomConfig {
  widthTiles: number;
  heightTiles: number;
  walkable: boolean[][];
  furniture: Furniture[];
  deskSlots: DeskSlot[];
  spawnPoint: Vec2;
}
