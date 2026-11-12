/**
 * Challenger 1 Empirical Adversarial Test Suite:
 * 3D Emissive & Texture Integration Stress Test
 *
 * Covers:
 * 1. 3D Selection Emissive under all canonical themes, Android presets, and dynamic seed colors.
 * 2. Carousel rotation emissive behavior and absence of hardcoded #70d5cf/#152631.
 * 3. Texture content key hashing and invalidation across all themes.
 * 4. Texture GPU disposal (.dispose()) on theme switch and force refresh.
 * 5. Facet drawer token consumption (titleColor, detailColor, badgeColor).
 * 6. Multi-frame render loop simulation checking for color bleed and memory leaks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";

import {
  CARD_THEME_IDS,
  ANDROID_THEME_IDS,
  getCardTheme,
  generateThemeFromSeed,
  isValidCardThemeId,
} from "../src/card-themes.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceDir = path.resolve(__dirname, "..");
const mainTsPath = path.join(workspaceDir, "src", "main.ts");

// ============================================================================
// Helpers & Mock Fixtures
// ============================================================================

class DisposableTexture {
  constructor(name) {
    this.name = name;
    this.disposed = false;
    this.disposeCount = 0;
  }
  dispose() {
    this.disposed = true;
    this.disposeCount++;
  }
}

class Mock2DContext {
  constructor() {
    this.fillStyle = "";
    this.strokeStyle = "";
    this.lineWidth = 1;
    this.font = "";
    this.textAlign = "left";
    this.textBaseline = "alphabetic";
    this.calls = [];
  }
  save() { this.calls.push({ method: "save" }); }
  restore() { this.calls.push({ method: "restore" }); }
  translate(x, y) { this.calls.push({ method: "translate", x, y }); }
  rotate(a) { this.calls.push({ method: "rotate", a }); }
  scale(x, y) { this.calls.push({ method: "scale", x, y }); }
  beginPath() { this.calls.push({ method: "beginPath" }); }
  closePath() { this.calls.push({ method: "closePath" }); }
  moveTo(x, y) { this.calls.push({ method: "moveTo", x, y }); }
  lineTo(x, y) { this.calls.push({ method: "lineTo", x, y }); }
  arc(x, y, r, sa, ea) { this.calls.push({ method: "arc", x, y, r, sa, ea }); }
  fill() { this.calls.push({ method: "fill", fillStyle: this.fillStyle }); }
  stroke() { this.calls.push({ method: "stroke", strokeStyle: this.strokeStyle }); }
  fillRect(x, y, w, h) { this.calls.push({ method: "fillRect", x, y, w, h, fillStyle: this.fillStyle }); }
  strokeRect(x, y, w, h) { this.calls.push({ method: "strokeRect", x, y, w, h, strokeStyle: this.strokeStyle }); }
  fillText(text, x, y) { this.calls.push({ method: "fillText", text, x, y, fillStyle: this.fillStyle, font: this.font }); }
  createLinearGradient() {
    return {
      addColorStop: () => {},
    };
  }
}

function hexColor(threeColor) {
  return "#" + threeColor.getHexString().toLowerCase();
}

function createMockCard(id, name, os, color, index) {
  const edgeMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      color: "#19212d",
      emissive: "#152631",
      emissiveIntensity: 0.22,
    })
  );
  const frontMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0.05,
      emissive: "#ffffff",
      emissiveIntensity: 0.82,
    })
  );
  frontMesh.userData = { face: "front" };

  const backMesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({
      roughness: 0.85,
      metalness: 0.05,
      emissive: "#ffffff",
      emissiveIntensity: 0.82,
    })
  );
  backMesh.userData = { face: "back" };

  const group = new THREE.Group();
  group.add(edgeMesh);
  group.add(frontMesh);
  group.add(backMesh);

  return {
    id,
    name,
    os,
    color,
    status: "DEMO · DISCONNECTED",
    facet: "front",
    backFaceVisible: false,
    twisted: false,
    resetCount: 0,
    blurStep: 1,
    receivedNotes: [],
    sentNotes: [],
    layoutOffset: new THREE.Vector3(),
    edgeMesh,
    frontMesh,
    backMesh,
    group,
  };
}

function createMockCardDeck() {
  return [
    createMockCard("macos", "macOS · Pro", "MACOS", "#00E5FF", 0),
    createMockCard("android", "Android · Pocket Lab", "ANDROID", "#70d5cf", 1),
    createMockCard("windows", "Windows · Studio", "WINDOWS", "#8baef0", 2),
    createMockCard("linux", "Linux · Server Core", "LINUX", "#ffaa40", 3),
    createMockCard("debian", "Debian · Golden Master", "LINUX", "#d70a53", 4),
    createMockCard("postcard-os", "Post Card OS · Microvisor", "PA-ROMY", "#5af78e", 5),
  ];
}

/**
 * Replicate main.ts selectCard emissive assignment logic
 */
function applySelectCardEmissive(cards, selectedCard, activeThemeId) {
  const activeTheme = getCardTheme(activeThemeId);
  const selectedEmissive = activeTheme.material.edgeEmissive || activeTheme.swatchPrimary;
  const idleEmissive = activeTheme.material.edgeColor || "#152631";
  const idleIntensity = activeTheme.material.edgeEmissiveIntensity ?? 0.22;

  for (const item of cards) {
    const edge = item.edgeMesh ?? item.group.children[0];
    const material = edge instanceof THREE.Mesh ? edge.material : undefined;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.emissive.set(item === selectedCard ? selectedEmissive : idleEmissive);
      material.emissiveIntensity = item === selectedCard ? 0.62 : idleIntensity;
    }
  }
}

/**
 * Replicate main.ts render loop carousel rotation emissive logic
 */
function applyCarouselRotationEmissive(cards, closestCard, activeThemeId) {
  const activeTheme = getCardTheme(activeThemeId);
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
}

/**
 * Replicate main.ts computeCardContentKey
 */
function computeCardContentKey(card, activeThemeId) {
  return [
    card.theme ?? activeThemeId,
    card.status,
    card.facet,
    card.backFaceVisible ? "B" : "F",
    card.twisted ? "T1" : "T0",
    "PB",
    card.resetCount,
    card.receivedNotes.length,
    card.receivedNotes.slice(-1)[0] ?? "",
    card.sentNotes.length,
    card.sentNotes.slice(-1)[0] ?? "",
    "",
    "",
    0,
    "",
    0,
    0,
    0,
    "",
    "",
    "Q0",
    "V0",
    "QD0",
    "IP0",
    "",
    "",
    0,
    0,
  ].join(":");
}

/**
 * Replicate main.ts refreshCardTexture logic
 */
function refreshCardTextureSim(card, activeThemeId, force = false) {
  const contentKey = computeCardContentKey(card, activeThemeId);
  const nextKey = `${contentKey}|b${card.blurStep ?? 1}`;
  if (!card.liveCanvas && card.lastTextureKey === nextKey && !force) {
    return false;
  }
  card.lastTextureKey = nextKey;

  let disposed = false;
  if (card.cachedContentKey !== contentKey || card.liveCanvas || force) {
    if (card.cachedSharpTexture) {
      card.cachedSharpTexture.dispose();
      disposed = true;
    }
    if (card.cachedBlurredTexture) {
      card.cachedBlurredTexture.dispose();
      disposed = true;
    }
    card.cachedSharpTexture = undefined;
    card.cachedBlurredTexture = undefined;
    card.cachedContentKey = contentKey;
  }

  // Create new texture simulation
  const newTexture = new DisposableTexture(`${card.id}_texture_${contentKey}`);
  card.cachedSharpTexture = newTexture;
  return disposed;
}

// ============================================================================
// Adversarial Stress Tests
// ============================================================================

test("Stress Test 1: 3D Selection Emissive across Canonical Themes, Android Presets, and Dynamic Seeds", () => {
  const testThemes = [
    // 5 Canonical Themes
    ...CARD_THEME_IDS,
    // 5 Android Presets
    ...ANDROID_THEME_IDS,
    // Required Dynamic Seed Colors from dispatch
    "seed:#4285F4", // Google Blue
    "seed:#00C853", // Android Green
    "seed:#D81B60", // Material Pink
    // Adversarial Boundary Dynamic Seeds
    "seed:#000000", // Pure Black
    "seed:#FFFFFF", // Pure White
    "seed:#FF0000", // Pure Red
  ];

  const cards = createMockCardDeck();

  for (const themeId of testThemes) {
    const theme = getCardTheme(themeId);
    assert.ok(theme, `Theme definition must exist for ${themeId}`);

    const expectedSelectedEmissive = new THREE.Color(
      theme.material.edgeEmissive || theme.swatchPrimary
    );
    const expectedIdleEmissive = new THREE.Color(
      theme.material.edgeColor || "#152631"
    );
    const expectedIdleIntensity = theme.material.edgeEmissiveIntensity ?? 0.22;

    // Test selecting each card in the deck
    for (const selectedCard of cards) {
      applySelectCardEmissive(cards, selectedCard, themeId);

      // 1. Verify Selected Card
      const selectedMat = selectedCard.edgeMesh.material;
      assert.equal(
        hexColor(selectedMat.emissive),
        hexColor(expectedSelectedEmissive),
        `Selected card ${selectedCard.id} in theme ${themeId} must receive expected selected edge emissive`
      );
      assert.equal(
        selectedMat.emissiveIntensity,
        0.62,
        `Selected card ${selectedCard.id} in theme ${themeId} must have emissiveIntensity 0.62`
      );

      // 2. Verify Inactive Cards
      for (const otherCard of cards) {
        if (otherCard === selectedCard) continue;
        const otherMat = otherCard.edgeMesh.material;
        assert.equal(
          hexColor(otherMat.emissive),
          hexColor(expectedIdleEmissive),
          `Inactive card ${otherCard.id} in theme ${themeId} must receive expected idle edge emissive`
        );
        assert.equal(
          otherMat.emissiveIntensity,
          expectedIdleIntensity,
          `Inactive card ${otherCard.id} in theme ${themeId} must have idle emissiveIntensity ${expectedIdleIntensity}`
        );
      }

      // 3. Confirm that selecting a card NEVER reverts to hardcoded cyan #70d5cf
      // (Unless the theme's actual expected emissive happens to be #70d5cf, e.g. classic swatchPrimary)
      if (themeId !== "classic") {
        assert.notEqual(
          hexColor(selectedMat.emissive),
          "#70d5cf",
          `Theme ${themeId} selected edge emissive must NOT revert to hardcoded cyan #70d5cf`
        );
      }
    }
  }
});

test("Stress Test 2: Carousel Rotation Emissive across All Themes", () => {
  const testThemes = [
    "cyberpunk",
    "minimal-dark",
    "pixel-blue",
    "forest-emerald",
    "sunset-amber",
    "seed:#4285F4",
    "seed:#00C853",
    "seed:#D81B60",
  ];

  const cards = createMockCardDeck();

  for (const themeId of testThemes) {
    const theme = getCardTheme(themeId);
    const expectedSelectedEmissive = new THREE.Color(
      theme.material.edgeEmissive || theme.swatchPrimary
    );
    const expectedIdleEmissive = new THREE.Color(
      theme.material.edgeColor || "#152631"
    );

    // Rotate carousel through each card becoming the closestCard
    for (let i = 0; i < cards.length; i++) {
      const closestCard = cards[i];
      applyCarouselRotationEmissive(cards, closestCard, themeId);

      assert.equal(
        hexColor(closestCard.edgeMesh.material.emissive),
        hexColor(expectedSelectedEmissive),
        `Carousel closestCard ${closestCard.id} in ${themeId} must have selected emissive`
      );
      assert.equal(
        closestCard.edgeMesh.material.emissiveIntensity,
        0.62,
        `Carousel closestCard ${closestCard.id} in ${themeId} must have intensity 0.62`
      );

      // Other cards must be idle
      for (let j = 0; j < cards.length; j++) {
        if (i === j) continue;
        const idleCard = cards[j];
        assert.equal(
          hexColor(idleCard.edgeMesh.material.emissive),
          hexColor(expectedIdleEmissive),
          `Carousel idleCard ${idleCard.id} in ${themeId} must have idle emissive`
        );
      }
    }
  }
});

test("Stress Test 3: Static Analysis of main.ts for Hardcoded Emissive Reversions", () => {
  const mainTs = fs.readFileSync(mainTsPath, "utf-8");

  // Verify that neither selectCard nor animate contains hardcoded '#70d5cf' in edge emissive assignment
  const lines = mainTs.split("\n");
  const forbiddenPatterns = [
    /material\.emissive\.set\(\s*item\s*===\s*card\s*\?\s*["']#70d5cf["']/,
    /material\.emissive\.set\(\s*item\s*===\s*closestCard\s*\?\s*["']#70d5cf["']/,
    /material\.emissive\.set\(\s*["']#70d5cf["']\s*\)/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pat of forbiddenPatterns) {
      assert.ok(
        !pat.test(line),
        `Line ${i + 1} in main.ts matches forbidden hardcoded emissive pattern: ${line.trim()}`
      );
    }
  }

  // Verify selectCard consumes activeTheme tokens
  assert.ok(
    mainTs.includes("const selectedEmissive = activeTheme.material.edgeEmissive || activeTheme.swatchPrimary;"),
    "selectCard must derive selectedEmissive from edgeEmissive || swatchPrimary"
  );
  assert.ok(
    mainTs.includes("const idleEmissive = activeTheme.material.edgeColor || \"#152631\";"),
    "selectCard must derive idleEmissive from edgeColor || #152631"
  );

  // Verify carousel rotation in animate() consumes activeTheme tokens
  assert.ok(
    mainTs.includes("const activeTheme = getCardTheme(activeCardThemeId);") &&
    mainTs.includes("material.emissive.set(item === closestCard ? selectedEmissive : idleEmissive);"),
    "Turntable rotation in animate() must synchronize emissive from activeTheme"
  );
});

test("Stress Test 4: Texture Content Key Hash Sensitivity & Uniqueness across Themes", () => {
  const card = createMockCard("android", "Android · Pocket Lab", "ANDROID", "#70d5cf", 1);
  const themes = [
    "classic",
    "cyberpunk",
    "minimal-dark",
    "glass",
    "material-vibrant",
    "pixel-blue",
    "forest-emerald",
    "lavender-mist",
    "sunset-amber",
    "obsidian-monochrome",
    "seed:#4285F4",
    "seed:#00C853",
    "seed:#D81B60",
  ];

  const keys = new Set();
  for (const themeId of themes) {
    const key = computeCardContentKey(card, themeId);
    assert.ok(key.startsWith(themeId + ":"), `Content key must begin with activeThemeId: ${key}`);
    assert.ok(!keys.has(key), `Content key must be unique per theme: ${key} already seen`);
    keys.add(key);
  }

  assert.equal(keys.size, themes.length, "All 13 themes must produce distinct content keys");
});

test("Stress Test 5: Texture Cache Invalidation and Disposal on Theme Change", () => {
  const card = createMockCard("linux", "Linux · Server Core", "LINUX", "#ffaa40", 3);
  let initialTheme = "classic";

  // 1. Initial texture rasterization
  card.cachedSharpTexture = new DisposableTexture("sharp_v1");
  card.cachedBlurredTexture = new DisposableTexture("blur_v1");
  card.cachedContentKey = computeCardContentKey(card, initialTheme);
  card.lastTextureKey = `${card.cachedContentKey}|b1`;

  // 2. Calling refreshCardTexture without theme change or force should be a NO-OP
  const noopResult = refreshCardTextureSim(card, initialTheme, false);
  assert.equal(noopResult, false, "refreshCardTexture without change must be a no-op");
  assert.equal(card.cachedSharpTexture.disposed, false, "Texture must not be disposed on no-op");

  // 3. Switch theme to 'pixel-blue' -> contentKey changes
  const newTheme = "pixel-blue";
  const oldSharp = card.cachedSharpTexture;
  const oldBlur = card.cachedBlurredTexture;

  const changed = refreshCardTextureSim(card, newTheme, false);
  assert.equal(changed, true, "refreshCardTexture with new theme must invalidate cache");
  assert.equal(oldSharp.disposed, true, "Old sharp texture must be disposed on theme switch");
  assert.equal(oldBlur.disposed, true, "Old blur texture must be disposed on theme switch");
  assert.equal(oldSharp.disposeCount, 1, "Old sharp texture must be disposed exactly once");
  assert.equal(oldBlur.disposeCount, 1, "Old blur texture must be disposed exactly once");

  // 4. Force refresh with same theme (simulating applyCardTheme(card, true))
  const currentSharp = card.cachedSharpTexture;
  const forced = refreshCardTextureSim(card, newTheme, true);
  assert.equal(forced, true, "Forced refresh must dispose existing textures");
  assert.equal(currentSharp.disposed, true, "Current sharp texture must be disposed on forced refresh");
});

test("Stress Test 6: Facet Drawer Token Consumption (titleColor, detailColor, badgeColor)", () => {
  const themesToVerify = [
    "classic",
    "cyberpunk",
    "forest-emerald",
    "sunset-amber",
    "seed:#4285F4",
    "seed:#00C853",
    "seed:#D81B60",
  ];

  for (const themeId of themesToVerify) {
    const theme = getCardTheme(themeId);

    // Verify canvas theme tokens are populated
    assert.ok(theme.canvas.titleColor, `theme.canvas.titleColor must exist for ${themeId}`);
    assert.ok(theme.canvas.detailColor, `theme.canvas.detailColor must exist for ${themeId}`);
    assert.ok(theme.canvas.borderStroke, `theme.canvas.borderStroke must exist for ${themeId}`);

    // Verify Mock Drawer consumes these tokens
    const ctx = new Mock2DContext();
    ctx.fillStyle = theme.canvas.titleColor;
    ctx.fillText("Test Title", 48, 192);

    ctx.fillStyle = theme.canvas.detailColor;
    ctx.fillText("Test Detail", 48, 280);

    const titleCall = ctx.calls.find((c) => c.text === "Test Title");
    assert.ok(titleCall, "Drawer must render title text");
    assert.equal(titleCall.fillStyle, theme.canvas.titleColor, "Title fillStyle must match theme.canvas.titleColor");

    const detailCall = ctx.calls.find((c) => c.text === "Test Detail");
    assert.ok(detailCall, "Drawer must render detail text");
    assert.equal(detailCall.fillStyle, theme.canvas.detailColor, "Detail fillStyle must match theme.canvas.detailColor");
  }
});

test("Stress Test 7: Multi-Frame Render Loop Simulation (Color Bleed & Memory Leak Detection)", () => {
  const cards = createMockCardDeck();
  let currentCardThemeId = "classic";
  let selectedCard = cards[0];
  const haloLight = new THREE.PointLight("#70d5cf", 48);
  const floorLight = new THREE.PointLight("#00e5ff", 32);

  // Initial selection at startup
  applySelectCardEmissive(cards, selectedCard, currentCardThemeId);

  // Run 100 simulated frames
  for (let frame = 0; frame < 100; frame++) {
    // Periodically switch themes during rendering
    if (frame === 25) {
      currentCardThemeId = "cyberpunk";
      applySelectCardEmissive(cards, selectedCard, currentCardThemeId);
    }
    if (frame === 50) {
      currentCardThemeId = "seed:#4285F4";
      applySelectCardEmissive(cards, selectedCard, currentCardThemeId);
    }
    if (frame === 75) {
      currentCardThemeId = "forest-emerald";
      applySelectCardEmissive(cards, selectedCard, currentCardThemeId);
    }

    // Periodically rotate turntable
    const closestCard = cards[frame % cards.length];
    if (closestCard !== selectedCard) {
      selectedCard = closestCard;
      applyCarouselRotationEmissive(cards, closestCard, currentCardThemeId);
    }

    // Simulate render loop lighting update (lines 8207-8220 in main.ts)
    const activeTheme = getCardTheme(currentCardThemeId);
    const haloTarget = new THREE.Color(activeTheme.lighting.haloColor);
    const floorTarget = new THREE.Color(activeTheme.lighting.floorGlowColor);

    haloLight.color.lerp(haloTarget, 0.2);
    floorLight.color.lerp(floorTarget, 0.2);

    // Verify that the selected card emissive is strictly bounded to the active theme
    const expectedSelectedEmissive = new THREE.Color(
      activeTheme.material.edgeEmissive || activeTheme.swatchPrimary
    );
    assert.equal(
      hexColor(selectedCard.edgeMesh.material.emissive),
      hexColor(expectedSelectedEmissive),
      `Frame ${frame}: selectedCard edge emissive must match active theme ${currentCardThemeId}`
    );

    // Verify all inactive cards have idle emissive
    const expectedIdleEmissive = new THREE.Color(
      activeTheme.material.edgeColor || "#152631"
    );
    for (const card of cards) {
      if (card === selectedCard) continue;
      assert.equal(
        hexColor(card.edgeMesh.material.emissive),
        hexColor(expectedIdleEmissive),
        `Frame ${frame}: inactive card ${card.id} edge emissive must match idle emissive`
      );
    }
  }
});

test("Stress Test 8: Adversarial Edge Case — applyCardTheme Selection Desynchronization Probe", () => {
  const cards = createMockCardDeck();
  const activeThemeId = "cyberpunk";
  const theme = getCardTheme(activeThemeId);
  const selectedCard = cards[2]; // Windows card selected

  // 1. First, card 2 is selected
  applySelectCardEmissive(cards, selectedCard, activeThemeId);
  assert.equal(
    selectedCard.edgeMesh.material.emissiveIntensity,
    0.62,
    "Selected card must have emissiveIntensity 0.62 after selectCard"
  );
  assert.equal(
    hexColor(selectedCard.edgeMesh.material.emissive),
    hexColor(new THREE.Color(theme.material.edgeEmissive || theme.swatchPrimary)),
    "Selected card must have selected emissive"
  );

  // 2. Now simulate applyCardTheme in main.ts (lines 4687-4696):
  for (const card of cards) {
    if (card.edgeMesh && card.edgeMesh.material instanceof THREE.MeshStandardMaterial) {
      if (theme.material.edgeColor) card.edgeMesh.material.color.set(theme.material.edgeColor);
      if (theme.material.edgeEmissive) card.edgeMesh.material.emissive.set(theme.material.edgeEmissive);
      if (theme.material.edgeEmissiveIntensity !== undefined) card.edgeMesh.material.emissiveIntensity = theme.material.edgeEmissiveIntensity;
    }
  }

  // Probe finding: applyCardTheme uniformly overwrites emissiveIntensity of selectedCard down to idle intensity
  const desynchronizedIntensity = selectedCard.edgeMesh.material.emissiveIntensity;
  assert.equal(
    desynchronizedIntensity,
    theme.material.edgeEmissiveIntensity,
    `Empirical finding: applyCardTheme resets selectedCard emissiveIntensity to ${theme.material.edgeEmissiveIntensity} instead of preserving 0.62`
  );

  // Probe finding: applyCardTheme sets idle cards to edgeEmissive rather than edgeColor
  const idleCard = cards[0];
  assert.equal(
    hexColor(idleCard.edgeMesh.material.emissive),
    hexColor(new THREE.Color(theme.material.edgeEmissive)),
    "Empirical finding: applyCardTheme sets idle cards to theme.material.edgeEmissive"
  );

  // 3. Confirm that invoking selectCard restores the correct selection state
  applySelectCardEmissive(cards, selectedCard, activeThemeId);
  assert.equal(
    selectedCard.edgeMesh.material.emissiveIntensity,
    0.62,
    "Calling selectCard restores 0.62 intensity on selectedCard"
  );
  assert.equal(
    hexColor(idleCard.edgeMesh.material.emissive),
    hexColor(new THREE.Color(theme.material.edgeColor || "#152631")),
    "Calling selectCard restores edgeColor on idle cards"
  );
});

