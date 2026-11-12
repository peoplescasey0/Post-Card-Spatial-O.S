# Scope: Milestone M4 / E2E Testing Track — Automated Test Suite & Verification

## Objective
Design and implement a comprehensive 4-tier automated test suite in `workspace-prototype/tests/android-theming-integration.test.mjs` verifying Android theming palette generation, preset availability, 2D/3D surface integration, and view persistence, while ensuring all existing tests continue passing without regression.

## Key Requirements
1. **Tier 1: Feature Coverage ($\ge 5$ tests per feature)**:
   - Dynamic seed color palette generation across diverse hues.
   - Android preset themes availability and schema completeness.
   - 2D Home View CSS variable application and featured card styling.
   - 3D spatial card canvas rendering token consumption and texture invalidation.
   - UI theme selection controls.
   - State persistence in `localStorage`.
2. **Tier 2: Boundary & Corner Cases ($\ge 5$ tests per feature)**:
   - Extreme tonal stops (Tone 0 black, Tone 100 white).
   - Low chroma monochrome seeds ($C < 8$).
   - Malformed/invalid hex inputs with safe recovery.
   - Rapid view switching stress.
   - Corrupted/empty storage recovery.
3. **Tier 3: Cross-Feature Interactions**:
   - Preset selection + navigation between 2D and 3D views.
   - Dynamic seed generation + 3D card texture update + selection emissive sync.
   - Storage persistence + cold boot rehydration.
4. **Tier 4: Real-World Workload Scenarios**:
   - End-to-end user workflows.
   - Accessibility contrast ratios ($\ge 4.5:1$) across random sample of 50 seed colors.
5. **Publish `TEST_READY.md`**:
   - When test runner and test cases are verified passing with exit code 0.

## Primary References
- `G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md`
- `G:\micro-host\PROJECT.md`
- `G:\micro-host\TEST_INFRA.md`
- `G:\micro-host\.agents\teamwork\explorer_survey_integration\handoff.md`
- `G:\micro-host\workspace-prototype/package.json`
