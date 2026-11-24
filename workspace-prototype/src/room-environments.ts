/**
 * Two-axis studio catalog.
 *
 * Axis 1 — the room environment: background, fog, PBR floor/wall materials,
 * lighting rig and the thematic prop set that is visible in the stage.
 * Axis 2 — the card face style: the surface treatment baked into every card
 * texture. Both axes are independent so any room can be mixed with any style.
 */

export type RoomEnvironmentId =
  | "pixel-studio"
  | "sunset-library"
  | "forest-emerald"
  | "lavender-mist"
  | "obsidian-monochrome"
  | "cyber-mainframe";

export type RoomPropFlags = {
  monolithRacks: boolean;
  libraryShelves: boolean;
  studioFrames: boolean;
};

export type RoomLightConfig = {
  color: string;
  intensity: number;
  position: readonly [number, number, number];
};

export type RoomEnvironment = {
  id: RoomEnvironmentId;
  name: string;
  tagline: string;
  accent: string;
  background: string;
  fogColor: string;
  fogDensity: number;
  floor: { color: string; roughness: number; metalness: number };
  walls: { color: string; roughness: number; metalness: number };
  lighting: {
    hemisphere: { sky: string; ground: string; intensity: number };
    key: RoomLightConfig;
    fill: RoomLightConfig;
    rim: RoomLightConfig;
    dusk: RoomLightConfig;
    halo: string;
  };
  props: RoomPropFlags;
};

export const ROOM_ENVIRONMENT_STORAGE_KEY = "postcard-room-environment";
export const CARD_STYLE_STORAGE_KEY = "postcard-card-style";

export const DEFAULT_ROOM_ENVIRONMENT: RoomEnvironmentId = "cyber-mainframe";

export const ROOM_ENVIRONMENTS = {
  "pixel-studio": {
    id: "pixel-studio",
    name: "Pixel Studio",
    tagline: "Clean daylight bench with soft paper whites.",
    accent: "#7fd7ff",
    background: "#dfe8f5",
    fogColor: "#cfdcee",
    fogDensity: 0.028,
    floor: { color: "#b9c6d8", roughness: 0.62, metalness: 0.12 },
    walls: { color: "#e6edf7", roughness: 0.92, metalness: 0.02 },
    lighting: {
      hemisphere: { sky: "#ffffff", ground: "#a8b6c9", intensity: 1.8 },
      key: { color: "#fff6e8", intensity: 2.6, position: [-4, 10, 7] },
      fill: { color: "#cfe4ff", intensity: 22, position: [6, 5, -4] },
      rim: { color: "#ffe4c2", intensity: 16, position: [-7, 4, 2] },
      dusk: { color: "#e6eefc", intensity: 9, position: [0, 8, -7] },
      halo: "#7fd7ff",
    },
    props: { monolithRacks: false, libraryShelves: false, studioFrames: true },
  },
  "sunset-library": {
    id: "sunset-library",
    name: "Sunset Library",
    tagline: "Warm oak shelves under a low amber sun.",
    accent: "#f0a86a",
    background: "#3a2318",
    fogColor: "#4a2c1c",
    fogDensity: 0.03,
    floor: { color: "#2e1c12", roughness: 0.34, metalness: 0.5 },
    walls: { color: "#4a2f1e", roughness: 0.82, metalness: 0.08 },
    lighting: {
      hemisphere: { sky: "#ffd9b0", ground: "#2a160d", intensity: 1.15 },
      key: { color: "#ffbd7a", intensity: 2.5, position: [-5, 8, 6] },
      fill: { color: "#ff9350", intensity: 28, position: [6, 4, -5] },
      rim: { color: "#ffd9a0", intensity: 21, position: [-6, 5, 2] },
      dusk: { color: "#c95d2c", intensity: 14, position: [0, 6, -7] },
      halo: "#ffb066",
    },
    props: { monolithRacks: false, libraryShelves: true, studioFrames: false },
  },
  "forest-emerald": {
    id: "forest-emerald",
    name: "Forest Emerald",
    tagline: "Canopy-filtered green light over mossy stone.",
    accent: "#6fe0a8",
    background: "#0a241b",
    fogColor: "#0f3327",
    fogDensity: 0.026,
    floor: { color: "#0c1f18", roughness: 0.28, metalness: 0.62 },
    walls: { color: "#123527", roughness: 0.86, metalness: 0.1 },
    lighting: {
      hemisphere: { sky: "#c9ffe4", ground: "#062018", intensity: 1.3 },
      key: { color: "#9dffd0", intensity: 2.15, position: [-4, 9, 5] },
      fill: { color: "#3fd694", intensity: 30, position: [6, 4, -5] },
      rim: { color: "#a6ffd9", intensity: 22, position: [-7, 5, 1] },
      dusk: { color: "#2f8f6a", intensity: 13, position: [0, 7, -7] },
      halo: "#5fdca0",
    },
    props: { monolithRacks: false, libraryShelves: true, studioFrames: false },
  },
  "lavender-mist": {
    id: "lavender-mist",
    name: "Lavender Mist",
    tagline: "Hazy violet dawn with diffused pastel light.",
    accent: "#c6a6ff",
    background: "#1e1733",
    fogColor: "#2b2148",
    fogDensity: 0.036,
    floor: { color: "#191228", roughness: 0.2, metalness: 0.74 },
    walls: { color: "#2a2044", roughness: 0.9, metalness: 0.06 },
    lighting: {
      hemisphere: { sky: "#efe6ff", ground: "#170f2b", intensity: 1.45 },
      key: { color: "#e3d4ff", intensity: 2.05, position: [-5, 9, 7] },
      fill: { color: "#a98cff", intensity: 30, position: [6, 5, -3] },
      rim: { color: "#ffc9ef", intensity: 20, position: [-6, 4, 2] },
      dusk: { color: "#7a5fd6", intensity: 15, position: [0, 8, -7] },
      halo: "#c6a6ff",
    },
    props: { monolithRacks: false, libraryShelves: false, studioFrames: true },
  },
  "obsidian-monochrome": {
    id: "obsidian-monochrome",
    name: "Obsidian Monochrome",
    tagline: "Sculptural black gallery with a single silver key.",
    accent: "#d6dbe4",
    background: "#08090b",
    fogColor: "#111318",
    fogDensity: 0.022,
    floor: { color: "#050608", roughness: 0.08, metalness: 0.96 },
    walls: { color: "#14161a", roughness: 0.7, metalness: 0.3 },
    lighting: {
      hemisphere: { sky: "#f2f5fa", ground: "#000000", intensity: 1.05 },
      key: { color: "#ffffff", intensity: 2.9, position: [-4, 10, 6] },
      fill: { color: "#b9c2cf", intensity: 18, position: [6, 5, -5] },
      rim: { color: "#e8edf5", intensity: 24, position: [-7, 4, 2] },
      dusk: { color: "#8792a3", intensity: 8, position: [0, 7, -7] },
      halo: "#e8edf5",
    },
    props: { monolithRacks: false, libraryShelves: false, studioFrames: false },
  },
  "cyber-mainframe": {
    id: "cyber-mainframe",
    name: "Cyber Mainframe",
    tagline: "Twin neural racks in the twilight server hall.",
    accent: "#79ded8",
    background: "#0a1020",
    fogColor: "#101a30",
    fogDensity: 0.022,
    floor: { color: "#070b14", roughness: 0.16, metalness: 0.88 },
    walls: { color: "#111a31", roughness: 0.88, metalness: 0.24 },
    lighting: {
      hemisphere: { sky: "#d9e7ff", ground: "#11162d", intensity: 1.35 },
      key: { color: "#8fe3e2", intensity: 2.2, position: [-4, 9, 6] },
      fill: { color: "#a89bff", intensity: 34, position: [6, 5, -5] },
      rim: { color: "#54d6cf", intensity: 25, position: [-6, 4, 2] },
      dusk: { color: "#e495a4", intensity: 12, position: [0, 7, -7] },
      halo: "#ffb81c",
    },
    props: { monolithRacks: true, libraryShelves: false, studioFrames: false },
  },
} as const satisfies Record<RoomEnvironmentId, RoomEnvironment>;

export const ROOM_ENVIRONMENT_ORDER: readonly RoomEnvironmentId[] = [
  "pixel-studio",
  "sunset-library",
  "forest-emerald",
  "lavender-mist",
  "obsidian-monochrome",
  "cyber-mainframe",
];

export type CardStyleId = "signature" | "blueprint" | "hologram" | "carbon";

export type CardStyle = {
  id: CardStyleId;
  name: string;
  description: string;
  background: readonly [string, string, string];
  /** Extra hairline grid drawn over the face; null keeps the plain surface. */
  gridColor: string | null;
  /** Overrides every facet accent when set. */
  accent: string | null;
  glowAlpha: number;
};

export const CARD_STYLES: Record<CardStyleId, CardStyle> = {
  signature: {
    id: "signature",
    name: "Signature",
    description: "Graphite card stock with per-facet neon accents.",
    background: ["#14161b", "#0d111a", "#0d111a"],
    gridColor: null,
    accent: null,
    glowAlpha: 0.09,
  },
  blueprint: {
    id: "blueprint",
    name: "Blueprint",
    description: "Engineer's blue with a measured grid and white ink.",
    background: ["#0b2138", "#07172a", "#061220"],
    gridColor: "rgba(127, 215, 255, 0.14)",
    accent: "#7fd7ff",
    glowAlpha: 0.12,
  },
  hologram: {
    id: "hologram",
    name: "Hologram",
    description: "Iridescent film with magenta scanlines.",
    background: ["#241034", "#160a24", "#0e0718"],
    gridColor: "rgba(255, 157, 226, 0.16)",
    accent: "#ff9de2",
    glowAlpha: 0.14,
  },
  carbon: {
    id: "carbon",
    name: "Carbon",
    description: "Matte weave with brushed steel type.",
    background: ["#141414", "#0a0a0a", "#050505"],
    gridColor: "rgba(214, 219, 228, 0.08)",
    accent: "#d6dbe4",
    glowAlpha: 0.06,
  },
};

export const CARD_STYLE_ORDER: readonly CardStyleId[] = [
  "signature",
  "blueprint",
  "hologram",
  "carbon",
];

export const DEFAULT_CARD_STYLE: CardStyleId = "signature";

export function isRoomEnvironmentId(value: unknown): value is RoomEnvironmentId {
  return typeof value === "string" && value in ROOM_ENVIRONMENTS;
}

export function isCardStyleId(value: unknown): value is CardStyleId {
  return typeof value === "string" && value in CARD_STYLES;
}

type ReadableStorage = Pick<Storage, "getItem"> | null | undefined;
type WritableStorage = Pick<Storage, "setItem"> | null | undefined;

export function loadRoomEnvironment(storage: ReadableStorage = globalThis.localStorage): RoomEnvironmentId {
  try {
    const value = storage?.getItem(ROOM_ENVIRONMENT_STORAGE_KEY);
    return isRoomEnvironmentId(value) ? value : DEFAULT_ROOM_ENVIRONMENT;
  } catch {
    return DEFAULT_ROOM_ENVIRONMENT;
  }
}

export function saveRoomEnvironment(id: RoomEnvironmentId, storage: WritableStorage = globalThis.localStorage): void {
  try {
    storage?.setItem(ROOM_ENVIRONMENT_STORAGE_KEY, id);
  } catch {
    /* Storage can be blocked in private or embedded contexts; the studio still runs. */
  }
}

export function loadCardStyle(storage: ReadableStorage = globalThis.localStorage): CardStyleId {
  try {
    const value = storage?.getItem(CARD_STYLE_STORAGE_KEY);
    return isCardStyleId(value) ? value : DEFAULT_CARD_STYLE;
  } catch {
    return DEFAULT_CARD_STYLE;
  }
}

export function saveCardStyle(id: CardStyleId, storage: WritableStorage = globalThis.localStorage): void {
  try {
    storage?.setItem(CARD_STYLE_STORAGE_KEY, id);
  } catch {
    /* Ignore storage failures. */
  }
}

/** A named mix of both axes, offered by the Quick Presets row. */
export type StudioPreset = {
  id: string;
  name: string;
  room: RoomEnvironmentId;
  cardStyle: CardStyleId;
};

/**
 * Overlay grades sit on top of the room rig. "twilight" deliberately repaints
 * nothing but the card halo and exposure, so every room keeps its own palette.
 */
export type ColorGradeId = "twilight" | "cyberpunk" | "monochrome" | "vintage";

export type ColorGrade = {
  id: ColorGradeId;
  halo: { color: string; intensity: number };
  floorGlow: { color: string; intensity: number };
  exposure: number;
  /** Lights this grade repaints; omitted entries keep the room's own colour. */
  lights?: Partial<Record<"fill" | "rim" | "dusk", string>>;
};

export const COLOR_GRADES: Record<ColorGradeId, ColorGrade> = {
  twilight: {
    id: "twilight",
    halo: { color: "#ffb81c", intensity: 48 },
    floorGlow: { color: "#70d5cf", intensity: 32 },
    exposure: 1.12,
  },
  cyberpunk: {
    id: "cyberpunk",
    halo: { color: "#00ffff", intensity: 60 },
    floorGlow: { color: "#ff007f", intensity: 42 },
    exposure: 1.35,
    lights: { fill: "#7928ca", rim: "#00f0ff", dusk: "#ff007f" },
  },
  monochrome: {
    id: "monochrome",
    halo: { color: "#00ff66", intensity: 52 },
    floorGlow: { color: "#00ff66", intensity: 35 },
    exposure: 1.05,
    lights: { fill: "#003311", rim: "#00ff66", dusk: "#001a00" },
  },
  vintage: {
    id: "vintage",
    halo: { color: "#ffaa44", intensity: 40 },
    floorGlow: { color: "#e69138", intensity: 26 },
    exposure: 0.98,
    lights: { fill: "#b45f06", rim: "#ffd966", dusk: "#783f04" },
  },
};

export const DEFAULT_COLOR_GRADE: ColorGradeId = "twilight";

/** SecOps tints the active room's fill and rim instead of imposing a palette. */
export const SECOPS_TINT = { fill: "#e59ba3", rim: "#a99afa" } as const;

export function isColorGradeId(value: unknown): value is ColorGradeId {
  return typeof value === "string" && value in COLOR_GRADES;
}

export type StudioLighting = {
  hemisphere: RoomEnvironment["lighting"]["hemisphere"];
  key: RoomLightConfig;
  fill: RoomLightConfig;
  rim: RoomLightConfig;
  dusk: RoomLightConfig;
  halo: { color: string; intensity: number };
  floorGlow: { color: string; intensity: number };
  exposure: number;
};

/**
 * Resolves the room rig with the active overlays. Precedence is room < SecOps
 * tint < colour grade, so switching rooms keeps overlays and clearing an
 * overlay can never resurrect the previous room's palette.
 */
export function resolveStudioLighting(
  roomId: RoomEnvironmentId,
  gradeId: ColorGradeId = DEFAULT_COLOR_GRADE,
  secOpsMode = false,
): StudioLighting {
  const room = ROOM_ENVIRONMENTS[roomId];
  const grade = COLOR_GRADES[gradeId] ?? COLOR_GRADES[DEFAULT_COLOR_GRADE];
  const lights = grade.lights ?? {};
  const tint = (light: RoomLightConfig, slot: "fill" | "rim" | "dusk"): RoomLightConfig => ({
    ...light,
    color: lights[slot] ?? (secOpsMode && slot !== "dusk" ? SECOPS_TINT[slot] : light.color),
  });
  return {
    hemisphere: room.lighting.hemisphere,
    key: room.lighting.key,
    fill: tint(room.lighting.fill, "fill"),
    rim: tint(room.lighting.rim, "rim"),
    dusk: tint(room.lighting.dusk, "dusk"),
    halo: grade.halo,
    floorGlow: grade.floorGlow,
    exposure: grade.exposure,
  };
}

export const STUDIO_PRESETS: readonly StudioPreset[] = [
  { id: "twilight", name: "Twilight Atelier", room: "cyber-mainframe", cardStyle: "signature" },
  { id: "workshop", name: "Daylight Workshop", room: "pixel-studio", cardStyle: "blueprint" },
  { id: "reading-room", name: "Reading Room", room: "sunset-library", cardStyle: "carbon" },
  { id: "night-lab", name: "Night Lab", room: "obsidian-monochrome", cardStyle: "hologram" },
];
