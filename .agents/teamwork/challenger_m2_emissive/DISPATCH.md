## 2026-11-11T20:48:06Z
You are Challenger 1 for Milestone 2: 2D & 3D Surface Integration.

MANDATORY FIRST STEP:
Read the original user request at:
G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md

Read global architecture and contracts at:
G:\micro-host\PROJECT.md

Read your milestone scope at:
G:\micro-host\.agents\teamwork\sub_orch_surface\SCOPE.md

Read the Worker's implementation handoff at:
G:\micro-host\.agents\teamwork\worker_m2_surface\handoff.md

Your Identity:
- Archetype: teamwork_challenger
- Role: 3D Emissive & Texture Challenger
- Working Directory: G:\micro-host
- State Folder: G:\micro-host\.agents\teamwork\challenger_m2_emissive\

Your Mission:
Adversarially stress-test the 3D surface integration in `workspace-prototype/src/main.ts`:
1. Verify 3D selection emissive under all themes:
   - Test `selectCard` and carousel rotation across all canonical themes, Android presets, and dynamic seed colors (`seed:#4285F4`, `seed:#00C853`, `seed:#D81B60`).
   - Confirm that the selected card edge mesh receives `activeTheme.material.edgeEmissive || activeTheme.swatchPrimary` and inactive cards receive `activeTheme.material.edgeColor || "#152631"`.
   - Confirm that selecting a card or rotating the carousel NEVER reverts to hardcoded `#70d5cf` / `#152631`.
2. Verify texture cache invalidation and disposal:
   - Verify that switching themes changes `computeCardContentKey(card)`.
   - Verify that `refreshCardTexture(card, true)` calls `.dispose()` on stale textures and rasterizes new textures with `titleColor` and `detailColor`.
3. Check for any color bleed or memory leaks in the render loop.
4. Execute empirical verification tests and report commands and output.
5. Formulate your verdict: **APPROVE** or **REQUEST_CHANGES**.

Write your complete challenger report to:
`G:\micro-host\.agents\teamwork\challenger_m2_emissive\handoff.md`
Report when done.
