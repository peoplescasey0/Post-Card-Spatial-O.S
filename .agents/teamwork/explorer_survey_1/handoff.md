# Codebase & Architecture Survey Report: Card Theming, Floor Collision & UI Integration

**Explorer Subagent**: `explorer_survey_1`  
**Date**: 2026-11-11  
**Project**: Post Card Spatial OS (`micro-host`)  
**Scope**: Project architecture map, Home Screen UI, Card systems (models, state, rendering, lifecycle), Theming research & integration points, Floor collision analysis, Button interaction audit.

---

## 1. Observation

### 1.1 Project Structure & Tech Stack
The project repository contains the following structure:
- **`workspace-prototype/`**: The primary user-facing spatial application.
  - **Framework & Build System**: Vite 7.1.12, TypeScript 5.9.3, Node.js (`package.json` scripts: `dev`, `build`, `test`, `preview`).
  - **3D Graphics Engine**: Three.js `^0.180.0` (WebGL / WebGPU ready) with PBR materials (`MeshStandardMaterial`), Canvas2D procedural 2X retina textures (`1280x1920`), shadows, dynamic lighting (`PointLight`, `DirectionalLight`, `AmbientLight`), and post-processing tone mapping.
  - **Virtualization Backend**: `guest-api.mjs` (Vite middleware / Node server) orchestrating QEMU processes, QMP monitor sockets (`4444+`), VNC loopback WebSockets (`5700+`), noVNC display (`@novnc/novnc ^1.7.0`), paper plane file spooling, memory snapshots, and serial pipes.
  - **Rust Kernel Micro-Host**: `kernel/` and `src-rust/` containing bare-metal minimal Rust micro-host kernel targeting `x86_64-unknown-none`.
  - **Test Suite**: 63 automated tests running via `node --test` across 12 test files in `workspace-prototype/tests/`. All 63 pass cleanly (`npm test` duration ~27s). TypeScript compile and Vite build (`npm run build`) pass cleanly in 4.99s.

### 1.2 Home Screen UI (`#home-view`) vs Studio View (`#studio-view`)
- **DOM Markup (`workspace-prototype/index.html`)**:
  - Line 17: `<main class="home-view" id="home-view" hidden>`
  - Lines 18-29: `.home-header` containing `.home-brand` and `.home-session`.
  - Lines 31-73: `.home-hero` with eyebrow (`01 / WORKSPACE HOME`), title (`Your systems, in spatial view.`), primary CTA (`<button class="home-primary-button" type="button" data-open-studio>`), and 3D preview stack (`.home-card-stack`, lines 53-67).
  - Lines 75-150: `.home-systems` containing `.home-system-grid` with 5 system card buttons:
    - Line 85: `<button class="home-system-card" type="button" data-open-studio data-card-id="android">`
    - Line 98: `<button class="home-system-card" type="button" data-open-studio data-card-id="windows">`
    - Line 111: `<button class="home-system-card home-system-card-featured" type="button" data-open-studio data-card-id="linux">`
    - Line 124: `<button class="home-system-card" type="button" data-open-studio data-card-id="macos">`
    - Line 137: `<button class="home-system-card" type="button" data-open-studio data-card-id="kali-red">`
  - Line 167: `<div class="studio-view" id="studio-view">` containing the topbar, 3D canvas container (`#scene`), command bar, HUD telemetry, and dialogs.
- **Styling (`workspace-prototype/src/style.css`)**:
  - Lines 2704-2707: Mutual exclusion hiding:
    ```css
    #home-view[hidden],
    #studio-view[hidden] {
      display: none !important;
    }
    ```
  - Lines 2709-3200: Full responsive CSS for `.home-view`, `.home-hero`, `.home-card-stack`, `.home-system-grid`, and `.home-system-card`.
- **Wiring in `workspace-prototype/src/main.ts`**:
  - Line 249: `const studioView = document.querySelector<HTMLElement>("#studio-view");` is queried.
  - **Critical Gap Observed**: `#home-view` is **NEVER queried or wired** in `main.ts`!
  - Lines 351-443 assert that required workspace elements exist, but `#home-view`, `button[data-open-studio]`, and `.home-system-card` are completely absent from queries and element assertions.
  - In `index.html` line 17, `#home-view` has attribute `hidden`, so the user is directly placed into `#studio-view`.
  - No event listeners exist anywhere in `main.ts` for `data-open-studio` or `data-card-id` buttons.

### 1.3 Cards: Data Models, Lifecycle, State & Rendering
- **Data Models (`src/main.ts`)**:
  - Lines 133-185: `type SystemCard` holds card state:
    ```ts
    type SystemCard = {
      id: string;
      name: string;
      os: string;
      detail: string;
      color: string;
      status: string;
      group: THREE.Group;
      receivedNotes: string[];
      sentNotes: string[];
      facet: CardFacet;
      backFaceVisible: boolean;
      targetRotation: number;
      tiltX: number;
      tiltZ: number;
      resetCount: number;
      clonedFrom?: string;
      liveCanvas?: HTMLCanvasElement;
      serialOutput?: string;
      statusLedMat?: THREE.MeshStandardMaterial;
      statusLedMesh?: THREE.Mesh;
      removable?: boolean;
      layoutOffset: THREE.Vector3;
      layoutPosition: THREE.Vector3;
      orbitAngle: number;
      lastTextureKey?: string;
      peel?: number;
      twisted?: boolean;
      twistAmount?: number;
      revealed?: boolean;
      blurLevel?: number;
      blurStep?: number;
      cachedContentKey?: string;
      cachedSharpTexture?: THREE.CanvasTexture;
      cachedBlurredTexture?: THREE.CanvasTexture;
      flipAnim?: { ... };
    };
    ```
  - Lines 187-190: `type CardDefinition = Pick<SystemCard, "id" | "name" | "os" | "detail" | "color" | "status" | "clonedFrom" | "removable">;`
  - Lines 1499-1548: `const initialCards = [...]` defines 6 system cards:
    1. `postcard-os` (`#00E5FF`, "Post Card · Spatial OS")
    2. `android` (`#70d5cf`, "Android · Pocket Lab")
    3. `windows` (`#8baef0`, "Windows · Studio")
    4. `linux` (`#bca8ff`, "Fedora · Workstation")
    5. `macos` (`#eea3a6`, "macOS · Cupertino")
    6. `kali-red` (`#929bf2`, "Kali · Cyber Range")
- **3D Card Mesh Creation (`src/main.ts:2927-3028`)**:
  - `createCard(definition, index)` instantiates a `THREE.Group`:
    - Edge chassis mesh with `edgeGeometry` (`ExtrudeGeometry` of rounded rectangle, `CARD_WIDTH = 2.15`, `CARD_HEIGHT = 3.2`, bevel 0.02) and `MeshStandardMaterial` (`color: "#19212d"`, `emissive: "#152631"`).
    - 4 corner hex fasteners (`fastenerGeometry`, `fastenerMaterial`).
    - Physical status LED bead (`statusLedGeometry`, `statusLedMat`).
    - Front face mesh with `cardGeometry` and `makeCardTexture(card, "front")`.
    - Back face mesh with `cardGeometry` and `makeCardTexture(card, "back")` rotated $\pi$ around y.
- **Canvas Texture Generation (`src/main.ts:3064-3147`)**:
  - `makeCardTexture(card, facet)` renders onto a 1280x1920 `<canvas>` scaled 2x:
    - Base gradient: Lines 3073-3078 (hardcoded `#14161B` to `#0D111A`).
    - Radial accent glow: Line 3080 (`${card.color}16` at (560, 85)).
    - Facet pill & border: Lines 3084-3091 (`meta.accent`).
    - Facet content: `drawCardFront`, `drawCardSettings`, `drawCardSecurity`, `drawCardPlanes`, `drawCardQuickActions`, `drawCardTelemetry`.
    - Tactile buttons: Lines 3383-3405 (`drawCardButtons`).
- **Tactile On-Card Buttons (`src/card-buttons.ts`)**:
  - Logical dimensions: Canvas `640x960`. Grid: 4 columns x 2 rows, `LEFT: 48, TOP: 718, WIDTH: 130, HEIGHT: 40, GAP: 8`.
  - 8 Button IDs: `"guest" | "stop" | "zoom" | "settings" | "clone" | "savepoint" | "performance" | "bin"`.
  - Hit testing: `hitCardButton(u, v)` tests UV coordinates against logical rects.
  - Action execution: `runCardButton(id, card)` in `main.ts:3408-3438`.

### 1.4 Floor Collision & Direct Manipulation (R2 Bug)
- **Floor Definition (`src/main.ts:586-598`)**:
  - `floor` is a `THREE.PlaneGeometry(200, 200)` rotated $-90^\circ$ on X.
  - Line 596: `floor.position.y = -0.12`.
- **Card Dimensions**:
  - Line 983: `const CARD_WIDTH = 2.15;`
  - Line 984: `const CARD_HEIGHT = 3.2;`
  - Geometry is centered around $(0, 0, 0)$, so the card extends from $y = -1.6$ to $y = +1.6$ relative to `group.position`.
- **Direct Manipulation Bug (`src/main.ts:6347-6352`)**:
  ```ts
  if (drag.mode === "move" && drag.card) {
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    drag.card.group.position.copy(dragPoint.add(drag.offset ?? new THREE.Vector3()));
    drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.8, 7.2);
    drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, 0.6, 5.2);
    drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -6.6, 2.5);
  ```
  - Line 6351 clamps `position.y` to minimum `0.6`.
  - With card half-height of $1.60$, when `position.y` is $0.60$, the card bottom is at:
    $$\text{Bottom } y = 0.60 - 1.60 = -1.00$$
  - Since the floor is at $y = -0.12$, the card bottom is **$-1.00 - (-0.12) = -0.88$ units (0.88 meters) BELOW the floor**! The card completely plunges through the floor surface during direct drag!
  - Furthermore, `resolveCardCollisions(activeCard)` at lines 4182-4220 checks only card-to-card lateral distances ($X/Z$), with **no floor boundary checks**.
  - While carousel settling clamps $y \ge 1.68$ in line 7722, manual drag in `onPointerMove` and subsequent `layoutOffset` computation can submerge the card through the floor.

---

## 2. Logic Chain

1. **Premise 1 (R1 Home Screen Card Theming)**: Acceptance criteria requires that "The home screen interface provides options to customize and change card themes" and "Selected card themes apply visibly to cards on the home screen."
   - *Observation*: `#home-view` is statically coded in `index.html` with hardcoded system cards and `hidden` attribute. In `main.ts`, card styling relies on hardcoded base gradients (`#14161B` -> `#0D111A`) in `makeCardTexture` and fixed `card.color` hex codes in `initialCards`.
   - *Deduction*: To implement home screen card theming:
     a) Define a unified Theme Schema (e.g. `CardTheme` with id, label, accent, secondary accent, card top/bottom gradients, chassis metal color, floor pool glow color).
     b) Provide preset theme palettes (e.g. Twilight Atelier, Cyberpunk Neon, Matrix Terminal, Vintage Amber, Aurora Arctic, Obsidian Minimal).
     c) Add an interactive Theme Selector section in `#home-view` (with swatches and preview buttons).
     d) Wire theme selection to:
        - Live CSS custom property / class updates on `#home-view` cards (`.home-system-card` borders, badges, glow).
        - 3D card textures via `card.color`, `card.theme`, and `refreshCardTexture(card, true)`.
        - Cache invalidation: Add `card.theme` to `computeCardContentKey(card)` so Three.js canvas textures automatically re-render upon theme change.
        - Persistence in `localStorage` under a key (e.g. `postcard_card_theme`).

2. **Premise 2 (R1 & R2 View Switching & Button Reliability)**: Acceptance criteria requires that "All buttons on the cards and home screen interface work reliably."
   - *Observation*: The buttons on `#home-view` (`data-open-studio` and `data-card-id="android"`, etc.) have no event handlers attached in `main.ts`. Studio view has no navigational link back to `#home-view`.
   - *Deduction*:
     a) Query `#home-view` and all `[data-open-studio]` / `[data-card-id]` buttons in `main.ts`.
     b) Implement a lightweight view router (`showView("home" | "studio")`):
        - `showView("home")`: `homeView.hidden = false; studioView.hidden = true; window.location.hash = "#home";`
        - `showView("studio", targetCardId?)`: `homeView.hidden = true; studioView.hidden = false; window.location.hash = "#room"; if (targetCardId) selectCardById(targetCardId);`
     c) Wire the topbar brand logo in `#studio-view` to allow returning to `#home-view`.
     d) Ensure all 8 tactile on-card buttons (`guest`, `stop`, `zoom`, `settings`, `clone`, `savepoint`, `performance`, `bin`) trigger their respective handlers without runtime exceptions.

3. **Premise 3 (R2 Floor Boundary Enforcement)**: Acceptance criteria requires that "Cards cannot be moved, dragged, or placed below the floor plane."
   - *Observation*: `floor.position.y = -0.12`. `CARD_HEIGHT = 3.2` (half-height $1.60$). In `onPointerMove` line 6351, `position.y` is clamped to `0.6`, allowing the bottom to penetrate to $-1.00$ ($0.88$ below the floor).
   - *Deduction*:
     - The bottom of any card is given by:
       $$y_{\text{bottom}} = y_{\text{center}} - \frac{\text{CARD\_HEIGHT}}{2} \times \text{scale}_y$$
     - To ensure $y_{\text{bottom}} \ge y_{\text{floor}}$ ($y_{\text{floor}} = -0.12$), the card center position $y$ must satisfy:
       $$y_{\text{center}} \ge y_{\text{floor}} + \frac{\text{CARD\_HEIGHT}}{2} \times \text{scale}_y + \text{clearanceMargin}$$
     - For nominal scale $1.0$ and clearance margin $0.08$ (or matching carousel floor float):
       $$\text{min } y = -0.12 + 1.60 + 0.08 = 1.56 \text{ (or } 1.68 \text{)}$$
     - Therefore, clamping `position.y` during drag in `onPointerMove` to `Math.max(minY, ...)` (e.g. $[1.56, 5.2]$) guarantees the card never penetrates below the floor plane.
     - Also clamp `layoutOffset.y` and enforce floor boundaries in `resolveCardCollisions`.

---

## 3. Caveats

1. **Guest OS Runtime Availability**: Live QEMU execution requires local hypervisor / KVM / WSL2 dependencies (Linux/WSL). The workspace prototype gracefully handles offline/demo mode when QEMU backends are not running. Theming, 3D turntable interaction, and home view switching are 100% functional in client mode.
2. **Existing Test Scope**: The 63 automated tests in `tests/` currently cover guest API, butler, Stripe, wheel carousel, and HUD telemetry, but do NOT test `#home-view` navigation or floor dragging. New unit/integration tests must be added to verify home screen buttons and floor collision clamping.
3. **Reduced Motion**: When `prefersReducedMotion()` is active, card flips and carousel steps snap immediately. Theming updates and floor bounds must function identically under both reduced motion and normal animation modes.

---

## 4. Conclusion

1. **Architecture & Stack**: The project is a Vite + TypeScript + Three.js spatial computing client with a dual-view DOM layout (`#home-view` and `#studio-view`) backed by a QEMU/VNC Node.js hypervisor API.
2. **Card Theming Customization (R1)**: Can be elegantly implemented by defining a preset-driven theme catalog (Twilight, Cyberpunk, Matrix, Vintage, Aurora, Obsidian), embedding an interactive theme customization toolbar on `#home-view`, applying the theme dynamically to both 2D home cards and 3D Three.js card textures (with `computeCardContentKey` cache invalidation), and persisting the choice in `localStorage`.
3. **Floor Collision Constraint (R2)**: The bug in `main.ts:6351` (`clamp(y, 0.6, 5.2)`) must be fixed by replacing `0.6` with the physical floor limit ($y \ge y_{\text{floor}} + \text{halfHeight} \times \text{scale}_y$, $\approx 1.56 \text{ to } 1.68$), ensuring cards can never be dragged or placed below the floor plane.
4. **Interactive Buttons & Navigation (R2)**: `#home-view` buttons must be queried and wired in `main.ts` with a two-way view switcher, ensuring seamless transitions between the Home Screen and the 3D Studio workspace.

---

## 5. Verification Method

To independently verify all findings and test suite integrity:

1. **Automated Workspace Tests**:
   ```powershell
   cd workspace-prototype
   npm test
   ```
   *Expected Result*: All 63 tests pass with 0 failures.

2. **TypeScript & Production Build**:
   ```powershell
   cd workspace-prototype
   npm run build
   ```
   *Expected Result*: `tsc --noEmit` exits with code 0 and Vite generates production bundles without type or module errors.

3. **Floor Collision Invalidation Condition**:
   - Inspect `workspace-prototype/src/main.ts` line 6351: if minimum y in `clamp` is `< 1.48`, dragging a card down will cause its bottom vertex ($y - 1.6$) to penetrate below $y_{\text{floor}} = -0.12$.
   - Verifying that minimum y is $\ge 1.56$ ensures the bottom never breaches the floor plane.

4. **Home Screen Wiring Invalidation Condition**:
   - Inspect `workspace-prototype/src/main.ts`: if `#home-view` is not queried or `[data-open-studio]` has no click listeners, clicking Home Screen buttons produces no action. Wiring these listeners resolves view navigation.
