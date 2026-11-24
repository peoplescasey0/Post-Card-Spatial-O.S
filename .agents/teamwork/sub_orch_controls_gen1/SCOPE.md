# Scope: Milestone 3 (Gen 1) — Theme Selection Controls & State Persistence

## Objective
Take over Milestone 3 execution from the interruption point where `worker_m3_controls` completed implementation. Conduct rigorous gate verification (2 Reviewers, 2 Challengers, 1 Forensic Auditor) to verify theme selection controls on `#home-view` and `#studio-view`, dynamic seed color generation, view persistence across navigation, and full regression immunity, then record gate status and publish `handoff.md`.

## Key Scope & Implemented Artifacts
1. **Home View Controls (`workspace-prototype/index.html`)**:
   - 5 Android Material preset chips (`pixel-blue`, `forest-emerald`, `lavender-mist`, `sunset-amber`, `obsidian-monochrome`) alongside canonical presets.
   - Dynamic seed color picker (`<input type="color" id="theme-seed-picker" data-seed-picker>`) and hex input (`#theme-seed-hex`).
2. **Studio View Controls (`workspace-prototype/index.html`)**:
   - Synchronized theme pulldown menu (`#studio-theme-pulldown`) with preset chips and seed picker.
3. **Application Logic & Routing (`workspace-prototype/src/main.ts`)**:
   - `applyCardTheme(themeId)`: updates `.is-active` and `aria-checked`, updates CSS variables on `#home-view`, updates studio topbar, and calls `persistTheme(themeId)`.
   - `initCardThemePicker()`: wires click and input/change listeners for presets and seed picker (`seed:#HEX`).
   - `showStudio()` and `showHome()`: preserves `activeCardThemeId` across navigation.
   - Startup cold-boot rehydration: `applyCardTheme(loadPersistedTheme())`.
4. **CSS Styling (`workspace-prototype/src/style.css`)**:
   - Swatch styles, seed picker styling, studio topbar pulldown dark spatial glass aesthetic.
5. **Implementation Report**:
   - `G:\micro-host\.agents\teamwork\worker_m3_controls\handoff.md`

## Verification Requirements
- Stagger / sequence subagent dispatches to avoid rate limits (e.g. Reviewers first, then Challengers, then Forensic Auditor).
- 2 Reviewers (`teamwork_reviewer`): Verify correctness, accessibility, view persistence, and interface conformance.
- 2 Challengers (`teamwork_challenger`): Empirically test seed color input changes, rapid navigation toggling, and storage fallback.
- 1 Forensic Auditor (`teamwork_auditor`): Run integrity forensics to confirm genuine logic, no dummy facades, no hardcoded test outputs.
- Verify that `npx tsc --noEmit`, `npm run build`, and `npm test` exit 0 (285/285 tests pass).
- Record all verdicts in `GATE_STATUS.md` and deliver `handoff.md`.

## Primary References
- `G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md`
- `G:\micro-host\PROJECT.md`
- `G:\micro-host\.agents\teamwork\worker_m3_controls\handoff.md`
- `G:\micro-host\workspace-prototype/src/card-themes.ts`
- `G:\micro-host\workspace-prototype/src/main.ts`
- `G:\micro-host\workspace-prototype/src/style.css`
- `G:\micro-host\workspace-prototype/index.html`
- `G:\micro-host\workspace-prototype/tests/android-theming-integration.test.mjs`
