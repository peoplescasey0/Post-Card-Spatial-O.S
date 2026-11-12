# Scope: Card Theming Track (Milestones M1 & M3)

## Architecture
- **Theme Definition Model**:
  - `workspace-prototype/src/card-themes.ts` defines `CardThemeId`, `CardThemeDefinition`, and 5 distinct presets:
    1. `classic`: Classic Studio (Slate cardstock `#14161b` -> `#0d111a`, cyan accent `#70d5cf`, matte finish)
    2. `cyberpunk`: Cyberpunk Neon (Obsidian `#0b0416` -> `#05020a`, neon magenta `#ff007f` / cyan `#00f0ff`, high emissive glow)
    3. `minimal-dark`: Minimal Dark (AMOLED `#050505` -> `#000000`, zinc border `#27272a`, silver typography, pure matte)
    4. `glass`: Glass / Frosted (Translucent icy acrylic `rgba(26, 38, 57, 0.75)` -> `rgba(13, 20, 32, 0.85)`, crystal specular, ethereal halo)
    5. `material-vibrant`: Material Vibrant (Android Expressive indigo `#181124` -> `#0e0918`, amber `#f59e0b` / violet `#8b5cf6`, satin finish)
- **Home Screen Selector**:
  - Theme customization controls in `workspace-prototype/index.html` on `#home-view`.
  - Enables user selection between the 5 themes with visual active indicators.
- **Visual Application**:
  - Applies to 2D CSS styling on `#home-view` cards (`.home-system-card`).
  - Applies to 3D Three.js card textures via `makeCardTexture` / `computeCardContentKey` cache invalidation in `src/main.ts`.
- **Persistence**:
  - Persisted in `localStorage` under `postcard_studio_card_theme`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Theming Research Summary | Document common card theming patterns (Android home screen customization, Material You dynamic color, spatial UI tokens, dark/light/neon/glass aesthetics) in `THEMING_RESEARCH.md` | M1 | ORIGINAL_REQUEST R1 |
| 5 | Card Theming Implementation | Implement `src/card-themes.ts` with 5 presets, theme selector UI on `#home-view`, texture re-rendering, and persistence | M3 | ORIGINAL_REQUEST R1 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Theming Research Documentation | Document comprehensive theming research in `THEMING_RESEARCH.md` | none | DONE |
| M3 | Card Theming Implementation | Implement `card-themes.ts`, home screen theme controls, 3D texture integration, and persistence | M1 | DONE |

## Interface Contracts
### `card-themes.ts` ↔ `main.ts`
- `CardThemeId`: `"classic" | "cyberpunk" | "minimal-dark" | "glass" | "material-vibrant"`
- `getCardTheme(id: CardThemeId): CardThemeDefinition`
- `CARD_THEMES: Record<CardThemeId, CardThemeDefinition>`
- `CARD_THEME_IDS: readonly CardThemeId[]`
- `applyCardTheme(themeId: CardThemeId, cards?: SystemCard[]): void`
- `computeCardContentKey(card: SystemCard)` must incorporate `card.theme ?? activeThemeId`.

### Storage Contract
- `localStorage` key: `"postcard_studio_card_theme"`
- Default fallback: `"classic"`

## Code Layout & File Write Ownership
- `THEMING_RESEARCH.md`: Root research document for spatial card theming (Milestone M1).
- `workspace-prototype/src/card-themes.ts`: Theme schemas, preset palette definitions, and token helpers (Milestone M3).
- `workspace-prototype/index.html`: Home view theme picker UI markup (Milestone M3).
- `workspace-prototype/src/style.css`: Theme selector styles and home card theme overrides (Milestone M3).
- `workspace-prototype/src/main.ts`: Theme initialization, event listeners, texture cache invalidation (Milestone M3).
