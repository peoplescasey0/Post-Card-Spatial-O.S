# Handoff Report: Milestone M3 — Card Theming Architecture & Schema Design

**Agent**: `explorer_m3_1`  
**Milestone**: M3 (Card Theming Customization Implementation)  
**Date**: 2026-11-11  
**State Folder**: `g:\micro-host\.agents\teamwork\explorer_m3_1\`  
**Target Proposal**: `workspace-prototype/src/card-themes.ts` (Reference: `proposed_card-themes.ts`)  
**Recipient**: `dc0ac6dc-bc41-4f9a-bdbc-652f8bf041b3` (Parent Orchestrator)

---

## 1. Observation

1. **Mandate & Scope**:
   - `ORIGINAL_REQUEST.md` (lines 11-13, 22-26):
     > "R1. Home Screen Card Theming Research and Implementation: Research common theming patterns (such as Android home screen customization options) suitable for the spatial card environment, and implement home screen card customization allowing users to change card themes."
     > "Acceptance Criteria: The home screen interface provides options to customize and change card themes. Selected card themes apply visibly to cards on the home screen."
   - `sub_orch_theming/SCOPE.md` (lines 4-19, 32-44):
     > "workspace-prototype/src/card-themes.ts defines CardThemeId, CardThemeDefinition, and 5 distinct presets: classic, cyberpunk, minimal-dark, glass, material-vibrant."
     > "Interface Contracts: CardThemeId, getCardTheme(id), CARD_THEMES, CARD_THEME_IDS, applyCardTheme(themeId, cards), computeCardContentKey incorporates card.theme ?? activeThemeId, localStorage key 'postcard_studio_card_theme'."
   - `THEMING_RESEARCH.md` (lines 201-485, 488-577):
     Specifies exact hex colors, tonal values, PBR roughness/metalness, lighting parameters, and CSS variables across all 5 canonical themes.

2. **Existing Workspace Observations**:
   - `workspace-prototype/src/main.ts:3073-3078` currently renders hardcoded linear gradients in `makeCardTexture`:
     ```typescript
     const gradient = context.createLinearGradient(0, 0, 640, 960);
     gradient.addColorStop(0, facet === "front" ? "#14161B" : "#14161B");
     gradient.addColorStop(0.58, "#0D111A");
     gradient.addColorStop(1, "#0D111A");
     context.fillStyle = gradient;
     context.fillRect(0, 0, 640, 960);
     ```
   - `workspace-prototype/src/main.ts:3088-3091` renders hardcoded border strokes:
     ```typescript
     context.strokeStyle = `${meta.accent}55`;
     context.lineWidth = 2;
     roundRect(context, 25, 24, 590, 912, 18);
     context.stroke();
     ```
   - `workspace-prototype/src/main.ts:3030-3062` renders fasteners with hardcoded colors (`#0a0e16`, `#334155`, `#64748b`).
   - `workspace-prototype/src/main.ts:3393-3401` renders tactile buttons with hardcoded fills and strokes (`#07090ee8`, `#f4f5f7`).
   - `workspace-prototype/src/main.ts:2991-3016` card front/back meshes use fixed PBR materials:
     ```typescript
     new THREE.MeshStandardMaterial({
       map: frontTexture,
       roughness: 0.88,
       metalness: 0.02,
       emissive: "#ffffff",
       emissiveMap: frontTexture,
       emissiveIntensity: 0.82,
       side: THREE.FrontSide,
     })
     ```
   - `workspace-prototype/src/main.ts:577-584` declares scene point lights:
     ```typescript
     const cardHaloLight = new THREE.PointLight("#ffb81c", 48, 16, 1.8);
     cardHaloLight.position.set(0, 3, -1.8);
     scene.add(cardHaloLight);

     const cardFloorGlow = new THREE.PointLight("#70d5cf", 32, 7.5, 2.0);
     cardFloorGlow.position.set(0, 0.2, 1.9);
     scene.add(cardFloorGlow);
     ```
   - `workspace-prototype/src/main.ts:4634-4669` (`computeCardContentKey`) tracks `card.status`, `card.facet`, etc., but does NOT currently include `card.theme ?? activeThemeId`.
   - `workspace-prototype/src/style.css:3062-3080` styles `.home-system-card` with static background and border colors:
     ```css
     .home-system-card {
       border: 1px solid rgba(138, 144, 158, 0.22);
       background:
         linear-gradient(135deg, rgba(255, 255, 255, 0.025), transparent 55%),
         rgba(13, 17, 26, 0.88);
       color: var(--studio-text-main);
     }
     ```
   - `workspace-prototype/index.html:75-150` contains `.home-systems` cards but currently has no `.home-theme-picker` controls.

3. **Executable Prototype Verified**:
   - Reference implementation written to `g:\micro-host\.agents\teamwork\explorer_m3_1\proposed_card-themes.ts` (12,463 bytes transpiled output).
   - Validated transpilation and assertion checks via Node.js:
     ```bash
     Assertions passed successfully!
     CARD_THEME_IDS.length = 5
     getCardTheme('cyberpunk').name = 'Cyberpunk Neon'
     getCardTheme('unknown').id = 'classic'
     ```

---

## 2. Logic Chain

1. **Step 1 (Interface & Type Modeling)**:
   - Grounded in `THEMING_RESEARCH.md` and the dispatch requirements, cards in Post Card Spatial OS require tokens across four visual subsystems:
     - 2D Canvas Facet Drawing (`CanvasThemeTokens`)
     - Three.js PBR Surface Shading (`MaterialThemeTokens`)
     - Dynamic 3D Scene Illumination (`LightingThemeTokens`)
     - 2D Landing Page DOM Styling (`HomeCssThemeTokens`)
   - `CardThemeId` is modeled as the strict union `"classic" | "cyberpunk" | "minimal-dark" | "glass" | "material-vibrant"`.
   - `CardThemeDefinition` packages these subsystem tokens together with human-readable metadata (`name`, `tagline`, `description`, `swatchPrimary`, `swatchSecondary`).

2. **Step 2 (The 5 Canonical Presets)**:
   - **Classic Studio (`classic`)**: Industrial laboratory instrumentation. Slate cardstock `#14161b` -> `#0d111a`, cyan precision border `rgba(112, 213, 207, 0.35)`, matte roughness `0.85`, dielectric metalness `0.05`, halo light `#70d5cf` (intensity 48), floor glow `#00e5ff` (intensity 32).
   - **Cyberpunk Neon (`cyberpunk`)**: Midnight obsidian `#0b0416` -> `#05020a`, hot magenta border `rgba(255, 0, 127, 0.75)`, electric cyan typography, glossy roughness `0.30`, emissive intensity `0.95`, halo light `#ff007f` (intensity 60), floor glow `#00f0ff` (intensity 42).
   - **Minimal Dark (`minimal-dark`)**: Architectural focus with AMOLED black `#050505` -> `#000000`, zinc border `rgba(161, 161, 170, 0.28)`, silver typography `#f4f4f5`, anti-reflective matte roughness `0.96`, metalness `0.00`, halo light `#d4d4d8` (intensity 30), floor glow `#27272a` (intensity 18).
   - **Glass / Frosted (`glass`)**: Translucent icy acrylic `rgba(26, 38, 57, 0.75)` -> `rgba(13, 20, 32, 0.85)`, crystal specular, border `rgba(186, 230, 253, 0.55)`, high-gloss roughness `0.15`, halo light `#38bdf8` (intensity 50), floor glow `#0284c7` (intensity 36).
   - **Material Vibrant (`material-vibrant`)**: Material 3 / Android Expressive indigo `#181124` -> `#0e0918`, warm amber `#f59e0b` / violet `#8b5cf6` accents, tactile satin finish roughness `0.65`, halo light `#f59e0b` (intensity 52), floor glow `#8b5cf6` (intensity 38).

3. **Step 3 (Helper Functions & Fail-Safe Fallbacks)**:
   - `CARD_THEMES: Record<CardThemeId, CardThemeDefinition>` provides fast $O(1)$ lookup.
   - `isValidCardThemeId(id: unknown): id is CardThemeId` runtime guard prevents invalid values from polluting state.
   - `getCardTheme(id: unknown): CardThemeDefinition` returns the requested theme or falls back to `CARD_THEMES[DEFAULT_CARD_THEME_ID]` (`"classic"`).
   - `loadSavedTheme(): CardThemeId` and `saveTheme(id: CardThemeId): void` interact safely with `localStorage` under key `"postcard_studio_card_theme"` wrapped in `try/catch` to survive SSR and sandboxed permissions.

4. **Step 4 (Dual-View Synchronization & Texture Invalidation)**:
   - Selecting a theme triggers `applyCardTheme(themeId)`:
     1. `#home-view` dataset attribute is updated: `homeView.dataset.cardTheme = themeId;`
     2. CSS custom properties cascade to `.home-system-card` (background, borders, glow, badges).
     3. In `main.ts`, `cardHaloLight` and `cardFloorGlow` are updated to `theme.lighting.haloColor` and `theme.lighting.floorGlowColor`.
     4. `computeCardContentKey` incorporates `card.theme ?? activeThemeId`.
     5. For each card in `cards`, `cachedSharpTexture?.dispose()` and `cachedBlurredTexture?.dispose()` release GPU VRAM, materials (`roughness`, `metalness`, `emissive`) are updated, and `refreshCardTexture(card, true)` generates the new themed canvas textures.

---

## 3. Caveats

1. **Read-Only Scope**: Explorer agents do not modify workspace source code. The complete reference file is provided in `proposed_card-themes.ts` in the state folder, ready for the worker to place into `workspace-prototype/src/card-themes.ts`.
2. **Light Intensity Scales**: In Three.js `main.ts`, `cardHaloLight` has an unattenuated direct intensity around 30–60 (with distance 16). The presets use these direct operational values (`classic`: 48, `cyberpunk`: 60, `minimal-dark`: 30, `glass`: 50, `material-vibrant`: 52) which match `main.ts` lighting calibration.
3. **Home View Toggle Co-existence**: The home screen theme picker works orthogonally to Milestone M2 view routing (`#home-view[hidden]`).

---

## 4. Conclusion

The Theme Architecture & Schema Design for Milestone M3 is complete, validated, and ready for worker implementation.

### Key Artifacts Delivered:
- **`proposed_card-themes.ts`**: Complete TypeScript source file with strict typing, all 5 presets, and helper functions.
- **Worker Execution Blueprint**:
  1. Create `workspace-prototype/src/card-themes.ts` from `proposed_card-themes.ts`.
  2. Edit `workspace-prototype/index.html` to add `.home-themes` and `.home-theme-picker` controls inside `#home-view`.
  3. Edit `workspace-prototype/src/style.css` to add `.home-theme-picker` styles and `#home-view[data-card-theme]` rules.
  4. Edit `workspace-prototype/src/main.ts` to import `card-themes.ts`, integrate `activeThemeId`, update `computeCardContentKey`, apply canvas tokens in `makeCardTexture` / `drawChassisFastener` / `drawCardButtons`, update lighting, and wire event listeners.
  5. Add test suite `workspace-prototype/tests/card-theming.test.mjs` verifying theme tokens, helper functions, and storage persistence.

---

## 5. Verification Method

### 1. Code Review of Reference Implementation
Inspect the verified TypeScript reference code:
`g:\micro-host\.agents\teamwork\explorer_m3_1\proposed_card-themes.ts`

### 2. Automated Test Suite Execution (Post-Worker Implementation)
Run the workspace test runner:
```powershell
cd g:\micro-host\workspace-prototype
npm test
```
*Expected*: All existing tests (63+) and new card theming tests pass with 0 failures.

### 3. TypeScript Typecheck & Production Build
```powershell
cd g:\micro-host\workspace-prototype
npm run build
```
*Expected*: `tsc --noEmit` and `vite build` complete with exit code 0.
