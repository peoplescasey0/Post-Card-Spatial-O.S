# Handoff Report: 3D Emissive & Texture Cache Explorer

**Task**: Investigate 3D selection emissive, turntable render loop emissive styling, and texture cache invalidation in `workspace-prototype/src/main.ts` for Milestone 2.  
**State Folder**: `G:\micro-host\.agents\teamwork\explorer_m2_emissive\`  
**Date / Timestamp**: 2026-11-11T20:32:00Z  
**Integrity Mode**: development  

---

## 1. Observation

### 1.1 Hardcoded Emissive Overwrites in `workspace-prototype/src/main.ts`

Across `workspace-prototype/src/main.ts`, exactly two code locations overwrite the 3D card edge chassis emissive material colors with hardcoded cyan (`#70d5cf`) and dark slate (`#152631`):

1. **`selectCard` (Lines 4457–4464)**:
   ```typescript
   for (const item of cards) {
     const edge = item.group.children[0];
     const material = edge instanceof THREE.Mesh ? edge.material : undefined;
     if (material instanceof THREE.MeshStandardMaterial) {
       material.emissive.set(item === card ? "#70d5cf" : "#152631");
       material.emissiveIntensity = item === card ? 0.62 : 0.22;
     }
   }
   ```
   - Invocation contexts:
     - Direct user clicks on cards via `handleCardClick` (lines 6005, 6088).
     - Keyboard navigation via `onCanvasKeyDown` (arrow keys / Home / End, lines 7445–7455).
     - Navigation drawer clicks via `roomCardNavElement` (line 7538).
     - External view switching via `showStudio(cardId)` (line 4478).
   - Defect: When invoked under any non-classic theme (e.g. `cyberpunk`, `pixel-blue`, `forest-emerald`, or dynamic seeds), the card rim is forced to hardcoded cyan (`#70d5cf`), destroying theme coherence.

2. **Turntable Animation Loop (Lines 8089–8096)**:
   ```typescript
   // Update front-center selection when the carousel rotates to a new front card
   if (closestCard !== selectedCard && minAbsAngle < 0.28) {
     const previousCard = selectedCard;
     selectedCard = closestCard;
     selectedIndex = cards.indexOf(closestCard);
     refreshPrivateGuestPreview(previousCard, closestCard);
     updateGuestActionButton();
     updateFacetBarUI();
     updateRoomCardNav();
     updateRoomSelection();
     selectedNameElement.textContent = `${closestCard.name} · ${FACET_META[closestCard.facet].badge}`;
     sceneCardIndexElement.textContent = String(selectedIndex + 1).padStart(2, "0");
     for (const item of cards) {
       const edge = item.group.children[0];
       const material = edge instanceof THREE.Mesh ? edge.material : undefined;
       if (material instanceof THREE.MeshStandardMaterial) {
         material.emissive.set(item === closestCard ? "#70d5cf" : "#152631");
         material.emissiveIntensity = item === closestCard ? 0.62 : 0.22;
       }
     }
   }
   ```
   - Execution frequency: This block is guarded by `if (closestCard !== selectedCard && minAbsAngle < 0.28)`. It only executes when the carousel rotates past an angular threshold and selects a new front card (~5 times per full 360° carousel revolution), NOT on every frame.
   - Defect: As soon as a user rotates the turntable, the front card and background cards immediately revert to hardcoded `#70d5cf` and `#152631`.

3. **Per-Frame Lighting Loop (Lines 8138–8152)**:
   ```typescript
   // Pillar 1: Dynamic Halo & Specular Floor Lighting tracking the active card
   if (selectedCard) {
     const activeTheme = getCardTheme(selectedCard.theme ?? activeCardThemeId);
     const haloTarget = new THREE.Color(activeTheme.lighting.haloColor);
     const floorTarget = new THREE.Color(activeTheme.lighting.floorGlowColor);
     cardHaloLight.color.lerp(haloTarget, Math.min(1, dt * 5.2));
     cardFloorGlow.color.lerp(floorTarget, Math.min(1, dt * 5.2));
     if (glowDisc.material instanceof THREE.MeshBasicMaterial) {
       glowDisc.material.color.lerp(floorTarget, Math.min(1, dt * 5.2));
       glowDisc.material.opacity = 0.08 + 0.025 * Math.sin(now * 0.0024);
     }
     cardHaloLight.position.x = THREE.MathUtils.damp(cardHaloLight.position.x, selectedCard.group.position.x, 7.5, dt);
     cardFloorGlow.position.x = THREE.MathUtils.damp(cardFloorGlow.position.x, selectedCard.group.position.x, 7.5, dt);
     cardFloorGlow.position.z = THREE.MathUtils.damp(cardFloorGlow.position.z, selectedCard.group.position.z + 0.15, 7.5, dt);
   }
   ```
   - Execution frequency: This block executes on **every single frame** of `requestAnimationFrame` (60 FPS / 120 FPS).
   - Performance observation: In `src/card-themes.ts` lines 1015–1031, `getCardTheme` does not cache generated seed themes (`seed:#HEX`). When a dynamic seed theme is active, calling `getCardTheme` every frame triggers `generateThemeFromSeed`, executing 65 chroma bisections across 5 palettes and allocating multiple objects every frame. Additionally, lines 8141–8142 instantiate two `new THREE.Color(...)` objects per frame.

---

### 1.2 Texture Cache Invalidation & Disposal Pipeline

1. **Content Key Computation (`computeCardContentKey`, Lines 4976–5013)**:
   ```typescript
   function computeCardContentKey(card: SystemCard): string {
     ...
     return [
       card.theme ?? activeCardThemeId,
       card.status,
       card.facet,
       card.backFaceVisible ? "B" : "F",
       card.twisted ? "T1" : "T0",
       ...
     ].join("|");
   }
   ```
   - The returned key begins with `card.theme ?? activeCardThemeId`.
   - Any modification to `activeCardThemeId` instantly changes the computed hash.

2. **Texture Refresh & Disposal (`refreshCardTexture`, Lines 5019–5069)**:
   ```typescript
   function refreshCardTexture(card: SystemCard, force = false): void {
     const contentKey = computeCardContentKey(card);
     const nextKey = `${contentKey}|b${card.blurStep ?? 1}`;
     if (!card.liveCanvas && card.lastTextureKey === nextKey && !force) {
       return;
     }
     card.lastTextureKey = nextKey;

     if (card.cachedContentKey !== contentKey || card.liveCanvas || force) {
       card.cachedSharpTexture?.dispose();
       card.cachedBlurredTexture?.dispose();
       card.cachedSharpTexture = undefined;
       card.cachedBlurredTexture = undefined;
       card.cachedContentKey = contentKey;
     }

     const visibleFaceName = card.backFaceVisible ? "back" : "front";
     const isBlurred = (card.blurStep ?? 1) > 0;
     let visibleTexture = isBlurred ? card.cachedBlurredTexture : card.cachedSharpTexture;
     if (!visibleTexture) {
       visibleTexture = makeCardTexture(card, card.facet);
       if (!card.liveCanvas) {
         if (isBlurred) {
           card.cachedBlurredTexture = visibleTexture;
         } else {
           card.cachedSharpTexture = visibleTexture;
         }
       }
     }
     ...
   ```
3. **Trigger in `applyCardTheme` (Lines 4577–4655)**:
   ```typescript
   export function applyCardTheme(themeId: CardThemeId): void {
     ...
     activeCardThemeId = themeId;
     persistTheme(themeId);
     ...
     // 4. Update Three.js materials & textures for all cards
     for (const card of cards) {
       // Updates edgeMesh, frontMesh, backMesh materials...
       refreshCardTexture(card, true);
     }
   }
   ```
   - When `applyCardTheme(themeId)` runs, `force === true` and `card.cachedContentKey !== contentKey`.
   - `card.cachedSharpTexture?.dispose()` and `card.cachedBlurredTexture?.dispose()` are called, destroying existing WebGL textures in GPU VRAM.
   - `makeCardTexture` is called with the new theme colors, rasterizing a fresh 1280x1920 `<canvas>` and uploading a new `THREE.CanvasTexture`.
   - Stale textures are never leaked.

---

### 1.3 Test Suite Verification & Existing Contracts

1. **`tests/android-theming-integration.test.mjs`**:
   - Lines 1016–1026 (**Tier 1.19: Feature 4.4 — Selection Emissive Synchronization**):
     ```typescript
     test("Tier 1.19: Feature 4.4 — Selection Emissive Synchronization (Bug Fix Verification: No Hardcoded Cyan)", () => {
       const theme = resolveTheme("cyberpunk");
       const material = new THREE.MeshStandardMaterial({
         color: 0x000000,
         emissive: new THREE.Color(theme.material.edgeEmissive || theme.swatchPrimary),
       });
       const emissiveHex = "#" + material.emissive.getHexString();
       assert.notEqual(emissiveHex.toLowerCase(), "#70d5cf", "Must NOT use hardcoded cyan #70d5cf");
       assert.equal(emissiveHex.toLowerCase(), theme.material.edgeEmissive.toLowerCase());
     });
     ```
   - Lines 980–996 (**Tier 1.16 & 1.17**): Validates texture content key invalidation and GPU texture `.dispose()`.
   - Lines 1450–1466 (**Tier 3.1**): Validates sync between 2D CSS and 3D Three.js lighting & `edgeMat.emissive`.
   - Lines 1521–1535 (**Tier 3.5**): Validates seed change while card is selected triggers texture cache disposal & emissive sync.
   - **Status**: All 30 tests in Tier 1 through Tier 4 pass without error.

2. **`tests/card-theming.test.mjs`**:
   - Line 186–189: Enforces that `main.ts` incorporates `card.theme ?? activeCardThemeId`.
   - Line 203–205: Enforces `haloTarget` variable presence in `main.ts` animate loop.
   - **Status**: Passes.

3. **`tests/compact-private-preview.test.mjs`**:
   - Line 42–47: Enforces `function selectCard(`, `const previousCard = selectedCard`, `selectedCard = card`, `refreshPrivateGuestPreview(previousCard, card)`.
   - Line 61–67: Enforces `if (closestCard !== selectedCard ... refreshPrivateGuestPreview(previousCard, closestCard)`.
   - **Status**: Passes.

4. **`tests/card-theming-collision.test.mjs`**:
   - Fails on line 546: `assert.match(projectMd, /10\.0\.0\.2/, "PROJECT.md must document Fedora IP 10.0.0.2")`.
   - Reason: `PROJECT.md` was updated at the beginning of Milestone 2 and did not retain the pre-existing Fedora IP documentation line. This is unrelated to 3D theming.

5. **Typecheck (`tsc -p tsconfig.json --noEmit`)**:
   - Exits `0` with 0 type errors.

---

## 2. Logic Chain

1. **Why Selection Emissive Overwrite Occurs**:
   - `applyCardTheme(themeId)` correctly applies theme material properties to all cards (lines 4625–4632):
     ```typescript
     if (theme.material.edgeColor) card.edgeMesh.material.color.set(theme.material.edgeColor);
     if (theme.material.edgeEmissive) card.edgeMesh.material.emissive.set(theme.material.edgeEmissive);
     if (theme.material.edgeEmissiveIntensity !== undefined) card.edgeMesh.material.emissiveIntensity = theme.material.edgeEmissiveIntensity;
     ```
   - However, when `selectCard` is subsequently invoked (line 4461) or the carousel rotates past angular threshold (line 8093), `material.emissive.set(item === card ? "#70d5cf" : "#152631")` immediately overwrites `edgeEmissive` with cyan `#70d5cf` (for the active card) and dark slate `#152631` (for inactive cards).
   - This undoes the theme application for the edge mesh on any card interaction or rotation.

2. **The Correct Theming Formulation**:
   - For the selected card:
     The highlight emissive color is defined by `activeTheme.material.edgeEmissive || activeTheme.swatchPrimary`.
     In `classic`: `edgeEmissive` is `#152631` (or `#70d5cf` if accented); `swatchPrimary` is `#70d5cf`.
     In `cyberpunk`: `edgeEmissive` is `#ff007f`.
     In `glass`: `edgeEmissive` is `#38bdf8`.
     In `material-vibrant`: `edgeEmissive` is `#8b5cf6`.
     In Android presets / dynamic seeds: `edgeEmissive` is `activeRoles.secondary` (or primary).
   - For inactive/idle cards:
     The idle emissive color is `activeTheme.material.edgeColor || "#152631"`.
   - For emissive intensity:
     For selected card: `0.62` (bright highlight).
     For inactive cards: `activeTheme.material.edgeEmissiveIntensity ?? 0.22`.
   - Applying this formula in both `selectCard` and turntable carousel rotation maintains full visual consistency and aligns with the contract in `tests/android-theming-integration.test.mjs` line 1020.

3. **Render Loop Performance & Caching Strategy**:
   - In turntable carousel rotation (line 8078): `if (closestCard !== selectedCard && minAbsAngle < 0.28)` only runs when crossing card boundaries during rotation.
   - However, in line 8140:
     `const activeTheme = getCardTheme(selectedCard.theme ?? activeCardThemeId);` runs **every frame** (60/120 FPS).
   - If `activeCardThemeId` is a dynamic seed (`seed:#...`), `getCardTheme` will re-parse the seed, run CIELAB conversion, run 65 bisections, and allocate palettes on every frame unless cached.
   - Solution:
     1. In `src/main.ts`: maintain a module-level variable:
        ```typescript
        let currentCardTheme: CardThemeDefinition = getCardTheme(activeCardThemeId);
        ```
        Update `currentCardTheme = getCardTheme(activeCardThemeId);` inside `applyCardTheme(themeId)`.
     2. In `selectCard` and line 8093: consume `currentCardTheme` (or `getCardTheme(activeCardThemeId)`).
     3. In line 8140: consume `selectedCard.theme ? getCardTheme(selectedCard.theme) : currentCardTheme`, avoiding per-frame bisection and allocations.
     4. Optionally in `src/card-themes.ts`: add a memoization `Map<string, CardThemeDefinition>` inside `getCardTheme` for dynamic seeds.

4. **Texture Cache Invalidation Soundness**:
   - `computeCardContentKey(card)` prefixes the string key with `card.theme ?? activeCardThemeId`.
   - `refreshCardTexture(card, true)` checks `card.cachedContentKey !== contentKey || card.liveCanvas || force`.
   - When `force === true` is passed by `applyCardTheme`, it always executes lines 5028–5033:
     - Disposes `cachedSharpTexture` and `cachedBlurredTexture`.
     - Sets cached properties to `undefined`.
     - Updates `cachedContentKey = contentKey`.
     - Triggers `makeCardTexture(card, card.facet)` to generate and upload fresh textures.
   - Stale textures are properly freed and cannot linger.

---

## 3. Caveats

1. **Pre-existing Failure in `tests/card-theming-collision.test.mjs`**:
   Line 546 fails because `PROJECT.md` does not contain the string `10.0.0.2`. This was caused by `PROJECT.md` being replaced during Milestone 1/2 initialization and is completely unrelated to 3D surface integration.
2. **`classic` Preset Theme `edgeEmissive` vs `swatchPrimary`**:
   In `src/card-themes.ts` lines 713–714, the canonical `classic` theme defines `edgeColor: "#19212d"` and `edgeEmissive: "#152631"`.
   Because `"#152631"` is a non-empty string, `(activeTheme.material.edgeEmissive || activeTheme.swatchPrimary)` evaluates to `"#152631"` for `classic`.
   However, `classic.swatchPrimary` is `#70d5cf`. If `classic` is intended to illuminate cyan when selected, either:
   - For `classic`, `activeTheme.id === "classic" ? activeTheme.swatchPrimary : (activeTheme.material.edgeEmissive || activeTheme.swatchPrimary)` can be used, OR
   - `activeTheme.material.edgeEmissive || activeTheme.swatchPrimary` can be used as specified in SCOPE.md and PROJECT.md.
3. **Card-Specific Theme Overrides (`card.theme`)**:
   Currently, all system cards inherit `activeCardThemeId`, but `SystemCard` permits an optional `card.theme` property. The replacement code should use `card.theme ?? activeCardThemeId` or pass the card's effective theme.

---

## 4. Conclusion

### 4.1 Recommended Code Changes for Implementer

#### Change 1: `selectCard` in `workspace-prototype/src/main.ts` (around line 4457)

**Before**:
```typescript
  for (const item of cards) {
    const edge = item.group.children[0];
    const material = edge instanceof THREE.Mesh ? edge.material : undefined;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.emissive.set(item === card ? "#70d5cf" : "#152631");
      material.emissiveIntensity = item === card ? 0.62 : 0.22;
    }
  }
```

**After**:
```typescript
  const activeTheme = getCardTheme(activeCardThemeId);
  const selectedEmissive = activeTheme.material.edgeEmissive || activeTheme.swatchPrimary;
  const idleEmissive = activeTheme.material.edgeColor || "#152631";
  const idleIntensity = activeTheme.material.edgeEmissiveIntensity ?? 0.22;
  for (const item of cards) {
    const edge = item.edgeMesh ?? item.group.children[0];
    const material = edge instanceof THREE.Mesh ? edge.material : undefined;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.emissive.set(item === card ? selectedEmissive : idleEmissive);
      material.emissiveIntensity = item === card ? 0.62 : idleIntensity;
    }
  }
```

---

#### Change 2: Turntable Carousel Loop in `workspace-prototype/src/main.ts` (around line 8089)

**Before**:
```typescript
    for (const item of cards) {
      const edge = item.group.children[0];
      const material = edge instanceof THREE.Mesh ? edge.material : undefined;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.set(item === closestCard ? "#70d5cf" : "#152631");
        material.emissiveIntensity = item === closestCard ? 0.62 : 0.22;
      }
    }
```

**After**:
```typescript
    const activeTheme = getCardTheme(activeCardThemeId);
    const selectedEmissive = activeTheme.material.edgeEmissive || activeTheme.swatchPrimary;
    const idleEmissive = activeTheme.material.edgeColor || "#152631";
    const idleIntensity = activeTheme.material.edgeEmissiveIntensity ?? 0.22;
    for (const item of cards) {
      const edge = item.edgeMesh ?? item.group.children[0];
      const material = edge instanceof THREE.Mesh ? edge.material : undefined;
      if (material instanceof THREE.MeshStandardMaterial) {
        material.emissive.set(item === closestCard ? selectedEmissive : idleEmissive);
        material.emissiveIntensity = item === closestCard ? 0.62 : idleIntensity;
      }
    }
```

---

#### Change 3: Render Loop Lighting Caching in `workspace-prototype/src/main.ts` (Lines 1141 & 8140)

**At line 1141**:
```typescript
let activeCardThemeId: CardThemeId = loadPersistedTheme();
let currentCardTheme: CardThemeDefinition = getCardTheme(activeCardThemeId);
```

**In `applyCardTheme(themeId)` at line 4581**:
```typescript
  activeCardThemeId = themeId;
  currentCardTheme = getCardTheme(themeId);
```

**In `animate` loop at line 8140**:
```typescript
  // Pillar 1: Dynamic Halo & Specular Floor Lighting tracking the active card
  if (selectedCard) {
    const activeTheme = selectedCard.theme ? getCardTheme(selectedCard.theme) : currentCardTheme;
    const haloTarget = new THREE.Color(activeTheme.lighting.haloColor);
    const floorTarget = new THREE.Color(activeTheme.lighting.floorGlowColor);
```
*(Preserving `haloTarget` ensures `tests/card-theming.test.mjs:203` passes without regression).*

---

## 5. Verification Method

1. **Verify Typecheck**:
   ```powershell
   npx --prefix workspace-prototype tsc -p workspace-prototype/tsconfig.json --noEmit
   ```
   *Expected Result*: Exits `0` with zero type errors.

2. **Verify Theme Integration Test Suite**:
   ```powershell
   node --test workspace-prototype/tests/android-theming-integration.test.mjs
   ```
   *Expected Result*: All 30 tests in Tiers 1 through 4 pass (including Tier 1.16, 1.17, 1.19, 1.20, and Tier 3.5).

3. **Verify Carousel and Preview Regression Tests**:
   ```powershell
   node --test workspace-prototype/tests/compact-private-preview.test.mjs
   node --test workspace-prototype/tests/wheel-carousel.test.mjs
   node --test workspace-prototype/tests/carousel-pose.test.mjs
   ```
   *Expected Result*: All tests pass without regression.

4. **Verify No Lingering Hardcoded Emissive Overwrites**:
   ```powershell
   Select-String -Path "workspace-prototype/src/main.ts" -Pattern 'material\.emissive\.set\(item === (card|closestCard) \? "#70d5cf"'
   ```
   *Expected Result*: Zero matching lines found.

5. **Invalidation Conditions**:
   This report would be invalidated if:
   - Modifying `selectCard` breaks regex checks in `tests/compact-private-preview.test.mjs`.
   - `getCardTheme(activeCardThemeId)` is removed from the signature, breaking `card-theming.test.mjs`.
   - `computeCardContentKey` stops including `card.theme ?? activeCardThemeId`.
