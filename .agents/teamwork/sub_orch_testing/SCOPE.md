# Scope: Milestone M4 - E2E Automated Testing & Fedora Workstation Validation

## Architecture
- Node.js native test runner (`node --test`) inside `workspace-prototype`.
- Test target: `workspace-prototype/tests/card-theming-collision.test.mjs`.
- Cross-platform execution: Local Windows PowerShell & Remote Fedora Workstation (IP 10.0.0.2, Node.js v26.13.0, headless Firefox 158 screenshot capture).
- Artifact output: `g:\micro-host\TEST_READY.md`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Floor Boundary Constraint Tests | Verify bottom Y >= -0.12 (obsidian floor) and >= 0.085 over dais during drag, drop, and collision resolution | M4 | ORIGINAL_REQUEST R2 & PROJECT.md |
| 2 | Card Theming Preset Tests | Verify 5 presets (classic, cyberpunk, minimal-dark, glass, material-vibrant), color token presence, and theme switching | M4 | ORIGINAL_REQUEST R1 & PROJECT.md |
| 3 | Home Screen UI & Navigation Tests | Verify `#home-view` display toggle, `[data-open-studio]`, and `[data-card-id]` button event handling | M4 | ORIGINAL_REQUEST R2 & PROJECT.md |
| 4 | Button Interactivity Tests | Verify all interactive buttons across cards and UI trigger actions without runtime errors | M4 | ORIGINAL_REQUEST R2 & PROJECT.md |
| 5 | Cross-Feature Interaction Tests | Test simultaneous theming + card manipulation + view switching | M4 | ORIGINAL_REQUEST AC |
| 6 | Fedora Remote Test Parity | Execute test suite on Fedora Workstation via SSH Node.js v26.13.0 | M4 | ORIGINAL_REQUEST R3 |
| 7 | Fedora Headless Browser Capture | Capture headless Firefox screenshot of card theming and UI layout on Fedora | M4 | ORIGINAL_REQUEST R3 |

## Milestones & Work Items
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M4.1 | Test Architecture & Assertions Specification | Design test structure for Tiers 1-4 matching TEST_INFRA.md and PROJECT.md | none | IN_PROGRESS |
| M4.2 | Test Implementation | Author `workspace-prototype/tests/card-theming-collision.test.mjs` | M4.1 | PLANNED |
| M4.3 | Local Execution & Verification | Run `npm test` and `npm run build` | M4.2 | PLANNED |
| M4.4 | Fedora Workstation Execution & Capture | Run tests on Fedora via SSH and validate headless Firefox screenshot | M4.3 | PLANNED |
| M4.5 | Gate Review & Audit | 2 Reviewers, 2 Challengers, 1 Forensic Auditor | M4.4 | PLANNED |
| M4.6 | Publish TEST_READY.md & Handoff | Generate final TEST_READY.md report | M4.5 | PLANNED |

## Interface Contracts
### `workspace-prototype/tests/card-theming-collision.test.mjs`
- Executable via `npm test` (matches `node --test`).
- Imports and tests contracts defined in `PROJECT.md § Interface Contracts`:
  - `CardThemeId`: `"classic" | "cyberpunk" | "minimal-dark" | "glass" | "material-vibrant"`
  - `getCardTheme(id)` or theme definitions in `src/card-themes.ts`
  - Floor height clamping: `getFloorHeightAt(x, z)` (0.085 over dais, -0.12 over floor)
  - Card minimum Y center: `minCardCenterY(scale)` or box clamping
  - View navigation: `showStudio()` / `showHome()` or DOM event listeners for `[data-open-studio]`
