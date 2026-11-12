## 2026-11-11T20:59:23Z
You are the Sub-Orchestrator for Milestone 3: Theme Selection Controls and State Persistence.

Read the original user request at:
G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md

Read your milestone scope at:
G:\micro-host\.agents\teamwork\sub_orch_controls\SCOPE.md

Read global architecture and contracts at:
G:\micro-host\PROJECT.md

Read the survey reports at:
G:\micro-host\.agents\teamwork\explorer_survey_integration\handoff.md
G:\micro-host\.agents\teamwork\sub_orch_surface\handoff.md

Your Identity:
- Archetype: orchestrator
- Role: Milestone 3 Sub-Orchestrator
- Working Directory: G:\micro-host
- State Folder: G:\micro-host\.agents\teamwork\sub_orch_controls\
- Parent Conversation ID: ceaf9aef-9506-4a7f-a2cd-13fd5bb3a5ec

Your Mission & Procedure:
Run the Iteration Loop (2B) for Milestone 3:
1. Assess scope and execute the standard cycle:
   - Worker: Implement interface controls and state persistence across `workspace-prototype/index.html`, `workspace-prototype/src/main.ts`, and `workspace-prototype/src/style.css`:
     * In `index.html`:
       - Add chips for Android Material presets: `pixel-blue`, `forest-emerald`, `lavender-mist`, `sunset-amber`, `obsidian-monochrome` inside `.home-theme-picker` on `#home-view`.
       - Add seed color picker `<input type="color" id="theme-seed-picker" data-seed-picker>` with hex input / swatches.
       - Add theme selection controls to `#studio-view` topbar / header bar.
     * In `main.ts`:
       - Initialize event listeners in `initCardThemePicker` for preset chips (`[data-theme-id]`).
       - Wire event listeners for the seed color picker: calls `applyCardTheme("seed:" + hex.toLowerCase())` on change/input.
       - Synchronize `.is-active` and `aria-checked` states across both home view and studio view controls.
       - Ensure `showStudio()` and `showHome()` seamlessly preserve active theme across view transitions.
       - Ensure `applyCardTheme(loadPersistedTheme())` rehydrates persisted theme on startup.
     * In `style.css`:
       - Style seed picker, swatches, and studio topbar theme controls with spatial dark aesthetic.
     * Run `npx tsc --noEmit` and `npm test` inside `workspace-prototype/` (all tests must pass with 0 errors and 0 regressions).
   - Reviewers (2): Verify controls accessibility (`role="radiogroup"`, `role="radio"`, `aria-checked`), view persistence, and code quality.
   - Challengers (2): Adversarially stress test seed picker inputs, view switching transitions, rapid theme toggles, and storage edge cases.
   - Forensic Auditor (1): Verify integrity, no dummy facades or test bypasses.
   - Gate: Verify all pass criteria.
2. Record verdicts in `G:\micro-host\.agents\teamwork\sub_orch_controls\GATE_STATUS.md`.
3. When gate passes, write your final handoff report to:
   `G:\micro-host\.agents\teamwork\sub_orch_controls\handoff.md`
4. Send a completion message back to parent when done.
