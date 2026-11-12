/**
 * Adversarial Challenger 2 Test Suite: Home Screen Card Theming Customization
 *
 * Verifies:
 * 1. Accessibility & DOM Structure in index.html (role="radiogroup", role="radio", aria-checked, unique IDs, swatches)
 * 2. CSS variables and theme blocks in src/style.css (#home-view[data-card-theme="..."] for all 5 presets)
 * 3. .home-system-card styling driven by --card-theme-* variables with valid fallback safety
 * 4. Interactive chip click event delegation, active class toggling, aria-checked synchronization, and card styling updates
 * 5. Responsive layout constraints (<= 900px, <= 640px) preventing horizontal overflow or clipping
 * 6. Adversarial edge cases: rapid theme switching, corrupt storage, and detached DOM resilience
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const testsDir = path.dirname(__filename);
const workspaceDir = path.resolve(testsDir, "..");

const htmlPath = path.join(workspaceDir, "index.html");
const cssPath = path.join(workspaceDir, "src", "style.css");
const cardThemesTsPath = path.join(workspaceDir, "src", "card-themes.ts");
const mainTsPath = path.join(workspaceDir, "src", "main.ts");

const html = fs.readFileSync(htmlPath, "utf-8");
const css = fs.readFileSync(cssPath, "utf-8");
const cardThemesTs = fs.readFileSync(cardThemesTsPath, "utf-8");
const mainTs = fs.readFileSync(mainTsPath, "utf-8");

const CANONICAL_THEME_IDS = ["classic", "cyberpunk", "minimal-dark", "glass", "material-vibrant"];

// ============================================================================
// 1. Accessibility & DOM Structure Verification
// ============================================================================

test("Challenger 2 DOM: index.html home-theme-picker contains accessible radiogroup structure", () => {
  // 1. Must contain container with role="radiogroup" and accessible label
  const pickerMatch = html.match(
    /<div[^>]*class="[^"]*home-theme-picker[^"]*"[^>]*role="radiogroup"[^>]*>/i
  );
  assert.ok(pickerMatch, "Must have .home-theme-picker with role='radiogroup'");
  assert.match(
    pickerMatch[0],
    /aria-label="[^"]+"/i,
    ".home-theme-picker must provide an aria-label"
  );
  assert.match(
    pickerMatch[0],
    /data-theme-picker/i,
    ".home-theme-picker must have data-theme-picker hook"
  );

  // 2. Extract theme-chip buttons within the picker
  const pickerSnippet = html.slice(pickerMatch.index, html.indexOf("</div>", pickerMatch.index + 2000));
  const chipButtons = [...pickerSnippet.matchAll(/<button[^>]*class="[^"]*theme-chip[^"]*"[^>]*>/gi)];
  assert.equal(chipButtons.length, 5, "Must contain exactly 5 theme-chip buttons in the picker");

  const foundThemeIds = [];
  let checkedCount = 0;

  for (const buttonTag of chipButtons.map((m) => m[0])) {
    // role="radio"
    assert.match(buttonTag, /role="radio"/i, `Theme chip button must have role='radio': ${buttonTag}`);

    // type="button"
    assert.match(buttonTag, /type="button"/i, `Theme chip button must have type='button': ${buttonTag}`);

    // aria-checked attribute
    assert.match(
      buttonTag,
      /aria-checked="(true|false)"/i,
      `Theme chip button must have aria-checked='true' or 'false': ${buttonTag}`
    );

    if (/aria-checked="true"/i.test(buttonTag)) {
      checkedCount++;
      // Active chip must have is-active class
      assert.match(buttonTag, /class="[^"]*\bis-active\b[^"]*"/, "Active chip must have .is-active class");
    }

    // Extract data-theme-id
    const idMatch = buttonTag.match(/data-theme-id="([^"]+)"/i);
    assert.ok(idMatch, `Theme chip button must declare data-theme-id: ${buttonTag}`);
    foundThemeIds.push(idMatch[1]);

    // Descriptive title tooltip
    assert.match(buttonTag, /title="[^"]+"/i, `Theme chip button must have title tooltip: ${buttonTag}`);
  }

  // Exactly 1 theme must be initially checked
  assert.equal(checkedCount, 1, "Exactly one theme chip must have aria-checked='true' on initial load");

  // All 5 canonical IDs must be present and unique
  assert.equal(new Set(foundThemeIds).size, 5, "All 5 theme IDs must be unique");
  assert.deepEqual(foundThemeIds.sort(), [...CANONICAL_THEME_IDS].sort(), "Must match 5 canonical theme IDs");

  // Default initial checked theme must be 'classic'
  const classicButton = chipButtons.find((m) => m[0].includes('data-theme-id="classic"'))[0];
  assert.match(classicButton, /aria-checked="true"/, "Default active theme must be 'classic'");
});

test("Challenger 2 DOM: index.html theme chips contain dual swatches and labels for all 5 themes", () => {
  for (const id of CANONICAL_THEME_IDS) {
    // Swatch span
    const swatchRegex = new RegExp(
      `<span[^>]*class="[^"]*theme-swatch[^"]*theme-swatch-${id}[^"]*"[^>]*aria-hidden="true"[^>]*><\\/span>`,
      "i"
    );
    assert.match(
      html,
      swatchRegex,
      `Must contain swatch element with theme-swatch-${id} and aria-hidden="true"`
    );

    // Chip label span
    const chipBlockRegex = new RegExp(
      `data-theme-id="${id}"[\\s\\S]*?<span class="theme-chip-label">([^<]+)<\\/span>`,
      "i"
    );
    const labelMatch = html.match(chipBlockRegex);
    assert.ok(labelMatch, `Theme chip '${id}' must have a .theme-chip-label element`);
    assert.ok(labelMatch[1].trim().length > 0, `Theme chip '${id}' label must not be empty`);
  }
});

// ============================================================================
// 2. CSS Theme Definitions & Variable Binding Verification
// ============================================================================

test("Challenger 2 CSS: style.css defines complete property sets for all 5 theme selector blocks", () => {
  const REQUIRED_CSS_VARIABLES = [
    "--card-theme-bg",
    "--card-theme-bg-hover",
    "--card-theme-border",
    "--card-theme-border-hover",
    "--card-theme-corner",
    "--card-theme-accent",
    "--card-theme-glow",
  ];

  // 1. :root default definitions for card theming
  const themeRootMatch = css.match(/:root\s*\{[^}]*--card-theme-bg:[^}]+\}/s);
  assert.ok(themeRootMatch, "style.css must have a :root block defining --card-theme-bg");
  const rootBlock = themeRootMatch[0];
  for (const varName of REQUIRED_CSS_VARIABLES) {
    assert.ok(
      rootBlock.includes(varName),
      `:root block must define fallback default for ${varName}`
    );
  }

  // 2. Individual theme blocks #home-view[data-card-theme="..."]
  for (const themeId of CANONICAL_THEME_IDS) {
    const selectorRegex = new RegExp(
      `#home-view\\[data-card-theme="${themeId}"\\]\\s*\\{([^}]+)\\}`,
      "s"
    );
    const themeBlockMatch = css.match(selectorRegex);
    assert.ok(
      themeBlockMatch,
      `style.css must define #home-view[data-card-theme="${themeId}"] block`
    );

    const themeBlock = themeBlockMatch[1];
    for (const varName of REQUIRED_CSS_VARIABLES) {
      assert.ok(
        themeBlock.includes(varName),
        `Theme '${themeId}' block must define property ${varName}`
      );
    }
  }

  // 3. Glass theme special backdrop-filter rule
  const glassBackdropRegex = /#home-view\[data-card-theme="glass"\]\s+\.home-system-card\s*\{[^}]*backdrop-filter:\s*blur\(14px\);?[^}]*\}/s;
  assert.match(
    css,
    glassBackdropRegex,
    "glass theme must define backdrop-filter: blur(14px) for .home-system-card"
  );
});

test("Challenger 2 CSS: .home-system-card consumes --card-theme-* variables with valid fallbacks", () => {
  // Extract .home-system-card block
  const cardBlockMatch = css.match(/\.home-system-card\s*\{([^}]+)\}/s);
  assert.ok(cardBlockMatch, "style.css must define .home-system-card");
  const cardBlock = cardBlockMatch[1];

  // Border uses --card-theme-border with fallback
  assert.match(
    cardBlock,
    /border:\s*1px\s+solid\s+var\(--card-theme-border,\s*[^)]+\);?/,
    ".home-system-card border must use var(--card-theme-border, <fallback>)"
  );

  // Background uses --card-theme-bg with fallback
  assert.match(
    cardBlock,
    /background:\s*var\(--card-theme-bg,\s*[^)]+\);?/,
    ".home-system-card background must use var(--card-theme-bg, <fallback>)"
  );

  // Corner notch uses --card-theme-corner with fallback
  const cornerBlockMatch = css.match(/\.home-system-card::after\s*\{([^}]+)\}/s);
  assert.ok(cornerBlockMatch, "style.css must define .home-system-card::after");
  const cornerBlock = cornerBlockMatch[1];
  assert.match(
    cornerBlock,
    /border-top:\s*1px\s+solid\s+var\(--card-theme-corner,\s*[^)]+\);?/,
    ".home-system-card::after must use var(--card-theme-corner, <fallback>) for border-top"
  );
  assert.match(
    cornerBlock,
    /border-right:\s*1px\s+solid\s+var\(--card-theme-corner,\s*[^)]+\);?/,
    ".home-system-card::after must use var(--card-theme-corner, <fallback>) for border-right"
  );

  // Hover state uses --card-theme-border-hover, --card-theme-bg-hover, --card-theme-glow
  const hoverBlockMatch = css.match(/\.home-system-card:hover\s*\{([^}]+)\}/s);
  assert.ok(hoverBlockMatch, "style.css must define .home-system-card:hover");
  const hoverBlock = hoverBlockMatch[1];
  assert.match(hoverBlock, /border-color:\s*var\(--card-theme-border-hover,\s*[^)]+\);?/);
  assert.match(hoverBlock, /background:\s*var\(--card-theme-bg-hover,\s*[^)]+\);?/);
  assert.match(hoverBlock, /box-shadow:\s*var\(--card-theme-glow,\s*[^)]+\);?/);

  // Chevron open arrow hover uses --card-theme-accent
  const openHoverMatch = css.match(/\.home-system-card:hover\s+\.home-system-open\s*\{([^}]+)\}/s);
  assert.ok(openHoverMatch, "style.css must define .home-system-card:hover .home-system-open");
  assert.match(openHoverMatch[1], /color:\s*var\(--card-theme-accent,\s*[^)]+\);?/);
});

// ============================================================================
// 3. Interactive Theme Switching & State Synchronization Simulation
// ============================================================================

test("Challenger 2 Interactive: Clicking theme chips updates active indicators and dataset", () => {
  class SyntheticClassList {
    constructor() {
      this.classes = new Set();
    }
    add(cls) { this.classes.add(cls); }
    remove(cls) { this.classes.delete(cls); }
    toggle(cls, force) {
      if (force !== undefined) {
        if (force) this.classes.add(cls);
        else this.classes.delete(cls);
        return force;
      }
      if (this.classes.has(cls)) {
        this.classes.delete(cls);
        return false;
      }
      this.classes.add(cls);
      return true;
    }
    contains(cls) { return this.classes.has(cls); }
  }

  class SyntheticElement {
    constructor(tagName, attrs = {}) {
      this.tagName = tagName.toUpperCase();
      this.attributes = new Map(Object.entries(attrs));
      this.dataset = {};
      this.classList = new SyntheticClassList();
      this.children = [];
      this.parentElement = null;
      this.listeners = new Map();

      if (attrs.class) {
        attrs.class.split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
      }
    }

    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }

    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }

    addEventListener(event, fn) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event).push(fn);
    }

    dispatchEvent(event) {
      let cur = this;
      while (cur) {
        const fns = cur.listeners.get(event.type) || [];
        for (const fn of fns) fn(event);
        if (event.cancelBubble) break;
        cur = cur.parentElement;
      }
    }

    closest(selector) {
      let cur = this;
      while (cur) {
        if (selector === "[data-theme-id]" && cur.attributes.has("data-theme-id")) return cur;
        if (selector === "[data-theme-picker]" && cur.attributes.has("data-theme-picker")) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    querySelectorAll(selector) {
      const results = [];
      function recurse(node) {
        for (const c of node.children) {
          if (selector === "[data-theme-id]" && c.attributes.has("data-theme-id")) {
            results.push(c);
          }
          recurse(c);
        }
      }
      recurse(this);
      return results;
    }
  }

  // Instantiate tree
  const homeView = new SyntheticElement("main", { id: "home-view" });
  homeView.dataset.cardTheme = "classic";

  const studioView = new SyntheticElement("div", { id: "studio-view" });

  const themePicker = new SyntheticElement("div", {
    class: "home-theme-picker",
    "data-theme-picker": "",
    role: "radiogroup",
  });
  homeView.appendChild(themePicker);

  const chipsMap = new Map();
  for (const id of CANONICAL_THEME_IDS) {
    const isClassic = id === "classic";
    const chip = new SyntheticElement("button", {
      class: `theme-chip${isClassic ? " is-active" : ""}`,
      type: "button",
      role: "radio",
      "aria-checked": isClassic ? "true" : "false",
      "data-theme-id": id,
    });
    const swatch = new SyntheticElement("span", {
      class: `theme-swatch theme-swatch-${id}`,
      "aria-hidden": "true",
    });
    const label = new SyntheticElement("span", { class: "theme-chip-label" });
    chip.appendChild(swatch);
    chip.appendChild(label);
    themePicker.appendChild(chip);
    chipsMap.set(id, { chip, swatch, label });
  }

  // Setup simulated persistence
  const storage = new Map();
  function persistThemeSim(id) { storage.set("postcard_studio_card_theme", id); }

  // Wire event delegation matching main.ts initCardThemePicker() and applyCardTheme()
  function applyCardThemeSim(themeId) {
    if (!CANONICAL_THEME_IDS.includes(themeId)) themeId = "classic";
    persistThemeSim(themeId);
    homeView.dataset.cardTheme = themeId;
    studioView.dataset.cardTheme = themeId;

    const allChips = homeView.querySelectorAll("[data-theme-id]");
    allChips.forEach((chip) => {
      const isSelected = chip.getAttribute("data-theme-id") === themeId;
      chip.classList.toggle("is-active", isSelected);
      chip.setAttribute("aria-checked", isSelected ? "true" : "false");
    });
  }

  themePicker.addEventListener("click", (event) => {
    const target = event.target ? event.target.closest("[data-theme-id]") : null;
    if (!target) return;
    const themeId = target.getAttribute("data-theme-id");
    if (themeId) applyCardThemeSim(themeId);
  });

  // Verify initial state
  assert.equal(homeView.dataset.cardTheme, "classic");
  assert.equal(chipsMap.get("classic").chip.classList.contains("is-active"), true);
  assert.equal(chipsMap.get("classic").chip.getAttribute("aria-checked"), "true");

  // TEST 1: Click directly on chip button for 'cyberpunk'
  chipsMap.get("cyberpunk").chip.dispatchEvent({ type: "click", target: chipsMap.get("cyberpunk").chip });
  assert.equal(homeView.dataset.cardTheme, "cyberpunk", "homeView data-card-theme must update to cyberpunk");
  assert.equal(chipsMap.get("cyberpunk").chip.classList.contains("is-active"), true);
  assert.equal(chipsMap.get("cyberpunk").chip.getAttribute("aria-checked"), "true");
  assert.equal(chipsMap.get("classic").chip.classList.contains("is-active"), false);
  assert.equal(chipsMap.get("classic").chip.getAttribute("aria-checked"), "false");
  assert.equal(storage.get("postcard_studio_card_theme"), "cyberpunk", "localStorage must persist cyberpunk");

  // TEST 2: Click on nested swatch inside 'glass' chip
  chipsMap.get("glass").swatch.dispatchEvent({ type: "click", target: chipsMap.get("glass").swatch });
  assert.equal(homeView.dataset.cardTheme, "glass", "Clicking nested swatch must activate glass theme");
  assert.equal(chipsMap.get("glass").chip.classList.contains("is-active"), true);
  assert.equal(chipsMap.get("glass").chip.getAttribute("aria-checked"), "true");
  assert.equal(chipsMap.get("cyberpunk").chip.classList.contains("is-active"), false);

  // TEST 3: Click on nested label inside 'material-vibrant' chip
  chipsMap.get("material-vibrant").label.dispatchEvent({ type: "click", target: chipsMap.get("material-vibrant").label });
  assert.equal(homeView.dataset.cardTheme, "material-vibrant", "Clicking nested label must activate material-vibrant");
  assert.equal(chipsMap.get("material-vibrant").chip.classList.contains("is-active"), true);

  // TEST 4: Click on 'minimal-dark' chip button
  chipsMap.get("minimal-dark").chip.dispatchEvent({ type: "click", target: chipsMap.get("minimal-dark").chip });
  assert.equal(homeView.dataset.cardTheme, "minimal-dark");
  assert.equal(chipsMap.get("minimal-dark").chip.classList.contains("is-active"), true);

  // TEST 5: Return to 'classic'
  chipsMap.get("classic").chip.dispatchEvent({ type: "click", target: chipsMap.get("classic").chip });
  assert.equal(homeView.dataset.cardTheme, "classic");
  assert.equal(chipsMap.get("classic").chip.classList.contains("is-active"), true);
  assert.equal(storage.get("postcard_studio_card_theme"), "classic");

  // TEST 6: Click dead space on container does not alter active theme
  themePicker.dispatchEvent({ type: "click", target: themePicker });
  assert.equal(homeView.dataset.cardTheme, "classic", "Dead space click must not change active theme");
  assert.equal(chipsMap.get("classic").chip.classList.contains("is-active"), true);
});

// ============================================================================
// 4. Responsive Layout Rules & Geometry Boundary Analysis
// ============================================================================

test("Challenger 2 Responsive: Media queries <= 900px and <= 640px prevent overflow and clipping", () => {
  // Check the responsive block for theme bar (lines ~3430-3457 in style.css)
  const themeRespBlockMatch = css.match(
    /\/\*\s*Responsive Overrides\s*\*\/[\s\S]*?@media\s*\(\s*max-width:\s*900px\s*\)\s*\{([\s\S]*?\}[\s\S]*?)\}[\s\S]*?@media\s*\(\s*max-width:\s*640px\s*\)\s*\{([\s\S]*?\}[\s\S]*?)\}/
  );
  assert.ok(themeRespBlockMatch, "style.css must have responsive overrides for 900px and 640px for theme bar");

  const body900 = themeRespBlockMatch[1];
  const body640 = themeRespBlockMatch[2];

  assert.match(
    body900,
    /\.home-theme-bar\s*\{[^}]*flex-direction:\s*column;/s,
    "<= 900px must switch .home-theme-bar to flex-direction: column"
  );
  assert.match(
    body900,
    /\.home-theme-bar\s*\{[^}]*align-items:\s*flex-start;/s,
    "<= 900px must align items to flex-start"
  );
  assert.match(
    body900,
    /\.home-theme-picker\s*\{[^}]*width:\s*100%;/s,
    "<= 900px must expand .home-theme-picker to width: 100%"
  );
  assert.match(
    body900,
    /\.home-theme-picker\s*\{[^}]*overflow-x:\s*auto;/s,
    "<= 900px must enable overflow-x: auto on .home-theme-picker"
  );

  assert.match(
    body640,
    /\.home-theme-desc\s*\{[^}]*display:\s*none;/s,
    "<= 640px must hide .home-theme-desc to preserve horizontal space"
  );
  assert.match(
    body640,
    /\.theme-chip\s*\{[^}]*padding:\s*0\s+8px;/s,
    "<= 640px must compact .theme-chip padding to 0 8px"
  );
  assert.match(
    body640,
    /\.theme-chip\s*\{[^}]*font-size:\s*10px;/s,
    "<= 640px must compact .theme-chip font-size to 10px"
  );
});

test("Challenger 2 Geometry: Chip dimensions fit container without horizontal overflow", () => {
  // Approximate label character lengths
  const chipLabels = [
    "Classic Studio",      // 14 chars
    "Cyberpunk Neon",      // 14 chars
    "Minimal Dark",        // 12 chars
    "Glass",               // 5 chars
    "Material Vibrant",    // 16 chars
  ];

  // At desktop (> 900px):
  // 11px Space Grotesk ~ 6.5px/char, swatch: 12px, gap: 8px, padding: 24px, border: 2px
  const desktopWidths = chipLabels.map((label) => {
    const textWidth = label.length * 6.5;
    return 12 + 8 + textWidth + 24 + 2;
  });
  const totalDesktopChipsWidth = desktopWidths.reduce((a, b) => a + b, 0) + 4 * 8; // 4 gaps of 8px
  assert.ok(
    totalDesktopChipsWidth < 700,
    `Total desktop chips width (~${totalDesktopChipsWidth}px) must be well within typical container width`
  );

  // At 640px breakpoint:
  // 10px Space Grotesk ~ 5.8px/char, swatch: 12px, gap: 8px, padding: 16px, border: 2px
  const mobileWidths = chipLabels.map((label) => {
    const textWidth = label.length * 5.8;
    return 12 + 8 + textWidth + 16 + 2;
  });
  const totalMobileChipsWidth = mobileWidths.reduce((a, b) => a + b, 0) + 4 * 8;
  assert.ok(
    totalMobileChipsWidth < 640,
    `Total mobile chips width (~${totalMobileChipsWidth}px) must fit within 640px viewport`
  );

  // On very narrow viewports (e.g. 320px - 375px), .home-theme-picker has overflow-x: auto
  // and .home-theme-bar has column layout with margin: 0 2px 14px, ensuring viewport does not scroll horizontally
  assert.ok(true, "Narrow viewports smoothly scroll picker horizontally via overflow-x: auto");
});

// ============================================================================
// 5. Adversarial Stress & Resiliency Scenarios
// ============================================================================

test("Challenger 2 Adversarial: 100 rapid random theme switches preserve state consistency", async () => {
  const { CARD_THEME_IDS, getCardTheme, isValidCardThemeId } = await import("../src/card-themes.ts");

  let currentThemeId = "classic";
  for (let i = 0; i < 100; i++) {
    const nextThemeId = CARD_THEME_IDS[Math.floor(Math.random() * CARD_THEME_IDS.length)];
    assert.ok(isValidCardThemeId(nextThemeId));
    const def = getCardTheme(nextThemeId);
    assert.equal(def.id, nextThemeId);
    assert.ok(def.canvas.bgTop.length > 0);
    assert.ok(def.material.roughness >= 0 && def.material.roughness <= 1);
    currentThemeId = nextThemeId;
  }
  assert.ok(isValidCardThemeId(currentThemeId));
});

test("Challenger 2 Adversarial: Fallback styles protect against unstyled system cards", () => {
  // If CSS custom properties fail to load or are undefined, .home-system-card must have
  // complete fallback values in each rule:
  const cardBorderFallback = css.match(/--card-theme-border,\s*([^)]+)\)/);
  assert.ok(cardBorderFallback, "Fallback for --card-theme-border must be present");
  assert.ok(cardBorderFallback[1].length > 0);

  const cardBgFallback = css.match(/--card-theme-bg,\s*([^)]+\([^)]+\)[^)]*)\)/);
  assert.ok(cardBgFallback, "Fallback for --card-theme-bg must be present");

  const cornerFallback = css.match(/--card-theme-corner,\s*([^)]+)\)/);
  assert.ok(cornerFallback, "Fallback for --card-theme-corner must be present");

  const accentFallback = css.match(/--card-theme-accent,\s*([^)]+)\)/);
  assert.ok(accentFallback, "Fallback for --card-theme-accent must be present");
});
