## 2026-11-11T21:00:59Z

You are the Implementation Worker for Milestone 3: Theme Selection Controls and State Persistence.

Working directory: G:\micro-host\workspace-prototype
State folder: G:\micro-host\.agents\teamwork\worker_m3_controls\
You MUST read:
1. G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. G:\micro-host\PROJECT.md
3. G:\micro-host\.agents\teamwork\sub_orch_controls\SCOPE.md
4. G:\micro-host\.agents\teamwork\explorer_survey_integration\handoff.md
5. G:\micro-host\.agents\teamwork\sub_orch_surface\handoff.md

Write Ownership:
You have exclusive write ownership of:
- G:\micro-host\workspace-prototype\index.html
- G:\micro-host\workspace-prototype\src\main.ts
- G:\micro-host\workspace-prototype\src\style.css
Do NOT touch other files unless necessary.

Objectives & Deliverables:
1. In `index.html`:
   - Inside `.home-theme-picker` on `#home-view`:
     * Add preset chips for Android Material presets: `pixel-blue`, `forest-emerald`, `lavender-mist`, `sunset-amber`, `obsidian-monochrome` alongside existing canonical chips (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`). Ensure each has `role="radio"`, `data-theme-id="[id]"`, swatch span with corresponding class/style, and chip label.
     * Add interactive seed color picker: `<input type="color" id="theme-seed-picker" data-seed-picker aria-label="Custom seed color">` along with seed hex input or quick seed swatches.
   - Inside `#studio-view` (in the topbar or studio controls header):
     * Add theme selection controls (e.g., `.studio-theme-picker` with `role="radiogroup"` containing preset chips or a compact theme selector) synchronized with home view.
2. In `main.ts`:
   - Update `initCardThemePicker`:
     * Query all theme chips (`[data-theme-id]`) in both home view and studio view. Wire click handlers to call `applyCardTheme(themeId)`.
     * Query seed picker input (`[data-seed-picker]`) and any hex input: on input/change, sanitize hex color (e.g. ensure 6-digit hex `#rrggbb`), call `applyCardTheme("seed:" + hex.toLowerCase())`.
     * Update `applyCardTheme(themeId)`:
       - Update active classes (`.is-active`) and `aria-checked` ("true"/"false") across all theme chips in `#home-view` and `#studio-view`.
       - If `themeId.startsWith("seed:")`, update the seed picker input `.value` to the seed hex (e.g. `themeId.slice(5)`), and ensure preset chips are marked inactive.
       - Call `persistTheme(themeId)` so theme is stored in `localStorage`.
       - If `selectedCard` is set, call `selectCard(selectedCard)` so the high-contrast selection emissive is immediately restored.
       - Keep defensive `typeof document !== "undefined"` checks so headless unit tests don't throw.
   - View Routing & Persistence:
     * Ensure `showStudio()` and `showHome()` seamlessly preserve active theme without resetting.
     * Ensure `applyCardTheme(loadPersistedTheme())` rehydrates persisted theme on startup.
3. In `style.css`:
   - Style the seed picker, swatches, and studio topbar theme controls with spatial dark aesthetic (`rgba(13, 17, 26, ...)`, subtle border glow, crisp typography, clean radio focus states).
4. Verification:
   - Run `npx tsc --noEmit` inside `G:\micro-host\workspace-prototype` (must pass with 0 errors).
   - Run `npm test` inside `G:\micro-host\workspace-prototype` (all existing tests must pass with 0 regressions).
5. Write your handoff report to:
   `G:\micro-host\.agents\teamwork\worker_m3_controls\handoff.md`


## 2026-11-11T21:11:51Z
**Context**: Milestone 3 implementation in workspace-prototype
**Content**: Safety timer check-in. Checking in on your progress with index.html, main.ts, and style.css implementation.
**Action**: Please report your current status or notify if you encounter any blockers.
