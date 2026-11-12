/**
 * Post Card Spatial OS — Card Themes Specification & Catalog
 * Centralizes color palettes, canvas tokens, 3D PBR materials, scene lighting,
 * and 2D Home View CSS tokens across 5 canonical themes.
 */

export type CardThemeId =
  | "classic"
  | "cyberpunk"
  | "minimal-dark"
  | "glass"
  | "material-vibrant";

export const CARD_THEME_IDS: readonly CardThemeId[] = [
  "classic",
  "cyberpunk",
  "minimal-dark",
  "glass",
  "material-vibrant",
] as const;

export const DEFAULT_CARD_THEME_ID: CardThemeId = "classic";
export const CARD_THEME_STORAGE_KEY = "postcard_studio_card_theme";

/**
 * 2D Canvas drawing tokens for procedural card texture rasterization (1280x1920 at 2X).
 */
export interface CanvasThemeTokens {
  bgTop: string;
  bgBottom: string;
  bgGradientStop?: number;
  borderStroke: string;
  borderWidth: number;
  badgeColor: string;
  headerColor: string;
  titleColor: string;
  detailColor: string;
  buttonFill: string;
  buttonStroke: string;
  buttonText: string;
  fastenerRim: string;
  fastenerHead: string;
}

/**
 * Three.js MeshStandardMaterial PBR properties for 3D card faces and edge chassis.
 */
export interface MaterialThemeTokens {
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  edgeColor?: string;
  edgeEmissive?: string;
  edgeEmissiveIntensity?: number;
  edgeRoughness?: number;
  edgeMetalness?: number;
}

/**
 * Spatial PointLight parameters for card halo and floor glow illumination.
 */
export interface LightingThemeTokens {
  haloColor: string;
  haloIntensity: number;
  floorGlowColor: string;
  floorGlowIntensity: number;
}

/**
 * CSS custom properties and styles for .home-system-card on #home-view.
 */
export interface HomeCssThemeTokens {
  cardBg: string;
  cardBorder: string;
  cardAccent: string;
  cardGlow: string;
  badgeBg: string;
  badgeText: string;
  "--home-card-bg"?: string;
  "--home-card-border"?: string;
  "--home-card-accent"?: string;
  "--home-card-glow"?: string;
  "--home-badge-bg"?: string;
  "--home-badge-text"?: string;
}

/**
 * Full card theme definition uniting 2D and 3D appearance parameters.
 */
export interface CardThemeDefinition {
  id: CardThemeId;
  name: string;
  tagline: string;
  description: string;
  swatchPrimary: string;
  swatchSecondary: string;
  canvas: CanvasThemeTokens;
  material: MaterialThemeTokens;
  lighting: LightingThemeTokens;
  homeCss: HomeCssThemeTokens;
}

/**
 * The 5 Canonical Themes catalog.
 */
export const CARD_THEMES: Record<CardThemeId, CardThemeDefinition> = {
  classic: {
    id: "classic",
    name: "Classic Studio",
    tagline: "Slate Cardstock · Cyan Precision",
    description: "Industrial precision laboratory instrumentation with understated technical cyan accents and tactile matte cardstock.",
    swatchPrimary: "#70d5cf",
    swatchSecondary: "#0d111a",
    canvas: {
      bgTop: "#14161b",
      bgBottom: "#0d111a",
      bgGradientStop: 0.58,
      borderStroke: "rgba(112, 213, 207, 0.35)",
      borderWidth: 2,
      badgeColor: "#70d5cf",
      headerColor: "#70d5cf",
      titleColor: "#f4f5f7",
      detailColor: "#c3c8d1",
      buttonFill: "rgba(7, 9, 14, 0.91)",
      buttonStroke: "rgba(112, 213, 207, 0.45)",
      buttonText: "#f4f5f7",
      fastenerRim: "#c3c8d1",
      fastenerHead: "#0d111a",
    },
    material: {
      roughness: 0.85,
      metalness: 0.05,
      emissive: "#ffffff",
      emissiveIntensity: 0.82,
      edgeColor: "#19212d",
      edgeEmissive: "#152631",
      edgeEmissiveIntensity: 0.22,
      edgeRoughness: 0.26,
      edgeMetalness: 0.82,
    },
    lighting: {
      haloColor: "#70d5cf",
      haloIntensity: 48,
      floorGlowColor: "#00e5ff",
      floorGlowIntensity: 32,
    },
    homeCss: {
      cardBg: "linear-gradient(135deg, rgba(20, 22, 27, 0.95), rgba(13, 17, 26, 0.88))",
      cardBorder: "rgba(112, 213, 207, 0.35)",
      cardAccent: "#70d5cf",
      cardGlow: "rgba(112, 213, 207, 0.15)",
      badgeBg: "rgba(112, 213, 207, 0.12)",
      badgeText: "#70d5cf",
      "--home-card-bg": "linear-gradient(135deg, rgba(20, 22, 27, 0.95), rgba(13, 17, 26, 0.88))",
      "--home-card-border": "rgba(112, 213, 207, 0.35)",
      "--home-card-accent": "#70d5cf",
      "--home-card-glow": "rgba(112, 213, 207, 0.15)",
      "--home-badge-bg": "rgba(112, 213, 207, 0.12)",
      "--home-badge-text": "#70d5cf",
    },
  },

  cyberpunk: {
    id: "cyberpunk",
    name: "Cyberpunk Neon",
    tagline: "Obsidian High-Gloss · Magenta & Cyan Glow",
    description: "High-contrast futuristic terminal HUDs, dark synthwave aesthetics, and neon-drenched nightscapes with emissive radiance.",
    swatchPrimary: "#ff007f",
    swatchSecondary: "#00f0ff",
    canvas: {
      bgTop: "#0b0416",
      bgBottom: "#05020a",
      bgGradientStop: 0.50,
      borderStroke: "rgba(255, 0, 127, 0.75)",
      borderWidth: 2.5,
      badgeColor: "#ff007f",
      headerColor: "#00f0ff",
      titleColor: "#ffffff",
      detailColor: "rgba(0, 240, 255, 0.85)",
      buttonFill: "rgba(11, 4, 22, 0.95)",
      buttonStroke: "rgba(0, 240, 255, 0.70)",
      buttonText: "#00f0ff",
      fastenerRim: "#ff007f",
      fastenerHead: "#05020a",
    },
    material: {
      roughness: 0.30,
      metalness: 0.15,
      emissive: "#ff007f",
      emissiveIntensity: 0.95,
      edgeColor: "#080010",
      edgeEmissive: "#ff007f",
      edgeEmissiveIntensity: 0.55,
      edgeRoughness: 0.18,
      edgeMetalness: 0.90,
    },
    lighting: {
      haloColor: "#ff007f",
      haloIntensity: 60,
      floorGlowColor: "#00f0ff",
      floorGlowIntensity: 42,
    },
    homeCss: {
      cardBg: "linear-gradient(135deg, rgba(11, 4, 22, 0.96), rgba(5, 2, 10, 0.94))",
      cardBorder: "rgba(255, 0, 127, 0.65)",
      cardAccent: "#ff007f",
      cardGlow: "rgba(0, 240, 255, 0.25)",
      badgeBg: "rgba(255, 0, 127, 0.18)",
      badgeText: "#ff007f",
      "--home-card-bg": "linear-gradient(135deg, rgba(11, 4, 22, 0.96), rgba(5, 2, 10, 0.94))",
      "--home-card-border": "rgba(255, 0, 127, 0.65)",
      "--home-card-accent": "#ff007f",
      "--home-card-glow": "rgba(0, 240, 255, 0.25)",
      "--home-badge-bg": "rgba(255, 0, 127, 0.18)",
      "--home-badge-text": "#ff007f",
    },
  },

  "minimal-dark": {
    id: "minimal-dark",
    name: "Minimal Dark",
    tagline: "Pure AMOLED · Anti-Reflective Zinc",
    description: "Zero-distraction architectural focus with pure AMOLED black levels, zinc wireframes, and anti-reflective matte physics.",
    swatchPrimary: "#a1a1aa",
    swatchSecondary: "#000000",
    canvas: {
      bgTop: "#050505",
      bgBottom: "#000000",
      bgGradientStop: 0.65,
      borderStroke: "rgba(161, 161, 170, 0.28)",
      borderWidth: 1.5,
      badgeColor: "#e4e4e7",
      headerColor: "#a1a1aa",
      titleColor: "#f4f4f5",
      detailColor: "#71717a",
      buttonFill: "rgba(15, 15, 17, 0.95)",
      buttonStroke: "rgba(113, 113, 122, 0.35)",
      buttonText: "#e4e4e7",
      fastenerRim: "#52525b",
      fastenerHead: "#18181b",
    },
    material: {
      roughness: 0.96,
      metalness: 0.00,
      emissive: "#ffffff",
      emissiveIntensity: 0.70,
      edgeColor: "#080808",
      edgeEmissive: "#000000",
      edgeEmissiveIntensity: 0.00,
      edgeRoughness: 0.85,
      edgeMetalness: 0.40,
    },
    lighting: {
      haloColor: "#d4d4d8",
      haloIntensity: 30,
      floorGlowColor: "#27272a",
      floorGlowIntensity: 18,
    },
    homeCss: {
      cardBg: "linear-gradient(135deg, rgba(8, 8, 8, 0.98), rgba(0, 0, 0, 0.98))",
      cardBorder: "rgba(161, 161, 170, 0.25)",
      cardAccent: "#e4e4e7",
      cardGlow: "transparent",
      badgeBg: "rgba(161, 161, 170, 0.12)",
      badgeText: "#e4e4e7",
      "--home-card-bg": "linear-gradient(135deg, rgba(8, 8, 8, 0.98), rgba(0, 0, 0, 0.98))",
      "--home-card-border": "rgba(161, 161, 170, 0.25)",
      "--home-card-accent": "#e4e4e7",
      "--home-card-glow": "transparent",
      "--home-badge-bg": "rgba(161, 161, 170, 0.12)",
      "--home-badge-text": "#e4e4e7",
    },
  },

  glass: {
    id: "glass",
    name: "Glass / Frosted",
    tagline: "Translucent Ice Acrylic · Crystal Specular",
    description: "Spatial glassmorphism with frosted translucent icy acrylic, crystal refractive depth, and sky blue edge glints.",
    swatchPrimary: "#38bdf8",
    swatchSecondary: "rgba(26, 38, 57, 0.75)",
    canvas: {
      bgTop: "rgba(26, 38, 57, 0.75)",
      bgBottom: "rgba(13, 20, 32, 0.85)",
      bgGradientStop: 0.50,
      borderStroke: "rgba(186, 230, 253, 0.55)",
      borderWidth: 1.75,
      badgeColor: "#38bdf8",
      headerColor: "#93c5fd",
      titleColor: "#ffffff",
      detailColor: "#bae6fd",
      buttonFill: "rgba(24, 43, 73, 0.75)",
      buttonStroke: "rgba(56, 189, 248, 0.45)",
      buttonText: "#ffffff",
      fastenerRim: "#bae6fd",
      fastenerHead: "#0d1420",
    },
    material: {
      roughness: 0.15,
      metalness: 0.10,
      emissive: "#38bdf8",
      emissiveIntensity: 0.78,
      edgeColor: "#162232",
      edgeEmissive: "#38bdf8",
      edgeEmissiveIntensity: 0.30,
      edgeRoughness: 0.10,
      edgeMetalness: 0.30,
    },
    lighting: {
      haloColor: "#38bdf8",
      haloIntensity: 50,
      floorGlowColor: "#0284c7",
      floorGlowIntensity: 36,
    },
    homeCss: {
      cardBg: "linear-gradient(135deg, rgba(26, 38, 57, 0.75), rgba(13, 20, 32, 0.82))",
      cardBorder: "rgba(186, 230, 253, 0.45)",
      cardAccent: "#38bdf8",
      cardGlow: "rgba(56, 189, 248, 0.20)",
      badgeBg: "rgba(56, 189, 248, 0.15)",
      badgeText: "#38bdf8",
      "--home-card-bg": "linear-gradient(135deg, rgba(26, 38, 57, 0.75), rgba(13, 20, 32, 0.82))",
      "--home-card-border": "rgba(186, 230, 253, 0.45)",
      "--home-card-accent": "#38bdf8",
      "--home-card-glow": "rgba(56, 189, 248, 0.20)",
      "--home-badge-bg": "rgba(56, 189, 248, 0.15)",
      "--home-badge-text": "#38bdf8",
    },
  },

  "material-vibrant": {
    id: "material-vibrant",
    name: "Material Vibrant",
    tagline: "Android Expressive · Warm Amber & Violet",
    description: "Directly inspired by Android Expressive and Material You, featuring deep warm indigo surfaces, warm amber accents, and satin microtextures.",
    swatchPrimary: "#f59e0b",
    swatchSecondary: "#8b5cf6",
    canvas: {
      bgTop: "#181124",
      bgBottom: "#0e0918",
      bgGradientStop: 0.55,
      borderStroke: "rgba(245, 158, 11, 0.48)",
      borderWidth: 2,
      badgeColor: "#f59e0b",
      headerColor: "#8b5cf6",
      titleColor: "#fdf4ff",
      detailColor: "#d8b4fe",
      buttonFill: "rgba(28, 18, 44, 0.92)",
      buttonStroke: "rgba(245, 158, 11, 0.50)",
      buttonText: "#f59e0b",
      fastenerRim: "#f59e0b",
      fastenerHead: "#0e0918",
    },
    material: {
      roughness: 0.65,
      metalness: 0.15,
      emissive: "#ffffff",
      emissiveIntensity: 0.85,
      edgeColor: "#211832",
      edgeEmissive: "#8b5cf6",
      edgeEmissiveIntensity: 0.28,
      edgeRoughness: 0.35,
      edgeMetalness: 0.75,
    },
    lighting: {
      haloColor: "#f59e0b",
      haloIntensity: 52,
      floorGlowColor: "#8b5cf6",
      floorGlowIntensity: 38,
    },
    homeCss: {
      cardBg: "linear-gradient(135deg, rgba(24, 17, 36, 0.95), rgba(14, 9, 24, 0.92))",
      cardBorder: "rgba(245, 158, 11, 0.45)",
      cardAccent: "#f59e0b",
      cardGlow: "rgba(139, 92, 246, 0.22)",
      badgeBg: "rgba(245, 158, 11, 0.15)",
      badgeText: "#f59e0b",
      "--home-card-bg": "linear-gradient(135deg, rgba(24, 17, 36, 0.95), rgba(14, 9, 24, 0.92))",
      "--home-card-border": "rgba(245, 158, 11, 0.45)",
      "--home-card-accent": "#f59e0b",
      "--home-card-glow": "rgba(139, 92, 246, 0.22)",
      "--home-badge-bg": "rgba(245, 158, 11, 0.15)",
      "--home-badge-text": "#f59e0b",
    },
  },
};

/**
 * Type guard for CardThemeId.
 */
export function isValidCardThemeId(id: unknown): id is CardThemeId {
  return typeof id === "string" && (CARD_THEME_IDS as readonly string[]).includes(id);
}

/**
 * Safe accessor returning a theme definition with fallback to default theme.
 */
export function getCardTheme(id: unknown): CardThemeDefinition {
  if (isValidCardThemeId(id)) {
    return CARD_THEMES[id];
  }
  return CARD_THEMES[DEFAULT_CARD_THEME_ID];
}

/**
 * Reads persisted theme from localStorage with safe fallback.
 */
export function loadSavedTheme(): CardThemeId {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(CARD_THEME_STORAGE_KEY);
      if (isValidCardThemeId(saved)) {
        return saved;
      }
    }
  } catch {
    // Ignore access error in sandboxed or SSR contexts
  }
  return DEFAULT_CARD_THEME_ID;
}

/**
 * Persists theme preference to localStorage.
 */
export function saveTheme(id: CardThemeId): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CARD_THEME_STORAGE_KEY, id);
    }
  } catch (err) {
    console.warn("Unable to persist card theme to localStorage:", err);
  }
}
