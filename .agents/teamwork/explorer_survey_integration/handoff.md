# Handoff Report: Surface Integration, UI Controls, State Persistence, and Test Suite Survey

**Task**: Survey surface integration across 2D/3D views, UI controls, state persistence, and automated test suites in Post Card OS.  
**State Folder**: `G:\micro-host\.agents\teamwork\explorer_survey_integration\`  
**Date / Timestamp**: 2026-11-11T19:20:00Z  
**Integrity Mode**: development  

---

## 1. Observation

### 1.1 Baseline Test Suite & Build Status
- **Test Runner & Configuration**: `workspace-prototype/package.json` specifies `"type": "module"` and `"test": "node --test"`.
- **Command & Execution Output**:
  Running `npm test` inside `G:\micro-host\workspace-prototype`:
  ```
  > post-card-workspace-prototype@0.1.0 test
  > node --test
  ...
  ℹ tests 117
  ℹ suites 0
  ℹ pass 117
  ℹ fail 0
  ℹ cancelled 0
  ℹ skipped 0
  ℹ todo 0
  ℹ duration_ms 9823.2991
  ```
  Baseline status is **117 passing tests** across 18 test files with **0 failures**, **0 skipped**, and **0 regressions**.
- **Typecheck & Bundler Verification**:
  - `npx tsc --noEmit`: Exits `0` with 0 type errors.
  - `npm run build` (`tsc --noEmit && vite build`): Exits `0`, transforms 67 modules, bundles into `dist/index.html`, `dist/assets/index-*.css`, and `dist/assets/index-*.js`.

---

### 1.2 2D Home View Integration (`#home-view`)
- **Structure in `workspace-prototype/index.html`**:
  - `#home-view` container is a `<main class="home-view" id="home-view" hidden>` (line 17).
  - Contains `.home-theme-bar` (lines 85–112):
    - Meta description: `.home-theme-meta`, `.home-theme-badge` ("THEME"), `.home-theme-desc` ("Card Style Preset:").
    - Radio group: `.home-theme-picker[data-theme-picker][role="radiogroup"]` containing 5 `<button class="theme-chip" role="radio">` with attributes `data-theme-id="classic|cyberpunk|minimal-dark|glass|material-vibrant"`.
    - Each chip contains `<span class="theme-swatch theme-swatch-[id]">` and `<span class="theme-chip-label">`.
  - System card grid: `.home-system-grid` (lines 114–179) containing 5 card buttons:
    - Card 1: `[data-open-studio] [data-card-id="android"]` ("Android · Pocket Lab")
    - Card 2: `[data-open-studio] [data-card-id="windows"]` ("Windows · Studio")
    - Card 3: `[data-open-studio] [data-card-id="linux"] class="home-system-card home-system-card-featured"` ("Linux · Dev Space")
    - Card 4: `[data-open-studio] [data-card-id="macos"]` ("macOS · Cupertino")
    - Card 5: `[data-open-studio] [data-card-id="kali-red"]` ("Kali · Cyber Range")
  - Hero visual stack: `.home-card-stack` (lines 53–67) with `.home-stack-card-back`, `.home-stack-card-mid`, `.home-stack-card-front`.
- **Styling in `workspace-prototype/src/style.css`**:
  - Base card styling (`.home-system-card`, line 3062):
    - `border: 1px solid var(--card-theme-border, rgba(138, 144, 158, 0.22));`
    - `background: var(--card-theme-bg, linear-gradient(135deg, rgba(255, 255, 255, 0.025), transparent 55%), rgba(13, 17, 26, 0.88));`
    - `color: var(--studio-text-main);`
  - Corner notch (`.home-system-card::after`, line 3080):
    - `border-top: 1px solid var(--card-theme-corner, rgba(138, 144, 158, 0.28));`
    - `border-right: 1px solid var(--card-theme-corner, rgba(138, 144, 158, 0.28));`
  - Hover states (`.home-system-card:hover`, line 3092):
    - `border-color: var(--card-theme-border-hover, rgba(195, 200, 209, 0.48));`
    - `background: var(--card-theme-bg-hover, #14161b);`
    - `box-shadow: var(--card-theme-glow, none);`
  - **Hardcoded gap on featured card** (`.home-system-card-featured`, lines 3099–3112):
    ```css
    .home-system-card-featured {
      border-color: rgba(255, 184, 28, 0.36);
      background: linear-gradient(110deg, rgba(255, 184, 28, 0.055), transparent 58%), rgba(13, 17, 26, 0.94);
    }
    .home-system-card-featured::after {
      border-color: rgba(255, 184, 28, 0.55);
    }
    .home-system-card-featured:hover {
      border-color: rgba(255, 184, 28, 0.72);
    }
    ```
    This hardcodes amber `#ffb81c` instead of using the active theme accent/primary color.
  - **Theme attribute selectors in CSS** (lines 3224–3298):
    Defined for `#home-view[data-card-theme="classic"]`, `[data-card-theme="cyberpunk"]`, `[data-card-theme="minimal-dark"]`, `[data-card-theme="glass"]`, and `[data-card-theme="material-vibrant"]`.
    Each block overrides `--card-theme-bg`, `--card-theme-bg-hover`, `--card-theme-border`, `--card-theme-border-hover`, `--card-theme-corner`, `--card-theme-accent`, `--card-theme-glow`, `--card-theme-mark-bg`, and `--card-theme-mark-border`.

---

### 1.3 3D Spatial Studio Cards Integration (`#studio-view`)
- **Mesh and Material Structure in `workspace-prototype/src/main.ts`**:
  - Cards are instances of `SystemCard`.
  - Chassis edge: `card.edgeMesh` with `MeshStandardMaterial` (updated lines 4624–4632).
  - Front face: `card.frontMesh` with `MeshStandardMaterial` (updated lines 4634–4641).
  - Back face: `card.backMesh` with `MeshStandardMaterial` (updated lines 4643–4650).
- **Procedural Canvas Rasterization (`makeCardTexture`, lines 3193–3277)**:
  - Generates an offscreen HTML5 `<canvas>` sized $1280 \times 1920$ (logical $640 \times 960$ at scale $2\times$).
  - Background (lines 3203–3208):
    - Uses `theme.canvas.bgTop`, `theme.canvas.bgBottom`, and `theme.canvas.bgGradientStop ?? 0.58`.
  - Outer border (lines 3218–3221):
    - Uses `theme.canvas.borderStroke` and `theme.canvas.borderWidth`.
  - Corner fasteners (lines 3266–3270):
    - 4 corners at (38, 36), (602, 36), (38, 924), (602, 924) drawn via `drawChassisFastener` using `theme.canvas.fastenerHead` and `theme.canvas.fastenerRim`.
  - Tactile printed buttons (`drawCardButtons`, lines 3513–3537):
    - 8 buttons: `guest`, `stop`, `zoom`, `settings`, `clone`, `savepoint`, `performance`, `bin`.
    - Buttons consume `theme.canvas.buttonFill`, `theme.canvas.buttonStroke`, and `theme.canvas.buttonText` (with danger override `#e495a4` for bin/stop).
  - **Hardcoded styling gaps in 3D Canvas**:
    - Lines 3214, 3223, 3226, 3257: `context.fillStyle = meta.accent;` where `meta` comes from `FACET_META[facet]`, hardcoding facet accents (`#62d8d0`, `#c5a9ff`, `#ffd166`, etc.) rather than theme primary/secondary tokens.
    - Lines 3450 & 3466 in `drawCardFront`: Card title and status text use hardcoded `context.fillStyle = "#f4f5f7";` instead of `theme.canvas.titleColor` or `onSurface`.
    - Lines 3454 & 3470 in `drawCardFront`: Card detail and preview note use hardcoded `context.fillStyle = "#c3c8d1";` instead of `theme.canvas.detailColor` or `onSurfaceVariant`.
    - Lines 3774, 3854, 3922, 4064: Sub-facets (settings, security, planes, telemetry) use hardcoded `context.fillStyle = "#FFB81C";`.
- **Dynamic Spatial Lighting & Materials (`applyCardTheme`, lines 4577–4655)**:
  - `cardHaloLight`: Point light behind active card, sets `color` to `theme.lighting.haloColor` and `intensity` to `theme.lighting.haloIntensity`.
  - `cardFloorGlow`: Point light at floor level, sets `color` to `theme.lighting.floorGlowColor` and `intensity` to `theme.lighting.floorGlowIntensity`.
  - `glowDisc`: Floor mesh, sets `material.color` to `theme.lighting.floorGlowColor`.
  - PBR material properties: updates `roughness`, `metalness`, `emissive`, `emissiveIntensity`, and edge chassis colors.
- **Cache Invalidation Pipeline**:
  - Line 4987 in `computeCardContentKey(card)`: begins with `card.theme ?? activeCardThemeId`.
  - Line 4653 in `applyCardTheme`: calls `refreshCardTexture(card, true)`.
  - Lines 5027–5033: forces texture disposal (`cachedSharpTexture?.dispose()`, `cachedBlurredTexture?.dispose()`) and re-rasterizes new `CanvasTexture`.

---

### 1.4 Theme Selection Controls & Persistence
- **Existing Controls**:
  - Located strictly on `#home-view` inside `.home-theme-picker[data-theme-picker]`.
  - 5 buttons with `data-theme-id="classic|cyberpunk|minimal-dark|glass|material-vibrant"`.
  - Zero controls currently exist in `#studio-view`.
- **Event Handling (`initCardThemePicker`, lines 4660–4672)**:
  - Click listener delegates `[data-theme-id]`, calls `applyCardTheme(themeId)`.
- **Persistence (`card-themes.ts`, lines 416–446)**:
  - Key: `THEME_STORAGE_KEY = "postcard_studio_card_theme"`.
  - `loadPersistedTheme()`: Reads key, verifies `isValidCardThemeId(saved)`, falls back to `"classic"`.
  - `persistTheme(themeId)`: Sets `localStorage.setItem(THEME_STORAGE_KEY, themeId)`.
- **View Navigation Router (`main.ts`, lines 4471–4570)**:
  - `showStudio(cardId?)`: Sets `homeViewElement.hidden = true; studioViewElement.hidden = false; window.location.hash = "#studio";`.
  - `showHome()`: Sets `studioViewElement.hidden = true; homeViewElement.hidden = false; window.location.hash = "#home";`.
  - DOM elements and Three.js scene graph are never torn down during navigation; only `hidden` and URL hash change.

---

## 2. Logic Chain

1. **2D Home View Theming Integration**:
   - *Observation*: `.home-system-card` elements rely on CSS custom properties (`--card-theme-bg`, `--card-theme-border`, `--card-theme-accent`, etc.) defined under attribute selectors `#home-view[data-card-theme="[id]"]`.
   - *Inference 1*: If a user selects a preset theme (`classic`, `cyberpunk`, etc.), setting `homeViewElement.dataset.cardTheme = themeId` successfully activates the corresponding CSS block.
   - *Inference 2*: If a user generates a dynamic palette from an arbitrary seed color (e.g. `#4285F4`), no pre-compiled attribute selector exists for that color. Therefore, dynamic palettes must be applied either by injecting CSS custom properties directly onto `homeViewElement.style` (or `:root`) via `element.style.setProperty('--card-theme-*', value)` OR by generating an inline style sheet.
   - *Inference 3*: `.home-system-card-featured` currently hardcodes amber `#ffb81c` border and gradient. To harmonize with Android theme palettes, it must consume `var(--card-theme-accent)` or `--md-sys-color-primary` with graceful fallback.

2. **3D Spatial Studio Cards Integration**:
   - *Observation*: `makeCardTexture` rasterizes cards on a 2D canvas and uploads them to WebGL. While background gradient, outer border, corner fasteners, and tactile buttons consume `theme.canvas` tokens, card titles (`#f4f5f7`), subtitles (`#c3c8d1`), and facet headers (`meta.accent`) are hardcoded.
   - *Inference 1*: To bring 3D cards into compliance with Android Material 3 color roles:
     - Background: `surface` / `surfaceContainer` (`bgTop` and `bgBottom`).
     - Header / Badge / Accent: `primary` / `primaryContainer` (replaces hardcoded facet accents).
     - Title Text: `onSurface` (replaces `#f4f5f7`).
     - Detail / Metadata / Footer Text: `onSurfaceVariant` (replaces `#c3c8d1`).
     - Border / Outline: `outline` / `outlineVariant`.
     - Button Fills: `surfaceContainerHigh` or `secondaryContainer`.
     - Button Text: `onSurface` or `onSecondaryContainer`.
   - *Inference 2*: Because `computeCardContentKey(card)` hashes `card.theme ?? activeCardThemeId`, changing the theme ID (or dynamic seed key, e.g. `dynamic:#4285F4`) automatically invalidates texture cache, disposes stale GPU textures, and triggers a clean re-render without VRAM memory leaks.

3. **Theme Selection Controls & State Persistence**:
   - *Observation*: The current UI only offers 5 preset buttons on `#home-view`. The user request requires supporting both preset Android theme palettes AND dynamic tonal palette generation from seed colors, with persistence across navigation.
   - *Inference 1*: UI controls must be expanded on `#home-view` to include:
     - A preset selector covering Android Material theme palettes (e.g. Android Expressive / Vibrant, Android Neutral / Spritz, Android Ocean, Android Forest, etc., maintaining existing 5 IDs for backwards compatibility).
     - An interactive seed color picker: `<input type="color" id="theme-seed-picker">`, text hex input, and quick seed swatches.
     - Live preview chips showing the resulting tonal color roles (`primary`, `surfaceContainer`, `outline`).
     - Optional Studio Topbar control or Settings dialog entry to switch themes from within 3D.
   - *Inference 2*: `localStorage` must store the active theme state. To support arbitrary seed colors without breaking existing tests that expect string theme IDs:
     - When a preset is chosen, persist its ID string (e.g. `"cyberpunk"` or `"material-vibrant"`).
     - When a dynamic seed is chosen, persist a serialized descriptor (e.g. `"seed:#4285F4"` or JSON `{ mode: "seed", color: "#4285F4" }`).
     - When `loadPersistedTheme()` runs, handle both preset IDs and seed descriptors with graceful fallback.
   - *Inference 3*: Because `showStudio()` and `showHome()` only toggle `.hidden`, in-memory theme state and 3D GPU textures persist continuously during view transitions. Rehydration on cold boot is already guaranteed by calling `applyCardTheme(loadPersistedTheme())` on startup.

4. **Automated Test Suite Expansion**:
   - *Observation*: The existing 117 tests pass with 0 failures, covering 5 canonical theme presets, floor collision clamping, button interactivity, and view navigation.
   - *Inference 1*: New tests must be added in `workspace-prototype/tests/` without modifying or breaking existing assertions.
   - *Inference 2*: The new tests must verify the 4 core dimensions:
     1. Dynamic seed color palette generation (HCT tonal progression, contrast ratio $\ge 4.5:1$, color validity).
     2. Preset Android theme palette availability and schema conformity.
     3. Surface integration across 2D CSS and 3D Canvas / PBR / Lighting.
     4. State persistence and seamless navigation between `#home-view` and `#studio-view`.

---

## 3. Caveats

1. **Browser Native Color Picker in Headless Mode**: Headless test runners (e.g. `node --test` in Node.js) lack a DOM `<input type="color">` popup picker. Tests must simulate programmatic input/change events (`inputEl.value = "#4285F4"; inputEl.dispatchEvent(new Event("change"))`).
2. **HCT / Color Space Library Scope**: If implementing the full Material 3 HCT / Monet algorithm, a pure TypeScript color math utility (converting Hex/RGB $\leftrightarrow$ Lab/HCT or HSL luminance tonal curves) will be required in `card-themes.ts` without requiring external heavy npm dependencies that could disrupt `npm test`.
3. **Existing Test Sensitivity**: Existing tests in `card-theming.test.mjs`, `card-theming-collision.test.mjs`, and `m3_challenger_theming.test.mjs` explicitly check that `CARD_THEME_IDS` contains the 5 original preset IDs (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`). Any new presets or dynamic themes must preserve or alias these 5 IDs to prevent regressions.

---

## 4. Conclusion

### 4.1 Required Architecture for Implementation

```
┌────────────────────────────────────────────────────────────────────────┐
│               ANDROID THEMING & SURFACE INTEGRATION PIPELINE           │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Engine (`src/card-themes.ts`):                                      │
│    - Preset Android Themes Catalog (Classic, Cyberpunk, Minimal,       │
│      Glass, Material Vibrant, Android Expressive, Android Forest, etc.)│
│    - Dynamic Tonal Palette Generator from Seed Color:                  │
│      `generateDynamicTheme(seedColor: string): CardThemeDefinition`    │
│      Produces M3 roles: surface, surfaceContainer, primary, onSurface, │
│      onSurfaceVariant, outline, secondaryContainer.                    │
│                                                                        │
│ 2. 2D Home View Integration (`src/style.css` & `index.html`):          │
│    - `.home-theme-bar`: Add seed color picker `<input type="color">`   │
│      and preset Android chips.                                         │
│    - `applyCardTheme`: Inject CSS custom properties on `#home-view`:   │
│      `--card-theme-bg`, `--card-theme-border`, `--card-theme-accent`,   │
│      `--card-theme-on-surface`, `--md-sys-color-*`.                    │
│    - Update `.home-system-card-featured` to consume theme accent.      │
│                                                                        │
│ 3. 3D Spatial Studio Cards (`src/main.ts`):                            │
│    - `makeCardTexture`: Consume theme `primary`, `onSurface`, and      │
│      `onSurfaceVariant` in `drawCardFront` and facet headers.          │
│    - `applyCardTheme`: Update PBR materials and scene lights           │
│      (`cardHaloLight`, `cardFloorGlow`) from dynamic tokens.           │
│    - Texture cache invalidation via unique content key.                │
│                                                                        │
│ 4. State Persistence & View Navigation:                                │
│    - `localStorage`: Persist preset ID or `seed:#hex`.                 │
│    - In-memory preservation across `showStudio()` and `showHome()`.    │
│                                                                        │
│ 5. Automated Verification (`tests/`):                                  │
│    - Dedicated test file (e.g. `android-theming-integration.test.mjs`) │
│      verifying all 4 dimensions while maintaining 117/117 baseline.    │
└────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Required New Test Cases Specification

The new test suite (e.g. `workspace-prototype/tests/android-theming-integration.test.mjs`) should contain:

1. **Test Group 1: Dynamic Seed Color Palette Generation**
   - *Test 1.1*: Generates valid tonal color roles (`surface`, `surfaceContainer`, `primary`, `onPrimary`, `onSurface`, `onSurfaceVariant`, `outline`) across diverse seed colors (e.g. `#4285F4`, `#00C853`, `#D81B60`, `#FF6D00`, `#6750A4`).
   - *Test 1.2*: Mathematical contrast ratio verification: ensures WCAG AA compliance ($\ge 4.5:1$) for `onSurface` over `surfaceContainer`, `onPrimary` over `primary`, and `buttonText` over `buttonFill`.
   - *Test 1.3*: Tonal luminance monotonicity: validates that tone levels progress correctly from deep background to bright text.
   - *Test 1.4*: Seed color sanitization and error recovery: handles invalid hex formats (e.g. `"#XYZ"`, `""`, `null`) with fallback to default theme without throwing unhandled exceptions.

2. **Test Group 2: Preset Android Theme Palettes**
   - *Test 2.1*: Verifies availability and completeness of preset Android themes alongside existing canonical presets.
   - *Test 2.2*: Verifies schema compliance: ensures all presets implement `canvas`, `material`, `lighting`, and `homeCss` token interfaces.
   - *Test 2.3*: Verifies backwards compatibility: `getCardTheme("classic")`, `getCardTheme("cyberpunk")`, etc. continue returning identical expected tokens.

3. **Test Group 3: 2D & 3D Surface Integration**
   - *Test 3.1*: 2D DOM Theme Application: verifies that applying a dynamic seed theme injects CSS custom properties (`--card-theme-bg`, `--card-theme-border`, `--card-theme-accent`) on `#home-view`.
   - *Test 3.2*: Featured card styling: verifies that `.home-system-card-featured` inherits theme accent/primary color.
   - *Test 3.3*: 3D Canvas Token Consumption: verifies that `makeCardTexture` and `drawCardFront` consume `theme.canvas.titleColor` / `onSurface` and `theme.canvas.detailColor` / `onSurfaceVariant` rather than hardcoded colors.
   - *Test 3.4*: 3D PBR Material & Spatial Light Synchronization: verifies that `applyCardTheme` updates `cardHaloLight.color`, `cardFloorGlow.color`, and mesh materials.
   - *Test 3.5*: GPU Texture Disposal & Cache Invalidation: verifies that changing to a dynamic theme updates `computeCardContentKey` and disposes prior textures.

4. **Test Group 4: State Persistence & View Navigation**
   - *Test 4.1*: `localStorage` Roundtrip for Seed Colors: verifies saving `seed:#4285F4` and rehydrating on startup.
   - *Test 4.2*: Navigation Preservation: verifies that navigating `showStudio()` $\rightarrow$ `showHome()` maintains active theme selection in DOM and memory.
   - *Test 4.3*: Corrupted Storage Resilience: verifies that corrupted, empty, or unexpected values in `localStorage` safely fall back to the default theme.
   - *Test 4.4*: Rapid View Switching Stress: simulates 50 rapid view switches (`home <-> studio`) verifying theme state stability and absence of memory leaks.

---

## 5. Verification Method

To independently reproduce and verify this investigation:

1. **Verify Baseline Tests**:
   ```bash
   cd G:\micro-host\workspace-prototype
   npm test
   ```
   *Expected Result*: 117 tests pass, 0 fail, duration ~9.8s.

2. **Verify Typecheck and Production Build**:
   ```bash
   cd G:\micro-host\workspace-prototype
   npx tsc --noEmit
   npm run build
   ```
   *Expected Result*: Both commands exit `0` cleanly.

3. **Inspect 2D Home View Cards**:
   Inspect `workspace-prototype/index.html` lines 85–112 and 114–179; inspect `workspace-prototype/src/style.css` lines 3062–3112 and 3224–3298.
   Verify hardcoded amber styling on `.home-system-card-featured` at lines 3099–3112.

4. **Inspect 3D Spatial Canvas Rendering**:
   Inspect `workspace-prototype/src/main.ts` lines 3193–3277 (`makeCardTexture`), 3438–3482 (`drawCardFront`), 3513–3537 (`drawCardButtons`), and 4577–4655 (`applyCardTheme`).
   Verify hardcoded colors at lines 3223–3230, 3450, 3454, 3466, 3470, 3774.

5. **Invalidation Conditions**:
   This report would be invalidated if:
   - `npm test` fails any of the 117 existing tests.
   - 2D cards are found not using `--card-theme-*` CSS custom properties.
   - 3D cards are rendered via DOM elements rather than Three.js canvas textures.
   - Navigation between `#home-view` and `#studio-view` reloads the page or unloads WebGL state.
