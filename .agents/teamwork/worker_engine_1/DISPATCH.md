# Task Assignment: Worker Engine 1 — Android Theming Engine

## Identity & Context
- Role: `teamwork_worker`
- State Folder: `G:\micro-host\.agents\teamwork\worker_engine_1\`
- Working Directory: `G:\micro-host`
- Exclusively Owned Source File: `G:\micro-host\workspace-prototype\src\card-themes.ts`

## Mandatory First Step
Read the following files before taking any action:
1. `G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md`
2. `G:\micro-host\PROJECT.md`
3. `G:\micro-host\.agents\teamwork\sub_orch_engine\SCOPE.md`
4. `G:\micro-host\.agents\teamwork\spec_miner_android_theming\handoff.md` (Contains full color science pipeline and reference code)
5. `G:\micro-host\.agents\teamwork\explorer_survey_theming\handoff.md`
6. `G:\micro-host\workspace-prototype\src\card-themes.ts`

## MANDATORY INTEGRITY WARNING
> DO NOT CHEAT. All implementations must be genuine. DO NOT
> hardcode test results, create dummy/facade implementations, or
> circumvent the intended task. A teamwork_auditor will independently
> verify your work. Integrity violations WILL be detected and your
> work WILL be rejected.

## Detailed Requirements
Implement in `workspace-prototype/src/card-themes.ts`:

1. **Preserve Canonical Theme IDs (Backwards Compatibility)**:
   - `export const CARD_THEME_IDS = ["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"] as const;`
   - MUST maintain `CARD_THEME_IDS.length === 5` (verified by existing tests).
   - Export `ANDROID_THEME_IDS = ["pixel-blue", "forest-emerald", "lavender-mist", "sunset-amber", "obsidian-monochrome"] as const;`.
   - Export `ALL_PRESET_THEME_IDS = [...CARD_THEME_IDS, ...ANDROID_THEME_IDS] as const;`.
   - Export types: `CanonicalCardThemeId`, `AndroidThemeId`, and updated `CardThemeId = CanonicalCardThemeId | AndroidThemeId | string;`.

2. **Zero-Dependency HCT / CIELAB ($L^*a^*b^*$) Color Science Engine**:
   - `srgbToLinear`, `linearToSrgb`.
   - `rgbToXyz` (D65 standard illuminant), `xyzToLab`, `labToLch`, `lchToLab`, `labToXyz`, `xyzToRgb`.
   - Tone $T \equiv L^* \in [0, 100]$: Perceptual luminance invariant.
   - 16-step chroma bisection gamut boundary solver: For a target Tone $T$, Hue $h$, and Chroma $C$, finds the maximum in-gamut sRGB hex without clipping distortion. Tones $T=0 \implies$ `#000000`, $T=100 \implies$ `#ffffff`.

3. **5 Core Tonal Palettes (13 Standard Stops)**:
   - Stops: `[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100]`.
   - $P$ (Primary): $H = H_{\text{seed}}, C = \max(C_{\text{seed}}, 48)$.
   - $S$ (Secondary): $H = H_{\text{seed}}, C = 16$.
   - $T$ (Tertiary): $H = (H_{\text{seed}} + 60^\circ) \pmod{360^\circ}, C = 24$.
   - $N$ (Neutral): $H = H_{\text{seed}}, C = 4$.
   - $NV$ (Neutral Variant): $H = H_{\text{seed}}, C = 8$.
   - Achromatic check: if $C_{\text{seed}} < 8$, clamp $C = 0$ across all 5 palettes (pure neutral grayscale, Android 14 Monochrome).

4. **22 MD3 Semantic Color Roles**:
   - Surface containers: `surface`, `surfaceDim`, `surfaceBright`, `surfaceContainerLowest`, `surfaceContainerLow`, `surfaceContainer`, `surfaceContainerHigh`, `surfaceContainerHighest`.
   - Typography/Content: `onSurface`, `onSurfaceVariant`.
   - Primary: `primary`, `onPrimary`, `primaryContainer`, `onPrimaryContainer`.
   - Secondary: `secondary`, `onSecondary`, `secondaryContainer`, `onSecondaryContainer`.
   - Tertiary: `tertiary`, `onTertiary`, `tertiaryContainer`, `onTertiaryContainer`.
   - Outlines: `outline`, `outlineVariant`.
   - Provide dark mode (default for Post Card OS) and light mode mappings.

5. **Post Card OS Adapter Tokens**:
   - `canvas: CanvasThemeTokens` (bgTop, bgBottom, bgGradientStop, borderStroke, borderWidth, badgeColor, headerColor, titleColor, detailColor, buttonFill, buttonStroke, buttonText, fastenerRim, fastenerHead).
   - `material: MaterialThemeTokens` (roughness, metalness, emissive, emissiveIntensity, edgeColor, edgeEmissive, edgeEmissiveIntensity, edgeRoughness, edgeMetalness).
   - `lighting: LightingThemeTokens` (haloColor, haloIntensity, floorGlowColor, floorGlowIntensity).
   - `homeCss: HomeCssThemeTokens` (cardBg, cardBorder, cardAccent, cardGlow, badgeBg, badgeText, CSS variables `--card-theme-*` and `--home-*`).
   - `CardThemeDefinition`: Include `seedColor?: string`, `palettes?: AndroidPalettes`, `roles?: AndroidThemeRoles`, and ensure `css?: HomeCssThemeTokens` mirrors `homeCss` for backward compatibility.

6. **5 Authentic Android Preset Themes**:
   - `pixel-blue`: Seed `#1A73E8`
   - `forest-emerald`: Seed `#0F9D58`
   - `lavender-mist`: Seed `#6750A4`
   - `sunset-amber`: Seed `#F59E0B`
   - `obsidian-monochrome`: Seed `#71717A`

7. **Dynamic Theme Generation (`generateThemeFromSeed`)**:
   - `generateThemeFromSeed(seedHex: string, options?: { mode?: "dark" | "light" }): CardThemeDefinition`.
   - Handle input edge cases: trim whitespace, strip optional `#`, expand 3-character hex (e.g. `#fff` -> `#ffffff`), fallback to `#6750A4` on invalid hex string.

8. **Unified Theme Lookup & Persistence**:
   - `getCardTheme(id: string): CardThemeDefinition`: Looks up canonical preset, Android preset, or generates dynamic theme if `id` starts with `seed:` or is a valid hex. Falls back safely to `"classic"`.
   - `isValidCardThemeId(id: string): boolean`: Validates canonical, Android presets, or valid `seed:#HEX` / `#HEX`.
   - `loadPersistedTheme(): string`: Rehydrates valid theme ID or falls back to `"classic"`.
   - `persistTheme(themeId: string): void`: Persists valid theme ID to `localStorage`.

9. **Verification**:
   - Run `npx tsc --noEmit` inside `workspace-prototype/`. Must exit 0 with 0 errors.
   - Run `npm test` inside `workspace-prototype/`. All 117+ baseline tests must pass with 0 failures.

## Reporting
Document all implementation details, commands run, build and test outputs, and write your handoff report to:
`G:\micro-host\.agents\teamwork\worker_engine_1\handoff.md`.
Then send a completion message back to the orchestrator.


## 2026-11-11T19:28:00Z
Received dispatch from 450ec46d-fd59-4548-852f-0d8efc3def1d:
You are Worker Engine 1 for Milestone 1: Android Theming Engine.
Read your task assignment and mandatory requirements at: G:\micro-host\.agents\teamwork\worker_engine_1\DISPATCH.md
Your state folder: G:\micro-host\.agents\teamwork\worker_engine_1\
Your working directory: G:\micro-host
Mandatory files to read first:
1. G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. G:\micro-host\PROJECT.md
3. G:\micro-host\.agents\teamwork\sub_orch_engine\SCOPE.md
4. G:\micro-host\.agents\teamwork\spec_miner_android_theming\handoff.md (Contains complete color science pipeline and reference code)
5. G:\micro-host\.agents\teamwork\explorer_survey_theming\handoff.md
6. G:\micro-host\workspace-prototype\src\card-themes.ts
Implement the Android theming engine in `workspace-prototype/src/card-themes.ts`, run `npx tsc --noEmit` and `npm test` inside `workspace-prototype/`, verify all 117+ baseline tests pass, write your handoff report to `G:\micro-host\.agents\teamwork\worker_engine_1\handoff.md`, and send a completion message back.
