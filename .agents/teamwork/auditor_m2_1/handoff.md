# Forensic Audit Report: Milestone M2 (Card Interaction and Floor Collision Polish)

**Auditor**: Forensic Auditor (`auditor_m2_1`)  
**Role**: Forensic Integrity Auditor & Adversarial Critic  
**Working Directory**: `g:\micro-host`  
**State Folder**: `g:\micro-host\.agents\teamwork\auditor_m2_1\`  
**Target**: Milestone M2 (Card Interaction and Floor Collision Polish)  
**Date**: 2026-11-11  

---

## Forensic Audit Summary

**Work Product**: Milestone M2 Code Changes in `workspace-prototype/` (`src/main.ts`, `src/style.css`, `index.html`, `tests/card-theming-collision.test.mjs`)  
**Profile**: General Project (Development Mode, per `ORIGINAL_REQUEST.md` line 7)  
**Verdict**: **CLEAN**  

### Phase Results
- **Hardcoded test results**: **PASS** — No hardcoded test bypasses, tautological assertions (`assert.ok(true)`), or skipped suites (`.skip()`, `.todo()`) exist in `tests/card-theming-collision.test.mjs`.
- **Facade detection**: **PASS** — Physics algorithms in `getFloorHeightAt`, `getCardHalfHeightExtent`, and `clampCardAboveFloor` implement genuine 3D OBB computational geometry and piecewise collision mathematics, not dummy facades.
- **Pre-populated artifacts**: **PASS** — Workspace search revealed zero pre-existing test logs, attestation artifacts, or fabricated output caches.
- **Build and compilation**: **PASS** — Independently executed `npm --prefix workspace-prototype run build` (`tsc --noEmit && vite build`), exiting 0 with zero type errors.
- **Automated test execution**: **PASS** — Independently executed `npm --prefix workspace-prototype test` (`node --test`), passing all 93 tests (including all 4 tiers of `card-theming-collision.test.mjs`) in 14.89s with 0 failures and 0 skipped.
- **Adversarial stress-testing**: **PASS** — Empirical monte-carlo test over 10,000 random 3D rotation/scale combinations confirmed OBB extent formula matches Three.js `Box3` within $1.18 \times 10^{-7}$ (machine precision). Spatial domain grid test across 3,721 positions confirmed 0 sub-floor penetrations.

---

## 1. Observation

### 1.1 Git Working Tree & Diff Inspection
Direct observation via `git status --short` and `git diff`:
- `workspace-prototype/src/main.ts`:
  - Lines 1058–1062: Constants defined:
    ```typescript
    export const FLOOR_Y = -0.12;
    export const DAIS_SURFACE_Y = 0.085;
    export const DAIS_CENTER_Z = -0.25;
    export const DAIS_RADIUS = 7.7;
    export const DAIS_RADIUS_SQ = DAIS_RADIUS * DAIS_RADIUS; // 59.29
    ```
  - Lines 1074–1078: Piecewise surface calculation in `getFloorHeightAt(x, z)`:
    ```typescript
    export function getFloorHeightAt(x: number, z: number): number {
      const dx = x;
      const dz = z - DAIS_CENTER_Z;
      return dx * dx + dz * dz <= DAIS_RADIUS_SQ ? DAIS_SURFACE_Y : FLOOR_Y;
    }
    ```
  - Lines 1085–1093: Exact OBB vertical half-extent computation in `getCardHalfHeightExtent`:
    ```typescript
    export function getCardHalfHeightExtent(card: SystemCard): number {
      card.group.updateWorldMatrix(true, false);
      const e = card.group.matrixWorld.elements;
      return (
        Math.abs(e[1]) * CARD_HALF_WIDTH +
        Math.abs(e[5]) * CARD_HALF_HEIGHT +
        Math.abs(e[9]) * CARD_HALF_DEPTH
      );
    }
    ```
  - Lines 1117–1134: `clampCardAboveFloor(card, useBox3)` clamping card Y position to `minY = targetFloor + extentY`.
  - Floor clamping enforcement at 4 sites:
    - Line 4353: `resolveCardCollisions` clamps all cards post-push.
    - Lines 6702, 6706: `onPointerMove` clamps during active drag and after collision resolution.
    - Line 6798: `onPointerUp` clamps on pointer drop.
    - Line 8074: `animate()` clamps on every frame dampening step.
  - Lines 4471–4518: View router functions `showStudio(cardId?)` and `showHome()`:
    - `showStudio`: Unhides `#studio-view`, hides `#home-view`, focuses card, resizes canvas, updates hash to `#studio`.
    - `showHome`: Closes popovers, unhides `#home-view`, hides `#studio-view`, synchronizes `#home-view` card feature badges, updates hash to `#home`.
  - Line 7919: `if (studioViewElement.hidden) return;` safely pauses 3D animation loop while browsing Home screen.
  - Lines 3492, 3869, 4706, 4859, 4932: Runtime crash vulnerability fixed by replacing `status?.preparedCardIds.includes(...)` with `(status?.preparedCardIds?.includes(...) ?? false)`.

- `workspace-prototype/src/style.css`:
  - Removed unconditional override `#home-view { display: none !important; }` at line 3516.
  - Preserved mutual-exclusion rule `#home-view[hidden], #studio-view[hidden] { display: none !important; }` at lines 2704–2707.
  - Added theme CSS custom properties for `data-card-theme="classic"|"cyberpunk"|"minimal-dark"|"glass"|"material-vibrant"` and responsive theme toolbar rules.

- `workspace-prototype/index.html`:
  - Added `.home-theme-bar` with accessible theme radio buttons (`role="radiogroup"`, `role="radio"`, `aria-checked`).
  - Added `data-open-home` and `.home-return-button` to topbar navigation.

- `workspace-prototype/tests/card-theming-collision.test.mjs`:
  - 1,006 lines implementing all 4 verification tiers specified in `TEST_INFRA.md`.
  - Contains 23 separate test blocks, each executing strict non-trivial assertions across real Three.js geometric instances, file system reads, transpiled TypeScript modules, and DOM attributes.

### 1.2 Independent Test Suite Execution Output
Executed `npm --prefix workspace-prototype test`:
```
✔ Tier 1.1: Feature 1 — Theming Research Documentation (THEMING_RESEARCH.md) (5.373ms)
✔ Tier 1.2: Feature 2 — Floor Boundary Constraints & Dais Collision Physics (3.9899ms)
✔ Tier 1.2b: Feature 2 — main.ts implements and enforces floor collision clamping in all 4 sites (1.5952ms)
✔ Tier 1.3: Feature 3 — 5 Theme Preset Token Definitions & Schemas (524.5626ms)
✔ Tier 1.4: Feature 4 — Theme Cache Invalidation & Content Key Synchronization (1.301ms)
✔ Tier 1.5: Feature 5 — Home View UI & Dual-View Router (1.3339ms)
✔ Tier 1.6: Feature 6 — Button Interactivity Safety across all DOM buttons & 8 printed buttons (70.1044ms)
✔ Tier 1.7: Feature 7 — Fedora Remote Workstation Execution & Infrastructure Verification (2.8241ms)
✔ Tier 2.1: Extreme Downward & Upward Drag Coordinates (1.1717ms)
✔ Tier 2.2: Radial Dais Boundary Discontinuity at r = 7.7 vs 7.701 (0.7248ms)
✔ Tier 2.3: Scale-Dependent Clamping & Three.js Box3 Tilt Clearance (3.3468ms)
✔ Tier 2.4: All 25 Theme Switching Transitions & Idempotency (0.8778ms)
✔ Tier 2.5: Invalid, Malformed, Empty, and Null Theme ID Recovery (2.9208ms)
✔ Tier 2.6: CSS Specificity & Display Rule Prevention (4.6669ms)
✔ Tier 3.1: Theming + Card Floor Clamping Interaction (3.619ms)
✔ Tier 3.2: Home Screen Theme Customization Propagating to Studio 3D Canvas (0.4966ms)
✔ Tier 3.3: Card Free Manipulation Persistence Across View Switching (0.6538ms)
✔ Tier 3.4: LocalStorage Cold-Boot Theme Initialization (0.4997ms)
✔ Tier 3.5: Per-Card Theme Override vs Global Theme (0.911ms)
✔ Tier 4.1: Flow F1 — First-Time User Onboarding & Studio Launch (0.4902ms)
✔ Tier 4.2: Flow F2 — Direct System Card Selection from Home View (0.2792ms)
✔ Tier 4.3: Flow F3 — Customizing Themes on Home Screen and Inspecting in Studio (0.5952ms)
✔ Tier 4.4: Flow F4 — Tactile Direct Manipulation & Physical Floor Stop (2.6277ms)
✔ Tier 4.5: Flow F5 — Card Facet Flipping, Zooming, and Safe Home Return (0.6541ms)
...
ℹ tests 93
ℹ suites 0
ℹ pass 93
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14893.0316
```

### 1.3 Independent Production Build Output
Executed `npm --prefix workspace-prototype run build`:
```
> post-card-workspace-prototype@0.1.0 build
> tsc --noEmit && vite build

vite v7.3.7 building client environment for production...
transforming...
✓ 67 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                  89.74 kB │ gzip:  21.09 kB
dist/assets/index-Cg2fPttN.css   98.86 kB │ gzip:  20.26 kB
dist/assets/index-CsAPxvnc.js   880.78 kB │ gzip: 248.29 kB
✓ built in 6.88s
```

### 1.4 Independent Monte-Carlo Physics Stress-Testing
Executed `.agents/teamwork/auditor_m2_1/test_obb.mjs`:
```
Auditor empirical test over 10,000 random orientations/scales:
Max Difference: 1.1840e-7
Violations (>1e-4): 0
VERIFIED: OBB half-height formula is mathematically exact across all 3D rotations and scales.
Grid penetration test: tested 3721 positions, violations = 0
VERIFIED: Zero sub-floor penetrations across entire spatial domain.
```

---

## 2. Logic Chain

1. **OBB Computational Geometry Integrity**:
   - In 3D space, Three.js column-major `Matrix4` has row index 1 (Y components) mapped to indices `e[1]` (column 0), `e[5]` (column 1), and `e[9]` (column 2).
   - Under the Separating Axis Theorem (OBB projection), the vertical projection half-radius of an oriented bounding box is $r_y = |e[1]| \cdot w_{1/2} + |e[5]| \cdot h_{1/2} + |e[9]| \cdot d_{1/2}$.
   - Our empirical test generated 10,000 random rotation tuples $(\theta_x, \theta_y, \theta_z) \in [-\pi, \pi]^3$ and non-uniform scales $(s_x, s_y, s_z) \in [0.3, 2.3]^3$. The maximum deviation between `getCardHalfHeightExtent` and `THREE.Box3().setFromObject()` was $1.18 \times 10^{-7}$, proving the implementation is mathematically rigorous and non-facade.
   - Setting `minY = targetFloor + extentY` guarantees that the lowest vertex $Y_{\min} = Y_{\text{center}} - extentY \ge targetFloor$.

2. **Floor and Dais Boundary Enforcement**:
   - The dais cylinder is located at $(0, -0.015, -0.25)$ with radius $7.7$ and height $0.2$. Top surface is $-0.015 + 0.1 = +0.085$. Obsidian floor is at $-0.12$.
   - `getFloorHeightAt(x, z)` accurately partitions the domain: points within $(x)^2 + (z + 0.25)^2 \le 7.7^2$ return $+0.085$, exterior points return $-0.12$.
   - `getEffectiveFloorHeightForCard` incorporates card footprint radius $1.1 \times \text{scale}$, preventing edge-clipping where a card center is outside the dais but its overhang is over the dais.
   - Clamping is called in all four lifecycle stages (`onPointerMove`, `resolveCardCollisions`, `onPointerUp`, `animate`). The grid penetration test of 3,721 coordinates produced 0 violations.

3. **View Router & CSS Integrity**:
   - Removing the `#home-view { display: none !important; }` rule allows `#home-view` to display when its `[hidden]` attribute is cleared.
   - Dual-view routing enforces mutual exclusion via HTML5 `[hidden]` semantics backed by `#home-view[hidden], #studio-view[hidden] { display: none !important; }`.
   - Event listeners for `[data-open-studio]`, `[data-open-home]`, brand logo, keyboard 'H', and 'Escape' properly trigger navigation without DOM exceptions.
   - Animate frame-skipping when `#studio-view` is hidden prevents wasteful background GPU/CPU rendering.

4. **Crash Resistance**:
   - Audited occurrences of `.preparedCardIds` and `.guests`. All 5 vulnerable locations were upgraded to safe optional chaining with explicit fallback defaults `(status?.preparedCardIds?.includes(...) ?? false)`.
   - Dialog modals check `.open` before invoking `.showModal()`, preventing `DOMException: Failed to execute 'showModal' on 'HTMLDialogElement': The element already has an 'open' attribute`.

---

## 3. Caveats

- **External QEMU Host**: Live hardware virtualization testing against Fedora `10.0.0.2` is scheduled for Milestone M4 per `PROJECT.md`; local test runner safely validates mock hypervisor interfaces.
- **Card Theming Presets**: Full theme catalog authoring belongs to Milestone M3; M2 properly integrates theme routing hooks, CSS custom property contracts, and cache invalidation.
- No other caveats.

---

## 4. Conclusion

Milestone M2 (Card Interaction and Floor Collision Polish) has been subjected to rigorous adversarial and forensic integrity review.
- No integrity violations, shortcuts, facade implementations, or hardcoded test bypasses exist.
- Floor boundary constraints prevent cards from penetrating below the floor or dais plane under all rotations and scales.
- View routing and button interactivity are fully functional, robustly guarded, and crash-resistant.
- **Verdict**: **CLEAN**. Milestone M2 is certified and approved.

---

## 5. Verification Method

### 5.1 Run Automated Test Suite
```powershell
npm --prefix workspace-prototype test
```
**Expected**: 93 passed, 0 failed, 0 skipped.

### 5.2 Run Production TypeScript & Vite Build
```powershell
npm --prefix workspace-prototype run build
```
**Expected**: `tsc --noEmit` exits with code 0; Vite produces production bundle.

### 5.3 Run Independent Empirical OBB & Collision Stress-Test
```powershell
node .agents/teamwork/auditor_m2_1/test_obb.mjs
```
**Expected**: 10,000 random orientations pass with max deviation $< 10^{-6}$; 3,721 grid positions pass with 0 penetrations.
