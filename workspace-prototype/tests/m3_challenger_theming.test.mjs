import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Color validation regex: 3, 6, or 8 hex digits, or rgba(...) / rgb(...)
const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGBA_COLOR_REGEX = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)$/;

function isValidColor(c) {
  if (typeof c !== "string") return false;
  return HEX_COLOR_REGEX.test(c.trim()) || RGBA_COLOR_REGEX.test(c.trim());
}

test("CHALLENGE 1: Adversarial LocalStorage & Fallback Resilience", async () => {
  const {
    getCardTheme,
    isValidCardThemeId,
    loadPersistedTheme,
    persistTheme,
    DEFAULT_CARD_THEME_ID,
    THEME_STORAGE_KEY,
    CARD_THEMES,
  } = await import("../src/card-themes.ts");

  // A. Prototype Pollution & Malicious Payloads
  const adversarialInputs = [
    null,
    undefined,
    "",
    "   ",
    "\0",
    "\n\r\t",
    "constructor",
    "prototype",
    "__proto__",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "__defineGetter__",
    "CLASSIC", // case-sensitive check
    "Cyberpunk",
    "cyberpunk ",
    " cyberpunk",
    "classic\0extra",
    "glass|injected",
    "material-vibrant\n",
    12345,
    -1,
    0,
    NaN,
    Infinity,
    true,
    false,
    Symbol("theme"),
    BigInt(42),
    {},
    [],
    { id: "cyberpunk" },
    () => "cyberpunk",
    '{"id":"cyberpunk"}',
    '{"__proto__":{"polluted":true}}',
    '<script>alert("xss")</script>',
    "classic; DROP TABLE themes;--",
    "🔥cyberpunk🔥",
  ];

  for (const input of adversarialInputs) {
    // 1. isValidCardThemeId must return false without throwing
    let isValid = false;
    assert.doesNotThrow(() => {
      isValid = isValidCardThemeId(input);
    }, `isValidCardThemeId threw on input: ${String(input)}`);
    assert.equal(isValid, false, `isValidCardThemeId should return false for: ${String(input)}`);

    // 2. getCardTheme must return default theme object without throwing
    let themeObj;
    assert.doesNotThrow(() => {
      themeObj = getCardTheme(input);
    }, `getCardTheme threw on input: ${String(input)}`);
    assert.ok(themeObj, `getCardTheme must return a valid theme object for: ${String(input)}`);
    assert.equal(themeObj.id, DEFAULT_CARD_THEME_ID);
    assert.deepEqual(themeObj, CARD_THEMES[DEFAULT_CARD_THEME_ID]);
  }

  // Verify prototype was not polluted
  assert.equal({}.polluted, undefined, "Object.prototype must not be polluted");

  // B. Corrupted LocalStorage values
  const mockStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => mockStore.get(key) ?? null,
    setItem: (key, val) => mockStore.set(key, String(val)),
    removeItem: (key) => mockStore.delete(key),
    clear: () => mockStore.clear(),
  };

  for (const input of adversarialInputs) {
    mockStore.set(THEME_STORAGE_KEY, String(input));
    let loaded;
    assert.doesNotThrow(() => {
      loaded = loadPersistedTheme();
    });
    assert.equal(loaded, DEFAULT_CARD_THEME_ID, `Corrupt localStorage value ${String(input)} must fall back to default`);
  }

  // C. Throwing LocalStorage (e.g. SecurityError in sandboxed iframes or private browsing)
  globalThis.localStorage = {
    getItem: () => {
      throw new Error("SecurityError: Access is denied for this document");
    },
    setItem: () => {
      throw new Error("QuotaExceededError: Storage quota exceeded");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
    clear: () => {
      throw new Error("SecurityError");
    },
  };

  assert.doesNotThrow(() => {
    const fallbackTheme = loadPersistedTheme();
    assert.equal(fallbackTheme, DEFAULT_CARD_THEME_ID);
  }, "loadPersistedTheme must not throw when localStorage access is forbidden");

  assert.doesNotThrow(() => {
    persistTheme("cyberpunk");
  }, "persistTheme must not throw when localStorage.setItem throws");

  // D. Null/undefined localStorage (SSR environments)
  const origStorage = globalThis.localStorage;
  delete globalThis.localStorage;
  assert.doesNotThrow(() => {
    assert.equal(loadPersistedTheme(), DEFAULT_CARD_THEME_ID);
  });
  assert.doesNotThrow(() => {
    persistTheme("glass");
  });
  globalThis.localStorage = origStorage;
});

test("CHALLENGE 2: Strict Theme Token Ranges, PBR Physics, and Light Intensities", async () => {
  const { CARD_THEMES, CARD_THEME_IDS } = await import("../src/card-themes.ts");

  for (const id of CARD_THEME_IDS) {
    const theme = CARD_THEMES[id];
    assert.ok(theme, `Theme ${id} must exist in catalog`);

    // 1. Swatches
    assert.ok(isValidColor(theme.swatchPrimary), `${id}.swatchPrimary (${theme.swatchPrimary}) must be a valid hex or rgba color`);
    assert.ok(isValidColor(theme.swatchSecondary), `${id}.swatchSecondary (${theme.swatchSecondary}) must be a valid hex or rgba color`);

    // 2. Canvas tokens
    assert.ok(isValidColor(theme.canvas.bgTop), `${id}.canvas.bgTop must be valid color`);
    assert.ok(isValidColor(theme.canvas.bgBottom), `${id}.canvas.bgBottom must be valid color`);
    assert.ok(isValidColor(theme.canvas.borderStroke), `${id}.canvas.borderStroke must be valid color`);
    assert.ok(typeof theme.canvas.borderWidth === "number" && theme.canvas.borderWidth > 0, `${id}.canvas.borderWidth must be > 0`);
    if (theme.canvas.bgGradientStop !== undefined) {
      assert.ok(
        typeof theme.canvas.bgGradientStop === "number" &&
        theme.canvas.bgGradientStop >= 0 &&
        theme.canvas.bgGradientStop <= 1,
        `${id}.canvas.bgGradientStop must be in [0, 1]`
      );
    }
    assert.ok(isValidColor(theme.canvas.badgeColor), `${id}.canvas.badgeColor must be valid color`);
    assert.ok(isValidColor(theme.canvas.headerColor), `${id}.canvas.headerColor must be valid color`);
    assert.ok(isValidColor(theme.canvas.titleColor), `${id}.canvas.titleColor must be valid color`);
    assert.ok(isValidColor(theme.canvas.detailColor), `${id}.canvas.detailColor must be valid color`);
    assert.ok(isValidColor(theme.canvas.buttonFill), `${id}.canvas.buttonFill must be valid color`);
    assert.ok(isValidColor(theme.canvas.buttonStroke), `${id}.canvas.buttonStroke must be valid color`);
    assert.ok(isValidColor(theme.canvas.buttonText), `${id}.canvas.buttonText must be valid color`);
    assert.ok(isValidColor(theme.canvas.fastenerRim), `${id}.canvas.fastenerRim must be valid color`);
    assert.ok(isValidColor(theme.canvas.fastenerHead), `${id}.canvas.fastenerHead must be valid color`);

    // 3. PBR Material tokens (Cook-Torrance physical constraints)
    // Roughness and metalness must be strictly in [0.0, 1.0]
    assert.ok(
      typeof theme.material.roughness === "number" &&
      theme.material.roughness >= 0.0 &&
      theme.material.roughness <= 1.0,
      `${id}.material.roughness (${theme.material.roughness}) must be in [0, 1]`
    );
    assert.ok(
      typeof theme.material.metalness === "number" &&
      theme.material.metalness >= 0.0 &&
      theme.material.metalness <= 1.0,
      `${id}.material.metalness (${theme.material.metalness}) must be in [0, 1]`
    );
    assert.ok(isValidColor(theme.material.emissive), `${id}.material.emissive must be valid color`);
    assert.ok(
      typeof theme.material.emissiveIntensity === "number" &&
      theme.material.emissiveIntensity >= 0.0,
      `${id}.material.emissiveIntensity must be >= 0`
    );

    // Edge chassis PBR tokens
    if (theme.material.edgeRoughness !== undefined) {
      assert.ok(
        theme.material.edgeRoughness >= 0.0 && theme.material.edgeRoughness <= 1.0,
        `${id}.material.edgeRoughness must be in [0, 1]`
      );
    }
    if (theme.material.edgeMetalness !== undefined) {
      assert.ok(
        theme.material.edgeMetalness >= 0.0 && theme.material.edgeMetalness <= 1.0,
        `${id}.material.edgeMetalness must be in [0, 1]`
      );
    }
    if (theme.material.edgeEmissiveIntensity !== undefined) {
      assert.ok(theme.material.edgeEmissiveIntensity >= 0.0, `${id}.material.edgeEmissiveIntensity must be >= 0`);
    }
    if (theme.material.edgeColor !== undefined) {
      assert.ok(isValidColor(theme.material.edgeColor), `${id}.material.edgeColor must be valid color`);
    }
    if (theme.material.edgeEmissive !== undefined) {
      assert.ok(isValidColor(theme.material.edgeEmissive), `${id}.material.edgeEmissive must be valid color`);
    }

    // 4. Lighting tokens (Three.js PointLight intensities must be positive)
    assert.ok(isValidColor(theme.lighting.haloColor), `${id}.lighting.haloColor must be valid color`);
    assert.ok(
      typeof theme.lighting.haloIntensity === "number" && theme.lighting.haloIntensity > 0,
      `${id}.lighting.haloIntensity (${theme.lighting.haloIntensity}) must be > 0`
    );
    assert.ok(isValidColor(theme.lighting.floorGlowColor), `${id}.lighting.floorGlowColor must be valid color`);
    assert.ok(
      typeof theme.lighting.floorGlowIntensity === "number" && theme.lighting.floorGlowIntensity > 0,
      `${id}.lighting.floorGlowIntensity (${theme.lighting.floorGlowIntensity}) must be > 0`
    );
  }
});

test("CHALLENGE 3: computeCardContentKey Uniqueness Across Themes & Delimiter Integrity", async () => {
  const { CARD_THEME_IDS } = await import("../src/card-themes.ts");

  // Delimiter safety: ensure no theme ID contains the '|' delimiter used by computeCardContentKey
  for (const id of CARD_THEME_IDS) {
    assert.equal(id.includes("|"), false, `Theme ID '${id}' must not contain delimiter '|'`);
  }

  // Simulate computeCardContentKey logic from main.ts
  function simulateCardKey(card, activeThemeId) {
    return [
      card.theme ?? activeThemeId,
      card.status ?? "DEMO · DISCONNECTED",
      card.facet ?? "front",
      card.backFaceVisible ? "B" : "F",
      card.twisted ? "T1" : "T0",
      "PB",
      card.resetCount ?? 0,
      0, "", 0, "", "", "", "", "", "0", "balanced", "eco", "nat", "", "",
      "standard", 0, 0, 0
    ].join("|");
  }

  // Verify uniqueness across all 5 themes for the same card
  const baseCard = { status: "DEMO · DISCONNECTED", facet: "front", backFaceVisible: false, twisted: false, resetCount: 0 };
  const keys = new Set();
  for (const themeId of CARD_THEME_IDS) {
    const key = simulateCardKey(baseCard, themeId);
    assert.equal(keys.has(key), false, `Collision detected for theme key '${key}'`);
    keys.add(key);
  }
  assert.equal(keys.size, 5, "Must produce exactly 5 distinct content keys for the 5 themes");

  // Per-card theme override:
  // When card.theme is set to "cyberpunk", switching activeThemeId to "glass" must NOT change its key
  const overrideCard = { ...baseCard, theme: "cyberpunk" };
  const key1 = simulateCardKey(overrideCard, "classic");
  const key2 = simulateCardKey(overrideCard, "glass");
  assert.equal(key1, key2, "Per-card theme override must take precedence over activeThemeId");

  // When card.theme is undefined, switching activeThemeId MUST change the key
  const defaultCard = { ...baseCard, theme: undefined };
  const keyA = simulateCardKey(defaultCard, "classic");
  const keyB = simulateCardKey(defaultCard, "cyberpunk");
  assert.notEqual(keyA, keyB, "Switching activeThemeId must invalidate texture key for cards without explicit override");
});

test("CHALLENGE 4: Rapid Theme Cycling (100 Switches) & Texture Disposal Safety Simulation", async () => {
  const { CARD_THEME_IDS } = await import("../src/card-themes.ts");

  // Memory leak stress harness:
  // Track create and dispose calls on simulated Three.js textures
  let createdTexturesCount = 0;
  let disposedTexturesCount = 0;
  const activeTextures = new Set();

  class MockCanvasTexture {
    constructor(id) {
      this.id = id;
      this.disposed = false;
      createdTexturesCount++;
      activeTextures.add(this);
    }
    dispose() {
      if (this.disposed) {
        throw new Error(`Double dispose detected on texture ${this.id}`);
      }
      this.disposed = true;
      activeTextures.delete(this);
      disposedTexturesCount++;
    }
  }

  // Simulate card state and texture caching from main.ts
  const cards = [
    { id: "c1", status: "ready", facet: "front", blurStep: 0, cachedSharpTexture: undefined, cachedBlurredTexture: undefined, cachedContentKey: "" },
    { id: "c2", status: "ready", facet: "front", blurStep: 0, cachedSharpTexture: undefined, cachedBlurredTexture: undefined, cachedContentKey: "" },
    { id: "c3", status: "ready", facet: "front", blurStep: 0, cachedSharpTexture: undefined, cachedBlurredTexture: undefined, cachedContentKey: "" },
  ];

  let activeTheme = "classic";

  function simulateRefreshCardTexture(card, force = false) {
    const contentKey = `${card.theme ?? activeTheme}|${card.status}|${card.facet}`;
    const nextKey = `${contentKey}|b${card.blurStep}`;

    if (card.cachedContentKey !== contentKey || force) {
      card.cachedSharpTexture?.dispose();
      card.cachedBlurredTexture?.dispose();
      card.cachedSharpTexture = undefined;
      card.cachedBlurredTexture = undefined;
      card.cachedContentKey = contentKey;
    }

    if (!card.cachedSharpTexture) {
      card.cachedSharpTexture = new MockCanvasTexture(`tex_${card.id}_${contentKey}`);
    }
    card.lastTextureKey = nextKey;
  }

  function simulateApplyCardTheme(newThemeId) {
    activeTheme = newThemeId;
    for (const card of cards) {
      simulateRefreshCardTexture(card, true);
    }
  }

  // Initial draw
  for (const card of cards) {
    simulateRefreshCardTexture(card, true);
  }
  assert.equal(createdTexturesCount, 3);
  assert.equal(disposedTexturesCount, 0);
  assert.equal(activeTextures.size, 3);

  // Perform 100 rapid sequential theme switches
  for (let i = 0; i < 100; i++) {
    const nextTheme = CARD_THEME_IDS[i % CARD_THEME_IDS.length];
    simulateApplyCardTheme(nextTheme);
  }

  // Exactly 3 active textures must remain at any time (1 per card), with 0 double-disposes and no unbounded leaks
  assert.equal(activeTextures.size, 3, "Only exactly 3 active textures should remain for 3 cards");
  assert.equal(createdTexturesCount - disposedTexturesCount, 3, "Disposed count must strictly equal created count minus active count");
  assert.equal(createdTexturesCount, 3 + 100 * 3, "Total textures created must equal initial + 100 cycles * 3 cards");
  assert.equal(disposedTexturesCount, 100 * 3, "Total textures disposed must equal 100 cycles * 3 cards");
});

test("CHALLENGE 5: DOM & CSS Spec Integrity for All 5 Themes", () => {
  const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf-8");
  const css = fs.readFileSync(path.join(rootDir, "src", "style.css"), "utf-8");

  const themes = ["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"];

  for (const themeId of themes) {
    // Check that CSS selector exists for this theme
    const selector = `#home-view[data-card-theme="${themeId}"]`;
    assert.ok(css.includes(selector), `Missing CSS selector: ${selector}`);

    // Check that index.html radio chip exists for this theme
    assert.ok(
      html.includes(`data-theme-id="${themeId}"`),
      `Missing HTML radio chip with data-theme-id="${themeId}"`
    );

    // Check swatch markup
    assert.ok(
      html.includes(`theme-swatch-${themeId}`),
      `Missing swatch class theme-swatch-${themeId} in HTML`
    );
  }

  // Check that default theme button is initially marked active
  assert.ok(
    html.includes('data-theme-id="classic"') && html.includes('aria-checked="true"'),
    "Default theme 'classic' should have aria-checked='true' in index.html"
  );
});
