## 2026-11-11T19:10:52Z
You are a Specification Miner researching Android Material Design 3 (Material You) theming rules, dynamic tonal palette generation algorithms, and standard preset themes.

Read the original user request at:
G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md

Also read:
G:\micro-host\THEMING_RESEARCH.md

Your State Folder:
G:\micro-host\.agents\teamwork\spec_miner_android_theming\

Working Directory:
G:\micro-host

Your Investigation Scope:
1. Dynamic Color Generation from Seed Color:
   - Detail the standard Android Material Design 3 / Material You tonal palette generation algorithm (HCT / CAM16 / tonal curves or robust RGB/HSL/HCT mathematical approximations).
   - Define the standard key tonal palettes: Primary, Secondary, Tertiary, Neutral, Neutral Variant.
   - Define the standard tonal levels (e.g. 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100).
   - Detail the mapping of tones to semantic color roles for cards & UI surfaces:
     * Surface & Containers: `surface`, `surfaceDim`, `surfaceBright`, `surfaceContainerLowest`, `surfaceContainerLow`, `surfaceContainer`, `surfaceContainerHigh`, `surfaceContainerHighest`
     * Content/Text: `onSurface`, `onSurfaceVariant`
     * Accent & Actions: `primary`, `onPrimary`, `primaryContainer`, `onPrimaryContainer`
     * Secondary & Badges: `secondary`, `onSecondary`, `secondaryContainer`, `onSecondaryContainer`
     * Tertiary: `tertiary`, `onTertiary`, `tertiaryContainer`, `onTertiaryContainer`
     * Outlines/Borders: `outline`, `outlineVariant`
   - Specify a clean, self-contained, dependency-free TypeScript/JavaScript implementation for palette generation from any arbitrary hex seed color (e.g. #3F51B5, #4CAF50, #E91E63, etc.) suitable for immediate integration in the browser and Node.js test environment.
2. Android Material Preset Themes:
   - Define at least 5 authentic Android Material preset palettes (e.g. Pixel Default / Dynamic Blue, Forest Emerald, Lavender Mist, Sunset Amber, Obsidian Monochrome).
   - For each preset, define its seed color and exact tonal mapping / semantic role tokens for dark mode (and light mode if applicable, noting Post Card OS spatial dark aesthetic).
3. Contract Definition:
   - Provide exact TypeScript interface definitions for `AndroidTonalPalette`, `AndroidThemeRoles`, `AndroidThemePreset`, and the generator function signature `generateThemeFromSeed(seedHex: string): AndroidTheme`.

Deliverable:
Write a comprehensive specification handoff report to:
`G:\micro-host\.agents\teamwork\spec_miner_android_theming\handoff.md`

Send a completion message back to parent when done.
