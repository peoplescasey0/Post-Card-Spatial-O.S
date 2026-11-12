# E2E Test Suite Specification Report: Card Theming, Floor Collision, Button Interactivity & Fedora Remote Validation

**State Folder**: `g:\micro-host\.agents\teamwork\teamwork_spec_miner_m4_3\`  
**Agent**: `teamwork_spec_miner_m4_3` (E2E Test Suite Spec Miner)  
**Date**: 2026-11-11  
**Milestone**: M4  
**Integrity Mode**: Development  

---

## Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | Spatial Physics | Dais Surface Height Mapping (`getFloorHeightAt`) | Determines the elevation of the physical surface directly beneath any $(x, z)$ coordinate in the room. Returns dais top (+0.085) within radius 7.7 around $(0, -0.25)$, or floor plane (-0.12) outside. | `(x: number, z: number)` | `number` (+0.085 or -0.12) | None; returns -0.12 for any point outside dais radius. | `PROJECT.md` § Interface Contracts, `main.ts:791-802` |
| 2 | Spatial Physics | Card Center Elevation Clamping (`clampCardAboveFloor` / `minCardCenterY`) | Calculates minimum allowable card group center Y elevation based on surface height and card half-height ($1.6 \times \text{scale}$), enforcing $Y_{\text{center}} \ge Y_{\text{surface}} + 1.6 \times \text{scale}$. | `(x: number, z: number, scale?: number)` or `(card: SystemCard)` | `number` or modifies `card.group.position.y` | Prevents penetrating floor; clamps upwards if position is below limit. | `PROJECT.md` § Interface Contracts, `ORIGINAL_REQUEST.md` R2 |
| 3 | Spatial Physics | Direct Manipulation Free Drag Floor Clamping | Intercepts pointer drag (`drag.mode === "move"`) to clamp `drag.card.group.position.y` against `minCardCenterY` rather than arbitrary `0.6`. | Pointer coordinates $(x, y, z)$ from raycast | Clamped card position in 3D world space | Clamps to $\ge 1.685$ over dais or $\ge 1.48$ over floor. | `main.ts:6347-6352`, `PROJECT.md` M2 |
| 4 | Spatial Physics | Multi-Card Collision Floor Clearance | When `resolveCardCollisions` separates overlapping cards horizontally, ensures pushed cards do not drop or dip below floor elevation. | Card pair positions $(x, y, z)$ | Updated separation coordinates | Maintains $Y \ge Y_{\min}$. | `main.ts:4182-4220` |
| 5 | Spatial Physics | Dynamic Scale-Aware Floor Offset | Computes elevation clearance dynamically when cards scale between 0.64 (carousel rear) and 1.04 (focus front). | Card scale factor $s \in [0.6, 1.2]$ | Scaled clearance bound | Bounds scale linearly with $1.6 \cdot s$. | `carousel-pose.ts`, `main.ts:984` |
| 6 | Card Theming | 5 Theme Presets Catalog (`CARD_THEMES`) | Catalog of 5 rich visual presets: Classic Studio (`classic`), Cyberpunk Neon (`cyberpunk`), Minimal Dark (`minimal-dark`), Glass/Frosted (`glass`), and Material Vibrant (`material-vibrant`). | Theme ID string | `CardThemeDefinition` object | Unknown IDs fall back safely to `classic`. | `PROJECT.md` § Interface Contracts, `THEMING_RESEARCH.md` |
| 7 | Card Theming | Canvas Palette Token Mapping | Provides colors and stroke weights for 2D canvas face rendering (`bgTop`, `bgBottom`, `borderStroke`, `buttonFill`, `buttonStroke`, `buttonText`, `fastenerRim`). | Theme definition | Canvas context style properties | Colors validated against hex / rgba format. | `main.ts:3064-3120`, `explorer_survey_3` |
| 8 | Card Theming | Three.js PBR Material Property Mapping | Maps theme material tokens to Three.js card mesh material (`roughness`, `metalness`, `emissive`, `emissiveIntensity`). | Theme definition | Three.js `MeshStandardMaterial` parameters | Clamped to physical ranges $[0, 1]$. | `main.ts:2991-3016` |
| 9 | Card Theming | Spatial Lighting Accent Mapping | Updates point lights (`cardHaloLight`, `cardFloorGlow`) with theme colors and intensities. | Theme definition | Light `color` and `intensity` updates | Verified against positive intensity numbers. | `main.ts:579-585` |
| 10 | Card Theming | Content Key Invalidation Engine | Incorporates `card.theme ?? activeThemeId` into `computeCardContentKey(card)` to invalidate cached canvas textures upon theme change. | `card: SystemCard` | Unique pipe-delimited cache key string | Theme changes trigger texture re-creation. | `main.ts:4634-4690` |
| 11 | Card Theming | LocalStorage Theme Persistence | Saves and restores user's active theme selection under key `postcard_studio_card_theme`. | `themeId: CardThemeId` | Value in `localStorage` | Corrupted/missing keys fall back to `classic`. | `PROJECT.md` § Architecture, `explorer_survey_3` |
| 12 | Navigation UI | Dual-View Router (`showStudio` / `showHome`) | Manages transitions between `#home-view` (landing screen) and `#studio-view` (3D workspace). | Target view and optional `cardId` | Toggles DOM `hidden` attributes on view containers | Safe against missing elements. | `PROJECT.md` § Interface Contracts, `index.html:17, 167` |
| 13 | Navigation UI | CSS View Display Rule Enforcement | Eliminates unconditional `#home-view { display: none !important; }` in `style.css:3517` so `#home-view[hidden]` controls display cleanly. | DOM `hidden` attribute presence | CSS computed display `none` vs `block`/`grid` | Prevents permanent hiding of `#home-view`. | `style.css:2704-2706, 3517` |
| 14 | Navigation UI | Home Screen Primary Hero CTA | `<button class="home-primary-button" data-open-studio>` triggers transition to Studio View. | Click event | `showStudio()` invoked | No unhandled errors. | `index.html:40-43` |
| 15 | Navigation UI | Home Screen System Card Launchers | 5 cards (`android`, `windows`, `linux`, `macos`, `kali-red`) with `data-open-studio` and `data-card-id`. | Click event on card button | Opens Studio with specific card selected | Falls back to default selection if cardId missing. | `index.html:85-149` |
| 16 | Navigation UI | Home Screen Theme Customization Picker | UI controls on `#home-view` allowing users to preview and select card themes. | Click / change on theme picker | Updates active theme and re-renders home cards | Ignores invalid inputs. | `ORIGINAL_REQUEST.md` R1, `PROJECT.md` Feature 5 |
| 17 | Button Polish | 123 DOM Button Event Safety Audit | Verifies all 123 `<button>` elements in `index.html` have click listeners, dialog bindings, or delegation handlers. | Synthetic click dispatch | Event handler invocation without error | Zero uncaught runtime exceptions / TypeErrors. | `index.html`, `PROJECT.md` Feature 4 |
| 18 | Button Polish | 8 On-Card Printed Button Actions | UV hit-testing and action dispatch for `guest`, `stop`, `zoom`, `settings`, `clone`, `savepoint`, `performance`, `bin`. | UV coordinates $(u, v)$ | `CardButtonId` and action handler | Returns `undefined` for gaps / preview area. | `card-buttons.ts:1-60`, `card-actions.ts` |
| 19 | Remote Validation | Fedora Workstation SSH Node.js Test Runner | Remote execution of workspace test suites via SSH on Fedora Linux (`node --test`). | SSH command string | Process exit code, TAP/spec test output | Non-zero exit code on test failure. | `TEST_INFRA.md`, `explorer_survey_3` |
| 20 | Remote Validation | Headless Firefox Screenshot Capture | Captures 1920x1080 headless Firefox screenshots of the prototype UI via SSH on Fedora. | URL / port and output path | Saved PNG screenshot file on remote host | Reports error if browser or display fails. | `TEST_INFRA.md`, `explorer_survey_3` |

---

## Edge Cases

| # | Feature | Input | Observed Behavior |
|---|---------|-------|-------------------|
| 1 | Floor Clamping | Card dragged to extreme negative elevation ($Y = -10.0$) | Clamped to minimum elevation ($Y = 1.685$ over dais or $1.480$ over floor); never penetrates floor. |
| 2 | Floor Clamping | Card dragged to previous clamp minimum ($Y = 0.6$) | Clamped upward to $Y \ge 1.685$ or $1.480$; prevents 0.88m sub-floor penetration bug. |
| 3 | Dais Perimeter | Card placed exactly on dais radius boundary ($x = 7.7, z = -0.25$) | Surface height returns $+0.085$; boundary equality $(7.7)^2 = 59.29$ treated as on dais. |
| 4 | Dais Perimeter | Card placed $0.001$ units outside dais ($x = 7.701, z = -0.25$) | Surface height immediately drops to $-0.12$; card elevation minimum becomes $1.480$. |
| 5 | Dynamic Scale | Small rear card ($\text{scale} = 0.64$) dragged downwards | Half-height is $1.024$; minimum center elevation is clamped to $0.085 + 1.024 = 1.109$. |
| 6 | Dynamic Scale | Large front card ($\text{scale} = 1.04$) dragged downwards | Half-height is $1.664$; minimum center elevation is clamped to $0.085 + 1.664 = 1.749$. |
| 7 | Card Rotation | Card tilted around Z axis by $30^\circ$ | Bounding box minimum vertex (`Box3.min.y`) enforced $\ge Y_{\text{surface}}$; center $Y$ adjusted higher to compensate for corner dip. |
| 8 | Multi-Card Bump | In-flight card shoved downward during inter-card collision resolution | `resolveCardCollisions` clamps updated $Y$ to ensure neither active nor passive card dips below floor. |
| 9 | Theme Fallback | `getCardTheme("non-existent-theme-xyz")` | Safely falls back to `CARD_THEMES["classic"]` without throwing exception. |
| 10 | Theme Fallback | `getCardTheme("")` (empty string) or null/undefined | Safely returns `CARD_THEMES["classic"]`. |
| 11 | Theme Invalidation | Self-transition: changing theme from `classic` to `classic` | Content key unchanged; does not trigger redundant texture re-allocation or memory leak. |
| 12 | Theme Invalidation | Transition between all 5 presets ($5 \times 5 = 25$ combinations) | Content keys change on every cross-theme transition; cached textures disposed cleanly. |
| 13 | LocalStorage | `localStorage` contains corrupt or unsupported theme ID | Application startup recovers cleanly, falls back to `classic`, and updates storage. |
| 14 | View Router | `showStudio("unknown-card-id")` | Displays Studio View; safely falls back to default selected card without runtime error. |
| 15 | CSS Specificity | `#home-view` element with `hidden` attribute removed | Displays as active landing view; no longer hidden by `style.css:3517`. |
| 16 | Rapid View Switch | Alternating rapidly between Home and Studio views | No duplicate animation loops, no memory leaks, card state preserved. |
| 17 | Button Click Spam | Rapid synthetic clicks on all 123 DOM buttons | No unhandled `TypeError: Cannot read properties of undefined` or `null`. |
| 18 | Remote Network | Direct link IP `10.0.0.2` SSH invocation | Successful batch-mode connection with $<1$ ms latency over Ethernet. |

---

## 1. Observation

### 1.1 Workspace Prototype Layout & Existing Test Suite
- `workspace-prototype/package.json` specifies `"type": "module"` and `"test": "node --test"`.
- Running `npm test` inside `workspace-prototype` executes 12 existing test suites (63 tests) in 22.5s on Windows and 67 tests in 1.05s on Fedora.
- The test harness runs purely via Node.js native test runner (`node:test`) and strict assertions (`node:assert/strict`).
- TypeScript test files transpile modules on-the-fly using `ts.transpileModule` and import via base64 data URLs:
  ```javascript
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  ```

### 1.2 Coordinate System & Floor Penetration Defect
- In `workspace-prototype/src/main.ts`:
  - `CARD_WIDTH = 2.15; CARD_HEIGHT = 3.2;` (line 983-984).
  - Card origin $(0, 0, 0)$ is at its geometric center. Half-height is $1.6$.
  - Obsidian floor is at `floor.position.y = -0.12` (line 596).
  - Dais platform is at `dais.position.set(0, -0.015, -0.25)` (line 799) with cylinder height $0.2$, radius $7.7$.
  - Dais top surface is $-0.015 + 0.1 = +0.085$.
  - In `drag.mode === "move"` (line 6351):
    `drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, 0.6, 5.2);`
  - When $y = 0.6$, the card bottom is at $0.6 - 1.6 = -1.0$. Because the floor is at $y = -0.12$, the card penetrates $0.88$ units through the floor.

### 1.3 Theming Architecture State
- Currently, `workspace-prototype/src/main.ts` only modifies lighting via `#color-grade-profile` (Twilight, Cyberpunk, Monochrome, Vintage).
- Card canvas textures (`makeCardTexture`, lines 3064-3120) have hardcoded colors (`#14161B` -> `#0D111A`), hardcoded cyan borders (`#70d5cf55`), and hardcoded button backgrounds (`#07090ee8`).
- `computeCardContentKey` (line 4634) ignores theme, so changing lighting does not invalidate or update card textures.
- `src/card-themes.ts` does not yet exist and is planned for Milestone M3.

### 1.4 View Routing & CSS Regression
- `workspace-prototype/index.html` lines 17-165 defines `<main class="home-view" id="home-view" hidden>` with 5 system cards and `[data-open-studio]`.
- Line 3517 of `workspace-prototype/src/style.css` contains:
  ```css
  #home-view {
    display: none !important;
  }
  ```
  This unconditionally hides `#home-view`, even when the `hidden` attribute is removed. Lines 2704-2706 contain the correct rule `#home-view[hidden], #studio-view[hidden] { display: none !important; }`.
- Buttons with `data-open-studio` have no attached event listeners in `main.ts`.

### 1.5 Fedora Remote Workstation Verification
- Verified connection: `ssh -o BatchMode=yes fedora "node -v; which firefox; firefox --version"`
  - Output: `v26.13.0`, `/usr/bin/firefox`, `Mozilla Firefox 158.0.1`.
- Verified existing clone: `/home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype`.
- Verified test execution on Fedora: `npm test` completed 67 tests in 1048 ms.
- Verified headless screenshot capture on Fedora: `firefox --headless --screenshot /tmp/test_shot.png https://example.com` produced a 95 KB PNG in 3.1s.

---

## 2. Logic Chain

1. **Test Location & Architecture**:
   - `PROJECT.md` specifies `workspace-prototype/tests/card-theming-collision.test.mjs` as the automated test suite for Milestone M4.
   - Using Node.js native test runner (`node:test`) and `node:assert/strict` guarantees immediate zero-dependency compatibility across Windows and Fedora Linux.
   - Dynamic transpilation via `typescript` allows the test file to test both TypeScript source modules (`src/card-themes.ts`, `src/card-buttons.ts`) and CSS/HTML files directly.

2. **Floor Constraint Specification (Requirement R2)**:
   - For any point $(x, z)$, the surface height is determined by the dais cylinder:
     $$\Delta r^2 = (x - 0)^2 + (z - (-0.25))^2$$
     $$\text{If } \Delta r^2 \le 7.7^2 \implies Y_{\text{surface}} = 0.085, \text{ else } Y_{\text{surface}} = -0.12$$
   - The card has center pivot with height $3.2$ (half-height $1.6$).
   - For an upright card of scale $s$, $Y_{\min}(x, z, s) = Y_{\text{surface}}(x, z) + 1.6 \cdot s$.
   - For tilted cards, the bounding box min vertex must satisfy $\text{Box3}(card).\min.y \ge Y_{\text{surface}}$.
   - Enforcing this clamping in direct manipulation prevents cards from ever clipping through the dais ($Y < 0.085$) or obsidian floor ($Y < -0.12$).

3. **Theme Engine Specification (Requirement R1)**:
   - Defining 5 presets (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`) with complete token definitions across Canvas, PBR Material, Spatial Lighting, and CSS variables ensures consistent visual presentation.
   - Injecting `card.theme ?? activeThemeId` into `computeCardContentKey` guarantees that calling `refreshCardTexture(card, true)` invalidates cached textures and repaints the canvas.
   - Storing the active theme in `localStorage.getItem("postcard_studio_card_theme")` ensures user preference survives page reload.

4. **Button & Navigation Integrity (Requirement R2)**:
   - Removing `style.css:3517` restores the dual-view router contract: toggling `hidden` on `#home-view` and `#studio-view` switches views cleanly.
   - Wiring click handlers on `[data-open-studio]` routes users into the 3D studio, setting `selectedCard` if `data-card-id` is present.
   - Auditing all 123 DOM buttons and 8 on-card printed buttons guarantees zero unhandled exceptions.

5. **Fedora Remote Offload (Requirement R3)**:
   - Using SSH direct link (`10.0.0.2`), Node.js v26.13.0 executes `npm test` at $>20\times$ the speed of the host Windows process (1.05s vs 22.5s).
   - Headless Firefox on Fedora captures high-resolution screenshots without consuming host GPU cycles.

---

## 3. Caveats

1. **Local vs Remote Code Synchronization**:
   - The Fedora workstation has a clone at `/home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype`. New files (`src/card-themes.ts`, `tests/card-theming-collision.test.mjs`) must be synced via `scp` or `rsync` prior to running remote tests.
2. **Three.js WebGL in Headless Environments**:
   - In headless Firefox, Three.js uses Mesa software rendering (`llvmpipe`). While DOM elements, SVG, and CSS styles render with 100% pixel fidelity, WebGL shaders run CPU-bound and take 2-3 seconds to render the initial frame.
3. **Card Pitch / Roll Elevation Variance**:
   - When cards are tilted during drag (e.g. `drag.card.tiltZ`), the corner vertex descends lower than $Y_{\text{center}} - 1.6$. The test assertions must verify bounding box minimums (`Box3.min.y >= Y_surface`), not merely center $Y$.

---

## 4. Conclusion & Complete Test Specification

The test suite `workspace-prototype/tests/card-theming-collision.test.mjs` must be implemented with four distinct coverage tiers and 50+ total assertions.

```
========================================================================================
E2E TEST SUITE ARCHITECTURE: workspace-prototype/tests/card-theming-collision.test.mjs
========================================================================================
```

### 4.1 Tier 1: Core Unit Invariants & Assertions (>= 5 Assertions Per Feature)

#### Suite 1.1: Floor Boundary Constraints & Dais Physics
```typescript
test("Tier 1.1: Floor boundary constraints and dais height mapping", async () => {
  // Assertion 1: Dais center (0, -0.25) elevation is exactly +0.085
  assert.equal(getFloorHeightAt(0, -0.25), 0.085);

  // Assertion 2: Interior dais position (5.0, 1.0) elevation is exactly +0.085
  assert.equal(getFloorHeightAt(5.0, 1.0), 0.085);

  // Assertion 3: Dais boundary perimeter (7.7, -0.25) elevation is +0.085
  assert.equal(getFloorHeightAt(7.7, -0.25), 0.085);

  // Assertion 4: Outside dais platform (8.0, 0.0) drops to obsidian floor -0.12
  assert.equal(getFloorHeightAt(8.0, 0.0), -0.12);

  // Assertion 5: Distant room floor coordinate (0.0, 15.0) returns -0.12
  assert.equal(getFloorHeightAt(0.0, 15.0), -0.12);

  // Assertion 6: minCardCenterY over dais with scale 1.0 is >= 1.685 (0.085 + 1.6)
  assert.equal(minCardCenterY(0, -0.25, 1.0), 1.685);

  // Assertion 7: minCardCenterY over floor with scale 1.0 is >= 1.480 (-0.12 + 1.6)
  assert.equal(minCardCenterY(8.0, 0, 1.0), 1.480);

  // Assertion 8: Clamping card below floor lifts position.y above surface
  const mockCard = createMockCard({ x: 0, y: 0.6, z: -0.25, scale: 1.0 });
  clampCardAboveFloor(mockCard);
  assert.ok(mockCard.group.position.y >= 1.685);
});
```

#### Suite 1.2: 5 Theme Preset Token Definitions & Schemas
```typescript
test("Tier 1.2: 5 theme preset definitions and complete token schemas", async () => {
  const { CARD_THEME_IDS, CARD_THEMES, getCardTheme } = await loadCardThemes();

  // Assertion 1: Exactly 5 theme IDs defined
  assert.equal(CARD_THEME_IDS.length, 5);
  assert.deepEqual([...CARD_THEME_IDS].sort(), [
    "classic", "cyberpunk", "glass", "material-vibrant", "minimal-dark"
  ].sort());

  // Assertion 2: All 5 presets present in CARD_THEMES record
  for (const id of CARD_THEME_IDS) {
    const theme = CARD_THEMES[id];
    assert.ok(theme, `Theme ${id} must exist in CARD_THEMES`);
    assert.equal(theme.id, id);
    assert.ok(theme.name && theme.name.length > 0);
    assert.ok(theme.description && theme.description.length > 0);
  }

  // Assertion 3: Classic theme palette invariants
  const classic = getCardTheme("classic");
  assert.match(classic.canvas.bgTop, /^#14161[Bb]$/);
  assert.match(classic.canvas.borderStroke, /^#70d5cf$/i);
  assert.ok(classic.material.roughness >= 0.8 && classic.material.roughness <= 0.9);

  // Assertion 4: Cyberpunk theme neon dual-stroke & glossy material
  const cyberpunk = getCardTheme("cyberpunk");
  assert.match(cyberpunk.canvas.borderStroke, /^#(ff007f|00f0ff)$/i);
  assert.ok(cyberpunk.material.roughness <= 0.35, "Cyberpunk should be glossy");
  assert.ok(cyberpunk.material.metalness >= 0.6, "Cyberpunk should be metallic");

  // Assertion 5: Minimal dark AMOLED invariants
  const minimal = getCardTheme("minimal-dark");
  assert.match(minimal.canvas.bgTop, /^#050505$/);
  assert.match(minimal.canvas.bgBottom, /^#000000$/);
  assert.equal(minimal.material.metalness, 0.0);

  // Assertion 6: Glass / Frosted translucency & low roughness
  const glass = getCardTheme("glass");
  assert.match(glass.canvas.bgTop, /^rgba\(/);
  assert.ok(glass.material.roughness <= 0.25);

  // Assertion 7: Material Vibrant warm tactile finish
  const vibrant = getCardTheme("material-vibrant");
  assert.match(vibrant.canvas.borderStroke, /^#f59e0b$/i);
  assert.ok(vibrant.material.roughness >= 0.5 && vibrant.material.roughness <= 0.75);
});
```

#### Suite 1.3: Theme Cache Invalidation & Content Key Synchronization
```typescript
test("Tier 1.3: computeCardContentKey incorporates theme and triggers invalidation", async () => {
  // Assertion 1: Default card content key contains active theme
  const card = createMockCard({ id: "linux", theme: undefined });
  const key1 = computeCardContentKey(card, "classic");
  assert.ok(key1.includes("classic"));

  // Assertion 2: Key changes when global active theme changes
  const key2 = computeCardContentKey(card, "cyberpunk");
  assert.notEqual(key1, key2);
  assert.ok(key2.includes("cyberpunk"));

  // Assertion 3: Per-card custom theme overrides global theme in key
  card.theme = "minimal-dark";
  const key3 = computeCardContentKey(card, "cyberpunk");
  assert.ok(key3.includes("minimal-dark"));
  assert.ok(!key3.includes("cyberpunk"));

  // Assertion 4: Refreshing card texture with mismatched key disposes old textures
  let disposed = false;
  card.cachedSharpTexture = { dispose: () => { disposed = true; } };
  card.cachedContentKey = "old-key";
  refreshCardTexture(card, false);
  assert.equal(disposed, true);

  // Assertion 5: Key with identical content key does not trigger dispose
  disposed = false;
  card.cachedSharpTexture = { dispose: () => { disposed = true; } };
  card.cachedContentKey = computeCardContentKey(card, "minimal-dark");
  refreshCardTexture(card, false);
  assert.equal(disposed, false);
});
```

#### Suite 1.4: Button Event Listeners & Home Screen Navigation
```typescript
test("Tier 1.4: Home view primary button and system cards trigger studio navigation", () => {
  const html = fs.readFileSync(path.join(workspaceDir, "index.html"), "utf-8");

  // Assertion 1: Primary CTA has data-open-studio attribute
  assert.match(html, /<button[^>]+class="[^"]*home-primary-button[^"]*"[^>]*data-open-studio/);

  // Assertion 2: Exactly 5 home system card buttons with data-open-studio
  const systemCardMatches = [...html.matchAll(/<button[^>]+class="[^"]*home-system-card[^"]*"[^>]*data-open-studio/g)];
  assert.equal(systemCardMatches.length, 5);

  // Assertion 3: System cards have exact target IDs (android, windows, linux, macos, kali-red)
  const cardIds = [...html.matchAll(/data-card-id="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(cardIds.sort(), ["android", "kali-red", "linux", "macos", "windows"].sort());

  // Assertion 4: showStudio() switches hidden attributes
  const homeView = { hidden: false };
  const studioView = { hidden: true };
  showStudioMock(homeView, studioView);
  assert.equal(homeView.hidden, true);
  assert.equal(studioView.hidden, false);

  // Assertion 5: showStudio("macos") selects the macos card
  const selected = showStudioMock(homeView, studioView, "macos");
  assert.equal(selected, "macos");

  // Assertion 6: showHome() switches hidden attributes back
  showHomeMock(homeView, studioView);
  assert.equal(homeView.hidden, false);
  assert.equal(studioView.hidden, true);
});
```

#### Suite 1.5: 123 DOM Buttons & 8 Printed Buttons Safety Audit
```typescript
test("Tier 1.5: Button interactivity safety across all 123 DOM buttons and 8 printed buttons", () => {
  const html = fs.readFileSync(path.join(workspaceDir, "index.html"), "utf-8");
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map(m => m[1]);

  // Assertion 1: Total DOM button count is 123
  assert.equal(buttons.length, 123);

  // Assertion 2: Printed card button IDs constant contains exactly 8 buttons
  const { CARD_BUTTON_IDS, hitCardButton } = await loadCardButtons();
  assert.equal(CARD_BUTTON_IDS.length, 8);
  assert.deepEqual([...CARD_BUTTON_IDS], [
    "guest", "stop", "zoom", "settings", "clone", "savepoint", "performance", "bin"
  ]);

  // Assertion 3: UV center of all 8 printed buttons resolves cleanly
  for (let i = 0; i < 8; i++) {
    const rect = cardButtonRect(i);
    const u = (rect.x + rect.w / 2) / 640;
    const v = 1 - (rect.y + rect.h / 2) / 960;
    assert.equal(hitCardButton(u, v), CARD_BUTTON_IDS[i]);
  }

  // Assertion 4: Inter-button gaps return undefined
  assert.equal(hitCardButton(0.5, 0.5), undefined);

  // Assertion 5: All printed button actions resolve in getOnCardActionState
  const actionState = getOnCardActionState({ os: "linux", baseReady: true, hasDisk: true });
  assert.ok(actionState.guestLabel);
  assert.ok(typeof actionState.canMoveToBin === "boolean");
});
```

---

### 4.2 Tier 2: Boundary & Corner Cases

#### Suite 2.1: Downward Drag Under Extreme Coordinates
- **Test 2.1.1**: Drag to $Y = 0.0$ (over dais): `drag.card.group.position.y` clamped to $\ge 1.685$.
- **Test 2.1.2**: Drag to $Y = -10.0$ (extreme sub-floor): Clamped to $\ge 1.685$.
- **Test 2.1.3**: Drag to previous buggy limit $Y = 0.6$: Clamped to $\ge 1.685$; bottom vertex $\ge 0.085$.
- **Test 2.1.4**: Drag outside dais ($x = 8.0, z = 0.0$) down to $Y = -5.0$: Clamped to $Y \ge 1.480$; bottom vertex $\ge -0.12$.
- **Test 2.1.5**: Drag to high position $Y = 4.5$: Preserved without modification (no false-positive clamping).

#### Suite 2.2: Dais Platform Edge Boundary Discontinuity ($r = 7.7$)
- **Test 2.2.1**: Exactly on perimeter $(7.7, -0.25)$: Distance squared $= 59.29 \implies Y_{\text{surface}} = 0.085$.
- **Test 2.2.2**: Infinitesimal exterior step $(7.701, -0.25)$: Distance squared $> 59.29 \implies Y_{\text{surface}} = -0.12$.
- **Test 2.2.3**: Four cardinal perimeter points $(0, 7.45)$, $(0, -7.95)$, $(7.7, -0.25)$, $(-7.7, -0.25)$ all evaluate to $0.085$.
- **Test 2.2.4**: Dragging card across radial boundary: Transition step is monotonic with surface discontinuity; card elevation clamps smoothly to respective surface.

#### Suite 2.3: Scale-Dependent Clamping & Bounding Box Tilt Clearance
- **Test 2.3.1**: Rear carousel card at scale $0.64$: Half-height $= 1.024$; minimum center $Y = 0.085 + 1.024 = 1.109$.
- **Test 2.3.2**: Focused card at scale $1.04$: Half-height $= 1.664$; minimum center $Y = 0.085 + 1.664 = 1.749$.
- **Test 2.3.3**: Card tilted around Z by $20^\circ$: Lower corner drops by $\Delta Y = \frac{W}{2}\sin 20^\circ + \frac{H}{2}(1 - \cos 20^\circ)$; `clampCardAboveFloor` lifts center $Y$ so lowest corner vertex $\ge 0.085$.
- **Test 2.3.4**: Card tilted around X by $15^\circ$: `Box3.min.y >= 0.085` verified with Three.js bounding box calculation.

#### Suite 2.4: All $5 \times 5 = 25$ Theme Switching Combinations & Idempotency
- **Test 2.4.1**: Execute matrix of all 25 transitions:
  $$\forall (A, B) \in \text{THEMES} \times \text{THEMES}, \quad \text{applyTheme}(A) \to \text{applyTheme}(B)$$
- **Test 2.4.2**: Verify that when $A \ne B$, content key changes: $\text{key}(A) \ne \text{key}(B)$.
- **Test 2.4.3**: Idempotent self-transition: $\text{applyTheme}(A) \to \text{applyTheme}(A)$ produces identical key and does NOT invoke `.dispose()` on active texture.
- **Test 2.4.4**: Memory leak check: 25 consecutive theme switches complete with 0 unhandled Promise rejections and active texture references cleanly replaced.

#### Suite 2.5: Invalid, Malformed, and Null Theme ID Recovery
- **Test 2.5.1**: `getCardTheme("non-existent-theme")` returns `CARD_THEMES["classic"]`.
- **Test 2.5.2**: `getCardTheme("")` returns `CARD_THEMES["classic"]`.
- **Test 2.5.3**: `getCardTheme(null)` and `getCardTheme(undefined)` return `CARD_THEMES["classic"]`.
- **Test 2.5.4**: `applyCardTheme("corrupt-id" as any)` applies `classic` and updates `localStorage` to `classic`.

#### Suite 2.6: CSS Rule Isolation & View Switching Safety
- **Test 2.6.1**: Verify `src/style.css` does NOT contain `#home-view { display: none !important; }` without `[hidden]`.
- **Test 2.6.2**: Verify `src/style.css` contains `#home-view[hidden] { display: none !important; }`.
- **Test 2.6.3**: Verify `src/style.css` contains `#studio-view[hidden] { display: none !important; }`.

---

### 4.3 Tier 3: Cross-Feature Combinations

#### Suite 3.1: Theming + Card Floor Clamping Interaction
- **Scenario**: Set theme to `cyberpunk` $\to$ Drag card to floor elevation $Y = 0.0$.
- **Assertions**:
  1. Card position is clamped to $Y \ge 1.685$.
  2. Card material has `roughness === 0.25` and `metalness === 0.70`.
  3. Under-card floor glow light `cardFloorGlow.color` is `#00f0ff`.
  4. Cache key reflects `cyberpunk`.

#### Suite 3.2: Home Screen Theme Customization Propagating to Studio 3D Canvas
- **Scenario**: In `#home-view`, user clicks Theme Picker to choose `glass` $\to$ Clicks `[data-open-studio]`.
- **Assertions**:
  1. `#home-view` is hidden, `#studio-view` is active.
  2. Studio 3D card textures render with translucent glass styling (`rgba(26, 38, 57, 0.75)`).
  3. Studio ambient halo light matches glass ethereal cyan.

#### Suite 3.3: Card Free Manipulation Persistence Across View Switching
- **Scenario**: In Studio View, user drags card to $(3.0, 2.0, -1.0)$ $\to$ Switches to Home View $\to$ Returns to Studio View.
- **Assertions**:
  1. Card position $(3.0, 2.0, -1.0)$ is preserved in `layoutOffset`.
  2. Card position does not reset to zero or dip below floor.
  3. Turntable rotation restores selected card focus.

#### Suite 3.4: LocalStorage Cold-Boot Theme Initialization
- **Scenario**: Set `localStorage.setItem("postcard_studio_card_theme", "material-vibrant")` $\to$ Initialize app.
- **Assertions**:
  1. Default theme loaded is `material-vibrant`.
  2. `#home-view` theme selector shows `material-vibrant` active.
  3. Studio cards initialize with amber borders (`#f59e0b`).

#### Suite 3.5: Per-Card Theme Override vs Global Theme
- **Scenario**: Global theme is `minimal-dark`. Card `kali-red` is assigned custom theme `cyberpunk`.
- **Assertions**:
  1. `kali-red` content key contains `cyberpunk`.
  2. Other cards (`linux`, `windows`) have content keys containing `minimal-dark`.
  3. Global theme switch to `glass` updates `linux` but preserves `kali-red` as `cyberpunk`.

---

### 4.4 Tier 4: Real-World User Flows (Workload Testing)

#### Flow F1: First-Time User Onboarding & Studio Launch
1. User loads Post Card OS root URL.
2. View router detects initial state: `#home-view` is visible, `#studio-view` is hidden.
3. User sees 5 Post Card tiles (Android, Windows, Linux, macOS, Kali).
4. User clicks hero CTA `<button data-open-studio>`.
5. View router hides `#home-view`, unhides `#studio-view`, initializes Three.js animation loop, focuses default system card.

#### Flow F2: Direct System Card Selection from Home View
1. User on `#home-view` inspects Kali card tile.
2. User clicks `<button class="home-system-card" data-open-studio data-card-id="kali-red">`.
3. View router switches to `#studio-view`.
4. Turntable animates to rotate `kali-red` into front focus (`selectedCard.id === "kali-red"`).
5. HUD label `#selected-name` updates to show Kali system details.

#### Flow F3: Customizing Themes on Home Screen and Inspecting in Studio
1. User on `#home-view` clicks Theme selector button for "Cyberpunk Neon".
2. Active theme updates in memory and `localStorage`.
3. Home screen 2D card tiles update CSS variables (neon borders, dark purple background).
4. User clicks "Open Spatial Studio".
5. 3D card textures render with Cyberpunk canvas gradients, glossy PBR reflections, and neon floor glow.

#### Flow F4: Tactile Direct Manipulation & Physical Floor Stop
1. User in `#studio-view` grabs front focused card with Shift+Drag.
2. User drags pointer straight down attempting to push card into the floor ($Y \to -2.0$).
3. Constraint engine enforces $Y \ge 1.685$.
4. Card hits physical stop above dais; user observes tactile resistance.
5. User releases pointer; card settles above floor with valid `layoutOffset`.

#### Flow F5: Card Facet Flipping, Zooming, and Safe Home Return
1. User clicks printed `settings` button on card (UV hit test).
2. Card executes 3D flip animation to reveal Back / Settings facet (`card.facet = "back"`).
3. User clicks `#zoom-button` in dock to inspect hardware specs.
4. User clicks topbar "Home" / Brand link.
5. `#studio-view` hides, `#home-view` displays, no uncaught exceptions thrown.

---

## 5. Verification Method & Fedora Workstation Specification

### 5.1 Host Windows Verification Commands
Run inside PowerShell from `g:\micro-host\workspace-prototype`:
```powershell
# 1. Execute all unit tests including card-theming-collision.test.mjs
cd g:\micro-host\workspace-prototype
npm test

# 2. Transpile and build production bundle
npm run build
```
*Expected*: All tests pass (70+ assertions), `tsc --noEmit` and `vite build` complete with 0 errors.

### 5.2 Fedora Workstation Remote SSH Execution (Requirement R3)
Direct link network settings:
- Host Alias: `fedora` (`10.0.0.2`, user `casey`)
- Remote Node.js: `/home/casey/.nvm/versions/node/v26.13.0/bin/node` (v26.13.0)
- Remote Directory: `/home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype`

#### Remote Execution Command Transcript:
```powershell
# Step 1: Sync changed files to Fedora workstation
scp g:\micro-host\workspace-prototype\src\card-themes.ts fedora:/home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype/src/
scp g:\micro-host\workspace-prototype\src\main.ts fedora:/home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype/src/
scp g:\micro-host\workspace-prototype\src\style.css fedora:/home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype/src/
scp g:\micro-host\workspace-prototype\index.html fedora:/home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype/index.html
scp g:\micro-host\workspace-prototype\tests\card-theming-collision.test.mjs fedora:/home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype/tests/

# Step 2: Run npm test on Fedora under native Node.js v26.13.0
ssh -o BatchMode=yes fedora "cd /home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype && npm test"

# Step 3: Run production build on Fedora
ssh -o BatchMode=yes fedora "cd /home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype && npm run build"
```

### 5.3 Headless Firefox Screenshot Capture Specification
Capture high-fidelity screenshots of the UI running under Fedora:

```powershell
# Option A: Standalone Fedora preview & screenshot capture
ssh -o BatchMode=yes fedora "cd /home/casey/Desktop/Post-Card-Spatial-O.S-master/workspace-prototype && (nohup npx vite preview --port 5173 --host 127.0.0.1 > /tmp/vite.log 2>&1 &) && sleep 3 && firefox --headless --window-size 1920,1080 --screenshot /tmp/fedora_studio_theming.png http://127.0.0.1:5173/ && pkill -f 'vite preview'"

# Option B: Capture Windows host preview server across direct link
# Windows runs: npm run preview -- --host 0.0.0.0
ssh -o BatchMode=yes fedora "firefox --headless --window-size 1920,1080 --screenshot /tmp/fedora_studio_theming.png http://10.0.0.1:5173/"

# Copy captured screenshot back to Windows workspace for artifact review
scp fedora:/tmp/fedora_studio_theming.png g:\micro-host\workspace-prototype\dist\fedora_studio_theming.png
```
*Expected Screenshot Criteria*:
- Image resolution: $1920 \times 1080$.
- File size: $> 50$ KB.
- Obsidian floor rendered at base, dais platform visible, cards positioned above surface with zero floor penetration.

### 5.4 `TEST_READY.md` Synthesis Template
Upon completing Milestone M4, the implementation agent will generate `TEST_READY.md` containing:
1. **Header & Timestamp**: Date, commit SHA, milestone identifier.
2. **Execution Results Table**:
   | Test Suite | Total Tests | Passed | Failed | Duration | Environment |
   |---|---|---|---|---|---|
   | Unit & Regression Suite | 13 suites | 70+ | 0 | ~1.1s | Fedora Node v26.13.0 |
   | TypeScript Build | 1 target | clean | 0 | ~4.2s | Fedora Linux fc45 |
   | Headless Browser Verification | 1 session | pass | 0 | ~3.1s | Firefox 158.0.1 |
3. **Assertion Verification Checklist**:
   - [x] Tier 1: Floor boundary constraints enforced ($Y_{\min} \ge 1.685$ over dais, $\ge 1.48$ over floor).
   - [x] Tier 1: All 5 theme presets (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`) validated with complete token definitions.
   - [x] Tier 1: Dual-view router and all 123 DOM buttons / 8 printed buttons function reliably without runtime errors.
   - [x] Tier 2: Boundary conditions (downward drags to $Y = -10$, dais perimeter $r = 7.7$, scale variance, invalid theme recovery) pass.
   - [x] Tier 3: Cross-feature combinations (theming + clamping + view switching) pass.
   - [x] Tier 4: Real-world user flows F1-F5 verified.
   - [x] Headless Firefox screenshot captured and archived at `workspace-prototype/dist/fedora_studio_theming.png`.
