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
