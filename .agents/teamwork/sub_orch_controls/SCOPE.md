# Scope: Milestone 3 — Theme Selection Controls & State Persistence

## Objective
Provide interface controls on `#home-view` and `#studio-view` to select preset Android themes or generate dynamic themes from seed colors, and ensure the active theme persists seamlessly across navigation between the 2D home view and the 3D spatial studio view.

## Key Requirements
1. **2D Home View Theme Controls (`index.html`, `src/style.css`, `src/main.ts`)**:
   - In `index.html` inside `.home-theme-picker` on `#home-view`:
     * Add theme chips for Android Material presets: `pixel-blue`, `forest-emerald`, `lavender-mist`, `sunset-amber`, `obsidian-monochrome` alongside existing canonical chips.
     * Add interactive seed color picker: `<input type="color" id="theme-seed-picker" data-seed-picker>` with hex input / quick seed swatches.
   - In `main.ts` (`initCardThemePicker`):
     * Wire click listeners for preset chips (`data-theme-id`).
     * Wire input/change listeners for seed color picker: calls `applyCardTheme(`seed:${hex}`)` on change.
     * Keep `.is-active` and `aria-checked` states synchronized across all theme controls.
2. **3D Spatial Studio View Controls (`index.html`, `src/main.ts`, `src/style.css`)**:
   - Add a theme selector control to `#studio-view`'s topbar / studio action bar (e.g. quick preset chips or dropdown button).
   - Synchronize studio controls with home view controls so changing theme in studio updates home view state and vice versa.
3. **State Persistence & View Navigation (`src/card-themes.ts`, `src/main.ts`)**:
   - Persist active theme in `localStorage` under `"postcard_studio_card_theme"`, supporting both preset IDs and `seed:#HEX` descriptors.
   - When navigating `showStudio()` $\to$ `showHome()` or `showHome()` $\to$ `showStudio()`, preserve the active theme without resetting to default.
   - Rehydrate persisted theme on startup (`applyCardTheme(loadPersistedTheme())`).
4. **Styling Polish (`src/style.css`)**:
   - Style seed color picker, swatches, and studio topbar theme controls with Post Card OS spatial dark aesthetic.
5. **Verification**:
   - `npx tsc --noEmit` must pass with 0 errors.
   - `npm test` inside `workspace-prototype/` must pass all tests with 0 failures, 0 regressions.

## Primary References
- `G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md`
- `G:\micro-host\PROJECT.md`
- `G:\micro-host\.agents\teamwork\explorer_survey_integration\handoff.md`
- `G:\micro-host\workspace-prototype/src/card-themes.ts`
- `G:\micro-host\workspace-prototype/src/main.ts`
- `G:\micro-host\workspace-prototype/src/style.css`
- `G:\micro-host\workspace-prototype/index.html`
