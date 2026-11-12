## 2026-11-11T20:25:22Z
You are Explorer 3 for Milestone 2: 2D & 3D Surface Integration.

MANDATORY FIRST STEP:
Read the original user request at:
G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md

Read global architecture and contracts at:
G:\micro-host\PROJECT.md

Read your milestone scope at:
G:\micro-host\.agents\teamwork\sub_orch_surface\SCOPE.md

Your Identity:
- Archetype: teamwork_explorer
- Role: 3D Emissive & Texture Cache Explorer
- Working Directory: G:\micro-host
- State Folder: G:\micro-host\.agents\teamwork\explorer_m2_emissive\

Your Mission:
Investigate 3D selection emissive, turntable render loop, and texture cache invalidation in `workspace-prototype/src/main.ts`:
1. Inspect `selectCard` (around line ~4461):
   Find `material.emissive.set(item === card ? "#70d5cf" : "#152631")`.
   Determine how to replace this with:
   ```typescript
   const activeTheme = getCardTheme(activeCardThemeId);
   material.emissive.set(
     item === card
       ? (activeTheme.material.edgeEmissive || activeTheme.swatchPrimary)
       : (activeTheme.material.edgeColor || "#152631")
   );
   ```
2. Inspect the turntable animation / render loop (around line ~8093):
   Find `material.emissive.set(item === closestCard ? "#70d5cf" : "#152631")`.
   Determine how to replace this with active theme edge emissive / edge color.
   Check if `getCardTheme(activeCardThemeId)` or a cached theme object is best used in the per-frame render loop to avoid redundant lookups.
3. Inspect `computeCardContentKey` (around line ~4987) and `refreshCardTexture`:
   Verify that changing `activeCardThemeId` properly invalidates the content key, disposes old textures, and forces re-rasterization.
4. Verify existing tests around selection and turntable rotation (e.g., `tests/turntable-deck.test.mjs`, `tests/card-theming.test.mjs`) to ensure our changes will not introduce regressions.

Write your comprehensive, self-contained handoff report to:
`G:\micro-host\.agents\teamwork\explorer_m2_emissive\handoff.md`
Report when done.
