# Interface & Implementation Investigation Report: Card Theming, Floor Collision & UI Integration

**Explorer Subagent**: `teamwork_explorer_m4_2` (Interface & Implementation Explorer)  
**Date**: 2026-11-11  
**Project**: Post Card Spatial OS (`micro-host`)  
**Parent Task**: Milestone M4 (E2E Testing & System Polish)  
**Scope**: Exact interfaces, exports, functions, formulas, DOM elements, and testability across Milestones M1–M3 in preparation for `card-theming-collision.test.mjs`.

---

## 1. Observation

### 1.1 Floor & Dais Geometry (Physical Boundary Constraints)
Directly inspected in `workspace-prototype/src/main.ts`:
- **Floor Plane Mesh (lines 586–598)**:
  ```typescript
  // Specular Obsidian Floor (Pillar 1 Atmosphere)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({
      color: "#070b14",
      roughness: 0.16,
      metalness: 0.88,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.12;
  floor.receiveShadow = true;
  scene.add(floor);
  ```
  - Orientation: Horizontal plane ($XZ$ plane) rotated $-90^\circ$ around $X$ (normal $(0, 1, 0)$).
  - Elevation: $Y_{\text{floor}} = -0.12$.
- **Studio Dais Platform Mesh (lines 791–802)**:
  ```typescript
  const dais = new THREE.Mesh(
    new THREE.CylinderGeometry(7.7, 8.05, 0.2, 96, 1, false),
    new THREE.MeshStandardMaterial({
      color: "#0a101f",
      metalness: 0.84,
      roughness: 0.22,
    }),
  );
  dais.position.set(0, -0.015, -0.25);
  dais.receiveShadow = true;
  dais.castShadow = true;
  scene.add(dais);
  ```
  - Geometry: Cylinder with top radius $7.7$, bottom radius $8.05$, height $0.2$, centered at $(0, -0.015, -0.25)$.
  - Dais Surface Height: $Y_{\text{dais}} = -0.015 + \frac{0.2}{2} = +0.085$.
  - Dais Top Surface Radius: $R_{\text{dais}} = 7.7$ (radius squared $R_{\text{dais}}^2 = 59.29$).
  - Dais Center in $XZ$ Plane: $(X_0, Z_0) = (0, -0.25)$.
- **Card Geometry & Dimensions (lines 983–1013, 2909–2925)**:
  - `CARD_WIDTH = 2.15;`
  - `CARD_HEIGHT = 3.2;`
  - Pivot Point: The geometry is created via `roundedRectangle(CARD_WIDTH, CARD_HEIGHT, 0.13)` where vertices extend from $-width/2$ to $+width/2$ and $-height/2$ to $+height/2$. The card group origin $(0, 0, 0)$ is situated exactly at the geometric center of the card.
  - Card half-height: $H / 2 = 1.60$.
  - Nominal Card Bottom: $Y_{\text{bottom}} = Y_{\text{center}} - 1.60 \cdot \text{scale}_y$.

### 1.2 Direct Drag Defect & Secondary Collision Sites
Directly inspected in `workspace-prototype/src/main.ts`:
- **Defect in `onPointerMove` Direct Drag (lines 6347–6352)**:
  ```typescript
  if (drag.mode === "move" && drag.card) {
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    drag.card.group.position.copy(dragPoint.add(drag.offset ?? new THREE.Vector3()));
    drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.8, 7.2);
    drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, 0.6, 5.2);
    drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -6.6, 2.5);
  ```
  - Line 6351 clamps `position.y` to a minimum of `0.6`.
  - With card half-height of $1.60$, when `position.y = 0.6`, the bottom of the card is at:
    $$Y_{\text{bottom}} = 0.60 - 1.60 = -1.00$$
  - Since the floor is at $Y_{\text{floor}} = -0.12$, the card bottom penetrates:
    $$-0.12 - (-1.00) = 0.88 \text{ units (88 cm) below the floor!}$$
- **Secondary Collision Handling in `resolveCardCollisions` (lines 4182–4220)**:
  - Resolves only $X$ and $Z$ separation (`minSepX = 2.48`, `minSepZ = 0.72`).
  - Completely omits $Y$ floor clamping, allowing lateral displacement during collision resolution to push cards below ground if previously depressed.
- **Drop and Offset Calculation in `onPointerUp` (lines 6446–6453)**:
  - Calculates `layoutOffset.copy(completedDrag.card.group.position).sub(wheelPosition(...))` without clamping against the floor plane.
- **Turntable Animation Loop in `animate` (lines 7586, 7718–7722)**:
  - Line 7586 skips dragged cards from vertical damping: `if (drag?.card === card && drag.mode === "move") continue;`.
  - Line 7722 applies a static clamp: `card.group.position.y = Math.max(card.group.position.y, 1.68);`, which does not account for whether the card is over the dais ($+0.085$) or outside the dais on the floor ($-0.12$), nor dynamic scaling (e.g. twisted cards with scale $1.18$).

### 1.3 Card Theming Tokens & Presets Architecture
- Currently, `workspace-prototype/src/card-themes.ts` is not yet present on disk.
- In `workspace-prototype/src/main.ts`:
  - Lines 3073–3078 in `makeCardTexture`: The background gradient is hardcoded to `#14161B` -> `#0D111A`.
  - Lines 3088–3091: Border is hardcoded to `${meta.accent}55`.
  - Lines 3394–3400 in `drawCardButtons`: Button fill is hardcoded to `#07090ee8` and border to `${accent}b0`.
  - Lines 2991–3016: Mesh material is hardcoded to `roughness: 0.88`, `metalness: 0.02`, `emissive: "#ffffff"`, `emissiveIntensity: 0.82`.
  - Lines 4634–4670: `computeCardContentKey(card)` does **not** include any theme identifier. As a result, switching themes does not invalidate the canvas texture cache in `refreshCardTexture`.
- `PROJECT.md` and `sub_orch_theming/SCOPE.md` define the agreed-upon contract:
  - 5 Theme Presets: `"classic"`, `"cyberpunk"`, `"minimal-dark"`, `"glass"`, `"material-vibrant"`.
  - Storage key: `localStorage` item `"postcard_studio_card_theme"`.
  - Default theme: `"classic"`.

### 1.4 DOM Elements, View Toggles & Button Audit
Directly inspected in `workspace-prototype/index.html` and `src/style.css`:
- **Dual-View DOM Structure (`index.html`)**:
  - Line 17: `<main class="home-view" id="home-view" hidden>`
  - Lines 39–45:
    ```html
    <button class="home-primary-button" type="button" data-open-studio>
      <span>Open Spatial Studio</span>
      <span class="home-button-arrow" aria-hidden="true">↗</span>
    </button>
    ```
  - Lines 85, 98, 111, 124, 137: 5 system card launch buttons:
    - `button.home-system-card[data-open-studio][data-card-id="android"]`
    - `button.home-system-card[data-open-studio][data-card-id="windows"]`
    - `button.home-system-card.home-system-card-featured[data-open-studio][data-card-id="linux"]`
    - `button.home-system-card[data-open-studio][data-card-id="macos"]`
    - `button.home-system-card[data-open-studio][data-card-id="kali-red"]`
  - Line 167: `<div class="studio-view" id="studio-view">`
- **View Toggling Rules in `src/style.css`**:
  - Lines 2704–2707:
    ```css
    #home-view[hidden],
    #studio-view[hidden] {
      display: none !important;
    }
    ```
  - **Defect in lines 3516–3519**:
    ```css
    /* Twilight orbital atelier: the room is the home screen. */
    #home-view {
      display: none !important;
    }
    ```
    This blanket rule overrides all view switching, forcing `#home-view` to remain hidden even when the `hidden` attribute is removed.
- **Button Interactivity Defect in `src/main.ts:3362`**:
  ```typescript
  const hasDisk =
    os === "windows"
      ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
        (/^windows[-_]/.test(card.id) && (status?.installedWindowsCardIds?.includes("windows") ?? false))
      : (status?.preparedCardIds.includes(card.id) ?? false);
  ```
  If `status` is defined but does not contain `preparedCardIds` (e.g. offline/mock response), `status?.preparedCardIds.includes(...)` throws:
  `TypeError: Cannot read properties of undefined (reading 'includes')`.

---

## 2. Logic Chain

### 2.1 Floor Boundary Clamping Logic
1. **Surface Height Determination**:
   - The ground consists of two distinct regions:
     a) Dais cylinder with center $(X_0, Z_0) = (0, -0.25)$ and radius $R = 7.7$.
     b) Obsidian floor plane extending everywhere else at $Y = -0.12$.
   - Any point $(x, z)$ lies on the dais if:
     $$(x - 0)^2 + (z - (-0.25))^2 \le 7.7^2 \iff x^2 + (z + 0.25)^2 \le 59.29$$
   - Thus, the surface height function is:
     ```typescript
     export const FLOOR_Y = -0.12;
     export const DAIS_SURFACE_Y = 0.085;
     export const DAIS_CENTER_Z = -0.25;
     export const DAIS_RADIUS = 7.7;
     export const DAIS_RADIUS_SQ = 7.7 * 7.7; // 59.29

     export function getFloorHeightAt(x: number, z: number): number {
       const dx = x;
       const dz = z - DAIS_CENTER_Z;
       return dx * dx + dz * dz <= DAIS_RADIUS_SQ ? DAIS_SURFACE_Y : FLOOR_Y;
     }
     ```
2. **Minimum Card Center Height**:
   - For an upright card of nominal height $H = 3.2$ and scale $s_y$, the distance from center to bottom is $(H / 2) \cdot s_y = 1.6 \cdot s_y$.
   - To guarantee that no vertex penetrates the surface, the center $Y$ must satisfy:
     $$Y_{\text{center}} \ge Y_{\text{surface}}(x, z) + \frac{H}{2} \cdot s_y$$
   - Over the dais ($+0.085$): $Y_{\text{center}} \ge 0.085 + 1.60 = 1.685$.
   - Over the floor ($-0.12$): $Y_{\text{center}} \ge -0.12 + 1.60 = 1.480$.
3. **Robust Bounding Box Enforcement (`THREE.Box3`)**:
   - Cards can rotate ($X, Y, Z$ rotations) and tilt during drags (e.g. `tiltZ = 0.22` over the paper bin) or scale up when twisted ($1.18 \times \text{peelScale}$).
   - Analytical bounding on center $Y$ alone does not account for corner vertices rotating downward.
   - Therefore, `clampCardAboveFloor(card: SystemCard)` must measure the true world-space Axis-Aligned Bounding Box (AABB) using `THREE.Box3().setFromObject(card.group)`:
     ```typescript
     const floorBoxHelper = new THREE.Box3();

     export function clampCardAboveFloor(card: SystemCard): void {
       floorBoxHelper.setFromObject(card.group);
       const currentBottom = floorBoxHelper.min.y;
       const targetFloor = getFloorHeightAt(card.group.position.x, card.group.position.z);
       if (currentBottom < targetFloor) {
         card.group.position.y += (targetFloor - currentBottom);
       }
     }
     ```
4. **Integration Sites in `main.ts`**:
   - `onPointerMove`: Replace `clamp(y, 0.6, 5.2)` with dynamic `minCenterY = getFloorHeightAt(x, z) + halfHeight * scaleY` followed by `clampCardAboveFloor(drag.card)`.
   - `resolveCardCollisions`: Call `clampCardAboveFloor(cardA)` and `clampCardAboveFloor(cardB)` during pairwise separation.
   - `onPointerUp`: Apply `clampCardAboveFloor(completedDrag.card)` before computing `layoutOffset`.
   - `animate`: Call `clampCardAboveFloor(card)` after vertical damping or snap.

### 2.2 Card Theming Architecture & Contract
1. **Theme Schema (`CardThemeDefinition`)**:
   A comprehensive token model covering canvas 2D rendering, Three.js 3D physical materials, and spatial lighting:
   ```typescript
   export type CardThemeId = "classic" | "cyberpunk" | "minimal-dark" | "glass" | "material-vibrant";

   export interface CardThemeDefinition {
     id: CardThemeId;
     name: string;
     description: string;
     canvas: {
       bgTop: string;
       bgBottom: string;
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
     };
     material: {
       roughness: number;
       metalness: number;
       emissive: string;
       emissiveIntensity: number;
     };
     lighting: {
       haloColor: string;
       haloIntensity: number;
       floorGlowColor: string;
       floorGlowIntensity: number;
     };
   }
   ```
2. **The 5 Concrete Presets**:
   - **`classic`**: Slate cardstock (`#14161b` -> `#0d111a`), cyan accent (`#70d5cf`), matte texture (`roughness: 0.88`, `metalness: 0.02`).
   - **`cyberpunk`**: Midnight obsidian (`#0b0416` -> `#05020a`), neon magenta/cyan dual stroke (`#ff007f` / `#00f0ff`), high emissive glow (`roughness: 0.25`, `metalness: 0.70`, `emissive: "#ff007f"`, `emissiveIntensity: 0.95`).
   - **`minimal-dark`**: AMOLED black (`#050505` -> `#000000`), micro-thin zinc border (`#27272a`), muted silver typography (`#a1a1aa`, pure matte `roughness: 0.96`, `metalness: 0.0`).
   - **`glass`**: Translucent ice-acrylic gradient (`rgba(26, 38, 57, 0.75)` -> `rgba(13, 20, 32, 0.85)`), crystal specular highlight, cyan halo (`roughness: 0.15`, `metalness: 0.10`).
   - **`material-vibrant`**: Android Expressive dark indigo surface (`#181124` -> `#0e0918`), amber and violet accents (`#f59e0b` / `#8b5cf6`), satin tactile finish (`roughness: 0.65`, `metalness: 0.15`).
3. **Texture Invalidation & Persistence**:
   - `computeCardContentKey(card)` must include `card.theme ?? activeCardThemeId`.
   - Theme switching writes to `localStorage.setItem("postcard_studio_card_theme", themeId)` and calls `refreshCardTexture(card, true)` across all active cards.

### 2.3 View Router & Button Wiring
1. **CSS Fix**:
   - Remove lines 3516–3519 (`#home-view { display: none !important; }`) from `src/style.css`.
   - Retain mutual-exclusion rules in lines 2704–2707 (`#home-view[hidden], #studio-view[hidden] { display: none !important; }`).
2. **Navigation Implementation in `src/main.ts`**:
   ```typescript
   function showStudio(cardId?: string): void {
     if (homeView) homeView.hidden = true;
     if (studioView) studioView.hidden = false;
     if (cardId) {
       const target = cards.find((c) => c.id === cardId);
       if (target) selectCard(target, true);
     }
     window.location.hash = "#studio";
   }

   function showHome(): void {
     if (studioView) studioView.hidden = true;
     if (homeView) homeView.hidden = false;
     window.location.hash = "#home";
   }
   ```
3. **Listener Binding**:
   - Bind click listeners to all `[data-open-studio]` elements to invoke `showStudio(btn.dataset.cardId)`.
   - Bind studio brand logo / topbar home link to invoke `showHome()`.
   - Bind `window.addEventListener("hashchange", ...)` to keep view state synchronized with the URL hash.
4. **Button Interactivity Bug Fix**:
   - Change line 3362 from `(status?.preparedCardIds.includes(card.id) ?? false)` to `(status?.preparedCardIds?.includes(card.id) ?? false)`.

---

## 3. Caveats

1. **Node.js Test Runner Execution Environment**:
   - `main.ts` executes browser DOM queries (`document.querySelector`, `window.addEventListener`) and Three.js WebGL initialization at module evaluation time.
   - Therefore, `card-theming-collision.test.mjs` must not directly `import "../src/main.ts"` without mocking or extracting pure functions.
   - Pure modules (like `src/card-themes.ts`, `src/carousel-pose.ts`, `src/card-buttons.ts`) can be imported directly or transpiled on-the-fly with `ts.transpileModule`.
   - Floor geometry math and clamping logic can be verified by importing `three` (installed in `workspace-prototype/node_modules/three`), executing the mathematical formulas directly, and using regex/AST assertions to verify their presence in `main.ts`.
2. **Headless Browser GPU Capabilities**:
   - Remote headless Firefox on Fedora renders DOM, SVG, and CSS glassmorphism accurately. WebGL 3D rendering uses Mesa software rasterization (llvmpipe/swrast), which was verified functional, but produces software-rasterized frames.
3. **Twisted Card Scaling**:
   - Twisted cards scale up by $1.18 \times \text{peelScale}$. Floor clamping logic using `Box3` automatically accounts for this scale factor without hardcoded magic numbers.

---

## 4. Conclusion

### 4.1 Specification of `workspace-prototype/src/card-themes.ts`
The module must export:
```typescript
export type CardThemeId = "classic" | "cyberpunk" | "minimal-dark" | "glass" | "material-vibrant";
export interface CardThemeDefinition { ... }
export const CARD_THEME_IDS: readonly CardThemeId[] = ["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"];
export const CARD_THEMES: Record<CardThemeId, CardThemeDefinition>;
export const DEFAULT_CARD_THEME_ID: CardThemeId = "classic";
export const CARD_THEME_STORAGE_KEY = "postcard_studio_card_theme";
export function getCardTheme(id: string): CardThemeDefinition;
export function isValidCardThemeId(id: unknown): id is CardThemeId;
```

### 4.2 Floor Collision Formulas & Constants
- `FLOOR_Y = -0.12`
- `DAIS_SURFACE_Y = 0.085`
- `DAIS_CENTER_Z = -0.25`
- `DAIS_RADIUS = 7.7`
- `getFloorHeightAt(x, z)`: returns `0.085` if $x^2 + (z + 0.25)^2 \le 59.29$, else `-0.12`.
- `minCardCenterY(scale = 1.0, surfaceY = -0.12)`: returns $\text{surfaceY} + 1.6 \cdot \text{scale}$.
- `clampCardAboveFloor(card: SystemCard)`: checks `THREE.Box3().setFromObject(card.group).min.y` and elevates `card.group.position.y` if below `getFloorHeightAt(x, z)`.

### 4.3 DOM & CSS Elements
- Delete `#home-view { display: none !important; }` in `src/style.css:3516-3519`.
- Retain `#home-view[hidden], #studio-view[hidden] { display: none !important; }` in `src/style.css:2704-2707`.
- Query `document.querySelectorAll("[data-open-studio]")` and attach click handlers calling `showStudio(btn.dataset.cardId)`.
- Fix optional chaining in `src/main.ts:3362` (`status?.preparedCardIds?.includes`).

### 4.4 Test Strategy for `card-theming-collision.test.mjs`
Structure the test into 4 clear suites:
1. **Theming Tokens & Catalog**: Transpile and dynamically import `src/card-themes.ts`, verify all 5 presets, token keys, fallback behavior, and `computeCardContentKey` inclusion.
2. **Floor Collision & Dais Geometry**: Import `three`, test `getFloorHeightAt` across dais center, dais rim boundary, and outer floor. Verify that simulated card meshes clamped with `clampCardAboveFloor` never penetrate $Y < -0.12$ (floor) or $Y < 0.085$ (dais).
3. **DOM Elements & CSS Rules**: Assert that `index.html` contains `#home-view`, `.home-primary-button[data-open-studio]`, 5 `.home-system-card` elements, and theme selector markup. Assert that `style.css` does not suppress `#home-view`.
4. **Button Interactivity & Crash Safety**: Verify optional chaining safety on `status?.preparedCardIds?.includes` and audit that on-card buttons execute without errors.

---

## 5. Verification Method

### 5.1 Automated Unit Test Execution
Execute in PowerShell:
```powershell
cd g:\micro-host\workspace-prototype
npm test
```
*Verification criteria*: All existing 63 tests pass, plus all new test assertions in `tests/card-theming-collision.test.mjs`.

### 5.2 TypeScript Build & Transpilation Check
```powershell
cd g:\micro-host\workspace-prototype
npm run build
```
*Verification criteria*: `tsc --noEmit` and Vite bundling exit with code 0.

### 5.3 Invalidation Conditions
- Any coordinate $(x, y, z)$ where a card's bottom vertex has $y < -0.12$ outside the dais or $y < +0.085$ over the dais.
- Any theme ID other than the 5 defined presets causing undefined errors or missing CSS/canvas tokens.
- Any click on a `[data-open-studio]` button that fails to reveal `#studio-view` or throws a runtime error.
- Any `TypeError` when accessing `status?.preparedCardIds` when `preparedCardIds` is undefined.
