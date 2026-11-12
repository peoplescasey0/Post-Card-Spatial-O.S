# Handoff Report: 2D Surface Integration Analysis (`main.ts`, `style.css`, and Tests)

**State Folder**: `G:\micro-host\.agents\teamwork\explorer_m2_2d\`  
**Milestone**: Milestone 2: 2D & 3D Surface Integration  
**Role**: 2D Surface Explorer  
**Date / Timestamp**: 2026-11-11T20:33:00Z  
**Integrity Mode**: development  

---

## 1. Observation

### 1.1 `workspace-prototype/src/main.ts`: `applyCardTheme(themeId)`
- **File Location**: `G:\micro-host\workspace-prototype\src\main.ts`, lines 4577–4608.
- **Current Verbatim Implementation**:
  ```typescript
  export function applyCardTheme(themeId: CardThemeId): void {
    if (!isValidCardThemeId(themeId)) {
      themeId = DEFAULT_CARD_THEME_ID;
    }
    activeCardThemeId = themeId;
    persistTheme(themeId);

    // 1. Synchronize dataset attributes on #home-view and #studio-view
    if (homeViewElement) {
      homeViewElement.dataset.cardTheme = themeId;
    } else {
      const homeEl = document.getElementById("home-view");
      if (homeEl) homeEl.dataset.cardTheme = themeId;
    }

    if (studioViewElement) {
      studioViewElement.dataset.cardTheme = themeId;
    } else {
      const studioEl = document.getElementById("studio-view");
      if (studioEl) studioEl.dataset.cardTheme = themeId;
    }

    // 2. Synchronize theme chips in DOM
    const themeChips = document.querySelectorAll<HTMLButtonElement>("[data-theme-id]");
    themeChips.forEach((chip) => {
      const isSelected = chip.getAttribute("data-theme-id") === themeId;
      chip.classList.toggle("is-active", isSelected);
      chip.setAttribute("aria-checked", isSelected ? "true" : "false");
    });

    const theme = getCardTheme(themeId);

    // 3. Synchronize spatial scene lighting
    if (cardHaloLight) {
  ```
- **Observed Deficiency**:
  - `homeViewElement.dataset.cardTheme = themeId` is currently set, but `homeViewElement.style.setProperty(...)` is never called.
  - `const theme = getCardTheme(themeId);` is only evaluated at line 4607, *after* step 1.
  - While pre-compiled CSS attribute selectors exist in `src/style.css` for the 5 canonical themes (`#home-view[data-card-theme="classic|cyberpunk|minimal-dark|glass|material-vibrant"]`), **no attribute selectors exist for the 5 Android presets** (`pixel-blue`, `forest-emerald`, `lavender-mist`, `sunset-amber`, `obsidian-monochrome`) **nor for dynamic seed themes** (`seed:#HEX`).
  - Without inline CSS custom property injection onto `homeViewElement.style`, selecting an Android preset or generating a dynamic seed theme fails to style 2D cards on `#home-view`, causing them to fall back to the default `:root` "classic" variables.

### 1.2 `workspace-prototype/src/style.css`: `.home-system-card-featured` and Card Rules
- **File Location**: `G:\micro-host\workspace-prototype\src\style.css`, lines 3062–3113.
- **Current Verbatim Implementation**:
  ```css
  .home-system-card {
    position: relative;
    display: flex;
    min-width: 0;
    min-height: 154px;
    flex-direction: column;
    align-items: stretch;
    padding: 13px 15px 12px;
    overflow: hidden;
    border: 1px solid var(--card-theme-border, rgba(138, 144, 158, 0.22));
    border-radius: 2px;
    background: var(--card-theme-bg, linear-gradient(135deg, rgba(255, 255, 255, 0.025), transparent 55%), rgba(13, 17, 26, 0.88));
    color: var(--studio-text-main);
    cursor: pointer;
    text-align: left;
    transition: border-color 200ms ease, background 200ms ease, box-shadow 200ms ease, transform 150ms ease;
  }

  .home-system-card::after {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 25px;
    height: 25px;
    border-top: 1px solid var(--card-theme-corner, rgba(138, 144, 158, 0.28));
    border-right: 1px solid var(--card-theme-corner, rgba(138, 144, 158, 0.28));
    content: "";
    transition: border-color 200ms ease;
  }

  .home-system-card:hover {
    transform: translateY(-2px);
    border-color: var(--card-theme-border-hover, rgba(195, 200, 209, 0.48));
    background: var(--card-theme-bg-hover, #14161b);
    box-shadow: var(--card-theme-glow, none);
  }

  .home-system-card-featured {
    border-color: rgba(255, 184, 28, 0.36);
    background:
      linear-gradient(110deg, rgba(255, 184, 28, 0.055), transparent 58%),
      rgba(13, 17, 26, 0.94);
  }

  .home-system-card-featured::after {
    border-color: rgba(255, 184, 28, 0.55);
  }

  .home-system-card-featured:hover {
    border-color: rgba(255, 184, 28, 0.72);
  }
  ```
- **Observed Deficiency**:
  - In `src/main.ts` line 4507 (`showHome()`), whichever card was active in the 3D studio view dynamically receives `cardEl.classList.toggle("home-system-card-featured", isSelected);`.
  - In `style.css`:
    1. `.home-system-card-featured` hardcodes `border-color: rgba(255, 184, 28, 0.36);` and `background: linear-gradient(110deg, rgba(255, 184, 28, 0.055), transparent 58%), rgba(13, 17, 26, 0.94);`. This completely overrides `var(--card-theme-border)` and `var(--card-theme-bg)` with fixed amber/charcoal colors.
    2. `.home-system-card-featured::after` hardcodes `border-color: rgba(255, 184, 28, 0.55);`, overriding `var(--card-theme-corner)`.
    3. `.home-system-card-featured:hover` hardcodes `border-color: rgba(255, 184, 28, 0.72);`, ignoring `var(--card-theme-border-hover)` and `var(--card-theme-accent)`.
  - As a result, switching themes to "Pixel Blue", "Forest Emerald", "Cyberpunk", or any custom seed color leaves the featured card stuck in amber, breaking visual coherence.

### 1.3 `workspace-prototype/tests/`: Comprehensive Survey of Existing Assertions on `#home-view`
Across all 20 test files in `workspace-prototype/tests/`, the following tests specifically touch `#home-view` dataset and style:
1. `tests/android-theming-integration.test.mjs`:
   - Line 919: `test("Tier 1.11: Feature 3.1 — Dataset Attribute Synchronization (data-card-theme)")`:
     Asserts `homeEl.dataset.cardTheme === theme.id` and `studioEl.dataset.cardTheme === theme.id`.
   - Line 931: `test("Tier 1.12: Feature 3.2 — CSS Custom Property Injection on #home-view.style")`:
     Asserts injection of:
     `--card-theme-bg`: `theme.homeCss.cardBg`
     `--card-theme-border`: `theme.homeCss.cardBorder`
     `--card-theme-accent`: `theme.homeCss.cardAccent`
     `--card-theme-glow`: `theme.homeCss.cardGlow`
     `--card-theme-on-surface`: `theme.canvas.titleColor`
     `--card-theme-on-surface-variant`: `theme.canvas.detailColor`
   - Line 947: `test("Tier 1.13: Feature 3.3 — Dynamic Seed CSS Property Injection (seed:#HEX)")`:
     Asserts `homeEl.dataset.cardTheme === "seed:#E91E63"` and `homeEl.style.getPropertyValue("--card-theme-accent") === dynTheme.homeCss.cardAccent`.
   - Line 958: `test("Tier 1.14: Feature 3.4 — Featured Card CSS Style Rule Consumption")`:
     Asserts `style.css` contains `.home-system-card` and consumes `--card-theme-bg` or `--card-theme-border`.
   - Line 966: `test("Tier 1.15: Feature 3.5 — Repeated Theme Switching Style Cleanliness")`:
     Asserts clean updates across sequential themes (`cyberpunk`, `pixel-blue`, `glass`) on `homeEl.style`.
   - Line 1170: `test("Tier 1.30: Feature 6.5 — Dynamic Seed Navigation Preservation across View Transitions")`:
     Asserts `homeEl.dataset.cardTheme` and `homeEl.style` custom properties remain intact across `homeEl.hidden = true` / `false`.
2. `tests/m3_challenger2_theming.test.mjs`:
   - Lines 185–233: Verifies `.home-system-card`, `::after`, `:hover`, and `:hover .home-system-open` consume `--card-theme-border`, `--card-theme-bg`, `--card-theme-corner`, `--card-theme-border-hover`, `--card-theme-bg-hover`, `--card-theme-glow`, and `--card-theme-accent`.
   - Lines 327–427: Simulates user chip clicks updating `homeView.dataset.cardTheme` across all 5 canonical themes.
3. `tests/m3_challenger_theming.test.mjs`:
   - Lines 369–398 (`CHALLENGE 5: DOM & CSS Spec Integrity for All 5 Themes`):
     Asserts that `style.css` contains `#home-view[data-card-theme="${id}"]` selectors for all 5 canonical themes.
4. `tests/card-theming.test.mjs`:
   - Lines 143–164: Asserts that `style.css` defines `#home-view[data-card-theme="${id}"]` and sets `--card-theme-bg`, `--card-theme-border`, `--card-theme-accent`, and `--card-theme-corner`.
5. `tests/card-theming-collision.test.mjs`:
   - Lines 749–770: Asserts that `style.css` preserves `#home-view[hidden] { display: none !important; }`.
   - *Collateral observation*: Line 546 fails (`AssertionError: PROJECT.md must document Fedora IP 10.0.0.2` and `Node.js v26|Firefox`). This is an existing assertion in `card-theming-collision.test.mjs` that checks for Fedora infrastructure documentation in `PROJECT.md`.
6. `tests/adversarial-interaction-router.test.mjs`:
   - Lines 480–496: Asserts that `style.css` contains `#home-view[hidden] { display: none !important; }`.

---

## 2. Logic Chain

1. **Inline CSS Custom Property Injection vs. CSS Attribute Selectors**:
   - *Premise*: `style.css` has `#home-view[data-card-theme="[id]"]` rules for canonical themes (`classic`, `cyberpunk`, etc.), but does NOT have rules for Android presets (`pixel-blue`, `forest-emerald`, etc.) or dynamic seed colors (`seed:#4285F4`).
   - *Inference*: When `themeId` is an Android preset or dynamic seed, setting `homeViewElement.dataset.cardTheme = themeId` alone does not apply new styles. Injecting custom properties directly onto `homeViewElement.style` via `.setProperty()` ensures every theme (canonical, Android preset, and dynamic seed) is styled immediately and consistently.
   - *Inference*: Inline styles on `homeViewElement.style` have higher specificity than attribute selectors, cascades cleanly to all `.home-system-card` elements, and guarantees instantaneous visual reactivity.

2. **Required Custom Properties and Fallback Hierarchy**:
   - *Premise*: `theme.homeCss` contains `cardBg`, `cardBorder`, `cardAccent`, `cardGlow`. `theme.canvas` contains `borderStroke`, `titleColor`, `detailColor`.
   - *Inference*:
     - `--card-theme-bg`: `theme.homeCss?.cardBg ?? theme.homeCss?.["--card-theme-bg"] ?? "linear-gradient(135deg, rgba(20, 22, 27, 0.95), rgba(13, 17, 26, 0.90))"`
     - `--card-theme-border`: `theme.homeCss?.cardBorder ?? theme.homeCss?.["--card-theme-border"] ?? "rgba(112, 213, 207, 0.32)"`
     - `--card-theme-accent`: `theme.homeCss?.cardAccent ?? theme.homeCss?.["--card-theme-accent"] ?? theme.swatchPrimary ?? "#70d5cf"`
     - `--card-theme-glow`: `theme.homeCss?.cardGlow ?? theme.homeCss?.["--card-theme-glow"] ?? "0 8px 28px rgba(112, 213, 207, 0.14)"`
     - `--card-theme-corner`: `theme.canvas?.borderStroke ?? theme.homeCss?.["--card-theme-corner"] ?? "rgba(112, 213, 207, 0.48)"`
     - `--card-theme-on-surface`: `theme.canvas?.titleColor ?? theme.homeCss?.["--card-theme-on-surface"] ?? "#f4f5f7"`
     - `--card-theme-on-surface-variant`: `theme.canvas?.detailColor ?? theme.homeCss?.["--card-theme-on-surface-variant"] ?? "#c3c8d1"`
   - *Inference*: Nullish coalescing (`??`) guarantees that even if an arbitrary or partially formed theme object is passed, no invalid or empty values are injected, preventing CSS rendering anomalies.

3. **Refactoring `.home-system-card-featured`**:
   - *Premise*: In `style.css`, `.home-system-card-featured` hardcodes amber `rgba(255, 184, 28, ...)` on `border-color`, `background`, and pseudo-classes.
   - *Inference*:
     - In `.home-system-card-featured`, replacing `border-color: rgba(255, 184, 28, 0.36)` with `border-color: var(--card-theme-accent, var(--card-theme-border, rgba(255, 184, 28, 0.36)))` allows the featured card border to glow with the theme's primary accent.
     - Replacing `background: linear-gradient(110deg, rgba(255, 184, 28, 0.055), transparent 58%), rgba(13, 17, 26, 0.94);` with `background: var(--card-theme-bg, linear-gradient(110deg, rgba(255, 184, 28, 0.055), transparent 58%), rgba(13, 17, 26, 0.94));` allows the featured card to inherit the theme's background (e.g. glass acrylic or dark obsidian).
     - In `.home-system-card-featured::after`, replacing `border-color: rgba(255, 184, 28, 0.55)` with `border-color: var(--card-theme-corner, var(--card-theme-accent, rgba(255, 184, 28, 0.55)))` aligns the corner notch with the theme border stroke.
     - In `.home-system-card-featured:hover`, replacing `border-color: rgba(255, 184, 28, 0.72)` with `border-color: var(--card-theme-accent, var(--card-theme-border-hover, rgba(255, 184, 28, 0.72)))` and adding `box-shadow: var(--card-theme-glow, none)` harmonizes the hover state.

4. **Preservation of Existing Test Invariants**:
   - *Premise*: Existing tests check that `style.css` contains `#home-view[data-card-theme="${id}"]` for the 5 canonical themes and that `.home-system-card` consumes `var(--card-theme-border, <fallback>)`.
   - *Inference*: Keeping the existing `#home-view[data-card-theme="..."]` blocks in `style.css` intact while refactoring only `.home-system-card-featured` guarantees zero regressions across the existing test suite.

---

## 3. Caveats

1. **Unrelated Test Failure in `card-theming-collision.test.mjs:546`**:
   - `Tier 1.7: Feature 7 — Fedora Remote Workstation Execution & Infrastructure Verification` asserts that `PROJECT.md` documents Fedora IP `10.0.0.2` and `Node.js v26|Firefox`.
   - Because `PROJECT.md` was rewritten during recent milestones without those specific infrastructure lines, `card-theming-collision.test.mjs` fails at line 546.
   - This failure is completely unrelated to 2D card styling or Milestone 2 code, but should be communicated to the orchestrator to add the missing infrastructure documentation to `PROJECT.md` so the test suite achieves 100% pass (195/195).
2. **Headless Execution Environment**:
   - In automated Node.js unit tests, `document` and `window` may be mocked via `SyntheticElement`. The implementation in `applyCardTheme` must use defensive guards (`typeof document !== "undefined"` and `homeViewElement?.style?.setProperty`) to avoid `TypeError` when run outside a browser.
3. **No Code Modification Undertaken**:
   - In adherence to the teamwork explorer archetype constraints, this investigation is strictly read-only. No files outside `.agents/teamwork/explorer_m2_2d/` have been altered.

---

## 4. Conclusion & Proposed Code Replacements

### 4.1 Proposed Code Replacement for `workspace-prototype/src/main.ts`

**Target File**: `G:\micro-host\workspace-prototype\src\main.ts`  
**Target Lines**: 4581–4610  
**Rationale**: Move `getCardTheme(themeId)` above Step 1, inject all 7 CSS custom properties directly onto `targetHome.style`, and maintain dataset synchronization across `#home-view` and `#studio-view`.

#### Before:
```typescript
  activeCardThemeId = themeId;
  persistTheme(themeId);

  // 1. Synchronize dataset attributes on #home-view and #studio-view
  if (homeViewElement) {
    homeViewElement.dataset.cardTheme = themeId;
  } else {
    const homeEl = document.getElementById("home-view");
    if (homeEl) homeEl.dataset.cardTheme = themeId;
  }

  if (studioViewElement) {
    studioViewElement.dataset.cardTheme = themeId;
  } else {
    const studioEl = document.getElementById("studio-view");
    if (studioEl) studioEl.dataset.cardTheme = themeId;
  }

  // 2. Synchronize theme chips in DOM
  const themeChips = document.querySelectorAll<HTMLButtonElement>("[data-theme-id]");
  themeChips.forEach((chip) => {
    const isSelected = chip.getAttribute("data-theme-id") === themeId;
    chip.classList.toggle("is-active", isSelected);
    chip.setAttribute("aria-checked", isSelected ? "true" : "false");
  });

  const theme = getCardTheme(themeId);

  // 3. Synchronize spatial scene lighting
```

#### After:
```typescript
  activeCardThemeId = themeId;
  persistTheme(themeId);

  const theme = getCardTheme(themeId);

  // 1. Synchronize dataset attributes and CSS custom properties on #home-view and #studio-view
  const targetHome = homeViewElement || (typeof document !== "undefined" ? document.getElementById("home-view") : null);
  if (targetHome) {
    targetHome.dataset.cardTheme = themeId;
    if (targetHome.style && typeof targetHome.style.setProperty === "function") {
      const cardBg = theme.homeCss?.cardBg ?? theme.homeCss?.["--card-theme-bg"] ?? "linear-gradient(135deg, rgba(20, 22, 27, 0.95), rgba(13, 17, 26, 0.90))";
      const cardBorder = theme.homeCss?.cardBorder ?? theme.homeCss?.["--card-theme-border"] ?? "rgba(112, 213, 207, 0.32)";
      const cardAccent = theme.homeCss?.cardAccent ?? theme.homeCss?.["--card-theme-accent"] ?? theme.swatchPrimary ?? "#70d5cf";
      const cardGlow = theme.homeCss?.cardGlow ?? theme.homeCss?.["--card-theme-glow"] ?? "0 8px 28px rgba(112, 213, 207, 0.14)";
      const cardCorner = theme.canvas?.borderStroke ?? theme.homeCss?.["--card-theme-corner"] ?? "rgba(112, 213, 207, 0.48)";
      const cardOnSurface = theme.canvas?.titleColor ?? theme.homeCss?.["--card-theme-on-surface"] ?? "#f4f5f7";
      const cardOnSurfaceVariant = theme.canvas?.detailColor ?? theme.homeCss?.["--card-theme-on-surface-variant"] ?? "#c3c8d1";

      targetHome.style.setProperty("--card-theme-bg", cardBg);
      targetHome.style.setProperty("--card-theme-border", cardBorder);
      targetHome.style.setProperty("--card-theme-accent", cardAccent);
      targetHome.style.setProperty("--card-theme-glow", cardGlow);
      targetHome.style.setProperty("--card-theme-corner", cardCorner);
      targetHome.style.setProperty("--card-theme-on-surface", cardOnSurface);
      targetHome.style.setProperty("--card-theme-on-surface-variant", cardOnSurfaceVariant);
    }
  }

  const targetStudio = studioViewElement || (typeof document !== "undefined" ? document.getElementById("studio-view") : null);
  if (targetStudio) {
    targetStudio.dataset.cardTheme = themeId;
  }

  // 2. Synchronize theme chips in DOM
  const themeChips = document.querySelectorAll<HTMLButtonElement>("[data-theme-id]");
  themeChips.forEach((chip) => {
    const isSelected = chip.getAttribute("data-theme-id") === themeId;
    chip.classList.toggle("is-active", isSelected);
    chip.setAttribute("aria-checked", isSelected ? "true" : "false");
  });

  // 3. Synchronize spatial scene lighting
```

---

### 4.2 Proposed Code Replacement for `workspace-prototype/src/style.css`

**Target File**: `G:\micro-host\workspace-prototype\src\style.css`  
**Target Lines**: 3099–3113  
**Rationale**: Refactor `.home-system-card-featured`, `.home-system-card-featured::after`, and `.home-system-card-featured:hover` to consume CSS custom properties with resilient fallbacks, eliminating the hardcoded amber lock.

#### Before:
```css
.home-system-card-featured {
  border-color: rgba(255, 184, 28, 0.36);
  background:
    linear-gradient(110deg, rgba(255, 184, 28, 0.055), transparent 58%),
    rgba(13, 17, 26, 0.94);
}

.home-system-card-featured::after {
  border-color: rgba(255, 184, 28, 0.55);
}

.home-system-card-featured:hover {
  border-color: rgba(255, 184, 28, 0.72);
}
```

#### After:
```css
.home-system-card-featured {
  border-color: var(--card-theme-accent, var(--card-theme-border, rgba(255, 184, 28, 0.36)));
  background:
    var(--card-theme-bg, linear-gradient(110deg, rgba(255, 184, 28, 0.055), transparent 58%), rgba(13, 17, 26, 0.94));
  box-shadow: var(--card-theme-glow, none);
}

.home-system-card-featured::after {
  border-color: var(--card-theme-corner, var(--card-theme-accent, rgba(255, 184, 28, 0.55)));
}

.home-system-card-featured:hover {
  border-color: var(--card-theme-accent, var(--card-theme-border-hover, rgba(255, 184, 28, 0.72)));
  box-shadow: var(--card-theme-glow, none);
}
```

---

## 5. Verification Method

### 5.1 Verification Commands
1. **Typecheck Verification**:
   ```bash
   cd G:\micro-host\workspace-prototype
   npx tsc --noEmit
   ```
   *Expected Result*: Exits with code 0, 0 type errors.

2. **Automated Integration Test Verification**:
   ```bash
   cd G:\micro-host\workspace-prototype
   node --test tests/android-theming-integration.test.mjs
   ```
   *Expected Result*: All 30 Tier 1 tests, 30 Tier 2 tests, 10 Tier 3 tests, and 5 Tier 4 tests pass (75/75 passing).

3. **Full Regression Test Suite Execution**:
   ```bash
   cd G:\micro-host\workspace-prototype
   npm test
   ```
   *Expected Result*: All 194+ core tests pass.

### 5.2 File Inspection Checkpoints
- Inspect `workspace-prototype/src/main.ts` lines ~4580–4615: verify `targetHome.style.setProperty` calls for all 7 properties.
- Inspect `workspace-prototype/src/style.css` lines ~3099–3115: verify `.home-system-card-featured` uses `var(--card-theme-accent)` and `var(--card-theme-border)`.

### 5.3 Invalidation Conditions
This report's conclusions would be invalidated if:
- `homeViewElement` does not cascade CSS custom properties to child cards.
- A test explicitly requires hardcoded `rgba(255, 184, 28, ...)` in `.home-system-card-featured` (verified: no such test exists).
- `getCardTheme(themeId)` throws an exception for any valid preset or seed descriptor (verified: handles all cases with default fallback).
