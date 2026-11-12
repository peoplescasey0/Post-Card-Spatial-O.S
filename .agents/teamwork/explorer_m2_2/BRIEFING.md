# BRIEFING — 2026-11-11T18:08:00Z

## Mission
Investigate and produce a detailed technical implementation blueprint for Home View Navigation and CSS in `workspace-prototype/src/style.css` and `workspace-prototype/src/main.ts`.

## 🔒 My Identity
- Archetype: explorer
- Roles: Home View Navigation Researcher
- Working directory: g:\micro-host
- State folder: g:\micro-host\.agents\teamwork\explorer_m2_2\
- Original parent: 9549db3f-de5b-4bd7-8e7b-e56861caaf00
- Milestone: M2 (Card Interaction and Floor Collision Polish)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement / modify source code directly
- Output blueprint & analysis to `g:\micro-host\.agents\teamwork\explorer_m2_2\handoff.md`
- Inspect style.css, index.html, main.ts
- Design showStudio(cardId?), showHome(), hash sync, event listeners, card selection mapping

## Current Parent
- Conversation ID: 9549db3f-de5b-4bd7-8e7b-e56861caaf00
- Updated: 2026-11-11T18:08:00Z

## Investigation State
- **Explored paths**:
  - `workspace-prototype/src/style.css` (lines 2704-2722, 3288-3314, 3470-3484, 3516-3525, 5132-5141)
  - `workspace-prototype/index.html` (lines 17-165 `#home-view`, lines 167-240 `topbar`)
  - `workspace-prototype/src/main.ts` (lines 247-270 DOM queries, 351-450 assertions, 2208-2255 keydown, 2488 hashchange, 4289-4330 `selectCard`, 6832-6850 `resize`, 7564-7830 `animate`, 7910-7923 init)
  - `workspace-prototype/tests/` (all 63 tests pass, no DOM mock dependencies on main.ts)
- **Key findings**:
  - `#home-view { display: none !important; }` in `style.css` line 3517 overrides the mutual-exclusion rule `#home-view[hidden], #studio-view[hidden] { display: none !important; }` at line 2704. Removing line 3517 allows normal toggling.
  - `.home-return-button` is ALREADY styled in `style.css` (lines 3288-3313 and 3470-3484) with responsive hiding of `span` on mobile, but wasn't included in `index.html`.
  - In `index.html`, `#home-view` has primary CTA `.home-primary-button[data-open-studio]` and 5 system cards `.home-system-card[data-open-studio][data-card-id]`.
  - In `main.ts`, `#home-view` was never queried or asserted. Adding `homeView` to queries and assertions cleanly preserves DOM integrity.
  - View router `showStudio(cardId?: string)` and `showHome()` can map `cardId` via `cards.find((c) => c.id === cardId)` and `selectCard(target, true)`, sync hash (`#home`, `#studio`, `#room`), call `resize()`, and handle keyboard shortcuts ('H' and Escape).
- **Unexplored areas**: None for M2 Home View navigation scope.

## Key Decisions Made
- Neutralize line 3517 in `style.css`.
- Add `homeView` to DOM queries and assertions in `main.ts`.
- Export `showStudio(cardId?: string)` and `showHome()` from `main.ts`.
- Wire `[data-open-studio]` and return triggers (`a.brand`, `.home-return-button`) with hash sync and 'H'/Escape keyboard shortcuts.
- Pause 3D render loop when `studioViewElement.hidden` is true to reduce GPU load.

## Artifact Index
- DISPATCH.md — Dispatch log
- BRIEFING.md — Persistent state
- progress.md — Heartbeat progress
- handoff.md — Complete technical implementation blueprint
