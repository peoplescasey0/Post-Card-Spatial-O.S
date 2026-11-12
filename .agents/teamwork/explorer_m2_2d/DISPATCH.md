## 2026-11-11T20:25:08Z
You are Explorer 1 for Milestone 2: 2D & 3D Surface Integration.

MANDATORY FIRST STEP:
Read the original user request at:
G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md

Read global architecture and contracts at:
G:\micro-host\PROJECT.md

Read your milestone scope at:
G:\micro-host\.agents\teamwork\sub_orch_surface\SCOPE.md

Your Identity:
- Archetype: teamwork_explorer
- Role: 2D Surface Explorer
- Working Directory: G:\micro-host
- State Folder: G:\micro-host\.agents\teamwork\explorer_m2_2d\

Your Mission:
Investigate 2D surface integration in `workspace-prototype/src/style.css` and `workspace-prototype/src/main.ts`:
1. In `src/main.ts`'s `applyCardTheme(themeId)`:
   Inspect lines ~4575-4605 where `homeViewElement.dataset.cardTheme = themeId` is currently set.
   Determine exact code changes to inject CSS custom properties directly onto `homeViewElement.style`:
   - `--card-theme-bg`: `theme.homeCss.cardBg`
   - `--card-theme-border`: `theme.homeCss.cardBorder`
   - `--card-theme-accent`: `theme.homeCss.cardAccent`
   - `--card-theme-glow`: `theme.homeCss.cardGlow`
   - `--card-theme-corner`: `theme.canvas.borderStroke`
   - `--card-theme-on-surface`: `theme.canvas.titleColor`
   - `--card-theme-on-surface-variant`: `theme.canvas.detailColor`
   Also inspect if any fallback handling is required for seed/dynamic themes or undefined values.
2. In `src/style.css`:
   Inspect `.home-system-card-featured` (lines ~3099-3112) and surrounding card rules (lines 3060-3120).
   Determine exact CSS rules needed to refactor `.home-system-card-featured` to consume `var(--card-theme-accent)` and `var(--card-theme-border)` rather than hardcoded amber `rgba(255, 184, 28, ...)`.
   Verify whether `.home-system-card-featured::after` and `:hover` also need to consume the theme variables.
3. Check `workspace-prototype/tests/` to see if any existing tests check `#home-view` style or dataset properties.

Write your comprehensive, self-contained handoff report to:
`G:\micro-host\.agents\teamwork\explorer_m2_2d\handoff.md`
Report when done.
