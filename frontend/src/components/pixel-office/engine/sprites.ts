/**
 * Pixel art sprite definitions — 12w × 20h characters, 1px black outline,
 * 3-tone shading, proper proportions.  Template tokens ($hair, $shirt …)
 * are swapped per-agent at cache-build time via resolveSprite().
 *
 * Furniture sprites are drawn at their natural pixel scale.
 */
import type { SpriteData } from './types';

// ─── Template & fixed colors ────────────────────────────────────────────────
const _ = '';            // transparent
const B  = '#1a1a1a';   // outline / shadow

// Agent body tokens (replaced by resolveSprite)
const H  = '$hair';     // hair base
const HL = '$hair_l';   // hair highlight
const S  = '$skin';     // skin
const SL = '#fde8c8';   // skin light (fixed highlight)
const SD = '#c87941';   // skin shadow (fixed chin shadow)
const EW = '#f0f0f0';   // eye white
const EP = '#181830';   // pupil (very dark)
const M  = '#c87070';   // mouth
const T  = '$shirt';    // shirt mid
const TL = '$shirt_l';  // shirt light (left chest highlight)
const TS = '$shirt_d';  // shirt dark (right side shadow)
const P  = '$pants';    // pants
const PD = '$pants_d';  // pants shadow
const AR = '$skin';     // forearm / hand (reuse skin token)
const SH = '$shoes';    // shoes

/* ══════════════════════════════════════════════════════════════════════════
   CHARACTER SPRITES  12 × 20
   Layout:
     Rows  0- 7  →  Head (hair + face)
     Rows  8-14  →  Upper body (shirt + arms)
     Rows 15-19  →  Legs + shoes
   ══════════════════════════════════════════════════════════════════════════ */

// ── Idle frame 0 — relaxed stand ──────────────────────────────────────────
export const AGENT_IDLE_0: SpriteData = [
//   0    1    2    3    4    5    6    7    8    9   10   11
  [  _,   _,   _,   B,   B,   B,   B,   B,   B,   _,   _,   _ ],  // R0  hair top
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],  // R1  hair
  [  _,   _,   B,  HL,   H,   H,   H,   H,  HL,   B,   _,   _ ],  // R2  hair highlight
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],  // R3  hair lower
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],  // R4  forehead
  [  _,   _,   B,   S,  EW,  EP,   S,  EW,  EP,   B,   _,   _ ],  // R5  eyes
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],  // R6  nose
  [  _,   _,   B,  SD,   S,   M,   M,   S,  SD,   B,   _,   _ ],  // R7  mouth + chin shadow
  [  _,   _,   _,   B,  SL,   S,   S,  SL,   B,   _,   _,   _ ],  // R8  neck
  [  _,   B,   T,   T,   T,   T,   T,   T,   T,   T,   B,   _ ],  // R9  shoulders
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],  // R10 chest (L-light, R-dark)
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],  // R11 chest
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],  // R12 torso
  [  B,  AR,   T,   T,   T,   T,   T,   T,   T,   T,  AR,   B ],  // R13 arms at sides (skin visible)
  [  B,  AR,   T,   T,   T,   T,   T,   T,   T,   T,  AR,   B ],  // R14 arms lower
  [  _,   _,   B,   P,   P,   P,   P,   P,   P,   B,   _,   _ ],  // R15 hips
  [  _,   _,   B,   P,   P,   _,   _,   P,   P,   B,   _,   _ ],  // R16 upper legs
  [  _,   _,   B,   P,   P,   _,   _,   P,   P,   B,   _,   _ ],  // R17 lower legs
  [  _,   _,   B,  SH,  SH,   _,   _,  SH,  SH,   B,   _,   _ ],  // R18 shoes
  [  _,   _,   _,   B,   B,   _,   _,   B,   B,   _,   _,   _ ],  // R19 shoe bottom outline
];

// ── Idle frame 1 — slight bob/breathe ─────────────────────────────────────
export const AGENT_IDLE_1: SpriteData = [
  [  _,   _,   _,   B,   B,   B,   B,   B,   B,   _,   _,   _ ],
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],
  [  _,   _,   B,  HL,   H,   H,   H,   H,  HL,   B,   _,   _ ],
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],
  [  _,   _,   B,   S,  EW,  EP,   S,  EW,  EP,   B,   _,   _ ],
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],
  [  _,   _,   B,  SD,   S,   M,   M,   S,  SD,   B,   _,   _ ],
  [  _,   _,   _,   B,  SL,   S,   S,  SL,   B,   _,   _,   _ ],
  [  _,   B,   T,   T,   T,   T,   T,   T,   T,   T,   B,   _ ],
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],
  [  _,   B,   T,   T,   T,   T,   T,   T,   T,   T,   B,   _ ],  // chest 1px narrower (breathe in)
  [  _,   B,  AR,   T,   T,   T,   T,   T,   T,  AR,   B,   _ ],
  [  B,  AR,   T,   T,   T,   T,   T,   T,   T,   T,  AR,   B ],
  [  _,   _,   B,   P,   P,   P,   P,   P,   P,   B,   _,   _ ],
  [  _,   _,   B,   P,   P,   _,   _,   P,   P,   B,   _,   _ ],
  [  _,   _,   B,   P,   P,   _,   _,   P,   P,   B,   _,   _ ],
  [  _,   _,   B,  SH,  SH,   _,   _,  SH,  SH,   B,   _,   _ ],
  [  _,   _,   _,   B,   B,   _,   _,   B,   B,   _,   _,   _ ],
];

// ── Walk frame 0 — left leg forward ───────────────────────────────────────
export const AGENT_WALK_0: SpriteData = [
  [  _,   _,   _,   B,   B,   B,   B,   B,   B,   _,   _,   _ ],
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],
  [  _,   _,   B,  HL,   H,   H,   H,   H,  HL,   B,   _,   _ ],
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],
  [  _,   _,   B,   S,  EW,  EP,   S,  EW,  EP,   B,   _,   _ ],
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],
  [  _,   _,   B,  SD,   S,   M,   M,   S,  SD,   B,   _,   _ ],
  [  _,   _,   _,   B,  SL,   S,   S,  SL,   B,   _,   _,   _ ],
  [  _,   B,   T,   T,   T,   T,   T,   T,   T,   T,   B,   _ ],
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],
  [  B,  AR,   T,   T,   T,   T,   T,   T,   T,   T,  AR,   B ],
  [  _,   _,  AR,   T,   T,   T,   T,   T,   T,  AR,   _,   _ ],  // slight arm swing
  [  _,   _,   B,   P,   P,   P,   P,   P,   P,   B,   _,   _ ],  // hips
  [  _,   _,   B,   P,   P,   _,   _,  PD,   _,   B,   _,   _ ],  // left leg fwd, right thigh back (PD=darker)
  [  _,   _,   _,   B,   P,   _,   _,   _,   _,   _,   _,   _ ],  // only left leg lower
  [  _,   _,   _,   B,  SH,   _,   _,   _,   _,   _,   _,   _ ],  // left shoe only
  [  _,   _,   _,   _,   B,   _,   _,   _,   _,   _,   _,   _ ],  // shoe outline
];

// ── Walk frame 1 — neutral ──────────────────────────────────────────────
export const AGENT_WALK_1: SpriteData = AGENT_IDLE_0;

// ── Walk frame 2 — right leg forward ──────────────────────────────────────
export const AGENT_WALK_2: SpriteData = [
  [  _,   _,   _,   B,   B,   B,   B,   B,   B,   _,   _,   _ ],
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],
  [  _,   _,   B,  HL,   H,   H,   H,   H,  HL,   B,   _,   _ ],
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],
  [  _,   _,   B,   S,  EW,  EP,   S,  EW,  EP,   B,   _,   _ ],
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],
  [  _,   _,   B,  SD,   S,   M,   M,   S,  SD,   B,   _,   _ ],
  [  _,   _,   _,   B,  SL,   S,   S,  SL,   B,   _,   _,   _ ],
  [  _,   B,   T,   T,   T,   T,   T,   T,   T,   T,   B,   _ ],
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],
  [  B,  AR,   T,   T,   T,   T,   T,   T,   T,   T,  AR,   B ],
  [  _,   _,  AR,   T,   T,   T,   T,   T,   T,  AR,   _,   _ ],
  [  _,   _,   B,   P,   P,   P,   P,   P,   P,   B,   _,   _ ],
  [  _,   _,   B,   _,  PD,   _,   _,   P,   P,   B,   _,   _ ],  // right leg fwd, left thigh back
  [  _,   _,   _,   _,   _,   _,   _,   B,   P,   B,   _,   _ ],  // right leg lower
  [  _,   _,   _,   _,   _,   _,   _,   B,  SH,   B,   _,   _ ],  // right shoe
  [  _,   _,   _,   _,   _,   _,   _,   _,   B,   _,   _,   _ ],
];

// ── Walk frame 3 — neutral (back) ──────────────────────────────────────────
export const AGENT_WALK_3: SpriteData = AGENT_IDLE_1;

// ── Type frame 0 — seated, arms resting on desk ────────────────────────────
export const AGENT_TYPE_0: SpriteData = [
  [  _,   _,   _,   B,   B,   B,   B,   B,   B,   _,   _,   _ ],
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],
  [  _,   _,   B,  HL,   H,   H,   H,   H,  HL,   B,   _,   _ ],
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],
  [  _,   _,   B,   S,  EW,  EP,   S,  EW,  EP,   B,   _,   _ ],  // focused look
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],
  [  _,   _,   B,  SD,   S,   M,   M,   S,  SD,   B,   _,   _ ],
  [  _,   _,   _,   B,  SL,   S,   S,  SL,   B,   _,   _,   _ ],
  [  _,   B,   T,   T,   T,   T,   T,   T,   T,   T,   B,   _ ],
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],
  [  B,  AR,  TL,   T,   T,   T,   T,   T,   T,  TS,  AR,   B ],  // arms come forward
  [  B,  AR,  AR,   T,   T,   T,   T,   T,   T,  AR,  AR,   B ],  // arms extend toward desk
  [ AR,  AR,  AR,   T,   T,   T,   T,   T,   T,  AR,  AR,  AR ],  // hands at keyboard level
  [  _,   _,  AR,  AR,   T,   T,   T,   T,  AR,  AR,   _,   _ ],  // fingertips near keyboard
  [  _,   _,   _,   _,   P,   P,   P,   P,   _,   _,   _,   _ ],  // partial pants (seated)
  [  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _ ],
  [  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _ ],
  [  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _ ],
  [  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _ ],
];

// ── Type frame 1 — hands slightly raised (key press) ──────────────────────
export const AGENT_TYPE_1: SpriteData = [
  [  _,   _,   _,   B,   B,   B,   B,   B,   B,   _,   _,   _ ],
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],
  [  _,   _,   B,  HL,   H,   H,   H,   H,  HL,   B,   _,   _ ],
  [  _,   _,   B,   H,   H,   H,   H,   H,   H,   B,   _,   _ ],
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],
  [  _,   _,   B,   S,   S,  EP,   S,   S,  EP,   B,   _,   _ ],  // squint/focused eyes
  [  _,   _,   B,   S,   S,   S,   S,   S,   S,   B,   _,   _ ],
  [  _,   _,   B,  SD,   S,   M,   M,   S,  SD,   B,   _,   _ ],
  [  _,   _,   _,   B,  SL,   S,   S,  SL,   B,   _,   _,   _ ],
  [  _,   B,   T,   T,   T,   T,   T,   T,   T,   T,   B,   _ ],
  [  B,   T,  TL,   T,   T,   T,   T,   T,   T,  TS,   T,   B ],
  [  B,  AR,  TL,   T,   T,   T,   T,   T,   T,  TS,  AR,   B ],
  [  B,  AR,  AR,  AR,   T,   T,   T,   T,  AR,  AR,  AR,   B ],  // arms raised
  [ AR,  AR,  AR,  AR,   T,   T,   T,   T,  AR,  AR,  AR,  AR ],  // hands up / pressing key
  [  _,   _,   _,  AR,  AR,   T,   T,  AR,  AR,   _,   _,   _ ],
  [  _,   _,   _,   _,   P,   P,   P,   P,   _,   _,   _,   _ ],
  [  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _ ],
  [  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _ ],
  [  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _ ],
  [  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _ ],
];

/* ══════════════════════════════════════════════════════════════════════════
   FURNITURE SPRITES   (natural 1:1 pixel scale, positioned on tile grid)
   ══════════════════════════════════════════════════════════════════════════ */

// ── Desk with monitor  (28 × 14 px  ≈ 1.75 tiles wide, ~0.875 tiles tall) ─
const DT  = '#c8a85a';  // desk top surface (warm wood)
const DS  = '#9e7a3a';  // desk side/shadow
const DL  = '#7a5c28';  // desk leg
const DH_ = '#d9bb7a';  // desk highlight
const MC  = '#1e2430';  // monitor casing
const MS  = '#141a24';  // monitor screen
const MC2 = '#2a3040';  // monitor casing medium
const MG  = '#3ae0a0';  // screen glow (terminal green)
const MB  = '#121820';  // monitor base

export const FURNITURE_DESK: SpriteData = [
//  0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16   17   18   19   20   21   22   23   24   25   26   27
  [ DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_, DH_ ], // 0
  [ DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT  ], // 1
  [ DT,  DT,  DT,  MC2, MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC2, DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT  ], // 2  monitor bottom
  [ DT,  DT,  DT,  MC,  MS,  MS,  MS,  MS,  MS,  MS,  MS,  MS,  MS,  MS,  MS,  MS,  MS,  MS,  MS,  MC,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT  ], // 3
  [ DT,  DT,  DT,  MC,  MS,  MG,  MG,  MG,  MG,  MG,  MG,  MG,  MG,  MG,  MG,  MG,  MG,  MG,  MS,  MC,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT  ], // 4  screen glow
  [ DT,  DT,  DT,  MC,  MS,  MS,  MG,  MS,  MS,  MG,  MS,  MS,  MG,  MS,  MG,  MS,  MS,  MS,  MS,  MC,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT  ], // 5  code lines
  [ DT,  DT,  DT,  MC2, MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC,  MC2, DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT  ], // 6  monitor top
  [ DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  MB,  MB,  MB,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT,  DT  ], // 7  stand
  [ DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS  ], // 8  face top
  [ DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS,  DS  ], // 9  face
  [ DL,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  DL,  DL,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  DL  ], // 10 legs
  [ DL,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  DL,  DL,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  DL  ], // 11
  [ DL,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  DL,  DL,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  DL  ], // 12
  [ DL,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  DL,  DL,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  DL  ], // 13
];

// ── Office Chair  (16 × 11 px) ────────────────────────────────────────────
const CB  = '#2a2a2a';  // chair back/frame
const CCS = '#b8b0a0';  // cloth shadow
const CH_ = '#e0d8c8';  // cushion
const CL  = '#1a1a1a';  // leg metal

export const FURNITURE_CHAIR: SpriteData = [
//  0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15
  [  _,   _,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,   _,   _ ],
  [  _,   _,  CB, CH_, CH_, CH_, CH_, CH_, CH_, CH_, CH_, CH_, CH_,  CB,   _,   _ ],
  [  _,   _,  CB, CH_, CCS, CCS, CCS, CCS, CCS, CCS, CCS, CCS, CH_,  CB,   _,   _ ],
  [  _,   _,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,   _,   _ ],
  [  _,   _,   _,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,  CB,   _,   _,   _ ],
  [  _,   _,  CB, CH_, CH_, CH_, CH_, CH_, CH_, CH_, CH_, CH_, CH_,  CB,   _,   _ ],
  [  _,   _,  CB, CCS, CCS, CCS, CCS, CCS, CCS, CCS, CCS, CCS, CCS,  CB,   _,   _ ],
  [  _,   _,   _,  CL,   _,   _,   _,   _,   _,   _,   _,   _,  CL,   _,   _,   _ ],
  [  _,  CL,   _,  CL,   _,   _,   _,   _,   _,   _,   _,   _,  CL,   _,  CL,   _ ],
  [  _,  CL,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  CL,   _ ],
  [ CL,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  CL ],
];

// ── Tropical plant  (14 × 18 px) ──────────────────────────────────────────
const GD  = '#1a7a40';
const GM  = '#27ae60';
const GL  = '#2ecc71';
const GH_ = '#52d98a';
const SB  = '#6d4c41';
const PB  = '#795548';
const PH_ = '#a1887f';
const PS  = '#4e342e';

export const FURNITURE_PLANT: SpriteData = [
  [  _,   _,   _,   _,   _,  GH_, GL,   _,   _,   _,   _,   _,   _,   _ ],
  [  _,   _,  GH_, GL,  GL,  GM,  GM,  GL,  GH_,  _,   _,   _,   _,   _ ],
  [  _,  GH_, GM,  GM,  GD,  GD,  GM,  GM,  GM,  GL,   _,   _,   _,   _ ],
  [ GL,  GM,  GD,  GM,  GD,  GM,  GM,  GD,  GM,  GM,  GL,   _,   _,   _ ],
  [ GL,  GM,  GM,  GH_, GM,  GD,  GD,  GM,  GH_, GM,  GL,   _,   _,   _ ],
  [  _,  GL,  GM,  GM,  GD,  GM,  GM,  GD,  GM,  GL,   _,   _,   _,   _ ],
  [  _,   _,  GL,  GD,  GM,  GM,  GM,  GM,  GD,  GL,   _,   _,   _,   _ ],
  [  _,   _,   _,  GD,  GD,  GM,  GM,  GD,  GD,   _,   _,   _,   _,   _ ],
  [  _,   _,   _,   _,  GD,  GD,  GD,  GD,   _,   _,   _,   _,   _,   _ ],
  [  _,   _,   _,   _,  GD,  GD,  GD,  GD,   _,   _,   _,   _,   _,   _ ],
  [  _,   _,   _,  SB,  SB,  SB,  SB,  SB,  SB,   _,   _,   _,   _,   _ ],
  [  _,   _,  PH_, PB,  PB,  PB,  PB,  PB,  PB,  PH_,  _,   _,   _,   _ ],
  [  _,   _,  PB,  PB,  PB,  PB,  PB,  PB,  PB,  PB,  PB,   _,   _,   _ ],
  [  _,   _,  PB,  PB,  PS,  PS,  PS,  PS,  PS,  PB,  PB,   _,   _,   _ ],
  [  _,   _,  PH_, PB,  PB,  PB,  PB,  PB,  PB,  PB,  PH_,  _,   _,   _ ],
  [  _,   _,   _,  PH_, PB,  PB,  PB,  PB,  PB,  PH_,  _,   _,   _,   _ ],
  [  _,   _,   _,   _,  PS,  PS,  PS,  PS,  PS,   _,   _,   _,   _,   _ ],
  [  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _ ],
];

// ── Server rack  (16 × 24 px) ─────────────────────────────────────────────
const SK2 = '#2c3e50';
const SF  = '#3d5166';
const SG  = '#00ff88';
const SO  = '#ff8800';
const SR  = '#ff3030';
const SW  = '#ffffff';
const SV  = '#44aaff';
const SBT = '#1a2535';

export const FURNITURE_SERVER: SpriteData = [
  [ SK2, SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SK2 ],
  [ SK2, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SK2 ],
  [ SK2, SBT, SG,  SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SG,  SBT, SK2 ],
  [ SK2, SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SK2 ],
  [ SK2, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SK2 ],
  [ SK2, SBT, SO,  SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SO,  SBT, SK2 ],
  [ SK2, SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SK2 ],
  [ SK2, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SK2 ],
  [ SK2, SBT, SG,  SBT, SO,  SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SG,  SBT, SK2 ],
  [ SK2, SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SK2 ],
  [ SK2, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SK2 ],
  [ SK2, SBT, SV,  SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SV,  SBT, SK2 ],
  [ SK2, SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SK2 ],
  [ SK2, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SK2 ],
  [ SK2, SBT, SR,  SBT, SBT, SG,  SW,  SBT, SBT, SG,  SW,  SBT, SBT, SR,  SBT, SK2 ],
  [ SK2, SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SK2 ],
  [ SK2, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SK2 ],
  [ SK2, SBT, SG,  SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SG,  SBT, SK2 ],
  [ SK2, SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SF,  SK2 ],
  [ SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT, SBT ],
  [  _,  SK2, SK2,  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  SK2, SK2,  _ ],
  [  _,  SK2,  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  SK2,  _,   _ ],
  [  _,  SK2,  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  SK2,  _,   _ ],
  [  _,  SK2,  _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  SK2,  _,   _ ],
];

// ── Bookshelf  (16 × 20 px) ───────────────────────────────────────────────
const WD   = '#8b6914';
const WDL  = '#a07828';
const WDS  = '#6b5010';
const BR1  = '#e74c3c'; const BR2  = '#c0392b';
const BBL1 = '#3498db'; const BBL2 = '#2980b9';
const BG1  = '#27ae60'; const BG2  = '#1e8449';
const BY1  = '#f39c12'; const BY2  = '#d68910';
const BV1  = '#9b59b6'; const BV2  = '#7d3c98';
const BGR  = '#7f8c8d'; const BGR2 = '#626567';

export const FURNITURE_BOOKSHELF: SpriteData = [
  [ WDL, WDL, WDL, WDL, WDL, WDL, WDL, WDL, WDL, WDL, WDL, WDL, WDL, WDL, WDL, WDL ],
  [ WD,  BR1, BR1, BR2, BBL1,BBL1,BBL2,BG1, BG2, BY1, BY1, BY2, BV1, BV2, BGR, WD  ],
  [ WD,  BR1, BR1, BR2, BBL1,BBL1,BBL2,BG1, BG2, BY1, BY1, BY2, BV1, BV2, BGR, WD  ],
  [ WD,  BR2, BR2, BR2, BBL2,BBL2,BBL2,BG2, BG2, BY2, BY2, BY2, BV2, BV2, BGR2,WD  ],
  [ WD,  BR1, BR1, BR2, BBL1,BBL1,BBL2,BG1, BG2, BY1, BY1, BY2, BV1, BV2, BGR, WD  ],
  [ WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS ],
  [ WD,  BV1, BV2, BG1, BY1, BY2, BR1, BBL1,BGR, BV1, BG1, BY1, BR1, BBL1,BGR, WD  ],
  [ WD,  BV1, BV2, BG1, BY1, BY2, BR1, BBL1,BGR, BV1, BG1, BY1, BR1, BBL1,BGR, WD  ],
  [ WD,  BV2, BV2, BG2, BY2, BY2, BR2, BBL2,BGR2,BV2, BG2, BY2, BR2, BBL2,BGR2,WD  ],
  [ WD,  BV1, BV2, BG1, BY1, BY2, BR1, BBL1,BGR, BV1, BG1, BY1, BR1, BBL1,BGR, WD  ],
  [ WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS ],
  [ WD,  BBL1,BG1, BR1, BY1, BV1, BGR, BBL1,BG1, BR1, BY1, BV1, BGR, BBL1,BG1, WD  ],
  [ WD,  BBL1,BG1, BR1, BY1, BV1, BGR, BBL1,BG1, BR1, BY1, BV1, BGR, BBL1,BG1, WD  ],
  [ WD,  BBL2,BG2, BR2, BY2, BV2, BGR2,BBL2,BG2, BR2, BY2, BV2, BGR2,BBL2,BG2, WD  ],
  [ WD,  BBL1,BG1, BR1, BY1, BV1, BGR, BBL1,BG1, BR1, BY1, BV1, BGR, BBL1,BG1, WD  ],
  [ WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS ],
  [ WD,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  WD  ],
  [ WD,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  WD  ],
  [ WD,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,   _,  WD  ],
  [ WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS, WDS ],
];

/* ══════════════════════════════════════════════════════════════════════════
   SPRITE COLLECTIONS & COLOR RESOLUTION
   ══════════════════════════════════════════════════════════════════════════ */

export const AGENT_SPRITES = {
  idle: [AGENT_IDLE_0, AGENT_IDLE_1],
  walk: [AGENT_WALK_0, AGENT_WALK_1, AGENT_WALK_2, AGENT_WALK_3],
  type: [AGENT_TYPE_0, AGENT_TYPE_1],
};

export interface AgentTheme {
  hair:    string;
  hair_l:  string;
  skin:    string;
  shirt:   string;
  shirt_l: string;
  shirt_d: string;
  pants:   string;
  pants_d: string;
  shoes:   string;
}

export const SKIN_COLOR = '#f5b88a';

export function agentThemeFromColor(baseColor: string): AgentTheme {
  return {
    hair:    darken(baseColor, 40),
    hair_l:  lighten(darken(baseColor, 20), 25),
    skin:    SKIN_COLOR,
    shirt:   baseColor,
    shirt_l: lighten(baseColor, 30),
    shirt_d: darken(baseColor, 35),
    pants:   darken(baseColor, 55),
    pants_d: darken(baseColor, 70),
    shoes:   darken(baseColor, 65),
  };
}

export function resolveSprite(sprite: SpriteData, theme: AgentTheme): SpriteData {
  return sprite.map(row =>
    row.map(pixel => {
      switch (pixel) {
        case '$hair':    return theme.hair;
        case '$hair_l':  return theme.hair_l;
        case '$skin':    return theme.skin;
        case '$shirt':   return theme.shirt;
        case '$shirt_l': return theme.shirt_l;
        case '$shirt_d': return theme.shirt_d;
        case '$pants':   return theme.pants;
        case '$pants_d': return theme.pants_d;
        case '$shoes':   return theme.shoes;
        default:         return pixel;
      }
    })
  );
}

function lighten(hex: string, pct: number): string { return blend(hex, '#ffffff', pct / 100); }
function darken(hex: string, pct: number): string  { return blend(hex, '#000000', pct / 100); }
function blend(hex: string, with_: string, t: number): string {
  const p = (h: string) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
  const [r1,g1,b1] = p(hex); const [r2,g2,b2] = p(with_);
  const r = Math.round(r1+(r2-r1)*t), g = Math.round(g1+(g2-g1)*t), b = Math.round(b1+(b2-b1)*t);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}
