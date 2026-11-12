# Milestone M2 Adversarial Challenge Report: Physics Collision & Floor Clamping

**Subagent**: Challenger 1 (`challenger_m2_1`)  
**Role**: Physics Collision Adversarial Verifier  
**Milestone**: M2 (Card Interaction and Floor Collision Polish)  
**Date**: 2026-11-11  
**Verdict**: ❌ **REQUEST_CHANGES**

---

## 1. Observation

### 1.1 Implementation Defect in `workspace-prototype/src/main.ts`
At lines 1099–1110 of `workspace-prototype/src/main.ts`:
```ts
export function getEffectiveFloorHeightForCard(card: SystemCard): number {
  const dx = card.group.position.x;
  const dz = card.group.position.z - DAIS_CENTER_Z;
  const dist = Math.hypot(dx, dz);
  // Max horizontal extent of the card in the XZ plane
  const cardScale = Math.max(card.group.scale.x, card.group.scale.z, 1.0);
  const cardHorizRadius = 1.1 * cardScale;
  if (dist <= DAIS_RADIUS + cardHorizRadius) {
    return DAIS_SURFACE_Y;
  }
  return FLOOR_Y;
}
```

Direct observations of constants and geometry:
- `DAIS_RADIUS` = `7.7` around `(0, -0.25)`. Dais walking surface is `DAIS_SURFACE_Y = 0.085`.
- Obsidian floor elevation is `FLOOR_Y = -0.12`.
- Elevation step between floor and dais: $\Delta Y = 0.085 - (-0.12) = 0.205$ units ($20.5\text{ cm}$).
- Physical card half-extents (lines 1064–1066):
  - `CARD_HALF_WIDTH = 1.075`
  - `CARD_HALF_HEIGHT = 1.600`
  - `CARD_HALF_DEPTH = 0.091`
- The maximum distance from the card center $(0,0,0)$ to any corner in 3D is:
  $R_{\text{corner}} = \sqrt{1.075^2 + 1.600^2 + 0.091^2} = \sqrt{3.7239} \approx 1.930\text{ units}$.
- Under any pitch, roll, or 3D tumble (e.g. `flipAnim` at line 8022 pitching up to $\pi/2$ rad), the card's height axis ($1.600$) and corner ($1.930$) project directly into the horizontal XZ plane.
- In line 1105, `cardHorizRadius` is hardcoded as `1.1 * cardScale`, which accounts only for `CARD_HALF_WIDTH` ($1.075$) and assumes the card is always upright.
- In line 1104, `cardScale = Math.max(card.group.scale.x, card.group.scale.z, 1.0)`, completely omitting `card.group.scale.y`.

### 1.2 Direct Manipulation Boundaries in `workspace-prototype/src/main.ts`
At lines 6693–6694:
```ts
drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.8, 7.2);
drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -6.6, 2.5);
```
Pointer dragging allows positioning cards at coordinates such as $(x = -7.5, z = -5.0)$.
At this position:
$\text{dist} = \sqrt{(-7.5)^2 + (-5.0 - (-0.25))^2} = \sqrt{56.25 + 22.5625} = 8.877\text{ units}$.

### 1.3 Empirical Test Execution & Verbatim Results
Executing `node --test workspace-prototype/tests/m2_challenger_collision.test.mjs`:
```
✔ Adversarial 1: Upright cards across dais interior, perimeter, and exterior floor (14.8187ms)
✔ Adversarial 2: Bug Demonstration — Pitch flip (90 deg) near dais rim penetrates dais by 0.205 units (1.5006ms)
✔ Adversarial 3: Bug Demonstration — Non-uniform scaling (scale.y = 1.53) creates 1.57-unit blind spot (0.7491ms)
✔ Adversarial 4: Sweep of 500 Random 3D Tumble Quaternions across boundary (77.0055ms)
✔ Adversarial 5: Pointer Dragging Simulation with Extreme Negative Y (-100.0) (0.5169ms)
ℹ tests 5
ℹ pass 5
```

Verbatim empirical failure logged for the current `main.ts` implementation:
- Test: Card placed at valid drag coordinate $(x = -7.5, y = -5.0, z = -5.0)$ pitched $90^\circ$ toward dais center.
- Result after `clampCardAboveFloor(card, false)`:
  - `card.group.position.y` was clamped to `0.83687` based on target floor `FLOOR_Y = -0.12`.
  - Corner world position: $(X = -7.0017, Y = -0.1200, Z = -3.4000)$.
  - Distance of this corner to dais center $(0, -0.25)$ is: $\sqrt{(-7.0017)^2 + (-3.4000 - (-0.25))^2} = \sqrt{49.0238 + 9.9225} = 7.6776 \le 7.700$.
  - The ground elevation directly beneath this corner is `DAIS_SURFACE_Y = +0.085`.
  - **Penetration: $+0.085 - (-0.120) = 0.205$ units below the solid dais.**
- 500 random 3D tumble configurations: 12 out of 500 configurations penetrated the dais by up to $0.205$ units.

---

## 2. Logic Chain

1. **The Contract**:
   Milestone M2 requirement R2 and SCOPE.md explicitly specify:
   *"Prevent cards from being moved through the floor during direct manipulation by enforcing floor boundary constraints... under NO circumstance does any card vertex or bounding corner drop below the floor plane ($Y < -0.12$) or dais ($Y < +0.085$)."*
   Furthermore, `main.ts:1096-1098` documents the invariant:
   *"If any part of the card footprint overlaps the elevated dais platform, returns DAIS_SURFACE_Y."*

2. **The Flaw**:
   When a card is pitched, tumbled, or peeled, its height axis ($H = 3.200$, half-height $1.600$) is rotated into the horizontal plane. The actual horizontal radius of the card's footprint expands from $\sim 1.079$ (when upright) up to $1.930 \times \text{scale}$ (when pitched or tumbled).
   However, `getEffectiveFloorHeightForCard` hardcodes `cardHorizRadius = 1.1 * cardScale`.
   Consequently, for any card whose center is in the annular band:
   $$\text{dist} \in (7.7 + 1.1 \cdot \text{scale}, 7.7 + 1.93 \cdot \text{scale}] = (8.80, 9.63]\quad (\text{at scale } 1.0)$$
   `getEffectiveFloorHeightForCard` incorrectly evaluates `dist <= 8.8` as `false` and returns `FLOOR_Y` ($-0.12$).

3. **The Consequence**:
   Because `targetFloor` is set to $-0.12$, `clampCardAboveFloor` clamps the card such that its lowest point anywhere is at $Y = -0.12$.
   However, because the card's inner edge or corner reaches inward by up to $1.93$ units, it projects across the rim into the dais platform ($R \le 7.7$).
   At those $(X, Z)$ coordinates, the ground is elevated at $Y = +0.085$.
   The card vertices drop to $Y = -0.12$, penetrating through the solid marble dais by $0.205$ units.

4. **Reachable in Real Usage**:
   This is not a purely theoretical edge case. The coordinates $(x = -7.5, z = -5.0)$ are directly accessible during pointer dragging (which clamps to $[-7.8, 7.2] \times [-6.6, 2.5]$). During facet flipping (`flipCardTo(card, "top")` or `"bottom"`), line 8022 tumbles the card through $\pi/2$ radians. If a card is manipulated near the rim, it visibly clips through the dais floor.

5. **Non-Uniform Scale Vulnerability**:
   `cardScale` in line 1104 uses `Math.max(card.group.scale.x, card.group.scale.z, 1.0)`, omitting `scale.y`. For a card with `scale.y = 1.53`, the blind spot widens to $(8.80, 10.37]$, a $1.57$-unit vulnerability corridor.

---

## 3. Caveats

- **Upright Performance**: For cards that remain strictly upright with zero pitch and zero roll, the current implementation is stable because $CARD\_HALF\_WIDTH = 1.075 \le 1.10$. Upright boundary sweeps across $R = 7.7$ produced 0 penetrations.
- **Obsidian Floor Floor-Stop**: Clamping against the baseline obsidian floor at $Y = -0.12$ is mathematically sound under all orientations; no vertex ever drops below $-0.12$. The vulnerability is strictly confined to the raised dais rim step transition.
- **Other M2 Deliverables**: Home screen view routing, CSS display rule fixes, and button optional chaining crash prevention were verified and found to be well implemented by Worker 1. Only the floor collision overhang calculation requires remediation.

---

## 4. Conclusion

**Verdict: REQUEST_CHANGES**

The current implementation in `workspace-prototype/src/main.ts` fails Requirement 2 of Milestone M2 under dynamic card manipulation.

### Actionable Remediation Plan
Update `getEffectiveFloorHeightForCard` in `workspace-prototype/src/main.ts:1099-1110` to compute the exact dynamic horizontal Oriented Bounding Box (OBB) footprint radius from the card's world matrix:

```ts
export function getEffectiveFloorHeightForCard(card: SystemCard): number {
  card.group.updateWorldMatrix(true, false);
  const e = card.group.matrixWorld.elements;
  const dx = card.group.position.x;
  const dz = card.group.position.z - DAIS_CENTER_Z;
  const dist = Math.hypot(dx, dz);

  // Compute maximum horizontal distance from card origin to any bounding corner
  let maxHorizDist = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const hx = e[0] * sx * CARD_HALF_WIDTH + e[4] * sy * CARD_HALF_HEIGHT + e[8] * sz * CARD_HALF_DEPTH;
        const hz = e[2] * sx * CARD_HALF_WIDTH + e[6] * sy * CARD_HALF_HEIGHT + e[10] * sz * CARD_HALF_DEPTH;
        const r = Math.hypot(hx, hz);
        if (r > maxHorizDist) maxHorizDist = r;
      }
    }
  }

  if (dist <= DAIS_RADIUS + maxHorizDist) {
    return DAIS_SURFACE_Y;
  }
  return FLOOR_Y;
}
```

*Verification of this fix*:
When tested against 500 random 3D tumble quaternions, non-uniform scaling (`scale.y = 1.53`), and $90^\circ$ pitch flips, this exact OBB implementation eliminated all penetrations: **0 failures out of 500 tests, maximum penetration 0.00000.**

---

## 5. Verification Method

To independently reproduce the bug and verify the fix:

### 5.1 Run the Adversarial Test Suite
```powershell
node --test workspace-prototype/tests/m2_challenger_collision.test.mjs
```
**Expected Output**:
- Test 1 (Upright baseline): PASS
- Test 2 (Pitch flip at $X=-7.5, Z=-5.0$): Confirms penetration bug in current code ($+0.205$ units) and proves fix eliminates it ($0$ penetration).
- Test 3 (Non-uniform scale `scale.y = 1.53`): Confirms penetration bug in current code and proves fix eliminates it.
- Test 4 (500-iteration random tumble sweep): Confirms current code fails with multiple penetrations; confirms fix achieves 100% pass rate.
- Test 5 (Negative Y drag simulation): PASS

### 5.2 Invalidation Conditions
The issue is considered resolved when:
1. `getEffectiveFloorHeightForCard` dynamically accounts for the horizontal projection of card height and `scale.y`.
2. No card vertex or bounding corner drops below $Y < +0.085$ when any part of the card footprint overlaps $R \le 7.7$.
3. All tests in `workspace-prototype/tests/m2_challenger_collision.test.mjs` pass with `getEffectiveFloorHeightForCard` directly imported from `src/main.ts`.
