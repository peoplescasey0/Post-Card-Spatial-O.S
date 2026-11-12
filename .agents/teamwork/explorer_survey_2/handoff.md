# Handoff Report: Physics, Interaction, and Floor Collision Survey (Requirement R2)

## 1. Observation

### 1.1 Floor Plane & Environment Definitions
Directly observed in `workspace-prototype/src/main.ts`:
- **Floor Plane Mesh (Lines 586–598)**:
  ```ts
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
  The floor is a flat horizontal plane ($XZ$ plane) rotated $-90^\circ$ around $X$ (normal $(0, 1, 0)$), positioned at world coordinate $Y = -0.12$.
- **Studio Dais Platform (Lines 791–802, 855–867)**:
  ```ts
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
  The circular dais has top radius $7.7$, bottom radius $8.05$, height $0.2$, and is centered at $(0, -0.015, -0.25)$.
  Its top walking surface is at $Y = -0.015 + 0.10 = +0.085$. Concentric rings and tick markers sit between $Y = 0.102$ and $Y = 0.105$.
- **Paper Bin Position (Lines 600–603)**:
  ```ts
  const binGroup = new THREE.Group();
  binGroup.position.set(-7.4, -0.12, -6.4);
  ```
  The trash can sits on the obsidian floor at $Y = -0.12$.

### 1.2 Card Geometry & Pivot Points
Directly observed in `workspace-prototype/src/main.ts`:
- **Dimensions (Lines 983–1013)**:
  ```ts
  const CARD_WIDTH = 2.15;
  const CARD_HEIGHT = 3.2;
  ...
  const cardGeometry = new THREE.ShapeGeometry(roundedRectangle(CARD_WIDTH, CARD_HEIGHT, 0.13));
  ...
  const edgeGeometry = new THREE.ExtrudeGeometry(roundedRectangle(CARD_WIDTH, CARD_HEIGHT, 0.13), {
    depth: 0.105,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.025,
    bevelThickness: 0.025,
  });
  edgeGeometry.translate(0, 0, -0.0525);
  ```
- **Pivot Point Definition in `roundedRectangle` (Lines 2909–2925)**:
  ```ts
  function roundedRectangle(width: number, height: number, radius: number): THREE.Shape {
    const left = -width / 2;
    const right = width / 2;
    const bottom = -height / 2;
    const top = height / 2;
    ...
  ```
  The card geometry is centered around the origin `(0, 0, 0)`. The pivot point of each `SystemCard.group` is located at the geometric center of the card.
  - Card half-height: $H / 2 = 1.6$.
  - Card half-width: $W / 2 = 1.075$.
  - Card half-thickness: $D / 2 \approx 0.0775$.

### 1.3 Card Drag and Manipulation Logic
Directly observed in `workspace-prototype/src/main.ts`:
- **Drag Initiation (`onPointerDown`, Lines 6261–6291)**:
  ```ts
  const isFrontCard = Boolean(hitCard && isCardPulledToFront(hitCard));
  const grab = isFrontCard && hitCard && hit?.uv ? classifyCardGrab(hitCard, hit.uv) : undefined;
  const freeMove = Boolean(event.shiftKey || event.button === 2);

  if ((freeMove || grab?.centerMove) && hitCard) {
    dragPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()),
      hitCard.group.position,
    );
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    drag = {
      card: hitCard,
      pointerId: event.pointerId,
      mode: "move",
      freeMove,
      offset: hitCard.group.position.clone().sub(dragPoint),
      ...
  ```
- **Drag Motion & Inadequate Clamping (`onPointerMove`, Lines 6347–6356)**:
  ```ts
  if (drag.mode === "move" && drag.card) {
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    drag.card.group.position.copy(dragPoint.add(drag.offset ?? new THREE.Vector3()));
    drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.8, 7.2);
    drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, 0.6, 5.2);
    drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -6.6, 2.5);
    const overBin = isCardOverBinCan(drag.card, event.clientX, event.clientY);
    drag.card.tiltZ = overBin ? 0.22 : 0;
    resolveCardCollisions(drag.card);
    drag.card.group.rotation.y = cardDisplayRotation(drag.card);
  }
  ```
- **Animation Loop Behavior (`animate`, Lines 7586 & 7718–7722)**:
  ```ts
  for (const [index, card] of cards.entries()) {
    if (drag?.card === card && drag.mode === "move") continue;
    ...
    card.group.position.x = THREE.MathUtils.damp(card.group.position.x, targetPosition.x, 28, dt);
    card.group.position.y = THREE.MathUtils.damp(card.group.position.y, targetPosition.y, 28, dt);
    card.group.position.z = THREE.MathUtils.damp(card.group.position.z, targetPosition.z, 28, dt);
    card.group.position.y = Math.max(card.group.position.y, 1.68);
  }
  ```
- **Release and Placement (`onPointerUp`, Lines 6446–6453)**:
  ```ts
  } else if (completedDrag.freeMove) {
    resolveCardCollisions(completedDrag.card);
    completedDrag.card.layoutOffset
      .copy(completedDrag.card.group.position)
      .sub(wheelPosition(cards.indexOf(completedDrag.card)));
  } else {
    completedDrag.card.layoutOffset.set(0, 0, 0);
  }
  ```
- **Collision Resolution (`resolveCardCollisions`, Lines 4182–4220)**:
  Calculates separation only along $X$ and $Z$, completely ignoring $Y$ and the floor plane:
  ```ts
  posA.x = THREE.MathUtils.clamp(posB.x + dirX * minSepX, -7.2, 7.2);
  ```

### 1.4 Interactive Buttons Audit
Directly observed across `workspace-prototype/index.html` and `src/main.ts`:
- Total buttons in `index.html`: 123 `<button>` elements.
- **Home Screen Interface (`index.html` Lines 17–165)**:
  - Line 40: `<button class="home-primary-button" type="button" data-open-studio>`
  - Line 85: `<button class="home-system-card" type="button" data-open-studio data-card-id="android" ...>`
  - Line 98: `<button class="home-system-card" type="button" data-open-studio data-card-id="windows" ...>`
  - Line 111: `<button class="home-system-card home-system-card-featured" type="button" data-open-studio data-card-id="linux" ...>`
  - Line 124: `<button class="home-system-card" type="button" data-open-studio data-card-id="macos" ...>`
  - Line 137: `<button class="home-system-card" type="button" data-open-studio data-card-id="kali-red" ...>`
  - **Findings**:
    1. Zero event listeners are bound to `[data-open-studio]` in `main.ts`. All 6 home screen buttons are completely inert.
    2. In `style.css` (lines 3516–3519):
       ```css
       /* Twilight orbital atelier: the room is the home screen. */
       #home-view {
         display: none !important;
       }
       ```
       The rule `#home-view { display: none !important; }` forcibly suppresses `#home-view` even when the `hidden` HTML attribute is removed.
- **Physical On-Card Printed Buttons (`src/card-buttons.ts` and `src/main.ts`)**:
  - 8 buttons: `guest`, `stop`, `zoom`, `settings`, `clone`, `savepoint`, `performance`, `bin`.
  - Hit tested accurately in logical canvas $(640 \times 960)$ via `hitCardButton(u, v)`.
  - In `main.ts` line 3362:
    ```ts
    const hasDisk =
      os === "windows"
        ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
          (/^windows[-_]/.test(card.id) && (status?.installedWindowsCardIds?.includes("windows") ?? false))
        : (status?.preparedCardIds.includes(card.id) ?? false);
    ```
    If `status` is defined but does not contain `preparedCardIds` (e.g. offline/mock response or schema variation), `status?.preparedCardIds.includes` throws `TypeError: Cannot read properties of undefined (reading 'includes')`. Optional chaining `?.` is missing on `preparedCardIds`.

---

## 2. Logic Chain

1. **Why Cards Penetrate the Floor Plane**:
   - The card pivot is at its local center $(0,0,0)$ with height $H = 3.2$, meaning the card extends $1.6$ units below its `position.y` when upright.
   - During dragging (`onPointerMove`), line 6351 clamps `drag.card.group.position.y` to the range `[0.6, 5.2]`.
   - When the user drags downward, `drag.card.group.position.y` reaches $0.6$. The bottom edge of the card is at $Y = 0.6 - 1.6 = -1.0$.
   - The floor plane is at $Y = -0.12$.
   - Therefore, the card penetrates $-0.12 - (-1.0) = 0.88$ units (88 centimeters) beneath the floor plane during normal direct manipulation.
   - Furthermore, `line 7586` skips dragged cards from the animation loop clamp (`if (drag?.card === card && drag.mode === "move") continue;`), leaving the card below the floor throughout the entire drag interaction.

2. **Why Cards Penetrate or Pop upon Release**:
   - If a card is moved via free move (`event.shiftKey || event.button === 2`), `completedDrag.card.layoutOffset` is calculated from the depressed position (`sub(wheelPosition(...))`).
   - Although line 7722 clamps `position.y >= 1.68` on subsequent non-drag frames, this:
     - Causes an abrupt vertical snap from $y = 0.6$ to $y = 1.68$ on pointer release.
     - Ignores dynamic scale (e.g. twisted cards have $s_y = 1.18 \times \text{peelScale}$, requiring center $y \ge 1.97$ to clear the dais).
     - Ignores rotations or tilts ($X/Z$ rotations change the distance from center to lowest vertex).
     - Ignores whether the card is situated over the dais ($Y = 0.085$) or outside the dais on the obsidian floor ($Y = -0.12$).

3. **Required Floor Boundary Constraint Formulation**:
   - For any card orientation, scale, and position $(x, y, z)$, the world bounding box can be computed via `THREE.Box3`.
   - The lowest world coordinate of the card mesh is $Y_{\min} = \text{Box3.min.y}$.
   - The ground surface at position $(x, z)$ is defined by:
     $$Y_{\text{surface}}(x, z) = \begin{cases} 0.085 & \text{if } x^2 + (z + 0.25)^2 \le 7.7^2 \quad (\text{Dais platform}) \\ -0.12 & \text{otherwise} \quad (\text{Obsidian room floor}) \end{cases}$$
   - The invariant to enforce at all times (during drag, during animation, during collision resolution, and on release) is:
     $$Y_{\min} \ge Y_{\text{surface}}(x, z)$$
   - If $Y_{\min} < Y_{\text{surface}}(x, z)$, the center position must be corrected:
     $$\Delta y = Y_{\text{surface}}(x, z) - Y_{\min}$$
     $$\text{card.group.position.y} \gets \text{card.group.position.y} + \Delta y$$
   - In `onPointerMove`, the minimum allowable center $Y$ clamp must be computed dynamically:
     $$\text{minCenterY} = Y_{\text{surface}}(x, z) + (\text{halfHeight} \times s_y)$$
     so the user's cursor cannot pull the card down into the floor.

4. **Home Screen & Button Interaction Broken State**:
   - The home screen buttons (`data-open-studio` on `.home-primary-button` and the 5 `.home-system-card` buttons) lack click handlers. Clicking them fails to navigate into the 3D studio or select the designated card.
   - Removing `#home-view { display: none !important; }` from `style.css` and implementing view switching between `#home-view` and `#studio-view` restores the home screen interface.
   - Adding missing optional chaining on `status?.preparedCardIds?.includes(...)` eliminates the `TypeError` risk when inspecting card button states.

---

## 3. Caveats

- **Reduced Motion Mode**: When `prefersReducedMotion()` is active, vertical dampening and card flips snap instantly. Floor clamping must still be applied so snapped positions do not breach the floor plane.
- **Paper Flight Animation**: When cards are binned (`beginCardBinFlight`), the card scales down and flies to the trash can rim at $Y = 1.58$. This flight path is already safely above the floor ($1.58 > -0.12$).
- **No Direct Implementation Rule**: As an Explorer subagent in integrity mode, no project source code files have been modified. The recommendations below are concrete and ready for the implementer agent.

---

## 4. Conclusion & Actionable Recommendations

### Recommendation 1: Floor Constraint Engine
Implement a unified floor clamping function in `workspace-prototype/src/main.ts` and export it or integrate it into physics updates:
```ts
const FLOOR_Y = -0.12;
const DAIS_SURFACE_Y = 0.085;
const DAIS_CENTER_Z = -0.25;
const DAIS_RADIUS_SQ = 7.7 * 7.7;
const floorBoxHelper = new THREE.Box3();

export function getFloorHeightAt(x: number, z: number): number {
  const dx = x;
  const dz = z - DAIS_CENTER_Z;
  return dx * dx + dz * dz <= DAIS_RADIUS_SQ ? DAIS_SURFACE_Y : FLOOR_Y;
}

export function clampCardAboveFloor(card: SystemCard): void {
  floorBoxHelper.setFromObject(card.group);
  const currentBottom = floorBoxHelper.min.y;
  const targetFloor = getFloorHeightAt(card.group.position.x, card.group.position.z);
  if (currentBottom < targetFloor) {
    card.group.position.y += (targetFloor - currentBottom);
  }
}
```

### Recommendation 2: Update `onPointerMove` Direct Manipulation
In `workspace-prototype/src/main.ts` (lines 6348–6356), replace the hardcoded `0.6` clamp:
```ts
if (drag.mode === "move" && drag.card) {
  if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
  drag.card.group.position.copy(dragPoint.add(drag.offset ?? new THREE.Vector3()));
  drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.8, 7.2);
  drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -6.6, 2.5);
  
  // Enforce dynamic floor boundary based on card scale and dais/floor height
  clampCardAboveFloor(drag.card);
  drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, drag.card.group.position.y, 5.2);

  const overBin = isCardOverBinCan(drag.card, event.clientX, event.clientY);
  drag.card.tiltZ = overBin ? 0.22 : 0;
  resolveCardCollisions(drag.card);
  drag.card.group.rotation.y = cardDisplayRotation(drag.card);
}
```

### Recommendation 3: Enforce Floor Clamp in `resolveCardCollisions`, `onPointerUp`, and `animate`
1. In `resolveCardCollisions(activeCard)`: call `clampCardAboveFloor(cardA)` and `clampCardAboveFloor(cardB)` after resolving horizontal overlap.
2. In `onPointerUp` (`completedDrag.freeMove`): call `clampCardAboveFloor(completedDrag.card)` before computing `layoutOffset`.
3. In `animate` (lines 7718–7722): replace `card.group.position.y = Math.max(card.group.position.y, 1.68);` with `clampCardAboveFloor(card);`.

### Recommendation 4: Wire Home Screen Navigation & Audit Fixes
1. In `workspace-prototype/src/style.css` (lines 3516–3519): remove the blanket `#home-view { display: none !important; }` rule so that view toggling via `#home-view[hidden]` / `#studio-view[hidden]` works as declared in lines 2704–2707.
2. In `workspace-prototype/src/main.ts`:
   - Query `const homeView = document.querySelector<HTMLElement>("#home-view");`.
   - Bind click listeners to all `[data-open-studio]` buttons:
     ```ts
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

     document.querySelectorAll<HTMLElement>("[data-open-studio]").forEach((button) => {
       button.addEventListener("click", () => {
         showStudio(button.dataset.cardId);
       });
     });

     window.addEventListener("hashchange", () => {
       closeProfilePopover();
       if (window.location.hash === "#home") showHome();
       else if (window.location.hash === "#studio" || window.location.hash === "#room") showStudio();
     });
     if (window.location.hash === "#home") showHome();
     ```
3. Fix the `TypeError` risk in `cardButtonStates` (line 3362):
   ```ts
   // Before:
   : (status?.preparedCardIds.includes(card.id) ?? false);
   // After:
   : (status?.preparedCardIds?.includes(card.id) ?? false);
   ```

---

## 5. Verification Method

1. **Automated Workspace Test Suite**:
   Execute inside `workspace-prototype/`:
   ```powershell
   npm test
   ```
   Must pass all 63 existing tests cleanly.
2. **Dedicated Unit & Regression Test**:
   Create a test in `workspace-prototype/tests/card-floor-collision.test.mjs`:
   - Test that for any card at scale 1.0 or scale 1.18 (twisted), `clampCardAboveFloor` guarantees `Box3.min.y >= -0.12` outside dais and `>= 0.085` over dais.
   - Test that dragging simulation with pointer ray intersecting at $Y = -2.0$ never places card center lower than `surfaceY + halfExtent`.
   - Test that all `[data-open-studio]` buttons in `index.html` have listeners and fire navigation without throwing `TypeError` or `ReferenceError`.
3. **TypeScript Build Verification**:
   ```powershell
   npm run build
   ```
   Ensures `tsc --noEmit` and Vite production bundling exit with code 0.
4. **Invalidation Conditions**:
   - Any scenario where a card vertex has world coordinate $Y < -0.12$.
   - Any runtime error when clicking any of the 123 buttons in `index.html` or the 8 on-card canvas buttons.
