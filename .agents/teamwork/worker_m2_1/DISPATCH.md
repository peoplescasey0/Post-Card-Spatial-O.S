## 2026-11-11T18:12:57Z
You are Worker 1 for Milestone M2 (Card Interaction and Floor Collision Polish).
Role: Interaction and Physics Engineer
Working directory: g:\micro-host
State folder: g:\micro-host\.agents\teamwork\worker_m2_1\

MANDATORY FIRST STEP: Read:
1. g:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. g:\micro-host\PROJECT.md
3. g:\micro-host\.agents\teamwork\sub_orch_interaction\SCOPE.md
4. g:\micro-host\.agents\teamwork\explorer_m2_1\handoff.md
5. g:\micro-host\.agents\teamwork\explorer_m2_2\handoff.md
6. g:\micro-host\.agents\teamwork\explorer_m2_3\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Write Ownership:
- `workspace-prototype/src/main.ts`
- `workspace-prototype/src/style.css`
- `workspace-prototype/index.html`
- `workspace-prototype/tests/card-theming-collision.test.mjs`

Tasks to Execute:
1. Floor Collision Clamping Engine in `workspace-prototype/src/main.ts`:
   - Implement `getFloorHeightAt(x: number, z: number): number` (dais surface at Y = +0.085 within radius 7.7 around (0, -0.25); obsidian floor at Y = -0.12 elsewhere).
   - Implement `clampCardAboveFloor(card: SystemCard)` ensuring no card vertex or bounding corner ever penetrates below the floor plane.
   - Enforce clamp in:
     - `onPointerMove` direct manipulation (lines ~6347-6356)
     - `resolveCardCollisions` (lines ~4182-4220)
     - `onPointerUp` (`completedDrag.freeMove`, lines ~6446-6453)
     - `animate` loop (lines ~7715-7723)
   Follow the blueprints in `explorer_m2_1/handoff.md` and `explorer_m2_3/handoff.md`.

2. Home Screen View & Navigation:
   - In `workspace-prototype/src/style.css`: remove `#home-view { display: none !important; }` (lines ~3516-3519) so mutual-exclusion `#home-view[hidden]`, `#studio-view[hidden]` controls display cleanly.
   - In `workspace-prototype/src/main.ts`:
     - Query and assert `#home-view` element.
     - Implement `showStudio(cardId?: string)` and `showHome()` view router functions.
     - Wire all 6 `[data-open-studio]` buttons (primary hero CTA and 5 system card tiles). When `cardId` is provided, select and focus the card in studio.
     - Wire `a.brand` and `.home-return-button` to return to `#home-view`.
     - Wire `window.location.hash` synchronization (`#home`, `#studio`, `#room`) and `hashchange` handler.
     - In `animate()`, skip heavy rendering when `studioViewElement.hidden` is true.
   - In `workspace-prototype/index.html`: add `.home-return-button` to `.topbar-actions` and wire `a.brand` with `data-open-home`.
   Follow the blueprints in `explorer_m2_2/handoff.md` and `explorer_m2_3/handoff.md`.

3. Button Interactivity & Bug Fixes:
   - In `workspace-prototype/src/main.ts`:
     - Fix optional chaining bug at line ~3362 (`status?.preparedCardIds?.includes(card.id) ?? false`), and at lines ~3738, ~4364, plus safe `guests` access.
     - Guard `guestDialogElement.showModal()` with `if (!guestDialogElement.open)`.
     - In `runCardButton`: ensure all 8 tactile buttons (`guest`, `stop`, `zoom`, `settings`, `clone`, `savepoint`, `performance`, `bin`) execute cleanly without runtime error. Wire `performance` to flip to bottom facet (`flipCardTo(card, "bottom")`).
   Follow the blueprint in `explorer_m2_3/handoff.md`.

4. Comprehensive Automated Test Suite:
   - Create `workspace-prototype/tests/card-theming-collision.test.mjs` using the full test suite blueprint from `explorer_m2_3/handoff.md`.

5. Build & Test Verification:
   - Run `npm test` inside `workspace-prototype` (verify all existing 63 tests + new tests pass).
   - Run `npm run build` inside `workspace-prototype` (verify TypeScript typecheck and Vite bundling succeed with exit code 0).
   - Run `git status --short` to verify working tree status.

6. Handoff Report:
   - Write your complete handoff report to `g:\micro-host\.agents\teamwork\worker_m2_1\handoff.md`.
   - Send a message back to the orchestrator when finished.
