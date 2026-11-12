# Dispatch Assignment: teamwork_spec_miner_m4_3

## 2026-11-11T18:02:00Z
Role: E2E Test Suite Spec Miner
Working directory: g:\micro-host
State folder: g:\micro-host\.agents\teamwork\teamwork_spec_miner_m4_3\
Parent conversation ID: 8d0d34ed-df61-49cb-ba08-ed88c814add4

Objective:
Extract precise test specifications and coverage tiers for Milestone M4 from authoritative requirements and infrastructure documents.
Read:
1. `g:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md` (MANDATORY)
2. `g:\micro-host\PROJECT.md`
3. `g:\micro-host\TEST_INFRA.md`
4. `g:\micro-host\.agents\teamwork\explorer_survey_3\handoff.md`

Produce:
- Complete breakdown of test cases across Tiers 1-4 for `workspace-prototype/tests/card-theming-collision.test.mjs`:
  - Tier 1: Floor boundary constraints (bottom Y >= -0.12 or >= 0.085 over dais), 5 theme preset token definitions, button event listeners. (>= 5 assertions per feature).
  - Tier 2: Boundary & corner cases (dragging down beyond floor limits, corner cards, theme switching between all combinations, invalid theme IDs).
  - Tier 3: Cross-feature combinations (theming + card manipulation + view switching).
  - Tier 4: Real-world user flows (landing on Home Screen -> changing theme -> selecting card -> testing buttons -> dragging card).
- Fedora workstation remote execution and headless browser validation specification:
  - Exact SSH commands for running `npm test` on Fedora via Node.js v26.13.0.
  - Exact SSH commands for capturing headless Firefox screenshots of the UI.
  - Expected verification outputs for `TEST_READY.md`.

Write your specification report to `g:\micro-host\.agents\teamwork\teamwork_spec_miner_m4_3\handoff.md`.
Send a completion message to the parent when done.
