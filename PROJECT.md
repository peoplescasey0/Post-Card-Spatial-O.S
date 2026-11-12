# Project: Post Card Spatial OS - Android Theming System

## Architecture
- **Workspace Architecture**: `workspace-prototype/` built with Vite, TypeScript 5.9, Three.js 0.180.0, Node.js test runner (`node --test`).
- **View Hierarchy**:
  - `#home-view`: Landing screen with hero CTA, system card buttons (`data-open-studio`, `data-card-id`), Android preset theme selector, and dynamic seed-color customization controls.
  - `#studio-view`: 3D spatial computing environment with Three.js turntable deck, physical cards (`SystemCard`), PBR materials, procedural canvas textures, tactile printed buttons, dais, obsidian floor, and topbar theme controls.
- **Theming Engine (`src/card-themes.ts`)**:
  - **Android Material 3 / Material You Color Science**: Zero-dependency HCT / CIELAB ($L^*a^*b^*$) color transformation pipeline with 16-step chroma bisection for sRGB gamut boundary solving.
  - **Tonal Palettes**: 5 core tonal palettes ($P$: Primary, $S$: Secondary, $T$: Tertiary, $N$: Neutral, $NV$: Neutral Variant) spanning 13 standard stops `[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100]`.
  - **Semantic Color Roles**: 22 MD3 semantic color roles (Surface containers, typography/content, primary/secondary/tertiary accents, outlines) mapped into `CanvasThemeTokens`, `MaterialThemeTokens`, `LightingThemeTokens`, and `HomeCssThemeTokens`.
  - **Preset Themes**: 5 authentic Android Material presets (`pixel-blue`, `forest-emerald`, `lavender-mist`, `sunset-amber`, `obsidian-monochrome`) alongside the canonical 5 themes (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`).
  - **Dynamic Theme Generation**: `generateThemeFromSeed(seedHex, options)` generates complete, coordinated `CardThemeDefinition` objects for any arbitrary hex color.
- **2D & 3D Surface Integration**:
  - **2D Cards (`#home-view`)**: Dynamic inline CSS custom property injection on `homeViewElement.style` (`--card-theme-bg`, `--card-theme-border`, `--card-theme-accent`, `--card-theme-on-surface`, `--card-theme-on-surface-variant`, `--card-theme-corner`, `--card-theme-glow`). Featured card in `style.css` refactored to consume theme accent.
  - **3D Spatial Cards (`#studio-view`)**: Canvas texture rasterization consumes theme `titleColor` / `onSurface` and `detailColor` / `onSurfaceVariant` in `drawCardFront` and all facet drawers. Selection emissive in `selectCard` and turntable render loop consumes `theme.material.edgeEmissive` rather than hardcoded cyan. Texture cache invalidation via content key hash.
- **Theme Controls & State Persistence**:
  - Interface controls on `#home-view` (preset radio chips, seed `<input type="color">`, hex input, preset swatches) and `#studio-view` topbar.
  - State persisted in `localStorage` under `"postcard_studio_card_theme"`, supporting preset IDs and `seed:#HEX` descriptors with safe fallback.
  - Active theme preserved across navigation between `#home-view` and `#studio-view`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Android Theming Engine | Implement zero-dependency HCT/CIELAB tonal palette generator deriving 5 core palettes (13 stops) and 22 semantic roles from any seed color | M1 | ORIGINAL_REQUEST R1 |
| 2 | Android Preset Themes | Implement 5 canonical Android Material presets (Pixel Blue, Forest Emerald, Lavender Mist, Sunset Amber, Obsidian Monochrome) | M1 | ORIGINAL_REQUEST R1 |
| 3 | 2D Home View Surface Integration | Dynamically inject CSS variables onto `#home-view.style` and update featured card styling to consume theme tokens | M2 | ORIGINAL_REQUEST R2 |
| 4 | 3D Spatial Cards Surface Integration | Update `makeCardTexture` facet drawers to consume `theme.canvas` text/accent tokens and fix `selectCard` / turntable emissive overwrite | M2 | ORIGINAL_REQUEST R2 |
| 5 | Theme Selection Controls | Provide preset chips, seed-color picker (`<input type="color">`), hex input, and swatches on `#home-view` and topbar controls on `#studio-view` | M3 | ORIGINAL_REQUEST R3 |
| 6 | State Persistence & View Navigation | Persist preset IDs and `seed:#HEX` descriptors in `localStorage` and ensure active theme remains active when switching between 2D and 3D views | M3 | ORIGINAL_REQUEST R3 |
| 7 | Automated Test Suite Expansion | Add comprehensive 4-tier automated test suite verifying palette generation, preset availability, 2D/3D surface integration, and view persistence | M4 | ORIGINAL_REQUEST AC |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Android Theming Engine & Presets | `src/card-themes.ts`: HCT/CIELAB color engine, 13 stops, 22 roles, 5 Android presets, `generateThemeFromSeed` | none | DONE |
| M2 | 2D & 3D Surface Integration | `src/main.ts`, `src/style.css`: Dynamic CSS injection for 2D cards, 3D canvas drawer token consumption, emissive fix | M1 | DONE |
| M3 | Theme Controls & View Persistence | `index.html`, `src/main.ts`, `src/style.css`: Home view picker + seed color input, studio topbar controls, view sync, persistence | M1, M2 | IN_PROGRESS |
| M4 | E2E Testing & Dual-Track Verification | `tests/android-theming-integration.test.mjs`: 4-tier automated tests, regression check across all tests, build verification | M1, M2, M3 | DONE |

## Interface Contracts
### `card-themes.ts` ↔ Application
- Canonical IDs preserved: `CARD_THEME_IDS = ["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"]` (length === 5).
- Android preset IDs: `ANDROID_THEME_IDS = ["pixel-blue", "forest-emerald", "lavender-mist", "sunset-amber", "obsidian-monochrome"]`.
- `generateThemeFromSeed(seedHex: string, options?: { mode?: "dark" | "light" }): CardThemeDefinition`
- `getCardTheme(id: string): CardThemeDefinition` (handles canonical IDs, Android preset IDs, and `seed:#HEX` dynamic IDs with fallback to `classic`).
- `isValidCardThemeId(id: string): boolean` (validates canonical, android presets, and `seed:#HEX`).
- `loadPersistedTheme(): string` (rehydrates preset or `seed:#HEX`).
- `persistTheme(themeId: string): void`

### Theming ↔ 2D View
- `applyCardTheme(themeId: string): void` sets:
  - `homeViewElement.dataset.cardTheme = themeId`
  - `homeViewElement.style.setProperty("--card-theme-bg", ...)`
  - `homeViewElement.style.setProperty("--card-theme-border", ...)`
  - `homeViewElement.style.setProperty("--card-theme-accent", ...)`
  - `homeViewElement.style.setProperty("--card-theme-glow", ...)`
  - `homeViewElement.style.setProperty("--card-theme-on-surface", ...)`
  - `homeViewElement.style.setProperty("--card-theme-on-surface-variant", ...)`

### Theming ↔ 3D Spatial Cards
- `makeCardTexture(card, facet)` consumes:
  - `theme.canvas.titleColor` for card titles and section headers (replaces hardcoded `#f4f5f7`).
  - `theme.canvas.detailColor` for subtitles and metadata notes (replaces hardcoded `#c3c8d1`).
  - `theme.canvas.borderStroke` / `theme.canvas.badgeColor` for facet badges and accents.
- `selectCard` and turntable render loop use:
  - `material.emissive.set(item === card ? (theme.material.edgeEmissive || theme.swatchPrimary) : (theme.material.edgeColor || "#152631"))`.
- `computeCardContentKey(card)` prefixes key with active theme ID or seed descriptor.

## Code Layout
- `workspace-prototype/src/card-themes.ts`: Theme schemas, color science math, tonal palette generation, Android presets, theme registry, persistence.
- `workspace-prototype/src/main.ts`: 2D CSS custom property injection, 3D texture drawer token consumption, selection emissive fix, studio controls, view routing.
- `workspace-prototype/src/style.css`: 2D card styling, featured card theme accent inheritance, seed picker and studio topbar theme control styling.
- `workspace-prototype/index.html`: Home view seed color picker and preset chip markup, studio view theme selector markup.
- `workspace-prototype/tests/android-theming-integration.test.mjs`: New automated test suite covering all 4 tiers of theming, surface integration, and view persistence.

## Remote Workstation Verification Infrastructure
- Fedora Workstation KVM host: `10.0.0.2` (toolchain: Node.js v26, Firefox headless).

