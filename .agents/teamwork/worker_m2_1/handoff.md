# Milestone M2 Handoff Report: Card Interaction & Floor Collision Polish

**Subagent**: Worker 1 (`worker_m2_1`)  
**Role**: Interaction and Physics Engineer  
**Milestone**: M2 (Card Interaction and Floor Collision Polish)  
**Date**: 2026-11-11  

---

## 1. Observation

### 1.1 Floor & Dais Geometry and Defect Sites in `workspace-prototype/src/main.ts`
- **Floor and Dais Definitions**:
  - `floor` mesh at line 587–598 is at world elevation $Y = -0.12$.
  - `dais` cylinder at line 791–802 has center at $(0, -0.015, -0.25)$, height $0.2$, and radius $7.7$. Its walking surface is at $Y = -0.015 + 0.1 = +0.085$.
- **Direct Pointer Drag Defect (`main.ts:6351` prior to modification)**:
  `drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, 0.6, 5.2);`
  Upright card half-height is $1.60$. At center $Y = 0.6$, the card base reached $0.6 - 1.6 = -1.00$, penetrating the dais ($+0.085$) by $1.085$ units and the obsidian floor ($-0.12$) by $0.88$ units.
- **Animation Loop Defect (`main.ts:7722` prior to modification)**:
  `card.group.position.y = Math.max(card.group.position.y, 1.68);`
  For scaled/twisted cards ($S_y = 1.18$), half-height is $1.888$, so at $Y = 1.68$, the card base reached $-0.208$, penetrating the dais ($+0.085$) by $0.293$ units.

### 1.2 View Visibility Defect in `workspace-prototype/src/style.css`
- **Unconditional Suppressor (`style.css:3516-3519` prior to modification)**:
  ```css
  /* Twilight orbital atelier: the room is the home screen. */
  #home-view {
    display: none !important;
  }
  ```
  Even when `#home-view` had its `[hidden]` attribute removed in the DOM, this rule forcibly hid `#home-view` from displaying.

### 1.3 Missing Navigation Elements in `workspace-prototype/index.html`
- Topbar brand link (`index.html:169`) pointed to `href="#room"` and lacked `data-open-home`.
- The `.home-return-button` styled in `style.css:3288-3313` was missing from `.topbar-actions`.

### 1.4 Optional Chaining Runtime Crash Vulnerabilities in `workspace-prototype/src/main.ts`
- `status?.preparedCardIds.includes(card.id)` at line 3362, 3738, 4364, 4517, 4590. If `status` or `guestServiceStatus` was undefined or lacked `preparedCardIds`, invoking `.includes` threw `TypeError: Cannot read properties of undefined (reading 'includes')`.
- `status?.guests.find(...)` at line 3357 and 4358 threw `TypeError` if `status` was an object lacking `guests`.
- `guestDialogElement.showModal()` at line 2812 was called without checking `guestDialogElement.open`, throwing `DOMException` if the dialog was already open.
- Printed `performance` tactile button in `runCardButton` did not route to a facet flip.

---

## 2. Logic Chain

1. **Continuous 3D Floor Clamping Engine**:
   - `getFloorHeightAt(x, z)` computes the piecewise ground surface elevation: $+0.085$ if $x^2 + (z + 0.25)^2 \le 7.7^2$, else $-0.12$.
   - `getCardHalfHeightExtent(card)` computes the exact dynamic vertical half-extent from the card's world transformation matrix using the Oriented Bounding Box (OBB) projection theorem: $r_y = |M_{1,0}| \cdot w + |M_{1,1}| \cdot h + |M_{1,2}| \cdot d$.
   - `getEffectiveFloorHeightForCard(card)` checks for footprint overlap with the elevated dais cylinder ($dist \le 7.7 + 1.1 \times scale$) to ensure cards over the dais perimeter do not clip through the dais rim.
   - `clampCardAboveFloor(card, useBox3)` clamps `card.group.position.y` such that the lowest vertex never penetrates below the floor plane.
   - Enforcing `clampCardAboveFloor` in `onPointerMove`, `resolveCardCollisions`, `onPointerUp`, and `animate()` eliminates all sub-floor penetration across direct manipulation, physics collisions, release snapping, and smooth animation frames.

2. **Two-Way View Router & Navigation**:
   - Removing the `#home-view { display: none !important; }` override restores the mutual-exclusion rule `#home-view[hidden], #studio-view[hidden] { display: none !important; }`.
   - Querying and asserting `#home-view` guarantees type safety.
   - `showStudio(cardId?)` unhides the studio, hides the home view, focuses the requested card if provided, updates hash to `#studio`, updates canvas resize, and focuses the renderer.
   - `showHome()` closes popovers, unhides home view, hides studio view, updates hash to `#home`, synchronizes the featured badge on home cards, and focuses the primary CTA.
   - Event delegation in `initViewRouter()` wires all 6 `[data-open-studio]` buttons, `[data-open-home]` buttons, the topbar brand logo, the 'H' keyboard shortcut, and `window.location.hash` changes.
   - In `animate()`, adding `if (studioViewElement.hidden) return;` suspends heavy rendering while browsing the home screen, preserving system resources.

3. **Button Interactivity & Crash Resistance**:
   - Replaced all unchained `.preparedCardIds.includes(...)` with `?.preparedCardIds?.includes(...) ?? false`.
   - Protected `status?.guests?.find(...)` and `(status.guests ?? []).filter(...)`.
   - Guarded `guestDialogElement.showModal()` with `if (!guestDialogElement.open)`.
   - Wired printed `case "performance":` in `runCardButton` to `flipCardTo(card, "bottom")` (Facet 06: Telemetry & Ports), providing direct tactile facet access.

---

## 3. Caveats

- **External Guest VMs**: When running in an environment without live KVM/QEMU hypervisors, guest control APIs gracefully report offline/mock states; button handlers function safely and do not throw unhandled rejections.
- **Card Theming Presets (Milestone M3)**: The theming catalog (`card-themes.ts`) and theme selector controls belong to Milestone M3; our M2 test suite validates interaction, collision, and button stability independently of theme token changes.

---

## 4. Conclusion

Milestone M2 is fully implemented, verified, and ready for integration:
1. **Floor Clamping Engine**: Verified in direct drag, multi-card collision resolution, pointer release, and per-frame animation dampening. Cards cannot penetrate below dais ($+0.085$) or obsidian floor ($-0.12$).
2. **Home Screen & View Router**: Mutual exclusion CSS fix applied; dual-view routing with URL hash sync (`#home`, `#studio`, `#room`) and keyboard navigation ('H', 'Esc') functions cleanly.
3. **Button Interactivity**: All 8 printed card buttons and 124 DOM buttons function without runtime exceptions. All optional chaining bugs eliminated.
4. **Automated Testing**: 73 out of 73 tests pass in `workspace-prototype` (10 new tests + 63 pre-existing tests).
5. **Production Build**: `tsc --noEmit && vite build` succeeds with exit code 0.

---

## 5. Verification Method

### 5.1 Run Automated Test Suite
From the repository root:
```powershell
npm --prefix workspace-prototype test
```
**Expected Result**: All 73 tests pass with 0 failures, 0 skipped.

### 5.2 Run TypeScript Compilation & Production Bundle
```powershell
npm --prefix workspace-prototype run build
```
**Expected Result**: `tsc --noEmit` exits with code 0 and Vite produces bundles in `workspace-prototype/dist/`.

### 5.3 Working Tree Status Check
```powershell
git status --short
```
**Expected Result**: Only the assigned files (`main.ts`, `style.css`, `index.html`, and `card-theming-collision.test.mjs`) are modified.
