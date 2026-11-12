/**
 * Post Card Spatial OS — Card Themes Specification & Catalog
 * Centralizes color palettes, canvas tokens, 3D PBR materials, scene lighting,
 * 2D Home View CSS tokens, Android Material Design 3 (Material You) color science,
 * and dynamic seed-color tonal palette generation across canonical and Android presets.
 */

// ============================================================================
// 1. Theme Identifiers & Presets Catalog Constants
// ============================================================================

export const CARD_THEME_IDS = [
  "classic",
  "cyberpunk",
  "minimal-dark",
  "glass",
  "material-vibrant",
] as const;

export const ANDROID_THEME_IDS = [
  "pixel-blue",
  "forest-emerald",
  "lavender-mist",
  "sunset-amber",
  "obsidian-monochrome",
] as const;

export const ALL_PRESET_THEME_IDS = [
  ...CARD_THEME_IDS,
  ...ANDROID_THEME_IDS,
] as const;

export type CanonicalCardThemeId = (typeof CARD_THEME_IDS)[number];
export type AndroidThemeId = (typeof ANDROID_THEME_IDS)[number];
export type CardThemeId = CanonicalCardThemeId | AndroidThemeId | string;

export const DEFAULT_CARD_THEME_ID: CanonicalCardThemeId = "classic";
export const THEME_STORAGE_KEY = "postcard_studio_card_theme";
export const CARD_THEME_STORAGE_KEY = THEME_STORAGE_KEY;

// ============================================================================
// 2. Token Interfaces & Schemas
// ============================================================================

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
  "--card-theme-bg"?: string;
  "--card-theme-border"?: string;
  "--card-theme-accent"?: string;
  "--card-theme-glow"?: string;
  "--card-theme-corner"?: string;
  "--card-theme-on-surface"?: string;
  "--card-theme-on-surface-variant"?: string;
  [key: string]: string | undefined;
}

/**
 * Standard Material Design 3 tonal stops.
 */
export type AndroidToneLevel =
  | 0
  | 10
  | 20
  | 30
  | 40
  | 50
  | 60
  | 70
  | 80
  | 90
  | 95
  | 99
  | 100;

export const ANDROID_TONE_LEVELS: readonly AndroidToneLevel[] = [
  0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100,
] as const;

/**
 * A single 13-stop tonal palette mapping tone level to hex color.
 */
export type AndroidTonalPalette = Record<AndroidToneLevel, string>;

/**
 * The 5 core tonal palettes derived from a seed color.
 */
export interface AndroidPalettes {
  primary: AndroidTonalPalette;
  secondary: AndroidTonalPalette;
  tertiary: AndroidTonalPalette;
  neutral: AndroidTonalPalette;
  neutralVariant: AndroidTonalPalette;
}

/**
 * Android 14 Material Design 3 semantic color roles.
 */
export interface AndroidThemeRoles {
  // Surface & Container hierarchy
  surface: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainerLowest: string;
  surfaceContainerLow: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;

  // Content & Typography
  onSurface: string;
  onSurfaceVariant: string;

  // Primary Accent & Actions
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;

  // Secondary & Badges
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;

  // Tertiary & Status Alerts
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;

  // Outlines & Dividers
  outline: string;
  outlineVariant: string;
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
  seedColor?: string;
  palettes?: AndroidPalettes;
  roles?: AndroidThemeRoles;
  lightRoles?: AndroidThemeRoles;
  canvas: CanvasThemeTokens;
  material: MaterialThemeTokens;
  lighting: LightingThemeTokens;
  homeCss: HomeCssThemeTokens;
  css?: HomeCssThemeTokens;
}

/**
 * Authentic Android Preset Theme catalog entry.
 */
export interface AndroidThemePreset {
  id: AndroidThemeId | string;
  name: string;
  tagline: string;
  description: string;
  seed: string;
  swatchPrimary: string;
  swatchSecondary: string;
  theme: CardThemeDefinition;
}

/**
 * Generator options for custom theme synthesis.
 */
export interface GenerateThemeOptions {
  mode?: "dark" | "light";
  isMonochrome?: boolean;
  id?: CardThemeId;
  name?: string;
  tagline?: string;
  description?: string;
  swatchPrimary?: string;
  swatchSecondary?: string;
}

// ============================================================================
// 3. Zero-Dependency HCT / CIELAB (L*a*b*) Color Science Engine
// ============================================================================

export function srgbToLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

export function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const rL = srgbToLinear(r);
  const gL = srgbToLinear(g);
  const bL = srgbToLinear(b);
  return [
    0.4124564 * rL + 0.3575761 * gL + 0.1804375 * bL,
    0.2126729 * rL + 0.7151522 * gL + 0.0721750 * bL,
    0.0193339 * rL + 0.1191920 * gL + 0.9503041 * bL,
  ];
}

export function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const xn = 0.95047, yn = 1.00000, zn = 1.08883;
  const f = (t: number) => (t > 0.00885645 ? Math.cbrt(t) : 7.787037 * t + 16 / 116);
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToLch(L: number, a: number, b: number): [number, number, number] {
  const C = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return [L, C, h];
}

export function lchToLab(L: number, C: number, h: number): [number, number, number] {
  const rad = h * (Math.PI / 180);
  return [L, C * Math.cos(rad), C * Math.sin(rad)];
}

export function labToXyz(L: number, a: number, b: number): [number, number, number] {
  const xn = 0.95047, yn = 1.00000, zn = 1.08883;
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const finv = (t: number) => (t > 0.20689655 ? t * t * t : (t - 16 / 116) / 7.787037);
  return [xn * finv(fx), yn * finv(fy), zn * finv(fz)];
}

export function xyzToRgb(x: number, y: number, z: number): [number, number, number] {
  const rL = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const gL = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const bL = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [linearToSrgb(rL) * 255, linearToSrgb(gL) * 255, linearToSrgb(bL) * 255];
}

export function isInGamut(rgb: [number, number, number]): boolean {
  const eps = 0.001;
  return (
    rgb[0] >= -eps && rgb[0] <= 255 + eps &&
    rgb[1] >= -eps && rgb[1] <= 255 + eps &&
    rgb[2] >= -eps && rgb[2] <= 255 + eps
  );
}

export function hexToRgb(hex: string): [number, number, number] {
  if (typeof hex !== "string") return [103, 80, 164];
  let clean = hex.trim();
  if (clean.startsWith("seed:")) {
    clean = clean.slice(5).trim();
  }
  clean = clean.replace(/^#/, "").trim();
  if (clean.length === 3 && /^[0-9a-fA-F]{3}$/.test(clean)) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  if (clean.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(clean)) {
    return [103, 80, 164]; // Safe fallback to M3 canonical purple (#6750A4)
  }
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function rgbToHex(rgb: [number, number, number]): string {
  const r = Math.max(0, Math.min(255, Math.round(rgb[0])));
  const g = Math.max(0, Math.min(255, Math.round(rgb[1])));
  const b = Math.max(0, Math.min(255, Math.round(rgb[2])));
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function normalizeSeedHex(seed: unknown): string {
  if (typeof seed !== "string") {
    return "#6750a4";
  }
  let clean = seed.trim();
  if (clean.startsWith("seed:")) {
    clean = clean.slice(5).trim();
  }
  clean = clean.replace(/^#/, "").trim();
  if (clean.length === 3 && /^[0-9a-fA-F]{3}$/.test(clean)) {
    clean = clean.split("").map((c) => c + c).join("");
  }
  if (clean.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(clean)) {
    return "#6750a4";
  }
  return "#" + clean.toLowerCase();
}

/**
 * Computes exact hex code for a given Hue, Chroma, and Tone (L*)
 * with 16-step binary search gamut boundary solving.
 */
export function getTone(hue: number, chroma: number, tone: number): string {
  if (tone <= 0) return "#000000";
  if (tone >= 100) return "#ffffff";

  let low = 0;
  let high = chroma;
  let bestRgb: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    const lab = lchToLab(tone, mid, hue);
    const xyz = labToXyz(...lab);
    const rgb = xyzToRgb(...xyz);
    if (isInGamut(rgb)) {
      bestRgb = rgb;
      low = mid;
    } else {
      high = mid;
    }
  }
  return rgbToHex(bestRgb);
}

// ============================================================================
// 4. Dynamic Android Material Design 3 Theme Generator
// ============================================================================

export function generateThemeFromSeed(
  seedHex: string,
  options?: GenerateThemeOptions
): CardThemeDefinition {
  const normSeed = normalizeSeedHex(seedHex);
  const mode = options?.mode ?? "dark";
  const [r, g, b] = hexToRgb(normSeed);
  const [, C_seed, h_seed] = labToLch(...xyzToLab(...rgbToXyz(r, g, b)));

  const isMono = options?.isMonochrome ?? C_seed < 8;
  const pChroma = isMono ? 0 : Math.max(C_seed, 48);
  const sChroma = isMono ? 0 : 16;
  const tChroma = isMono ? 0 : 24;
  const nChroma = isMono ? 0 : 4;
  const nvChroma = isMono ? 0 : 8;
  const tHue = (h_seed + 60) % 360;

  const makePalette = (hue: number, chroma: number): AndroidTonalPalette => {
    const pal = {} as AndroidTonalPalette;
    for (const t of ANDROID_TONE_LEVELS) {
      pal[t] = getTone(hue, chroma, t);
    }
    return pal;
  };

  const primary = makePalette(h_seed, pChroma);
  const secondary = makePalette(h_seed, sChroma);
  const tertiary = makePalette(tHue, tChroma);
  const neutral = makePalette(h_seed, nChroma);
  const neutralVariant = makePalette(h_seed, nvChroma);

  const darkRoles: AndroidThemeRoles = {
    surface: getTone(h_seed, nChroma, 6),
    surfaceDim: getTone(h_seed, nChroma, 6),
    surfaceBright: getTone(h_seed, nChroma, 24),
    surfaceContainerLowest: getTone(h_seed, nChroma, 4),
    surfaceContainerLow: getTone(h_seed, nChroma, 10),
    surfaceContainer: getTone(h_seed, nChroma, 12),
    surfaceContainerHigh: getTone(h_seed, nChroma, 17),
    surfaceContainerHighest: getTone(h_seed, nChroma, 22),
    onSurface: neutral[90],
    onSurfaceVariant: neutralVariant[80],
    primary: primary[80],
    onPrimary: primary[20],
    primaryContainer: primary[30],
    onPrimaryContainer: primary[90],
    secondary: secondary[80],
    onSecondary: secondary[20],
    secondaryContainer: secondary[30],
    onSecondaryContainer: secondary[90],
    tertiary: tertiary[80],
    onTertiary: tertiary[20],
    tertiaryContainer: tertiary[30],
    onTertiaryContainer: tertiary[90],
    outline: neutralVariant[60],
    outlineVariant: neutralVariant[30],
  };

  const lightRoles: AndroidThemeRoles = {
    surface: getTone(h_seed, nChroma, 98),
    surfaceDim: getTone(h_seed, nChroma, 87),
    surfaceBright: getTone(h_seed, nChroma, 98),
    surfaceContainerLowest: "#ffffff",
    surfaceContainerLow: getTone(h_seed, nChroma, 96),
    surfaceContainer: getTone(h_seed, nChroma, 94),
    surfaceContainerHigh: getTone(h_seed, nChroma, 92),
    surfaceContainerHighest: getTone(h_seed, nChroma, 90),
    onSurface: neutral[10],
    onSurfaceVariant: neutralVariant[30],
    primary: primary[40],
    onPrimary: primary[100],
    primaryContainer: primary[90],
    onPrimaryContainer: primary[10],
    secondary: secondary[40],
    onSecondary: secondary[100],
    secondaryContainer: secondary[90],
    onSecondaryContainer: secondary[10],
    tertiary: tertiary[40],
    onTertiary: tertiary[100],
    tertiaryContainer: tertiary[90],
    onTertiaryContainer: tertiary[10],
    outline: neutralVariant[50],
    outlineVariant: neutralVariant[80],
  };

  const activeRoles = mode === "light" ? lightRoles : darkRoles;

  // Post Card OS 2D Canvas drawing tokens
  const canvas: CanvasThemeTokens = {
    bgTop: activeRoles.surfaceContainerLow,
    bgBottom: activeRoles.surfaceContainerLowest,
    bgGradientStop: 0.55,
    borderStroke: hexToRgba(activeRoles.primary, 0.42),
    borderWidth: 2,
    badgeColor: activeRoles.primary,
    headerColor: activeRoles.secondary,
    titleColor: activeRoles.onSurface,
    detailColor: activeRoles.onSurfaceVariant,
    buttonFill: hexToRgba(activeRoles.surfaceContainerHighest, 0.92),
    buttonStroke: hexToRgba(activeRoles.outlineVariant, 0.50),
    buttonText: activeRoles.primary,
    fastenerRim: activeRoles.outline,
    fastenerHead: activeRoles.surfaceContainerLowest,
  };

  // Post Card OS 3D PBR Material properties
  const material: MaterialThemeTokens = {
    roughness: 0.65,
    metalness: 0.15,
    emissive: "#ffffff",
    emissiveIntensity: 0.85,
    edgeColor: activeRoles.surfaceContainerLowest,
    edgeEmissive: activeRoles.secondary,
    edgeEmissiveIntensity: 0.28,
    edgeRoughness: 0.35,
    edgeMetalness: 0.75,
  };

  // Post Card OS Spatial Lighting parameters
  const lighting: LightingThemeTokens = {
    haloColor: activeRoles.primary,
    haloIntensity: 50,
    floorGlowColor: activeRoles.secondary,
    floorGlowIntensity: 35,
  };

  // Post Card OS 2D Home View CSS variables
  const homeCss: HomeCssThemeTokens = {
    cardBg: `linear-gradient(135deg, ${hexToRgba(activeRoles.surfaceContainerLow, 0.95)}, ${hexToRgba(activeRoles.surfaceContainerLowest, 0.92)})`,
    cardBorder: hexToRgba(activeRoles.primary, 0.38),
    cardAccent: activeRoles.primary,
    cardGlow: `0 8px 30px ${hexToRgba(activeRoles.primary, 0.18)}, 0 0 16px ${hexToRgba(activeRoles.secondary, 0.14)}`,
    badgeBg: hexToRgba(activeRoles.primary, 0.10),
    badgeText: activeRoles.primary,
    "--home-card-bg": `linear-gradient(135deg, ${hexToRgba(activeRoles.surfaceContainerLow, 0.95)}, ${hexToRgba(activeRoles.surfaceContainerLowest, 0.92)})`,
    "--home-card-border": hexToRgba(activeRoles.primary, 0.38),
    "--home-card-accent": activeRoles.primary,
    "--home-card-glow": `0 8px 30px ${hexToRgba(activeRoles.primary, 0.18)}, 0 0 16px ${hexToRgba(activeRoles.secondary, 0.14)}`,
    "--home-badge-bg": hexToRgba(activeRoles.primary, 0.10),
    "--home-badge-text": activeRoles.primary,
    "--card-theme-bg": `linear-gradient(135deg, ${hexToRgba(activeRoles.surfaceContainerLow, 0.95)}, ${hexToRgba(activeRoles.surfaceContainerLowest, 0.92)})`,
    "--card-theme-border": hexToRgba(activeRoles.primary, 0.38),
    "--card-theme-accent": activeRoles.primary,
    "--card-theme-glow": `0 8px 30px ${hexToRgba(activeRoles.primary, 0.18)}, 0 0 16px ${hexToRgba(activeRoles.secondary, 0.14)}`,
    "--card-theme-corner": hexToRgba(activeRoles.primary, 0.42),
    "--card-theme-on-surface": activeRoles.onSurface,
    "--card-theme-on-surface-variant": activeRoles.onSurfaceVariant,
  };

  const themeId =
    options?.id ??
    (typeof seedHex === "string" && seedHex.startsWith("seed:") ? seedHex : `seed:${normSeed}`);

  return {
    id: themeId,
    name: options?.name ?? "Dynamic Seed",
    tagline: options?.tagline ?? "Dynamic Tonal Palette · Material You",
    description:
      options?.description ??
      `Dynamically generated Android Material 3 theme from seed color ${normSeed}.`,
    seedColor: normSeed,
    swatchPrimary: options?.swatchPrimary ?? normSeed,
    swatchSecondary: options?.swatchSecondary ?? activeRoles.secondary,
    palettes: { primary, secondary, tertiary, neutral, neutralVariant },
    roles: activeRoles,
    lightRoles,
    canvas,
    material,
    lighting,
    homeCss,
    css: homeCss,
  };
}

// ============================================================================
// 5. Android Preset Themes Catalog
// ============================================================================

export const ANDROID_PRESET_THEMES: Record<AndroidThemeId, CardThemeDefinition> = {
  "pixel-blue": generateThemeFromSeed("#1A73E8", {
    id: "pixel-blue",
    name: "Pixel Default",
    tagline: "Dynamic Blue · Royal Sapphire",
    description:
      "Authentic Google Pixel flagship dynamic color theme with rich blue accents and soft slate periwinkle utility.",
    swatchPrimary: "#1A73E8",
    swatchSecondary: "#c0c5e3",
  }),
  "forest-emerald": generateThemeFromSeed("#0F9D58", {
    id: "forest-emerald",
    name: "Forest Emerald",
    tagline: "Android Nature · Vivid Sage",
    description:
      "Lush botanical dynamic palette featuring emerald green accents and marine cyan highlights.",
    swatchPrimary: "#0F9D58",
    swatchSecondary: "#b0ceb8",
  }),
  "lavender-mist": generateThemeFromSeed("#6750A4", {
    id: "lavender-mist",
    name: "Lavender Mist",
    tagline: "Material 3 Baseline · Iris Purple",
    description:
      "The canonical reference seed of Material Design 3 with soothing iris purple accents and wisteria undertones.",
    swatchPrimary: "#6750A4",
    swatchSecondary: "#ccc2df",
  }),
  "sunset-amber": generateThemeFromSeed("#F59E0B", {
    id: "sunset-amber",
    name: "Sunset Amber",
    tagline: "Warm Radiance · Amber Gold",
    description:
      "Radiant golden sunset palette with toasted amber accents and pistachio tertiary readouts.",
    swatchPrimary: "#F59E0B",
    swatchSecondary: "#dbc2aa",
  }),
  "obsidian-monochrome": generateThemeFromSeed("#71717A", {
    id: "obsidian-monochrome",
    isMonochrome: true,
    name: "Obsidian Monochrome",
    tagline: "Android 14 Monochrome · Pure Zinc",
    description:
      "Official Android 14 Monochrome customization with pure achromatic luminance scaling.",
    swatchPrimary: "#71717A",
    swatchSecondary: "#c6c6c6",
  }),
};

export const ANDROID_THEMES = ANDROID_PRESET_THEMES;

export const ANDROID_PRESETS: Record<AndroidThemeId, AndroidThemePreset> = {
  "pixel-blue": {
    id: "pixel-blue",
    name: "Pixel Default",
    tagline: "Dynamic Blue · Royal Sapphire",
    description:
      "Authentic Google Pixel flagship dynamic color theme with rich blue accents and soft slate periwinkle utility.",
    seed: "#1A73E8",
    swatchPrimary: "#1A73E8",
    swatchSecondary: "#c0c5e3",
    theme: ANDROID_PRESET_THEMES["pixel-blue"],
  },
  "forest-emerald": {
    id: "forest-emerald",
    name: "Forest Emerald",
    tagline: "Android Nature · Vivid Sage",
    description:
      "Lush botanical dynamic palette featuring emerald green accents and marine cyan highlights.",
    seed: "#0F9D58",
    swatchPrimary: "#0F9D58",
    swatchSecondary: "#b0ceb8",
    theme: ANDROID_PRESET_THEMES["forest-emerald"],
  },
  "lavender-mist": {
    id: "lavender-mist",
    name: "Lavender Mist",
    tagline: "Material 3 Baseline · Iris Purple",
    description:
      "The canonical reference seed of Material Design 3 with soothing iris purple accents and wisteria undertones.",
    seed: "#6750A4",
    swatchPrimary: "#6750A4",
    swatchSecondary: "#ccc2df",
    theme: ANDROID_PRESET_THEMES["lavender-mist"],
  },
  "sunset-amber": {
    id: "sunset-amber",
    name: "Sunset Amber",
    tagline: "Warm Radiance · Amber Gold",
    description:
      "Radiant golden sunset palette with toasted amber accents and pistachio tertiary readouts.",
    seed: "#F59E0B",
    swatchPrimary: "#F59E0B",
    swatchSecondary: "#dbc2aa",
    theme: ANDROID_PRESET_THEMES["sunset-amber"],
  },
  "obsidian-monochrome": {
    id: "obsidian-monochrome",
    name: "Obsidian Monochrome",
    tagline: "Android 14 Monochrome · Pure Zinc",
    description:
      "Official Android 14 Monochrome customization with pure achromatic luminance scaling.",
    seed: "#71717A",
    swatchPrimary: "#71717A",
    swatchSecondary: "#c6c6c6",
    theme: ANDROID_PRESET_THEMES["obsidian-monochrome"],
  },
};

// ============================================================================
// 6. The 5 Canonical Themes Catalog
// ============================================================================

export const CANONICAL_THEMES: Record<CanonicalCardThemeId, CardThemeDefinition> = {
  classic: {
    id: "classic",
    name: "Classic Studio",
    tagline: "Slate Cardstock · Cyan Precision",
    description:
      "Industrial precision laboratory instrumentation with understated technical cyan accents and tactile matte cardstock.",
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
      cardBg: "linear-gradient(135deg, rgba(20, 22, 27, 0.95), rgba(13, 17, 26, 0.90))",
      cardBorder: "rgba(112, 213, 207, 0.32)",
      cardAccent: "#70d5cf",
      cardGlow: "0 8px 28px rgba(112, 213, 207, 0.14)",
      badgeBg: "rgba(112, 213, 207, 0.08)",
      badgeText: "#70d5cf",
      "--home-card-bg": "linear-gradient(135deg, rgba(20, 22, 27, 0.95), rgba(13, 17, 26, 0.90))",
      "--home-card-border": "rgba(112, 213, 207, 0.32)",
      "--home-card-accent": "#70d5cf",
      "--home-card-glow": "0 8px 28px rgba(112, 213, 207, 0.14)",
      "--home-badge-bg": "rgba(112, 213, 207, 0.08)",
      "--home-badge-text": "#70d5cf",
    },
  },

  cyberpunk: {
    id: "cyberpunk",
    name: "Cyberpunk Neon",
    tagline: "Obsidian High-Gloss · Magenta & Cyan Glow",
    description:
      "High-contrast futuristic terminal HUDs, dark synthwave aesthetics, and neon-drenched nightscapes with emissive radiance.",
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
      cardBg: "linear-gradient(135deg, rgba(16, 6, 28, 0.96), rgba(6, 2, 14, 0.96))",
      cardBorder: "rgba(255, 0, 127, 0.55)",
      cardAccent: "#ff007f",
      cardGlow: "0 8px 32px rgba(255, 0, 127, 0.28), 0 0 14px rgba(0, 240, 255, 0.20)",
      badgeBg: "rgba(255, 0, 127, 0.12)",
      badgeText: "#ff007f",
      "--home-card-bg": "linear-gradient(135deg, rgba(16, 6, 28, 0.96), rgba(6, 2, 14, 0.96))",
      "--home-card-border": "rgba(255, 0, 127, 0.55)",
      "--home-card-accent": "#ff007f",
      "--home-card-glow": "0 8px 32px rgba(255, 0, 127, 0.28), 0 0 14px rgba(0, 240, 255, 0.20)",
      "--home-badge-bg": "rgba(255, 0, 127, 0.12)",
      "--home-badge-text": "#ff007f",
    },
  },

  "minimal-dark": {
    id: "minimal-dark",
    name: "Minimal Dark",
    tagline: "Pure AMOLED · Anti-Reflective Zinc",
    description:
      "Zero-distraction architectural focus with pure AMOLED black levels, zinc wireframes, and anti-reflective matte physics.",
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
      cardBg: "linear-gradient(135deg, rgba(10, 10, 10, 0.98), rgba(0, 0, 0, 0.99))",
      cardBorder: "rgba(82, 82, 91, 0.35)",
      cardAccent: "#e4e4e7",
      cardGlow: "0 8px 24px rgba(0, 0, 0, 0.70)",
      badgeBg: "rgba(255, 255, 255, 0.04)",
      badgeText: "#e4e4e7",
      "--home-card-bg": "linear-gradient(135deg, rgba(10, 10, 10, 0.98), rgba(0, 0, 0, 0.99))",
      "--home-card-border": "rgba(82, 82, 91, 0.35)",
      "--home-card-accent": "#e4e4e7",
      "--home-card-glow": "0 8px 24px rgba(0, 0, 0, 0.70)",
      "--home-badge-bg": "rgba(255, 255, 255, 0.04)",
      "--home-badge-text": "#e4e4e7",
    },
  },

  glass: {
    id: "glass",
    name: "Glass / Frosted",
    tagline: "Translucent Ice Acrylic · Crystal Specular",
    description:
      "Spatial glassmorphism with frosted translucent icy acrylic, crystal refractive depth, and sky blue edge glints.",
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
      cardBg: "linear-gradient(135deg, rgba(26, 38, 57, 0.72), rgba(13, 20, 32, 0.80))",
      cardBorder: "rgba(186, 230, 253, 0.42)",
      cardAccent: "#38bdf8",
      cardGlow: "0 8px 32px rgba(56, 189, 248, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
      badgeBg: "rgba(56, 189, 248, 0.10)",
      badgeText: "#38bdf8",
      "--home-card-bg": "linear-gradient(135deg, rgba(26, 38, 57, 0.72), rgba(13, 20, 32, 0.80))",
      "--home-card-border": "rgba(186, 230, 253, 0.42)",
      "--home-card-accent": "#38bdf8",
      "--home-card-glow": "0 8px 32px rgba(56, 189, 248, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
      "--home-badge-bg": "rgba(56, 189, 248, 0.10)",
      "--home-badge-text": "#38bdf8",
    },
  },

  "material-vibrant": {
    id: "material-vibrant",
    name: "Material Vibrant",
    tagline: "Android Expressive · Warm Amber & Violet",
    description:
      "Directly inspired by Android Expressive and Material You, featuring deep warm indigo surfaces, warm amber accents, and satin microtextures.",
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
      cardBg: "linear-gradient(135deg, rgba(26, 18, 38, 0.95), rgba(14, 9, 24, 0.92))",
      cardBorder: "rgba(245, 158, 11, 0.42)",
      cardAccent: "#f59e0b",
      cardGlow: "0 8px 30px rgba(245, 158, 11, 0.18), 0 0 16px rgba(139, 92, 246, 0.16)",
      badgeBg: "rgba(245, 158, 11, 0.10)",
      badgeText: "#f59e0b",
      "--home-card-bg": "linear-gradient(135deg, rgba(26, 18, 38, 0.95), rgba(14, 9, 24, 0.92))",
      "--home-card-border": "rgba(245, 158, 11, 0.42)",
      "--home-card-accent": "#f59e0b",
      "--home-card-glow": "0 8px 30px rgba(245, 158, 11, 0.18), 0 0 16px rgba(139, 92, 246, 0.16)",
      "--home-badge-bg": "rgba(245, 158, 11, 0.10)",
      "--home-badge-text": "#f59e0b",
    },
  },
};

/**
 * Combined Presets Catalog containing all canonical and Android presets.
 */
export const CARD_THEMES: Record<string, CardThemeDefinition> = {
  ...CANONICAL_THEMES,
  ...ANDROID_PRESET_THEMES,
};

// Attach alias .css property for backwards-compatibility with both .css and .homeCss
for (const themeId of Object.keys(CARD_THEMES)) {
  CARD_THEMES[themeId].css = CARD_THEMES[themeId].homeCss;
}

// ============================================================================
// 7. Type Guards, Lookup, and Persistence
// ============================================================================

/**
 * Type guard for CardThemeId.
 * Validates canonical presets, Android presets, or valid seed:#HEX / #HEX identifiers.
 */
export function isValidCardThemeId(id: unknown): id is CardThemeId {
  if (typeof id !== "string") {
    return false;
  }
  if ((CARD_THEME_IDS as readonly string[]).includes(id)) {
    return true;
  }
  if ((ANDROID_THEME_IDS as readonly string[]).includes(id)) {
    return true;
  }
  if (id.startsWith("seed:")) {
    const seedPart = id.slice(5).trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(seedPart);
  }
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(id)) {
    return true;
  }
  return false;
}

/**
 * Safe accessor returning a theme definition with fallback to default theme.
 * Handles canonical preset IDs, Android preset IDs, and dynamic seed colors.
 */
export function getCardTheme(id: unknown): CardThemeDefinition {
  if (typeof id === "string") {
    if (Object.prototype.hasOwnProperty.call(CARD_THEMES, id)) {
      return CARD_THEMES[id];
    }
    if (id.startsWith("seed:")) {
      const seedPart = id.slice(5).trim();
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(seedPart)) {
        return generateThemeFromSeed(seedPart, { id: id as CardThemeId });
      }
    }
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(id)) {
      return generateThemeFromSeed(id, { id: id as CardThemeId });
    }
  }
  return CARD_THEMES[DEFAULT_CARD_THEME_ID];
}

/**
 * Reads persisted theme from localStorage with safe fallback.
 */
export function loadPersistedTheme(): CardThemeId {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
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
 * Backwards-compatible alias for loadPersistedTheme.
 */
export const loadSavedTheme = loadPersistedTheme;

/**
 * Persists theme preference to localStorage.
 */
export function persistTheme(themeId: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(THEME_STORAGE_KEY, themeId);
    }
  } catch (err) {
    console.warn("Unable to persist card theme to localStorage:", err);
  }
}

/**
 * Backwards-compatible alias for persistTheme.
 */
export const saveTheme = persistTheme;
