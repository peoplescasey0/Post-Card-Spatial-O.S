# Handoff Report: 3D Canvas Texture Rasterization Investigation

**Explorer**: Explorer 2 (3D Canvas Texture Explorer)  
**Milestone**: Milestone 2 — 2D & 3D Surface Integration  
**File Under Investigation**: `workspace-prototype/src/main.ts`  
**State Folder**: `G:\micro-host\.agents\teamwork\explorer_m2_3d_canvas\`  
**Target Recipient**: Milestone 2 Sub-Orchestrator (`6e5f5c8b-4dce-44f5-bb4c-54ac626657d9`) & Implementation Worker

---

## 1. Observation

### 1.1 Canvas Theme Tokens Specification (`src/card-themes.ts`)
In `workspace-prototype/src/card-themes.ts`, lines 48-63 define the 2D procedural canvas theme tokens:
```typescript
export interface CanvasThemeTokens {
  bgTop: string;
  bgBottom: string;
  bgGradientStop?: number;
  borderStroke: string;
  borderWidth: number;
  badgeColor: string;
  headerColor: string;
  titleColor: string;
  detailColor: string;
  buttonFill: string;
  buttonStroke: string;
  buttonText: string;
  fastenerRim: string;
  fastenerHead: string;
}
```
In `card-themes.ts`:
- Canonical theme `classic` (lines 700-701): `titleColor: "#f4f5f7"`, `detailColor: "#c3c8d1"`, `badgeColor: "#70d5cf"`, `headerColor: "#70d5cf"`.
- Canonical theme `cyberpunk` (lines 757-758): `titleColor: "#ffffff"`, `detailColor: "rgba(0, 240, 255, 0.85)"`, `badgeColor: "#ff007f"`, `headerColor: "#00f0ff"`.
- Canonical theme `minimal-dark` (lines 814-815): `titleColor: "#f4f4f5"`, `detailColor: "#71717a"`, `badgeColor: "#e4e4e7"`, `headerColor: "#a1a1aa"`.
- Canonical theme `glass` (lines 871-872): `titleColor: "#ffffff"`, `detailColor: "#bae6fd"`, `badgeColor: "#38bdf8"`, `headerColor: "#93c5fd"`.
- Canonical theme `material-vibrant` (lines 928-929): `titleColor: "#fdf4ff"`, `detailColor: "#d8b4fe"`, `badgeColor: "#f59e0b"`, `headerColor: "#8b5cf6"`.
- Dynamic / Android themes (lines 486-489): `badgeColor: activeRoles.primary`, `headerColor: activeRoles.secondary`, `titleColor: activeRoles.onSurface`, `detailColor: activeRoles.onSurfaceVariant`.

### 1.2 `makeCardTexture` & `drawCardFront` (`src/main.ts`)
In `workspace-prototype/src/main.ts`:
- **`makeCardTexture`** (lines 3193-3277):
  ```typescript
  function makeCardTexture(card: SystemCard, facet: CardFacet): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 1920;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to create Post Card canvas texture.");
    context.scale(2, 2);

    const theme = getCardTheme(card.theme ?? activeCardThemeId);
    const meta = FACET_META[facet];
    ...
    switch (facet) {
      case "front":
        drawCardFront(context, card);
        break;
      case "back":
        drawCardSettings(context, card);
        break;
      case "left":
        drawCardSecurity(context, card);
        break;
      case "right":
        drawCardPlanes(context, card);
        break;
      case "top":
        drawCardQuickActions(context, card);
        break;
      case "bottom":
        drawCardTelemetry(context, card);
        break;
    }
    ...
    // Line 3260: Hardcoded detail color in footer
    context.fillStyle = "#c3c8d1";
    context.font = "600 16.5px Inter, Arial, sans-serif";
    context.textAlign = "right";
    context.fillText("CLICK TO ZOOM · DRAG TO FLIP", 592, 914);
    ...
  ```
  `theme` is already resolved at line 3201 (`const theme = getCardTheme(card.theme ?? activeCardThemeId);`), but currently it is **not passed** into `drawCardFront` or the other facet drawers.

- **`drawCardFront`** (lines 3438-3482):
  ```typescript
  function drawCardFront(context: CanvasRenderingContext2D, card: SystemCard): void {
    if (card.twisted) {
      context.fillStyle = card.color;
      context.font = "700 20px Inter, Arial, sans-serif";
      context.fillText(`${card.os} · ${card.name.split(" · ")[1] ?? card.name}`, 42, 116);
    } else {
      drawCompanyLogo(context, 534, 112, 54, true);
      context.fillStyle = card.color;
      context.font = "700 21px Inter, Arial, sans-serif";
      context.fillText(card.os, 48, 133);

      context.fillStyle = "#f4f5f7"; // Line 3450: Hardcoded card title color
      context.font = "700 52px Inter, Arial, sans-serif";
      drawWrappedText(context, card.name.split(" · ")[1] ?? card.name, 48, 192, 530, 58, 2);

      context.fillStyle = "#c3c8d1"; // Line 3454: Hardcoded card detail color
      context.font = "500 25px Inter, Arial, sans-serif";
      drawWrappedText(context, card.detail, 48, 280, 530, 34, 2);
    }

    drawMockDisplay(context, card);
    drawCardButtons(context, card);

    context.fillStyle = card.color;
    context.beginPath();
    context.arc(58, 818, 6, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#f4f5f7"; // Line 3466: Hardcoded status text color
    context.font = "700 20px Inter, Arial, sans-serif";
    context.fillText(card.status, 76, 825);
    context.fillStyle = "#c3c8d1"; // Line 3469: Hardcoded preview note color
    context.font = "500 19px Inter, Arial, sans-serif";
    const previewNote = ...
    context.fillText(previewNote, 48, 864);
  }
  ```

### 1.3 Facet Drawers Analysis
Direct inspection reveals that `#f4f5f7` and `#c3c8d1` are hardcoded in all facet drawers:

1. **`drawCardSettings` (lines 3772-3850)**:
   - Line 3774: `context.fillStyle = "#FFB81C";` (eyebrow header)
   - Line 3777: `context.fillStyle = "#f4f5f7";` -> Section title (`"Behind the card."`)
   - Line 3780: `context.fillStyle = "#c3c8d1";` -> Section detail (`"vCPU allocation, RAM profile & storage mount."`)
   - Line 3848: calls `drawKeyValueRows(context, rows, 298, 102);`
   - Line 3849: calls `drawStatusFooter(context, card);`

2. **`drawCardSecurity` (lines 3852-3918)**:
   - Line 3854: `context.fillStyle = "#FFB81C";` (eyebrow header)
   - Line 3857: `context.fillStyle = "#f4f5f7";` -> Section title (`"Zero-trust boundary."`)
   - Line 3860: `context.fillStyle = "#c3c8d1";` -> Section detail (`"Per-card disk isolation & loopback guardrails."`)
   - Line 3916: calls `drawKeyValueRows(context, rows, 298, 102);`
   - Line 3917: calls `drawStatusFooter(context, card);`

3. **`drawCardPlanes` (lines 3920-3980)**:
   - Line 3922: `context.fillStyle = "#FFB81C";` (eyebrow header)
   - Line 3925: `context.fillStyle = "#f4f5f7";` -> Section title (`"Cross-card notes."`)
   - Line 3928: `context.fillStyle = "#c3c8d1";` -> Section detail (`${card.receivedNotes.length} received · ...`)
   - Line 3936: `context.fillStyle = "#8a909e";` (inbox section label)
   - Line 3942, 3953, 3964, 3975: calls `drawMessageBox`
   - Line 3958: `context.fillStyle = "#FFB81C";` (outbox section label)
   - Line 3979: calls `drawStatusFooter(context, card);`

4. **`drawCardQuickActions` (lines 4003-4060)**:
   - Line 4005: `context.fillStyle = "#8a909e";` (eyebrow header)
   - Line 4008: `context.fillStyle = "#f4f5f7";` -> Section title (`"Quick actions."`)
   - Line 4011: `context.fillStyle = "#c3c8d1";` -> Section detail (`"Click a tile on this card or use the dock below."`)
   - Line 4054: `context.fillStyle = "#f4f5f7";` -> Action tile subtitle (`act.subtitle`)
   - Line 4059: calls `drawStatusFooter(context, card);`

5. **`drawCardTelemetry` (lines 4062-4160)**:
   - Line 4064: `context.fillStyle = "#FFB81C";` (eyebrow header)
   - Line 4067: `context.fillStyle = "#f4f5f7";` -> Section title (`"Runtime & ports."`)
   - Line 4070: `context.fillStyle = "#c3c8d1";` -> Section detail (`"Loopback endpoints, vCPU profile & pool utilization."`)
   - Line 4110: calls `drawKeyValueRows(context, rows, 286, 88);`
   - Line 4159: calls `drawStatusFooter(context, card);`

### 1.4 Shared Helper Drawers
1. **`drawStatusFooter` (lines 4191-4199)**:
   ```typescript
   function drawStatusFooter(context: CanvasRenderingContext2D, card: SystemCard): void {
     context.fillStyle = card.color;
     context.beginPath();
     context.arc(58, 852, 6, 0, Math.PI * 2);
     context.fill();
     context.fillStyle = "#f4f5f7"; // Line 4196: Hardcoded status color across all 5 back/side facets
     context.font = "700 19.5px Inter, Arial, sans-serif";
     context.fillText(card.status, 76, 859);
   }
   ```
2. **`drawKeyValueRows` (lines 4162-4189)**:
   ```typescript
   function drawKeyValueRows(context: CanvasRenderingContext2D, rows: [string, string][], startY: number, stepY: number, textScale = 1): void {
     ...
     context.fillStyle = "#FFB81C"; // Line 4182: Hardcoded row label color
     context.font = `700 ${18.5 * textScale}px Inter, Arial, sans-serif`;
     context.fillText(label, 60, y + 2);
     context.fillStyle = "#ffffff"; // Line 4185: Hardcoded row value color
     context.font = `600 ${23 * textScale}px Inter, Arial, sans-serif`;
     drawWrappedText(context, value, 60, y + 34, 520, 26 * textScale, 2);
   }
   ```
3. **`drawMessageBox` (lines 3982-4001)**:
   ```typescript
   function drawMessageBox(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, borderColor: string, text: string): void {
     ...
     context.fillStyle = "#f4f5f7"; // Line 3998: Hardcoded message body text
     context.font = "500 21px Inter, Arial, sans-serif";
     drawWrappedText(context, text, x + 18, y + 34, w - 36, 26, 2);
   }
   ```
4. **`blurCardCanvas` (lines 3279-3314)**:
   - Line 3304: `context.fillStyle = "#f4f5f7";` (unselected blurred card title badge)

### 1.5 Existing Signature Pattern in `main.ts`
At line 3158, `drawChassisFastener` uses this exact signature pattern:
```typescript
function drawChassisFastener(context: CanvasRenderingContext2D, cx: number, cy: number, theme?: CardThemeDefinition): void {
  const t = theme ?? getCardTheme(activeCardThemeId);
  ...
}
```
And in `drawCardButtons` (line 3515):
```typescript
function drawCardButtons(context: CanvasRenderingContext2D, card: SystemCard): void {
  const states = cardButtonStates(card);
  const theme = getCardTheme(card.theme ?? activeCardThemeId);
  ...
}
```

### 1.6 External Callers & Test Slicing Constraints
- `workspace-prototype/tests/compact-private-preview.test.mjs` line 20:
  `const end = mainTs.indexOf("function drawCardSettings(", start);`
  The function name `drawCardSettings(` must remain exactly as `function drawCardSettings(`.
- No tests call or import `drawCardFront`, `drawCardSettings`, `drawCardSecurity`, `drawCardPlanes`, `drawCardQuickActions`, or `drawCardTelemetry` directly.

---

## 2. Logic Chain

1. **Step 1: Token Mapping**
   - In MD3 / Android theming, primary content/titles map to `theme.canvas.titleColor` (which resolves to `onSurface` in dynamic/Android themes and `#f4f5f7` in classic).
   - Secondary content/subtitles/notes map to `theme.canvas.detailColor` (which resolves to `onSurfaceVariant` in dynamic/Android themes and `#c3c8d1` in classic).
   - Accents and badge borders map to `theme.canvas.badgeColor` / `theme.canvas.borderStroke`.

2. **Step 2: Identifying Hardcoded Locations in `drawCardFront`**
   - Line 3450 is the main card name title: `drawWrappedText(context, card.name..., 48, 192)`. Hardcoded to `#f4f5f7`. Replacing with `t.canvas.titleColor || "#f4f5f7"` makes card front titles dynamic.
   - Line 3454 is the card detail text: `drawWrappedText(context, card.detail..., 48, 280)`. Hardcoded to `#c3c8d1`. Replacing with `t.canvas.detailColor || "#c3c8d1"` makes card front subtitles dynamic.
   - Line 3466 is the card status string (`card.status`). Hardcoded to `#f4f5f7`. Replacing with `t.canvas.titleColor || "#f4f5f7"` makes the status header text dynamic.
   - Line 3469 is the card preview note (`previewNote`). Hardcoded to `#c3c8d1`. Replacing with `t.canvas.detailColor || "#c3c8d1"` makes the explanatory note dynamic.

3. **Step 3: Identifying Hardcoded Locations Across All Facet Drawers**
   - On every facet, the title at Y=194 is hardcoded to `#f4f5f7` (lines 3777, 3857, 3925, 4008, 4067). Replacing each with `t.canvas.titleColor || "#f4f5f7"` ensures 100% consistent typography.
   - On every facet, the subtitle/detail at Y=234 is hardcoded to `#c3c8d1` (lines 3780, 3860, 3928, 4011, 4070). Replacing each with `t.canvas.detailColor || "#c3c8d1"` ensures coordinated secondary text.
   - On all 5 back/side facets, the status footer is rendered via `drawStatusFooter` (line 4196) with hardcoded `#f4f5f7`. Updating `drawStatusFooter` with `t.canvas.titleColor || "#f4f5f7"` updates all 5 facets simultaneously.
   - In `makeCardTexture` line 3260, the navigation footer hint (`"CLICK TO ZOOM · DRAG TO FLIP"`) is hardcoded to `#c3c8d1`. Replacing with `theme.canvas.detailColor || "#c3c8d1"` completes the facet frame styling.

4. **Step 4: Clean Parameter Passing Strategy**
   - `makeCardTexture` already calls `const theme = getCardTheme(card.theme ?? activeCardThemeId);` at line 3201.
   - Passing `theme` directly into `drawCardFront(context, card, theme)`, `drawCardSettings(context, card, theme)`, `drawCardSecurity(context, card, theme)`, `drawCardPlanes(context, card, theme)`, `drawCardQuickActions(context, card, theme)`, and `drawCardTelemetry(context, card, theme)` avoids redundant theme lookups.
   - Providing `theme?: CardThemeDefinition` as an optional parameter with `const t = theme ?? getCardTheme(card.theme ?? activeCardThemeId);` ensures:
     a) 100% backwards compatibility with any existing or internal caller.
     b) Preservation of the exact function header prefix `function drawCardSettings(` expected by `tests/compact-private-preview.test.mjs`.
     c) Correct handling of card-specific theme overrides if `card.theme` is present.

---

## 3. Caveats

1. **Facets 01-06 Accent Colors**:
   - `FACET_META[facet].accent` (`#62d8d0`, `#c5a9ff`, `#8caef4`, `#f0a7a3`, `#9b9eff`, `#77d2e8`) intentionally identifies the 6 faces in 3D spatial rotation. The facet compass dots and corner tabs (`drawEdgeFlipGuides`, `drawFacetCompassDots`) use these facet-specific colors so the user can orient themselves in 3D. We recommend preserving facet accents on navigation compass guides, while applying theme tokens to all typographic content.
2. **`drawMockDisplay` Framebuffer Simulator**:
   - `drawMockDisplay` (lines 3571-3770) simulates the simulated guest operating system's desktop display (macOS menu bar, terminal output, CRT curvature). Colors like terminal green or macOS title text in `drawMockDisplay` are OS display simulations, not Post Card OS card surface elements, and should remain unchanged.
3. **PBR Selection Emissive in `main.ts`**:
   - While `makeCardTexture` handles 2D canvas texture rasterization, note that `selectCard` (line 4461) and the turntable render loop (line 8093) overwrite mesh edge emissive with hardcoded `#70d5cf`. Explorer 3 investigates this, but the two integrations work together to produce complete 3D theme synchronization.

---

## 4. Conclusion & Proposed Code Replacements

### 4.1 Changes in `makeCardTexture` (`src/main.ts`)

#### A. Pass `theme` to Facet Drawers (lines 3232-3251)
```typescript
// BEFORE:
  switch (facet) {
    case "front":
      drawCardFront(context, card);
      break;
    case "back":
      drawCardSettings(context, card);
      break;
    case "left":
      drawCardSecurity(context, card);
      break;
    case "right":
      drawCardPlanes(context, card);
      break;
    case "top":
      drawCardQuickActions(context, card);
      break;
    case "bottom":
      drawCardTelemetry(context, card);
      break;
  }

// AFTER:
  switch (facet) {
    case "front":
      drawCardFront(context, card, theme);
      break;
    case "back":
      drawCardSettings(context, card, theme);
      break;
    case "left":
      drawCardSecurity(context, card, theme);
      break;
    case "right":
      drawCardPlanes(context, card, theme);
      break;
    case "top":
      drawCardQuickActions(context, card, theme);
      break;
    case "bottom":
      drawCardTelemetry(context, card, theme);
      break;
  }
```

#### B. Footer Instruction Detail Color (line 3260)
```typescript
// BEFORE:
  context.fillStyle = "#c3c8d1";
  context.font = "600 16.5px Inter, Arial, sans-serif";
  context.textAlign = "right";
  context.fillText("CLICK TO ZOOM · DRAG TO FLIP", 592, 914);

// AFTER:
  context.fillStyle = theme.canvas.detailColor || "#c3c8d1";
  context.font = "600 16.5px Inter, Arial, sans-serif";
  context.textAlign = "right";
  context.fillText("CLICK TO ZOOM · DRAG TO FLIP", 592, 914);
```

---

### 4.2 Changes in `drawCardFront` (`src/main.ts`, lines 3438-3482)
```typescript
// BEFORE:
function drawCardFront(context: CanvasRenderingContext2D, card: SystemCard): void {
  if (card.twisted) {
    // Compact single-line header when twisted so the display port gets maximum room on the card.
    context.fillStyle = card.color;
    context.font = "700 20px Inter, Arial, sans-serif";
    context.fillText(`${card.os} · ${card.name.split(" · ")[1] ?? card.name}`, 42, 116);
  } else {
    drawCompanyLogo(context, 534, 112, 54, true);
    context.fillStyle = card.color;
    context.font = "700 21px Inter, Arial, sans-serif";
    context.fillText(card.os, 48, 133);

    context.fillStyle = "#f4f5f7";
    context.font = "700 52px Inter, Arial, sans-serif";
    drawWrappedText(context, card.name.split(" · ")[1] ?? card.name, 48, 192, 530, 58, 2);

    context.fillStyle = "#c3c8d1";
    context.font = "500 25px Inter, Arial, sans-serif";
    drawWrappedText(context, card.detail, 48, 280, 530, 34, 2);
  }

  drawMockDisplay(context, card);
  drawCardButtons(context, card);

  context.fillStyle = card.color;
  context.beginPath();
  context.arc(58, 818, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f4f5f7";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(card.status, 76, 825);
  context.fillStyle = "#c3c8d1";
  context.font = "500 19px Inter, Arial, sans-serif";
  const previewNote = ...
  context.fillText(previewNote, 48, 864);
}

// AFTER:
function drawCardFront(
  context: CanvasRenderingContext2D,
  card: SystemCard,
  theme?: CardThemeDefinition,
): void {
  const t = theme ?? getCardTheme(card.theme ?? activeCardThemeId);
  if (card.twisted) {
    // Compact single-line header when twisted so the display port gets maximum room on the card.
    context.fillStyle = card.color;
    context.font = "700 20px Inter, Arial, sans-serif";
    context.fillText(`${card.os} · ${card.name.split(" · ")[1] ?? card.name}`, 42, 116);
  } else {
    drawCompanyLogo(context, 534, 112, 54, true);
    context.fillStyle = card.color;
    context.font = "700 21px Inter, Arial, sans-serif";
    context.fillText(card.os, 48, 133);

    context.fillStyle = t.canvas.titleColor || "#f4f5f7";
    context.font = "700 52px Inter, Arial, sans-serif";
    drawWrappedText(context, card.name.split(" · ")[1] ?? card.name, 48, 192, 530, 58, 2);

    context.fillStyle = t.canvas.detailColor || "#c3c8d1";
    context.font = "500 25px Inter, Arial, sans-serif";
    drawWrappedText(context, card.detail, 48, 280, 530, 34, 2);
  }

  drawMockDisplay(context, card);
  drawCardButtons(context, card);

  context.fillStyle = card.color;
  context.beginPath();
  context.arc(58, 818, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = t.canvas.titleColor || "#f4f5f7";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(card.status, 76, 825);
  context.fillStyle = t.canvas.detailColor || "#c3c8d1";
  context.font = "500 19px Inter, Arial, sans-serif";
  const previewNote = ...
  context.fillText(previewNote, 48, 864);
}
```

---

### 4.3 Changes in All 5 Facet Drawers (`src/main.ts`)

#### 1. `drawCardSettings` (lines 3772-3850)
```typescript
// BEFORE:
function drawCardSettings(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · HARDWARE PERSONALITY`, 48, 137);
  context.fillStyle = "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Behind the card.", 48, 194);
  context.fillStyle = "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("vCPU allocation, RAM profile & storage mount.", 48, 234);
  ...
  drawKeyValueRows(context, rows, 298, 102);
  drawStatusFooter(context, card);
}

// AFTER:
function drawCardSettings(
  context: CanvasRenderingContext2D,
  card: SystemCard,
  theme?: CardThemeDefinition,
): void {
  const t = theme ?? getCardTheme(card.theme ?? activeCardThemeId);
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = t.canvas.badgeColor || "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · HARDWARE PERSONALITY`, 48, 137);
  context.fillStyle = t.canvas.titleColor || "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Behind the card.", 48, 194);
  context.fillStyle = t.canvas.detailColor || "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("vCPU allocation, RAM profile & storage mount.", 48, 234);
  ...
  drawKeyValueRows(context, rows, 298, 102, 1, t);
  drawStatusFooter(context, card, t);
}
```

#### 2. `drawCardSecurity` (lines 3852-3918)
```typescript
// BEFORE:
function drawCardSecurity(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · SANDBOX & ISOLATION`, 48, 137);
  context.fillStyle = "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Zero-trust boundary.", 48, 194);
  context.fillStyle = "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("Per-card disk isolation & loopback guardrails.", 48, 234);
  ...
  drawKeyValueRows(context, rows, 298, 102);
  drawStatusFooter(context, card);
}

// AFTER:
function drawCardSecurity(
  context: CanvasRenderingContext2D,
  card: SystemCard,
  theme?: CardThemeDefinition,
): void {
  const t = theme ?? getCardTheme(card.theme ?? activeCardThemeId);
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = t.canvas.badgeColor || "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · SANDBOX & ISOLATION`, 48, 137);
  context.fillStyle = t.canvas.titleColor || "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Zero-trust boundary.", 48, 194);
  context.fillStyle = t.canvas.detailColor || "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("Per-card disk isolation & loopback guardrails.", 48, 234);
  ...
  drawKeyValueRows(context, rows, 298, 102, 1, t);
  drawStatusFooter(context, card, t);
}
```

#### 3. `drawCardPlanes` (lines 3920-3980)
```typescript
// BEFORE:
function drawCardPlanes(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · PAPER AIRPLANE RELAY`, 48, 137);
  context.fillStyle = "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Cross-card notes.", 48, 194);
  context.fillStyle = "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText(
    `${card.receivedNotes.length} received · ${card.sentNotes.length} sent from this card`,
    48,
    234,
  );
  ...
  drawStatusFooter(context, card);
}

// AFTER:
function drawCardPlanes(
  context: CanvasRenderingContext2D,
  card: SystemCard,
  theme?: CardThemeDefinition,
): void {
  const t = theme ?? getCardTheme(card.theme ?? activeCardThemeId);
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = t.canvas.badgeColor || "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · PAPER AIRPLANE RELAY`, 48, 137);
  context.fillStyle = t.canvas.titleColor || "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Cross-card notes.", 48, 194);
  context.fillStyle = t.canvas.detailColor || "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText(
    `${card.receivedNotes.length} received · ${card.sentNotes.length} sent from this card`,
    48,
    234,
  );
  ...
  drawStatusFooter(context, card, t);
}
```

#### 4. `drawCardQuickActions` (lines 4003-4060)
```typescript
// BEFORE:
function drawCardQuickActions(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = "#8a909e";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · SANDBOX DECK`, 48, 137);
  context.fillStyle = "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Quick actions.", 48, 194);
  context.fillStyle = "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("Click a tile on this card or use the dock below.", 48, 234);

  const actions = [ ... ];
  actions.forEach((act, idx) => {
    ...
    context.fillStyle = "#f4f5f7"; // Line 4054: Action tile subtitle
    context.font = "500 19.5px Inter, Arial, sans-serif";
    context.fillText(act.subtitle, 72, y + 79);
  });

  drawStatusFooter(context, card);
}

// AFTER:
function drawCardQuickActions(
  context: CanvasRenderingContext2D,
  card: SystemCard,
  theme?: CardThemeDefinition,
): void {
  const t = theme ?? getCardTheme(card.theme ?? activeCardThemeId);
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = t.canvas.badgeColor || "#8a909e";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · SANDBOX DECK`, 48, 137);
  context.fillStyle = t.canvas.titleColor || "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Quick actions.", 48, 194);
  context.fillStyle = t.canvas.detailColor || "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("Click a tile on this card or use the dock below.", 48, 234);

  const actions = [ ... ];
  actions.forEach((act, idx) => {
    ...
    context.fillStyle = t.canvas.detailColor || "#f4f5f7";
    context.font = "500 19.5px Inter, Arial, sans-serif";
    context.fillText(act.subtitle, 72, y + 79);
  });

  drawStatusFooter(context, card, t);
}
```

#### 5. `drawCardTelemetry` (lines 4062-4160)
```typescript
// BEFORE:
function drawCardTelemetry(context: CanvasRenderingContext2D, card: SystemCard): void {
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · LIVE TELEMETRY`, 48, 137);
  context.fillStyle = "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Runtime & ports.", 48, 194);
  context.fillStyle = "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("Loopback endpoints, vCPU profile & pool utilization.", 48, 234);
  ...
  drawKeyValueRows(context, rows, 286, 88);
  ...
  drawStatusFooter(context, card);
}

// AFTER:
function drawCardTelemetry(
  context: CanvasRenderingContext2D,
  card: SystemCard,
  theme?: CardThemeDefinition,
): void {
  const t = theme ?? getCardTheme(card.theme ?? activeCardThemeId);
  drawCompanyLogo(context, 534, 112, 54, true);
  context.fillStyle = t.canvas.badgeColor || "#FFB81C";
  context.font = "700 20px Inter, Arial, sans-serif";
  context.fillText(`${card.os} · LIVE TELEMETRY`, 48, 137);
  context.fillStyle = t.canvas.titleColor || "#f4f5f7";
  context.font = "700 44px Inter, Arial, sans-serif";
  context.fillText("Runtime & ports.", 48, 194);
  context.fillStyle = t.canvas.detailColor || "#c3c8d1";
  context.font = "500 23px Inter, Arial, sans-serif";
  context.fillText("Loopback endpoints, vCPU profile & pool utilization.", 48, 234);
  ...
  drawKeyValueRows(context, rows, 286, 88, 1, t);
  ...
  drawStatusFooter(context, card, t);
}
```

---

### 4.4 Changes in Shared Helpers

#### 1. `drawStatusFooter` (line 4191)
```typescript
// BEFORE:
function drawStatusFooter(context: CanvasRenderingContext2D, card: SystemCard): void {
  context.fillStyle = card.color;
  context.beginPath();
  context.arc(58, 852, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#f4f5f7";
  context.font = "700 19.5px Inter, Arial, sans-serif";
  context.fillText(card.status, 76, 859);
}

// AFTER:
function drawStatusFooter(
  context: CanvasRenderingContext2D,
  card: SystemCard,
  theme?: CardThemeDefinition,
): void {
  const t = theme ?? getCardTheme(card.theme ?? activeCardThemeId);
  context.fillStyle = card.color;
  context.beginPath();
  context.arc(58, 852, 6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = t.canvas.titleColor || "#f4f5f7";
  context.font = "700 19.5px Inter, Arial, sans-serif";
  context.fillText(card.status, 76, 859);
}
```

#### 2. `drawKeyValueRows` (line 4162)
```typescript
// BEFORE:
function drawKeyValueRows(
  context: CanvasRenderingContext2D,
  rows: [string, string][],
  startY: number,
  stepY: number,
  textScale = 1,
): void {
  rows.forEach(([label, value], index) => {
    ...
    context.fillStyle = "#FFB81C";
    context.font = `700 ${18.5 * textScale}px Inter, Arial, sans-serif`;
    context.fillText(label, 60, y + 2);
    context.fillStyle = "#ffffff";
    context.font = `600 ${23 * textScale}px Inter, Arial, sans-serif`;
    drawWrappedText(context, value, 60, y + 34, 520, 26 * textScale, 2);
  });
}

// AFTER:
function drawKeyValueRows(
  context: CanvasRenderingContext2D,
  rows: [string, string][],
  startY: number,
  stepY: number,
  textScale = 1,
  theme?: CardThemeDefinition,
): void {
  const t = theme ?? getCardTheme(activeCardThemeId);
  rows.forEach(([label, value], index) => {
    ...
    context.fillStyle = t.canvas.badgeColor || "#FFB81C";
    context.font = `700 ${18.5 * textScale}px Inter, Arial, sans-serif`;
    context.fillText(label, 60, y + 2);
    context.fillStyle = t.canvas.titleColor || "#ffffff";
    context.font = `600 ${23 * textScale}px Inter, Arial, sans-serif`;
    drawWrappedText(context, value, 60, y + 34, 520, 26 * textScale, 2);
  });
}
```

#### 3. `drawMessageBox` (line 3982)
```typescript
// BEFORE:
function drawMessageBox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  borderColor: string,
  text: string,
): void {
  ...
  context.fillStyle = "#f4f5f7";
  context.font = "500 21px Inter, Arial, sans-serif";
  drawWrappedText(context, text, x + 18, y + 34, w - 36, 26, 2);
}

// AFTER:
function drawMessageBox(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  borderColor: string,
  text: string,
  theme?: CardThemeDefinition,
): void {
  const t = theme ?? getCardTheme(activeCardThemeId);
  ...
  context.fillStyle = t.canvas.titleColor || "#f4f5f7";
  context.font = "500 21px Inter, Arial, sans-serif";
  drawWrappedText(context, text, x + 18, y + 34, w - 36, 26, 2);
}
```

#### 4. `blurCardCanvas` (line 3279)
```typescript
// BEFORE (line 3304):
    context.fillStyle = "#f4f5f7";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 16px Inter, Arial, sans-serif";
    context.fillText(card.name.split(" · ")[1] ?? card.name, 160, 222);

// AFTER:
    const blurTheme = getCardTheme(card.theme ?? activeCardThemeId);
    context.fillStyle = blurTheme.canvas.titleColor || "#f4f5f7";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "700 16px Inter, Arial, sans-serif";
    context.fillText(card.name.split(" · ")[1] ?? card.name, 160, 222);
```

---

## 5. Verification Method

### 5.1 Independent Verification Commands
To verify the changes once applied:
```powershell
# 1. Typecheck: must output 0 errors
cd workspace-prototype
npx tsc --noEmit

# 2. Automated test suite: must pass all 195+ tests with 0 failures
npm test

# 3. Check for lingering hardcoded #f4f5f7 and #c3c8d1 in drawer functions:
Get-Content src/main.ts | Select-String "#f4f5f7|#c3c8d1"
# Verify that remaining occurrences are only inside simulated guest OS windows (drawMockDisplay lines 3645-3711)
```

### 5.2 Files to Inspect
1. `workspace-prototype/src/main.ts`:
   - Lines 3193-3277 (`makeCardTexture`)
   - Lines 3438-3482 (`drawCardFront`)
   - Lines 3772-3850 (`drawCardSettings`)
   - Lines 3852-3918 (`drawCardSecurity`)
   - Lines 3920-3980 (`drawCardPlanes`)
   - Lines 4003-4060 (`drawCardQuickActions`)
   - Lines 4062-4160 (`drawCardTelemetry`)
   - Lines 4162-4189 (`drawKeyValueRows`)
   - Lines 4191-4199 (`drawStatusFooter`)
   - Lines 3982-4001 (`drawMessageBox`)

### 5.3 Invalidation Conditions
The conclusions of this report would be invalidated if:
1. `CardThemeDefinition` or `CanvasThemeTokens` interface keys (`titleColor`, `detailColor`, `badgeColor`) are altered or renamed in `src/card-themes.ts`.
2. `FACET_ORDER` or `CardFacet` definitions are changed to alter the 6-way facet model.
3. `tests/compact-private-preview.test.mjs` changes its regex or substring slicing boundaries away from `"function drawCardSettings("`.
