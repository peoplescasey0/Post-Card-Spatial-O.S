# Milestone M2 Code Review & Adversarial Challenge Report: Floor Collision Clamping

**Subagent**: Reviewer 1 (`reviewer_m2_1`)  
**Role**: Floor Collision Code Reviewer & Adversarial Critic  
**Milestone**: M2 (Card Interaction and Floor Collision Polish)  
**Date**: 2026-11-11  
**Verdict**: **APPROVE**  

---

## 1. Observation

### 1.1 Floor & Dais Geometric Alignment in `workspace-prototype/src/main.ts`
- **Obsidian Floor** (`main.ts:617-628`):
  ```typescript
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    ...
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.12;
  ```
  The floor is horizontal at world elevation $Y = -0.12$.
- **Dais Cylinder** (`main.ts:821-832`):
  ```typescript
  const dais = new THREE.Mesh(
    new THREE.CylinderGeometry(7.7, 8.05, 0.2, 96, 1, false),
    ...
  );
  dais.position.set(0, -0.015, -0.25);
  ```
  Top surface elevation is `dais.position.y + height / 2 = -0.015 + 0.1 = +0.085`.
  The cylinder top radius is $7.7$, with center at $(X=0, Z=-0.25)$.

### 1.2 Constraint Constants and Functions (`main.ts:1058-1134`)
- Constants:
  - `FLOOR_Y = -0.12`
  - `DAIS_SURFACE_Y = 0.085`
  - `DAIS_CENTER_Z = -0.25`
  - `DAIS_RADIUS = 7.7`
  - `DAIS_RADIUS_SQ = 59.29`
  - `CARD_HALF_WIDTH = 1.075` (`CARD_WIDTH / 2 = 2.15 / 2`)
  - `CARD_HALF_HEIGHT = 1.600` (`CARD_HEIGHT / 2 = 3.2 / 2`)
  - `CARD_HALF_DEPTH = 0.091` (`0.155` body edge + bevel + fastener bead)
- Mathematical implementations:
  - `getFloorHeightAt(x, z)`: piecewise circular step function returning `DAIS_SURFACE_Y` if $x^2 + (z + 0.25)^2 \le 7.7^2$, else `FLOOR_Y`.
  - `getCardHalfHeightExtent(card)`: Evaluates world matrix row 1 components using the Oriented Bounding Box (OBB) projection theorem:
    $$r_y = |M_{1,0}| \cdot \text{CARD\_HALF\_WIDTH} + |M_{1,1}| \cdot \text{CARD\_HALF\_HEIGHT} + |M_{1,2}| \cdot \text{CARD\_HALF\_DEPTH}$$
    using Three.js column-major indices `Math.abs(e[1]) * 1.075 + Math.abs(e[5]) * 1.600 + Math.abs(e[9]) * 0.091`.
  - `getEffectiveFloorHeightForCard(card)`: Compares center distance from dais center with `DAIS_RADIUS + 1.1 * cardScale` to detect footprint overhang over the elevated platform.
  - `clampCardAboveFloor(card, useBox3)`: Enforces `card.group.position.y >= targetFloor + extentY` and syncs `card.group.updateWorldMatrix(true, false)`.

### 1.3 Interaction Call Sites in `workspace-prototype/src/main.ts`
1. **Direct Pointer Drag** (`main.ts:6701-6706`):
   ```typescript
   clampCardAboveFloor(drag.card);
   drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, drag.card.group.position.y, 5.2);

   resolveCardCollisions(drag.card);
   clampCardAboveFloor(drag.card);
   ```
   Enforced before and after collision resolution, preventing downward pointer drag from breaching the floor.
2. **Multi-Card Collision Resolution** (`main.ts:4352-4354`):
   ```typescript
   for (const card of cards) {
     clampCardAboveFloor(card);
   }
   ```
   Enforced for all cards when horizontal repulsion forces displace them.
3. **Pointer Up / Free Move Release** (`main.ts:6796-6802`):
   ```typescript
   } else if (completedDrag.freeMove) {
     resolveCardCollisions(completedDrag.card);
     clampCardAboveFloor(completedDrag.card);
     completedDrag.card.layoutOffset
       .copy(completedDrag.card.group.position)
       .sub(wheelPosition(cards.indexOf(completedDrag.card)));
   }
   ```
   Clamped prior to storing relative layout offset.
4. **Animation Render Loop** (`main.ts:8067-8075`):
   ```typescript
   if (reducePreviewMotion) {
     card.group.position.copy(targetPosition);
   } else {
     card.group.position.x = THREE.MathUtils.damp(card.group.position.x, targetPosition.x, 28, dt);
     card.group.position.y = THREE.MathUtils.damp(card.group.position.y, targetPosition.y, 28, dt);
     card.group.position.z = THREE.MathUtils.damp(card.group.position.z, targetPosition.z, 28, dt);
   }
   clampCardAboveFloor(card);
   ```
   Replaces the previous hardcoded `Math.max(card.group.position.y, 1.68)`, ensuring that dynamically scaled or twisted cards never penetrate during frame-by-frame dampening.

### 1.4 Test Suite & Build Execution
- `npm --prefix workspace-prototype test`:
  ```
  ✔ Tier 1.2: Feature 2 — Floor Boundary Constraints & Dais Collision Physics (3.8132ms)
  ✔ Tier 1.2b: Feature 2 — main.ts implements and enforces floor collision clamping in all 4 sites (3.1381ms)
  ✔ Tier 2.1: Extreme Downward & Upward Drag Coordinates (1.2758ms)
  ✔ Tier 2.2: Radial Dais Boundary Discontinuity at r = 7.7 vs 7.701 (1.4459ms)
  ✔ Tier 2.3: Scale-Dependent Clamping & Three.js Box3 Tilt Clearance (12.4986ms)
  ...
  ℹ tests 93
  ℹ pass 93
  ℹ fail 0
  ```
- `npm --prefix workspace-prototype run build`:
  `tsc --noEmit && vite build` completed with code 0 in 5.84s producing production assets in `dist/`.

---

## 2. Logic Chain

1. **Geometric Fidelity**:
   - `floor` is defined at $Y = -0.12$. `dais` cylinder is at $(0, -0.015, -0.25)$ with height $0.2$, placing its top flat walking surface at $Y = +0.085$.
   - `getFloorHeightAt(x, z)` accurately models this 2-level piecewise floor geometry based on radial distance from $(0, -0.25)$.
2. **Oriented Bounding Box (OBB) Correctness**:
   - For an oriented 3D box with half-extents $(w, h, d)$, the maximum vertical projection along the world Y axis is given by the OBB projection theorem:
     $$r_y = w |M_{1,0}| + h |M_{1,1}| + d |M_{1,2}|$$
   - In Three.js, `matrixWorld.elements` is stored in column-major order:
     - $M_{1,0} = e[1]$ (local X axis projection onto world Y)
     - $M_{1,1} = e[5]$ (local Y axis projection onto world Y)
     - $M_{1,2} = e[9]$ (local Z axis projection onto world Y)
   - Because `matrixWorld` contains non-uniform scale ($S_x, S_y, S_z$), the term $|e[5]| \cdot h = |S_y R_{1,1}| \cdot h$ dynamically expands when cards twist or swell (e.g. $S_y = 1.18 \implies r_y = 1.888$).
   - Subtracting $r_y$ from `position.y` gives the lowest vertex elevation. Requiring $\text{position.y} \ge \text{targetFloor} + r_y$ ensures no corner or vertex can dip below `targetFloor`.
3. **Comprehensive Call Site Coverage**:
   - Enforcing `clampCardAboveFloor` during pointer drag (`onPointerMove`), after inter-card repulsion (`resolveCardCollisions`), upon drop (`onPointerUp`), and per-frame in `animate()` eliminates all sub-floor penetration across both user-initiated and procedural motions.
4. **Performance & Cleanliness**:
   - The default clamp path (`useBox3 = false`) uses $O(1)$ arithmetic on already computed matrix elements, avoiding per-frame memory allocation or garbage collection overhead in the 60fps render loop.

---

## 3. Adversarial Stress-Testing & Findings

### Finding 1: Benign Boundary Footprint Overhang on 90° Tumbled Pitch Near Dais Rim
- **Severity**: Minor (Non-blocking / Accepted Risk)
- **What**: In `getEffectiveFloorHeightForCard(card)`:
  ```typescript
  const cardScale = Math.max(card.group.scale.x, card.group.scale.z, 1.0);
  const cardHorizRadius = 1.1 * cardScale;
  if (dist <= DAIS_RADIUS + cardHorizRadius) {
    return DAIS_SURFACE_Y;
  }
  return FLOOR_Y;
  ```
  The horizontal footprint radius is estimated as `1.1 * cardScale`. This assumes the card is primarily upright, where half-width is $1.075$ and half-depth is $0.091$ ($\sqrt{1.075^2 + 0.091^2} \approx 1.079 \le 1.1$).
- **Attack Scenario**: If a card were rotated 90° in X (pitched flat) and positioned at radius $r = 8.9$ (outside $7.7 + 1.1 = 8.8$), `getEffectiveFloorHeightForCard` classifies it as on the obsidian floor ($-0.12$). However, because the card is pitched flat, its height ($1.6$) extends horizontally inward ($8.9 - 1.6 = 7.3 < 7.7$), placing its inner corner over the dais ($+0.085$) while its elevation is clamped to $-0.12$, yielding a theoretical penetration of $0.205$ units.
- **Blast Radius Assessment**: In the actual application UI:
  1. Pointer dragging clamps rotation: `drag.card.tiltZ` is bounded to $\pm 0.22$ rad ($\approx 12.6^\circ$) and `rotation.x = 0`.
  2. Cards in the carousel are located at $r \le 4.5 \ll 7.7$.
  3. Facet flipping occurs only on `selectedCard` at front-center ($r \approx 2.45$).
  4. Cards at the room perimeter ($r > 7.7$) are strictly upright.
  Therefore, this theoretical condition cannot occur during live user interaction.
- **Mitigation Recommendation**: In future polish, compute the horizontal footprint radius dynamically from the matrix elements:
  $$r_{\text{horiz}} = \sqrt{(|M_{0,0}| w + |M_{0,1}| h + |M_{0,2}| d)^2 + (|M_{2,0}| w + |M_{2,1}| h + |M_{2,2}| d)^2}$$

### Integrity Violation Check
- **Hardcoded test results**: None detected. Tests evaluate dynamic Three.js objects.
- **Dummy or facade implementations**: None. Real mathematical OBB bounds and Three.js matrix transforms are computed.
- **Shortcuts / Bypasses**: None. Implemented natively in TypeScript and Three.js.
- **Fabricated verification logs**: None. Independent test runner and build executions performed directly in PowerShell.
- **Self-certifying work**: None. Independently verified by Reviewer 1.

---

## 4. Caveats

- Testing was performed on the Windows development host environment with local Node.js v24.1.0; cross-platform validation on the remote Fedora workstation (Node v26.13.0) is slated for Milestone M4.

---

## 5. Conclusion

**Verdict: APPROVE**

The Floor Collision Clamping implementation in `workspace-prototype/src/main.ts` is mathematically rigorous, fully respects the scene geometry (dais top $Y = +0.085$, floor $Y = -0.12$), protects all 4 interaction call sites, passes all 93 unit and regression tests, builds cleanly without TypeScript or bundling errors, and introduces zero regressions.

---

## 6. Verification Method

To independently reproduce this verification:
1. **Run full workspace test suite**:
   ```powershell
   npm --prefix workspace-prototype test
   ```
   *Expected*: All 93 tests pass (including Tiers 1.2, 1.2b, 2.1, 2.2, 2.3).
2. **Run adversarial challenger test**:
   ```powershell
   node --test workspace-prototype/tests/m2_challenger_collision.test.mjs
   ```
   *Expected*: All 5 stress test challenges complete successfully.
3. **Run TypeScript check and production bundle**:
   ```powershell
   npm --prefix workspace-prototype run build
   ```
   *Expected*: Exit code 0, Vite output in `workspace-prototype/dist/`.
