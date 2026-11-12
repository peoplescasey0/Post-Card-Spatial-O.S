import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

test("Card Theming: card-themes.ts exports all 5 canonical themes and required tokens", async () => {
  const themesModule = await import("../src/card-themes.ts");

  assert.ok(themesModule.CARD_THEMES, "CARD_THEMES catalog must be exported");
  assert.ok(Array.isArray(themesModule.CARD_THEME_IDS), "CARD_THEME_IDS array must be exported");
  assert.equal(themesModule.CARD_THEME_IDS.length, 5, "Must declare exactly 5 canonical theme IDs");

  const expectedIds = ["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"];
  assert.deepEqual([...themesModule.CARD_THEME_IDS].sort(), [...expectedIds].sort());

  for (const id of expectedIds) {
    const theme = themesModule.CARD_THEMES[id];
    assert.ok(theme, `Theme '${id}' must be present in CARD_THEMES`);
    assert.equal(theme.id, id);
    assert.ok(typeof theme.name === "string" && theme.name.length > 0, `${id} name required`);
    assert.ok(typeof theme.tagline === "string" && theme.tagline.length > 0, `${id} tagline required`);
    assert.ok(typeof theme.description === "string" && theme.description.length > 0, `${id} description required`);
    assert.ok(typeof theme.swatchPrimary === "string", `${id} swatchPrimary required`);
    assert.ok(typeof theme.swatchSecondary === "string", `${id} swatchSecondary required`);

    // Canvas tokens
    assert.ok(theme.canvas, `${id} canvas tokens required`);
    assert.ok(theme.canvas.bgTop, `${id} bgTop required`);
    assert.ok(theme.canvas.bgBottom, `${id} bgBottom required`);
    assert.ok(theme.canvas.borderStroke, `${id} borderStroke required`);
    assert.ok(typeof theme.canvas.borderWidth === "number", `${id} borderWidth required`);
    assert.ok(theme.canvas.badgeColor, `${id} badgeColor required`);
    assert.ok(theme.canvas.headerColor, `${id} headerColor required`);
    assert.ok(theme.canvas.titleColor, `${id} titleColor required`);
    assert.ok(theme.canvas.detailColor, `${id} detailColor required`);
    assert.ok(theme.canvas.buttonFill, `${id} buttonFill required`);
    assert.ok(theme.canvas.buttonStroke, `${id} buttonStroke required`);
    assert.ok(theme.canvas.buttonText, `${id} buttonText required`);
    assert.ok(theme.canvas.fastenerRim, `${id} fastenerRim required`);
    assert.ok(theme.canvas.fastenerHead, `${id} fastenerHead required`);

    // Material tokens
    assert.ok(theme.material, `${id} material tokens required`);
    assert.ok(typeof theme.material.roughness === "number", `${id} roughness required`);
    assert.ok(typeof theme.material.metalness === "number", `${id} metalness required`);
    assert.ok(theme.material.emissive, `${id} emissive required`);
    assert.ok(typeof theme.material.emissiveIntensity === "number", `${id} emissiveIntensity required`);
    assert.ok(theme.material.edgeColor, `${id} edgeColor required`);
    assert.ok(theme.material.edgeEmissive, `${id} edgeEmissive required`);

    // Lighting tokens
    assert.ok(theme.lighting, `${id} lighting tokens required`);
    assert.ok(theme.lighting.haloColor, `${id} haloColor required`);
    assert.ok(typeof theme.lighting.haloIntensity === "number", `${id} haloIntensity required`);
    assert.ok(theme.lighting.floorGlowColor, `${id} floorGlowColor required`);
    assert.ok(typeof theme.lighting.floorGlowIntensity === "number", `${id} floorGlowIntensity required`);

    // Home CSS tokens
    const homeCss = theme.homeCss || theme.css;
    assert.ok(homeCss, `${id} homeCss tokens required`);
    assert.ok(homeCss.cardBg, `${id} cardBg required`);
    assert.ok(homeCss.cardBorder, `${id} cardBorder required`);
    assert.ok(homeCss.cardAccent, `${id} cardAccent required`);
  }
});

test("Card Theming: getCardTheme and isValidCardThemeId validation and safe fallback", async () => {
  const { getCardTheme, isValidCardThemeId, DEFAULT_CARD_THEME_ID } = await import("../src/card-themes.ts");

  assert.equal(isValidCardThemeId("classic"), true);
  assert.equal(isValidCardThemeId("cyberpunk"), true);
  assert.equal(isValidCardThemeId("minimal-dark"), true);
  assert.equal(isValidCardThemeId("glass"), true);
  assert.equal(isValidCardThemeId("material-vibrant"), true);

  assert.equal(isValidCardThemeId("unknown-theme"), false);
  assert.equal(isValidCardThemeId(null), false);
  assert.equal(isValidCardThemeId(undefined), false);
  assert.equal(isValidCardThemeId(123), false);
  assert.equal(isValidCardThemeId({}), false);

  assert.equal(getCardTheme("cyberpunk").id, "cyberpunk");
  assert.equal(getCardTheme("cyberpunk").name, "Cyberpunk Neon");

  assert.equal(getCardTheme("non-existent-theme").id, DEFAULT_CARD_THEME_ID);
  assert.equal(getCardTheme(null).id, DEFAULT_CARD_THEME_ID);
  assert.equal(getCardTheme(undefined).id, DEFAULT_CARD_THEME_ID);
});

test("Card Theming: localStorage persistence functions with fallback safety", async () => {
  const { loadPersistedTheme, persistTheme, THEME_STORAGE_KEY, DEFAULT_CARD_THEME_ID } = await import(
    "../src/card-themes.ts"
  );

  const mockStorage = new Map();
  globalThis.localStorage = {
    getItem: (k) => mockStorage.get(k) ?? null,
    setItem: (k, v) => mockStorage.set(k, String(v)),
    removeItem: (k) => mockStorage.delete(k),
    clear: () => mockStorage.clear(),
  };

  assert.equal(loadPersistedTheme(), DEFAULT_CARD_THEME_ID);

  persistTheme("cyberpunk");
  assert.equal(mockStorage.get(THEME_STORAGE_KEY), "cyberpunk");
  assert.equal(loadPersistedTheme(), "cyberpunk");

  persistTheme("glass");
  assert.equal(mockStorage.get(THEME_STORAGE_KEY), "glass");
  assert.equal(loadPersistedTheme(), "glass");

  // Corrupted / invalid storage string falls back to default
  mockStorage.set(THEME_STORAGE_KEY, "invalid-random-theme");
  assert.equal(loadPersistedTheme(), DEFAULT_CARD_THEME_ID);
});

test("Card Theming: index.html contains .home-theme-bar and accessible theme radio chips", () => {
  const htmlPath = path.join(rootDir, "index.html");
  const html = fs.readFileSync(htmlPath, "utf-8");

  assert.ok(html.includes('class="home-theme-bar"'), "index.html must include .home-theme-bar");
  assert.ok(html.includes('data-theme-picker'), "index.html must include data-theme-picker container");
  assert.ok(html.includes('role="radiogroup"'), "index.html must include role='radiogroup'");

  const expectedChips = ["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"];
  for (const id of expectedChips) {
    assert.ok(
      html.includes(`data-theme-id="${id}"`),
      `index.html must include theme chip button with data-theme-id="${id}"`,
    );
    assert.ok(
      html.includes(`theme-swatch-${id}`),
      `index.html must include swatch element for theme '${id}'`,
    );
  }
});

test("Card Theming: style.css defines custom properties for all 5 themes and binds to .home-system-card", () => {
  const cssPath = path.join(rootDir, "src", "style.css");
  const css = fs.readFileSync(cssPath, "utf-8");

  const expectedThemes = ["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"];
  for (const id of expectedThemes) {
    assert.ok(
      css.includes(`#home-view[data-card-theme="${id}"]`),
      `style.css must have #home-view[data-card-theme="${id}"] selector`,
    );
  }

  assert.ok(css.includes("--card-theme-bg"), "style.css must define --card-theme-bg");
  assert.ok(css.includes("--card-theme-border"), "style.css must define --card-theme-border");
  assert.ok(css.includes("--card-theme-accent"), "style.css must define --card-theme-accent");
  assert.ok(css.includes("--card-theme-corner"), "style.css must define --card-theme-corner");
  assert.ok(css.includes("backdrop-filter: blur(14px)"), "glass theme must have backdrop-filter: blur(14px)");

  assert.ok(css.includes(".home-theme-bar"), "style.css must style .home-theme-bar");
  assert.ok(css.includes(".theme-chip"), "style.css must style .theme-chip");
  assert.ok(css.includes(".theme-swatch"), "style.css must style .theme-swatch");
});

test("Card Theming: main.ts integrates theme engine, cache invalidation, and Three.js lights", () => {
  const mainPath = path.join(rootDir, "src", "main.ts");
  const mainContent = fs.readFileSync(mainPath, "utf-8");

  assert.ok(
    mainContent.includes('from "./card-themes"'),
    "main.ts must import from ./card-themes",
  );
  assert.ok(
    mainContent.includes("applyCardTheme"),
    "main.ts must define or export applyCardTheme",
  );
  assert.ok(
    mainContent.includes("initCardThemePicker"),
    "main.ts must define or export initCardThemePicker",
  );
  assert.ok(
    mainContent.includes("activeCardThemeId"),
    "main.ts must track activeCardThemeId",
  );
  assert.ok(
    mainContent.includes("card.theme ?? activeCardThemeId"),
    "main.ts computeCardContentKey and makeCardTexture must incorporate card.theme ?? activeCardThemeId",
  );
  assert.ok(
    mainContent.includes("edgeMesh"),
    "main.ts must track edgeMesh on SystemCard",
  );
  assert.ok(
    mainContent.includes("frontMesh"),
    "main.ts must track frontMesh on SystemCard",
  );
  assert.ok(
    mainContent.includes("backMesh"),
    "main.ts must track backMesh on SystemCard",
  );
  assert.ok(
    mainContent.includes("haloTarget"),
    "main.ts animate loop must lerp lights to activeTheme lighting targets",
  );
});
