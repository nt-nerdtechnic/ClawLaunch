export const TILE_SIZE      = 20;                          // was 16 — bigger tiles for crisper look
export const CANVAS_TILES_W = 30;
export const CANVAS_TILES_H = 20;
export const CANVAS_W       = CANVAS_TILES_W * TILE_SIZE;  // 600
export const CANVAS_H       = CANVAS_TILES_H * TILE_SIZE;  // 400

// ─── Agent sprite dimensions ──────────────────────────────────────────────────
// Data arrays: 12 cols × 20 rows with baked outline pixels
// Rendered at ×3 scale → 36 × 60 px on screen
export const SPRITE_W      = 12;
export const SPRITE_H      = 20;
export const SPRITE_SCALE  = 3;                            // was 2
export const SPRITE_DRAW_W = SPRITE_W * SPRITE_SCALE;     // 36
export const SPRITE_DRAW_H = SPRITE_H * SPRITE_SCALE;     // 60

// ─── Furniture scale ─────────────────────────────────────────────────────────
// Furniture sprite data is 1:1 pixel; drawn this many times larger on canvas
export const FURNITURE_SCALE = 2;

// ─── Animation timing ─────────────────────────────────────────────────────────
export const WALK_SPEED            = 50;   // px/sec (proportional to new TILE_SIZE=20)
export const ANIM_FRAME_MS_IDLE    = 600;
export const ANIM_FRAME_MS_WALK    = 160;
export const ANIM_FRAME_MS_TYPE    = 320;
export const IDLE_WANDER_DELAY_MIN = 2000;
export const IDLE_WANDER_DELAY_MAX = 5000;
export const MAX_WANDER_COUNT      = 3;

// ─── 8 agent base colours (one per theme) ─────────────────────────────────────
export const AGENT_COLORS = [
  '#3498db', // 0 blue
  '#e74c3c', // 1 red
  '#27ae60', // 2 green
  '#f39c12', // 3 amber
  '#9b59b6', // 4 purple
  '#1abc9c', // 5 teal
  '#e67e22', // 6 orange
  '#607d8b', // 7 slate
];

// ─── Room colour palettes ──────────────────────────────────────────────────────
// Light: warmer, more saturated — clearly distinct floor tiles
export const LIGHT_PALETTE = {
  floor1:       '#f5e8c8',   // warm cream
  floor2:       '#e2d0a0',   // tan (clearly different from floor1)
  floorGrout:   '#c0a870',   // amber grout
  wall:         '#b09060',   // warm sand wall
  wallTop:      '#806840',   // darker top edge
  wallShadow:   '#c8a870',   // warm shadow stripe
  windowFrame:  '#483010',   // dark wood frame
  windowGlass:  'rgba(140,200,255,0.60)',
  windowSkyTop: '#60b0ff',
  windowSkyBot: '#b0d8ff',
};

// Dark: deep indigo-navy office night, vivid contrast
export const DARK_PALETTE = {
  floor1:       '#1c1e30',   // deep navy
  floor2:       '#151728',   // darker navy
  floorGrout:   '#0f1020',   // near-black grout
  wall:         '#28283c',   // indigo wall
  wallTop:      '#1a1a2e',   // dark navy top
  wallShadow:   '#222238',   // subtle shadow
  windowFrame:  '#0e0e1a',   // very dark
  windowGlass:  'rgba(40,80,160,0.50)',
  windowSkyTop: '#0a1830',
  windowSkyBot: '#060e1e',
};
