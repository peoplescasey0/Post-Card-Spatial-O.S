# Post Card Spatial OS — Android Theming & Card Texture Rendering Survey Report

**Document Date**: 2026-11-11  
**Investigation Scope**: Post Card OS (`workspace-prototype/`, Three.js 0.180.0, Vite, TypeScript 5.9, Node.js test runner)  
**Deliverable Target**: `.agents/teamwork/explorer_survey_theming/handoff.md`  

---

## 1. Observation

Direct, verified observations from inspecting `workspace-prototype/src/card-themes.ts`, `workspace-prototype/src/main.ts`, `workspace-prototype/src/style.css`, `workspace-prototype/index.html`, and existing test suites.

### 1.1 Existing Theming Implementation (`card-themes.ts`)
1. **Canonical Theme IDs & Constraint**:
   - `workspace-prototype/src/card-themes.ts:7-20`: Defines `CardThemeId` as `"classic" | "cyberpunk" | "minimal-dark" | "glass" | "material-vibrant"`.
   - `CARD_THEME_IDS` is an array of exactly 5 elements.
   - `workspace-prototype/tests/card-theming.test.mjs:15` and `tests/card-theming-collision.test.mjs:282` explicitly assert:
     ```typescript
     assert.equal(themesModule.CARD_THEME_IDS.length, 5, "Must declare exactly 5 canonical theme IDs");
     ```
     Any addition to `CARD_THEME_IDS` directly breaks existing test assertions unless handled via an auxiliary array/registry (e.g., `ANDROID_THEME_IDS`, `ALL_THEME_IDS`).
2. **Token Schemas**:
   - `CanvasThemeTokens` (`card-themes.ts:29-44`): Defines `bgTop`, `bgBottom`, `bgGradientStop?`, `borderStroke`, `borderWidth`, `badgeColor`, `headerColor`, `titleColor`, `detailColor`, `buttonFill`, `buttonStroke`, `buttonText`, `fastenerRim`, `fastenerHead`.
   - `MaterialThemeTokens` (`card-themes.ts:49-59`): Defines `roughness`, `metalness`, `emissive`, `emissiveIntensity`, `edgeColor?`, `edgeEmissive?`, `edgeEmissiveIntensity?`, `edgeRoughness?`, `edgeMetalness?`.
   - `LightingThemeTokens` (`card-themes.ts:64-69`): Defines `haloColor`, `haloIntensity`, `floorGlowColor`, `floorGlowIntensity`.
   - `HomeCssThemeTokens` (`card-themes.ts:74-87`): Defines `cardBg`, `cardBorder`, `cardAccent`, `cardGlow`, `badgeBg`, `badgeText`, and custom CSS properties.
   - `CardThemeDefinition` (`card-themes.ts:92-104`): Unifies the tokens with metadata (`id`, `name`, `tagline`, `description`, `swatchPrimary`, `swatchSecondary`).
3. **Persistence and Fallback**:
   - `card-themes.ts:23-25`: Storage key is `"postcard_studio_card_theme"`.
   - `card-themes.ts:416-428` (`loadPersistedTheme`) and lines 438-446 (`persistTheme`): Validates stored theme against `isValidCardThemeId(saved)` and falls back to `"classic"`.

### 1.2 Runtime Flow & 2D/3D Propagation (`main.ts`)
1. **Theme State & Application Function**:
   - `workspace-prototype/src/main.ts:1141-1143`: `let activeCardThemeId: CardThemeId = loadPersistedTheme();`
   - `workspace-prototype/src/main.ts:4577-4655` (`applyCardTheme(themeId: CardThemeId)`):
     - Validates `themeId` and sets `activeCardThemeId = themeId`.
     - Calls `persistTheme(themeId)`.
     - Sets `homeViewElement.dataset.cardTheme = themeId` and `studioViewElement.dataset.cardTheme = themeId` (lines 4584-4597).
     - Loops through `[data-theme-id]` elements, updating `.is-active` and `aria-checked="true|false"` (lines 4600-4605).
     - Updates Three.js PointLights: `cardHaloLight.color.set(theme.lighting.haloColor); cardHaloLight.intensity = theme.lighting.haloIntensity;` and `cardFloorGlow.color.set(theme.lighting.floorGlowColor); cardFloorGlow.intensity = theme.lighting.floorGlowIntensity;` (lines 4610-4620).
     - Updates Three.js mesh materials: `edgeMesh.material` (roughness, metalness, edgeColor, edgeEmissive), `frontMesh.material` (roughness, metalness, emissive), and `backMesh.material` (lines 4624-4650).
     - Calls `refreshCardTexture(card, true)` for all cards in the scene (line 4653).
2. **Texture Invalidation & Rendering (`main.ts`)**:
   - `workspace-prototype/src/main.ts:4986-5013` (`computeCardContentKey`):
     - Line 4987: Injects `card.theme ?? activeCardThemeId` as the very first element of the key string.
   - `workspace-prototype/src/main.ts:5019-5070` (`refreshCardTexture(card, force)`):
     - When `force === true` (or when contentKey changes):
       Disposes `card.cachedSharpTexture` and `card.cachedBlurredTexture`.
       Invokes `makeCardTexture(card, card.facet)`.
       Replaces `child.material.map` and `child.material.emissiveMap`.
3. **Lighting Animation Loop (`main.ts`)**:
   - `workspace-prototype/src/main.ts:8140-8152`: Render loop calculates `haloTarget = new THREE.Color(activeTheme.lighting.haloColor)` and `floorTarget = new THREE.Color(activeTheme.lighting.floorGlowColor)` and lerps `cardHaloLight.color` and `cardFloorGlow.color` every frame.

### 1.3 Identified Hardcoded Colors, Gaps, and Regressions
1. **Critical 3D Selection Emissive Overwrite**:
   - `workspace-prototype/src/main.ts:4461` (in `selectCard`):
     ```typescript
     material.emissive.set(item === card ? "#70d5cf" : "#152631");
     ```
   - `workspace-prototype/src/main.ts:8093` (in turntable animation loop):
     ```typescript
     material.emissive.set(item === closestCard ? "#70d5cf" : "#152631");
     ```
     **Direct Impact**: When any theme other than `classic` is active (e.g. `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`, or a dynamic theme), selecting a card or rotating the turntable immediately overwrites the card's edge chassis emissive with `#70d5cf` (classic cyan) and `#152631` (classic dark slate), destroying theme consistency!
2. **Hardcoded Text Colors in 3D Canvas Rendering**:
   - `workspace-prototype/src/main.ts:3260`: `context.fillStyle = "#c3c8d1"; context.fillText("CLICK TO ZOOM · DRAG TO FLIP", 592, 914);`
   - `workspace-prototype/src/main.ts:3450`: `context.fillStyle = "#f4f5f7";` (Card title in `drawCardFront`)
   - `workspace-prototype/src/main.ts:3454`: `context.fillStyle = "#c3c8d1";` (Card detail in `drawCardFront`)
   - `workspace-prototype/src/main.ts:3466`: `context.fillStyle = "#f4f5f7";` (Card status in `drawCardFront`)
   - `workspace-prototype/src/main.ts:3469`: `context.fillStyle = "#c3c8d1";` (Card previewNote in `drawCardFront`)
   - `workspace-prototype/src/main.ts:3777, 3780`: `drawCardSettings` hardcodes `#f4f5f7` and `#c3c8d1`.
   - `workspace-prototype/src/main.ts:3894, 3897`: `drawCardSecurity` hardcodes `#f4f5f7` and `#c3c8d1`.
   - `workspace-prototype/src/main.ts:3951, 3954`: `drawCardPlanes` hardcodes `#f4f5f7` and `#c3c8d1`.
   - `workspace-prototype/src/main.ts:4008, 4011`: `drawCardQuickActions` hardcodes `#f4f5f7` and `#c3c8d1`.
   - `workspace-prototype/src/main.ts:4067, 4070`: `drawCardTelemetry` hardcodes `#f4f5f7` and `#c3c8d1`.
   **Direct Impact**: Even though `theme.canvas.titleColor` and `theme.canvas.detailColor` are defined on the theme, they are ignored by all card facet drawers.
3. **Hardcoded Logos, Guides, and Compass Dots**:
   - `workspace-prototype/src/main.ts:3331-3333`: `drawCompanyLogo` hardcodes `#1E2736`, `#14161B`, `#0d111a`, `#FFB81C`, `#FDE047`.
   - `workspace-prototype/src/main.ts:3396-3416`: `drawEdgeFlipGuides` hardcodes `#70d5cf`, `#bca8ff`, `#8baef0`, `#eea3a6`.
   - `workspace-prototype/src/main.ts:3433`: `drawFacetCompassDots` hardcodes inactive dot color to `#262a33`.
4. **2D Home View CSS Styling Architecture Gap**:
   - `workspace-prototype/src/style.css:3236-3298`: CSS rules are statically defined via `#home-view[data-card-theme="classic"]`, `[data-card-theme="cyberpunk"]`, `[data-card-theme="minimal-dark"]`, `[data-card-theme="glass"]`, `[data-card-theme="material-vibrant"]`.
   - `applyCardTheme` in `main.ts:4584-4590` ONLY sets `homeViewElement.dataset.cardTheme = themeId`. It does NOT set the `--card-theme-*` CSS variables on `homeViewElement.style`.
   - **Direct Impact for Dynamic Themes**: Any dynamically generated theme (e.g. from seed colors or new Android presets) will have NO matching selector in `style.css`, causing 2D cards to fall back to unstyled `:root` default variables!
5. **Hardcoded Featured Card in 2D Home View**:
   - `workspace-prototype/src/style.css:3099-3112` (`.home-system-card-featured`):
     Hardcodes `rgba(255, 184, 28, 0.36)` and `rgba(255, 184, 28, 0.55)` (amber).
   - `workspace-prototype/src/main.ts:4503-4513`: When switching to `#home-view`, the card active in studio receives `.home-system-card-featured`, which renders with hardcoded amber border and background regardless of active theme.
6. **UI Control Gaps (R3)**:
   - `workspace-prototype/index.html:84-112`: Only contains 5 theme buttons inside `#home-view`.
   - `#studio-view` (lines 197-260) contains NO theme selection controls whatsoever.
   - There is NO seed-color picker input (`<input type="color">` or swatch selector) anywhere in the application.

---

## 2. Logic Chain

1. **Premise 1**: The original user request mandates:
   - R1: Android-style theming engine supporting preset Android Material theme palettes and dynamic tonal palette generation from seed colors.
   - R2: Apply theme palettes consistently across both 2D home-screen cards and 3D spatial studio cards.
   - R3: Theme selection controls and state persistence across navigation between 2D home and 3D studio views.
2. **Premise 2**: In `main.ts`, 3D card textures are rasterized dynamically onto a 1280x1920 canvas via `makeCardTexture(card, facet)` and uploaded as `THREE.CanvasTexture`. The texture key incorporates `card.theme ?? activeCardThemeId` (`computeCardContentKey`, line 4987), ensuring cache invalidation works when `refreshCardTexture(card, true)` is triggered.
3. **Premise 3**: However, `makeCardTexture` and the facet drawing functions (`drawCardFront`, etc.) hardcode text and accent colors (`#f4f5f7`, `#c3c8d1`, `#70d5cf`, `#152631`), ignoring `theme.canvas.titleColor`, `theme.canvas.detailColor`, and `theme.material.edgeEmissive`. Therefore, changing the theme does not fully recolor the card content.
4. **Premise 4**: On the 2D Home View, `.home-system-card` elements rely entirely on CSS variables (`--card-theme-bg`, `--card-theme-border`, `--card-theme-accent`) that are only defined for the 5 static theme IDs in `style.css:3236-3298`. Because `applyCardTheme` only sets `dataset.cardTheme` without setting inline CSS custom properties on `homeViewElement.style`, any dynamic theme generated from a seed color fails to style the 2D cards.
5. **Premise 5**: In `card-themes.test.mjs:15` and `card-theming-collision.test.mjs:282`, unit tests assert that `CARD_THEME_IDS.length === 5` and verify the canonical IDs `["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"]`. Therefore, adding Android presets or dynamic IDs directly to `CARD_THEME_IDS` would cause regressions in existing test suites.
6. **Inference**: To support both preset Android palettes and dynamic seed color palettes across both 2D and 3D views without breaking existing tests, we must:
   - Keep `CARD_THEME_IDS` strictly representing the 5 canonical IDs, and define an extended registry / accessor in `card-themes.ts` that recognizes Android presets and dynamic seed identifiers (`seed-#HEX`).
   - Implement an algorithmic tonal palette generator in `card-themes.ts` based on Material 3 tonal rules (Primary, Secondary, Tertiary, Neutral, Neutral Variant across 13 tones).
   - Update `applyCardTheme` in `main.ts` to inject CSS custom properties directly into `homeViewElement.style` (enabling arbitrary dynamic themes to style 2D cards without CSS modifications).
   - Fix hardcoded colors in `drawCardFront`, `drawCardSettings`, `selectCard`, and the turntable render loop so 3D cards accurately reflect the active theme's colors.
   - Add theme selection controls (Android presets and seed-color picker) to `#home-view`, and add a theme selector control to `#studio-view`'s topbar to satisfy R3.

---

## 3. Caveats

1. **HCT vs HSL/RGB Approximation**: Full HCT (Hue, Chroma, Tone) as implemented by Google's `material-color-utilities` package relies on CAM16 and CIELAB color appearance models. For a zero-dependency, lightweight implementation in the Vite browser environment, a pure TypeScript perceptual luminance / HSL-with-tonal-mapping algorithm can accurately calculate tones $T \in [0, 100]$ and contrast ratios $\ge 4.5:1$ without external npm packages.
2. **Per-Card Themes vs Global Workspace Theme**: `SystemCard` has an optional `theme?: CardThemeId` property. Currently, `applyCardTheme` applies a global theme to all cards while `card.theme` allows per-card overrides. The dynamic generator should support both global workspace theming and per-card theme definitions.
3. **Static CSS Specificity**: `style.css` defines static `:root` and `#home-view[data-card-theme]` rules. Setting style properties directly on `homeViewElement.style` has higher specificity than stylesheets (`style` attribute beats `#home-view[data-card-theme]`), which is optimal for dynamic seed color overriding.

---

## 4. Conclusion

The Post Card OS codebase has a functional spatial theming scaffold (Three.js point lights, PBR roughness/metalness, canvas texture invalidation, and localStorage persistence), but requires targeted architectural additions to achieve full Android Material You fidelity:

1. **Dynamic Engine**: An algorithmic tonal palette engine (`generateThemeFromSeed(hexColor, name?)`) generating coordinated Material 3 roles (`surface`, `surfaceContainer`, `primary`, `onPrimary`, `secondary`, `tertiary`, `outline`, `onSurface`, `onSurfaceVariant`).
2. **Android Presets**: 5 canonical Android system presets (Android Ocean Blue, Android Forest Green, Android Sunset Terracotta, Android Lavender Orchid, Android Ember Crimson).
3. **Dual-View Propagation**:
   - 2D: `applyCardTheme` must write CSS custom properties directly onto `homeViewElement.style`.
   - 3D: `main.ts` must use `theme.canvas.titleColor`, `theme.canvas.detailColor`, and `theme.material.edgeEmissive` in facet rendering and selection routines instead of hardcoded `#f4f5f7`, `#c3c8d1`, and `#70d5cf`.
4. **UI Controls & View Persistence**:
   - `#home-view`: Add Android preset buttons and custom seed color picker (`<input type="color">`).
   - `#studio-view`: Add a topbar theme selector pill/dropdown.
   - Persistence: Allow `localStorage` to persist both preset IDs and `seed-#HEX` strings with safe fallback.

---

## 5. Architectural & Interface Proposals

### 5.1 Material 3 Tonal Roles & Theme Interface Extension

```typescript
// Proposed extension in workspace-prototype/src/card-themes.ts

export type CanonicalCardThemeId =
  | "classic"
  | "cyberpunk"
  | "minimal-dark"
  | "glass"
  | "material-vibrant";

export type AndroidPresetThemeId =
  | "android-ocean"
  | "android-forest"
  | "android-sunset"
  | "android-lavender"
  | "android-ember";

export type CardThemeId = CanonicalCardThemeId | AndroidPresetThemeId | string;

/** Material 3 Semantic Color Roles */
export interface Material3ColorRoles {
  primary: string;
  onPrimary: string;
  primaryContainer: string;
  onPrimaryContainer: string;
  secondary: string;
  onSecondary: string;
  secondaryContainer: string;
  onSecondaryContainer: string;
  tertiary: string;
  onTertiary: string;
  tertiaryContainer: string;
  onTertiaryContainer: string;
  surface: string;
  onSurface: string;
  surfaceVariant: string;
  onSurfaceVariant: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  outline: string;
  outlineVariant: string;
  inverseSurface: string;
  inverseOnSurface: string;
}

export interface CardThemeDefinition {
  id: CardThemeId;
  name: string;
  tagline: string;
  description: string;
  swatchPrimary: string;
  swatchSecondary: string;
  seedColor?: string;
  roles?: Material3ColorRoles;
  canvas: CanvasThemeTokens;
  material: MaterialThemeTokens;
  lighting: LightingThemeTokens;
  homeCss: HomeCssThemeTokens;
  css?: HomeCssThemeTokens;
}
```

### 5.2 Dynamic Tonal Palette Derivation Algorithm

From any seed color (Hex `#RRGGBB`), the engine extracts Hue, Saturation, Lightness, and calculates 5 core tonal palettes across standard stops:
- **Primary ($P$)**: Seed hue, high chroma ($S \ge 65\%$).
- **Secondary ($S$)**: Seed hue, muted chroma ($S \approx 25\%$).
- **Tertiary ($T$)**: Seed hue $+ 60^\circ$ complementary shift, moderate chroma ($S \approx 45\%$).
- **Neutral ($N$)**: Seed hue, low chroma ($S \approx 8\%$).
- **Neutral Variant ($NV$)**: Seed hue, low-medium chroma ($S \approx 14\%$).

Tones are calculated using perceptual lightness:
- Tone 6 (Dark Surface base): $L \approx 6\%$
- Tone 12 (Surface Container): $L \approx 12\%$
- Tone 17 (Surface Container High): $L \approx 17\%$
- Tone 30 (Container Fill / Dark Accent): $L \approx 28\%$
- Tone 60 (Outline): $L \approx 58\%$
- Tone 80 (Primary / Secondary Accent in dark mode): $L \approx 78\%$
- Tone 90 (On Surface High Emphasis Text): $L \approx 90\%$
- Tone 95 (Bright Text): $L \approx 95\%$

### 5.3 2D View CSS Variable Injection (`main.ts`)

In `applyCardTheme(themeId)`:
```typescript
const theme = getCardTheme(themeId);

// Dynamically inject CSS variables onto home view element for any theme (preset or seed-based)
if (homeViewElement) {
  homeViewElement.style.setProperty("--card-theme-bg", theme.homeCss.cardBg);
  homeViewElement.style.setProperty("--card-theme-border", theme.homeCss.cardBorder);
  homeViewElement.style.setProperty("--card-theme-accent", theme.homeCss.cardAccent);
  homeViewElement.style.setProperty("--card-theme-glow", theme.homeCss.cardGlow);
  homeViewElement.style.setProperty("--card-theme-corner", theme.canvas.borderStroke);
  homeViewElement.style.setProperty("--card-theme-on-surface", theme.canvas.titleColor);
  homeViewElement.style.setProperty("--card-theme-on-surface-variant", theme.canvas.detailColor);
}
```

### 5.4 3D Facet Rendering Corrections (`main.ts`)

1. In `drawCardFront`:
   ```typescript
   // Before:
   context.fillStyle = "#f4f5f7";
   drawWrappedText(context, card.name.split(" · ")[1] ?? card.name, 48, 192, 530, 58, 2);
   context.fillStyle = "#c3c8d1";
   drawWrappedText(context, card.detail, 48, 280, 530, 34, 2);

   // After:
   context.fillStyle = theme.canvas.titleColor || "#f4f5f7";
   drawWrappedText(context, card.name.split(" · ")[1] ?? card.name, 48, 192, 530, 58, 2);
   context.fillStyle = theme.canvas.detailColor || "#c3c8d1";
   drawWrappedText(context, card.detail, 48, 280, 530, 34, 2);
   ```
2. In `selectCard` (line 4461) and turntable loop (line 8093):
   ```typescript
   // Before:
   material.emissive.set(item === card ? "#70d5cf" : "#152631");

   // After:
   const activeTheme = getCardTheme(activeCardThemeId);
   material.emissive.set(
     item === card
       ? (activeTheme.material.edgeEmissive || activeTheme.swatchPrimary)
       : (activeTheme.material.edgeColor || "#152631")
   );
   ```

---

## 6. Verification Method

To independently verify the facts and findings in this report:

1. **Verify Existing Tests Pass**:
   ```powershell
   cd workspace-prototype
   npm test
   ```
   *Expected Result*: 117 tests pass across all test suites.
2. **Verify Hardcoded Strings in `main.ts`**:
   ```powershell
   Select-String -Path "workspace-prototype/src/main.ts" -Pattern "item === card \? ""#70d5cf""", "item === closestCard \? ""#70d5cf"""
   ```
   *Verified Location*: `main.ts:4461` and `main.ts:8093`.
3. **Verify Static CSS Selector Dependency**:
   ```powershell
   Select-String -Path "workspace-prototype/src/style.css" -Pattern "#home-view\[data-card-theme="
   ```
   *Verified Location*: `style.css:3236-3298` (only 5 static rules exist).
4. **Verify Test Assertion on `CARD_THEME_IDS.length`**:
   ```powershell
   Select-String -Path "workspace-prototype/tests/card-theming.test.mjs" -Pattern "CARD_THEME_IDS.length"
   ```
   *Verified Location*: Line 15 asserts `CARD_THEME_IDS.length === 5`.
