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

/* -------------------------------------------------------------------------- */
/* 9-dot tactile flip matrix                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every facet addressable from the physical card. "patent", "tensor" and
 * "streams" are the three diagnostic enclaves that live behind the card's
 * diagonal corner dots.
 */
export type TactileFacet =
  | "front"
  | "back"
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "patent"
  | "tensor"
  | "streams";

export type TactileCell = {
  row: 0 | 1 | 2;
  col: 0 | 1 | 2;
  facet: TactileFacet;
  label: string;
  /** Corner dots travel on two axes at once into a diagnostic enclave. */
  compound: boolean;
};

/**
 * The 3×3 matrix is laid out like a numpad: cardinals on the edges, the six
 * card facets on the cross, and the three enclaves plus settings on the
 * corners. Corners use a compound diagonal flip.
 */
export const TACTILE_GRID: readonly TactileCell[] = [
  { row: 0, col: 0, facet: "patent", label: "07 PATENT", compound: true },
  { row: 0, col: 1, facet: "top", label: "05 ACTIONS", compound: false },
  { row: 0, col: 2, facet: "tensor", label: "08 TENSOR", compound: true },
  { row: 1, col: 0, facet: "left", label: "03 SECURITY", compound: false },
  { row: 1, col: 1, facet: "front", label: "01 DISPLAY", compound: false },
  { row: 1, col: 2, facet: "right", label: "04 PLANES", compound: false },
  { row: 2, col: 0, facet: "streams", label: "09 STREAMS", compound: true },
  { row: 2, col: 1, facet: "bottom", label: "06 PORTS", compound: false },
  { row: 2, col: 2, facet: "back", label: "02 SETTINGS", compound: true },
];

/**
 * The matrix lives on its own control rail to the right of the live display
 * framebuffer, so it never covers guest pixels or the display's twist badge.
 * Keep these in sync with the preview geometry in main.ts.
 */
const GRID_X = 508;
const GRID_Y = 500;
const CELL_SIZE = 27;
const CELL_GAP = 6;
const GRID_SPAN = CELL_SIZE * 3 + CELL_GAP * 2;

export function tactileCellRect(cell: TactileCell): CardButtonRect {
  return {
    x: GRID_X + cell.col * (CELL_SIZE + CELL_GAP),
    y: GRID_Y + cell.row * (CELL_SIZE + CELL_GAP),
    w: CELL_SIZE,
    h: CELL_SIZE,
  };
}

export function tactileGridBounds(): CardButtonRect {
  return { x: GRID_X, y: GRID_Y, w: GRID_SPAN, h: GRID_SPAN };
}

/** Hit-tests the 3×3 tactile matrix from a texture UV coordinate. */
export function hitTactileCell(u: number, v: number): TactileCell | undefined {
  const x = u * CARD_CANVAS_WIDTH;
  const y = (1 - v) * CARD_CANVAS_HEIGHT;
  for (const cell of TACTILE_GRID) {
    const rect = tactileCellRect(cell);
    if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h) {
      return cell;
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* Diagnostic bench enclaves (facets 07 / 08 / 09)                             */
/* -------------------------------------------------------------------------- */

export type DiagnosticFacet = "patent" | "tensor" | "streams";
export type DiagnosticAction = "run" | "fault";

export type DiagnosticBench = {
  id: string;
  label: string;
  tag: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

const BENCH_X = 48;
const BENCH_W = 544;
const BENCH_H = 168;

export const DIAGNOSTIC_BENCHES: Record<DiagnosticFacet, readonly DiagnosticBench[]> = {
  patent: [
    { id: "omegalog-upg", label: "OmegaLog UPG", tag: "UNIFIED PATENT GRANT LEDGER", x: BENCH_X, y: 158, w: BENCH_W, h: BENCH_H },
    { id: "datameld-pvm", label: "DataMeld PVM", tag: "PATENT VAULT MESH", x: BENCH_X, y: 344, w: BENCH_W, h: BENCH_H },
    { id: "chaos-injection", label: "Chaos Injection", tag: "DETERMINISTIC FAULT RAIL", x: BENCH_X, y: 530, w: BENCH_W, h: BENCH_H },
  ],
  tensor: [
    { id: "slm-memory-sharing", label: "SLM Memory Sharing", tag: "INTER-KERNEL SHARED PAGES", x: BENCH_X, y: 158, w: BENCH_W, h: BENCH_H },
    { id: "kernel-tensor-enclave", label: "Kernel Tensor Enclave", tag: "SLM TENSOR WORKBENCH", x: BENCH_X, y: 344, w: BENCH_W, h: BENCH_H },
    { id: "tensor-chaos", label: "Tensor Chaos", tag: "FAULT INJECTION PROBE", x: BENCH_X, y: 530, w: BENCH_W, h: BENCH_H },
  ],
  streams: [
    { id: "diov-streams", label: "DIOV Streams", tag: "LIVE STREAM INSPECTOR", x: BENCH_X, y: 158, w: BENCH_W, h: BENCH_H },
    { id: "diov-fault-rail", label: "Stream Fault Rail", tag: "PACKET LOSS INJECTOR", x: BENCH_X, y: 344, w: BENCH_W, h: BENCH_H },
    { id: "diov-replay", label: "DIOV Replay", tag: "DETERMINISTIC REPLAY BUFFER", x: BENCH_X, y: 530, w: BENCH_W, h: BENCH_H },
  ],
};

export function benchActionRect(bench: DiagnosticBench, action: DiagnosticAction): CardButtonRect {
  return action === "run"
    ? { x: bench.x + 16, y: bench.y + bench.h - 54, w: 168, h: 38 }
    : { x: bench.x + bench.w - 192, y: bench.y + bench.h - 54, w: 176, h: 38 };
}

/** Finds a diagnostic bench hitbox from a texture UV coordinate. */
export function hitDiagnosticBench(
  facet: DiagnosticFacet,
  u: number,
  v: number,
): { bench: DiagnosticBench; action: DiagnosticAction } | undefined {
  const x = u * CARD_CANVAS_WIDTH;
  const y = (1 - v) * CARD_CANVAS_HEIGHT;
  for (const bench of DIAGNOSTIC_BENCHES[facet]) {
    const run = benchActionRect(bench, "run");
    if (x >= run.x && x <= run.x + run.w && y >= run.y && y <= run.y + run.h) {
      return { bench, action: "run" };
    }
    const fault = benchActionRect(bench, "fault");
    if (x >= fault.x && x <= fault.x + fault.w && y >= fault.y && y <= fault.y + fault.h) {
      return { bench, action: "fault" };
    }
  }
  return undefined;
}

export function isDiagnosticFacet(facet: string): facet is DiagnosticFacet {
  return facet === "patent" || facet === "tensor" || facet === "streams";
}
