## 2026-11-11T18:06:25Z
You are the Spec Miner for Milestone M3: Card Theming Customization Implementation.

MANDATORY FIRST STEPS:
1. Read g:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. Read g:\micro-host\PROJECT.md
3. Read g:\micro-host\.agents\teamwork\sub_orch_theming\SCOPE.md
4. Read g:\micro-host\THEMING_RESEARCH.md
5. Read g:\micro-host\workspace-prototype\src\main.ts (specifically lines 2700-3450, 4630-4750, and 6300-6450)

State folder: g:\micro-host\.agents\teamwork\spec_miner_m3\
Working directory: g:\micro-host

Your Investigation Focus:
3D Three.js Engine Integration, Canvas Texture Invalidation, and State Persistence in `workspace-prototype/src/main.ts`.
1. Inspect `src/main.ts`:
   - Texture cache invalidation: `computeCardContentKey(card: SystemCard)` (around line 4634). How to incorporate the active card theme ID (`card.theme ?? activeCardThemeId`) into the key so that switching themes triggers invalidation?
   - Canvas rasterization: `makeCardTexture(card: SystemCard, facet: CardFacet)` (around line 3064). How to inject the active theme's canvas tokens (`bgTop`, `bgBottom`, `borderStroke`, `borderWidth`, `buttonFill`, `buttonStroke`, `buttonText`) instead of hardcoded `#14161B`/`#0D111A`?
   - PBR Material & Lighting properties: How to update the card's Three.js materials (`roughness`, `metalness`, `emissive`) or spatial lights when the theme changes?
   - Theme switching function: `applyCardTheme(themeId: CardThemeId)`:
     - Updating `localStorage` under `postcard_studio_card_theme`.
     - Updating DOM `#home-view` attribute `data-card-theme="<themeId>"`.
     - Calling `refreshCardTexture(card, true)` for all cards and invalidating cached sharp/blurred textures.
     - Updating active state on `#home-view` theme buttons.
   - Coordination with Milestone M2:
     - Ensure theme switching event listeners and DOM queries do not conflict with M2 button wiring or floor collision clamping.
2. Produce a precise specification and integration blueprint for the Worker. DO NOT implement changes yourself (Spec Miner is strictly read-only).

When complete:
- Write your report to g:\micro-host\.agents\teamwork\spec_miner_m3\handoff.md following standard handoff structure (Observation, Logic Chain, Caveats, Conclusion, Verification Method).
- Send a completion message back to parent.
