# Challenger Engine 2 Task Assignment

## Identity & Context
- Role: `teamwork_challenger`
- State Folder: `G:\micro-host\.agents\teamwork\challenger_engine_2\`
- Working Directory: `G:\micro-host`

## Mandatory Reading
1. `G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md`
2. `G:\micro-host\PROJECT.md`
3. `G:\micro-host\.agents\teamwork\sub_orch_engine\SCOPE.md`
4. `G:\micro-host\.agents\teamwork\worker_engine_1\handoff.md`
5. `G:\micro-host\workspace-prototype\src\card-themes.ts`

## Challenge Objective
Empirically stress-test Accessibility Contrast, Role Mappings, and Backwards Compatibility:
1. Write and execute an adversarial verification script in Node.js (without modifying source code):
   - Measure WCAG 2.1 relative luminance and contrast ratio between text roles (`onSurface`, `onSurfaceVariant`, `primary`, etc.) and background containers (`surface`, `surfaceContainer`, `surfaceContainerLow`, `surfaceContainerHighest`) for:
     * All 5 Android presets in Dark Mode (standard Post Card OS studio mode).
     * All 5 Android presets in Light Mode.
     * 50 randomly generated seed colors across the CIE chromaticity spectrum.
   - Verify that high-emphasis text (`onSurface` vs `surfaceContainer`) meets WCAG AA contrast ratio $\ge 4.5:1$ (and check if it meets AAA $\ge 7.0:1$).
2. Verify backwards compatibility:
   - Execute all existing test files in `workspace-prototype/tests/` via `node --test`.
   - Verify specifically that `CARD_THEME_IDS.length === 5` and that canonical theme IDs (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`) produce identical tokens to baseline.
3. Test theme descriptor parsing:
   - `getCardTheme('seed:#1a73e8')` vs `getCardTheme('#1a73e8')` vs `getCardTheme('pixel-blue')`.

Write your empirical verification handoff report to:
`G:\micro-host\.agents\teamwork\challenger_engine_2\handoff.md`
Include an explicit verdict: `APPROVE` or `REQUEST_CHANGES`.
Send a completion message back to the orchestrator.


## 2026-11-11T19:50:28Z
You are Challenger Engine 2 for Milestone 1: Android Theming Engine.

Read your task assignment at:
G:\micro-host\.agents\teamwork\challenger_engine_2\DISPATCH.md

State Folder: G:\micro-host\.agents\teamwork\challenger_engine_2\
Working Directory: G:\micro-host

Read ORIGINAL_REQUEST.md, PROJECT.md, SCOPE.md, worker_engine_1/handoff.md, and workspace-prototype/src/card-themes.ts.
Empirically stress-test WCAG contrast ratios (>= 4.5:1 AA) between text roles and surface containers across presets and random seeds, verify backwards compatibility with all 117 workspace tests, and test theme descriptor parsing. Write your handoff report to G:\micro-host\.agents\teamwork\challenger_engine_2\handoff.md with an explicit verdict (APPROVE or REQUEST_CHANGES), and send a completion message back.
