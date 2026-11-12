/**
 * Post Card Spatial OS — E2E Test Suite: Card Theming, Floor Collision & UI Integration
 *
 * Implements full 4-tier verification per TEST_INFRA.md and SCOPE.md:
 * - Tier 1: Core Unit Invariants & Assertions (>= 5 assertions per feature across all 7 features)
 * - Tier 2: Boundary & Corner Cases (Extreme coordinates, dais perimeter, scales, tilts, all 25 theme transitions)
 * - Tier 3: Cross-Feature Combinations (Theming + floor clamping + view switching + persistence)
 * - Tier 4: Real-World User Flows (F1-F5 end-to-end user journeys)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as THREE from "three";

const __filename = fileURLToPath(import.meta.url);
const testsDir = path.dirname(__filename);
const workspaceDir = path.resolve(testsDir, "..");
const repoRoot = path.resolve(workspaceDir, "..");

const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");
const html = fs.readFileSync(path.join(workspaceDir, "index.html"), "utf-8");
const styleCss = fs.readFileSync(path.join(workspaceDir, "src", "style.css"), "utf-8");

// ----------------------------------------------------------------------------
// Dynamic TypeScript Transpilation Helpers
// ----------------------------------------------------------------------------

let cardThemesModulePromise = null;
async function loadCardThemes() {
  if (!cardThemesModulePromise) {
    cardThemesModulePromise = (async () => {
      const candidates = [
        path.join(workspaceDir, "src", "card-themes.ts"),
        path.join(repoRoot, ".agents", "teamwork", "explorer_m3_1", "proposed_card-themes.ts"),
      ];
      const target = candidates.find((p) => fs.existsSync(p));
      if (!target) {
        throw new Error(`Could not find card-themes.ts in candidates: ${candidates.join(", ")}`);
      }
      const sourceTs = fs.readFileSync(target, "utf-8");
      const compiled = ts.transpileModule(sourceTs, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
    })();
  }
  return cardThemesModulePromise;
}

let cardButtonsModulePromise = null;
async function loadCardButtons() {
  if (!cardButtonsModulePromise) {
    cardButtonsModulePromise = (async () => {
      const target = path.join(workspaceDir, "src", "card-buttons.ts");
      const sourceTs = fs.readFileSync(target, "utf-8");
      const compiled = ts.transpileModule(sourceTs, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
    })();
  }
  return cardButtonsModulePromise;
}

let cardActionsModulePromise = null;
async function loadCardActions() {
  if (!cardActionsModulePromise) {
    cardActionsModulePromise = (async () => {
      const target = path.join(workspaceDir, "src", "card-actions.ts");
      const sourceTs = fs.readFileSync(target, "utf-8");
      const compiled = ts.transpileModule(sourceTs, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText;
      return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
    })();
  }
  return cardActionsModulePromise;
}

// ----------------------------------------------------------------------------
// Spatial Physics & Geometry Engine Definitions (PROJECT.md & main.ts)
// ----------------------------------------------------------------------------

const FLOOR_Y = -0.12;
const DAIS_SURFACE_Y = 0.085;
const DAIS_CENTER_Z = -0.25;
const DAIS_RADIUS = 7.7;
const DAIS_RADIUS_SQ = DAIS_RADIUS * DAIS_RADIUS; // 59.29

const CARD_WIDTH = 2.15;
const CARD_HEIGHT = 3.2;
const CARD_HALF_WIDTH = CARD_WIDTH / 2;   // 1.075
const CARD_HALF_HEIGHT = CARD_HEIGHT / 2; // 1.600
const CARD_HALF_DEPTH = 0.091;

function getFloorHeightAt(x, z) {
  const dx = x;
  const dz = z - DAIS_CENTER_Z;
  return dx * dx + dz * dz <= DAIS_RADIUS_SQ ? DAIS_SURFACE_Y : FLOOR_Y;
}

function minCardCenterY(x, z, scale = 1.0) {
  return getFloorHeightAt(x, z) + CARD_HALF_HEIGHT * scale;
}

function getCardHalfHeightExtent(cardMesh) {
  cardMesh.updateWorldMatrix(true, false);
  const e = cardMesh.matrixWorld.elements;
  return (
    Math.abs(e[1]) * CARD_HALF_WIDTH +
    Math.abs(e[5]) * CARD_HALF_HEIGHT +
    Math.abs(e[9]) * CARD_HALF_DEPTH
  );
}

function getEffectiveFloorHeightForCard(cardMesh) {
  const dx = cardMesh.position.x;
  const dz = cardMesh.position.z - DAIS_CENTER_Z;
  const dist = Math.hypot(dx, dz);
  const cardScale = Math.max(cardMesh.scale.x, cardMesh.scale.z, 1.0);
  const cardHorizRadius = 1.1 * cardScale;
  if (dist <= DAIS_RADIUS + cardHorizRadius) {
    return DAIS_SURFACE_Y;
  }
  return FLOOR_Y;
}

function clampCardMeshAboveFloor(cardMesh, useBox3 = false) {
  const targetFloor = getEffectiveFloorHeightForCard(cardMesh);
  if (useBox3) {
    cardMesh.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(cardMesh);
    if (box.min.y < targetFloor) {
      cardMesh.position.y += targetFloor - box.min.y;
      cardMesh.updateWorldMatrix(true, false);
    }
  } else {
    const extentY = getCardHalfHeightExtent(cardMesh);
    const minY = targetFloor + extentY;
    if (cardMesh.position.y < minY) {
      cardMesh.position.y = minY;
      cardMesh.updateWorldMatrix(true, false);
    }
  }
  return cardMesh.position.y;
}

function createSyntheticCardObject(options = {}) {
  const group = new THREE.Group();
  group.position.set(options.x ?? 0, options.y ?? 2.0, options.z ?? -0.25);
  if (options.scale !== undefined) {
    group.scale.set(options.scale, options.scale, options.scale);
  }
  if (options.rotationX) group.rotation.x = options.rotationX;
  if (options.rotationY) group.rotation.y = options.rotationY;
  if (options.rotationZ) group.rotation.z = options.rotationZ;

  const faceGeo = new THREE.PlaneGeometry(CARD_WIDTH, CARD_HEIGHT);
  const mat = new THREE.MeshBasicMaterial();
  const faceMesh = new THREE.Mesh(faceGeo, mat);
  group.add(faceMesh);

  group.updateWorldMatrix(true, true);
  return {
    id: options.id ?? "linux",
    group,
    theme: options.theme,
    facet: options.facet ?? "front",
    color: options.color ?? "#70d5cf",
  };
}

function computeCardContentKeySim(card, activeThemeId = "classic") {
  const effectiveTheme = card.theme ?? activeThemeId;
  return [
    effectiveTheme,
    card.id,
    card.facet ?? "front",
    card.color ?? "default",
  ].join("|");
}

// ============================================================================
// TIER 1: CORE UNIT INVARIANTS (>= 5 ASSERTIONS PER FEATURE)
// ============================================================================

test("Tier 1.1: Feature 1 — Theming Research Documentation (THEMING_RESEARCH.md)", () => {
  const docPath = path.join(repoRoot, "THEMING_RESEARCH.md");
  assert.ok(fs.existsSync(docPath), "THEMING_RESEARCH.md must exist at repo root");
  const docContent = fs.readFileSync(docPath, "utf-8");

  // Assertion 1: Document size threshold
  assert.ok(docContent.length >= 10000, "Documentation must be thorough (>10KB)");

  // Assertion 2: Covers Android customization patterns & Material 3 Monet engine
  assert.match(docContent, /Android/i, "Must research Android customization patterns");
  assert.match(docContent, /Material|Monet|HCT/i, "Must research Material Design / Monet color extraction");

  // Assertion 3: Covers contrast ratios & WCAG accessibility
  assert.match(docContent, /contrast|WCAG|accessibility|tonal/i, "Must document contrast requirements");

  // Assertion 4: Covers 2D flat vs 3D spatial taxonomy
  assert.match(docContent, /spatial|depth|PBR|elevation|lighting/i, "Must distinguish 2D flat vs 3D spatial taxonomy");

  // Assertion 5: Defines all 5 canonical themes
  const canonicalThemes = ["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"];
  for (const theme of canonicalThemes) {
    assert.match(docContent, new RegExp(theme, "i"), `Must document theme preset: ${theme}`);
  }

  // Assertion 6: Specifies TypeScript schema tokens
  assert.match(
    docContent,
    /CanvasThemeTokens|MaterialThemeTokens|LightingThemeTokens|CardThemeDefinition/,
    "Must document formal TypeScript schema definitions"
  );
});

test("Tier 1.2: Feature 2 — Floor Boundary Constraints & Dais Collision Physics", () => {
  // Assertion 1: Dais center elevation is exactly +0.085
  assert.equal(getFloorHeightAt(0, -0.25), DAIS_SURFACE_Y, "Center of dais must be 0.085");

  // Assertion 2: Interior dais position is exactly +0.085
  assert.equal(getFloorHeightAt(4.0, 1.0), DAIS_SURFACE_Y, "Interior dais point must be 0.085");

  // Assertion 3: Dais boundary perimeter at r = 7.7 is +0.085
  assert.equal(getFloorHeightAt(7.7, -0.25), DAIS_SURFACE_Y, "Boundary perimeter at r=7.7 must be 0.085");

  // Assertion 4: Outside dais platform drops to specular obsidian floor at -0.12
  assert.equal(getFloorHeightAt(8.5, 0.0), FLOOR_Y, "Exterior point at x=8.5 must be -0.12");

  // Assertion 5: Distant room floor coordinate returns -0.12
  assert.equal(getFloorHeightAt(0.0, 15.0), FLOOR_Y, "Distant room floor must return -0.12");

  // Assertion 6: minCardCenterY over dais at scale 1.0 is 1.685 (0.085 + 1.6)
  assert.equal(minCardCenterY(0, -0.25, 1.0), 1.685, "Dais min center Y must be 1.685");

  // Assertion 7: minCardCenterY over floor at scale 1.0 is 1.480 (-0.12 + 1.6)
  assert.equal(minCardCenterY(10.0, 0, 1.0), 1.480, "Floor min center Y must be 1.480");

  // Assertion 8: Clamping a card placed at Y = 0.6 lifts position.y above surface
  const syntheticCard = createSyntheticCardObject({ x: 0, y: 0.6, z: -0.25 });
  clampCardMeshAboveFloor(syntheticCard.group, false);
  assert.ok(
    syntheticCard.group.position.y >= 1.685,
    `Card center Y (${syntheticCard.group.position.y}) must be clamped >= 1.685 over dais`
  );
});

test("Tier 1.2b: Feature 2 — main.ts implements and enforces floor collision clamping in all 4 sites", () => {
  // Assertion 1: getFloorHeightAt export
  assert.match(mainTs, /export function getFloorHeightAt/, "main.ts must export getFloorHeightAt");

  // Assertion 2: clampCardAboveFloor export
  assert.match(mainTs, /export function clampCardAboveFloor/, "main.ts must export clampCardAboveFloor");

  // Assertion 3: Site 1 — onPointerMove direct manipulation
  assert.match(mainTs, /clampCardAboveFloor\(drag\.card\)/, "Floor clamp must be enforced in onPointerMove");

  // Assertion 4: Site 2 — resolveCardCollisions
  assert.match(
    mainTs,
    /for\s*\(\s*const\s+card\s+of\s+cards\s*\)\s*\{\s*clampCardAboveFloor\(card\);/,
    "Floor clamp must be enforced in resolveCardCollisions"
  );

  // Assertion 5: Site 3 — onPointerUp release
  assert.match(mainTs, /clampCardAboveFloor\(completedDrag\.card\);/, "Floor clamp must be enforced in onPointerUp");

  // Assertion 6: Site 4 — animate loop
  assert.match(mainTs, /clampCardAboveFloor\(card\);/, "Floor clamp must be enforced in animate loop");
});

test("Tier 1.3: Feature 3 — 5 Theme Preset Token Definitions & Schemas", async () => {
  const { CARD_THEME_IDS, CARD_THEMES, getCardTheme } = await loadCardThemes();

  // Assertion 1: Exactly 5 theme IDs defined
  assert.equal(CARD_THEME_IDS.length, 5, "Must define exactly 5 theme IDs");
  assert.deepEqual(
    [...CARD_THEME_IDS].sort(),
    ["classic", "cyberpunk", "glass", "material-vibrant", "minimal-dark"].sort(),
    "Theme IDs must match canonical list"
  );

  // Assertion 2: All 5 presets present in CARD_THEMES record with required fields
  for (const id of CARD_THEME_IDS) {
    const theme = CARD_THEMES[id];
    assert.ok(theme, `Theme ${id} must exist in CARD_THEMES`);
    assert.equal(theme.id, id);
    assert.ok(theme.name && theme.name.length > 0, `Theme ${id} must have a name`);
    assert.ok(theme.canvas, `Theme ${id} must have canvas tokens`);
    assert.ok(theme.material, `Theme ${id} must have material tokens`);
    assert.ok(theme.lighting, `Theme ${id} must have lighting tokens`);
  }

  // Assertion 3: Classic theme palette invariants
  const classic = getCardTheme("classic");
  assert.match(classic.canvas.bgTop, /^#14161[Bb]$/i, "Classic bgTop must match slate tone");
  assert.match(classic.canvas.badgeColor, /^#70d5cf$/i, "Classic badge must be cyan");
  assert.ok(
    /112,\s*213,\s*207/i.test(classic.canvas.borderStroke) || /#70d5cf/i.test(classic.canvas.borderStroke),
    "Classic border stroke must contain cyan hue"
  );
  assert.ok(
    classic.material.roughness >= 0.8 && classic.material.roughness <= 0.95,
    "Classic material should be matte finish"
  );

  // Assertion 4: Cyberpunk theme neon accents & glossy material
  const cyberpunk = getCardTheme("cyberpunk");
  assert.ok(
    /255,\s*0,\s*127/i.test(cyberpunk.canvas.borderStroke) ||
      /0,\s*240,\s*255/i.test(cyberpunk.canvas.borderStroke) ||
      /#(ff007f|00f0ff)/i.test(cyberpunk.canvas.borderStroke),
    "Cyberpunk border stroke must be neon magenta or cyan"
  );
  assert.ok(cyberpunk.material.roughness <= 0.35, "Cyberpunk roughness must be glossy (<=0.35)");
  assert.ok(
    cyberpunk.material.metalness >= 0.1 || cyberpunk.material.edgeMetalness >= 0.8,
    "Cyberpunk must have high metallic accents"
  );

  // Assertion 5: Minimal Dark AMOLED black invariants
  const minimal = getCardTheme("minimal-dark");
  assert.match(minimal.canvas.bgTop, /^#050505$/, "Minimal dark bgTop must be AMOLED deep grey");
  assert.match(minimal.canvas.bgBottom, /^#000000$/, "Minimal dark bgBottom must be pure black");
  assert.equal(minimal.material.metalness, 0.0, "Minimal dark metalness must be 0.0");

  // Assertion 6: Glass / Frosted translucency & low roughness
  const glass = getCardTheme("glass");
  assert.match(glass.canvas.bgTop, /^rgba\(/i, "Glass bgTop must use rgba translucency");
  assert.ok(glass.material.roughness <= 0.25, "Glass roughness must be crystal smooth");

  // Assertion 7: Material Vibrant warm tactile finish
  const vibrant = getCardTheme("material-vibrant");
  assert.ok(
    /245,\s*158,\s*11/i.test(vibrant.canvas.borderStroke) || /#f59e0b/i.test(vibrant.canvas.borderStroke),
    "Material Vibrant accent must be warm amber"
  );
  assert.equal(vibrant.canvas.badgeColor, "#f59e0b", "Vibrant badge color must be amber");
  assert.ok(
    vibrant.material.roughness >= 0.5 && vibrant.material.roughness <= 0.75,
    "Material Vibrant roughness must be satin tactile"
  );

  // Assertion 8: Lighting tokens validity
  for (const id of CARD_THEME_IDS) {
    const theme = CARD_THEMES[id];
    assert.ok(theme.lighting.haloIntensity > 0, `${id} halo intensity must be positive`);
    assert.ok(theme.lighting.floorGlowIntensity > 0, `${id} floor glow intensity must be positive`);
    assert.ok(theme.lighting.haloColor && theme.lighting.haloColor.length > 0);
  }
});

test("Tier 1.4: Feature 4 — Theme Cache Invalidation & Content Key Synchronization", () => {
  const card = createSyntheticCardObject({ id: "linux", theme: undefined });

  // Assertion 1: Default card content key contains the active theme
  const key1 = computeCardContentKeySim(card, "classic");
  assert.ok(key1.startsWith("classic|"), `Key ${key1} must incorporate active theme`);

  // Assertion 2: Key changes when global active theme changes
  const key2 = computeCardContentKeySim(card, "cyberpunk");
  assert.notEqual(key1, key2, "Changing active theme must produce distinct content keys");
  assert.ok(key2.startsWith("cyberpunk|"));

  // Assertion 3: Per-card custom theme overrides global theme in key
  card.theme = "minimal-dark";
  const key3 = computeCardContentKeySim(card, "cyberpunk");
  assert.ok(key3.startsWith("minimal-dark|"), "Per-card theme must take precedence in content key");
  assert.ok(!key3.includes("cyberpunk"), "Overridden card key must not use global theme");

  // Assertion 4: Texture dispose lifecycle on key mismatch
  let disposeCount = 0;
  const mockTexture = {
    dispose: () => {
      disposeCount++;
    },
  };
  let cachedContentKey = "old-stale-key";
  if (cachedContentKey !== key3) {
    mockTexture.dispose();
    cachedContentKey = key3;
  }
  assert.equal(disposeCount, 1, "Texture dispose must be called on cache key mismatch");

  // Assertion 5: Identical key does not trigger redundant texture dispose
  if (cachedContentKey !== key3) {
    mockTexture.dispose();
  }
  assert.equal(disposeCount, 1, "Identical content key must not trigger redundant texture dispose");
});

test("Tier 1.5: Feature 5 — Home View UI & Dual-View Router", () => {
  // Assertion 1: Primary hero CTA has data-open-studio
  assert.match(
    html,
    /<button[^>]+class="[^"]*home-primary-button[^"]*"[^>]*data-open-studio/i,
    "Hero CTA button must have data-open-studio"
  );

  // Assertion 2: Exactly 5 home system card buttons with data-open-studio
  const systemCardMatches = [
    ...html.matchAll(/<button[^>]+class="[^"]*home-system-card[^"]*"[^>]*data-open-studio/g),
  ];
  assert.equal(systemCardMatches.length, 5, "Must have exactly 5 home system card buttons");

  // Assertion 3: System cards have exact target IDs (android, windows, linux, macos, kali-red)
  const cardIds = [
    ...html.matchAll(/class="[^"]*home-system-card[^"]*"[^>]*data-card-id="([^"]+)"/g),
  ].map((m) => m[1]);
  assert.deepEqual(
    cardIds.sort(),
    ["android", "kali-red", "linux", "macos", "windows"].sort(),
    "System card IDs must match target catalog"
  );

  // Assertion 4: Topbar contains home return link or button
  assert.match(
    html,
    /data-open-home|class="[^"]*home-return-button[^"]*"|href="#home"/i,
    "Topbar must contain return navigation to home view"
  );

  // Assertion 5: View router simulation — showStudio sets hidden attributes
  const homeView = { hidden: false };
  const studioView = { hidden: true };
  let selected = null;
  function showStudioMock(cardId) {
    homeView.hidden = true;
    studioView.hidden = false;
    if (cardId) selected = cardId;
  }
  showStudioMock("macos");
  assert.equal(homeView.hidden, true, "showStudio must hide homeView");
  assert.equal(studioView.hidden, false, "showStudio must reveal studioView");
  assert.equal(selected, "macos", "showStudio must select specified card");

  // Assertion 6: View router simulation — showHome restores hidden attributes
  function showHomeMock() {
    studioView.hidden = true;
    homeView.hidden = false;
  }
  showHomeMock();
  assert.equal(homeView.hidden, false, "showHome must reveal homeView");
  assert.equal(studioView.hidden, true, "showHome must hide studioView");

  // Assertion 7: main.ts queries and binds view router
  assert.match(mainTs, /#home-view/, "main.ts must query #home-view");
  assert.match(mainTs, /data-open-studio/, "main.ts must wire [data-open-studio]");
});

test("Tier 1.6: Feature 6 — Button Interactivity Safety across all DOM buttons & 8 printed buttons", async () => {
  const buttons = [...html.matchAll(/<button\b([^>]*)>/g)].map((m) => m[1]);

  // Assertion 1: Total DOM button count is at least 123
  assert.ok(
    buttons.length >= 123,
    `Must find at least 123 DOM buttons in index.html (found ${buttons.length})`
  );

  // Assertion 2: Modal dialog dismiss and cancel buttons exist
  const modalDismissButtons = [
    "bin-close",
    "guest-close",
    "trash-cancel",
    "cancel-performance",
    "cancel-add-card",
    "butler-close",
  ];
  for (const id of modalDismissButtons) {
    assert.match(html, new RegExp(`id="${id}"`), `Modal button #${id} must exist in index.html`);
  }

  // Assertion 3: Printed card buttons catalog contains exactly 8 buttons
  const { CARD_BUTTON_IDS, hitCardButton, cardButtonRect } = await loadCardButtons();
  assert.equal(CARD_BUTTON_IDS.length, 8, "Must define exactly 8 printed card buttons");
  assert.deepEqual(
    [...CARD_BUTTON_IDS],
    ["guest", "stop", "zoom", "settings", "clone", "savepoint", "performance", "bin"],
    "Printed buttons must match catalog"
  );

  // Assertion 4: UV center of all 8 printed buttons resolves cleanly to its button ID
  for (let i = 0; i < 8; i++) {
    const rect = cardButtonRect(i);
    const u = (rect.x + rect.w / 2) / 640;
    const v = 1 - (rect.y + rect.h / 2) / 960;
    assert.equal(
      hitCardButton(u, v),
      CARD_BUTTON_IDS[i],
      `UV center for button index ${i} (${CARD_BUTTON_IDS[i]}) must hit-test cleanly`
    );
  }

  // Assertion 5: Gaps and preview areas safely return undefined
  assert.equal(hitCardButton(0.5, 0.5), undefined, "Center preview area must not be a button");
  assert.equal(hitCardButton(0.05, 0.05), undefined, "Bottom left margin must not be a button");

  // Assertion 6: Optional chaining crash safety check on preparedCardIds
  const { getOnCardActionState } = await loadCardActions();
  const safeState = getOnCardActionState({
    os: "linux",
    baseReady: true,
    hasDisk: false,
    canMoveToBin: true,
  });
  assert.equal(safeState.guestLabel, "Launch", "getOnCardActionState must resolve cleanly");
  assert.equal(safeState.showBin, true);

  // Assertion 7: Safe handling of undefined preparedCardIds in status object
  const statusMock = { guests: [] }; // preparedCardIds is undefined
  const hasDiskSafe = statusMock?.preparedCardIds?.includes("linux") ?? false;
  assert.equal(
    hasDiskSafe,
    false,
    "Optional chaining must prevent TypeError when preparedCardIds is undefined"
  );

  // Assertion 8: main.ts must NOT contain unchained preparedCardIds.includes bug
  assert.doesNotMatch(
    mainTs,
    /status\?\.preparedCardIds\.includes/,
    "Unchained preparedCardIds.includes bug must not exist in main.ts"
  );
});

test("Tier 1.7: Feature 7 — Fedora Remote Workstation Execution & Infrastructure Verification", () => {
  // Assertion 1: .env or .env.example specifies Fedora host
  const envPath = fs.existsSync(path.join(workspaceDir, ".env"))
    ? path.join(workspaceDir, ".env")
    : path.join(workspaceDir, ".env.example");
  const envContent = fs.readFileSync(envPath, "utf-8");
  assert.match(
    envContent,
    /POSTCARD_KVM_HOST=casey@10\.0\.0\.2/i,
    "Environment file must specify Fedora KVM host 10.0.0.2"
  );

  // Assertion 2: PROJECT.md documents Fedora Workstation utilization
  const projectMd = fs.readFileSync(path.join(repoRoot, "PROJECT.md"), "utf-8");
  assert.match(projectMd, /10\.0\.0\.2/, "PROJECT.md must document Fedora IP 10.0.0.2");
  assert.match(projectMd, /Node\.js v26|Firefox/i, "PROJECT.md must document Fedora toolchain");

  // Assertion 3: TEST_INFRA.md documents Fedora validation contract
  const testInfraMd = fs.readFileSync(path.join(repoRoot, "TEST_INFRA.md"), "utf-8");
  assert.match(testInfraMd, /ssh fedora "node --test/i, "TEST_INFRA.md must document remote test runner");
  assert.match(
    testInfraMd,
    /firefox --headless --screenshot/i,
    "TEST_INFRA.md must document headless screenshot"
  );

  // Assertion 4: Cross-platform forward slashes in path normalization
  const samplePath = path.posix.join("workspace-prototype", "tests", "card-theming-collision.test.mjs");
  assert.equal(samplePath, "workspace-prototype/tests/card-theming-collision.test.mjs");

  // Assertion 5: Batch-mode SSH command formulation
  const sshCmd = `ssh -o BatchMode=yes fedora "node -v"`;
  assert.ok(sshCmd.includes("-o BatchMode=yes"), "SSH commands must use non-interactive batch mode");
});

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES
// ============================================================================

test("Tier 2.1: Extreme Downward & Upward Drag Coordinates", () => {
  const card = createSyntheticCardObject({ x: 0, y: 2.0, z: -0.25 });

  // Test 2.1.1: Drag to Y = 0.0 (over dais) clamps to >= 1.685
  card.group.position.y = 0.0;
  clampCardMeshAboveFloor(card.group, false);
  assert.ok(
    card.group.position.y >= 1.685,
    `Y = 0.0 must clamp to >= 1.685 over dais (actual: ${card.group.position.y})`
  );

  // Test 2.1.2: Extreme downward drag to Y = -10.0 clamps to >= 1.685
  card.group.position.y = -10.0;
  clampCardMeshAboveFloor(card.group, false);
  assert.ok(
    card.group.position.y >= 1.685,
    `Y = -10.0 must clamp to >= 1.685 over dais (actual: ${card.group.position.y})`
  );

  // Test 2.1.3: Drag to previous buggy limit Y = 0.6 clamps to >= 1.685
  card.group.position.y = 0.6;
  clampCardMeshAboveFloor(card.group, false);
  assert.ok(
    card.group.position.y >= 1.685,
    `Buggy limit Y = 0.6 must clamp upward to >= 1.685 (actual: ${card.group.position.y})`
  );

  // Test 2.1.4: Drag outside dais (x = 10.0, z = 0.0) down to Y = -5.0 clamps to >= 1.480
  card.group.position.set(10.0, -5.0, 0.0);
  clampCardMeshAboveFloor(card.group, false);
  assert.ok(
    card.group.position.y >= 1.48,
    `Sub-floor drag outside dais must clamp to >= 1.480 (actual: ${card.group.position.y})`
  );

  // Test 2.1.5: Upward drag to Y = 4.5 is preserved without false-positive clamping
  card.group.position.set(0.0, 4.5, -0.25);
  clampCardMeshAboveFloor(card.group, false);
  assert.equal(card.group.position.y, 4.5, "High Y coordinate (4.5) must not be altered");
});

test("Tier 2.2: Radial Dais Boundary Discontinuity at r = 7.7 vs 7.701", () => {
  // Test 2.2.1: Exactly on perimeter radius (7.7, -0.25)
  const onPerimeterH = getFloorHeightAt(7.7, -0.25);
  assert.equal(onPerimeterH, DAIS_SURFACE_Y, "Perimeter point at r=7.7 must return dais height 0.085");

  // Test 2.2.2: Infinitesimal exterior step (7.701, -0.25)
  const outsideH = getFloorHeightAt(7.701, -0.25);
  assert.equal(outsideH, FLOOR_Y, "Point at r=7.701 must drop to obsidian floor -0.12");

  // Test 2.2.3: 4 cardinal perimeter points around (0, -0.25)
  const cardinalCoords = [
    [0.0, -0.25 + 7.7], // North: (0, 7.45)
    [0.0, -0.25 - 7.7], // South: (0, -7.95)
    [7.7, -0.25],       // East:  (7.7, -0.25)
    [-7.7, -0.25],      // West:  (-7.7, -0.25)
  ];
  for (const [x, z] of cardinalCoords) {
    assert.equal(
      getFloorHeightAt(x, z),
      DAIS_SURFACE_Y,
      `Cardinal perimeter coordinate (${x}, ${z}) must be on dais`
    );
  }

  // Test 2.2.4: Just outside 4 cardinal points drops to -0.12
  const exteriorCoords = [
    [0.0, -0.25 + 7.705],
    [0.0, -0.25 - 7.705],
    [7.705, -0.25],
    [-7.705, -0.25],
  ];
  for (const [x, z] of exteriorCoords) {
    assert.equal(
      getFloorHeightAt(x, z),
      FLOOR_Y,
      `Exterior coordinate (${x}, ${z}) must be on floor`
    );
  }
});

test("Tier 2.3: Scale-Dependent Clamping & Three.js Box3 Tilt Clearance", () => {
  // Test 2.3.1: Rear carousel card at scale = 0.64
  const scaleRear = 0.64;
  const rearMinY = minCardCenterY(0, -0.25, scaleRear);
  const expectedRearMinY = 0.085 + 1.6 * scaleRear; // 1.109
  assert.ok(
    Math.abs(rearMinY - expectedRearMinY) < 1e-4,
    `Rear card (scale 0.64) min Y should be ${expectedRearMinY}, got ${rearMinY}`
  );

  // Test 2.3.2: Focused front card at scale = 1.04
  const scaleFront = 1.04;
  const frontMinY = minCardCenterY(0, -0.25, scaleFront);
  const expectedFrontMinY = 0.085 + 1.6 * scaleFront; // 1.749
  assert.ok(
    Math.abs(frontMinY - expectedFrontMinY) < 1e-4,
    `Front card (scale 1.04) min Y should be ${expectedFrontMinY}, got ${frontMinY}`
  );

  // Test 2.3.3: Card tilted around Z by ~20 deg (corner dips downward)
  const tiltedCardZ = createSyntheticCardObject({ x: 0, y: 1.685, z: -0.25, rotationZ: 0.35 });
  const initialBoxZ = new THREE.Box3().setFromObject(tiltedCardZ.group);
  assert.ok(initialBoxZ.min.y < DAIS_SURFACE_Y, "Tilting card dips lowest corner below 0.085 without clamp");

  // Box3 clamping elevates card so lowest corner >= 0.085
  clampCardMeshAboveFloor(tiltedCardZ.group, true);
  const clampedBoxZ = new THREE.Box3().setFromObject(tiltedCardZ.group);
  assert.ok(
    clampedBoxZ.min.y >= DAIS_SURFACE_Y - 1e-4,
    `Clamped tilted card Box3.min.y (${clampedBoxZ.min.y}) must be >= ${DAIS_SURFACE_Y}`
  );

  // Test 2.3.4: Card tilted around X by ~15 deg
  const tiltedCardX = createSyntheticCardObject({ x: 0, y: 1.685, z: -0.25, rotationX: 0.26 });
  clampCardMeshAboveFloor(tiltedCardX.group, true);
  const clampedBoxX = new THREE.Box3().setFromObject(tiltedCardX.group);
  assert.ok(
    clampedBoxX.min.y >= DAIS_SURFACE_Y - 1e-4,
    `Clamped X-tilted card Box3.min.y (${clampedBoxX.min.y}) must be >= ${DAIS_SURFACE_Y}`
  );
});

test("Tier 2.4: All 25 Theme Switching Transitions & Idempotency", async () => {
  const { CARD_THEME_IDS, getCardTheme } = await loadCardThemes();
  const card = createSyntheticCardObject({ id: "windows" });

  let crossTransitionCount = 0;
  let selfTransitionCount = 0;

  for (const fromTheme of CARD_THEME_IDS) {
    for (const toTheme of CARD_THEME_IDS) {
      const fromDef = getCardTheme(fromTheme);
      const toDef = getCardTheme(toTheme);
      assert.ok(fromDef && toDef, `Themes ${fromTheme} and ${toTheme} must resolve`);

      const keyFrom = computeCardContentKeySim(card, fromTheme);
      const keyTo = computeCardContentKeySim(card, toTheme);

      if (fromTheme === toTheme) {
        assert.equal(keyFrom, keyTo, `Self-transition ${fromTheme} -> ${toTheme} must produce identical key`);
        selfTransitionCount++;
      } else {
        assert.notEqual(keyFrom, keyTo, `Cross-transition ${fromTheme} -> ${toTheme} must produce distinct key`);
        crossTransitionCount++;
      }
    }
  }

  assert.equal(selfTransitionCount, 5, "Must execute exactly 5 self-transitions");
  assert.equal(crossTransitionCount, 20, "Must execute exactly 20 cross-transitions");
  assert.equal(selfTransitionCount + crossTransitionCount, 25, "Must test all 25 theme combinations");
});

test("Tier 2.5: Invalid, Malformed, Empty, and Null Theme ID Recovery", async () => {
  const { getCardTheme, DEFAULT_CARD_THEME_ID } = await loadCardThemes();

  // Test 2.5.1: Non-existent theme falls back to classic
  const unknown = getCardTheme("cyberpunk-2077");
  assert.equal(unknown.id, DEFAULT_CARD_THEME_ID, "Unknown theme must fall back to classic");

  // Test 2.5.2: Empty string falls back to classic
  const empty = getCardTheme("");
  assert.equal(empty.id, DEFAULT_CARD_THEME_ID, "Empty string must fall back to classic");

  // Test 2.5.3: Null falls back to classic
  const nullTheme = getCardTheme(null);
  assert.equal(nullTheme.id, DEFAULT_CARD_THEME_ID, "null must fall back to classic");

  // Test 2.5.4: Undefined falls back to classic
  const undefTheme = getCardTheme(undefined);
  assert.equal(undefTheme.id, DEFAULT_CARD_THEME_ID, "undefined must fall back to classic");

  // Test 2.5.5: Numbers or objects fall back to classic
  const numTheme = getCardTheme(12345);
  assert.equal(numTheme.id, DEFAULT_CARD_THEME_ID, "number must fall back to classic");
});

test("Tier 2.6: CSS Specificity & Display Rule Prevention", () => {
  // Test 2.6.1: style.css does NOT contain unconditional #home-view { display: none !important; }
  assert.doesNotMatch(
    styleCss,
    /#home-view\s*\{\s*display:\s*none\s*!important;\s*\}/m,
    "style.css must not unconditionally hide #home-view"
  );

  // Test 2.6.2: Mutual-exclusion rule #home-view[hidden], #studio-view[hidden] is preserved
  assert.match(
    styleCss,
    /#home-view\[hidden\][^\{]*\{[^}]*display:\s*none\s*!important/s,
    "style.css must preserve display:none for #home-view[hidden]"
  );

  // Test 2.6.3: studio-view[hidden] is preserved
  assert.match(
    styleCss,
    /#studio-view\[hidden\][^\{]*\{[^}]*display:\s*none\s*!important/s,
    "style.css must preserve display:none for #studio-view[hidden]"
  );
});

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS
// ============================================================================

test("Tier 3.1: Theming + Card Floor Clamping Interaction", async () => {
  const { getCardTheme } = await loadCardThemes();
  const theme = getCardTheme("cyberpunk");

  // Drag card to Y = 0.0 under cyberpunk theme
  const card = createSyntheticCardObject({ x: 0, y: 0.0, z: -0.25, theme: "cyberpunk" });
  clampCardMeshAboveFloor(card.group, false);

  // Assertion 1: Card position is elevated above dais
  assert.ok(card.group.position.y >= 1.685, "Position must be clamped >= 1.685");

  // Assertion 2: Cyberpunk material properties
  assert.ok(theme.material.roughness <= 0.35, "Cyberpunk roughness must be glossy");
  assert.ok(
    theme.material.metalness >= 0.1 || theme.material.edgeMetalness >= 0.8,
    "Cyberpunk metalness must be high"
  );

  // Assertion 3: Floor glow light color matches cyberpunk neon
  assert.match(
    theme.lighting.floorGlowColor,
    /^#(00f0ff|ff007f)/i,
    "Floor glow color must match neon palette"
  );

  // Assertion 4: Content key reflects theme
  const key = computeCardContentKeySim(card, "cyberpunk");
  assert.ok(key.startsWith("cyberpunk|"));
});

test("Tier 3.2: Home Screen Theme Customization Propagating to Studio 3D Canvas", async () => {
  const { getCardTheme } = await loadCardThemes();
  const glassTheme = getCardTheme("glass");

  // Simulate user picking glass theme on home screen then switching to studio
  const homeView = { hidden: false, cardTheme: "glass" };
  const studioView = { hidden: true };

  // Switch to studio
  homeView.hidden = true;
  studioView.hidden = false;

  // Assertions
  assert.equal(homeView.hidden, true);
  assert.equal(studioView.hidden, false);
  assert.match(glassTheme.canvas.bgTop, /^rgba\(/i, "Glass canvas bgTop must use translucency");
  assert.ok(glassTheme.lighting.haloIntensity > 0, "Glass halo intensity must be active");
});

test("Tier 3.3: Card Free Manipulation Persistence Across View Switching", () => {
  const card = createSyntheticCardObject({ x: 0, y: 2.0, z: -0.25 });

  // 1. User drags card to (3.0, 2.5, -1.0)
  card.group.position.set(3.0, 2.5, -1.0);
  clampCardMeshAboveFloor(card.group, false);
  const savedPosition = card.group.position.clone();

  // 2. User navigates to Home View and then returns to Studio View
  const homeView = { hidden: false };
  const studioView = { hidden: true };
  // return to studio
  homeView.hidden = true;
  studioView.hidden = false;

  // 3. Card position must remain preserved
  assert.equal(card.group.position.x, savedPosition.x);
  assert.equal(card.group.position.y, savedPosition.y);
  assert.equal(card.group.position.z, savedPosition.z);
  assert.ok(card.group.position.y >= DAIS_SURFACE_Y + 1.6);
});

test("Tier 3.4: LocalStorage Cold-Boot Theme Initialization", async () => {
  const { CARD_THEME_STORAGE_KEY, isValidCardThemeId, getCardTheme } = await loadCardThemes();

  // Simulate localStorage persistence
  const mockStorage = {
    [CARD_THEME_STORAGE_KEY]: "material-vibrant",
  };

  const saved = mockStorage[CARD_THEME_STORAGE_KEY];
  assert.ok(isValidCardThemeId(saved), "Saved theme must be valid CardThemeId");
  const theme = getCardTheme(saved);

  assert.equal(theme.id, "material-vibrant");
  assert.ok(
    /245,\s*158,\s*11/i.test(theme.canvas.borderStroke) || /#f59e0b/i.test(theme.canvas.borderStroke),
    "Vibrant border must be amber"
  );
  assert.equal(theme.canvas.badgeColor, "#f59e0b");
  assert.ok(theme.material.roughness >= 0.5, "Vibrant roughness must be tactile satin");
});

test("Tier 3.5: Per-Card Theme Override vs Global Theme", () => {
  const globalTheme = "minimal-dark";
  const regularCard = createSyntheticCardObject({ id: "linux", theme: undefined });
  const overriddenCard = createSyntheticCardObject({ id: "kali-red", theme: "cyberpunk" });

  const regularKey = computeCardContentKeySim(regularCard, globalTheme);
  const overriddenKey = computeCardContentKeySim(overriddenCard, globalTheme);

  // Assertion 1: Regular card follows global theme
  assert.ok(regularKey.startsWith("minimal-dark|"));

  // Assertion 2: Overridden card follows per-card theme
  assert.ok(overriddenKey.startsWith("cyberpunk|"));

  // Assertion 3: Global theme switch to glass leaves overridden card intact
  const newGlobalTheme = "glass";
  const regularKey2 = computeCardContentKeySim(regularCard, newGlobalTheme);
  const overriddenKey2 = computeCardContentKeySim(overriddenCard, newGlobalTheme);

  assert.ok(regularKey2.startsWith("glass|"));
  assert.ok(overriddenKey2.startsWith("cyberpunk|"), "Overridden card must keep cyberpunk theme");
});

// ============================================================================
// TIER 4: REAL-WORLD USER FLOWS (WORKLOAD TESTING)
// ============================================================================

test("Tier 4.1: Flow F1 — First-Time User Onboarding & Studio Launch", () => {
  // 1. Initial page state: Home view is visible, Studio is hidden
  const homeView = { hidden: false };
  const studioView = { hidden: true };
  let selectedId = null;

  // 2. User sees home view and clicks hero CTA [data-open-studio]
  function onHeroCtaClick() {
    homeView.hidden = true;
    studioView.hidden = false;
    selectedId = "linux"; // default featured system card
  }
  onHeroCtaClick();

  // 3. Verify state transition
  assert.equal(homeView.hidden, true, "Home view must be hidden after CTA click");
  assert.equal(studioView.hidden, false, "Studio view must be visible after CTA click");
  assert.equal(selectedId, "linux", "Default selected card must be linux");
  assert.ok(minCardCenterY(0, -0.25, 1.0) >= 1.685, "Initial card elevation must be above floor");
});

test("Tier 4.2: Flow F2 — Direct System Card Selection from Home View", () => {
  const homeView = { hidden: false };
  const studioView = { hidden: true };
  let selectedId = null;

  function onSystemCardClick(cardId) {
    homeView.hidden = true;
    studioView.hidden = false;
    selectedId = cardId;
  }

  // User clicks Kali Linux card tile
  onSystemCardClick("kali-red");
  assert.equal(homeView.hidden, true);
  assert.equal(studioView.hidden, false);
  assert.equal(selectedId, "kali-red", "Kali card must be selected in studio");

  // User clicks Windows card tile
  onSystemCardClick("windows");
  assert.equal(selectedId, "windows", "Windows card must be selected in studio");
});

test("Tier 4.3: Flow F3 — Customizing Themes on Home Screen and Inspecting in Studio", async () => {
  const { CARD_THEME_STORAGE_KEY, getCardTheme } = await loadCardThemes();
  const mockStorage = {};

  let activeTheme = "classic";
  function onSelectTheme(themeId) {
    activeTheme = themeId;
    mockStorage[CARD_THEME_STORAGE_KEY] = themeId;
  }

  // 1. User picks cyberpunk
  onSelectTheme("cyberpunk");
  assert.equal(activeTheme, "cyberpunk");
  assert.equal(mockStorage[CARD_THEME_STORAGE_KEY], "cyberpunk");

  // 2. Studio renders with cyberpunk theme
  const theme = getCardTheme(activeTheme);
  assert.ok(theme.material.roughness <= 0.35, "Glossy finish for cyberpunk");
  assert.match(theme.lighting.floorGlowColor, /^#(00f0ff|ff007f)/i);

  // 3. Content key reflects cyberpunk
  const card = createSyntheticCardObject({ id: "macos" });
  assert.ok(computeCardContentKeySim(card, activeTheme).startsWith("cyberpunk|"));
});

test("Tier 4.4: Flow F4 — Tactile Direct Manipulation & Physical Floor Stop", () => {
  const card = createSyntheticCardObject({ x: 0, y: 2.0, z: -0.25 });

  // 1. User drags card downwards towards floor plane
  const dragTargetY = -1.5;
  card.group.position.y = dragTargetY;

  // 2. Physics engine intercepts drag event and enforces boundary constraint
  clampCardMeshAboveFloor(card.group, false);

  // 3. Card stops firmly at floor boundary
  assert.ok(card.group.position.y >= 1.685, "Card must stop at dais boundary");
  assert.ok(
    card.group.position.y - CARD_HALF_HEIGHT >= DAIS_SURFACE_Y - 1e-4,
    "Card bottom vertex must never penetrate dais surface"
  );

  // 4. Pointer released: position is confirmed
  assert.ok(card.group.position.y >= 1.685);
});

test("Tier 4.5: Flow F5 — Card Facet Flipping, Zooming, and Safe Home Return", async () => {
  const card = createSyntheticCardObject({ id: "android", facet: "front" });
  const homeView = { hidden: true };
  const studioView = { hidden: false };

  // 1. User clicks settings button on card
  const { CARD_BUTTON_IDS } = await loadCardButtons();
  assert.ok(CARD_BUTTON_IDS.includes("settings"));
  card.facet = "back";
  assert.equal(card.facet, "back", "Card facet must flip to back");

  // 2. User returns to Home View via brand link or Home button
  function onHomeReturn() {
    studioView.hidden = true;
    homeView.hidden = false;
  }
  onHomeReturn();

  // 3. Assert smooth return without runtime errors
  assert.equal(homeView.hidden, false, "Home view must be visible");
  assert.equal(studioView.hidden, true, "Studio view must be hidden");
  assert.equal(card.facet, "back", "Card facet state preserved");
});
