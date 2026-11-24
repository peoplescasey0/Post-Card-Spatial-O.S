# Panoramic Cockpit Arc, 6-Room Environments & 9-Dot Tactile Flip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a wide, panoramic cockpit spatial layout, 6 full-room 3D thematic environments with mix-and-match card styling, a 9-dot tactile card face flip matrix with diagonal compound flips, and interactive kernel patent diagnostic enclaves.

**Architecture:** Retune `carouselPoseFromAngle` to a wide concave cockpit arc while preserving continuous turntable inertia dragging and existing test assertions. Decouple 3D room environment definitions (`src/room-environments.ts`) from card canvas/PBR styling (`src/card-themes.ts`) and wire them to a two-axis inspector in the studio view. Add a 3x3 (9-dot) tactile flip matrix to `src/card-buttons.ts` and `src/main.ts`, unlocking compound diagonal corner flips into dedicated kernel patent enclaves (OmegaLog, DataMeld PVM, SLM tensor sharing, DIOV streams).

**Tech Stack:** TypeScript 5.9, Three.js 0.180.0, Vite 7, HTML5 Canvas 2D rasterization, Node test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-11-24-panoramic-cockpit-and-room-environments-design.md`

## Global Constraints

- Preserve dual-sided card materials (`side: THREE.DoubleSide`) and backface visibility without z-fighting.
- Respect `prefers-reduced-motion` settings for all card movements, camera transitions, and 9-dot flips.
- Maintain the constant dais floor collision height (`y = 0.105`) and `getFloorHeightAt()` clamping logic across all 6 room environments.
- Enforce the active guest cap (maximum 4 concurrent guests and 8 GiB total guest RAM).
- Keep `.home-theme-picker` on `#home-view` strictly containing the 5 canonical chips (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`) with `role="radio"` to satisfy existing DOM test invariants.
- Keep all 338 existing Node tests 100% passing across all test suites.

## Review Focus

- **Input/Condition 1:** Rapid wheel scrolling or 1:1 pointer dragging through the panoramic arc. *Expected:* Smooth continuous rotation without card-flipping jitter or NaN coordinates.
- **Input/Condition 2:** Switching room environments in rapid succession (e.g. from *Cyber Mainframe* to *Sunset Library* and back). *Expected:* Previous prop meshes and lights disposed/hidden cleanly without ghost monoliths or memory leaks.
- **Input/Condition 3:** Entering a custom Material You dynamic seed (`seed:#HEX`). *Expected:* Card style updates with calculated HCT tonal palettes, and room accent lighting smoothly retints without resetting the active room environment.
- **Input/Condition 4:** Clicking a corner dot on a card during reduced motion (`prefers-reduced-motion: 1`). *Expected:* Card snaps instantly to the compound diagonal facet without playing the 3D tumbling animation.
- **Input/Condition 5:** Triggering a simulated fault on Facet 07 (OmegaLog / Boot OROM). *Expected:* Checkpoint is registered and verification status updates on the card canvas without interrupting the active guest VM.

---

### Task 1: Panoramic Cockpit Arc Pose Math & Orbit Spacing

**Files:**
- Modify: `src/carousel-pose.ts`
- Test: `tests/carousel-pose.test.mjs`

**Interfaces:**
- Consumes: `CarouselPose { x: number; y: number; z: number; scale: number; }`
- Produces: `carouselPoseFromAngle(theta: number): CarouselPose` retuned for a wide, shallow concave arc with adjacent card scale >= 0.88, while satisfying existing assertions (`front.z > 2`, `right.x > 4`, `left.x < -4`, `rear.z < -4`, `front.scale - rear.scale >= 0.39`).

- [ ] **Step 1: Write the updated test assertions**

In `tests/carousel-pose.test.mjs`, add assertions verifying that the panoramic front arc (-Math.PI / 4 to Math.PI / 4) keeps cards wide and legible:
```javascript
test("panoramic front arc keeps adjacent cards wide and legible", () => {
  const front = carouselPoseFromAngle(0);
  const leftShoulder = carouselPoseFromAngle(-Math.PI / 4);
  const rightShoulder = carouselPoseFromAngle(Math.PI / 4);

  assert.ok(leftShoulder.scale >= 0.85, "Adjacent cards must maintain large readable scale");
  assert.ok(rightShoulder.scale >= 0.85, "Adjacent cards must maintain large readable scale");
  assert.ok(Math.abs(leftShoulder.x) > 3.0, "Shoulder cards must spread outward horizontally");
  assert.ok(Math.abs(rightShoulder.x) > 3.0, "Shoulder cards must spread outward horizontally");
  assert.ok(leftShoulder.z > 0.5, "Shoulder cards must remain forward in the cockpit arc");
  assert.ok(rightShoulder.z > 0.5, "Shoulder cards must remain forward in the cockpit arc");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/carousel-pose.test.mjs`  
Expected: FAIL (or pass check if tuning needed).

- [ ] **Step 3: Retune `carouselPoseFromAngle` in `src/carousel-pose.ts`**

Update `src/carousel-pose.ts` to implement the panoramic arc parameters:
```typescript
export function carouselPoseFromAngle(theta: number): CarouselPose {
  const depth = (1 + Math.cos(theta)) / 2;
  return {
    x: 4.85 * Math.sin(theta),
    y: 2.64 + (Math.cos(theta) - 1) * 0.32,
    z: 3.3 * Math.cos(theta) - 1.05,
    scale: 0.64 + depth * 0.4,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/carousel-pose.test.mjs`  
Expected: PASS across all assertions.

- [ ] **Step 5: Commit**

```bash
git add src/carousel-pose.ts tests/carousel-pose.test.mjs
git commit -m "feat(spatial): retune carouselPoseFromAngle to wide panoramic cockpit arc"
```

---

### Task 2: Room Environment Engine Catalog & Storage

**Files:**
- Create: `src/room-environments.ts`
- Create: `tests/room-environments.test.mjs`

**Interfaces:**
- Consumes: None.
- Produces:
  - `export const ROOM_ENVIRONMENT_IDS = ["pixel-studio", "sunset-library", "forest-emerald", "lavender-mist", "obsidian-monochrome", "cyber-mainframe"] as const;`
  - `export type RoomEnvironmentId = (typeof ROOM_ENVIRONMENT_IDS)[number];`
  - `export interface RoomEnvironmentDefinition { ... }`
  - `export function getRoomEnvironment(id: string): RoomEnvironmentDefinition`
  - `export function loadPersistedRoomEnvironment(): RoomEnvironmentId`
  - `export function persistRoomEnvironment(id: RoomEnvironmentId): void`

- [ ] **Step 1: Write the failing test**

Create `tests/room-environments.test.mjs`:
```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roomTs = fs.readFileSync(path.join(workspaceDir, "src", "room-environments.ts"), "utf-8");
const compiled = ts.transpileModule(roomTs, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  ROOM_ENVIRONMENT_IDS,
  getRoomEnvironment,
  loadPersistedRoomEnvironment,
  persistRoomEnvironment,
  DEFAULT_ROOM_ENVIRONMENT_ID,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("room environments catalog provides all 6 distinct environments with valid PBR and lighting schemas", () => {
  assert.equal(ROOM_ENVIRONMENT_IDS.length, 6);
  for (const id of ROOM_ENVIRONMENT_IDS) {
    const env = getRoomEnvironment(id);
    assert.equal(env.id, id);
    assert.ok(env.name);
    assert.ok(env.background.startsWith("#"));
    assert.ok(typeof env.floor.roughness === "number");
    assert.ok(typeof env.floor.metalness === "number");
    assert.ok(env.floor.color.startsWith("#"));
    assert.ok(env.lighting.keyColor.startsWith("#"));
    assert.ok(env.props);
  }
});

test("room environment persistence roundtrips through localStorage with fallback to default", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
  };

  assert.equal(loadPersistedRoomEnvironment(), DEFAULT_ROOM_ENVIRONMENT_ID);
  persistRoomEnvironment("sunset-library");
  assert.equal(loadPersistedRoomEnvironment(), "sunset-library");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/room-environments.test.mjs`  
Expected: FAIL (file does not exist).

- [ ] **Step 3: Implement `src/room-environments.ts`**

Define `ROOM_ENVIRONMENT_IDS`, `RoomEnvironmentDefinition`, catalog constants for all 6 themes (*pixel-studio*, *sunset-library*, *forest-emerald*, *lavender-mist*, *obsidian-monochrome*, *cyber-mainframe*), and localStorage helpers.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/room-environments.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/room-environments.ts tests/room-environments.test.mjs
git commit -m "feat(theming): add 6-room environment catalog and storage engine"
```

---

### Task 3: Three.js Room Environment Stage Transitions & Thematic Props

**Files:**
- Modify: `src/main.ts`
- Create: `tests/room-stage-integration.test.mjs`

**Interfaces:**
- Consumes: `getRoomEnvironment`, `loadPersistedRoomEnvironment`, `persistRoomEnvironment` from `src/room-environments.ts`.
- Produces: `applyRoomEnvironment(id: string): void` in `src/main.ts` that dynamically transitions Three.js background, fog, floor material, primary lights, and toggles prop groups (`cyber-monoliths`, `library-shelves`, `studio-frames`, `botanical-baffles`, `minimal`).

- [ ] **Step 1: Write the failing test**

Create `tests/room-stage-integration.test.mjs`:
```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");

test("main.ts imports room environments and defines applyRoomEnvironment", () => {
  assert.match(mainTs, /import\s*\{[^}]*getRoomEnvironment[^}]*\}\s*from\s*["']\.\/room-environments["']/);
  assert.match(mainTs, /function applyRoomEnvironment\(envId:\s*string\):\s*void/);
  assert.match(mainTs, /scene\.background\s*=/);
  assert.match(mainTs, /floor\.material/);
});

test("server monoliths and dais ticks are toggled conditionally based on room environment props", () => {
  assert.match(mainTs, /monolithBodyMat|towerGroup/);
  assert.match(mainTs, /env\.props\s*===\s*["']cyber-monoliths["']/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/room-stage-integration.test.mjs`  
Expected: FAIL.

- [ ] **Step 3: Implement `applyRoomEnvironment` in `src/main.ts`**

1. Group the monoliths, dais ticks, and observatory starfield into toggleable `THREE.Group`s.
2. Create lightweight procedural props for library shelving fins and studio frames.
3. Wire `applyRoomEnvironment(envId: string)` to swap floor PBR properties, lights, fog, clear color, and prop visibility.
4. Call `applyRoomEnvironment(loadPersistedRoomEnvironment())` at initialization.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/room-stage-integration.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main.ts tests/room-stage-integration.test.mjs
git commit -m "feat(spatial): integrate dynamic 3D room environment stage transitions in main.ts"
```

---

### Task 4: 9-Dot Tactile Card Face Flip Matrix & Diagonal Tumbles

**Files:**
- Modify: `src/card-buttons.ts`
- Modify: `src/main.ts`
- Create: `tests/card-9dot-flip.test.mjs`

**Interfaces:**
- Consumes: Card canvas dimensions (640x960), UV hit testing.
- Produces:
  - `FlipDotId` (`top-left`, `top-center`, `top-right`, `mid-left`, `center`, `mid-right`, `btm-left`, `btm-center`, `btm-right`).
  - `FLIP_DOT_LOCATIONS: Record<FlipDotId, { x: number; y: number; r: number }>`.
  - `hitFlipDot(u: number, v: number): FlipDotId | undefined`.
  - Compound 3D diagonal flip transitions in `src/main.ts` targeting Facets `patent-lab`, `slm-enclave`, `diov-streams`.

- [ ] **Step 1: Write the failing test**

Create `tests/card-9dot-flip.test.mjs`:
```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const btnTs = fs.readFileSync(path.join(workspaceDir, "src", "card-buttons.ts"), "utf-8");
const compiled = ts.transpileModule(btnTs, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { hitFlipDot, FLIP_DOT_LOCATIONS } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("9-dot matrix provides 9 tactile touchpoints covering corners, edges, and center", () => {
  const dotIds = Object.keys(FLIP_DOT_LOCATIONS);
  assert.equal(dotIds.length, 9);
  assert.ok(dotIds.includes("top-left"));
  assert.ok(dotIds.includes("top-right"));
  assert.ok(dotIds.includes("btm-left"));
  assert.ok(dotIds.includes("btm-right"));
  assert.ok(dotIds.includes("center"));
});

test("hitFlipDot resolves UV coordinates to correct tactile dot", () => {
  // top-left corner (u ~ 0.075, v ~ 0.95 in standard texture UV where v=1 is top)
  const dot = hitFlipDot(0.075, 0.95);
  assert.equal(dot, "top-left");

  // center (u ~ 0.5, v ~ 0.5)
  const centerDot = hitFlipDot(0.5, 0.5);
  assert.equal(centerDot, "center");
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/card-9dot-flip.test.mjs`  
Expected: FAIL.

- [ ] **Step 3: Implement `hitFlipDot` in `src/card-buttons.ts` and compound flips in `src/main.ts`**

1. In `src/card-buttons.ts`, add `FlipDotId`, `FLIP_DOT_LOCATIONS`, and `hitFlipDot`.
2. In `src/main.ts`:
   - Expand `CardFacet` with `"patent-lab" | "slm-enclave" | "diov-streams"`.
   - Update pointer-down hit-testing to check `hitFlipDot` when clicking on card edges/corners.
   - When a corner dot is clicked, trigger compound flip animation (`tiltX + tiltY`).
   - Draw the 9 subtle tactile rivet dots on the card canvas border.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/card-9dot-flip.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/card-buttons.ts src/main.ts tests/card-9dot-flip.test.mjs
git commit -m "feat(spatial): implement 9-dot card face tactile flip matrix and compound flips"
```

---

### Task 5: Patent Subsystem Diagnostic Enclaves & Test Triggers on Card Back / Facets

**Files:**
- Modify: `src/native-hud.ts`
- Modify: `src/main.ts`
- Create: `tests/patent-diagnostics-integration.test.mjs`

**Interfaces:**
- Consumes: `KernelTelemetryPacket` from `src/native-hud.ts`.
- Produces:
  - Extended `KernelTelemetryPacket.patent_engines` supporting `omega_log`, `point_isa_datameld`, `diov_streams`, `slm_sharing`, and `boot_orom`.
  - Diagnostic gauge canvas rasterizers for Facet `patent-lab` (07), `slm-enclave` (08), and `diov-streams` (09).
  - Interactive hitboxes on Facet 07: `[ Trigger OmegaLog Checkpoint ]` and `[ Inject ROM Fault ]`.

- [ ] **Step 1: Write the failing test**

Create `tests/patent-diagnostics-integration.test.mjs`:
```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hudTs = fs.readFileSync(path.join(workspaceDir, "src", "native-hud.ts"), "utf-8");
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");

test("native-hud.ts defines patent engines for OmegaLog, DataMeld PVM, SLM sharing, DIOV, and Boot OROM", () => {
  assert.match(hudTs, /omega_log\?:/);
  assert.match(hudTs, /point_isa_datameld\?:/);
  assert.match(hudTs, /diov_streams\?:/);
  assert.match(hudTs, /slm_sharing\?:/);
  assert.match(hudTs, /boot_orom\?:/);
});

test("main.ts renders patent enclaves on card diagnostic facets", () => {
  assert.match(mainTs, /drawPatentLabFacet|drawSlmEnclaveFacet|drawDiovStreamsFacet/);
  assert.match(mainTs, /OmegaLog UPG/);
  assert.match(mainTs, /Boot OROM Sandbox/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/patent-diagnostics-integration.test.mjs`  
Expected: FAIL.

- [ ] **Step 3: Implement patent telemetry schemas and diagnostic canvas rasterizers**

1. In `src/native-hud.ts`, add the patent subsystems to `KernelTelemetryPacket.patent_engines`.
2. In `src/main.ts`, implement drawing routines for the 3 diagnostic facets with live telemetry metrics, recovery charts, and clickable test trigger regions.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/patent-diagnostics-integration.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/native-hud.ts src/main.ts tests/patent-diagnostics-integration.test.mjs
git commit -m "feat(patent): add interactive patent diagnostic enclaves and test triggers on card facets"
```

---

### Task 6: Studio Two-Axis Mix-and-Match UI & Presets Sync

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`
- Modify: `src/style.css`
- Create: `tests/theme-mix-match-ui.test.mjs`

**Interfaces:**
- Consumes: `ROOM_ENVIRONMENT_IDS`, `CARD_THEME_IDS`, `ANDROID_THEME_IDS`, `applyRoomEnvironment`, `setCardTheme`.
- Produces: Studio Mix-and-Match Inspector in `#studio-view` (Quick Presets + Room Environment dropdown + Card Style dropdown) while preserving `#home-view`'s `.home-theme-picker` 5-chip structure untouched.

- [ ] **Step 1: Write the failing test**

Create `tests/theme-mix-match-ui.test.mjs`:
```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(workspaceDir, "index.html"), "utf-8");
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");

test("index.html contains studio mix-and-match inspector with room and card style controls", () => {
  assert.match(html, /id="studio-room-select"/);
  assert.match(html, /id="studio-card-theme-select"/);
  assert.match(html, /class="studio-preset-chip"/);
});

test("home view theme picker retains exactly 5 canonical chips with role='radio'", () => {
  assert.match(html, /<nav class="home-theme-picker"[^>]*>[\s\S]*data-card-theme="classic"[\s\S]*<\/nav>/);
});

test("main.ts wires studio theme inspector to applyRoomEnvironment and setCardTheme", () => {
  assert.match(mainTs, /studioRoomSelect\.addEventListener\("change"/);
  assert.match(mainTs, /studioCardThemeSelect\.addEventListener\("change"/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tests/theme-mix-match-ui.test.mjs`  
Expected: FAIL.

- [ ] **Step 3: Implement Studio Mix-and-Match Inspector**

1. In `index.html`, add `#studio-room-select`, `#studio-card-theme-select`, and quick preset chips inside the Studio View theme pulldown.
2. In `src/main.ts`, wire change listeners to call `applyRoomEnvironment` and `setCardTheme`.
3. In `src/style.css`, add clean styling for the two-axis dropdowns and preset chips.
4. Run full test suite to guarantee 0 regressions.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/theme-mix-match-ui.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Full verification across all test suites**

Run: `npm test`  
Expected: All tests pass (338+ passing, 0 failing).

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.ts src/style.css tests/theme-mix-match-ui.test.mjs
git commit -m "feat(ui): add studio two-axis mix-and-match theme inspector and curated presets"
```
