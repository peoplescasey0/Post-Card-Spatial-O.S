# Dispatch Assignment: teamwork_worker_m4_1

## 2026-11-11T18:11:00Z
Role: E2E Test Suite & Fedora Validation Worker
Working directory: g:\micro-host
State folder: g:\micro-host\.agents\teamwork\teamwork_worker_m4_1\
Parent conversation ID: 8d0d34ed-df61-49cb-ba08-ed88c814add4

MANDATORY FIRST STEP: Read:
1. `g:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY)
2. `g:\micro-host\PROJECT.md`
3. `g:\micro-host\TEST_INFRA.md`
4. `g:\micro-host\.agents\teamwork\sub_orch_testing\SCOPE.md`
5. Explorer reports:
   - `g:\micro-host\.agents\teamwork\teamwork_explorer_m4_1\handoff.md`
   - `g:\micro-host\.agents\teamwork\teamwork_explorer_m4_2\handoff.md`
   - `g:\micro-host\.agents\teamwork\teamwork_spec_miner_m4_3\handoff.md`

File Write Ownership (EXCLUSIVE):
- `workspace-prototype/tests/card-theming-collision.test.mjs`
- `g:\micro-host\TEST_READY.md`
Do NOT edit other source files directly (M2 and M3 own main.ts, card-themes.ts, etc.).

MANDATORY INTEGRITY WARNING:
"DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected."

Detailed Tasks:
1. Author `workspace-prototype/tests/card-theming-collision.test.mjs` covering Tiers 1-4:
   - Tier 1: Floor boundary constraints (ensuring card bottom Y is never < -0.12 or < 0.085 over dais), 5 theme preset definitions (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`), cache key invalidation, home view primary CTA and system card navigation buttons, and button event safety across all 123 DOM buttons and 8 printed card buttons. (>= 5 assertions per feature).
   - Tier 2: Boundary and corner cases (extreme downward drag coordinates Y = -10, 0, 0.6; radial dais boundary discontinuity at r = 7.7 vs 7.701; scale factors 0.64 vs 1.04; card rotation tilt clearance; all 25 theme switching transitions; invalid/null theme ID recovery; CSS specificity preventing unconditional hiding of #home-view).
   - Tier 3: Cross-feature combinations (theming + card manipulation + view switching + persistence).
   - Tier 4: Real-world user flows (landing on Home Screen -> changing theme -> selecting card -> testing buttons -> dragging card).
2. Execute local test suite and build:
   - In `workspace-prototype`: run `npm test` and verify that all test files (including `card-theming-collision.test.mjs`) pass cleanly with exit code 0.
   - Run `npm run build` and verify TypeScript compilation and bundling exit code 0.
3. Utilize Fedora Workstation (`10.0.0.2` via SSH `fedora`):
   - Connect via SSH to `fedora` (`ssh -o BatchMode=yes fedora "..."`).
   - Sync changed test files to Fedora (`scp ...`).
   - Run the test suite on Fedora using native Node.js v26.13.0 (`npm test` in the remote workspace).
   - Validate UI rendering and headless browser capture on Fedora using Firefox:
     Run `firefox --headless --window-size 1920,1080 --screenshot /tmp/fedora_studio_theming.png http://10.0.0.1:5173/` (or via remote preview server) and retrieve the screenshot to `workspace-prototype/dist/fedora_studio_theming.png`.
4. Publish `g:\micro-host\TEST_READY.md`:
   - Summarize test suite results, pass counts, coverage tiers, Fedora remote execution metrics, and screenshot verification.
5. Write your comprehensive handoff report to `g:\micro-host\.agents\teamwork\teamwork_worker_m4_1\handoff.md`.
6. Send a message to parent orchestrator when complete.
