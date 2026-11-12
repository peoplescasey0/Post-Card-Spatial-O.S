# Handoff Report: Test Suite Infrastructure & `card-theming-collision.test.mjs` Architecture

**Agent**: `teamwork_explorer_m4_1` (Test Suite Infrastructure Explorer)  
**Parent**: `8d0d34ed-df61-49cb-ba08-ed88c814add4`  
**State Folder**: `g:\micro-host\.agents\teamwork\teamwork_explorer_m4_1\`  
**Date**: 2026-11-11T18:10:00Z  

---

## 1. Observation

### 1.1 Test Runner & Existing Suite Status
- **Test Runner Execution**: Inside `workspace-prototype`, `npm test` runs `node --test` (`package.json:10`). Running `npm test --prefix workspace-prototype` executes 63 tests across 12 test files (`tests/*.test.mjs`), with all 63 passing in ~33.6s (exit code 0).
- **Test File Naming & ESM**: Every test in `workspace-prototype/tests/` uses the `.test.mjs` extension and native ESM (`import test from "node:test"; import assert from "node:assert/strict";`).
- **Dependencies**: `workspace-prototype/package.json` specifies `"three": "^0.180.0"`, `"typescript": "^5.9.3"`, and `"vite": "^7.1.12"`. No third-party test runners (e.g. Vitest, Jest, Mocha) or DOM libraries (e.g. JSDOM, HappyDOM) are installed or needed.

### 1.2 TypeScript Transpilation & Module Loading Patterns
- In `workspace-prototype/tests/card-buttons.test.mjs:7-9` and `tests/card-actions.test.mjs:11-17`, TypeScript source files are dynamically transpiled and loaded in memory at runtime without creating disk artifacts:
  ```javascript
  const sourceTs = fs.readFileSync(path.join(workspaceDir, "src", "card-actions.ts"), "utf-8");
  const compiled = ts.transpileModule(sourceTs, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  ```
- **Data URL Import Constraints**: Modules imported via `data:text/javascript` have no filesystem base URL. Relative imports (`./...`) inside a data URL will fail to resolve. Therefore, existing architecture isolates pure functions and state handlers into focused TS helper files (`card-buttons.ts`, `card-actions.ts`, `carousel-pose.ts`, `carousel-wheel.ts`) that do not perform relative sub-imports.

### 1.3 DOM & Three.js Simulation Patterns
- **No Heavy DOM Emulation**: Tests in `workspace-prototype/tests/` do not spin up JSDOM or Chromium.
- **Lightweight Custom Fakes**: `tests/wheel-carousel.test.mjs:19-89` implements `FakeElement` and `FakeSceneShell` with `classList`, `closest()`, `matches()`, and `addEventListener()`, temporarily patching `globalThis.Element = FakeElement` inside a `try...finally` block to test event bubbling, capture phase, and wheel propagation.
- **Regex & AST Contract Verification**: Across `tests/compact-private-preview.test.mjs`, `tests/carousel-pose.test.mjs`, `tests/card-bin.test.mjs`, and `tests/m5_challenger_tour.test.mjs`, tests verify HTML template structure (`index.html`), CSS rules (`src/style.css`), and orchestration wiring in `src/main.ts` using precise regex matching on the source text.
- **State Machine Simulation**: `tests/m5_challenger_tour.test.mjs:99-260` tests complex multi-stage spatial operations by modelling step-by-step elapsed-time progress (`updateTour(time)`), asserting phase transitions, state flags, and interruption safety.

### 1.4 Geometry, Physics, and Boundary Parameters Observed in Source
- **Floor Geometry (`main.ts:586-598`)**:
  - Specular obsidian floor is at $Y = -0.12$, rotation $X = -\pi/2$.
- **Dais Geometry (`main.ts:791-802`)**:
  - `dais = new THREE.Mesh(new THREE.CylinderGeometry(7.7, 8.05, 0.2, 96, 1, false))`
  - Position: $(X = 0, Y = -0.015, Z = -0.25)$
  - Top surface height: $Y = -0.015 + 0.2/2 = +0.085$.
  - Radius on top surface: $R = 7.7$ centered at $(X = 0, Z = -0.25)$.
- **Card Geometry & Dimensions (`PROJECT.md:11`, `main.ts:133-185`)**:
  - Card height: $3.2$ units (half-height $1.6$).
  - Upright card center pivot is $(0, 0, 0)$.
  - Current drag clamping in `main.ts:6350-6352`:
    ```typescript
    drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.8, 7.2);
    drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, 0.6, 5.2);
    drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -6.6, 2.5);
    ```
    *Note*: Clamping $Y \in [0.6, 5.2]$ only checks the card center and does not adapt dynamically to dais perimeter or tilt/bounding box calculations, allowing corner penetration if cards tilt or move off the dais.

### 1.5 Identified Bugs & Contract Points in Existing Code
- **Home View Display Bug in `src/style.css:3516-3519`**:
  ```css
  /* Twilight orbital atelier: the room is the home screen. */
  #home-view {
    display: none !important;
  }
  ```
  This unconditionally hides `#home-view` regardless of whether the `hidden` attribute is present or removed, breaking view switching. Lines 2704-2707 already specify `#home-view[hidden], #studio-view[hidden] { display: none !important; }`.
- **Card Texture Cache Invalidation (`main.ts:4634-4669`)**:
  - `computeCardContentKey(card: SystemCard)` currently generates a composite key from status, facet, notes, guest status, and studio profile, but does not yet include `card.theme ?? activeThemeId`.
- **Button Interactivity Audit**:
  - `index.html` contains 123 `<button>` tags (HUD, dialogues, tour, bin, home cards).
  - `src/card-buttons.ts:15-24` defines 8 printed card buttons: `["guest", "stop", "zoom", "settings", "clone", "savepoint", "performance", "bin"]`.

### 1.6 Fedora Workstation Configuration & Toolchain
- **SSH Connectivity**: `ssh -G fedora` resolves to user `casey@10.0.0.2` on port 22 with `~/.ssh/id_ed25519`.
- **Remote Toolchain**:
  - `ssh fedora "node -v"` returns `v26.13.0`.
  - `ssh fedora "firefox --version"` returns `Mozilla Firefox 158.0.1`.
- **Environment Variable**: `workspace-prototype/.env:14` specifies `POSTCARD_KVM_HOST=casey@10.0.0.2`.

---

## 2. Logic Chain

1. **Test Runner Alignment**: The repository standardizes on Node.js native test runner (`node:test`, `node:assert/strict`) run via `node --test`. `workspace-prototype/tests/card-theming-collision.test.mjs` must be implemented in pure ESM (`.mjs`) compatible with both local Windows Node.js (v24.22.0) and remote Fedora Node.js (v26.13.0) without requiring external npm test dependencies.
2. **Execution Speed & Reliability**: Using Node.js native tests with on-the-fly TypeScript transpilation (`ts.transpileModule`) and selective regex/DOM contract checks executes in milliseconds (<200ms for unit suites), avoiding the memory overhead, flakiness, and dependency bloat of heavy headless browser automation for regression testing.
3. **Decoupled Architecture for `card-themes.ts`**: Because `data:text/javascript` imports cannot resolve relative filesystem paths, `workspace-prototype/src/card-themes.ts` must export self-contained types, palette definitions, and token accessor functions (`getCardTheme`, `CARD_THEMES`, `getFloorHeightAt`, `clampPositionAboveFloor`). This allows `card-theming-collision.test.mjs` to transpile and import `card-themes.ts` directly for thorough unit and boundary testing.
4. **Contract Verification for `main.ts` & `style.css`**: Since `main.ts` is a 290 KB WebGL/Three.js monolith that cannot be imported into a headless Node context without a canvas/window polyfill, the integration between `card-themes.ts`, `main.ts`, `style.css`, and `index.html` must be validated via:
   - Source contract assertions (ensuring `computeCardContentKey` includes theme, `showStudio` / `showHome` are wired, `[data-open-studio]` handles card selection, and the `#home-view` display bug in `style.css` is removed).
   - Event dispatcher simulation using `FakeElement` to test event dispatching on navigation and theme controls.
5. **Coverage of 7 Features across 4 Tiers**: `TEST_INFRA.md` requires Tier 1 (>=5 assertions per feature across all 7 features = >=35 assertions), Tier 2 (boundary & corner cases), Tier 3 (pairwise combinations), and Tier 4 (end-to-end user journeys). Structuring `card-theming-collision.test.mjs` into these exact tiers guarantees 100% compliance with `ORIGINAL_REQUEST.md`, `PROJECT.md`, and `TEST_INFRA.md`.

---

## 3. Caveats

1. **No WebGL in Headless Node**: Headless Node.js cannot execute Three.js `WebGLRenderer.render()`. 3D visual validation (e.g. verifying that card textures physically appear with the cyberpunk glow on-screen) relies on remote Fedora headless Firefox screenshots (`firefox --headless --screenshot`) or Canvas pixel inspection, while the unit test suite validates the mathematical, token, and shader material contracts.
2. **Working Directory for Direct Imports**: Node ESM requires running `node --test` from within `workspace-prototype/` (or passing appropriate resolution flags) for node_modules resolution like `three`. `npm test` automatically runs in `workspace-prototype/`.
3. **Fedora DirectLink Availability**: SSH connection to `casey@10.0.0.2` requires the physical DirectLink 1 Gbps tunnel between Windows host and Fedora workstation to remain up. Tests in `card-theming-collision.test.mjs` should gracefully detect if SSH is available for remote offloading or validate the remote execution contract structure deterministically.

---

## 4. Conclusion & Recommended Implementation Blueprint

The test file `workspace-prototype/tests/card-theming-collision.test.mjs` should be created following the proven patterns of `card-buttons.test.mjs`, `wheel-carousel.test.mjs`, and `m5_challenger_tour.test.mjs`.

### Recommended Structure for `card-theming-collision.test.mjs`

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(workspaceDir, "..");

// 1. Load & Transpile helper modules
const themeTsPath = path.join(workspaceDir, "src", "card-themes.ts");
const themeTs = fs.readFileSync(themeTsPath, "utf-8");
const compiledTheme = ts.transpileModule(themeTs, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  CARD_THEMES,
  getCardTheme,
  getFloorHeightAt,
  clampPositionAboveFloor,
} = await import(`data:text/javascript;base64,${Buffer.from(compiledTheme).toString("base64")}`);

// Read source files for contract assertions
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");
const styleCss = fs.readFileSync(path.join(workspaceDir, "src", "style.css"), "utf-8");
const indexHtml = fs.readFileSync(path.join(workspaceDir, "index.html"), "utf-8");
const themingDoc = fs.readFileSync(path.join(repoRoot, "THEMING_RESEARCH.md"), "utf-8");
```

### Detailed Test Matrix Mapping

#### Feature 1: Theming Research Documentation (`THEMING_RESEARCH.md`)
- **Assertions (>=5)**:
  1. `assert.ok(fs.existsSync(path.join(repoRoot, "THEMING_RESEARCH.md")))`
  2. Document covers Android home screen customization (launcher icons, adaptive layers, Material 3 Monet engine, HCT color space, tonal palettes).
  3. Document covers contrast ratios ($\Delta T \ge 60$ for WCAG AA).
  4. Document covers 2D flat vs 3D spatial taxonomy (depth, elevation, lighting, refraction, PBR materials).
  5. Document defines all 5 canonical themes: `"classic"`, `"cyberpunk"`, `"minimal-dark"`, `"glass"`, `"material-vibrant"`.
  6. Document specifies exact TypeScript interface schemas (`CardThemeId`, `CanvasThemeTokens`, `MaterialThemeTokens`, `LightingThemeTokens`, `HomeCssThemeTokens`, `CardThemeDefinition`).

#### Feature 2: Floor Boundary & Dais Collision Constraint
- **Math Verification**:
  1. Dais center $(0, -0.25)$, radius $7.7$, height $+0.085$. Obsidian floor height $-0.12$.
  2. `getFloorHeightAt(0, 0) === 0.085` (center of dais).
  3. `getFloorHeightAt(3, 1) === 0.085` (inside dais).
  4. `getFloorHeightAt(10, 0) === -0.12` (outside dais on obsidian floor).
  5. Boundary transition test:
     - Radius $r = 7.699$ (just inside): returns $+0.085$.
     - Radius $r = 7.701$ (just outside): returns $-0.12$.
  6. Card clamping with height $3.2$ (half-height $1.6$):
     - Center $Y$ over dais must satisfy $Y \ge 0.085 + 1.6 = 1.685$.
     - Center $Y$ over floor must satisfy $Y \ge -0.12 + 1.6 = 1.48$.
     - Test clamping with negative $Y$ drag input ($Y = -5.0$) clamps to $\ge 1.685$ on dais or $\ge 1.48$ on floor.
  7. Verify `main.ts` invokes floor clamping in `onPointerMove` and `resolveCardCollisions`.

#### Feature 3: Home View UI, Navigation & CSS Display Fix
- **Assertions (>=5)**:
  1. `index.html` contains `#home-view` and `#studio-view`.
  2. `index.html` has hero button `[data-open-studio]` and 5 system card buttons with `[data-open-studio]` and `[data-card-id]`.
  3. `index.html` has theme customization selector on `#home-view` (options/buttons for all 5 themes).
  4. `style.css` preserves `#home-view[hidden], #studio-view[hidden] { display: none !important; }`.
  5. `style.css` does NOT have unconditional `#home-view { display: none !important; }` (bug fix verification).
  6. `main.ts` implements `showStudio` and `showHome` and wires `[data-open-studio]` click handlers.

#### Feature 4: Button Interactivity Polish & Error Safety
- **Assertions (>=5)**:
  1. Audit DOM `<button>` elements in `index.html`: assert all buttons have explicit `type="button"` or `type="submit"`, valid text or `aria-label`, and no orphaned IDs.
  2. Audit modal dismiss buttons (`#bin-close`, `#help-close`, `#settings-close`, `#editions-close`, `#vault-close`).
  3. Printed card buttons: hit-testing on all 8 buttons from `card-buttons.ts` stays inside bounds; clicking gaps or preview returns undefined without errors.
  4. Runtime safety: assert optional chaining `?.` is used in event handlers in `main.ts` on DOM queries and selected card operations to prevent TypeErrors.

#### Feature 5: Card Theming Implementation (`card-themes.ts` & `main.ts`)
- **Assertions (>=5)**:
  1. All 5 themes (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`) exist in `CARD_THEMES` with full tokens (`canvas`, `material`, `lighting`, `css`).
  2. `getCardTheme` returns valid definition for each theme ID.
  3. `getCardTheme("invalid-theme")` falls back safely to `"classic"`.
  4. `computeCardContentKey` in `main.ts` incorporates theme identifier to force texture cache invalidation.
  5. `main.ts` persists active theme to `localStorage`.
  6. Applying theme updates `cardFloorGlow`, `cardHaloLight`, and PBR materials.

#### Feature 6: Automated Test Suite Architecture & Quality Gates
- **Assertions (>=5)**:
  1. Fast execution time (<1000ms).
  2. Pure deterministic assertions; no unhandled promise rejections.
  3. Total assertions count $\ge 35$ (Tier 1 requirement).
  4. Proper teardown and cleanup of global state.

#### Feature 7: Fedora Workstation Remote Validation
- **Assertions (>=5)**:
  1. Workstation host configuration exists in `.env` (`POSTCARD_KVM_HOST=casey@10.0.0.2`).
  2. SSH alias configuration (`fedora` mapping to `10.0.0.2` and user `casey`).
  3. Verification script / command contracts for remote test execution (`ssh fedora "node --test ..."`).
  4. Headless Firefox screenshot validation contract (`firefox --headless --screenshot`).
  5. Cross-platform path handling (all test paths use `path.join` or forward slashes, compatible with Linux).

#### Tier 2-4 Integration & User Journey Simulation
- **Tier 2 (Boundary & Corner Cases)**: Dais perimeter at $(x=7.7, z=-0.25)$, extreme downward drag ($Y = -50$), unknown theme IDs, cards at extreme rotation angles.
- **Tier 3 (Pairwise Matrix)**: [5 themes] $\times$ [2 views: home/studio] $\times$ [drag states: Dais vs Obsidian Floor].
- **Tier 4 (End-to-End User Journey)**:
  - Step 1: User lands on Home View (`#home-view` visible).
  - Step 2: User selects "cyberpunk" theme (CSS custom properties update, active theme state set).
  - Step 3: User clicks featured Fedora card (`data-card-id="linux"`).
  - Step 4: Router switches to Studio View (`#studio-view` visible, `#home-view` hidden, card focused).
  - Step 5: User drags card down toward floor $\rightarrow$ floor clamping enforces $Y_{\min} \ge Y_{\text{surface}}$.
  - Step 6: User clicks on-card printed button (`guest` action) $\rightarrow$ routes without runtime error.
  - Step 7: User clicks home brand CTA $\rightarrow$ returns to Home View with theme state preserved.

---

## 5. Verification Method

To independently verify these findings and recommendations:
1. **Run Existing Test Suite**:
   ```powershell
   npm test --prefix workspace-prototype
   ```
   *Expected Result*: All 63 tests pass cleanly in ~33s.
2. **Verify Fedora Workstation Connectivity**:
   ```powershell
   ssh fedora "node -v && firefox --version"
   ```
   *Expected Result*: Node v26.13.0 and Firefox 158.0.1.
3. **Verify Existing CSS Display Bug**:
   ```powershell
   Select-String -Path "workspace-prototype/src/style.css" -Pattern "#home-view\s*\{" -Context 0,3
   ```
   *Expected Result*: Lines 3517-3519 show `#home-view { display: none !important; }`.
4. **Verify TypeScript Dynamic Transpile Pattern**:
   Inspect `workspace-prototype/tests/card-buttons.test.mjs` and `workspace-prototype/tests/wheel-carousel.test.mjs`.
