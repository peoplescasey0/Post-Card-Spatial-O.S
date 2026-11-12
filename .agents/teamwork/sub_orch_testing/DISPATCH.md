# Dispatch Assignments

## 2026-11-11T17:59:27Z

You are the Sub-Orchestrator for E2E Testing and Fedora Workstation Validation (Milestone M4).

MANDATORY FIRST STEP: Read:
1. g:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. g:\micro-host\PROJECT.md
3. g:\micro-host\TEST_INFRA.md
4. g:\micro-host\.agents\teamwork\explorer_survey_3\handoff.md

Working directory: g:\micro-host
State folder: g:\micro-host\.agents\teamwork\sub_orch_testing\
Parent conversation ID: 0f5b6df3-bb7b-4ab0-a937-218f6a6fac15

Scope of Ownership:
- Milestone M4: E2E Automated Testing & Fedora Workstation Validation (Requirement R3 & Verification Acceptance Criteria)
  - Design, author, and maintain the new automated test suite: `workspace-prototype/tests/card-theming-collision.test.mjs`.
    - Test Tier 1: Floor boundary constraints (ensuring card bottom Y is never < -0.12 or < 0.085 over dais), theme token definitions for all 5 presets, and button event listeners.
    - Test Tier 2: Boundary/corner cases (dragging downward beyond floor limits, corner cards, theme switching between all combinations).
    - Test Tier 3: Cross-feature combinations (theming + card manipulation + view switching).
    - Test Tier 4: Real-world user flows (navigating from home to studio, applying theme, selecting card, testing buttons).
  - Execute workspace test suite (`npm test`) and production build (`npm run build`).
  - Utilize the Fedora workstation environment:
    - Connect via SSH to `fedora` (`10.0.0.2`).
    - Run the test suite on Fedora using Node.js v26.13.0 (`ssh -o BatchMode=yes fedora "..."`).
    - Validate UI rendering and headless browser capture on Fedora using Firefox (`ssh -o BatchMode=yes fedora "firefox --headless --screenshot ..."`).
  - Publish `g:\micro-host\TEST_READY.md` summarizing the test results, coverage tiers, and validation outputs.

File Write Ownership:
- `workspace-prototype/tests/card-theming-collision.test.mjs`
- `g:\micro-host\TEST_READY.md`

Execution Instructions:
1. Initialize SCOPE.md in your state folder.
2. Dispatch Explorer / Test Writer -> Worker -> Reviewers -> Challengers -> Forensic Auditor -> Gate.
   MANDATORY INTEGRITY WARNING to include verbatim in Worker dispatches:
   "DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected."
3. Run both local workspace tests and Fedora workstation remote commands.
4. Publish `TEST_READY.md` and write your handoff report in `g:\micro-host\.agents\teamwork\sub_orch_testing\handoff.md`.
5. Send a message to the parent orchestrator when complete.
