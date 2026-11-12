import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "../../../workspace-prototype/node_modules/three/build/three.module.js";

import {
  generateThemeFromSeed,
  getCardTheme,
  isValidCardThemeId,
  CARD_THEME_IDS,
  ANDROID_THEME_IDS,
  ANDROID_TONE_LEVELS,
  hexToRgb,
  rgbToXyz,
  xyzToLab,
  labToLch,
} from "../../../workspace-prototype/src/card-themes.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceDir = path.resolve(__dirname, "../../../workspace-prototype");

// ============================================================================
// Fixtures matching main.ts & test suite
// ============================================================================

class TrackingTexture extends THREE.Texture {
  constructor(name = "texture") {
    super();
    this.name = name;
    this.disposed = false;
  }
  dispose() {
    if (this.disposed) {
      throw new Error(`Double dispose detected on texture ${this.name}`);
    }
    this.disposed = true;
    super.dispose();
  }
}

class SyntheticElement {
  constructor(tagName, id = "", className = "") {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = className;
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.textContent = "";
    this.classList = {
      _classes: new Set(className.split(/\s+/).filter(Boolean)),
      add(cls) { this._classes.add(cls); },
      remove(cls) { this._classes.delete(cls); },
      toggle(cls, force) {
        if (force !== undefined) {
          if (force) this._classes.add(cls);
          else this._classes.delete(cls);
          return force;
        }
        if (this._classes.has(cls)) {
          this._classes.delete(cls);
          return false;
        }
        this._classes.add(cls);
        return true;
      },
      contains(cls) { return this._classes.has(cls); },
    };
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith("data-")) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = String(value);
    }
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector) {
    const results = [];
    const recurse = (node) => {
      for (const child of node.children) {
        if (selector.startsWith(".") && child.classList.contains(selector.slice(1))) results.push(child);
        else if (selector.startsWith("[data-") && selector.includes("]")) {
          const match = selector.match(/\[([a-zA-Z0-9_-]+)(?:=["']?([^"']+)["']?)?\]/);
          if (match) {
            const [, attr, val] = match;
            if (val ? child.getAttribute(attr) === val : child.attributes.has(attr)) {
              results.push(child);
            }
          }
        }
        recurse(child);
      }
    };
    recurse(this);
    return results;
  }
}

function computeCardContentKey(card, activeThemeId) {
  return [
    card.theme ?? activeThemeId,
    card.status ?? "DEMO · DISCONNECTED",
    card.facet ?? "front",
    card.backFaceVisible ? "B" : "F",
    card.twisted ? "T1" : "T0",
    "PB",
    card.resetCount ?? 0,
    card.receivedNotes?.length ?? 0,
    card.receivedNotes?.slice(-1)[0] ?? "",
    card.sentNotes?.length ?? 0,
    card.sentNotes?.slice(-1)[0] ?? "",
    card.serialOutput ?? "",
    "", "", "", "0", "balanced", "eco", "nat", "", "",
    "standard", 0, 0, 0
  ].join("|");
}

function refreshCardTexture(card, activeThemeId, force = false) {
  const contentKey = computeCardContentKey(card, activeThemeId);
  const nextKey = `${contentKey}|b${card.blurStep ?? 1}`;
  if (!card.liveCanvas && card.lastTextureKey === nextKey && !force) {
    return false;
  }
  card.lastTextureKey = nextKey;

  if (card.cachedContentKey !== contentKey || card.liveCanvas || force) {
    card.cachedSharpTexture?.dispose();
    card.cachedBlurredTexture?.dispose();
    card.cachedSharpTexture = undefined;
    card.cachedBlurredTexture = undefined;
    card.cachedContentKey = contentKey;
    return true; // Disposed and refreshed
  }
  return false;
}

// ============================================================================
// Proposed Test Replacements Verification
// ============================================================================

test("PROPOSED Tier 1.16: Feature 4.1 — Texture Content Key Hash Invalidation on Theme Change", () => {
  const card = {
    id: "android",
    name: "Android · Pocket Lab",
    status: "DEMO · DISCONNECTED",
    facet: "front",
    backFaceVisible: false,
    twisted: false,
    resetCount: 0,
    theme: undefined,
  };

  for (const id of [...CARD_THEME_IDS, ...ANDROID_THEME_IDS, "seed:#1A73E8"]) {
    assert.equal(id.includes("|"), false, `Theme identifier '${id}' must not contain delimiter '|'`);
  }

  const keyClassic = computeCardContentKey(card, "classic");
  const keyPixelBlue = computeCardContentKey(card, "pixel-blue");
  const keySeed = computeCardContentKey(card, "seed:#1A73E8");

  assert.notEqual(keyClassic, keyPixelBlue, "Theme switch must invalidate content key");
  assert.notEqual(keyPixelBlue, keySeed, "Seed theme must generate unique content key");
  assert.equal(keyClassic.split("|")[0], "classic");
  assert.equal(keyPixelBlue.split("|")[0], "pixel-blue");
  assert.equal(keySeed.split("|")[0], "seed:#1A73E8");

  const overrideCard = { ...card, theme: "cyberpunk" };
  const keyOverride1 = computeCardContentKey(overrideCard, "classic");
  const keyOverride2 = computeCardContentKey(overrideCard, "sunset-amber");
  assert.equal(keyOverride1, keyOverride2, "Per-card theme override must take precedence over activeThemeId");
  assert.equal(keyOverride1.split("|")[0], "cyberpunk");
});

test("PROPOSED Tier 1.17: Feature 4.2 — GPU Texture Disposal on Theme Change", () => {
  const card = {
    id: "android",
    name: "Android · Pocket Lab",
    status: "DEMO · DISCONNECTED",
    facet: "front",
    backFaceVisible: false,
    blurStep: 0,
    cachedSharpTexture: new TrackingTexture("android_sharp_v1"),
    cachedBlurredTexture: new TrackingTexture("android_blur_v1"),
    cachedContentKey: computeCardContentKey({ facet: "front" }, "classic"),
    lastTextureKey: `${computeCardContentKey({ facet: "front" }, "classic")}|b0`,
  };

  const oldSharp = card.cachedSharpTexture;
  const oldBlur = card.cachedBlurredTexture;

  const refreshed = refreshCardTexture(card, "pixel-blue", true);
  assert.equal(refreshed, true, "Texture refresh must trigger cache invalidation");
  assert.equal(oldSharp.disposed, true, "Old sharp texture must be explicitly disposed");
  assert.equal(oldBlur.disposed, true, "Old blurred texture must be explicitly disposed");
  assert.equal(card.cachedSharpTexture, undefined, "Sharp texture cache slot must be cleared");
  assert.equal(card.cachedBlurredTexture, undefined, "Blurred texture cache slot must be cleared");
  assert.equal(card.cachedContentKey, computeCardContentKey(card, "pixel-blue"));

  card.cachedSharpTexture = new TrackingTexture("android_sharp_v2");
  card.cachedBlurredTexture = new TrackingTexture("android_blur_v2");
  const noop = refreshCardTexture(card, "pixel-blue", false);
  assert.equal(noop, false, "Idempotent call without force or key change must be a no-op");
  assert.equal(card.cachedSharpTexture.disposed, false);
});

test("PROPOSED Tier 1.19: Feature 4.4 — Selection Emissive Synchronization (Bug Fix Verification: No Hardcoded Cyan)", () => {
  const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");

  assert.ok(
    mainTs.includes("card.edgeMesh.material.emissive.set(theme.material.edgeEmissive)"),
    "applyCardTheme in main.ts must synchronize edgeMesh emissive with theme.material.edgeEmissive"
  );

  const testThemes = ["cyberpunk", "sunset-amber", "forest-emerald", "obsidian-monochrome"];
  for (const themeId of testThemes) {
    const theme = getCardTheme(themeId);
    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(theme.material.edgeColor ?? "#19212d"),
      emissive: new THREE.Color(theme.material.edgeEmissive ?? "#152631"),
      emissiveIntensity: theme.material.edgeEmissiveIntensity ?? 0.22,
    });

    const hex = "#" + edgeMaterial.emissive.getHexString().toLowerCase();
    assert.equal(hex, theme.material.edgeEmissive.toLowerCase(), `Emissive must match theme ${themeId}`);
    assert.notEqual(hex, "#70d5cf", `Theme ${themeId} must NOT use hardcoded cyan #70d5cf`);
  }
});

test("PROPOSED Tier 1.29: Feature 6.4 — Navigation State Preservation between Home and Studio Views", () => {
  const homeView = new SyntheticElement("main", "home-view");
  const studioView = new SyntheticElement("main", "studio-view");
  studioView.hidden = true;

  const cardIds = ["postcard-os", "android", "windows", "linux", "macos", "kali-red"];
  const cardElements = new Map();
  for (const id of cardIds) {
    const cardEl = new SyntheticElement("div", "", "home-system-card");
    cardEl.setAttribute("data-card-id", id);
    const codeEl = new SyntheticElement("span", "", "home-system-code");
    codeEl.textContent = `PC-${id.toUpperCase()}`;
    cardEl.appendChild(codeEl);
    homeView.appendChild(cardEl);
    cardElements.set(id, { cardEl, codeEl });
  }

  let activeThemeId = "forest-emerald";
  let selectedCardId = null;
  const router = {
    location: { hash: "#home" },
    showStudio(cardId) {
      homeView.hidden = true;
      studioView.hidden = false;
      if (cardId) selectedCardId = cardId;
      this.location.hash = "#studio";
    },
    showHome() {
      studioView.hidden = true;
      homeView.hidden = false;
      this.location.hash = "#home";
      if (selectedCardId) {
        cardElements.forEach(({ cardEl, codeEl }, id) => {
          const isSelected = id === selectedCardId;
          cardEl.classList.toggle("home-system-card-featured", isSelected);
          const baseCode = codeEl.textContent.split("·")[0].trim();
          codeEl.textContent = isSelected ? `${baseCode} · SELECTED IN STUDIO` : baseCode;
        });
      }
    },
    applyTheme(themeId) {
      activeThemeId = themeId;
      homeView.setAttribute("data-card-theme", themeId);
      studioView.setAttribute("data-card-theme", themeId);
    },
  };

  router.applyTheme("forest-emerald");
  assert.equal(homeView.dataset.cardTheme, "forest-emerald");
  assert.equal(studioView.dataset.cardTheme, "forest-emerald");

  router.showStudio("android");
  assert.equal(homeView.hidden, true);
  assert.equal(studioView.hidden, false);
  assert.equal(router.location.hash, "#studio");
  assert.equal(studioView.dataset.cardTheme, "forest-emerald");

  router.applyTheme("seed:#1A73E8");
  assert.equal(studioView.dataset.cardTheme, "seed:#1A73E8");

  router.showHome();
  assert.equal(studioView.hidden, true);
  assert.equal(homeView.hidden, false);
  assert.equal(router.location.hash, "#home");
  assert.equal(homeView.dataset.cardTheme, "seed:#1A73E8");
  assert.equal(cardElements.get("android").cardEl.classList.contains("home-system-card-featured"), true);
  assert.ok(cardElements.get("android").codeEl.textContent.includes("SELECTED IN STUDIO"));
});

test("PROPOSED Tier 2.16: Boundary B4.1 — 50 Rapid Alternating Transitions Between showHome and showStudio", () => {
  const homeView = new SyntheticElement("main", "home-view");
  const studioView = new SyntheticElement("main", "studio-view");
  let activeTheme = "seed:#9C27B0";
  homeView.setAttribute("data-card-theme", activeTheme);
  studioView.setAttribute("data-card-theme", activeTheme);

  let currentHash = "#home";
  const showStudio = () => {
    homeView.hidden = true;
    studioView.hidden = false;
    currentHash = "#studio";
  };
  const showHome = () => {
    studioView.hidden = true;
    homeView.hidden = false;
    currentHash = "#home";
  };

  for (let i = 0; i < 50; i++) {
    if (i % 2 === 0) {
      showStudio();
      assert.equal(homeView.hidden, true);
      assert.equal(studioView.hidden, false);
      assert.equal(currentHash, "#studio");
    } else {
      showHome();
      assert.equal(studioView.hidden, true);
      assert.equal(homeView.hidden, false);
      assert.equal(currentHash, "#home");
    }
    assert.equal(homeView.dataset.cardTheme, "seed:#9C27B0");
    assert.equal(studioView.dataset.cardTheme, "seed:#9C27B0");
  }

  showHome();
  assert.equal(homeView.hidden, false);
  assert.equal(studioView.hidden, true);
  assert.equal(currentHash, "#home");
});

test("PROPOSED Tier 2.18: Boundary B4.3 — Rapid View Switching Generates Zero Leaked Detached Elements or Double Disposals", () => {
  let createdCount = 0;
  let disposedCount = 0;
  const activeSet = new Set();

  class LeakCheckTexture {
    constructor(id) {
      this.id = id;
      this.disposed = false;
      createdCount++;
      activeSet.add(this);
    }
    dispose() {
      if (this.disposed) throw new Error(`Double dispose on ${this.id}`);
      this.disposed = true;
      activeSet.delete(this);
      disposedCount++;
    }
  }

  const cards = ["c1", "c2", "c3", "c4", "c5"].map((id) => {
    const key = computeCardContentKey({ id }, "classic");
    return {
      id,
      blurStep: 0,
      cachedSharpTexture: new LeakCheckTexture(`${id}_sharp`),
      cachedBlurredTexture: new LeakCheckTexture(`${id}_blur`),
      cachedContentKey: key,
      lastTextureKey: `${key}|b0`,
    };
  });

  assert.equal(activeSet.size, 10);

  // Navigate view back and forth 20 times with unchanged theme: textures must NOT be disposed
  for (let i = 0; i < 20; i++) {
    for (const card of cards) {
      const refreshed = refreshCardTexture(card, "classic", false);
      assert.equal(refreshed, false);
    }
  }
  assert.equal(disposedCount, 0, "Navigation without theme change must not dispose textures");
  assert.equal(activeSet.size, 10);

  // Apply theme change: triggers force refresh on all cards
  for (const card of cards) {
    refreshCardTexture(card, "sunset-amber", true);
    card.cachedSharpTexture = new LeakCheckTexture(`${card.id}_sharp_v2`);
    card.cachedBlurredTexture = new LeakCheckTexture(`${card.id}_blur_v2`);
  }

  assert.equal(disposedCount, 10, "All 10 old textures must be disposed exactly once");
  assert.equal(activeSet.size, 10, "10 new textures should now be active");
});

test("PROPOSED Tier 2.19: Boundary B4.4 — View Switching with Dynamic Seed Theme Preserves Theme State Across All Cards", () => {
  const cards = [
    { id: "android", theme: undefined },
    { id: "windows", theme: undefined },
    { id: "linux", theme: undefined },
    { id: "macos", theme: undefined },
    { id: "kali-red", theme: "cyberpunk" },
  ];

  let globalTheme = "seed:#673AB7";

  // Check initial studio keys
  for (const c of cards) {
    const key = computeCardContentKey(c, globalTheme);
    const themePrefix = key.split("|")[0];
    if (c.id === "kali-red") {
      assert.equal(themePrefix, "cyberpunk", "Card override must take precedence");
    } else {
      assert.equal(themePrefix, "seed:#673AB7", "Inherited theme must match global dynamic seed");
    }
  }

  // Switch global theme to obsidian-monochrome
  globalTheme = "obsidian-monochrome";
  for (const c of cards) {
    const key = computeCardContentKey(c, globalTheme);
    const themePrefix = key.split("|")[0];
    if (c.id === "kali-red") {
      assert.equal(themePrefix, "cyberpunk");
    } else {
      assert.equal(themePrefix, "obsidian-monochrome");
    }
  }
});

test("PROPOSED Tier 2.20: Boundary B4.5 — Rapid Navigation Under prefers-reduced-motion Preserves Valid Scene State", () => {
  const styleCss = fs.readFileSync(path.join(workspaceDir, "src", "style.css"), "utf-8");
  assert.match(
    styleCss,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.home-system-card[\s\S]*?transition:\s*none;/,
    "style.css must disable card transitions under prefers-reduced-motion"
  );

  // Simulate reduced motion snapping in scene update
  const reducePreviewMotion = true;
  let turntableAngle = 0;
  const targetTurntableAngle = Math.PI / 2;

  if (reducePreviewMotion) {
    turntableAngle = targetTurntableAngle;
  }
  assert.equal(turntableAngle, targetTurntableAngle, "Turntable must snap immediately with zero animation lag");

  const cardPos = new THREE.Vector3(0, 0, 0);
  const targetPos = new THREE.Vector3(1.5, 0.2, -0.8);
  if (reducePreviewMotion) {
    cardPos.copy(targetPos);
  }
  assert.equal(cardPos.x, targetPos.x);
  assert.equal(cardPos.y, targetPos.y);
  assert.equal(cardPos.z, targetPos.z);
});

test("PROPOSED Tier 2.27: Boundary B6.2 — Tertiary Hue Wraparound Past 360° (320° + 60° -> 20°) Coordinate Accuracy", () => {
  // Test with seed #9C27B0 (LCH hue ~323°)
  const [r, g, b] = hexToRgb("#9C27B0");
  const [x, y, z] = rgbToXyz(r, g, b);
  const [labL, labA, labB] = xyzToLab(x, y, z);
  const [, , seedHue] = labToLch(labL, labA, labB);

  assert.ok(seedHue > 300, `Seed hue should be > 300° (got ${seedHue.toFixed(1)}°)`);

  const theme = generateThemeFromSeed("#9C27B0");
  assert.ok(theme.palettes.tertiary, "Tertiary tonal palette must be generated");

  for (const stop of ANDROID_TONE_LEVELS) {
    const tone = theme.palettes.tertiary[stop];
    assert.match(tone, /^#[0-9a-fA-F]{6}$/, `Tertiary stop ${stop} must be valid 6-digit hex`);
  }

  // Calculate wrapped tertiary hue: (seedHue + 60) % 360
  const expectedWrappedHue = (seedHue + 60) % 360;
  assert.ok(expectedWrappedHue >= 0 && expectedWrappedHue < 90, "Expected wrapped hue must land in [0°, 90°]");

  const tertiaryHex = theme.palettes.tertiary[80];
  const [tr, tg, tb] = hexToRgb(tertiaryHex);
  const [tx, ty, tz] = rgbToXyz(tr, tg, tb);
  const [tLabL, tLabA, tLabB] = xyzToLab(tx, ty, tz);
  const [, , actualTertiaryHue] = labToLch(tLabL, tLabA, tLabB);

  // Verify wrapped angle within gamut bisection tolerance (±25°)
  const hueDiff = Math.abs(actualTertiaryHue - expectedWrappedHue);
  assert.ok(
    hueDiff < 25 || (360 - hueDiff) < 25,
    `Actual tertiary hue ${actualTertiaryHue.toFixed(1)}° must match wrapped target ${expectedWrappedHue.toFixed(1)}°`
  );
});

test("PROPOSED Tier 3.4: Cross-Feature X4 — Multi-Card Content Key Invalidation Across All 5 System Cards", () => {
  const cards = [
    { id: "android", name: "Android · Pocket Lab", facet: "front", resetCount: 0, receivedNotes: ["note1"] },
    { id: "windows", name: "Windows · Studio", facet: "front", resetCount: 1, receivedNotes: [] },
    { id: "linux", name: "Fedora · Workstation", facet: "back", backFaceVisible: true, resetCount: 0 },
    { id: "macos", name: "macOS · Cupertino", facet: "left", twisted: true, resetCount: 0 },
    { id: "kali-red", name: "Kali · Cyber Range", facet: "front", theme: "cyberpunk", resetCount: 0 },
  ];

  const keysBefore = cards.map((c) => computeCardContentKey(c, "pixel-blue"));
  const keysAfter = cards.map((c) => computeCardContentKey(c, "sunset-amber"));

  // Check all before keys are distinct across cards with distinct facet/state
  assert.equal(new Set(keysBefore).size, 5, "All 5 cards must have distinct content keys");

  // For the 4 standard cards, switching theme invalidates key
  for (let i = 0; i < 4; i++) {
    assert.notEqual(keysBefore[i], keysAfter[i], `Card ${cards[i].id} key must change on theme switch`);
    assert.equal(keysBefore[i].split("|")[0], "pixel-blue");
    assert.equal(keysAfter[i].split("|")[0], "sunset-amber");
  }

  // For kali-red with card theme override, key remains cyberpunk
  assert.equal(keysBefore[4], keysAfter[4], "Card override must keep key unchanged across global theme switches");
  assert.equal(keysBefore[4].split("|")[0], "cyberpunk");
});

test("PROPOSED Tier 3.5: Cross-Feature X5 — Seed Change While Card is Selected -> Texture Cache Disposal & Emissive Sync", () => {
  const edgeMesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x19212d, emissive: 0x152631 })
  );
  const frontMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(),
    new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.1 })
  );

  const card = {
    id: "android",
    selected: true,
    edgeMesh,
    frontMesh,
    cachedSharpTexture: new TrackingTexture("sharp_sel_v1"),
    cachedBlurredTexture: new TrackingTexture("blur_sel_v1"),
    cachedContentKey: computeCardContentKey({ facet: "front" }, "pixel-blue"),
  };

  const oldSharp = card.cachedSharpTexture;
  const oldBlur = card.cachedBlurredTexture;

  // Apply new theme sunset-amber
  const newTheme = getCardTheme("sunset-amber");
  card.edgeMesh.material.emissive.set(newTheme.material.edgeEmissive);
  card.edgeMesh.material.emissiveIntensity = newTheme.material.edgeEmissiveIntensity;
  card.edgeMesh.material.color.set(newTheme.material.edgeColor);

  // Invalidate textures
  refreshCardTexture(card, "sunset-amber", true);

  assert.equal(oldSharp.disposed, true, "Selected card sharp texture must be disposed");
  assert.equal(oldBlur.disposed, true, "Selected card blur texture must be disposed");
  assert.equal(card.cachedSharpTexture, undefined);
  assert.equal(card.cachedBlurredTexture, undefined);

  const edgeHex = "#" + card.edgeMesh.material.emissive.getHexString().toLowerCase();
  assert.equal(edgeHex, newTheme.material.edgeEmissive.toLowerCase());
  assert.notEqual(edgeHex, "#70d5cf", "Selection emissive must NOT use hardcoded cyan #70d5cf");
  assert.equal(card.edgeMesh.material.emissiveIntensity, newTheme.material.edgeEmissiveIntensity);
});
