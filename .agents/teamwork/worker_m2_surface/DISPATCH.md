## 2026-11-11T20:35:22Z

You are the Implementation Worker for Milestone 2: 2D & 3D Surface Integration.

MANDATORY FIRST STEP:
Read the original user request at:
G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md

Read global architecture and contracts at:
G:\micro-host\PROJECT.md

Read your milestone scope at:
G:\micro-host\.agents\teamwork\sub_orch_surface\SCOPE.md

Read the Explorer handoff reports at:
G:\micro-host\.agents\teamwork\explorer_m2_2d\handoff.md
G:\micro-host\.agents\teamwork\explorer_m2_3d_canvas\handoff.md
G:\micro-host\.agents\teamwork\explorer_m2_emissive\handoff.md

Your Identity:
- Archetype: teamwork_worker
- Role: 2D/3D Surface Implementation Worker
- Working Directory: G:\micro-host
- State Folder: G:\micro-host\.agents\teamwork\worker_m2_surface\

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership:
You exclusively own:
- `workspace-prototype/src/style.css`
- `workspace-prototype/src/main.ts`
- `PROJECT.md`

Your Mission & Concrete Tasks:
1. In `workspace-prototype/src/style.css`:
   Refactor `.home-system-card-featured` (lines 3099-3112), `::after`, and `:hover` to consume CSS custom properties with resilient fallbacks:
   - `border-color: var(--card-theme-accent, var(--card-theme-border, rgba(255, 184, 28, 0.36)));`
   - `background: var(--card-theme-bg, linear-gradient(110deg, rgba(255, 184, 28, 0.055), transparent 58%), rgba(13, 17, 26, 0.94));`
   - `box-shadow: var(--card-theme-glow, none);`
   - In `::after`: `border-color: var(--card-theme-corner, var(--card-theme-accent, rgba(255, 184, 28, 0.55)));`
   - In `:hover`: `border-color: var(--card-theme-accent, var(--card-theme-border-hover, rgba(255, 184, 28, 0.72)));`
   (See Explorer 1 handoff §4.2 for exact snippet).

2. In `workspace-prototype/src/main.ts`:
   A. 2D Surface CSS Variable Injection in `applyCardTheme(themeId)`:
      - Resolve `const theme = getCardTheme(themeId);` upfront.
      - Inject all 7 CSS variables directly onto `targetHome.style`:
        `--card-theme-bg`, `--card-theme-border`, `--card-theme-accent`, `--card-theme-glow`, `--card-theme-corner`, `--card-theme-on-surface`, `--card-theme-on-surface-variant`.
      - Maintain `dataset.cardTheme = themeId` on both `#home-view` and `#studio-view`.
      (See Explorer 1 handoff §4.1 for exact snippet).
   B. 3D Texture Rasterization & Facet Drawers:
      - In `makeCardTexture`: Pass `theme` into facet drawers (`drawCardFront(context, card, theme)`, `drawCardSettings(context, card, theme)`, etc.) and replace hardcoded footer `#c3c8d1` at line 3260 with `theme.canvas.detailColor || "#c3c8d1"`.
      - In `drawCardFront`: Replace hardcoded `#f4f5f7` (lines 3450, 3466) with `t.canvas.titleColor || "#f4f5f7"` and `#c3c8d1` (lines 3454, 3469) with `t.canvas.detailColor || "#c3c8d1"`.
      - In facet drawers (`drawCardSettings`, `drawCardSecurity`, `drawCardPlanes`, `drawCardQuickActions`, `drawCardTelemetry`):
        Update each to accept optional `theme?: CardThemeDefinition`, with fallback `const t = theme ?? getCardTheme(card.theme ?? activeCardThemeId);`.
        Replace `#f4f5f7` and `#c3c8d1` with `t.canvas.titleColor || "#f4f5f7"` and `t.canvas.detailColor || "#c3c8d1"`, and `#FFB81C` section labels with `t.canvas.badgeColor || "#FFB81C"`.
      - In shared helpers (`drawStatusFooter`, `drawKeyValueRows`, `drawMessageBox`, `blurCardCanvas`):
        Update status text color, row labels/values, and notes to consume theme tokens with fallbacks.
      (See Explorer 2 handoff §4.1-4.4 for exact snippets).
   C. 3D Selection Emissive & Turntable Loop:
      - Module level: `let currentCardTheme: CardThemeDefinition = getCardTheme(activeCardThemeId);` (update in `applyCardTheme`).
      - In `selectCard` (~line 4457): Replace hardcoded `#70d5cf` / `#152631` with `activeTheme.material.edgeEmissive || activeTheme.swatchPrimary` and `activeTheme.material.edgeColor || "#152631"` with `edgeEmissiveIntensity` handling.
      - In turntable carousel loop (~line 8089): Apply the identical active theme edge emissive / edge color logic.
      - In render loop line 8140: Use `selectedCard.theme ? getCardTheme(selectedCard.theme) : currentCardTheme` for `haloTarget` and `floorTarget`.
      (See Explorer 3 handoff §4.1 for exact snippets).

3. In `PROJECT.md`:
   Add the Fedora Workstation infrastructure documentation required by `tests/card-theming-collision.test.mjs` line 546:
   Ensure `PROJECT.md` contains the text documenting Fedora host `10.0.0.2` and `Node.js v26` / `Firefox` toolchain.

4. Run Builds and Tests:
   Execute inside `workspace-prototype/`:
   - `npx tsc --noEmit` (must exit 0 with 0 errors)
   - `node --test tests/android-theming-integration.test.mjs` (must pass 100%)
   - `npm test` (all 195+ tests across all 20 test files must pass with 0 failures and 0 regressions!)

Write your comprehensive completion handoff report to:
`G:\micro-host\.agents\teamwork\worker_m2_surface\handoff.md`
Report when done.
