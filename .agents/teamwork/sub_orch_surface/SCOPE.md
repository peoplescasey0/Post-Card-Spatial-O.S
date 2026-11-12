# Scope: Milestone 2 — 2D & 3D Surface Integration

## Objective
Apply theme palettes consistently across both 2D home-screen cards and 3D spatial studio cards in `workspace-prototype/src/main.ts` and `workspace-prototype/src/style.css`, updating card surfaces, accents, typography, and container styling.

## Key Requirements
1. **2D Home View Surface Integration (`src/style.css` & `src/main.ts`)**:
   - In `main.ts`'s `applyCardTheme(themeId)`:
     Inject CSS custom properties directly onto `homeViewElement.style`:
     `--card-theme-bg`: `theme.homeCss.cardBg`
     `--card-theme-border`: `theme.homeCss.cardBorder`
     `--card-theme-accent`: `theme.homeCss.cardAccent`
     `--card-theme-glow`: `theme.homeCss.cardGlow`
     `--card-theme-corner`: `theme.canvas.borderStroke`
     `--card-theme-on-surface`: `theme.canvas.titleColor`
     `--card-theme-on-surface-variant`: `theme.canvas.detailColor`
   - In `style.css`:
     Refactor `.home-system-card-featured` (`lines 3099-3112`) to consume `var(--card-theme-accent)` and `var(--card-theme-border)` rather than hardcoding amber `rgba(255, 184, 28, ...)`.
2. **3D Spatial Studio Cards Integration (`src/main.ts`)**:
   - In `drawCardFront` (lines 3450, 3454, 3466, 3469):
     Replace hardcoded `context.fillStyle = "#f4f5f7"` with `theme.canvas.titleColor || "#f4f5f7"`.
     Replace hardcoded `context.fillStyle = "#c3c8d1"` with `theme.canvas.detailColor || "#c3c8d1"`.
   - In facet drawers (`drawCardSettings`, `drawCardSecurity`, `drawCardPlanes`, `drawCardQuickActions`, `drawCardTelemetry`):
     Replace hardcoded `#f4f5f7` and `#c3c8d1` with `theme.canvas.titleColor` and `theme.canvas.detailColor`.
   - In `selectCard` (line 4461) and turntable render loop (line 8093):
     Replace hardcoded `material.emissive.set(item === card ? "#70d5cf" : "#152631")` with:
     ```typescript
     const activeTheme = getCardTheme(activeCardThemeId);
     material.emissive.set(
       item === card
         ? (activeTheme.material.edgeEmissive || activeTheme.swatchPrimary)
         : (activeTheme.material.edgeColor || "#152631")
     );
     ```
   - Ensure `refreshCardTexture(card, true)` and `computeCardContentKey` dispose stale textures and re-rasterize new textures on theme changes.
3. **Verification**:
   - `npx tsc --noEmit` must pass with 0 errors.
   - `npm test` inside `workspace-prototype/` must pass all 188+ tests with 0 failures, 0 regressions.

## Primary References
- `G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md`
- `G:\micro-host\PROJECT.md`
- `G:\micro-host\.agents\teamwork\explorer_survey_theming\handoff.md`
- `G:\micro-host\.agents\teamwork\explorer_survey_integration\handoff.md`
- `G:\micro-host\workspace-prototype/src/card-themes.ts`
- `G:\micro-host\workspace-prototype/src/main.ts`
- `G:\micro-host\workspace-prototype/src/style.css`
