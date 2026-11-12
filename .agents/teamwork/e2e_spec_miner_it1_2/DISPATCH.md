## 2026-11-11T19:27:29Z

You are a Spec Miner for the E2E Testing Track of Post Card OS Android Theming System.

Your working directory is: G:\micro-host
Your state folder is: G:\micro-host\.agents\teamwork\e2e_spec_miner_it1_2\

MANDATORY FIRST STEP:
Read the original user request at:
G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md

Additional context to read:
- G:\micro-host\TEST_INFRA.md
- G:\micro-host\PROJECT.md
- G:\micro-host\.agents\teamwork\sub_orch_e2e_testing\SCOPE.md
- G:\micro-host\workspace-prototype\src\card-themes.ts
- G:\micro-host\.agents\teamwork\explorer_survey_integration\handoff.md

Your Mission:
Mine and systematically catalog the exact specification requirements, test assertions, and quantitative thresholds for the 4-tier test suite to be placed in `workspace-prototype/tests/android-theming-integration.test.mjs`:
1. Tier 1: Feature Coverage (>=5 test cases per feature, 6 features = 30 tests):
   - F1: Dynamic color palette generation (HCT/CIELAB math, 5 tonal palettes, 13 stops, 22 semantic roles).
   - F2: Android preset themes catalog (5 canonical presets + 5 Android presets, schema completeness).
   - F3: 2D Home View surface integration (CSS custom property injection, featured card styling).
   - F4: 3D Spatial card surface integration (Canvas drawer title/detail token consumption, texture cache invalidation, selection emissive).
   - F5: Theme selection controls (preset chips, color picker, hex input).
   - F6: State persistence & view navigation (localStorage serialization, view transition preservation).
2. Tier 2: Boundary & Corner Cases (>=5 test cases per feature, 6 features = 30 tests):
   - Extreme tonal stops (Tone 0 black, Tone 100 white).
   - Low chroma monochrome seeds (C < 8).
   - Malformed/invalid hex inputs with safe recovery.
   - Rapid view switching stress.
   - Corrupted/empty storage recovery.
3. Tier 3: Cross-Feature Interactions (>=6 test cases):
   - Preset selection + navigation between 2D and 3D views.
   - Dynamic seed generation + 3D texture update + selection emissive sync.
   - Storage persistence + cold boot rehydration.
4. Tier 4: Real-World Scenarios (>=5 test cases):
   - End-to-end user workflows.
   - Accessibility contrast verification (WCAG AA >= 4.5:1) across 50 diverse seed colors.

Deliver your detailed handoff report to:
G:\micro-host\.agents\teamwork\e2e_spec_miner_it1_2\handoff.md
Send a completion message back with the summary of findings and the report path.
