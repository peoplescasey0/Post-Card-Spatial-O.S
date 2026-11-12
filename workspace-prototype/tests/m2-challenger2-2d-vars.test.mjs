/**
 * Challenger 2 Empirical Stress Test Harness: 2D CSS & Theme Switch Verification
 * Milestone 2: 2D & 3D Surface Integration
 *
 * Verifies:
 * 1. 2D CSS custom property injection and reactivity across canonical, Android presets, and dynamic seeds.
 * 2. Rapid sequential switching (500 iterations) without state leakage or performance degradation.
 * 3. Featured card active consumption of --card-theme-accent and lack of amber lock.
 * 4. Adversarial input validation and fallback robustness (invalid IDs, malformed seeds).
 * 5. Missing DOM element scenarios (graceful fallback without runtime errors).
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
  ALL_PRESET_THEME_IDS,
  DEFAULT_CARD_THEME_ID,
  THEME_STORAGE_KEY,
  generateThemeFromSeed,
  getCardTheme,
  isValidCardThemeId,
  persistTheme,
  loadPersistedTheme,
} from "../src/card-themes.ts";

import {
  SyntheticElement,
  MockStyleDeclaration,
  MockLocalStorage,
} from "./android-theming-integration.test.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceDir = path.resolve(__dirname, "..");
const mainTsPath = path.join(workspaceDir, "src", "main.ts");
const styleCssPath = path.join(workspaceDir, "src", "style.css");

// Read and extract exact applyCardTheme function from src/main.ts
const mainTsSource = fs.readFileSync(mainTsPath, "utf-8");
const applyCardThemeMatch = mainTsSource.match(/export function applyCardTheme\([\s\S]*?\n\}/);
assert.ok(applyCardThemeMatch, "src/main.ts must define export function applyCardTheme");

// Convert to executable JS by stripping TypeScript annotations
const applyCardThemeJs = applyCardThemeMatch[0]
  .replace("export function applyCardTheme", "function applyCardTheme")
  .replace(/\(themeId:\s*CardThemeId\):\s*void/, "(themeId)")
  .replace(/querySelectorAll<[A-Za-z0-9_]+>/g, "querySelectorAll");

/**
 * Creates an execution harness running the exact applyCardTheme code from src/main.ts
 */
function createApplyCardThemeHarness(options = {}) {
  const homeViewEl = options.homeViewEl !== undefined ? options.homeViewEl : new SyntheticElement("main", "home-view");
  const studioViewEl = options.studioViewEl !== undefined ? options.studioViewEl : new SyntheticElement("main", "studio-view");
  const themeChips = options.themeChips !== undefined ? options.themeChips : [];
  const cards = options.cards !== undefined ? options.cards : [];
  const cardHaloLight = options.cardHaloLight !== undefined ? options.cardHaloLight : null;
  const cardFloorGlow = options.cardFloorGlow !== undefined ? options.cardFloorGlow : null;
  const glowDisc = options.glowDisc !== undefined ? options.glowDisc : null;
  const refreshCardTexture = options.refreshCardTexture || (() => {});

  const doc = options.document !== undefined ? options.document : {
    getElementById(id) {
      if (id === "home-view") return homeViewEl;
      if (id === "studio-view") return studioViewEl;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-theme-id]") return themeChips;
      return [];
    },
  };

  const fnFactory = new Function(
    "isValidCardThemeId",
    "DEFAULT_CARD_THEME_ID",
    "persistTheme",
    "getCardTheme",
    "document",
    "homeViewElement",
    "studioViewElement",
    "cardHaloLight",
    "cardFloorGlow",
    "glowDisc",
    "cards",
    "refreshCardTexture",
    "THREE",
    `
    let activeCardThemeId;
    let currentCardTheme;
    ${applyCardThemeJs}
    return {
      applyCardTheme,
      getActiveCardThemeId: () => activeCardThemeId,
      getCurrentCardTheme: () => currentCardTheme,
    };
    `
  );

  return {
    harness: fnFactory(
      isValidCardThemeId,
      DEFAULT_CARD_THEME_ID,
      persistTheme,
      getCardTheme,
      doc,
      homeViewEl,
      studioViewEl,
      cardHaloLight,
      cardFloorGlow,
      glowDisc,
      cards,
      refreshCardTexture,
      THREE
    ),
    homeViewEl,
    studioViewEl,
    themeChips,
    doc,
  };
}

const REQUIRED_2D_VARS = [
  "--card-theme-bg",
  "--card-theme-border",
  "--card-theme-accent",
  "--card-theme-glow",
  "--card-theme-corner",
  "--card-theme-on-surface",
  "--card-theme-on-surface-variant",
];

// ============================================================================
// SUITE 1: 2D CSS Property Injection across All Theme Categories
// ============================================================================

test("Challenger 2 — 2D CSS: All 5 Canonical themes inject all 7 custom properties onto #home-view.style", () => {
  const { harness, homeViewEl, studioViewEl } = createApplyCardThemeHarness();

  for (const themeId of CARD_THEME_IDS) {
    harness.applyCardTheme(themeId);

    assert.equal(homeViewEl.dataset.cardTheme, themeId, `homeView dataset must be ${themeId}`);
    assert.equal(studioViewEl.dataset.cardTheme, themeId, `studioView dataset must be ${themeId}`);

    const expectedTheme = getCardTheme(themeId);

    // Verify all 7 required CSS custom properties are set and non-empty
    for (const varName of REQUIRED_2D_VARS) {
      const val = homeViewEl.style.getPropertyValue(varName);
      assert.ok(val && val.trim().length > 0, `Property ${varName} must be defined for canonical theme ${themeId}`);
    }

    // Verify exact values match theme specification
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-bg"),
      expectedTheme.homeCss.cardBg,
      `--card-theme-bg mismatch on ${themeId}`
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-border"),
      expectedTheme.homeCss.cardBorder,
      `--card-theme-border mismatch on ${themeId}`
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-accent"),
      expectedTheme.homeCss.cardAccent,
      `--card-theme-accent mismatch on ${themeId}`
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-glow"),
      expectedTheme.homeCss.cardGlow,
      `--card-theme-glow mismatch on ${themeId}`
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-corner"),
      expectedTheme.canvas.borderStroke,
      `--card-theme-corner mismatch on ${themeId}`
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-on-surface"),
      expectedTheme.canvas.titleColor,
      `--card-theme-on-surface mismatch on ${themeId}`
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-on-surface-variant"),
      expectedTheme.canvas.detailColor,
      `--card-theme-on-surface-variant mismatch on ${themeId}`
    );
  }
});

test("Challenger 2 — 2D CSS: All 5 Android presets inject all 7 custom properties onto #home-view.style", () => {
  const { harness, homeViewEl, studioViewEl } = createApplyCardThemeHarness();

  for (const themeId of ANDROID_THEME_IDS) {
    harness.applyCardTheme(themeId);

    assert.equal(homeViewEl.dataset.cardTheme, themeId, `homeView dataset must be ${themeId}`);
    assert.equal(studioViewEl.dataset.cardTheme, themeId, `studioView dataset must be ${themeId}`);

    const expectedTheme = getCardTheme(themeId);

    for (const varName of REQUIRED_2D_VARS) {
      const val = homeViewEl.style.getPropertyValue(varName);
      assert.ok(val && val.trim().length > 0, `Property ${varName} must be defined for Android preset ${themeId}`);
    }

    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-bg"),
      expectedTheme.homeCss.cardBg
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-border"),
      expectedTheme.homeCss.cardBorder
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-accent"),
      expectedTheme.homeCss.cardAccent
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-glow"),
      expectedTheme.homeCss.cardGlow
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-corner"),
      expectedTheme.canvas.borderStroke
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-on-surface"),
      expectedTheme.canvas.titleColor
    );
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-on-surface-variant"),
      expectedTheme.canvas.detailColor
    );
  }
});

test("Challenger 2 — 2D CSS: Dynamic seed colors (seed:#FF0000, seed:#4285F4, seed:#6750A4) inject all 7 properties", () => {
  const { harness, homeViewEl, studioViewEl } = createApplyCardThemeHarness();

  const testSeeds = [
    "seed:#FF0000", // Vibrant Red
    "seed:#4285F4", // Google Blue
    "seed:#6750A4", // Material You Purple
    "seed:#00FF00", // Pure Green
    "seed:#FFFF00", // Pure Yellow
    "seed:#000000", // Optical Black
    "seed:#FFFFFF", // Optical White
  ];

  for (const seedId of testSeeds) {
    harness.applyCardTheme(seedId);

    assert.equal(homeViewEl.dataset.cardTheme, seedId, `homeView dataset must match seedId ${seedId}`);
    assert.equal(studioViewEl.dataset.cardTheme, seedId, `studioView dataset must match seedId ${seedId}`);

    const expectedTheme = getCardTheme(seedId);

    for (const varName of REQUIRED_2D_VARS) {
      const val = homeViewEl.style.getPropertyValue(varName);
      assert.ok(val && val.trim().length > 0, `Property ${varName} must be defined for dynamic seed ${seedId}`);
    }

    assert.equal(homeViewEl.style.getPropertyValue("--card-theme-bg"), expectedTheme.homeCss.cardBg);
    assert.equal(homeViewEl.style.getPropertyValue("--card-theme-border"), expectedTheme.homeCss.cardBorder);
    assert.equal(homeViewEl.style.getPropertyValue("--card-theme-accent"), expectedTheme.homeCss.cardAccent);
    assert.equal(homeViewEl.style.getPropertyValue("--card-theme-glow"), expectedTheme.homeCss.cardGlow);
    assert.equal(homeViewEl.style.getPropertyValue("--card-theme-corner"), expectedTheme.canvas.borderStroke);
    assert.equal(homeViewEl.style.getPropertyValue("--card-theme-on-surface"), expectedTheme.canvas.titleColor);
    assert.equal(homeViewEl.style.getPropertyValue("--card-theme-on-surface-variant"), expectedTheme.canvas.detailColor);
  }
});

// ============================================================================
// SUITE 2: Rapid Sequential Theme Switching (Stress Invariant)
// ============================================================================

test("Challenger 2 — Stress Test: 500 rapid sequential theme switches maintain state purity and zero leakage", () => {
  const { harness, homeViewEl } = createApplyCardThemeHarness();

  const allThemesPool = [
    ...CARD_THEME_IDS,
    ...ANDROID_THEME_IDS,
    "seed:#FF0000",
    "seed:#4285F4",
    "seed:#6750A4",
    "seed:#00FF00",
    "seed:#FFB81C",
  ];

  const startTime = Date.now();

  for (let i = 0; i < 500; i++) {
    const targetId = allThemesPool[i % allThemesPool.length];
    harness.applyCardTheme(targetId);

    const activeId = harness.getActiveCardThemeId();
    assert.equal(activeId, targetId, `Switch ${i}: active theme must equal target`);
    assert.equal(homeViewEl.dataset.cardTheme, targetId, `Switch ${i}: homeView dataset must equal target`);

    const expectedTheme = getCardTheme(targetId);

    // Verify --card-theme-accent immediately reflects target theme and does not retain old value
    const actualAccent = homeViewEl.style.getPropertyValue("--card-theme-accent");
    assert.equal(actualAccent, expectedTheme.homeCss.cardAccent, `Switch ${i}: accent mismatch`);

    // Verify all 7 properties are valid non-empty strings
    for (const varName of REQUIRED_2D_VARS) {
      const val = homeViewEl.style.getPropertyValue(varName);
      assert.ok(val && !val.includes("undefined") && !val.includes("NaN"), `Switch ${i}: ${varName} corrupt: "${val}"`);
    }
  }

  const durationMs = Date.now() - startTime;
  assert.ok(durationMs < 2000, `500 rapid theme switches took ${durationMs}ms (must be < 2000ms)`);
});

// ============================================================================
// SUITE 3: Featured Card Active Consumption & Amber Lock Verification
// ============================================================================

test("Challenger 2 — CSS Consumption: style.css refactored to consume --card-theme-accent and border", () => {
  assert.ok(fs.existsSync(styleCssPath), "src/style.css must exist");
  const css = fs.readFileSync(styleCssPath, "utf-8");

  // Verify .home-system-card-featured rule
  const featuredMatch = css.match(/\.home-system-card-featured\s*\{([\s\S]*?)\}/);
  assert.ok(featuredMatch, ".home-system-card-featured rule must exist in style.css");
  const featuredBody = featuredMatch[1];

  assert.ok(
    featuredBody.includes("var(--card-theme-accent"),
    ".home-system-card-featured must consume var(--card-theme-accent)"
  );
  assert.ok(
    featuredBody.includes("var(--card-theme-border"),
    ".home-system-card-featured must consume var(--card-theme-border)"
  );
  assert.ok(
    featuredBody.includes("var(--card-theme-bg"),
    ".home-system-card-featured must consume var(--card-theme-bg)"
  );
  assert.ok(
    featuredBody.includes("var(--card-theme-glow"),
    ".home-system-card-featured must consume var(--card-theme-glow)"
  );

  // Verify .home-system-card-featured::after
  const afterMatch = css.match(/\.home-system-card-featured::after\s*\{([\s\S]*?)\}/);
  assert.ok(afterMatch, ".home-system-card-featured::after must exist");
  assert.ok(
    afterMatch[1].includes("var(--card-theme-corner") || afterMatch[1].includes("var(--card-theme-accent"),
    ".home-system-card-featured::after must consume theme corner or accent"
  );

  // Verify .home-system-card-featured:hover
  const hoverMatch = css.match(/\.home-system-card-featured:hover\s*\{([\s\S]*?)\}/);
  assert.ok(hoverMatch, ".home-system-card-featured:hover must exist");
  assert.ok(
    hoverMatch[1].includes("var(--card-theme-accent"),
    ".home-system-card-featured:hover must consume var(--card-theme-accent)"
  );
});

test("Challenger 2 — Amber Lock Elimination: Featured card resolves non-amber colors for non-amber themes", () => {
  const { harness, homeViewEl } = createApplyCardThemeHarness();

  // CSS Cascade Evaluator for .home-system-card-featured
  function evaluateFeaturedCardBorderColor(homeElement) {
    // CSS rule: border-color: var(--card-theme-accent, var(--card-theme-border, rgba(255, 184, 28, 0.36)));
    const accent = homeElement.style.getPropertyValue("--card-theme-accent");
    if (accent && accent.trim().length > 0) return accent;
    const border = homeElement.style.getPropertyValue("--card-theme-border");
    if (border && border.trim().length > 0) return border;
    return "rgba(255, 184, 28, 0.36)";
  }

  const nonAmberThemes = [
    "pixel-blue",
    "cyberpunk",
    "forest-emerald",
    "lavender-mist",
    "seed:#FF0000", // Vibrant Red
    "seed:#4285F4", // Google Blue
    "seed:#6750A4", // Material Purple
  ];

  for (const themeId of nonAmberThemes) {
    harness.applyCardTheme(themeId);
    const resolvedBorder = evaluateFeaturedCardBorderColor(homeViewEl);
    const theme = getCardTheme(themeId);

    // Resolved border must strictly match the theme's accent color
    assert.equal(resolvedBorder, theme.homeCss.cardAccent, `Theme ${themeId} border must equal accent`);

    // Must NOT equal hardcoded amber
    assert.notEqual(resolvedBorder, "rgba(255, 184, 28, 0.36)", `Theme ${themeId} must not lock to fallback amber`);
    assert.notEqual(resolvedBorder.toLowerCase(), "#ffb81c", `Theme ${themeId} must not equal #FFB81C`);
  }

  // Verify fallback when no CSS variables are set
  const cleanHomeEl = new SyntheticElement("main", "home-view");
  const fallbackBorder = evaluateFeaturedCardBorderColor(cleanHomeEl);
  assert.equal(fallbackBorder, "rgba(255, 184, 28, 0.36)", "Unset style must cleanly fall back to amber default");
});

// ============================================================================
// SUITE 4: Adversarial Input Robustness & Fallback
// ============================================================================

test("Challenger 2 — Adversarial Inputs: Invalid theme IDs gracefully fall back to classic default without throwing", () => {
  const { harness, homeViewEl, studioViewEl } = createApplyCardThemeHarness();

  const adversarialInvalidInputs = [
    "",
    "   ",
    "non-existent-theme-id",
    "cyberpunk-2077",
    "android", // Valid card ID, but invalid theme ID!
    "null",
    "undefined",
    "__proto__",
    "constructor",
    null,
    undefined,
    12345,
    true,
    false,
    {},
    [],
  ];

  for (const invalidInput of adversarialInvalidInputs) {
    assert.doesNotThrow(() => {
      harness.applyCardTheme(invalidInput);
    }, `applyCardTheme must not throw on invalid input: ${JSON.stringify(invalidInput)}`);

    // Invariant: Must safely fall back to DEFAULT_CARD_THEME_ID ("classic")
    assert.equal(
      harness.getActiveCardThemeId(),
      DEFAULT_CARD_THEME_ID,
      `Invalid input ${JSON.stringify(invalidInput)} must fall back to ${DEFAULT_CARD_THEME_ID}`
    );
    assert.equal(homeViewEl.dataset.cardTheme, DEFAULT_CARD_THEME_ID);
    assert.equal(studioViewEl.dataset.cardTheme, DEFAULT_CARD_THEME_ID);

    const classicTheme = getCardTheme(DEFAULT_CARD_THEME_ID);
    assert.equal(
      homeViewEl.style.getPropertyValue("--card-theme-accent"),
      classicTheme.homeCss.cardAccent
    );
  }
});

test("Challenger 2 — Adversarial Inputs: Malformed seed descriptors fall back to classic default without throwing", () => {
  const { harness, homeViewEl } = createApplyCardThemeHarness();

  const malformedSeeds = [
    "seed:",
    "seed:#",
    "seed:#1",
    "seed:#12",
    "seed:#1234",
    "seed:#12345",
    "seed:#1234567",
    "seed:#GGGGGG",
    "seed:#ZZZZZZ",
    "seed:red",
    "seed:blue",
    "seed:rgb(255,0,0)",
    "seed:rgba(0,0,0,1)",
    "seed:hsl(0, 100%, 50%)",
    "seed:#123456; background: red;",
    "seed:<script>alert(1)</script>",
    "seed:../../etc/passwd",
  ];

  for (const badSeed of malformedSeeds) {
    assert.doesNotThrow(() => {
      harness.applyCardTheme(badSeed);
    }, `applyCardTheme must not throw on malformed seed: "${badSeed}"`);

    assert.equal(
      harness.getActiveCardThemeId(),
      DEFAULT_CARD_THEME_ID,
      `Malformed seed "${badSeed}" must fall back to ${DEFAULT_CARD_THEME_ID}`
    );
    assert.equal(homeViewEl.dataset.cardTheme, DEFAULT_CARD_THEME_ID);
  }
});

// ============================================================================
// SUITE 5: Missing DOM Element Scenarios
// ============================================================================

test("Challenger 2 — Missing DOM: Missing #home-view or #studio-view does not throw runtime error", () => {
  // Scenario 1: homeViewElement is null, getElementById returns null
  const harnessNoHome = createApplyCardThemeHarness({
    homeViewEl: null,
    document: {
      getElementById(id) {
        if (id === "studio-view") return new SyntheticElement("main", "studio-view");
        return null;
      },
      querySelectorAll() { return []; },
    },
  });

  assert.doesNotThrow(() => {
    harnessNoHome.harness.applyCardTheme("pixel-blue");
  }, "applyCardTheme must not throw when #home-view is missing");

  // Scenario 2: studioViewElement is null, getElementById returns null
  const harnessNoStudio = createApplyCardThemeHarness({
    studioViewEl: null,
    document: {
      getElementById(id) {
        if (id === "home-view") return new SyntheticElement("main", "home-view");
        return null;
      },
      querySelectorAll() { return []; },
    },
  });

  assert.doesNotThrow(() => {
    harnessNoStudio.harness.applyCardTheme("pixel-blue");
  }, "applyCardTheme must not throw when #studio-view is missing");

  // Scenario 3: Both elements missing
  const harnessNeither = createApplyCardThemeHarness({
    homeViewEl: null,
    studioViewEl: null,
    document: {
      getElementById() { return null; },
      querySelectorAll() { return []; },
    },
  });

  assert.doesNotThrow(() => {
    harnessNeither.harness.applyCardTheme("seed:#FF0000");
  }, "applyCardTheme must not throw when both #home-view and #studio-view are missing");
});

test("Challenger 2 — Missing DOM: targetHome without setProperty does not throw", () => {
  const defectiveElement = {
    dataset: {},
    style: {}, // No setProperty method
  };

  const defectiveHarness = createApplyCardThemeHarness({
    homeViewEl: defectiveElement,
  });

  assert.doesNotThrow(() => {
    defectiveHarness.harness.applyCardTheme("sunset-amber");
  }, "applyCardTheme must not throw if targetHome.style has no setProperty function");

  assert.equal(defectiveElement.dataset.cardTheme, "sunset-amber");
});

test("Challenger 2 — Storage Resilience: LocalStorage QuotaExceededError does not crash applyCardTheme", () => {
  const quotaStorage = new MockLocalStorage();
  quotaStorage.setItem = () => {
    throw new Error("QuotaExceededError: Storage quota exceeded");
  };

  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = quotaStorage;

  try {
    const { harness } = createApplyCardThemeHarness();
    assert.doesNotThrow(() => {
      harness.applyCardTheme("forest-emerald");
    }, "applyCardTheme must not crash when localStorage.setItem throws QuotaExceededError");

    assert.equal(harness.getActiveCardThemeId(), "forest-emerald");
  } finally {
    globalThis.localStorage = oldStorage;
  }
});
