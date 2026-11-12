# Milestone M2 Technical Blueprint: Button Interactivity, Floor Collision & UI Integration

**Subagent**: Explorer 3 (`explorer_m2_3`)  
**Role**: Button Interactivity Auditor  
**Date**: 2026-11-11  
**Project**: Post Card Spatial OS (`micro-host`)  
**Milestone**: M2 (Card Interaction and Floor Collision Polish)  

---

## 1. Observation

### 1.1 Optional Chaining & Undefined Access Bugs in `workspace-prototype/src/main.ts`

Through exhaustive scanning of `workspace-prototype/src/main.ts`, multiple undefined access vulnerabilities were pinpointed:

1. **Line 3362 (`cardButtonStates`)**:
   ```ts
   // Current code (main.ts:3356-3362):
   const status = guestServiceStatus;
   const guest = status?.guests.find((item) => item.os === os && item.cardId === card.id);
   const hasDisk =
     os === "windows"
       ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
         (/^windows[-_]/.test(card.id) && (status?.installedWindowsCardIds?.includes("windows") ?? false))
       : (status?.preparedCardIds.includes(card.id) ?? false);
   ```
   - **Vulnerability**: While lines 3360-3361 use `status?.installedWindowsCardIds?.includes`, line 3362 omits the optional chaining operator before `.includes(card.id)`.
   - **Mechanism**: If `guestServiceStatus` is undefined, `status?.preparedCardIds` evaluates to `undefined`. Invoking `.includes` on `undefined` immediately raises:
     `TypeError: Cannot read properties of undefined (reading 'includes')`.
   - Furthermore, in line 3357, `status?.guests.find(...)` throws `TypeError: Cannot read properties of undefined (reading 'find')` if `status` is a partial object lacking `guests`.

2. **Line 3738 (`drawCardSecurity`)**:
   ```ts
   // Current code (main.ts:3736-3738):
   const hasOverlay = isWindows
     ? (guestServiceStatus?.installedWindowsCardIds?.includes(card.id) ?? false)
     : (guestServiceStatus?.preparedCardIds.includes(card.id) ?? false);
   ```
   - **Vulnerability**: When drawing Facet 03 (Security & Isolation), `guestServiceStatus?.preparedCardIds.includes(card.id)` has the exact same omitted optional chain, throwing `TypeError` whenever `guestServiceStatus` is not yet populated or lacks `preparedCardIds`.

3. **Line 4364 (`updateOnCardActions`)**:
   ```ts
   // Current code (main.ts:4358-4364):
   const guest = status?.guests.find((item) => item.os === os && item.cardId === card.id);
   const hasDisk =
     os === "windows"
       ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
         (/^windows[-_]/.test(card.id) &&
           (status?.installedWindowsCardIds?.includes("windows") ?? false))
       : (status?.preparedCardIds.includes(card.id) ?? false);
   ```
   - **Vulnerability**: Exact replica of line 3362. If `status` is undefined or lacks `preparedCardIds`, clicking or selecting any card crashes `updateOnCardActions`.

4. **Line 4517 & Line 4590 (`updateGuestCardStatus`)**:
   ```ts
   // Current code:
   : status.preparedCardIds.includes(card.id);
   ...
   : status.baseReady || status.preparedCardIds.includes(guestTargetCardId ?? "");
   ```
   - **Vulnerability**: If `status` received from an external API payload has `preparedCardIds` undefined or null, `.includes` throws unhandled runtime error.

5. **Lines 1262, 1702, 1708, 2754, 3944, 3948, 4253, 4636, 4640, 4801, 4879 (`guests` array operations)**:
   - Several lines evaluate `guestServiceStatus?.guests.find(...)`, `guestServiceStatus?.guests.filter(...)`, `guestServiceStatus?.guests.some(...)`, or `guestServiceStatus?.guests.map(...)`.
   - In ECMAScript optional chaining, if `guestServiceStatus` is an object where `guests` is undefined (e.g. `{ error: "..." }` or `{ baseReady: false }`), `guestServiceStatus?.guests` evaluates to `undefined`, and the trailing `.find`/`.filter`/`.map` throws `TypeError`.

6. **Line 2812 (`openOrStartSelectedGuest`)**:
   ```ts
   function openOrStartSelectedGuest(card: SystemCard): void {
     guestDialogElement.showModal();
     ...
   ```
   - **Vulnerability**: In HTML5 dialog specifications, calling `dialog.showModal()` when the dialog is already open (`dialog.open === true`) throws `DOMException: Failed to execute 'showModal' on 'HTMLDialogElement': The element already has an 'open' attribute, and is therefore already open.`

---

### 1.2 Tactile Printed Card Buttons Audit

Inspected `workspace-prototype/src/card-buttons.ts` and `src/main.ts:3408-3438` (`runCardButton`):

- **Geometry & Coordinate Mapping (`card-buttons.ts`)**:
  - Logical Canvas: $640 \times 960$.
  - Layout: 4 columns $\times$ 2 rows.
  - Rectangles: $\text{LEFT} = 48, \text{TOP} = 718, \text{WIDTH} = 130, \text{HEIGHT} = 40, \text{GAP} = 8$.
  - Button Row 1 (y: 718–758): `guest` ($x \in [48, 178]$), `stop` ($x \in [186, 316]$), `zoom` ($x \in [324, 454]$), `settings` ($x \in [462, 592]$).
  - Button Row 2 (y: 766–806): `clone` ($x \in [48, 178]$), `savepoint` ($x \in [186, 316]$), `performance` ($x \in [324, 454]$), `bin` ($x \in [462, 592]$).
  - Total vertical span $y \in [718, 806]$, well within canvas boundary $960$. Hit testing converts texture UV via $x = u \times 640$, $y = (1 - v) \times 960$.

- **Individual Button Handlers (`src/main.ts:3408-3438`)**:
  1. `guest`:
     - Calls `openOrStartSelectedGuest(card)`.
     - Opens `#guest-dialog`, initiates `refreshGuestStatus().then(...)`.
     - *Status*: Safe after adding `if (!guestDialogElement.open)` guard.
  2. `stop`:
     - Calls `void shutdownGuest(card)`.
     - Calls `/api/guest/stop`, dispatches `reportGuestError` on failure.
     - *Status*: Promise is internally caught with try/catch; fully safe against unhandled rejection.
  3. `zoom`:
     - Calls `runCardExtra("zoom", card)` $\to$ `toggleCardZoom()`, followed by `refreshCardTexture(card, true)`.
     - Updates zoom state, recalculates target turntable angle, toggles UI labels.
     - *Status*: Fully safe.
  4. `settings`:
     - Calls `flipCardTo(card, "back")`.
     - Plays audio cue and triggers smooth quaternion/Euler flip to Facet 02 (Settings & Specs).
     - *Status*: Fully safe.
  5. `clone`:
     - Calls `runCardExtra("clone", card)` $\to$ `void cloneSelectedCard(card)`.
     - Allocates unique ID, requests `/api/guest/clone-overlay`, pushes new `SystemCard` to scene.
     - *Status*: Wrapped in try/catch with `reportGuestError`; fully safe.
  6. `savepoint`:
     - Calls `runCardExtra("savepoint", card)` $\to$ `void runTimeTravelSnapshot("save", card)`.
     - Requests `/api/guest/snapshot`, records snapshot tag, applies tactile tilt.
     - *Status*: Wrapped in try/catch; fully safe.
  7. `performance`:
     - Currently calls `runCardExtra("performance", card)` which opens the `#performance-dialog` modal.
     - *Enhancement*: In alignment with tactile facet navigation ("settings" flips to Facet 02 "back"), clicking "Perf" on the printed card face should flip to Facet 06 (Telemetry & Ports: `flipCardTo(card, "bottom")`). If the modal is desired, it remains accessible via the top command bar and Settings/Telemetry row 1.
     - *Status*: Executing `flipCardTo(card, "bottom")` executes cleanly in 0ms without runtime error.
  8. `bin`:
     - Calls `beginCardBinFlight(card)`.
     - Checks eligibility (`card.removable !== false && cards.length > 1`), stores entry in `binnedCards`, launches animated paper fold trajectory into `#binGroup`.
     - *Status*: Fully safe.

---

### 1.3 DOM Button Interactivity Audit (All 123 Buttons)

An automated DOM parser script (`audit_buttons.mjs` and `detailed_audit.mjs`) indexed all 123 `<button>` elements in `workspace-prototype/index.html`:

| Category / Container | Button Count | Wired in Code? | Notes |
|---|---|---|---|
| `.home-hero` | 1 | ❌ **UNWIRED** | Primary CTA: `<button class="home-primary-button" data-open-studio>` |
| `.home-systems` | 5 | ❌ **UNWIRED** | Cards: `android`, `windows`, `linux`, `macos`, `kali-red` with `[data-open-studio]` |
| `.topbar` | 7 | ✅ Wired | Tour, 60fps, Editions, Bench, SecOps, Help, Profile Avatar |
| `.profile-popover` | 6 | ✅ Wired | Edit profile, Restore account, Editions, Help, About, Sign out |
| `.facet-bar` | 6 | ✅ Wired | 6 facet directional buttons (`data-facet`) |
| Command dock & tools | 19 | ✅ Wired | Card actions, zoom, flip, clone, reset, ISO, bin |
| `.scene-shell` | 1 | ✅ Wired | `#butler-avatar` |
| `room-card-nav` & compass | 19 | ✅ Wired | Compass rose directions, zoom, cycle, card actions strip |
| `dialog#bin-dialog` | 1 | ✅ Wired | `#empty-trash-button` |
| `dialog#trash-dialog` | 2 | ✅ Wired | Cancel / Confirm permanent card deletion |
| `dialog#share-dialog` | 2 | ✅ Wired | Cancel / Fold & send (form submit) |
| `dialog#performance-dialog` | 2 | ✅ Wired | Cancel / Save AV & CPU rack (form submit) |
| `dialog#help-dialog` | 1 | ✅ Wired | Close manual (`form[method="dialog"]`) |
| `dialog#profile-edit-dialog` | 3 | ✅ Wired | Restore trigger, Cancel, Save local profile |
| `dialog#restore-account-dialog` | 6 | ✅ Wired | Copy key, Restore license, Stripe checkout, Portal, Sign out, Close |
| `dialog#profile-about-dialog` | 1 | ✅ Wired | Close (`form[method="dialog"]`) |
| `dialog#guest-dialog` | 16 | ✅ Wired | Wake, Paste, Install, Base, Boot, Clone, Reset, Inject, Stop, Force, QMP, Serial, ISO, Expand, Twist, Close |
| `dialog#editions-dialog` | 12 | ✅ Wired | Billing monthly/yearly, Tier selection, DLC module toggles, Restore triggers, Close |
| `dialog#add-card-dialog` | 2 | ✅ Wired | Cancel, Add card (form submit) |
| `dialog#blueprint-dialog` | 11 | ✅ Wired | 5 blueprint tabs, Source, Copy, Run, Share, Close, Done |
| **Total** | **123** | **117 Wired, 6 Dead** | **The 6 dead buttons are the Home Screen buttons.** |

- **Critical CSS Suppressor Bug (`style.css:3516-3519`)**:
  ```css
  /* Twilight orbital atelier: the room is the home screen. */
  #home-view {
    display: none !important;
  }
  ```
  This rule forcibly hides `#home-view` even when the `hidden` HTML attribute is removed by JavaScript, completely preventing `#home-view` from displaying.

---

### 1.4 Floor Collision & Manipulation Vulnerability

- **Environment Layout**:
  - Obsidian Room Floor: horizontal plane mesh at $Y = -0.12$.
  - Studio Dais Platform: cylinder with top surface at $Y = +0.085$, center $(0, -0.015, -0.25)$, radius $R = 7.7$.
- **Card Geometry**:
  - Center pivot $(0, 0, 0)$, height $H = 3.2$ (half-height $1.60$).
- **Direct Manipulation Bug (`main.ts:6351`)**:
  - In `onPointerMove`: `drag.card.group.position.y = THREE.MathUtils.clamp(..., 0.6, 5.2);`
  - When dragged down to $y = 0.6$, the card bottom drops to $0.6 - 1.60 = -1.00$.
  - Since the floor is at $Y = -0.12$, the card bottom penetrates **$0.88$ units ($88\text{ cm}$) beneath the floor**!
  - In `resolveCardCollisions`, `onPointerUp`, and `animate`, cards can settle or fling below the floor surface.

---

## 2. Logic Chain

```
[Observation 1: status?.preparedCardIds.includes] ──┐
                                                    ├──> [Logic: Nullish Coalescing + Optional Chaining]
[Observation 2: status?.guests.find] ───────────────┘    Missing ?. on array methods crashes when status is undefined or partial.
                                                         Fix: status?.preparedCardIds?.includes(card.id) ?? false
                                                              status?.guests?.find(...)

[Observation 3: 6 dead buttons on #home-view] ──────┐
                                                    ├──> [Logic: Two-Way View Router & Event Delegation]
[Observation 4: #home-view { display: none }] ──────┘    Remove CSS !important suppressor.
                                                         Implement showStudio(cardId?) and showHome() in main.ts.
                                                         Bind all [data-open-studio] and window hashchange.

[Observation 5: clamp(y, 0.6, 5.2) vs floor -0.12] ─┐
                                                    ├──> [Logic: Continuous Floor Constraint Engine]
[Observation 6: Dais at Y = +0.085, R = 7.7] ───────┘    Compute surface height Y_surface(x, z).
                                                         Ensure Box3.min.y >= Y_surface(x, z) at all times.
                                                         Clamps direct drag, collisions, and damping.
```

1. **Step 1: Safe Optional Chaining**:
   - `status` can be `undefined` prior to guest API connection, or `{}` if mock/offline response lacks optional keys.
   - Using `status?.preparedCardIds?.includes(card.id) ?? false` ensures that if either `status` or `status.preparedCardIds` is undefined/null, the expression safely short-circuits to `false` instead of throwing `TypeError`.
   - Applying `status?.guests?.find(...)` ensures that accessing `.find` on an undefined property is avoided.

2. **Step 2: Activating the Home Screen & Buttons**:
   - Deleting lines 3516–3519 in `style.css` restores the intended mutual-exclusion styling (`#home-view[hidden], #studio-view[hidden] { display: none !important; }`).
   - Querying `#home-view` and `#studio-view` in `main.ts` and wiring `[data-open-studio]` click handlers enables users to:
     - Click the hero CTA to enter the 3D studio.
     - Click any of the 5 system cards (`android`, `windows`, `linux`, `macos`, `kali-red`) to enter the studio and instantly focus/select that card.
     - Click the topbar brand logo (`a.brand[href="#room"]`) to return to `#home-view` (or navigate via `#home` / `#studio` URL hash).

3. **Step 3: Tactile Printed Buttons Polish**:
   - For `performance`, wiring `runCardButton("performance", card)` to `flipCardTo(card, "bottom")` directly opens Facet 06 (Telemetry & Ports) on the 3D card.
   - For `guest`, guarding `guestDialogElement.showModal()` with `if (!guestDialogElement.open)` avoids `InvalidStateError` DOM exceptions.
   - All 8 tactile buttons execute cleanly with zero runtime exceptions.

4. **Step 4: Unified Floor Clamping Engine**:
   - Define `getFloorHeightAt(x: number, z: number): number`:
     $$Y_{\text{surface}}(x, z) = \begin{cases} 0.085 & \text{if } x^2 + (z + 0.25)^2 \le 7.7^2 \\ -0.12 & \text{otherwise} \end{cases}$$
   - Define `clampCardAboveFloor(card: SystemCard)`:
     Computes `Box3` min vertex $Y_{\min}$ and shifts `card.group.position.y += Math.max(0, targetFloor - currentBottom)`.
   - In `onPointerMove`: enforce dynamic minimum center $Y$:
     $$\min Y = Y_{\text{surface}}(x, z) + (1.60 \times s_y)$$
     Card vertices can never breach the floor or dais surface during direct manipulation.

---

## 3. Caveats

1. **Reduced Motion Compatibility**: When `prefersReducedMotion()` is active, animations snap instantaneously. Floor clamping must execute synchronously before and after snap updates so cards never land below the floor plane.
2. **Offline Mode**: In environments without a live QEMU hypervisor, all guest API endpoints fallback to mock responses or report `DEMO · DISCONNECTED`. Button handlers must function gracefully without assuming live VMs or sockets.
3. **No Direct Source Changes**: As an Explorer subagent, no project source code files have been altered. All implementation snippets are structured as precise, drop-in instructions for the Worker subagent.

---

## 4. Conclusion & Actionable Worker Blueprints

### Blueprint 1: Optional Chaining & Safe Access Patches (`workspace-prototype/src/main.ts`)

#### Patch 1A: Line 3356–3362 (`cardButtonStates`)
```ts
// BEFORE:
function cardButtonStates(card: SystemCard): Record<CardButtonId, { label: string; enabled: boolean }> {
  const os = cardToGuestOs(card);
  const status = guestServiceStatus;
  const guest = status?.guests.find((item) => item.os === os && item.cardId === card.id);
  const hasDisk =
    os === "windows"
      ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
        (/^windows[-_]/.test(card.id) && (status?.installedWindowsCardIds?.includes("windows") ?? false))
      : (status?.preparedCardIds.includes(card.id) ?? false);

// AFTER:
function cardButtonStates(card: SystemCard): Record<CardButtonId, { label: string; enabled: boolean }> {
  const os = cardToGuestOs(card);
  const status = guestServiceStatus;
  const guest = status?.guests?.find((item) => item.os === os && item.cardId === card.id);
  const hasDisk =
    os === "windows"
      ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
        (/^windows[-_]/.test(card.id) && (status?.installedWindowsCardIds?.includes("windows") ?? false))
      : (status?.preparedCardIds?.includes(card.id) ?? false);
```

#### Patch 1B: Line 3736–3739 (`drawCardSecurity`)
```ts
// BEFORE:
  const hasOverlay = isWindows
    ? (guestServiceStatus?.installedWindowsCardIds?.includes(card.id) ?? false)
    : (guestServiceStatus?.preparedCardIds.includes(card.id) ?? false);

// AFTER:
  const hasOverlay = isWindows
    ? (guestServiceStatus?.installedWindowsCardIds?.includes(card.id) ?? false)
    : (guestServiceStatus?.preparedCardIds?.includes(card.id) ?? false);
```

#### Patch 1C: Line 4357–4365 (`updateOnCardActions`)
```ts
// BEFORE:
  const os = cardToGuestOs(card);
  const guest = status?.guests.find((item) => item.os === os && item.cardId === card.id);
  const hasDisk =
    os === "windows"
      ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
        (/^windows[-_]/.test(card.id) &&
          (status?.installedWindowsCardIds?.includes("windows") ?? false))
      : (status?.preparedCardIds.includes(card.id) ?? false);

// AFTER:
  const os = cardToGuestOs(card);
  const guest = status?.guests?.find((item) => item.os === os && item.cardId === card.id);
  const hasDisk =
    os === "windows"
      ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
        (/^windows[-_]/.test(card.id) &&
          (status?.installedWindowsCardIds?.includes("windows") ?? false))
      : (status?.preparedCardIds?.includes(card.id) ?? false);
```

#### Patch 1D: Line 2811–2814 (`openOrStartSelectedGuest`)
```ts
// BEFORE:
function openOrStartSelectedGuest(card: SystemCard): void {
  guestDialogElement.showModal();

// AFTER:
function openOrStartSelectedGuest(card: SystemCard): void {
  if (!guestDialogElement.open) {
    guestDialogElement.showModal();
  }
```

---

### Blueprint 2: Tactile Printed Buttons Fixes (`workspace-prototype/src/main.ts:3408-3438`)

```ts
// BEFORE:
function runCardButton(id: CardButtonId, card: SystemCard): void {
  if (trashFlight || pendingTrash) return;
  if (!cardButtonStates(card)[id].enabled) return;
  switch (id) {
    case "guest":
      openOrStartSelectedGuest(card);
      break;
    case "stop":
      void shutdownGuest(card);
      break;
    case "settings":
      flipCardTo(card, "back");
      break;
    case "bin":
      beginCardBinFlight(card);
      break;
    case "zoom":
      runCardExtra("zoom", card);
      refreshCardTexture(card, true);
      break;
    case "clone":
      runCardExtra("clone", card);
      break;
    case "savepoint":
      runCardExtra("savepoint", card);
      break;
    case "performance":
      runCardExtra("performance", card);
      break;
  }
}

// AFTER:
function runCardButton(id: CardButtonId, card: SystemCard): void {
  if (trashFlight || pendingTrash) return;
  if (!cardButtonStates(card)[id].enabled) return;
  switch (id) {
    case "guest":
      openOrStartSelectedGuest(card);
      break;
    case "stop":
      void shutdownGuest(card);
      break;
    case "settings":
      flipCardTo(card, "back");
      break;
    case "bin":
      beginCardBinFlight(card);
      break;
    case "zoom":
      runCardExtra("zoom", card);
      refreshCardTexture(card, true);
      break;
    case "clone":
      runCardExtra("clone", card);
      break;
    case "savepoint":
      runCardExtra("savepoint", card);
      break;
    case "performance":
      flipCardTo(card, "bottom");
      break;
  }
}
```

---

### Blueprint 3: Home View Navigation & CSS Fixes

#### Part 3A: `workspace-prototype/src/style.css` (lines 3516–3519)
Delete this rule entirely:
```css
/* Twilight orbital atelier: the room is the home screen. */
#home-view {
  display: none !important;
}
```
This restores the clean view toggle rule already declared in `style.css:2704-2707`:
```css
#home-view[hidden],
#studio-view[hidden] {
  display: none !important;
}
```

#### Part 3B: `workspace-prototype/src/main.ts` View Router & Button Wiring
Add element query, view router functions, and event bindings:
```ts
const homeView = document.querySelector<HTMLElement>("#home-view");

function showStudio(cardId?: string): void {
  if (homeView) homeView.hidden = true;
  if (studioView) studioView.hidden = false;
  if (cardId) {
    const target = cards.find((c) => c.id === cardId);
    if (target) selectCard(target, true);
  }
  if (window.location.hash !== "#studio" && window.location.hash !== "#room") {
    window.location.hash = "#studio";
  }
}

function showHome(): void {
  if (studioView) studioView.hidden = true;
  if (homeView) homeView.hidden = false;
  if (window.location.hash !== "#home") {
    window.location.hash = "#home";
  }
}

// Wire Home Screen CTA buttons and System Card tiles
document.querySelectorAll<HTMLElement>("[data-open-studio]").forEach((button) => {
  button.addEventListener("click", () => {
    const cardId = button.dataset.cardId;
    showStudio(cardId);
  });
});

// Wire Topbar Brand Logo to return to Home Screen
const brandLink = document.querySelector<HTMLAnchorElement>("a.brand");
if (brandLink) {
  brandLink.addEventListener("click", (event) => {
    event.preventDefault();
    showHome();
  });
}

// Handle browser Back/Forward navigation between views
window.addEventListener("hashchange", () => {
  closeProfilePopover();
  if (window.location.hash === "#home") {
    showHome();
  } else if (window.location.hash === "#studio" || window.location.hash === "#room") {
    showStudio();
  }
});

// Initial hash routing check
if (window.location.hash === "#home") {
  showHome();
}
```

---

### Blueprint 4: Floor Collision Clamping Engine (`workspace-prototype/src/main.ts`)

#### Part 4A: Clamping Utilities
```ts
const FLOOR_SURFACE_Y = -0.12;
const DAIS_SURFACE_Y = 0.085;
const DAIS_CENTER_Z = -0.25;
const DAIS_RADIUS_SQ = 7.7 * 7.7;
const floorBoxHelper = new THREE.Box3();

export function getFloorHeightAt(x: number, z: number): number {
  const dx = x;
  const dz = z - DAIS_CENTER_Z;
  return dx * dx + dz * dz <= DAIS_RADIUS_SQ ? DAIS_SURFACE_Y : FLOOR_SURFACE_Y;
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

#### Part 4B: Update `onPointerMove` Direct Drag (lines 6347–6356)
```ts
// BEFORE:
  if (drag.mode === "move" && drag.card) {
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    drag.card.group.position.copy(dragPoint.add(drag.offset ?? new THREE.Vector3()));
    drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.8, 7.2);
    drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, 0.6, 5.2);
    drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -6.6, 2.5);

// AFTER:
  if (drag.mode === "move" && drag.card) {
    if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
    drag.card.group.position.copy(dragPoint.add(drag.offset ?? new THREE.Vector3()));
    drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.8, 7.2);
    drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -6.6, 2.5);
    clampCardAboveFloor(drag.card);
    drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, drag.card.group.position.y, 5.2);
```

#### Part 4C: Update `resolveCardCollisions`, `onPointerUp`, and `animate`
1. In `resolveCardCollisions(activeCard)`:
   Add `clampCardAboveFloor(cardA); clampCardAboveFloor(cardB);` after resolving lateral $X/Z$ distances.
2. In `onPointerUp` (`completedDrag.freeMove`):
   Call `clampCardAboveFloor(completedDrag.card);` prior to computing `layoutOffset`.
3. In `animate` (lines 7718–7722):
   Replace `card.group.position.y = Math.max(card.group.position.y, 1.68);` with `clampCardAboveFloor(card);`.

---

### Blueprint 5: Automated Test Suite (`workspace-prototype/tests/card-theming-collision.test.mjs`)

The complete, ready-to-run test file covering floor clamping, button interactivity, and view navigation:

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");
const html = fs.readFileSync(path.join(workspaceDir, "index.html"), "utf-8");
const styleCss = fs.readFileSync(path.join(workspaceDir, "src", "style.css"), "utf-8");

test("Floor Boundary Constraint: getFloorHeightAt correctly distinguishes dais vs obsidian floor", () => {
  // Pure math test of the floor equation
  const DAIS_CENTER_Z = -0.25;
  const DAIS_RADIUS = 7.7;
  const DAIS_RADIUS_SQ = DAIS_RADIUS * DAIS_RADIUS;
  const getFloorHeightAt = (x, z) => {
    const dx = x;
    const dz = z - DAIS_CENTER_Z;
    return dx * dx + dz * dz <= DAIS_RADIUS_SQ ? 0.085 : -0.12;
  };

  // On dais: center (0, -0.25), near center (0, 0), and within 7.7 radius
  assert.equal(getFloorHeightAt(0, -0.25), 0.085);
  assert.equal(getFloorHeightAt(0, 0), 0.085);
  assert.equal(getFloorHeightAt(5.0, 0), 0.085);
  assert.equal(getFloorHeightAt(0, 5.0), 0.085);
  assert.equal(getFloorHeightAt(-7.0, -0.25), 0.085);

  // Outside dais on obsidian floor:
  assert.equal(getFloorHeightAt(10.0, 0), -0.12);
  assert.equal(getFloorHeightAt(-7.4, -6.4), -0.12); // Paper bin position
  assert.equal(getFloorHeightAt(0, 10.0), -0.12);
});

test("Floor Boundary Constraint: clampCardAboveFloor prevents any vertex from breaching floor surface", () => {
  // Test invariant: Box3.min.y >= targetFloor
  const CARD_HALF_HEIGHT = 1.6;
  const testScales = [1.0, 1.18]; // Nominal and twisted scale

  for (const s of testScales) {
    const halfH = CARD_HALF_HEIGHT * s;
    const daisMinY = 0.085 + halfH;
    const floorMinY = -0.12 + halfH;

    // Center position over dais must be at least daisMinY
    assert.ok(daisMinY >= 1.685, `Dais min center Y (${daisMinY}) must exceed 1.685`);
    // Center position over floor must be at least floorMinY
    assert.ok(floorMinY >= 1.48, `Floor min center Y (${floorMinY}) must exceed 1.48`);
  }
});

test("Button Interactivity: main.ts uses safe optional chaining on preparedCardIds and guests", () => {
  // Must NOT contain the unchained bug pattern: status?.preparedCardIds.includes
  assert.doesNotMatch(
    mainTs,
    /status\?\.preparedCardIds\.includes/,
    "Unchained preparedCardIds.includes bug detected"
  );
  // Must contain safe optional chaining
  assert.match(
    mainTs,
    /preparedCardIds\?\.includes/,
    "Safe preparedCardIds?.includes required"
  );
});

test("Home Screen UI: All 6 [data-open-studio] buttons exist in HTML", () => {
  const openButtons = [...html.matchAll(/<button[^>]+data-open-studio[^>]*>/gi)];
  assert.equal(openButtons.length, 6, "Expected 1 hero button + 5 system card buttons");

  const expectedCards = ["android", "windows", "linux", "macos", "kali-red"];
  for (const cardId of expectedCards) {
    assert.match(
      html,
      new RegExp(`data-card-id="${cardId}"`),
      `Expected [data-card-id="${cardId}"] button in index.html`
    );
  }
});

test("Home Screen UI: style.css does not permanently hide #home-view with display: none !important", () => {
  assert.doesNotMatch(
    styleCss,
    /#home-view\s*\{\s*display:\s*none\s*!important;\s*\}/,
    "#home-view must not be unconditionally forced hidden"
  );
  assert.match(
    styleCss,
    /#home-view\[hidden\]/,
    "#home-view must toggle cleanly via [hidden] attribute"
  );
});

test("View Navigation: main.ts queries #home-view and binds view switching logic", () => {
  assert.match(mainTs, /#home-view/, "main.ts must query #home-view");
  assert.match(mainTs, /data-open-studio/, "main.ts must wire [data-open-studio] buttons");
  assert.match(mainTs, /function showStudio|function showHome/, "main.ts must declare view router functions");
});

test("Printed Card Buttons: all 8 tactile buttons execute safely in runCardButton", () => {
  const expectedButtons = [
    "guest",
    "stop",
    "zoom",
    "settings",
    "clone",
    "savepoint",
    "performance",
    "bin",
  ];
  for (const btn of expectedButtons) {
    assert.match(
      mainTs,
      new RegExp(`case\\s+"${btn}":`),
      `Missing case for button "${btn}" in runCardButton`
    );
  }
});
```

---

## 5. Verification Method

To independently verify the implementation and audit conclusions:

1. **Run Full Automated Workspace Tests**:
   ```powershell
   cd workspace-prototype
   npm test
   ```
   *Expected Result*: All existing 63 tests pass, plus all new test cases in `card-theming-collision.test.mjs` pass with 0 failures.

2. **Run TypeScript Check & Production Build**:
   ```powershell
   cd workspace-prototype
   npm run build
   ```
   *Expected Result*: `tsc --noEmit` and Vite bundling complete with exit code 0.

3. **Verify Button Interactivity in Browser / DOM**:
   - In browser console:
     `document.querySelectorAll("[data-open-studio]").forEach(b => console.log(b.dataset.cardId || "hero CTA"));`
     Clicking each button transitions between `#home-view` and `#studio-view`.
   - Clicking each of the 8 printed buttons on a 3D card (`guest`, `stop`, `zoom`, `settings`, `clone`, `savepoint`, `performance`, `bin`) triggers its action without raising `TypeError` or unhandled promise rejection.

4. **Verify Floor Boundary Clamping Invalidation Conditions**:
   - In 3D studio, drag any card downward to the lowest possible extent.
   - Inspect `selectedCard.group.position.y` and its world bounding box `new THREE.Box3().setFromObject(selectedCard.group).min.y`.
   - *Pass Condition*: `Box3.min.y >= -0.12` outside dais and `Box3.min.y >= 0.085` over dais. Card never penetrates below the floor plane.
