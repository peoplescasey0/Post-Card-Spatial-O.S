# Scope: Milestone 1 — Android Theming Engine & Presets

## Objective
Implement an authentic Android Material Design 3 (Material You) theming engine in `workspace-prototype/src/card-themes.ts` with dynamic tonal palette generation from seed colors and 5 authentic Android Material preset themes, strictly maintaining backwards compatibility with existing tests.

## Key Requirements
1. **Preserve Canonical Theme IDs**:
   - `CARD_THEME_IDS = ["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"] as const;` must retain `length === 5` to satisfy existing test assertions (`card-theming.test.mjs:15`).
2. **Android Presets**:
   - Define `ANDROID_THEME_IDS = ["pixel-blue", "forest-emerald", "lavender-mist", "sunset-amber", "obsidian-monochrome"] as const;`.
   - Implement the 5 authentic presets with their 13-tone palettes and 22 semantic color roles for dark/light modes.
3. **Dynamic Seed Color Generation**:
   - Implement zero-dependency HCT / CIELAB ($L^*a^*b^*$) color transformation pipeline with 16-step chroma bisection for sRGB gamut boundary solving.
   - Implement `generateThemeFromSeed(seedHex: string, options?: { mode?: "dark" | "light" }): CardThemeDefinition`.
   - Generate the 5 core tonal palettes ($P, S, T, N, NV$) across standard stops `[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100]`.
   - Map into `CanvasThemeTokens`, `MaterialThemeTokens`, `LightingThemeTokens`, and `HomeCssThemeTokens`.
   - Ensure WCAG AA contrast compliance ($\ge 4.5:1$) between text and containers.
   - Handle edge cases: 3-char hex, leading `#` or spaces, invalid hex (fallback to M3 `#6750A4`), low chroma monochrome ($C < 8$).
4. **Unified Theme Lookup & Persistence**:
   - Update `getCardTheme(id: string): CardThemeDefinition` to look up canonical presets, Android presets, or dynamic `seed:#HEX` / `#HEX`.
   - Update `isValidCardThemeId(id: string): boolean` to validate canonical IDs, Android preset IDs, and valid seed colors.
   - Update `loadPersistedTheme()` and `persistTheme(themeId: string)` to support both preset IDs and `seed:#HEX` descriptors.
5. **Verification**:
   - `npm test` inside `workspace-prototype/` must pass all tests with 0 failures.
   - `npx tsc --noEmit` must exit 0 with 0 errors.

## Primary References
- `G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md`
- `G:\micro-host\PROJECT.md`
- `G:\micro-host\.agents\teamwork\spec_miner_android_theming\handoff.md`
- `G:\micro-host\.agents\teamwork\explorer_survey_theming\handoff.md`
- `G:\micro-host\workspace-prototype/src/card-themes.ts`

## Milestone Status: DONE
- **Gate Result**: PASS (Iteration 2)
- **Reviewer 3**: APPROVE
- **Reviewer 4**: APPROVE
- **Challenger 3**: APPROVE
- **Challenger 4**: APPROVE
- **Forensic Auditor 2**: CLEAN
- **Deliverables Verified**: `workspace-prototype/src/card-themes.ts`, zero compilation errors (`npx tsc --noEmit`), 188+ tests passing with 0 failures (`npm test`).
