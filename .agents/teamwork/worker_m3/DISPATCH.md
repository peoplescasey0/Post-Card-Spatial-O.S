## 2026-11-11T18:14:44Z
You are the Worker for Milestone M3: Home Screen Card Theming Customization Implementation.

MANDATORY FIRST STEPS:
1. Read g:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. Read g:\micro-host\PROJECT.md
3. Read g:\micro-host\.agents\teamwork\sub_orch_theming\SCOPE.md
4. Read g:\micro-host\THEMING_RESEARCH.md
5. Read exploration blueprints:
   - g:\micro-host\.agents\teamwork\explorer_m3_1\handoff.md (and reference g:\micro-host\.agents\teamwork\explorer_m3_1\proposed_card-themes.ts)
   - g:\micro-host\.agents\teamwork\explorer_m3_2\handoff.md
   - g:\micro-host\.agents\teamwork\spec_miner_m3\handoff.md

State folder: g:\micro-host\.agents\teamwork\worker_m3\
Working directory: g:\micro-host

Your Mission:
Implement complete Home Screen Card Theming Customization across the 5 canonical themes: Classic Studio, Cyberpunk Neon, Minimal Dark, Glass / Frosted, and Material Vibrant.

File Write Ownership:
- `workspace-prototype/src/card-themes.ts` (create)
- `workspace-prototype/index.html` (theme picker markup in `#home-view`)
- `workspace-prototype/src/style.css` (theme picker styles and `#home-view[data-card-theme]` custom property bindings)
- `workspace-prototype/src/main.ts` (theme engine integration, texture cache invalidation, Three.js material/light synchronization, persistence)

Implementation Details:
1. `workspace-prototype/src/card-themes.ts`:
   - Create this file following the reference in `explorer_m3_1\proposed_card-themes.ts` and `THEMING_RESEARCH.md`.
   - Export `CardThemeId`, `CardThemeDefinition`, `CanvasThemeTokens`, `MaterialThemeTokens`, `LightingThemeTokens`, `HomeCssThemeTokens`.
   - Define all 5 canonical presets: `classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`.
   - Export helpers: `getCardTheme(id: string): CardThemeDefinition`, `isValidCardThemeId(id: string): id is CardThemeId`, `CARD_THEMES`, `CARD_THEME_IDS`, `DEFAULT_CARD_THEME_ID = "classic"`, `THEME_STORAGE_KEY = "postcard_studio_card_theme"`, `loadPersistedTheme(): CardThemeId`, `persistTheme(themeId: CardThemeId): void`.
2. `workspace-prototype/index.html`:
   - In `#home-view`, insert `.home-theme-bar` between `.home-section-heading` and `.home-system-grid` (around line 82-84) as detailed in `explorer_m3_2\handoff.md`.
   - Provide `<div class="home-theme-picker" data-theme-picker role="radiogroup" aria-label="Card Theme">` with 5 `<button class="theme-chip" type="button" role="radio" data-theme-id="...">` chips and gradient `.theme-swatch` swatches.
3. `workspace-prototype/src/style.css`:
   - Add styles for `.home-theme-bar`, `.home-theme-picker`, `.theme-chip`, `.theme-chip.is-active`, `.theme-swatch`.
   - Add `#home-view[data-card-theme="..."]` CSS rules mapping theme tokens to `--card-theme-bg`, `--card-theme-border`, `--card-theme-corner`, `--card-theme-accent`, `--card-theme-glow`, etc., so `.home-system-card` elements reflect the selected theme visibly.
   - Include responsive breakpoints for mobile/tablet.
4. `workspace-prototype/src/main.ts`:
   - Import theme types and helpers from `./card-themes.js` (or `./card-themes.ts`).
   - Track `activeCardThemeId: CardThemeId = loadPersistedTheme()`.
   - Store mesh references on `SystemCard`: `edgeMesh?: THREE.Mesh`, `frontMesh?: THREE.Mesh`, `backMesh?: THREE.Mesh`.
   - In `computeCardContentKey(card: SystemCard)`: prepend `card.theme ?? activeCardThemeId` to ensure cache invalidation when the theme changes.
   - In `makeCardTexture(card: SystemCard, facet: CardFacet)`: use the active theme's `bgTop`, `bgBottom`, `borderStroke`, `borderWidth`, `fastenerRim`, `fastenerHead`.
   - In `drawCardButtons`: use active theme's `buttonFill`, `buttonStroke`, `buttonText` (preserving danger accent for `bin` and `stop`).
   - In `createCard`: initialize Three.js materials (`roughness`, `metalness`, `emissive`, `emissiveIntensity`, edge chassis color) from active theme, and record `edgeMesh`, `frontMesh`, and `backMesh` on `card`.
   - Implement `applyCardTheme(themeId: CardThemeId)`:
     - Persist to `localStorage`.
     - Set `data-card-theme` on `#home-view` and `#studio-view`.
     - Update `.is-active` and `aria-checked="true"` on theme chips in the DOM.
     - Update scene lights (`cardHaloLight`, `cardFloorGlow`) smoothly.
     - For each card: update PBR materials and invoke `refreshCardTexture(card, true)` (with texture disposal).
   - Wire event listeners on `.theme-chip` buttons.
   - Initialize theme on startup by calling `applyCardTheme(activeCardThemeId)`.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Verification Requirements:
- Run `npm test` inside `workspace-prototype` and verify that all tests pass.
- Run `npm run build` inside `workspace-prototype` and verify zero TypeScript or Vite errors.
- Document exact commands and test output in your handoff report.
- Write your handoff report to `g:\micro-host\.agents\teamwork\worker_m3\handoff.md`.
- Send a completion message back to parent when done.


## 2026-11-11T18:24:53Z
**Context**: Milestone M3 Worker Implementation Status Check
**Content**: Checking in on progress for Milestone M3. We observed `card-themes.ts` has been created. Are you currently updating `index.html`, `style.css`, and `main.ts`, or running the test suites?
**Action**: Please provide a brief status update or handoff report when ready.
