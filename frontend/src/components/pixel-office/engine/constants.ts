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
export const IDLE_WANDER_DELAY_MIN = 6000;
export const IDLE_WANDER_DELAY_MAX = 14000;
export const MAX_WANDER_COUNT      = 2;

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

// Server Room (light): steel-grey industrial with green accents
export const SERVER_ROOM_LIGHT_PALETTE = {
  floor1:       '#c8ced4',   // steel grey
  floor2:       '#b8bec6',   // darker steel
  floorGrout:   '#8898a8',   // deep blue-grey
  wall:         '#6e7a86',   // slate wall
  wallTop:      '#4a5560',   // dark slate top
  wallShadow:   '#5a6672',
  ledStrip:     '#00ff99',   // bright green LED
  ledGlow:      'rgba(0,255,120,0.18)',
  ambientGlow:  'rgba(0,220,100,0.07)',
};

// Server Room (dark): pitch-black racks lit by green terminal glow
export const SERVER_ROOM_DARK_PALETTE = {
  floor1:       '#0a0d0f',   // near black
  floor2:       '#0d1014',
  floorGrout:   '#040507',
  wall:         '#0d1117',
  wallTop:      '#070a0d',
  wallShadow:   '#0a0d10',
  ledStrip:     '#00ff88',
  ledGlow:      'rgba(0,255,120,0.28)',
  ambientGlow:  'rgba(0,180,80,0.12)',
};

// Cafe (light): warm wood + brick
export const CAFE_LIGHT_PALETTE = {
  floor1:       '#d4a96a',   // warm honey wood
  floor2:       '#c49050',   // darker oak plank
  floorGrout:   '#a07040',   // wood grain line
  wall:         '#8b3a2a',   // brick red
  wallTop:      '#6a2818',   // dark brick top
  wallShadow:   '#a04030',
  windowFrame:  '#5c3018',   // dark timber
  windowGlass:  'rgba(255,200,100,0.45)',  // warm afternoon sun
  windowSkyTop: '#ffb030',
  windowSkyBot: '#ffe090',
  warmGlow:     'rgba(255,160,30,0.10)',
};

// Cafe (dark): evening cafe, candle-lit amber
export const CAFE_DARK_PALETTE = {
  floor1:       '#2a1a0a',
  floor2:       '#221408',
  floorGrout:   '#150d04',
  wall:         '#3a1810',
  wallTop:      '#280e08',
  wallShadow:   '#301206',
  windowFrame:  '#1a0c04',
  windowGlass:  'rgba(180,80,10,0.45)',
  windowSkyTop: '#3a1800',
  windowSkyBot: '#1a0c00',
  warmGlow:     'rgba(220,100,10,0.14)',
};
