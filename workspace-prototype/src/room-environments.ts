/**
 * Post Card Spatial OS — Room Environments Specification & Catalog
 * Centralizes full-room 3D thematic environments (Pixel Studio, Sunset Library,
 * Forest Emerald, Lavender Mist, Obsidian Monochrome, Cyber Mainframe).
 * Decouples 3D room environment definitions from 2D/3D card styles.
 */

// ============================================================================
// 1. Environment Identifiers & Catalog Constants
// ============================================================================

export const ROOM_ENVIRONMENT_IDS = [
  "pixel-studio",
  "sunset-library",
  "forest-emerald",
  "lavender-mist",
  "obsidian-monochrome",
  "cyber-mainframe",
] as const;

export type RoomEnvironmentId = (typeof ROOM_ENVIRONMENT_IDS)[number];

export const DEFAULT_ROOM_ENVIRONMENT_ID: RoomEnvironmentId = "pixel-studio";
export const ROOM_ENVIRONMENT_STORAGE_KEY = "postcard_studio_room_env";

// ============================================================================
// 2. Token Interfaces & Schemas
// ============================================================================

export type RoomPropsType =
  | "library-shelves"
  | "studio-frames"
  | "botanical-baffles"
  | "cyber-monoliths"
  | "minimal";

export interface RoomFogTokens {
  color: string;
  density: number;
}

export interface RoomFloorTokens {
  color: string;
  roughness: number;
  metalness: number;
  reflectivity?: number;
}

export interface RoomLightingTokens {
  ambientColor: string;
  ambientIntensity: number;
  keyColor: string;
  keyIntensity: number;
  keyPosition: [number, number, number];
  fillColor: string;
  fillIntensity: number;
  duskColor: string;
  duskIntensity: number;
}

export interface RoomEnvironmentDefinition {
  id: RoomEnvironmentId;
  name: string;
  description: string;
  background: string;
  fog: RoomFogTokens;
  floor: RoomFloorTokens;
  lighting: RoomLightingTokens;
  props: RoomPropsType;
  showCosmicStarfield: boolean;
}

// ============================================================================
// 3. Room Environments Catalog
// ============================================================================

export const ROOM_ENVIRONMENTS: Record<RoomEnvironmentId, RoomEnvironmentDefinition> = {
  "pixel-studio": {
    id: "pixel-studio",
    name: "Pixel Studio",
    description: "Clean architectural daylight, warm matte gray/birch floor, studio frame props.",
    background: "#e8eaed",
    fog: {
      color: "#e8eaed",
      density: 0.015,
    },
    floor: {
      color: "#d2d6dc",
      roughness: 0.85,
      metalness: 0.05,
      reflectivity: 0.1,
    },
    lighting: {
      ambientColor: "#ffffff",
      ambientIntensity: 0.7,
      keyColor: "#ffffff",
      keyIntensity: 1.2,
      keyPosition: [5, 10, 7],
      fillColor: "#e0e6ed",
      fillIntensity: 0.4,
      duskColor: "#9aa0a6",
      duskIntensity: 0.2,
    },
    props: "studio-frames",
    showCosmicStarfield: false,
  },
  "sunset-library": {
    id: "sunset-library",
    name: "Sunset Amber Library",
    description: "Golden-hour warmth, rich walnut desk surface, banker's lamp glow, wooden book alcove props.",
    background: "#23140c",
    fog: {
      color: "#23140c",
      density: 0.02,
    },
    floor: {
      color: "#3e2415",
      roughness: 0.65,
      metalness: 0.15,
      reflectivity: 0.25,
    },
    lighting: {
      ambientColor: "#ffd8a8",
      ambientIntensity: 0.4,
      keyColor: "#ff922b",
      keyIntensity: 1.4,
      keyPosition: [4, 8, 5],
      fillColor: "#d9480f",
      fillIntensity: 0.5,
      duskColor: "#5c270e",
      duskIntensity: 0.3,
    },
    props: "library-shelves",
    showCosmicStarfield: false,
  },
  "forest-emerald": {
    id: "forest-emerald",
    name: "Forest Emerald",
    description: "Botanical conservatory, deep slate/mossy matte surface, vertical bamboo/slate baffle props.",
    background: "#081a12",
    fog: {
      color: "#081a12",
      density: 0.025,
    },
    floor: {
      color: "#142c1e",
      roughness: 0.8,
      metalness: 0.1,
      reflectivity: 0.15,
    },
    lighting: {
      ambientColor: "#b2f2bb",
      ambientIntensity: 0.45,
      keyColor: "#51cf66",
      keyIntensity: 1.1,
      keyPosition: [4, 9, 6],
      fillColor: "#2b8a3e",
      fillIntensity: 0.4,
      duskColor: "#0b381e",
      duskIntensity: 0.25,
    },
    props: "botanical-baffles",
    showCosmicStarfield: false,
  },
  "lavender-mist": {
    id: "lavender-mist",
    name: "Lavender Mist",
    description: "Twilight horizon, frosted ambient glow, calm minimal architecture.",
    background: "#12101e",
    fog: {
      color: "#12101e",
      density: 0.02,
    },
    floor: {
      color: "#221c38",
      roughness: 0.75,
      metalness: 0.2,
      reflectivity: 0.3,
    },
    lighting: {
      ambientColor: "#e5dbff",
      ambientIntensity: 0.5,
      keyColor: "#b197fc",
      keyIntensity: 1.2,
      keyPosition: [3, 8, 6],
      fillColor: "#7950f2",
      fillIntensity: 0.35,
      duskColor: "#3b2d54",
      duskIntensity: 0.25,
    },
    props: "minimal",
    showCosmicStarfield: true,
  },
  "obsidian-monochrome": {
    id: "obsidian-monochrome",
    name: "Obsidian Monochrome",
    description: "Bauhaus gallery, matte carbon floor, crisp neutral overhead spots, zero glare.",
    background: "#0a0a0c",
    fog: {
      color: "#0a0a0c",
      density: 0.03,
    },
    floor: {
      color: "#16161a",
      roughness: 0.5,
      metalness: 0.4,
      reflectivity: 0.2,
    },
    lighting: {
      ambientColor: "#ced4da",
      ambientIntensity: 0.3,
      keyColor: "#ffffff",
      keyIntensity: 1.5,
      keyPosition: [0, 12, 4],
      fillColor: "#868e96",
      fillIntensity: 0.3,
      duskColor: "#343a40",
      duskIntensity: 0.2,
    },
    props: "minimal",
    showCosmicStarfield: false,
  },
  "cyber-mainframe": {
    id: "cyber-mainframe",
    name: "Cyber Mainframe",
    description: "The high-tech command deck, glowing telemetry dais, neural monolith towers with LED strips.",
    background: "#050811",
    fog: {
      color: "#050811",
      density: 0.02,
    },
    floor: {
      color: "#0c1427",
      roughness: 0.3,
      metalness: 0.7,
      reflectivity: 0.6,
    },
    lighting: {
      ambientColor: "#4dabf7",
      ambientIntensity: 0.4,
      keyColor: "#00f0ff",
      keyIntensity: 1.3,
      keyPosition: [5, 9, 7],
      fillColor: "#7048e8",
      fillIntensity: 0.45,
      duskColor: "#182848",
      duskIntensity: 0.3,
    },
    props: "cyber-monoliths",
    showCosmicStarfield: true,
  },
};

// ============================================================================
// 4. Type Guards, Lookup, and Persistence
// ============================================================================

/**
 * Type guard for RoomEnvironmentId.
 */
export function isValidRoomEnvironmentId(id: unknown): id is RoomEnvironmentId {
  return typeof id === "string" && (ROOM_ENVIRONMENT_IDS as readonly string[]).includes(id);
}

/**
 * Safe accessor returning a room environment definition with fallback to default environment.
 */
export function getRoomEnvironment(id: unknown): RoomEnvironmentDefinition {
  if (typeof id === "string" && Object.prototype.hasOwnProperty.call(ROOM_ENVIRONMENTS, id)) {
    return ROOM_ENVIRONMENTS[id as RoomEnvironmentId];
  }
  return ROOM_ENVIRONMENTS[DEFAULT_ROOM_ENVIRONMENT_ID];
}

/**
 * Reads persisted room environment from localStorage with safe fallback.
 */
export function loadPersistedRoomEnvironment(): RoomEnvironmentId {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(ROOM_ENVIRONMENT_STORAGE_KEY);
      if (isValidRoomEnvironmentId(saved)) {
        return saved;
      }
    }
  } catch {
    // Ignore access error in sandboxed or SSR contexts
  }
  return DEFAULT_ROOM_ENVIRONMENT_ID;
}

/**
 * Persists room environment preference to localStorage.
 */
export function persistRoomEnvironment(id: RoomEnvironmentId | string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ROOM_ENVIRONMENT_STORAGE_KEY, id);
    }
  } catch (err) {
    console.warn("Unable to persist room environment to localStorage:", err);
  }
}
