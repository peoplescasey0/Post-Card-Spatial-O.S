# Milestone M3 Specification Mining Report: 3D Engine Integration, Canvas Texture Invalidation & Persistence

**State Folder**: `g:\micro-host\.agents\teamwork\spec_miner_m3\`  
**Target Environment**: `workspace-prototype/` (Three.js 0.180.0, TypeScript 5.9, Vite)  
**Author**: Spec Miner (Milestone M3)  

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Caching | Dynamic Theme Texture Invalidation | Invalidate cached sharp and blurred canvas textures across all cards when the active theme changes | `card: SystemCard`, `card.theme ?? activeCardThemeId` | Updated cache key string, triggered `dispose()` of outdated WebGL textures, regenerated canvas | Defaults to `DEFAULT_CARD_THEME_ID` (`"classic"`) if card theme is invalid | `src/main.ts:4634-4726` |
| 2 | Rasterization | Theme-Driven Canvas Background | Render card face substrate gradient using active theme tokens `bgTop`, `bgBottom`, and `bgGradientStop` | `context: CanvasRenderingContext2D`, `theme.canvas` | Dynamic 1280x1920 linear gradient background | Falls back to classic slate `#14161B` -> `#0D111A` if token undefined | `src/main.ts:3073-3078` |
| 3 | Rasterization | Theme-Driven Chassis Perimeter Rim | Draw card perimeter stroke using active theme tokens `borderStroke` and `borderWidth` | `context: CanvasRenderingContext2D`, `theme.canvas` | 590x912 rounded rectangle stroke with theme width and alpha | Fallback width 2px, stroke `${meta.accent}55` | `src/main.ts:3088-3091` |
| 4 | Rasterization | Theme-Driven Tactile Buttons | Style the 8 printed card buttons (`drawCardButtons`) using `buttonFill`, `buttonStroke`, and `buttonText` | `context: CanvasRenderingContext2D`, `card: SystemCard`, `theme.canvas` | Themed 4x2 button matrix on front face | Danger buttons (`bin`, `stop`) retain `#e495a4` warning accent | `src/main.ts:3383-3406` |
| 5 | Rasterization | Theme-Driven Hardware Fasteners | Render 4 corner hex screws via `drawChassisFastener` using `fastenerHead` and `fastenerRim` | `context: CanvasRenderingContext2D`, `cx, cy`, `theme.canvas` | Two-tone chamfered rim and recessed socket | Fallback to `#0a0e16` / `#334155` / `#64748b` | `src/main.ts:3030-3062` |
| 6 | 3D PBR | Material Property Synchronization | Dynamically update Three.js `MeshStandardMaterial` on card faces and extruded edge chassis (`roughness`, `metalness`, `emissive`, `emissiveIntensity`, `edgeColor`) | `card: SystemCard`, `theme.material` | Mutated material uniforms with `material.needsUpdate = true` | No-op if material is not `MeshStandardMaterial` | `src/main.ts:2932-3023` |
| 7 | Spatial Lighting | Synchronized Halo & Floor Lights | Update `cardHaloLight` and `cardFloorGlow` point lights to match active theme color and intensity | `theme.lighting` (`haloColor`, `haloIntensity`, `floorGlowColor`, `floorGlowIntensity`) | Real-time scene point light updates tracking active card | Lerps smoothly in animate loop; clamps within valid ranges | `src/main.ts:576-585, 7787-7798` |
| 8 | View State | Home & Studio DOM Attribute Sync | Apply `data-card-theme="<themeId>"` to `#home-view` and `#studio-view` for CSS styling | `themeId: CardThemeId` | DOM attribute mutation triggering CSS custom properties | Defaults to `"classic"` if element not found | `src/style.css:2704-2722, 3517-3530` |
| 9 | State UI | Home Theme Picker Control Synchronization | Toggle `aria-checked="true"` and `.is-active` class on theme selector chips/buttons | `themeId: CardThemeId` | Visual active radio indicator on selected theme chip | Graceful handling if no selector elements match | `index.html:#home-view` |
| 10 | Persistence | LocalStorage Theme Persistence | Save and load selected card theme across browser sessions under key `postcard_studio_card_theme` | `themeId: CardThemeId` | Persisted key in `localStorage` | Wrapped in try/catch for `SecurityError` or private browsing fallback to `"classic"` | `THEMING_RESEARCH.md:702-731` |
| 11 | View Router | Mid-Session Theme Switching (`applyCardTheme`) | Unified dispatcher coordinating state, DOM, Three.js materials, lights, and texture invalidation | `themeId: CardThemeId` | Synchronized visual shift across 2D Home View and 3D Spatial Studio | Sanitizes theme ID against `CARD_THEME_IDS` | `THEMING_RESEARCH.md:581-605` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Persistence | `localStorage.getItem` returns null or undefined | `loadSavedTheme()` catches missing key and returns default `"classic"` without throwing. |
| 2 | Persistence | `localStorage` access blocked (Private Browsing / iframe sandbox `SecurityError`) | Caught in try/catch block; logs console warning and falls back to `"classic"`. |
| 3 | Persistence | Corrupted / arbitrary string stored in `localStorage` (e.g. `"vaporwave-2077"`) | Validated against `CARD_THEME_IDS.includes(saved as CardThemeId)`; unrecognized string rejected and returns `"classic"`. |
| 4 | Caching | Theme changed while card is in mid-flip animation or tilted | `cachedSharpTexture` and `cachedBlurredTexture` disposed, `cachedContentKey` reset, and `refreshCardTexture(card, true)` generates active facet texture without disrupting Euler rotation or quaternion interpolation. |
| 5 | Caching | Rapid theme clicking by user (< 50ms interval) | Old WebGL textures explicitly disposed via `.dispose()` to prevent VRAM memory leak (~9.8MB per card face). Last key reflects final theme. |
| 6 | 3D Rendering | Card has active live guest stream (`card.liveCanvas` active) | `makeCardTexture` and card chassis/buttons update to new theme, while the inner guest display continues streaming live VNC framebuffer pixels without interruption. |
| 7 | Accessibility | Reduced motion enabled (`prefers-reduced-motion`) | Theme switching applies instantaneously; light intensity and color changes take effect immediately without relying on transition delay. |
| 8 | Coordination | User clicks theme chip while in `#home-view` | Theme is applied to `#home-view` CSS immediately and all 3D card textures and materials are invalidated in memory so that when user clicks `[data-open-studio]`, the 3D studio is already fully rendered in the selected theme. |
| 9 | Physics | Milestone M2 floor clamping active during theme switch | Theme update only modifies materials, lights, and textures; no card position, layout offset, or bounding box values are touched, maintaining zero collision regression. |

---

## 5-Component Handoff Report

### 1. Observation

Direct code examination of `workspace-prototype/src/main.ts` reveals:

1. **Hardcoded Substrate & Perimeter in `makeCardTexture` (lines 3073-3091)**:
   ```typescript
   // Lines 3073-3078:
   const meta = FACET_META[facet];
   const gradient = context.createLinearGradient(0, 0, 640, 960);
   gradient.addColorStop(0, facet === "front" ? "#14161B" : "#14161B");
   gradient.addColorStop(0.58, "#0D111A");
   gradient.addColorStop(1, "#0D111A");
   context.fillStyle = gradient;
   context.fillRect(0, 0, 640, 960);

   // Lines 3088-3091:
   context.strokeStyle = `${meta.accent}55`;
   context.lineWidth = 2;
   roundRect(context, 25, 24, 590, 912, 18);
   context.stroke();
   ```

2. **Hardcoded Button Matrix Styling in `drawCardButtons` (lines 3392-3404)**:
   ```typescript
   const danger = id === "bin" || id === "stop";
   const accent = danger ? "#e495a4" : id === "guest" ? card.color : "#79ded8";
   context.globalAlpha = enabled ? 1 : 0.38;
   context.fillStyle = id === "guest" && enabled ? `${card.color}33` : "#07090ee8";
   roundRect(context, rect.x, rect.y, rect.w, rect.h, 10);
   context.fill();
   context.strokeStyle = `${accent}b0`;
   context.lineWidth = 2;
   roundRect(context, rect.x, rect.y, rect.w, rect.h, 10);
   context.stroke();
   context.fillStyle = "#f4f5f7";
   context.font = "700 18px Inter, Arial, sans-serif";
   context.fillText(label.toUpperCase(), rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
   ```

3. **Content Key Definition in `computeCardContentKey` (lines 4634-4670)**:
   ```typescript
   function computeCardContentKey(card: SystemCard): string {
     // ...
     return [
       card.status,
       card.facet,
       card.backFaceVisible ? "B" : "F",
       card.twisted ? "T1" : "T0",
       hasPrivateStream && isCardPulledToFront(card) ? "PF" : "PB",
       card.resetCount,
       // ... 18 more guest/telemetry items ...
       latestKernelTelemetry.heap_pressure,
     ].join("|");
   }
   ```
   *Critical observation*: The key does not contain any theme identifier. If a user switches themes, `computeCardContentKey(card)` returns the exact same string, causing `refreshCardTexture` to skip texture re-rendering because `card.cachedContentKey === contentKey`.

4. **Texture Cache Management in `refreshCardTexture` (lines 4676-4704)**:
   ```typescript
   function refreshCardTexture(card: SystemCard, force = false): void {
     const contentKey = computeCardContentKey(card);
     const nextKey = `${contentKey}|b${card.blurStep ?? 1}`;
     if (!card.liveCanvas && card.lastTextureKey === nextKey && !force) {
       return;
     }
     card.lastTextureKey = nextKey;

     if (card.cachedContentKey !== contentKey || card.liveCanvas) {
       card.cachedSharpTexture?.dispose();
       card.cachedBlurredTexture?.dispose();
       card.cachedSharpTexture = undefined;
       card.cachedBlurredTexture = undefined;
       card.cachedContentKey = contentKey;
     }
     // ...
   ```
   *Critical observation*: When `cachedContentKey !== contentKey`, both `cachedSharpTexture` and `cachedBlurredTexture` are cleanly disposed via Three.js `.dispose()`.

5. **Hardcoded Material Values in `createCard` (lines 2932-3000)**:
   - Edge chassis: `color: "#19212d"`, `emissive: "#152631"`, `emissiveIntensity: 0.22`, `metalness: 0.82`, `roughness: 0.26`.
   - Front/Back faces: `roughness: 0.88`, `metalness: 0.02`, `emissive: "#ffffff"`, `emissiveIntensity: 0.82`.
   - Card children structure: `card.group.children[0]` is the edge chassis (`THREE.Mesh`), followed by 4 fasteners, 1 status LED, and 2 face meshes (`front` and `back` with `child.userData.face = "front" | "back"`).

6. **Dynamic Lights Tracking in Animate Loop (lines 7787-7798)**:
   ```typescript
   if (selectedCard) {
     const brandTarget = new THREE.Color(selectedCard.color);
     cardHaloLight.color.lerp(brandTarget, Math.min(1, dt * 5.2));
     cardFloorGlow.color.lerp(brandTarget, Math.min(1, dt * 5.2));
     // ...
   }
   ```
   *Critical observation*: If lines 7789-7790 unconditionally lerp toward `selectedCard.color`, theme-specified lighting (e.g. Cyberpunk magenta/cyan duochrome or Material Vibrant amber/violet) is overwritten every animation frame. The animate loop must reference the active theme's lighting tokens (`theme.lighting.haloColor` and `theme.lighting.floorGlowColor`).

---

### 2. Logic Chain

1. **Cache Invalidation**:
   - `computeCardContentKey(card)` dictates whether `refreshCardTexture` re-renders a card face.
   - Injecting `card.theme ?? activeCardThemeId` as the leading element of the array guarantees that whenever `activeCardThemeId` changes, `contentKey` changes for all cards.
   - Consequently, `card.cachedContentKey !== contentKey` evaluates to `true`, triggering texture `.dispose()` and regenerating the face texture via `makeCardTexture`.

2. **Canvas Procedural Drawing**:
   - `makeCardTexture` scales the canvas to 1280x1920 (2X retina).
   - By querying `const theme = getCardTheme(card.theme ?? activeCardThemeId)`, `bgTop`, `bgBottom`, and `bgGradientStop` replace the static `#14161B`/`#0D111A` stops.
   - `theme.canvas.borderStroke` and `theme.canvas.borderWidth` replace the static `${meta.accent}55` rim.
   - In `drawCardButtons`, replacing `#07090ee8` with `theme.canvas.buttonFill`, `${accent}b0` with `theme.canvas.buttonStroke`, and `#f4f5f7` with `theme.canvas.buttonText` applies the theme's button palette while preserving danger accents for `bin` and `stop`.
   - In `drawChassisFastener`, using `theme.canvas.fastenerRim` and `theme.canvas.fastenerHead` matches the screws to the theme's hardware styling.

3. **Three.js Material Updates**:
   - MeshStandardMaterial instances are attached to `card.group.children`.
   - Iterating over `card.group.children` allows updating:
     - Edge chassis mesh: `material.color.set(theme.material.edgeColor)`, `material.emissive.set(theme.material.edgeEmissive)`, `material.emissiveIntensity = theme.material.edgeEmissiveIntensity`, `material.roughness = theme.material.edgeRoughness`, `material.metalness = theme.material.edgeMetalness`.
     - Face meshes (`userData.face === "front" || "back"`): `material.roughness = theme.material.roughness`, `material.metalness = theme.material.metalness`, `material.emissive.set(theme.material.emissive)`, `material.emissiveIntensity = theme.material.emissiveIntensity`.
   - Setting `material.needsUpdate = true` commits the uniform changes to the WebGL program.

4. **Spatial Lighting**:
   - When a theme is selected, `cardHaloLight.color.set(theme.lighting.haloColor)` and `cardFloorGlow.color.set(theme.lighting.floorGlowColor)` set initial colors.
   - In `animate()`, updating the lerp targets from `selectedCard.color` to `theme.lighting.haloColor` and `theme.lighting.floorGlowColor` preserves the continuous smooth tracking without reverting the theme palette.

5. **State Synchronization and Persistence**:
   - `localStorage` under `postcard_studio_card_theme` provides persistent state.
   - `applyCardTheme(themeId)` updates `activeCardThemeId`, persists to `localStorage`, sets `data-card-theme` on `#home-view` and `#studio-view`, toggles active states on theme buttons, and forces a refresh on all cards.
   - Because `applyCardTheme` is called on initialization, saved preferences persist across reloads.

6. **Milestone M2 Non-Interference**:
   - M2 handles view switching (`showStudio`/`showHome`) and floor collision clamping (`clampCardAboveFloor`).
   - M3 event listeners target `[data-theme-id]` buttons; navigation uses `[data-open-studio]`. There is no overlap.
   - M3 only modifies visual appearance and does not touch kinematics or bounding box Y positions.

---

### 3. Caveats

1. **Per-Card vs Global Theme**: The architecture supports optional per-card overrides (`card.theme`), but the primary user control selects a global workspace theme (`activeCardThemeId`). Both paths are supported by `card.theme ?? activeCardThemeId`.
2. **Reduced Motion**: Under reduced motion, Three.js lights snap directly to their targets instead of lerping. The implementation should check `prefersReducedMotion()`.
3. **VRAM Disposal**: To avoid memory buildup, explicit `.dispose()` on old canvas textures is critical before assigning newly generated textures.

---

### 4. Conclusion & Worker Integration Blueprint

The worker implementing Milestone M3 should execute the following concrete modifications:

#### Blueprint Component 1: `workspace-prototype/src/card-themes.ts` (New File)
Export the canonical schema and 5 presets (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`), along with `getCardTheme(id)`, `loadSavedTheme()`, and `saveTheme(id)`.

```typescript
export type CardThemeId = "classic" | "cyberpunk" | "minimal-dark" | "glass" | "material-vibrant";
export const CARD_THEME_IDS: readonly CardThemeId[] = [
  "classic",
  "cyberpunk",
  "minimal-dark",
  "glass",
  "material-vibrant",
];
export const DEFAULT_CARD_THEME_ID: CardThemeId = "classic";

export interface CanvasThemeTokens {
  bgTop: string;
  bgBottom: string;
  bgGradientStop: number;
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

export interface MaterialThemeTokens {
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  edgeColor: string;
  edgeEmissive: string;
  edgeEmissiveIntensity: number;
  edgeRoughness: number;
  edgeMetalness: number;
}

export interface LightingThemeTokens {
  haloColor: string;
  haloIntensity: number;
  floorGlowColor: string;
  floorGlowIntensity: number;
}

export interface HomeCssThemeTokens {
  cardBg: string;
  cardBorder: string;
  cardAccent: string;
  cardGlow: string;
  badgeBg: string;
  badgeText: string;
}

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
  css: HomeCssThemeTokens;
}

export const CARD_THEMES: Record<CardThemeId, CardThemeDefinition> = {
  classic: {
    id: "classic",
    name: "Classic Studio",
    tagline: "Tactile Slate Cardstock & Cyan Precision",
    description: "Foundational Post Card OS aesthetic with laboratory cyan accents and matte paper finish.",
    swatchPrimary: "#70d5cf",
    swatchSecondary: "#14161b",
    canvas: {
      bgTop: "#14161B",
      bgBottom: "#0D111A",
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
      roughness: 0.88,
      metalness: 0.02,
      emissive: "#ffffff",
      emissiveIntensity: 0.82,
      edgeColor: "#19212d",
      edgeEmissive: "#152631",
      edgeEmissiveIntensity: 0.22,
      edgeRoughness: 0.26,
      edgeMetalness: 0.82,
    },
    lighting: {
      haloColor: "#ffb81c",
      haloIntensity: 48,
      floorGlowColor: "#70d5cf",
      floorGlowIntensity: 32,
    },
    css: {
      cardBg: "linear-gradient(135deg, rgba(20, 22, 27, 0.95), rgba(13, 17, 26, 0.88))",
      cardBorder: "rgba(112, 213, 207, 0.35)",
      cardAccent: "#70d5cf",
      cardGlow: "rgba(112, 213, 207, 0.15)",
      badgeBg: "rgba(112, 213, 207, 0.15)",
      badgeText: "#70d5cf",
    },
  },
  cyberpunk: {
    id: "cyberpunk",
    name: "Cyberpunk Neon",
    tagline: "High-Gloss Obsidian & Magenta/Cyan Glow",
    description: "High-contrast synthwave aesthetic with emissive neon edges and reflective obsidian chassis.",
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
      edgeEmissiveIntensity: 0.80,
      edgeRoughness: 0.18,
      edgeMetalness: 0.90,
    },
    lighting: {
      haloColor: "#ff007f",
      haloIntensity: 60,
      floorGlowColor: "#00f0ff",
      floorGlowIntensity: 42,
    },
    css: {
      cardBg: "linear-gradient(135deg, rgba(11, 4, 22, 0.96), rgba(5, 2, 10, 0.94))",
      cardBorder: "rgba(255, 0, 127, 0.65)",
      cardAccent: "#ff007f",
      cardGlow: "rgba(0, 240, 255, 0.25)",
      badgeBg: "rgba(255, 0, 127, 0.20)",
      badgeText: "#ff007f",
    },
  },
  "minimal-dark": {
    id: "minimal-dark",
    name: "Minimal Dark",
    tagline: "AMOLED Zero-Reflectance & Micro-Thin Zinc",
    description: "Architectural zero-distraction dark mode with pure black levels and non-reflective physics.",
    swatchPrimary: "#a1a1aa",
    swatchSecondary: "#050505",
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
      floorGlowIntensity: 20,
    },
    css: {
      cardBg: "linear-gradient(135deg, rgba(8, 8, 8, 0.98), rgba(0, 0, 0, 0.98))",
      cardBorder: "rgba(161, 161, 170, 0.25)",
      cardAccent: "#e4e4e7",
      cardGlow: "transparent",
      badgeBg: "rgba(161, 161, 170, 0.12)",
      badgeText: "#e4e4e7",
    },
  },
  glass: {
    id: "glass",
    name: "Glass / Frosted",
    tagline: "Translucent Cold Acrylic & Crystal Specular",
    description: "Layered glassmorphism with icy transparency, refined specular edge guides, and soft marine glow.",
    swatchPrimary: "#38bdf8",
    swatchSecondary: "#162232",
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
      edgeEmissiveIntensity: 0.65,
      edgeRoughness: 0.10,
      edgeMetalness: 0.30,
    },
    lighting: {
      haloColor: "#38bdf8",
      haloIntensity: 50,
      floorGlowColor: "#0284c7",
      floorGlowIntensity: 36,
    },
    css: {
      cardBg: "linear-gradient(135deg, rgba(26, 38, 57, 0.75), rgba(13, 20, 32, 0.82))",
      cardBorder: "rgba(186, 230, 253, 0.45)",
      cardAccent: "#38bdf8",
      cardGlow: "rgba(56, 189, 248, 0.20)",
      badgeBg: "rgba(56, 189, 248, 0.18)",
      badgeText: "#38bdf8",
    },
  },
  "material-vibrant": {
    id: "material-vibrant",
    name: "Material Vibrant",
    tagline: "Android Expressive Indigo & Warm Radiance",
    description: "Material 3 expressive palette with velvety indigo substrates, warm amber accents, and violet floor glow.",
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
      edgeEmissiveIntensity: 0.55,
      edgeRoughness: 0.35,
      edgeMetalness: 0.75,
    },
    lighting: {
      haloColor: "#f59e0b",
      haloIntensity: 52,
      floorGlowColor: "#8b5cf6",
      floorGlowIntensity: 38,
    },
    css: {
      cardBg: "linear-gradient(135deg, rgba(24, 17, 36, 0.95), rgba(14, 9, 24, 0.92))",
      cardBorder: "rgba(245, 158, 11, 0.45)",
      cardAccent: "#f59e0b",
      cardGlow: "rgba(139, 92, 246, 0.22)",
      badgeBg: "rgba(245, 158, 11, 0.18)",
      badgeText: "#f59e0b",
    },
  },
};

export function getCardTheme(id: CardThemeId): CardThemeDefinition {
  return CARD_THEMES[id] ?? CARD_THEMES[DEFAULT_CARD_THEME_ID];
}

export function loadSavedTheme(): CardThemeId {
  try {
    const saved = localStorage.getItem("postcard_studio_card_theme");
    if (saved && (CARD_THEME_IDS as readonly string[]).includes(saved)) {
      return saved as CardThemeId;
    }
  } catch {
    // Storage access unavailable
  }
  return DEFAULT_CARD_THEME_ID;
}

export function saveTheme(themeId: CardThemeId): void {
  try {
    localStorage.setItem("postcard_studio_card_theme", themeId);
  } catch (err) {
    console.warn("Unable to persist card theme to localStorage:", err);
  }
}
```

#### Blueprint Component 2: `workspace-prototype/src/main.ts` Integration

1. **Imports & Global Variable**:
   ```typescript
   import {
     CardThemeId,
     CARD_THEME_IDS,
     DEFAULT_CARD_THEME_ID,
     getCardTheme,
     loadSavedTheme,
     saveTheme,
   } from "./card-themes";

   let activeCardThemeId: CardThemeId = loadSavedTheme();
   ```

2. **`SystemCard` Type Extension (line 133)**:
   ```typescript
   type SystemCard = {
     // ... existing fields ...
     theme?: CardThemeId;
     edgeMesh?: THREE.Mesh;
     frontMesh?: THREE.Mesh;
     backMesh?: THREE.Mesh;
     // ...
   };
   ```

3. **`computeCardContentKey` Theme Injection (line 4634)**:
   ```typescript
   function computeCardContentKey(card: SystemCard): string {
     // ...
     return [
       card.theme ?? activeCardThemeId,
       card.status,
       card.facet,
       // ...
     ].join("|");
   }
   ```

4. **`makeCardTexture` Token Application (line 3064)**:
   ```typescript
   function makeCardTexture(card: SystemCard, facet: CardFacet): THREE.CanvasTexture {
     const canvas = document.createElement("canvas");
     canvas.width = 1280;
     canvas.height = 1920;
     const context = canvas.getContext("2d");
     if (!context) throw new Error("Unable to create Post Card canvas texture.");
     context.scale(2, 2);

     const meta = FACET_META[facet];
     const theme = getCardTheme(card.theme ?? activeCardThemeId);

     // Theme substrate gradient
     const gradient = context.createLinearGradient(0, 0, 640, 960);
     gradient.addColorStop(0, theme.canvas.bgTop);
     gradient.addColorStop(theme.canvas.bgGradientStop, theme.canvas.bgBottom);
     gradient.addColorStop(1, theme.canvas.bgBottom);
     context.fillStyle = gradient;
     context.fillRect(0, 0, 640, 960);

     context.fillStyle = `${card.color}16`;
     context.beginPath();
     context.arc(560, 85, 165, 0, Math.PI * 2);
     context.fill();
     context.fillStyle = meta.accent;
     roundRect(context, 48, 49, 7, 30, 3.5);
     context.fill();

     // Theme border stroke
     context.strokeStyle = theme.canvas.borderStroke;
     context.lineWidth = theme.canvas.borderWidth;
     roundRect(context, 25, 24, 590, 912, 18);
     context.stroke();
     // ...
   ```

5. **`drawCardButtons` Button Tokens (line 3383)**:
   ```typescript
   function drawCardButtons(context: CanvasRenderingContext2D, card: SystemCard): void {
     const theme = getCardTheme(card.theme ?? activeCardThemeId);
     const states = cardButtonStates(card);
     context.save();
     context.textAlign = "center";
     context.textBaseline = "middle";
     for (const [index, id] of CARD_BUTTON_IDS.entries()) {
       const rect = cardButtonRect(index);
       const { label, enabled } = states[id];
       const danger = id === "bin" || id === "stop";
       const strokeAccent = danger ? "#e495a4" : id === "guest" ? card.color : theme.canvas.buttonStroke;
       const fillStyle = id === "guest" && enabled ? `${card.color}33` : theme.canvas.buttonFill;
       const textFill = danger ? "#e495a4" : theme.canvas.buttonText;
       context.globalAlpha = enabled ? 1 : 0.38;
       context.fillStyle = fillStyle;
       roundRect(context, rect.x, rect.y, rect.w, rect.h, 10);
       context.fill();
       context.strokeStyle = strokeAccent;
       context.lineWidth = 2;
       roundRect(context, rect.x, rect.y, rect.w, rect.h, 10);
       context.stroke();
       context.fillStyle = textFill;
       context.font = "700 18px Inter, Arial, sans-serif";
       context.fillText(label.toUpperCase(), rect.x + rect.w / 2, rect.y + rect.h / 2 + 1);
     }
     context.restore();
   }
   ```

6. **`createCard` Theme Material Initialization (line 2927)**:
   ```typescript
   const theme = getCardTheme(activeCardThemeId);
   const edge = new THREE.Mesh(
     edgeGeometry,
     new THREE.MeshStandardMaterial({
       color: theme.material.edgeColor,
       emissive: theme.material.edgeEmissive,
       emissiveIntensity: theme.material.edgeEmissiveIntensity,
       metalness: theme.material.edgeMetalness,
       roughness: theme.material.edgeRoughness,
     }),
   );
   // ...
   const front = new THREE.Mesh(
     cardGeometry,
     new THREE.MeshStandardMaterial({
       map: frontTexture,
       roughness: theme.material.roughness,
       metalness: theme.material.metalness,
       emissive: theme.material.emissive,
       emissiveMap: frontTexture,
       emissiveIntensity: theme.material.emissiveIntensity,
       side: THREE.FrontSide,
     }),
   );
   card.edgeMesh = edge;
   card.frontMesh = front;
   card.backMesh = back;
   ```

7. **`applyCardTheme` Unified Controller**:
   ```typescript
   export function applyCardTheme(themeId: CardThemeId): void {
     if (!CARD_THEME_IDS.includes(themeId)) {
       themeId = DEFAULT_CARD_THEME_ID;
     }
     activeCardThemeId = themeId;
     saveTheme(themeId);

     // Update DOM views
     const homeView = document.querySelector("#home-view");
     if (homeView) homeView.setAttribute("data-card-theme", themeId);
     const studioView = document.querySelector("#studio-view");
     if (studioView) studioView.setAttribute("data-card-theme", themeId);
     document.documentElement.setAttribute("data-card-theme", themeId);

     // Update Home View theme picker chips
     const themeButtons = document.querySelectorAll<HTMLElement>("[data-theme-id]");
     themeButtons.forEach((btn) => {
       const isMatch = btn.getAttribute("data-theme-id") === themeId;
       btn.setAttribute("aria-checked", isMatch ? "true" : "false");
       btn.classList.toggle("is-active", isMatch);
     });

     // Update lighting
     const theme = getCardTheme(themeId);
     cardHaloLight.color.set(theme.lighting.haloColor);
     cardHaloLight.intensity = theme.lighting.haloIntensity;
     cardFloorGlow.color.set(theme.lighting.floorGlowColor);
     cardFloorGlow.intensity = theme.lighting.floorGlowIntensity;

     // Update 3D card materials and textures
     for (const card of cards) {
       card.cachedSharpTexture?.dispose();
       card.cachedBlurredTexture?.dispose();
       card.cachedSharpTexture = undefined;
       card.cachedBlurredTexture = undefined;
       card.cachedContentKey = undefined;
       card.lastTextureKey = undefined;

       // Edge chassis
       if (card.edgeMesh?.material instanceof THREE.MeshStandardMaterial) {
         card.edgeMesh.material.color.set(theme.material.edgeColor);
         card.edgeMesh.material.emissive.set(theme.material.edgeEmissive);
         card.edgeMesh.material.emissiveIntensity = theme.material.edgeEmissiveIntensity;
         card.edgeMesh.material.roughness = theme.material.edgeRoughness;
         card.edgeMesh.material.metalness = theme.material.edgeMetalness;
         card.edgeMesh.material.needsUpdate = true;
       }

       // Faces
       for (const faceMesh of [card.frontMesh, card.backMesh]) {
         if (faceMesh?.material instanceof THREE.MeshStandardMaterial) {
           faceMesh.material.roughness = theme.material.roughness;
           faceMesh.material.metalness = theme.material.metalness;
           faceMesh.material.emissive.set(theme.material.emissive);
           faceMesh.material.emissiveIntensity = theme.material.emissiveIntensity;
           faceMesh.material.needsUpdate = true;
         }
       }

       refreshCardTexture(card, true);
     }
   }
   ```

8. **Theme Picker Event Wiring in `main.ts`**:
   ```typescript
   document.addEventListener("click", (event) => {
     const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-theme-id]");
     if (!target) return;
     const themeId = target.getAttribute("data-theme-id") as CardThemeId | null;
     if (themeId && CARD_THEME_IDS.includes(themeId)) {
       applyCardTheme(themeId);
     }
   });
   ```

---

### 5. Verification Method

To verify the implementation once coded by the Worker:

1. **Static Typecheck**:
   ```powershell
   cd workspace-prototype
   npx tsc --noEmit
   ```
   *Expected*: Zero errors. Confirms `CardThemeId`, `SystemCard.theme`, and material uniform types compile cleanly.

2. **Production Bundle Build**:
   ```powershell
   cd workspace-prototype
   npm run build
   ```
   *Expected*: Vite builds cleanly without missing exports or rollup warnings.

3. **Existing Test Suite**:
   ```powershell
   cd workspace-prototype
   npm test
   ```
   *Expected*: All 63 tests pass with 0 failures.

4. **Card Theming Verification Test**:
   Execute Node test runner checking:
   - `getCardTheme(id)` returns valid definitions for all 5 preset IDs.
   - `loadSavedTheme()` returns `"classic"` when storage is unpopulated, and returns saved ID when populated.
   - `computeCardContentKey(card)` changes when `activeCardThemeId` changes.
   - Texture cache `card.cachedContentKey !== contentKey` is triggered upon theme switch.
