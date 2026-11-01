# Card Backface Not Rendering Bugfix Design

## Overview

The Post Card Spatial OS frontend uses a 3D card interface with six facets. The back facet (labeled "CARD SETTINGS") should display card settings when the card is flipped or rotated appropriately. Currently, the back facet does not render visible content - users see blank or missing content where the back facet should be displayed. This bug affects the usability of card settings and configuration management.

The fix requires understanding the Three.js material configuration and texture assignment logic to ensure the back facet renders correctly while preserving all other facet functionality.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when the back facet ("back") is selected but doesn't render content
- **Property (P)**: The desired behavior when the back facet is selected - the card settings interface should render completely
- **Preservation**: Existing functionality for the other five facets (front, left, right, top, bottom) that must remain unchanged
- **SystemCard**: The TypeScript type representing a card in the 3D scene with properties like `backFaceVisible` and `facet`
- **makeCardTexture**: The function that creates canvas textures for each card facet
- **drawCardSettings**: The function that draws the card settings content for the back facet
- **refreshCardTexture**: The function that updates card textures when facets change
- **THREE.FrontSide / THREE.DoubleSide**: Three.js material side properties controlling which sides of a geometry are rendered

## Bug Details

### Bug Condition

The bug manifests when a user selects the back facet of a card through any interaction method (keyboard shortcut "2", facet navigation UI, or drag rotation). The `makeCardTexture` function correctly generates the back facet texture with `drawCardSettings`, but the texture is not visible on the card due to material configuration issues.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type CardInteraction
  OUTPUT: boolean
  
  RETURN input.facet = "back"
         AND NOT cardSettingsVisible(input.card)
END FUNCTION
```

**Where:**
- `CardInteraction` includes keyboard events, UI button clicks, or drag gestures
- `cardSettingsVisible` returns true when the card settings content is fully rendered

### Examples

1. **Keyboard Navigation Example**:
   - **Input**: Press "2" key when a card is selected
   - **Expected**: Card rotates to show back facet with "CARD SETTINGS" header, hardware personality details, memory profiles, etc.
   - **Actual**: Card rotates but shows blank/empty surface where settings should appear

2. **UI Navigation Example**:
   - **Input**: Click "02 SETTINGS" button in facet bar
   - **Expected**: Card flips to back facet showing complete settings interface
   - **Actual**: Card flips but back facet appears blank

3. **Drag Interaction Example**:
   - **Input**: Drag card 180 degrees around Y-axis
   - **Expected**: Back facet becomes visible with settings content
   - **Actual**: Back facet appears but content is missing

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Front facet ("front") must continue to show the POST CARD OS display with mock screen and status information
- Left facet ("left") must continue to show the SECURITY & ISOLATION interface with security controls
- Right facet ("right") must continue to show the PAPER PLANES interface with message history
- Top facet ("top") must continue to show the QUICK ACTIONS interface with action buttons
- Bottom facet ("bottom") must continue to show the TELEMETRY & PORTS interface with system metrics
- All card animations, rotations, and tilt effects must remain smooth and unchanged
- All keyboard shortcuts (1-6, WASD) must continue to work for facet navigation
- All mouse interactions (click, drag, zoom) must continue to work

**Scope:**
All inputs that do NOT involve the back facet should be completely unaffected by this fix. This includes:
- Keyboard shortcuts 1, 3, 4, 5, 6 for other facets
- Mouse clicks on other facet buttons
- Drag interactions that don't result in back facet selection
- Zoom and other card manipulation features

## Hypothesized Root Cause

Based on code analysis, the most likely issues are:

1. **Material Side Configuration (Primary Suspect)**: Both front and back meshes in `createCard` use `side: THREE.FrontSide`. When the back mesh is rotated 180 degrees (`back.rotation.y = Math.PI`), we may be viewing the "back" side of the material, which is not rendered with `THREE.FrontSide`.

2. **Texture Assignment Logic Issue**: In `refreshCardTexture`, the logic for assigning textures to meshes is complex. When `card.backFaceVisible = true`, the front mesh gets `nextCycleFacet` texture instead of `card.facet`, which might cause incorrect texture assignment.

3. **Duplicate Code Issue**: In `flipCardTo`, there appears to have been a duplicate `card.backFaceVisible = !card.backFaceVisible` line (though only one remains in current code), suggesting past debugging attempts.

4. **Canvas Texture Generation**: While `makeCardTexture` correctly calls `drawCardSettings` for the "back" facet, there might be issues with the texture application to the material.

**Most Likely Root Cause**: The `side: THREE.FrontSide` property on the back mesh material. In Three.js, `THREE.FrontSide` means only the front-facing polygons are rendered. When the mesh is rotated 180 degrees and viewed from the opposite side, those polygons become back-facing and are culled. The fix should be changing the back mesh material to `side: THREE.DoubleSide`.

## Correctness Properties

Property 1: Bug Condition - Back Facet Settings Rendering

_For any_ card interaction where the back facet is selected (isBugCondition returns true), the fixed function SHALL render the complete card settings interface with all expected visual elements including header text, hardware personality details, memory profiles, and status information.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Other Facet Behavior

_For any_ card interaction where a facet other than "back" is selected (isBugCondition returns false), the fixed function SHALL produce exactly the same behavior as the original function, preserving all existing functionality for the front, left, right, top, and bottom facets including visual rendering, animations, and interactive behaviors.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `g:\micro-host\micro-host\workspace-prototype\src\main.ts`

**Function**: `createCard` (lines ~1199-1270)

**Specific Changes**:

1. **Change Back Mesh Material Side Property**:
   - Current: `side: THREE.FrontSide` (line ~1251)
   - Fix: Change to `side: THREE.DoubleSide`
   - Reason: Allows the material to be visible from both sides, ensuring the back facet is visible when the mesh is rotated 180 degrees

2. **Optional: Change Front Mesh Material Side Property**:
   - Current: `side: THREE.FrontSide` (line ~1236)
   - Consideration: Changing to `THREE.DoubleSide` for consistency, though not strictly necessary for front facet
   - Impact: Minimal performance impact, ensures both sides of cards are visible in edge cases

3. **Verify Texture Assignment Logic**:
   - Review `refreshCardTexture` function to ensure texture assignment is correct
   - When `card.backFaceVisible = true`, ensure back mesh gets `card.facet` texture (should be "back")
   - When `card.backFaceVisible = false`, ensure front mesh gets `card.facet` texture

4. **Check for Other Material Properties**:
   - Ensure `emissiveMap` and other material properties are correctly configured
   - Verify texture coordinates are correct for both sides

**Implementation Details**:
```typescript
// In createCard function, around line 1251:
const back = new THREE.Mesh(
  cardGeometry,
  new THREE.MeshStandardMaterial({
    map: backTexture,
    roughness: 0.88,
    metalness: 0.02,
    emissive: "#ffffff",
    emissiveMap: backTexture,
    emissiveIntensity: 0.82,
    side: THREE.DoubleSide, // CHANGED FROM THREE.FrontSide
  }),
);
```

**Alternative Approach**: If `THREE.DoubleSide` causes performance issues or visual artifacts, consider:
- Using `side: THREE.BackSide` for the back mesh (renders only back-facing polygons)
- Adjusting mesh normals instead of changing material side
- Creating separate materials for front and back with appropriate side properties

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write tests that simulate back facet selection through all interaction methods and assert that the card settings content is visible. Run these tests on the UNFIXED code to observe failures and understand the root cause.

**Test Cases**:
1. **Keyboard Shortcut Test**: Simulate pressing "2" key when card is selected (will fail on unfixed code)
2. **UI Button Test**: Simulate clicking "02 SETTINGS" facet button (will fail on unfixed code)
3. **Drag Rotation Test**: Programmatically rotate card 180 degrees around Y-axis (will fail on unfixed code)
4. **Compass Navigation Test**: Use compass UI to select back facet (will fail on unfixed code)

**Expected Counterexamples**:
- Card settings content not visible when back facet is selected
- Possible visual artifacts: blank surface, missing text, incorrect colors
- Console errors related to texture loading or material rendering

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL interaction WHERE isBugCondition(interaction) DO
  result := renderCard(interaction)
  ASSERT cardSettingsVisible(result)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL interaction WHERE NOT isBugCondition(interaction) DO
  ASSERT renderCard_original(interaction) = renderCard_fixed(interaction)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for all non-back facet interactions, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Front Facet Preservation**: Verify front facet continues to show OS display correctly
2. **Left Facet Preservation**: Verify security interface remains unchanged
3. **Right Facet Preservation**: Verify paper planes interface remains unchanged
4. **Top Facet Preservation**: Verify quick actions interface remains unchanged
5. **Bottom Facet Preservation**: Verify telemetry interface remains unchanged
6. **Animation Preservation**: Verify all card animations remain smooth
7. **Interaction Preservation**: Verify all mouse/keyboard interactions continue working

### Unit Tests

- Test keyboard event handling for each facet (keys 1-6)
- Test facet button click handlers in UI
- Test drag rotation and facet switching
- Test texture generation for each facet type
- Test material properties after fix application

### Property-Based Tests

- Generate random card states and verify all facets render correctly
- Generate random interaction sequences and verify preservation of non-back facet behavior
- Test that material side property change doesn't affect rendering of other facets
- Test edge cases like rapid facet switching, concurrent interactions

### Integration Tests

- Test complete user flow: select card, navigate through all facets
- Test visual rendering of back facet settings content
- Test that fix doesn't affect performance or cause visual artifacts
- Test that all UI controls continue to work correctly