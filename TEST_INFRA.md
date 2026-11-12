# E2E Test Infra: Post Card OS Android Theming System

## Test Philosophy
- Opaque-box & unit integration, requirement-driven per ORIGINAL_REQUEST.md.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Interaction + Real-World Workloads.
- Pass/Fail semantics: All tests must exit `0` cleanly via `npm test` (`node --test`). Zero regressions across all 117+ baseline tests. Typecheck (`npx tsc --noEmit`) and Vite build (`npm run build`) must succeed with 0 errors.

## Feature Inventory
| # | Feature | Source (requirement) | Tier 1 | Tier 2 | Tier 3 |
|---|---------|---------------------|:------:|:------:|:------:|
| 1 | Dynamic Color Palette Generation | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 2 | Android Preset Themes Catalog | ORIGINAL_REQUEST R1 | 5 | 5 | ✓ |
| 3 | 2D Home View Surface Integration | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| 4 | 3D Spatial Cards Surface Integration | ORIGINAL_REQUEST R2 | 5 | 5 | ✓ |
| 5 | Theme Selection Controls | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |
| 6 | State Persistence & View Navigation | ORIGINAL_REQUEST R3 | 5 | 5 | ✓ |

## Test Architecture
- **Location**: `workspace-prototype/tests/android-theming-integration.test.mjs`
- **Runner**: Node.js test runner (`node --test`), ES Modules.
- **Pass Criteria**:
  - Deterministic tone calculations with WCAG AA contrast ratio $\ge 4.5:1$ between `onSurface` and `surfaceContainer`, `onPrimary` and `primary`.
  - Exactly 5 canonical IDs preserved in `CARD_THEME_IDS` (backwards compatibility).
  - All 5 Android presets available via `ANDROID_THEME_IDS` and `getCardTheme()`.
  - CSS custom properties dynamically written to `#home-view.style`.
  - 3D canvas textures reflect theme title/detail colors and invalidation keys.
  - View persistence across 2D home $\leftrightarrow$ 3D studio navigation.

## Remote Fedora Workstation Execution Contract
- Remote test execution: `ssh fedora "node --test"` for parallel headless validation.
- Remote screenshot validation: `firefox --headless --screenshot` for offscreen UI rendering verification.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Cold-boot with custom seed color | F1, F3, F5, F6 | High |
| 2 | Dynamic theme generation and view switching | F1, F3, F4, F6 | High |
| 3 | Preset Android switching in 2D then entering 3D studio | F2, F3, F4, F5, F6 | High |
| 4 | High-contrast accessibility validation across 50 seed colors | F1, F2 | Medium |
| 5 | Corrupted storage recovery during navigation | F1, F2, F6 | Medium |

## Coverage Thresholds
- Tier 1: $\ge 5$ test cases per feature (30 total)
- Tier 2: $\ge 5$ boundary/corner cases per feature (30 total)
- Tier 3: $\ge 6$ cross-feature interaction cases
- Tier 4: $\ge 5$ real-world application scenarios
- **Total planned new test cases: $\ge 71$ test cases in `android-theming-integration.test.mjs`**


## Remote Test Infrastructure (Fedora Workstation)
- Remote test runner: `ssh fedora "node --test"`
- Headless screenshot: `firefox --headless --screenshot`
