/**
 * Buttons printed on the physical card face. Coordinates are in the card's
 * 640x960 logical canvas space; hit-testing converts from texture UV.
 */
export type CardButtonId =
  | "guest"
  | "stop"
  | "zoom"
  | "settings"
  | "clone"
  | "savepoint"
  | "performance"
  | "bin";

export const CARD_BUTTON_IDS: readonly CardButtonId[] = [
  "guest",
  "stop",
  "zoom",
  "settings",
  "clone",
  "savepoint",
  "performance",
  "bin",
];

export const CARD_CANVAS_WIDTH = 640;
export const CARD_CANVAS_HEIGHT = 960;

const COLUMNS = 4;
const LEFT = 48;
const TOP = 718;
const WIDTH = 130;
const HEIGHT = 40;
const GAP = 8;

export type CardButtonRect = { x: number; y: number; w: number; h: number };

export function cardButtonRect(index: number): CardButtonRect {
  const column = index % COLUMNS;
  const row = Math.floor(index / COLUMNS);
  return {
    x: LEFT + column * (WIDTH + GAP),
    y: TOP + row * (HEIGHT + GAP),
    w: WIDTH,
    h: HEIGHT,
  };
}

/** Finds the on-card button under a texture UV coordinate (v=0 is the card bottom). */
export function hitCardButton(u: number, v: number): CardButtonId | undefined {
  const x = u * CARD_CANVAS_WIDTH;
  const y = (1 - v) * CARD_CANVAS_HEIGHT;
  for (const [index, id] of CARD_BUTTON_IDS.entries()) {
    const rect = cardButtonRect(index);
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
      return id;
    }
  }
  return undefined;
}

export type FlipDotId =
  | "top-left"
  | "top-center"
  | "top-right"
  | "mid-left"
  | "center"
  | "mid-right"
  | "btm-left"
  | "btm-center"
  | "btm-right";

export const FLIP_DOT_IDS: readonly FlipDotId[] = [
  "top-left",
  "top-center",
  "top-right",
  "mid-left",
  "center",
  "mid-right",
  "btm-left",
  "btm-center",
  "btm-right",
] as const;

export const FLIP_DOT_LOCATIONS: Record<FlipDotId, { x: number; y: number; r: number }> = {
  "top-left": { x: 48, y: 48, r: 28 },
  "top-center": { x: 320, y: 48, r: 28 },
  "top-right": { x: 592, y: 48, r: 28 },
  "mid-left": { x: 48, y: 480, r: 28 },
  "center": { x: 320, y: 480, r: 28 },
  "mid-right": { x: 592, y: 480, r: 28 },
  "btm-left": { x: 48, y: 912, r: 28 },
  "btm-center": { x: 320, y: 912, r: 28 },
  "btm-right": { x: 592, y: 912, r: 28 },
};

/** Finds the tactile flip dot under a texture UV coordinate (v=0 is the card bottom). */
export function hitFlipDot(u: number, v: number): FlipDotId | undefined {
  const x = u * CARD_CANVAS_WIDTH;
  const y = (1 - v) * CARD_CANVAS_HEIGHT;
  for (const [id, dot] of Object.entries(FLIP_DOT_LOCATIONS) as [FlipDotId, { x: number; y: number; r: number }][]) {
    const dx = x - dot.x;
    const dy = y - dot.y;
    if (dx * dx + dy * dy <= dot.r * dot.r) {
      return id;
    }
  }
  return undefined;
}

