# Handoff Report: Headless Test Execution Patterns for 2D/3D Integration & UI State Persistence

**Agent**: `e2e_explorer_it1_3`  
**State Folder**: `G:\micro-host\.agents\teamwork\e2e_explorer_it1_3\`  
**Milestone**: E2E Testing Track — Android Theming System Iteration 1  
**Date**: 2026-11-11T19:36:00Z  
**Integrity Mode**: development  

---

## 1. Observation

### 1.1 Node.js Test Runner & Workspace Baseline Status
- **Environment**: Node.js `v24.22.0` on Windows with PowerShell primary shell.
- **Test Runner**: `workspace-prototype/package.json` specifies `"type": "module"` and `"test": "node --test"`. Tests are executed via standard Node.js native test runner (`node:test`, `node:assert/strict`) over ES module files ending in `.test.mjs`.
- **Baseline Test Execution**:
  Running `npm test` inside `G:\micro-host\workspace-prototype`:
  - 18 test files executed.
  - 116 tests pass, 1 test fails (`Tier 1.7` in `card-theming-collision.test.mjs`), 0 skipped, total duration ~9.8s.
  - Verbatim failure in `card-theming-collision.test.mjs:532-555`:
    ```
    ✖ Tier 1.7: Feature 7 — Fedora Remote Workstation Execution & Infrastructure Verification (6.1821ms)
      AssertionError [ERR_ASSERTION]: PROJECT.md must document Fedora IP 10.0.0.2
        operator: 'match'
        expected: /10\.0\.0\.2/
        actual: '# Project: Post Card Spatial OS - Android Theming System\n...'
    ```
    *Root Cause*: `PROJECT.md` and `TEST_INFRA.md` in the project root were updated for the Android Theming System milestone, omitting the previous milestone's documentation strings (`10.0.0.2`, `ssh fedora "node --test"`, `firefox --headless --screenshot`).
- **Dependencies**: `package.json` contains runtime dependencies `"three": "^0.180.0"` and `"@novnc/novnc": "^1.7.0"`, with devDependencies `"typescript": "^5.9.3"` and `"vite": "^7.1.12"`. **No browser DOM libraries (e.g. `jsdom`, `happy-dom`), headless browsers (e.g. `puppeteer`, `playwright`), or native canvas modules (e.g. `canvas`, `skia`) are installed or permitted.**

---

### 1.2 2D DOM Element Styling & CSS Custom Properties
- **DOM Structure in `workspace-prototype/index.html`**:
  - `#home-view` is `<main class="home-view" id="home-view" hidden>` (line 17).
  - Theme bar container: `.home-theme-bar` (lines 85–112) with `.home-theme-picker[data-theme-picker][role="radiogroup"]`.
  - Theme chips: `<button class="theme-chip" role="radio" data-theme-id="...">` with `<span class="theme-swatch theme-swatch-[id]">` and `<span class="theme-chip-label">`.
  - System card grid: `.home-system-grid` (lines 114–179) containing 5 card buttons (`data-open-studio`, `data-card-id="android|windows|linux|macos|kali-red"`).
  - Featured card: `.home-system-card-featured` (`linux` card).
- **CSS Variable Binding in `workspace-prototype/src/style.css`**:
  - Base cards (lines 3062–3098):
    ```css
    .home-system-card {
      border: 1px solid var(--card-theme-border, rgba(138, 144, 158, 0.22));
      background: var(--card-theme-bg, linear-gradient(135deg, rgba(255, 255, 255, 0.025), transparent 55%), rgba(13, 17, 26, 0.88));
      color: var(--studio-text-main);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.32);
    }
    .home-system-card::after {
      border-top: 1px solid var(--card-theme-corner, rgba(138, 144, 158, 0.28));
      border-right: 1px solid var(--card-theme-corner, rgba(138, 144, 158, 0.28));
    }
    .home-system-card:hover {
      border-color: var(--card-theme-border-hover, rgba(195, 200, 209, 0.48));
      background: var(--card-theme-bg-hover, #14161b);
      box-shadow: var(--card-theme-glow, none);
    }
    ```
  - Hardcoded gap on featured card (lines 3099–3112):
    ```css
    .home-system-card-featured {
      border-color: rgba(255, 184, 28, 0.36);
      background: linear-gradient(110deg, rgba(255, 184, 28, 0.055), transparent 58%), rgba(13, 17, 26, 0.94);
    }
    ```
  - Existing attribute selectors (lines 3224–3298) define static theme overrides for `#home-view[data-card-theme="classic|cyberpunk|minimal-dark|glass|material-vibrant"]`.
- **Dynamic Application in `workspace-prototype/src/main.ts` & `PROJECT.md` Contract**:
  - `applyCardTheme(themeId: string)` sets:
    - `homeViewElement.dataset.cardTheme = themeId`
    - `homeViewElement.style.setProperty("--card-theme-bg", ...)`
    - `homeViewElement.style.setProperty("--card-theme-border", ...)`
    - `homeViewElement.style.setProperty("--card-theme-accent", ...)`
    - `homeViewElement.style.setProperty("--card-theme-glow", ...)`
    - `homeViewElement.style.setProperty("--card-theme-on-surface", ...)`
    - `homeViewElement.style.setProperty("--card-theme-on-surface-variant", ...)`

---

### 1.3 3D Spatial Canvas Rendering, Texture Tokens & Materials
- **Procedural Canvas Rasterization in `workspace-prototype/src/main.ts` (lines 3193–3277)**:
  - `makeCardTexture(card: SystemCard, facet: CardFacet): THREE.CanvasTexture`:
    - Canvas allocation: `const canvas = document.createElement("canvas"); canvas.width = 1280; canvas.height = 1920;`
    - Context acquisition: `const context = canvas.getContext("2d"); context.scale(2, 2);`
    - Background: `context.createLinearGradient(0, 0, 640, 960)` with `theme.canvas.bgTop` and `theme.canvas.bgBottom`.
    - Border: `context.strokeStyle = theme.canvas.borderStroke; context.lineWidth = theme.canvas.borderWidth;`
    - Fasteners: `drawChassisFastener(context, x, y, theme)` at 4 corners using `theme.canvas.fastenerHead`, `theme.canvas.fastenerRim`.
    - Front face drawing (`drawCardFront`, lines 3438–3482):
      * Line 3450: `context.fillStyle = "#f4f5f7";` (hardcoded title color, target: `theme.canvas.titleColor` / `onSurface`)
      * Line 3454: `context.fillStyle = "#c3c8d1";` (hardcoded detail color, target: `theme.canvas.detailColor` / `onSurfaceVariant`)
    - Buttons (`drawCardButtons`, lines 3513–3537): consumes `theme.canvas.buttonFill`, `theme.canvas.buttonStroke`, `theme.canvas.buttonText`.
- **Three.js Materials & Lights in `main.ts` (lines 4609–4655)**:
  - `cardHaloLight`: `cardHaloLight.color.set(theme.lighting.haloColor); cardHaloLight.intensity = theme.lighting.haloIntensity;`
  - `cardFloorGlow`: `cardFloorGlow.color.set(theme.lighting.floorGlowColor); cardFloorGlow.intensity = theme.lighting.floorGlowIntensity;`
  - `glowDisc.material.color.set(theme.lighting.floorGlowColor)`
  - `card.edgeMesh.material`: updates `color`, `emissive`, `emissiveIntensity`, `roughness`, `metalness`.
  - `card.frontMesh.material` / `card.backMesh.material`: updates `roughness`, `metalness`, `emissive`, `emissiveIntensity`.
- **Texture Cache Key Hashing in `main.ts` (lines 4980–5033)**:
  - `computeCardContentKey(card)` prefixes key with `card.theme ?? activeCardThemeId`.
  - `applyCardTheme` calls `refreshCardTexture(card, true)` which disposes stale textures (`cachedSharpTexture?.dispose()`, `cachedBlurredTexture?.dispose()`) and creates new `CanvasTexture`.

---

### 1.4 State Persistence & Serialization
- **Persistence Implementation in `workspace-prototype/src/card-themes.ts` (lines 416–451)**:
  - Storage key: `THEME_STORAGE_KEY = "postcard_studio_card_theme"`.
  - `loadPersistedTheme()`: reads `localStorage.getItem(THEME_STORAGE_KEY)`, validates with `isValidCardThemeId(saved)`, falls back to `DEFAULT_CARD_THEME_ID` (`"classic"`).
  - `persistTheme(themeId)`: sets `localStorage.setItem(THEME_STORAGE_KEY, themeId)`.
  - In `PROJECT.md` contract, `loadPersistedTheme()` and `persistTheme()` must support:
    1. 5 canonical preset IDs: `classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`.
    2. 5 Android preset IDs: `pixel-blue`, `forest-emerald`, `lavender-mist`, `sunset-amber`, `obsidian-monochrome`.
    3. Dynamic seed descriptors: `"seed:#HEX"`, e.g. `"seed:#4285f4"`.
    4. Safe recovery on corrupted strings, invalid hex, null, undefined, empty string, or when `localStorage` throws `SecurityError` or `QuotaExceededError`.

---

## 2. Logic Chain

1. **Why Full Browser DOM / jsdom is Unnecessary & Undesirable**:
   - *Observation*: The workspace test suite runs under `node --test` with `"type": "module"`. The baseline test duration across 18 files is ~9.8s. Installing `jsdom` or browser emulators would introduce heavy external npm dependencies, slow down test runs by 5–10x, and break the zero-new-dependencies invariant.
   - *Existing Precedent*: Existing tests (`m3_challenger2_theming.test.mjs:239-324`, `wheel-carousel.test.mjs:19-42`) successfully use lightweight `SyntheticElement` / `FakeElement` classes that implement only the minimal required interface (`style`, `dataset`, `classList`, `attributes`, `addEventListener`, `dispatchEvent`).
   - *Deduction*: A specialized, zero-dependency `MockStyleDeclaration` and `MockElement` can verify CSS variable injection, dataset synchronization, and chip state transitions in sub-millisecond execution times.

2. **Testing 2D DOM Element Styling and CSS Variables**:
   - *Observation*: `applyCardTheme(themeId)` executes `homeViewElement.style.setProperty("--card-theme-bg", ...)` and updates `homeViewElement.dataset.cardTheme`.
   - *Deduction*:
     - Dynamic verification: Provide `MockStyleDeclaration` with `setProperty`, `getPropertyValue`, and an internal `Map`. Call `applyCardTheme` and assert that `--card-theme-bg`, `--card-theme-border`, `--card-theme-accent`, `--card-theme-on-surface`, and `--card-theme-on-surface-variant` match the tokens returned by `getCardTheme(themeId)`.
     - Static CSS verification: Read `src/style.css` via `fs.readFileSync` and verify that `.home-system-card` consumes `--card-theme-*` variables with fallbacks, that `.home-system-card-featured` inherits `--card-theme-accent` or `--md-sys-color-primary`, and that responsive media queries at `<= 900px` and `<= 640px` are preserved.

3. **Testing 3D Spatial Canvas Rendering Without WebGL Hardware Canvas Context**:
   - *Observation*: Three.js core math (`THREE.Color`, `THREE.Vector3`, `THREE.Box3`), scene graph objects (`THREE.Mesh`, `THREE.Group`), materials (`THREE.MeshStandardMaterial`), and lights (`THREE.PointLight`) are pure JavaScript classes that instantiate and function completely in Node.js without a WebGL context or GPU.
   - *Observation*: `makeCardTexture` and facet drawers (`drawCardFront`, `drawCardButtons`) interact with the 2D canvas strictly via standard `CanvasRenderingContext2D` methods (`fillRect`, `fillText`, `createLinearGradient`, `beginPath`, `arc`, `fill`, `stroke`).
   - *Deduction*:
     - A pure JavaScript spy context (`MockCanvasRenderingContext2D`) recording all method invocations and property setters (`fillStyle`, `strokeStyle`) allows deterministic, non-visual assertion of:
       1. Whether `context.fillStyle` for the card title matches `theme.canvas.titleColor` (verifying replacement of hardcoded `#f4f5f7`).
       2. Whether `context.fillStyle` for subtitles matches `theme.canvas.detailColor` (verifying replacement of hardcoded `#c3c8d1`).
       3. Whether linear gradient color stops match `theme.canvas.bgTop` and `theme.canvas.bgBottom`.
       4. Whether buttons consume `theme.canvas.buttonFill`, `theme.canvas.buttonStroke`, and `theme.canvas.buttonText`.
     - Three.js PBR material properties (`roughness`, `metalness`, `emissive`) and light colors/intensities can be verified directly on genuine Three.js instances (`new THREE.MeshStandardMaterial()`, `new THREE.PointLight()`).

4. **Testing Cache Key Hashing & Texture Disposal Lifecycle**:
   - *Observation*: `computeCardContentKey(card)` generates a deterministic string delimited by `|`.
   - *Deduction*:
     - Verifying delimiter safety: Assert that no theme ID, preset ID, or seed descriptor contains the delimiter `|`.
     - Verifying key distinctness: Assert that `computeCardContentKey(card, "pixel-blue") !== computeCardContentKey(card, "forest-emerald") !== computeCardContentKey(card, "seed:#4285F4")`.
     - Verifying texture disposal: Attach a spy `dispose()` method to `cachedSharpTexture`. When switching themes, assert `disposeCount === 1` and assert that no double disposal occurs.

5. **Testing `localStorage` Persistence & Corrupted Storage Recovery**:
   - *Observation*: `loadPersistedTheme()` and `persistTheme()` access `globalThis.localStorage`.
   - *Deduction*:
     - Implement an in-memory `MockLocalStorage` with fault-injection flags (`_throwOnGet`, `_throwOnSet`).
     - Test valid preset IDs: `persistTheme("pixel-blue")` $\to$ `loadPersistedTheme() === "pixel-blue"`.
     - Test dynamic seed descriptors: `persistTheme("seed:#4285F4")` $\to$ `loadPersistedTheme() === "seed:#4285F4"`.
     - Test corrupted strings: `"seed:#XYZ"`, `"seed:#12"`, `"seed:"`, `"__proto__"`, `"<script>"`, `""`, `null` $\to$ safely returns `"classic"`.
     - Test throwing storage: `_throwOnGet = true` $\to$ returns `"classic"` without throwing.
     - Test deleted storage: `delete globalThis.localStorage` $\to$ returns `"classic"` without throwing.

---

## 3. Caveats

1. **Pre-Existing Baseline Regression on Tier 1.7**:
   `card-theming-collision.test.mjs` currently fails `Tier 1.7` because `PROJECT.md` and `TEST_INFRA.md` were overwritten for the Android Theming System milestone and omitted the string `10.0.0.2` and Fedora test execution documentation. This must be addressed in `PROJECT.md` and `TEST_INFRA.md` so `npm test` achieves 100% clean passes.
2. **Text Measurement in Headless Canvas Context**:
   `MockCanvasRenderingContext2D` does not have access to a native font rasterizer. In any code that calls `context.measureText(text)`, the mock should return a synthetic `{ width: text.length * 10 }` object.
3. **Color Picker Interaction in Headless Mode**:
   Headless Node.js lacks an interactive operating system color picker dialog. Seed color input events must be simulated programmatically via `inputEl.value = "#4285F4"; inputEl.dispatchEvent({ type: "input" }); inputEl.dispatchEvent({ type: "change" });`.

---

## 4. Conclusion & Concrete Implementation Blueprints

Below are the complete, ready-to-use, zero-dependency test fixtures and helper patterns for `workspace-prototype/tests/android-theming-integration.test.mjs`.

### 4.1 2D DOM Styling & CSS Custom Property Fixture (`MockDOM`)

```javascript
/**
 * Mock CSSStyleDeclaration supporting custom properties and standard style getters.
 */
export class MockStyleDeclaration {
  constructor() {
    this._properties = new Map();
  }
  setProperty(property, value, priority = "") {
    this._properties.set(property, { value: String(value), priority });
  }
  getPropertyValue(property) {
    return this._properties.get(property)?.value ?? "";
  }
  getPropertyPriority(property) {
    return this._properties.get(property)?.priority ?? "";
  }
  removeProperty(property) {
    const val = this.getPropertyValue(property);
    this._properties.delete(property);
    return val;
  }
  get length() {
    return this._properties.size;
  }
  item(index) {
    return Array.from(this._properties.keys())[index] ?? "";
  }
}

/**
 * Lightweight MockElement for 2D Home View and Studio View DOM testing.
 */
export class MockElement {
  constructor(tagName, id = "", className = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.dataset = {};
    this.style = new MockStyleDeclaration();
    this.classList = new Set(className.split(/\s+/).filter(Boolean));
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.hidden = false;
    this.value = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(value);
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
    if (name.startsWith("data-")) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[camel];
    }
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(event) {
    event.target = this;
    let cur = this;
    while (cur) {
      const handlers = cur.listeners.get(event.type) || [];
      for (const fn of handlers) fn(event);
      if (event.cancelBubble) break;
      cur = cur.parentElement;
    }
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (selector.startsWith("#") && cur.id === selector.slice(1)) return cur;
      if (selector.startsWith(".") && cur.classList.has(selector.slice(1))) return cur;
      if (selector.startsWith("[") && selector.endsWith("]")) {
        const attrName = selector.slice(1, -1).split("=")[0];
        if (cur.attributes.has(attrName)) return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const results = [];
    const recurse = (node) => {
      for (const child of node.children) {
        if (selector.startsWith("[data-theme-id]") && child.attributes.has("data-theme-id")) {
          results.push(child);
        }
        recurse(child);
      }
    };
    recurse(this);
    return results;
  }
}
```

---

### 4.2 3D Spatial Canvas Rendering & Spy Context Fixture (`MockCanvas2D`)

```javascript
/**
 * Spy CanvasRenderingContext2D recording all draw operations and property states.
 */
export class MockCanvasRenderingContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this._state = {
      fillStyle: "#000000",
      strokeStyle: "#000000",
      lineWidth: 1,
      font: "10px sans-serif",
      textAlign: "start",
      textBaseline: "alphabetic",
    };
    this._stateStack = [];
    this.operations = [];
  }

  get fillStyle() { return this._state.fillStyle; }
  set fillStyle(val) {
    this._state.fillStyle = val;
    this.operations.push({ op: "set_fillStyle", value: val });
  }

  get strokeStyle() { return this._state.strokeStyle; }
  set strokeStyle(val) {
    this._state.strokeStyle = val;
    this.operations.push({ op: "set_strokeStyle", value: val });
  }

  get lineWidth() { return this._state.lineWidth; }
  set lineWidth(val) { this._state.lineWidth = val; }

  get font() { return this._state.font; }
  set font(val) { this._state.font = val; }

  get textAlign() { return this._state.textAlign; }
  set textAlign(val) { this._state.textAlign = val; }

  save() {
    this._stateStack.push({ ...this._state });
    this.operations.push({ op: "save" });
  }

  restore() {
    if (this._stateStack.length) {
      this._state = this._stateStack.pop();
    }
    this.operations.push({ op: "restore" });
  }

  scale(x, y) { this.operations.push({ op: "scale", x, y }); }
  translate(x, y) { this.operations.push({ op: "translate", x, y }); }
  beginPath() { this.operations.push({ op: "beginPath" }); }
  closePath() { this.operations.push({ op: "closePath" }); }
  arc(x, y, r, s, e) { this.operations.push({ op: "arc", x, y, r, s, e }); }
  fill() { this.operations.push({ op: "fill", fillStyle: this.fillStyle }); }
  stroke() { this.operations.push({ op: "stroke", strokeStyle: this.strokeStyle }); }
  fillRect(x, y, w, h) {
    this.operations.push({ op: "fillRect", x, y, w, h, fillStyle: this.fillStyle });
  }
  strokeRect(x, y, w, h) {
    this.operations.push({ op: "strokeRect", x, y, w, h, strokeStyle: this.strokeStyle });
  }
  fillText(text, x, y) {
    this.operations.push({
      op: "fillText",
      text: String(text),
      x,
      y,
      fillStyle: this.fillStyle,
      font: this._state.font,
    });
  }
  createLinearGradient(x0, y0, x1, y1) {
    const stops = [];
    const grad = {
      addColorStop: (offset, color) => {
        stops.push({ offset, color });
      },
      stops,
    };
    this.operations.push({ op: "createLinearGradient", x0, y0, x1, y1, gradient: grad });
    return grad;
  }
  measureText(text) {
    return { width: String(text).length * 10, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3 };
  }
}

export class MockCanvas {
  constructor(width = 1280, height = 1920) {
    this.width = width;
    this.height = height;
    this.context = new MockCanvasRenderingContext2D(this);
  }
  getContext(type) {
    if (type === "2d") return this.context;
    return null;
  }
}
```

---

### 4.3 `localStorage` Scoped Mock with Fault Injection (`MockLocalStorage`)

```javascript
/**
 * Scoped in-memory localStorage stub with programmable exception triggers.
 */
export class MockLocalStorage {
  constructor() {
    this._store = new Map();
    this.throwOnGet = false;
    this.throwOnSet = false;
  }

  getItem(key) {
    if (this.throwOnGet) {
      throw new Error("SecurityError: Access is denied for this document");
    }
    return this._store.get(key) ?? null;
  }

  setItem(key, value) {
    if (this.throwOnSet) {
      throw new Error("QuotaExceededError: Storage quota exceeded");
    }
    this._store.set(key, String(value));
  }

  removeItem(key) {
    this._store.delete(key);
  }

  clear() {
    this._store.clear();
  }

  get length() {
    return this._store.size;
  }

  key(index) {
    return Array.from(this._store.keys())[index] ?? null;
  }
}
```

---

### 4.4 Colorimetry & WCAG AA Contrast Verification Helper

```javascript
/**
 * Relative luminance per WCAG 2.1 specifications (sRGB D65).
 */
export function getRelativeLuminance(hexColor) {
  let hex = hexColor.replace(/^#/, "").trim();
  if (hex.length === 3) {
    hex = hex.split("").map((c) => c + c).join("");
  }
  const r8 = parseInt(hex.slice(0, 2), 16);
  const g8 = parseInt(hex.slice(2, 4), 16);
  const b8 = parseInt(hex.slice(4, 6), 16);

  const toLinear = (c8) => {
    const c = c8 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  const rL = toLinear(r8);
  const gL = toLinear(g8);
  const bL = toLinear(b8);
  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

/**
 * Evaluates WCAG contrast ratio between two hex colors.
 */
export function getContrastRatio(hexA, hexB) {
  const lumA = getRelativeLuminance(hexA);
  const lumB = getRelativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}
```

---

### 4.5 Synthesis: Mapping the 4-Tier Test Suite to Fixtures

The 71 planned tests in `workspace-prototype/tests/android-theming-integration.test.mjs` utilize these fixtures as follows:

| Test Group | Tests | Fixtures Exercised | Primary Verification |
|---|:---:|---|---|
| **Tier 1: Feature Coverage** | 30 | `ColorScienceValidator`, `MockDOM`, `MockCanvas2D`, `ThreeJsMockFixture`, `MockLocalStorage` | 5 unit tests for each of the 6 features: dynamic palette generation, preset catalog, 2D CSS injection, 3D canvas token consumption, theme selection controls, and view persistence. |
| **Tier 2: Boundaries & Corners** | 30 | `ColorScienceValidator`, `MockDOM`, `MockCanvas2D`, `MockLocalStorage` | Extreme tonal stops (0 and 100), monochrome seeds ($C < 8$), malformed hex strings, rapid view transitions, and corrupted/throwing storage. |
| **Tier 3: Cross-Feature Interactions** | 6 | `MockDOM` + `MockCanvas2D` + `ThreeJsMockFixture` + `MockLocalStorage` | Preset selection $\leftrightarrow$ 3D lighting sync, dynamic seed $\to$ 2D CSS + 3D canvas sync, 2D/3D navigation retention, and per-card theme overrides. |
| **Tier 4: Real-World Scenarios** | 5 | All fixtures combined | Cold-boot with custom seed, 50-seed WCAG AA contrast validation ($\ge 4.5:1$), and mid-session storage corruption recovery. |

---

## 5. Verification Method

To independently verify this report and execute the patterns:

1. **Verify Baseline Test Execution**:
   ```bash
   cd G:\micro-host\workspace-prototype
   npm test
   ```
   *Expected Output*: 116 passing tests, 1 failing on `Tier 1.7` (due to missing Fedora doc strings in `PROJECT.md` and `TEST_INFRA.md`).

2. **Verify Typecheck and Vite Build**:
   ```bash
   cd G:\micro-host\workspace-prototype
   npx tsc --noEmit
   npm run build
   ```
   *Expected Output*: Both commands exit with status `0`.

3. **Verify Fixture Execution in Node.js**:
   Execute the `MockCanvas2D`, `MockDOM`, and `MockLocalStorage` fixtures in a Node.js REPL or test file to confirm zero external dependencies and $< 10\text{ms}$ execution speed.

4. **Invalidation Conditions**:
   This report would be invalidated if:
   - Node.js test runner requires `jsdom` or headless Chrome to inspect CSS variables or canvas drawing.
   - Three.js `MeshStandardMaterial` or `PointLight` throws without a WebGL context.
   - `localStorage` cannot be mocked cleanly on `globalThis`.
