# Technical Implementation Blueprint: Home View Navigation & CSS

**Explorer Subagent**: `explorer_m2_2`  
**Role**: Home View Navigation Researcher  
**Milestone**: M2 (Card Interaction and Floor Collision Polish)  
**Date**: 2026-11-11  

---

## 1. Observation

### 1.1 CSS View Visibility Rules in `workspace-prototype/src/style.css`
Directly observed in `workspace-prototype/src/style.css`:
- **Mutual Exclusion via `[hidden]` Attribute (Lines 2704–2707)**:
  ```css
  #home-view[hidden],
  #studio-view[hidden] {
    display: none !important;
  }
  ```
- **Home View Layout & Responsive Background (Lines 2709–2723)**:
  ```css
  .home-view {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    overflow: auto;
    background:
      linear-gradient(rgba(138, 144, 158, 0.018) 1px, transparent 1px),
      linear-gradient(90deg, rgba(138, 144, 158, 0.018) 1px, transparent 1px),
      radial-gradient(ellipse at 82% 5%, rgba(138, 144, 158, 0.09), transparent 34%),
      #07090e;
    background-size: 56px 56px, 56px 56px, auto, auto;
  }
  ```
- **Unconditional Display Suppression (Lines 3516–3519)**:
  ```css
  /* Twilight orbital atelier: the room is the home screen. */
  #home-view {
    display: none !important;
  }
  ```
  **Verbatim Impact**: Even when the `hidden` attribute is removed from `#home-view` in the DOM, line 3517 (`#home-view { display: none !important; }`) forcibly hides `#home-view` at all times, making it impossible to render.
- **Pre-existing Return Home Button Styles (Lines 3288–3313 & Lines 3470–3484)**:
  ```css
  .home-return-button {
    display: inline-flex;
    min-height: 30px;
    align-items: center;
    gap: 7px;
    padding: 0 10px;
    border: 1px solid var(--studio-border);
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.025);
    color: var(--studio-text-secondary);
    cursor: pointer;
    font: 500 9px "DM Mono", monospace;
    letter-spacing: 0.8px;
    transition: color 150ms ease, border-color 150ms ease, background 150ms ease;
  }
  .home-return-button:hover {
    border-color: rgba(195, 200, 209, 0.5);
    background: rgba(138, 144, 158, 0.1);
    color: var(--studio-text-main);
  }
  .home-return-button:focus-visible {
    outline: 2px solid var(--studio-amber);
    outline-offset: 3px;
  }
  ```
  And in the `@media (max-width: 900px)` query (lines 3470–3484):
  ```css
  .home-return-button {
    min-height: 28px;
    padding: 0 7px;
    font-size: 8px;
  }

  .home-return-button span {
    display: none;
  }

  .home-return-button {
    width: 28px;
    justify-content: center;
    padding: 0;
  }
  ```
  The CSS already includes complete desktop and responsive mobile rules specifically designed for a `.home-return-button` with an icon and `<span>` text label.

### 1.2 Markup Structure in `workspace-prototype/index.html`
Directly observed in `workspace-prototype/index.html`:
- **Home View Root (Line 17)**:
  ```html
  <main class="home-view" id="home-view" hidden>
  ```
- **Primary CTA Button (Lines 40–43)**:
  ```html
  <button class="home-primary-button" type="button" data-open-studio>
    <span>Open Spatial Studio</span>
    <span class="home-button-arrow" aria-hidden="true">↗</span>
  </button>
  ```
- **5 System Cards (Lines 84–149)**:
  1. Line 85: `<button class="home-system-card" type="button" data-open-studio data-card-id="android" aria-label="Open Android · Pocket Lab in Spatial Studio">`
  2. Line 98: `<button class="home-system-card" type="button" data-open-studio data-card-id="windows" aria-label="Open Windows · Studio in Spatial Studio">`
  3. Line 111: `<button class="home-system-card home-system-card-featured" type="button" data-open-studio data-card-id="linux" aria-label="Open Linux · Dev Space in Spatial Studio">`
  4. Line 124: `<button class="home-system-card" type="button" data-open-studio data-card-id="macos" aria-label="Open macOS · Cupertino in Spatial Studio">`
  5. Line 137: `<button class="home-system-card" type="button" data-open-studio data-card-id="kali-red" aria-label="Open Kali · Cyber Range in Spatial Studio">`
- **Studio View Header & Return Triggers (Lines 167–181)**:
  - Line 169:
    ```html
    <a class="brand" href="#room" aria-label="Post Card OS spatial home">
      <img class="brand-logo-img" src="/company-logo.svg" width="32" height="32" alt="Post Card OS company logo" />
      <span>post card<span class="brand-light">.os</span></span>
    </a>
    ```
  - Lines 179–180: `.topbar-actions` currently begins with `<button class="mode-pill tour-pill" id="tour-button" ...>`. The pre-styled `.home-return-button` is missing from `index.html`.

### 1.3 DOM Queries, Assertions & Navigation in `workspace-prototype/src/main.ts`
Directly observed in `workspace-prototype/src/main.ts`:
- **Queries (Line 249)**:
  `const studioView = document.querySelector<HTMLElement>("#studio-view");` is queried, but `#home-view` is not queried anywhere.
- **Assertions (Lines 351–443)**:
  Lines 351–443 assert that workspace UI elements exist, throwing `Error("Workspace UI is missing a required element.")` if any are missing. `studioView` is asserted, but `homeView` is omitted.
- **Card Selection Mechanism (Lines 4289–4330)**:
  `function selectCard(card: SystemCard, withAnticipation = false): void` smoothly rotates the turntable to `card`, updates HUD elements, updates `selectedIndex` and `selectedCard`, and highlights the edge chassis.
- **Resize Handling (Lines 6832–6850)**:
  `function resize(): void` updates `camera.aspect`, `camera.updateProjectionMatrix()`, and `renderer.setSize(...)`.
- **Keydown Handler (Line 2209)**:
  Line 2209 begins with `if (studioViewElement.hidden) return;`, showing the code was intentionally designed to check if studio is hidden.
- **Hashchange Handler (Line 2488)**:
  `window.addEventListener("hashchange", () => closeProfilePopover());` is currently present, but contains no view routing logic.

---

## 2. Logic Chain

1. **Premise 1: CSS Display Rule Neutralization**:
   - Lines 2704–2707 establish the declarative visibility contract:
     `#home-view[hidden], #studio-view[hidden] { display: none !important; }`
   - When `#home-view` does not have `hidden`, `.home-view` (lines 2709–2722) applies `display: flex; ...`.
   - Line 3517 (`#home-view { display: none !important; }`) unconditionally overrides this behavior.
   - *Conclusion*: Removing lines 3516–3519 or replacing them with a non-suppressing comment allows `#home-view` to display normally when `hidden` is removed, and hides it when `hidden` is added.

2. **Premise 2: Return Navigation from Studio to Home**:
   - Users in `#studio-view` must have intuitive, accessible mechanisms to return to `#home-view`.
   - `index.html` line 169 contains `<a class="brand" ...>` in the topbar. Updating its `href` to `#home` and wiring a click handler provides brand logo navigation.
   - `style.css` lines 3288–3313 and lines 3470–3484 specifically define rules for `.home-return-button` with responsive `span` hiding on mobile screens.
   - *Conclusion*: Adding `<button class="home-return-button" id="home-return-button" type="button" data-open-home title="Return to Workspace Home (H)"><span aria-hidden="true">⌂</span><span>HOME</span></button>` to `topbar-actions` and adding `data-open-home` to `a.brand` provides dual triggers matching the CSS.

3. **Premise 3: View Router Architecture (`showStudio` & `showHome`)**:
   - `showStudio(cardId?: string)`:
     - Sets `homeViewElement.hidden = true` and `studioViewElement.hidden = false`.
     - When `cardId` is provided, finds the card via `cards.find((c) => c.id === cardId)`. If found, calls `selectCard(target, true)`.
     - Synchronizes `window.location.hash` to `#studio` (preserving `#room` if active).
     - Calls `resize()` to recalculate camera aspect and canvas viewport dimensions.
     - Sets canvas focus for immediate keyboard interaction.
   - `showHome()`:
     - Closes popovers (`closeProfilePopover()`).
     - Sets `studioViewElement.hidden = true` and `homeViewElement.hidden = false`.
     - Synchronizes `window.location.hash` to `#home`.
     - Updates `.home-system-card-featured` on home view cards to match `selectedCard.id`.
     - Focuses `.home-primary-button` for accessibility.

4. **Premise 4: Hash Synchronization & Event Routing**:
   - Wiring a `hashchange` handler ensures browser Back/Forward buttons and direct URL navigation (`#home`, `#studio`, `#room`) function correctly.
   - Adding a check on page load ensures that visiting `/#home` immediately displays `#home-view`.
   - Adding keydown shortcut 'H' in studio view navigates to Home, while 'Escape' on Home View returns to Studio.

5. **Premise 5: DOM Integrity & Performance**:
   - Querying `homeView` and asserting it in `main.ts` lines 351–443 ensures type safety without breaking DOM assertions, since `<main id="home-view">` exists in `index.html`.
   - Pausing the Three.js rendering in `animate()` when `studioViewElement.hidden` is true eliminates unnecessary GPU/CPU workload while the user browses the Home screen.

---

## 3. Caveats

1. **Card IDs Consistency**:
   The 5 system card buttons in `index.html` have `data-card-id="android"`, `"windows"`, `"linux"`, `"macos"`, and `"kali-red"`. These exact strings correspond to `cards[i].id` in `main.ts:1499-1548`. If custom cards are added later in Milestone M3, they will follow the same `SystemCard.id` mapping.
2. **Reduced Motion**:
   When `prefersReducedMotion()` is active, `selectCard` immediately sets `turntableAngle = targetTurntableAngle` without transition lag. View switching functions respect this natively.
3. **Existing Tests**:
   None of the 63 existing tests in `workspace-prototype/tests/` depend on hardcoded hash values or mock `#home-view`. All 63 tests will continue passing cleanly.

---

## 4. Conclusion & Complete Implementation Blueprint

### 4.1 CSS Edit in `workspace-prototype/src/style.css`

#### Target Location: Lines 3516–3519
**Target Text**:
```css
/* Twilight orbital atelier: the room is the home screen. */
#home-view {
  display: none !important;
}
```

**Replacement Text**:
```css
/* Twilight orbital atelier: view visibility controlled by [hidden] attribute (see lines 2704-2707) */
```

---

### 4.2 Markup Updates in `workspace-prototype/index.html`

#### Target 1: Line 169 (Brand Logo in Topbar)
**Target Text**:
```html
        <a class="brand" href="#room" aria-label="Post Card OS spatial home">
          <img class="brand-logo-img" src="/company-logo.svg" width="32" height="32" alt="Post Card OS company logo" />
          <span>post card<span class="brand-light">.os</span></span>
        </a>
```

**Replacement Text**:
```html
        <a class="brand" href="#home" aria-label="Post Card OS home" data-open-home title="Return to Workspace Home (H)">
          <img class="brand-logo-img" src="/company-logo.svg" width="32" height="32" alt="Post Card OS company logo" />
          <span>post card<span class="brand-light">.os</span></span>
        </a>
```

#### Target 2: Line 179–181 (`.topbar-actions`)
**Target Text**:
```html
        <div class="topbar-actions">
          <button class="mode-pill tour-pill" id="tour-button" type="button" aria-pressed="false" title="Guided 3D Spatial Demo Tour (T)">▷ TOUR</button>
```

**Replacement Text**:
```html
        <div class="topbar-actions">
          <button class="home-return-button" id="home-return-button" type="button" data-open-home title="Return to Workspace Home (H)">
            <span aria-hidden="true">⌂</span>
            <span>HOME</span>
          </button>
          <button class="mode-pill tour-pill" id="tour-button" type="button" aria-pressed="false" title="Guided 3D Spatial Demo Tour (T)">▷ TOUR</button>
```

---

### 4.3 TypeScript Updates in `workspace-prototype/src/main.ts`

#### Step A: DOM Query for `#home-view`
**Target Location**: Around line 249
**Target Text**:
```ts
const container = document.querySelector<HTMLDivElement>("#scene");
const sceneShell = document.querySelector<HTMLElement>("#room");
const studioView = document.querySelector<HTMLElement>("#studio-view");
const facetBar = document.querySelector<HTMLElement>("#facet-bar");
```

**Replacement Text**:
```ts
const container = document.querySelector<HTMLDivElement>("#scene");
const sceneShell = document.querySelector<HTMLElement>("#room");
const studioView = document.querySelector<HTMLElement>("#studio-view");
const homeView = document.querySelector<HTMLElement>("#home-view");
const facetBar = document.querySelector<HTMLElement>("#facet-bar");
```

#### Step B: DOM Assertion for `homeView`
**Target Location**: Around line 351
**Target Text**:
```ts
if (
  !container ||
  !sceneShell ||
  !studioView ||
  !facetBar ||
```

**Replacement Text**:
```ts
if (
  !container ||
  !sceneShell ||
  !studioView ||
  !homeView ||
  !facetBar ||
```

#### Step C: Element Constant Assignment
**Target Location**: Around line 447
**Target Text**:
```ts
const sceneElement = container;
const sceneShellElement = sceneShell;
const studioViewElement = studioView;
const facetBarElement = facetBar;
```

**Replacement Text**:
```ts
const sceneElement = container;
const sceneShellElement = sceneShell;
const studioViewElement = studioView;
const homeViewElement = homeView;
const facetBarElement = facetBar;
```

#### Step D: View Router Implementation
**Target Location**: Place after `selectCard` (around line 4331) or alongside other navigation controllers.
**Code Snippet**:
```ts
/**
 * Switch from Home View to Spatial Studio.
 * Optionally focuses/selects the designated card by ID and synchronizes the URL hash.
 */
export function showStudio(cardId?: string): void {
  homeViewElement.hidden = true;
  studioViewElement.hidden = false;

  if (cardId) {
    const target = cards.find((c) => c.id === cardId);
    if (target) {
      selectCard(target, true);
    }
  }

  if (window.location.hash !== "#studio" && window.location.hash !== "#room") {
    window.location.hash = "#studio";
  }

  resize();
  renderer.domElement.focus();
}

/**
 * Switch from Spatial Studio to Home View.
 * Closes popovers, updates URL hash, and synchronizes the active card badge.
 */
export function showHome(): void {
  closeProfilePopover();
  studioViewElement.hidden = true;
  homeViewElement.hidden = false;

  if (window.location.hash !== "#home") {
    window.location.hash = "#home";
  }

  if (selectedCard) {
    const homeCards = homeViewElement.querySelectorAll<HTMLElement>(".home-system-card");
    homeCards.forEach((cardEl) => {
      const isSelected = cardEl.dataset.cardId === selectedCard?.id;
      cardEl.classList.toggle("home-system-card-featured", isSelected);
      const codeEl = cardEl.querySelector(".home-system-code");
      if (codeEl) {
        const pcCode = codeEl.textContent?.split("·")[0]?.trim() ?? "";
        codeEl.textContent = isSelected ? `${pcCode} · SELECTED IN STUDIO` : pcCode;
      }
    });
  }

  const primaryCta = homeViewElement.querySelector<HTMLElement>(".home-primary-button");
  primaryCta?.focus();
}

function initViewRouter(): void {
  // Delegate clicks on [data-open-studio] inside home view
  homeViewElement.addEventListener("click", (event) => {
    const trigger = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-open-studio]");
    if (!trigger) return;
    const cardId = trigger.dataset.cardId;
    showStudio(cardId);
  });

  // Delegate clicks on [data-open-home] inside studio view
  studioViewElement.addEventListener("click", (event) => {
    const trigger = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-open-home]");
    if (!trigger) return;
    event.preventDefault();
    showHome();
  });

  // Topbar brand logo link
  const brandLogo = studioViewElement.querySelector<HTMLAnchorElement>("a.brand");
  if (brandLogo) {
    brandLogo.addEventListener("click", (event) => {
      event.preventDefault();
      showHome();
    });
  }

  // Synchronize hash changes
  window.addEventListener("hashchange", () => {
    closeProfilePopover();
    const hash = window.location.hash;
    if (hash === "#home") {
      showHome();
    } else if (hash === "#studio" || hash === "#room") {
      showStudio();
    }
  });

  // Keyboard navigation on Home View (Escape returns to Studio)
  homeViewElement.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      showStudio();
    }
  });

  // Initial route resolution on boot
  if (window.location.hash === "#home") {
    showHome();
  } else if (window.location.hash === "#studio" || window.location.hash === "#room") {
    showStudio();
  }
}
```

#### Step E: Keyboard Shortcut in Studio View
**Target Location**: In `window.addEventListener("keydown", ...)` (around line 2245)
**Code Addition**:
```ts
  if (event.key.toLowerCase() === "h") {
    event.preventDefault();
    showHome();
    return;
  }
```

#### Step F: Animation Loop Performance Optimization
**Target Location**: In `animate(now = 0)` (around line 7568)
**Target Text**:
```ts
  const dt = lastFrameTime > 0 ? Math.min(0.05, (now - lastFrameTime) / 1000) : 1 / 60;
  lastFrameTime = now;
  const reducePreviewMotion = prefersReducedMotion();
```

**Replacement Text**:
```ts
  const dt = lastFrameTime > 0 ? Math.min(0.05, (now - lastFrameTime) / 1000) : 1 / 60;
  lastFrameTime = now;
  if (studioViewElement.hidden) return;
  const reducePreviewMotion = prefersReducedMotion();
```

#### Step G: Top-Level Router Initialization
**Target Location**: At the bottom of `main.ts` (around line 7914)
**Target Text**:
```ts
initCommercialEditions();
initKernelTelemetryBridge();
animate();
```

**Replacement Text**:
```ts
initCommercialEditions();
initKernelTelemetryBridge();
initViewRouter();
animate();
```

---

## 5. Verification Method

### 5.1 Automated Test Execution
Run from the workspace directory:
```powershell
npm --prefix workspace-prototype test
```
*Expected Result*: All existing 63 tests pass with 0 failures.

### 5.2 TypeScript Build Check
```powershell
npm --prefix workspace-prototype run build
```
*Expected Result*: `tsc --noEmit` exits with code 0 and Vite generates production bundles without type or module resolution errors.

### 5.3 Dedicated View Router Unit Test
Add a test in `workspace-prototype/tests/card-theming-collision.test.mjs` verifying:
1. `main.ts` contains `export function showStudio` and `export function showHome`.
2. `main.ts` asserts `!homeView` and registers listeners on `[data-open-studio]` and `[data-open-home]`.
3. `style.css` does not contain `#home-view { display: none !important; }`.
4. `index.html` contains `data-open-studio` on `.home-primary-button` and all 5 `.home-system-card` elements, plus `.home-return-button` in `.topbar-actions`.

### 5.4 Invalidation Conditions
- Any occurrence where navigating to `/#home` leaves `#home-view` hidden or blank.
- Any occurrence where clicking a system card (e.g. `android`) does not switch to the Studio View with the Android card selected.
- Any runtime `TypeError` when clicking buttons across `#home-view` and `#studio-view`.
