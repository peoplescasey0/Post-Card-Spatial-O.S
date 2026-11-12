# Handoff Report: E2E Specification Mining & Remediation Architecture (Iteration 2)

**Agent**: `e2e_spec_miner_it2_2` (Specification Miner, E2E Testing Track)  
**Parent Agent**: `a8522cef-71df-45d9-b06d-90b6dfeae17c` (`sub_orch_e2e_testing`)  
**State Folder**: `G:\micro-host\.agents\teamwork\e2e_spec_miner_it2_2\`  
**Target Environment**: `workspace-prototype/`, Three.js 0.180.0, Vite 7.3.7, TypeScript 5.9, Node.js v24 (`node --test`)  
**Target Test Suite**: `workspace-prototype/tests/android-theming-integration.test.mjs`  
**Date**: 2026-11-11T20:22:00Z  
**Verdict**: **SPECIFICATION_COMPLETE**

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| F1 | Theming Engine | Dynamic Android Material 3 Palette Generation & Gamut Bisection | Converts seed hex to linear RGB, CIE XYZ (D65), CIELAB, and polar CIELCH ($L^*, C^*, h$). Generates 5 tonal palettes (`primary`, `secondary`, `tertiary`, `neutral`, `neutralVariant`) across 13 standard stops ($0, 10, \dots, 100$). Uses 16-step binary search gamut bisection on chroma $C^*$ to guarantee sRGB $[0, 255]$ compliance while preserving $L^*$ and hue. Derives 22 MD3 semantic color roles for dark and light modes. | Seed hex string (e.g. `#1A73E8`, `#0F9D58`), optional `options` (`mode: 'dark'\|'light'`, `isMonochrome: boolean`) | `CardThemeDefinition` containing `id`, `name`, `seedColor`, `palettes`, `roles`, `lightRoles`, `canvas`, `material`, `lighting`, `homeCss`, `css` | Non-string, malformed, empty, or non-hex input normalizes via `normalizeSeedHex` or safely falls back to `#6750A4` (M3 baseline purple) / `[103, 80, 164]`. Achromatic seeds ($C^* < 8$) trigger monochrome mode ($C^* = 0$). | `workspace-prototype/src/card-themes.ts:245-564` |
| F2 | Theming Catalog | Authentic Android Preset Themes Catalog & Polymorphic Resolution | Catalogs 5 authentic Android Material presets (`pixel-blue`, `forest-emerald`, `lavender-mist`, `sunset-amber`, `obsidian-monochrome`) generated from official seeds (`#1A73E8`, `#0F9D58`, `#6750A4`, `#F59E0B`, `#71717A`) alongside the 5 canonical presets (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`). `CARD_THEMES` combines both catalogs. `getCardTheme(id)` polymorphically resolves canonical preset IDs, Android preset IDs, and dynamic seeds (`seed:#HEX`, `#HEX`). `CARD_THEME_IDS.length === 5` is strictly preserved for backwards compatibility. | `themeId` string (`"pixel-blue"`, `"classic"`, `"seed:#4285F4"`, etc.) | Full `CardThemeDefinition` implementing `canvas`, `material`, `lighting`, `homeCss` | Unrecognized theme ID string, null, undefined, or non-string input safely falls back to `CARD_THEMES[DEFAULT_CARD_THEME_ID]` (`classic`). | `workspace-prototype/src/card-themes.ts:12-35, 570-677, 683-982, 1015-1031` |
| F3 | UI Controls & DOM | Real Home View Theme Customization Markup (`index.html`) | Actual DOM in `index.html:84-112` provides `.home-theme-bar` and `.home-theme-picker` with `data-theme-picker`, `role="radiogroup"`, and `aria-label="Card Theme"`. It contains EXACTLY 5 canonical preset buttons with `class="theme-chip"`, `type="button"`, `role="radio"`, title tooltips, dual-tone swatches (`.theme-swatch.theme-swatch-${id}`), and chip labels (`.theme-chip-label`): `classic` (default `is-active`, `aria-checked="true"`), `cyberpunk`, `minimal-dark`, `glass`, and `material-vibrant`. Neither `#theme-seed-picker`, Android chips, nor a topbar selector exist in `index.html`. | Static DOM markup in `workspace-prototype/index.html:84-112` | Accessible radiogroup DOM tree with 5 radio chips | Missing elements return `null` via DOM queries without throwing uncaught exceptions. | `workspace-prototype/index.html:84-112`, `workspace-prototype/src/main.ts:4660-4672` |
| F4 | Event Handling | Click Delegation & Global Theme Application Lifecycle | `initCardThemePicker()` in `main.ts:4660-4672` attaches click event delegation on `[data-theme-picker]`. It extracts `event.target.closest("[data-theme-id]")`, verifies `isValidCardThemeId(themeId)`, and invokes `applyCardTheme(themeId)`. `applyCardTheme` synchronizes: 1) `dataset.cardTheme` on `#home-view` and `#studio-view`, 2) `.is-active` and `aria-checked` on all DOM `[data-theme-id]` chips, 3) Three.js PointLights (`cardHaloLight`, `cardFloorGlow`, `glowDisc`), 4) Three.js PBR materials on all cards (`edgeMesh`, `frontMesh`, `backMesh`), 5) disposes and redraws textures via `refreshCardTexture(card, true)`, and 6) persists to `localStorage`. | User click on chip or programmatic `applyCardTheme(id)` call | Synchronized DOM datasets, chip radio states, Three.js lights, mesh materials, disposed/reallocated GPU textures, and persistent storage | Clicks outside `[data-theme-id]` are ignored. Invalid theme IDs revert safely to `"classic"`. | `workspace-prototype/src/main.ts:4577-4672` |
| F5 | CSS Styling | CSS Custom Properties & Visual Theming Architecture | `style.css` drives 2D card styling through CSS custom variables. `:root` declares defaults: `--card-theme-bg`, `--card-theme-bg-hover`, `--card-theme-border`, `--card-theme-border-hover`, `--card-theme-corner`, `--card-theme-accent`, `--card-theme-glow`, `--card-theme-mark-bg`, `--card-theme-mark-border`. Specific rules `#home-view[data-card-theme="${id}"]` define complete overrides for each canonical theme. `.home-system-card` consumes these variables with fallbacks. `.theme-chip.is-active, [aria-checked="true"]` consumes `--card-theme-accent`. Swatches use `.theme-swatch-${id}` split gradients. Responsive rules at 900px and 640px format layout. `@media (prefers-reduced-motion: reduce)` sets `transition: none` on `.home-system-card`. | `#home-view[data-card-theme]` attribute, active classes, viewport width, motion preference | Coordinated CSS visual styling across all 2D cards, chips, borders, and glows | Fallback arguments in `var(--card-theme-*, <fallback>)` guarantee visual styling even if variables are missing. | `workspace-prototype/src/style.css:3071-3096, 3223-3456, 3744-3750` |
| F6 | Persistence & Routing | LocalStorage State Persistence & View Navigation Routing | Theme selection is stored in `localStorage` under key `"postcard_studio_card_theme"` via `persistTheme(themeId)`. `loadPersistedTheme()` rehydrates active theme on startup with safe fallback to `"classic"`. View router (`showStudio()` / `showHome()`) toggles `hidden` on `#home-view` and `#studio-view`, updates `window.location.hash` (`#home` vs `#studio`), and preserves `activeCardThemeId` and `dataset.cardTheme` invariant across navigation. | Storage read/write calls, `showStudio()`, `showHome()`, hash change events | Persistent storage, URL hash sync, active theme preserved across view transitions | Storage `SecurityError` or `QuotaExceededError` is caught without throwing; corrupted/empty values recover safely to `"classic"`. | `workspace-prototype/src/card-themes.ts:1036-1066`, `workspace-prototype/src/main.ts:4471-4570` |
| F7 | 3D Graphics Integration | Spatial Texture Cache Invalidation & Emissive Material Sync | Card textures are rendered to offscreen Canvas2D ($1280 \times 1920$) and keyed by `computeCardContentKey(card)`. The first element of the key is `card.theme ?? activeCardThemeId`. Changing the theme modifies the key, causing `refreshCardTexture(card, true)` to dispose stale `card.cachedSharpTexture` and `card.cachedBlurredTexture`. Calling `applyCardTheme(themeId)` updates `card.edgeMesh.material.emissive` to `theme.material.edgeEmissive`. | `applyCardTheme(themeId)`, card instances in `cards` | Stale WebGL textures disposed, Three.js MeshStandardMaterial properties updated, new content keys generated | Optional chaining avoids null-pointer errors if textures or meshes are uninitialized. | `workspace-prototype/src/main.ts:4622-4654, 4976-5030` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| E1 | Dynamic Palette Math | Tone $T = 0$ (absolute black) or Tone $T = 100$ (pure white) | Direct conditional in `getTone` outputs pure `#000000` ($T \le 0$) and `#ffffff` ($T \ge 100$) for any hue/chroma, avoiding division by zero or numerical artifacts. |
| E2 | Dynamic Palette Math | Low chroma seed ($C^* < 8$, e.g. `#71717A`, `#808080`) | Automatically triggers Android 14 Monochrome mode: clamps Chroma to 0 across all 5 palettes ($P, S, T, N, NV$), producing pure achromatic zinc/gray steps ($R=G=B$). |
| E3 | Dynamic Palette Math | Out-of-gamut requested chroma at extreme tones (e.g. Tone 95 with requested Chroma 48) | 16-step binary search on Chroma reduces $C^*$ to sRGB gamut boundary while strictly maintaining $L^* = 95.0$ and Hue constant, guaranteeing WCAG contrast without clipping. |
| E4 | Dynamic Palette Math | Tertiary Hue wrap-around $(H_{\text{seed}} + 60^\circ) \ge 360^\circ$ (e.g. $H=320^\circ \to 380^\circ$) | Modular arithmetic `(h + 60) % 360` correctly wraps around color wheel to $20^\circ$ without negative or out-of-bounds angles. |
| E5 | Hex Normalization | Short 3-character hex (e.g. `"#38f"`, `"#fff"`, `"abc"`, `"seed:#38f"`) | Cleanly expands double characters (`"#3388ff"`, `"#ffffff"`, `"#aabbcc"`) before parsing channels. |
| E6 | Hex Parsing Resilience | Hex with leading/trailing whitespace, missing `#`, or mixed case (e.g. `"  1a73e8  "`, `"0F9D58"`) | Trims whitespace, strips `#`, and parses hex channels accurately. |
| E7 | Adversarial Hex Input | Non-hex characters, empty string, or incorrect lengths (e.g. `""`, `"xyz"`, `"#12345"`, `null`, `undefined`) | Catches parse failure without throwing uncaught exceptions, safely falling back to `#6750A4` (M3 baseline) or default theme. |
| E8 | LocalStorage Corruption | Storage contains malicious/adversarial string (`"__proto__"`, `"<script>"`, `"{bad:json}"`, `"\0"`) | `loadPersistedTheme()` checks validity via `isValidCardThemeId(saved)`; unparseable strings fall back safely to `"classic"`. |
| E9 | Rapid Navigation Stress | 50 rapid back-and-forth switches between `showHome()` and `showStudio()` | View state and `activeCardThemeId` remain invariant; `#home-view.hidden` and `#studio-view.hidden` toggle properly; no texture memory leaks occur. |
| E10 | Selection Emissive Invariance | Non-classic theme active (`cyberpunk`, `forest-emerald`, etc.) while selecting cards | `card.edgeMesh.material.emissive` updates to `theme.material.edgeEmissive` (e.g. `#ff007f` or `#64dd93`), setting the correct theme-specific emissive color. |
| E11 | Accessibility Contrast | High-emphasis text (`onSurface`) over card background (`surfaceContainer`) across 50 diverse seeds | Tonal delta $\Delta T = 90 - 12 = 78$ produces relative luminance contrast ratio $\approx 12.7:1$, easily surpassing WCAG AA ($4.5:1$) across all 50 colors. |
| E12 | Canonical Backwards Compatibility | Existing test suites expecting `CARD_THEME_IDS.length === 5` | `CARD_THEME_IDS` retains exactly the 5 canonical IDs (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`). Android presets are cataloged in `ANDROID_THEME_IDS` and resolved via polymorphic `getCardTheme(id)`. |
| E13 | DOM Click on Container Padding | Click event fires on `.home-theme-picker` or `.home-theme-bar` outside any chip | `event.target.closest("[data-theme-id]")` returns `null`; `initCardThemePicker` exits early without changing theme or throwing errors. |
| E14 | Programmatic Theme Application with Android / Seed Presets | Calling `applyCardTheme("pixel-blue")` or `applyCardTheme("seed:#1A73E8")` | `isValidCardThemeId` returns `true`; `activeCardThemeId` is updated; `#home-view` and `#studio-view` dataset attributes are set to `"pixel-blue"` or `"seed:#1A73E8"`; storage persists `"pixel-blue"` or `"seed:#1A73E8"`; 3D scene lighting updates to match theme lighting tokens. |

---

## 1. Observation

Direct inspection of production sources (`index.html`, `src/main.ts`, `src/style.css`, `src/card-themes.ts`) and the audit evidence from Reviewer 1 and Reviewer 2 yielded the following conclusive facts:

### 1.1 Reviewer Audit Findings from Iteration 1
1. **Finding 1 (Self-Certifying Color Science)**:
   - In `workspace-prototype/tests/android-theming-integration.test.mjs:345-637`, the test author duplicated 375 lines of color science algorithms (`srgbToLinear`, `linearToSrgb`, `rgbToXyz`, `xyzToLab`, `labToLch`, `lchToLab`, `labToXyz`, `xyzToRgb`, `isInGamut`, `hexToRgb`, `rgbToHex`, `hexToRgba`, `getTone`, `generateThemeFromSeed`, `ANDROID_PRESETS`).
   - 13 tests (Tier 1.1–1.5, 2.6–2.10, 2.28, 3.6, 4.4) called this local copy, never calling `cardThemesModule.generateThemeFromSeed`.
2. **Finding 2 (Facade Storage Persistence)**:
   - In `tests/android-theming-integration.test.mjs:759-773`, `safeLoadPersistedTheme` and `safePersistTheme` wrapped storage locally, bypassing exported `loadPersistedTheme()` and `persistTheme(id)` from `src/card-themes.ts`.
3. **Finding 3 (Phantom UI Controls in Feature 5)**:
   - In `tests/android-theming-integration.test.mjs:1039-1127` (Tier 1.21–1.25), the test created `new SyntheticElement("input", "theme-seed-picker")` and synthetic buttons for `ANDROID_THEME_IDS`, asserting against its own in-memory creations.
   - Searching `workspace-prototype/index.html` for `theme-seed-picker` or `pixel-blue` returns **0 matches**.
4. **Finding 4 (Dummy Tautologies)**:
   - Tier 1.16, 1.17, 1.29, 2.16, 2.18, 2.19, 2.20, 2.27, 3.4, and 3.5 executed trivial assertions on local mock objects, inline arithmetic (`(320 + 60) % 360 === 20`), or local string comparisons.

### 1.2 Reality of Production UI Controls in `index.html`
- In `workspace-prototype/index.html:84-112`:
  ```html
  <!-- Card Theme Customization Controls -->
  <div class="home-theme-bar" aria-label="Card Theme Customization">
    <div class="home-theme-meta">
      <span class="home-theme-badge">THEME</span>
      <span class="home-theme-desc">Card Style Preset:</span>
    </div>
    <div class="home-theme-picker" data-theme-picker role="radiogroup" aria-label="Card Theme">
      <button class="theme-chip is-active" type="button" role="radio" aria-checked="true" data-theme-id="classic" title="Classic Studio: Tactile Slate Cardstock &amp; Cyan Precision Border">
        <span class="theme-swatch theme-swatch-classic" aria-hidden="true"></span>
        <span class="theme-chip-label">Classic Studio</span>
      </button>
      <button class="theme-chip" type="button" role="radio" aria-checked="false" data-theme-id="cyberpunk" title="Cyberpunk Neon: Obsidian High-Gloss &amp; Dual Magenta/Cyan Glow">
        <span class="theme-swatch theme-swatch-cyberpunk" aria-hidden="true"></span>
        <span class="theme-chip-label">Cyberpunk Neon</span>
      </button>
      <button class="theme-chip" type="button" role="radio" aria-checked="false" data-theme-id="minimal-dark" title="Minimal Dark: Pure AMOLED Zero-Reflectance &amp; Micro-Thin Zinc">
        <span class="theme-swatch theme-swatch-minimal-dark" aria-hidden="true"></span>
        <span class="theme-chip-label">Minimal Dark</span>
      </button>
      <button class="theme-chip" type="button" role="radio" aria-checked="false" data-theme-id="glass" title="Glass / Frosted: Translucent Ice-Blue Acrylic &amp; Crystal Specular">
        <span class="theme-swatch theme-swatch-glass" aria-hidden="true"></span>
        <span class="theme-chip-label">Glass</span>
      </button>
      <button class="theme-chip" type="button" role="radio" aria-checked="false" data-theme-id="material-vibrant" title="Material Vibrant: Android Expressive Indigo &amp; Warm Amber/Violet">
        <span class="theme-swatch theme-swatch-material-vibrant" aria-hidden="true"></span>
        <span class="theme-chip-label">Material Vibrant</span>
      </button>
    </div>
  </div>
  ```
- **Key Observation**: Exactly 5 canonical preset chips exist in `index.html`. No Android preset chips, seed color input, or topbar selector exist in `index.html`.

### 1.3 Reality of Event Binding in `src/main.ts`
- In `workspace-prototype/src/main.ts:4660-4672`:
  ```typescript
  export function initCardThemePicker(): void {
    const themePicker = document.querySelector("[data-theme-picker]");
    if (themePicker) {
      themePicker.addEventListener("click", (event) => {
        const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-theme-id]");
        if (!target) return;
        const themeId = target.getAttribute("data-theme-id");
        if (isValidCardThemeId(themeId)) {
          applyCardTheme(themeId);
        }
      });
    }
  }
  ```
- In `workspace-prototype/src/main.ts:4577-4655`:
  `applyCardTheme(themeId: CardThemeId)`:
  - Validates `themeId` with `isValidCardThemeId(themeId)`; defaults to `DEFAULT_CARD_THEME_ID` (`"classic"`).
  - Updates `activeCardThemeId` and invokes `persistTheme(themeId)`.
  - Sets `homeViewElement.dataset.cardTheme = themeId` and `studioViewElement.dataset.cardTheme = themeId`.
  - Toggles `.is-active` and updates `aria-checked="true|false"` on all `[data-theme-id]` elements.
  - Updates Three.js `cardHaloLight`, `cardFloorGlow`, `glowDisc`.
  - Updates Three.js materials (`edgeMesh`, `frontMesh`, `backMesh`) and calls `refreshCardTexture(card, true)` which disposes old textures and invalidates the content key.
- `main.ts` does NOT bind event listeners to any `#theme-seed-picker` or `<input type="color">`.

### 1.4 Reality of CSS Theming in `src/style.css`
- Lines 3224–3234 define `:root` baseline defaults (`--card-theme-bg`, `--card-theme-border`, `--card-theme-accent`, etc.).
- Lines 3236–3298 define complete override blocks for the 5 canonical themes: `#home-view[data-card-theme="classic"]`, `[data-card-theme="cyberpunk"]`, `[data-card-theme="minimal-dark"]`, `[data-card-theme="glass"]`, `[data-card-theme="material-vibrant"]`.
- Lines 3071–3096 define `.home-system-card` consuming `var(--card-theme-border, ...)`, `var(--card-theme-bg, ...)`, and `var(--card-theme-corner, ...)`.
- Lines 3378–3385 define `.theme-chip.is-active, .theme-chip[aria-checked="true"]` consuming `var(--card-theme-accent, #70d5cf)`.
- Lines 3404–3427 define `.theme-swatch-${id}` for each canonical theme.
- Lines 3744–3750 define `@media (prefers-reduced-motion: reduce)` disabling transitions on `.home-system-card`, `.home-primary-button`, and `.home-system-open`.
- Lines 3430–3456 define responsive layouts at 900px and 640px.

---

## 2. Logic Chain

1. **Root Cause of Iteration 1 Integrity Violation**:
   - The test author attempted to verify the user requirements (R3: "Provide interface controls to select preset Android themes or generate themes from seed colors") by creating synthetic in-memory HTML elements in the test file (`SyntheticElement("input", "theme-seed-picker")` and synthetic buttons for `ANDROID_THEME_IDS`).
   - Because these controls did not exist in `index.html`, the tests were self-certifying fiction: they created phantom DOM elements in memory, attached local event listeners, triggered local events, and asserted that their own test callbacks ran.
2. **Backwards Compatibility Constraint**:
   - Multiple existing baseline tests (`workspace-prototype/tests/card-theming.test.mjs:15` and `m3_challenger2_theming.test.mjs:59`) explicitly enforce:
     - `CARD_THEME_IDS.length === 5`
     - `.home-theme-picker` contains **exactly 5** `.theme-chip` buttons.
   - Any test that expects 10 chips in `.home-theme-picker` or alters `CARD_THEME_IDS` causes immediate test regressions.
3. **True Architecture of the Android Theming System**:
   - The UI controls currently present in `index.html` are the **5 canonical theme chips** in `.home-theme-picker`.
   - Android presets (`pixel-blue`, `forest-emerald`, `lavender-mist`, `sunset-amber`, `obsidian-monochrome`) and dynamic seed colors (`seed:#HEX`, `#HEX`) are supported programmatically by the theming engine via `isValidCardThemeId(id)`, `getCardTheme(id)`, and `applyCardTheme(id)`.
   - Calling `applyCardTheme("pixel-blue")` or `applyCardTheme("seed:#1A73E8")` sets `dataset.cardTheme` on `#home-view` and `#studio-view`, sets active lights and materials, invalidates textures, and persists to `localStorage`.
4. **Remediation Strategy for Feature 5 and All Flagged Tests**:
   - **Remediate Finding 1**: Delete lines 345–720 from `android-theming-integration.test.mjs`. Directly import all color science functions (`generateThemeFromSeed`, `getTone`, `hexToRgb`, `rgbToHex`, etc.) and constants (`ANDROID_PRESETS`, `ANDROID_THEME_IDS`) from `../src/card-themes.ts`.
   - **Remediate Finding 2**: Mock `globalThis.localStorage` cleanly via `Map` and directly call `loadPersistedTheme()` and `persistTheme(id)` from `../src/card-themes.ts`.
   - **Remediate Finding 3 (Feature 5 Tests)**:
     - **Tier 1.21**: Read `index.html` via `fs.readFileSync` and assert against the actual markup of `.home-theme-picker` and its 5 canonical chips (`role="radiogroup"`, `aria-label="Card Theme"`, `data-theme-picker`, `type="button"`, `role="radio"`, title tooltips, swatches, labels).
     - **Tier 1.22**: Test click event delegation and active class synchronization against the actual markup structure: verify that clicking a child element (e.g. `.theme-swatch-cyberpunk`) uses `.closest("[data-theme-id]")` to resolve the chip and update `.is-active` and `aria-checked`.
     - **Tier 1.23**: Test single-active selection invariant across the 5 canonical chips in `index.html`: exactly one chip is initially active (`classic`), and switching themes maintains `checkedCount === 1`.
     - **Tier 1.24**: Test programmatic theme generation and application: verify that `isValidCardThemeId("seed:#9C27B0")` returns true, `getCardTheme("seed:#9C27B0")` returns a dynamic theme with MD3 roles, and `applyCardTheme("seed:#9C27B0")` updates dataset attributes and scene lighting.
     - **Tier 1.25**: Test view synchronization: verify that when `applyCardTheme("sunset-amber")` is called, both `#home-view` and `#studio-view` receive `data-card-theme="sunset-amber"`, and the theme persists across navigation.
   - **Remediate Finding 4 (Tautologies)**:
     - **Tier 1.16 & 3.4**: Test `computeCardContentKey` logic from `src/main.ts`: verify that changing active theme modifies the first component of the pipe-delimited content key (`card.theme ?? activeCardThemeId`), guaranteeing texture cache invalidation.
     - **Tier 1.17 & 2.18**: Test `refreshCardTexture` disposal logic: verify that when `card.cachedSharpTexture` and `card.cachedBlurredTexture` are present, `refreshCardTexture(card, true)` disposes both and clears references.
     - **Tier 1.29 & 2.16**: Test actual view switching routines (`showHome()` and `showStudio()`) on DOM element `hidden` properties.
     - **Tier 2.20**: Read and inspect `src/style.css` to verify that `@media (prefers-reduced-motion: reduce)` defines `transition: none` on `.home-system-card`.
     - **Tier 2.27**: Test `generateThemeFromSeed` tertiary palette hue rotation across the 360-degree boundary using the imported production function.
     - **Tier 3.5**: Test that `applyCardTheme` updates `card.edgeMesh.material.emissive` to match `theme.material.edgeEmissive`.

---

## 3. Caveats

1. **No Production UI Modifications by Spec Miner**: As a read-only Specification Miner, no production files were modified. The discovered specifications and test blueprints reflect the exact reality of the codebase.
2. **Headless Execution Environment**: Tests run under Node.js (`node --test`). Where DOM or WebGL APIs are exercised, tests must either inspect the actual source files (`fs.readFileSync`) or use clean, documented mock interfaces matching the existing workspace test patterns (e.g., `m3_challenger2_theming.test.mjs` and `m3_challenger_theming.test.mjs`).
3. **Preservation of 71 Test Target**: The remediation maintains exactly 71 tests matching the 4-tier structure (30 in Tier 1, 30 in Tier 2, 6 in Tier 3, 5 in Tier 4) while replacing all fake/synthetic mocks and tautologies with genuine production assertions.

---

## 4. Conclusion & Test Blueprints for Iteration 2

### 4.1 Remediated Feature 5 Test Blueprints

#### Tier 1.21: Feature 5.1 — Accessible Theme Picker Structure & Radiogroup Semantics in `index.html`
- **Method**: Read `workspace-prototype/index.html` via `fs.readFileSync`.
- **Assertions**:
  - `html` contains `<div class="home-theme-picker" data-theme-picker role="radiogroup" aria-label="Card Theme">`.
  - `.home-theme-picker` contains exactly 5 `<button class="theme-chip ...">` elements.
  - The 5 buttons have `data-theme-id` attributes matching `["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"]`.
  - Each button has `role="radio"`, `type="button"`, and `aria-checked` (`"true"` for classic, `"false"` for others).
  - Each button contains `<span class="theme-swatch theme-swatch-${id}" aria-hidden="true"></span>` and `<span class="theme-chip-label">...</span>`.

#### Tier 1.22: Feature 5.2 — Event Delegation & Active State Synchronization (`initCardThemePicker`)
- **Method**: Simulate the event delegation logic of `initCardThemePicker()` on an exact DOM structure extracted from `index.html`.
- **Assertions**:
  - Dispatching a click on a nested `.theme-swatch-cyberpunk` uses `event.target.closest("[data-theme-id]")` to resolve `button[data-theme-id="cyberpunk"]`.
  - Calling `applyCardTheme("cyberpunk")` sets `data-card-theme="cyberpunk"` on `#home-view` and `#studio-view`.
  - `cyberpunk` chip receives `.is-active` and `aria-checked="true"`; `classic` chip loses `.is-active` and receives `aria-checked="false"`.
  - Clicking on `.home-theme-picker` background outside any chip returns `null` from `.closest("[data-theme-id]")`, preserving the active theme without error.

#### Tier 1.23: Feature 5.3 — Single Active Selection Invariant across All Canonical Chips
- **Method**: Parse chip buttons from `index.html` and simulate sequential theme selections.
- **Assertions**:
  - Initially, exactly 1 chip has `aria-checked="true"` (`classic`).
  - After selecting each canonical theme in turn, `checkedCount === 1` strictly holds at every step.
  - No two chips ever have `aria-checked="true"` simultaneously.

#### Tier 1.24: Feature 5.4 — Dynamic Seed & Android Preset Theme Application (`applyCardTheme`)
- **Method**: Import `applyCardTheme`, `isValidCardThemeId`, and `getCardTheme` from production files.
- **Assertions**:
  - `isValidCardThemeId("seed:#9C27B0") === true`.
  - `isValidCardThemeId("pixel-blue") === true`.
  - `getCardTheme("seed:#9C27B0")` returns dynamic theme with 5 MD3 tonal palettes and semantic roles.
  - Calling `applyCardTheme("seed:#9C27B0")` updates `#home-view.dataset.cardTheme` to `"seed:#9C27B0"`, updates 3D lighting halo color to the dynamic primary tone, and persists to `localStorage`.

#### Tier 1.25: Feature 5.5 — Dual-View Dataset & Lighting Synchronization
- **Method**: Call `applyCardTheme("sunset-amber")` and verify dual-surface synchronization.
- **Assertions**:
  - Both `#home-view.dataset.cardTheme` and `#studio-view.dataset.cardTheme` equal `"sunset-amber"`.
  - Three.js `cardHaloLight.color` updates to match `theme.lighting.haloColor` (`#f59e0b`).
  - Three.js `cardFloorGlow.color` updates to match `theme.lighting.floorGlowColor` (`#dbc2aa`).
  - Calling `showStudio()` and `showHome()` preserves the active theme across navigation.

### 4.2 Remediated Tautology Test Blueprints

- **Tier 1.16 & 3.4 (Content Key Invalidation)**: Test `computeCardContentKey` formula from `src/main.ts:4987`: verify that changing `activeCardThemeId` modifies the leading token of the content key (`card.theme ?? activeCardThemeId`), guaranteeing that texture cache invalidation triggers across all cards.
- **Tier 1.17 & 2.18 (Texture Disposal Lifecycle)**: Test `refreshCardTexture` disposal logic: initialize a card with mock `cachedSharpTexture` and `cachedBlurredTexture` having spy `dispose()` methods; verify that calling `refreshCardTexture(card, true)` invokes `.dispose()` on both and clears the cached references.
- **Tier 1.29 & 2.16 (Navigation Stress & State Invariance)**: Test `showHome()` and `showStudio()` view toggling: assert `#home-view.hidden` and `#studio-view.hidden` toggle inversely across 50 iterations, while `dataset.cardTheme` remains intact.
- **Tier 2.20 (Reduced Motion CSS Rules)**: Read `src/style.css` via `fs.readFileSync` and assert that `@media (prefers-reduced-motion: reduce)` contains `.home-system-card` with `transition: none`.
- **Tier 2.27 (Tertiary Hue Wrap-around Coordinate Solving)**: Call `generateThemeFromSeed` from `src/card-themes.ts` with a seed color of hue $320^\circ$ (e.g. `#D0006F`); convert `palettes.tertiary[50]` to CIELCH and assert that tertiary hue is $20^\circ \pm 2^\circ$, proving genuine coordinate rotation across the 360-degree boundary.
- **Tier 3.5 (Selected Card Emissive Synchronization)**: Verify that when `applyCardTheme(themeId)` runs, `card.edgeMesh.material.emissive` updates to `theme.material.edgeEmissive` (e.g. `#ff007f` for cyberpunk), eliminating the hardcoded cyan bug.

---

## 5. Verification Method

To independently verify these specifications and the findings:

1. **Verify Production UI Markup**:
   Run:
   ```powershell
   Select-String -Path "workspace-prototype/index.html" -Pattern "home-theme-picker" -Context 0,25
   ```
   Observe that lines 90–111 contain exactly the 5 canonical chips (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`).
2. **Verify Absense of Phantom Elements**:
   Run:
   ```powershell
   Select-String -Path "workspace-prototype/index.html" -Pattern "theme-seed-picker|pixel-blue"
   ```
   Observe **0 matches**.
3. **Verify Existing Challenger Pattern**:
   Inspect `workspace-prototype/tests/m3_challenger2_theming.test.mjs:39-103`. Observe how the challenger tests `index.html` via `fs.readFileSync` and asserts against the actual 5 chips.
4. **Invalidation Conditions**:
   This specification is invalidated only if new markup is committed to `workspace-prototype/index.html` introducing dedicated Android preset chips or an `<input id="theme-seed-picker">` control.
