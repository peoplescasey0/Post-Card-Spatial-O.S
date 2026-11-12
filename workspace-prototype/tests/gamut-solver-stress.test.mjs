import test from "node:test";
import assert from "node:assert/strict";
import {
  getTone,
  generateThemeFromSeed,
  getCardTheme,
  isValidCardThemeId,
  hexToRgb,
  srgbToLinear,
  ANDROID_TONE_LEVELS,
  DEFAULT_CARD_THEME_ID,
  CARD_THEME_IDS,
  ANDROID_THEME_IDS,
} from "../src/card-themes.ts";

function getRelativeLuminance(hexColor) {
  const [r, g, b] = hexToRgb(hexColor);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function getContrastRatio(colorA, colorB) {
  const lumA = getRelativeLuminance(colorA);
  const lumB = getRelativeLuminance(colorB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

test("CHALLENGE 1: Exhaustive 360-Degree Hue Sweep x Diverse Chromas x 13 Stops (21,060 Grid Points)", () => {
  const chromas = [0, 4, 16, 32, 48, 64, 96, 128, 160];
  let totalEvaluated = 0;
  let tonesAboveZeroBlack = 0;
  let tonesBelowHundredWhite = 0;

  for (let h = 0; h < 360; h += 2) { // 180 hues
    for (const c of chromas) { // 9 chromas
      for (const t of ANDROID_TONE_LEVELS) { // 13 stops -> 21,060 points
        totalEvaluated++;
        const hex = getTone(h, c, t);

        // Format check
        assert.match(
          hex,
          /^#[0-9a-f]{6}$/,
          `Invalid hex output '${hex}' at h=${h}, c=${c}, t=${t}`
        );

        // Numeric checks
        const [r, g, b] = hexToRgb(hex);
        assert.ok(!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b), `NaN at h=${h}, c=${c}, t=${t}`);
        assert.ok(r >= 0 && r <= 255, `R out of range: ${r}`);
        assert.ok(g >= 0 && g <= 255, `G out of range: ${g}`);
        assert.ok(b >= 0 && b <= 255, `B out of range: ${b}`);

        if (t === 0) {
          assert.equal(hex, "#000000", `Tone 0 must be #000000 at h=${h}, c=${c}`);
        } else if (t === 100) {
          assert.equal(hex, "#ffffff", `Tone 100 must be #ffffff at h=${h}, c=${c}`);
        } else {
          if (hex === "#000000") tonesAboveZeroBlack++;
          if (hex === "#ffffff") tonesBelowHundredWhite++;
        }
      }
    }
  }

  // Tones in [10, 99] should never collapse completely to pure black or pure white
  assert.equal(tonesAboveZeroBlack, 0, "No positive tone in [10, 99] should collapse to #000000");
  assert.equal(tonesBelowHundredWhite, 0, "No tone in [10, 99] should prematurely saturate to #ffffff");
  console.log(`  Successfully evaluated ${totalEvaluated} grid points without NaN or range violations.`);
});

test("CHALLENGE 2: Extreme Tone Clamping (Tone <= 0 -> #000000, Tone >= 100 -> #ffffff)", () => {
  const hues = [0, 45, 90, 135, 180, 225, 270, 315, 360];
  const chromas = [0, 10, 48, 100, 150, 250];

  for (const h of hues) {
    for (const c of chromas) {
      assert.equal(getTone(h, c, 0), "#000000", `Tone 0 must be #000000 at h=${h}, c=${c}`);
      assert.equal(getTone(h, c, -0.001), "#000000", `Tone -0.001 must clamp to #000000 at h=${h}, c=${c}`);
      assert.equal(getTone(h, c, -1), "#000000", `Tone -1 must clamp to #000000 at h=${h}, c=${c}`);
      assert.equal(getTone(h, c, -999), "#000000", `Tone -999 must clamp to #000000 at h=${h}, c=${c}`);

      assert.equal(getTone(h, c, 100), "#ffffff", `Tone 100 must be #ffffff at h=${h}, c=${c}`);
      assert.equal(getTone(h, c, 100.001), "#ffffff", `Tone 100.001 must clamp to #ffffff at h=${h}, c=${c}`);
      assert.equal(getTone(h, c, 101), "#ffffff", `Tone 101 must clamp to #ffffff at h=${h}, c=${c}`);
      assert.equal(getTone(h, c, 999), "#ffffff", `Tone 999 must clamp to #ffffff at h=${h}, c=${c}`);
    }
  }
});

test("CHALLENGE 3: Monotonic Lightness Across Standard MD3 Stops", () => {
  const hues = [0, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 350];
  const chromas = [0, 4, 8, 16, 24, 32, 48, 64, 80, 100, 120, 150];

  for (const h of hues) {
    for (const c of chromas) {
      let prevLum = -1;
      for (const tone of ANDROID_TONE_LEVELS) {
        const hex = getTone(h, c, tone);
        const lum = getRelativeLuminance(hex);
        assert.ok(
          lum > prevLum,
          `Relative luminance must strictly increase: tone ${tone} (lum ${lum}) vs prevLum ${prevLum} at h=${h}, c=${c}`
        );
        prevLum = lum;
      }
    }
  }
});

test("CHALLENGE 4: Monotonic Lightness Across All 101 Integer Stops (0 to 100)", () => {
  const hues = [0, 30, 60, 90, 120, 180, 240, 300];
  const chromas = [0, 16, 32, 48, 80];

  for (const h of hues) {
    for (const c of chromas) {
      let prevLum = -1;
      for (let tone = 0; tone <= 100; tone++) {
        const hex = getTone(h, c, tone);
        const lum = getRelativeLuminance(hex);
        assert.ok(
          lum >= prevLum,
          `Integer tone luminance inversion: tone ${tone} (lum ${lum}) < prevLum ${prevLum} at h=${h}, c=${c}`
        );
        prevLum = lum;
      }
    }
  }
});

test("CHALLENGE 5: Fractional Tones Near Boundaries (0.01, 0.1, 1, 99, 99.9)", () => {
  const hues = [0, 60, 120, 180, 240, 300];
  const chromas = [0, 20, 50, 100];

  for (const h of hues) {
    for (const c of chromas) {
      const t0 = getTone(h, c, 0);
      const t0_1 = getTone(h, c, 0.1);
      const t1 = getTone(h, c, 1);
      const t10 = getTone(h, c, 10);
      const t90 = getTone(h, c, 90);
      const t99 = getTone(h, c, 99);
      const t99_9 = getTone(h, c, 99.9);
      const t100 = getTone(h, c, 100);

      const l0 = getRelativeLuminance(t0);
      const l0_1 = getRelativeLuminance(t0_1);
      const l1 = getRelativeLuminance(t1);
      const l10 = getRelativeLuminance(t10);
      const l90 = getRelativeLuminance(t90);
      const l99 = getRelativeLuminance(t99);
      const l99_9 = getRelativeLuminance(t99_9);
      const l100 = getRelativeLuminance(t100);

      assert.ok(l0 <= l0_1, `l0 <= l0_1 at h=${h}, c=${c}`);
      assert.ok(l0_1 <= l1, `l0_1 <= l1 at h=${h}, c=${c}`);
      assert.ok(l1 < l10, `l1 < l10 at h=${h}, c=${c}`);
      assert.ok(l90 < l99, `l90 < l99 at h=${h}, c=${c}`);
      assert.ok(l99 <= l99_9, `l99 <= l99_9 at h=${h}, c=${c}`);
      assert.ok(l99_9 <= l100, `l99_9 <= l100 at h=${h}, c=${c}`);
    }
  }
});

test("CHALLENGE 6: Adversarial Seed Descriptors and Validation Guards", () => {
  // Descriptors WITHOUT # MUST be rejected as invalid
  const invalidDescriptors = [
    "seed:bad",
    "seed:cab",
    "seed:bed",
    "seed:fee",
    "seed:ace",
    "seed:1a73e8",
    "seed:000",
    "seed:fff",
    "seed:123456",
    "seed:nothex",
    "seed:",
    "seed:#",
    "seed:###",
    "seed:#1",
    "seed:#12",
    "seed:#1234",
    "seed:#12345",
    "seed:#1234567",
    "seed:#xyz",
    "seed:#ghijk",
    "seed:   ",
    "bad",
    "cab",
    "1a73e8",
    "random-theme-id",
    "",
    null,
    undefined,
    12345,
    {},
    [],
    true,
    false,
  ];

  for (const desc of invalidDescriptors) {
    assert.equal(
      isValidCardThemeId(desc),
      false,
      `Descriptor '${desc}' must be invalid in isValidCardThemeId`
    );
    const theme = getCardTheme(desc);
    assert.equal(
      theme.id,
      DEFAULT_CARD_THEME_ID,
      `Descriptor '${desc}' must fall back to default '${DEFAULT_CARD_THEME_ID}', got '${theme.id}'`
    );
  }

  // Valid seed descriptors WITH # MUST be accepted
  const validDescriptors = [
    "seed:#bad",
    "seed:#cab",
    "seed:#bed",
    "seed:#fee",
    "seed:#1a73e8",
    "seed:#000",
    "seed:#fff",
    "seed:#123456",
    "seed:#ffffff",
    "seed:#000000",
    "#bad",
    "#1a73e8",
    "#fff",
    "#ffffff",
    ...CARD_THEME_IDS,
    ...ANDROID_THEME_IDS,
  ];

  for (const desc of validDescriptors) {
    assert.equal(
      isValidCardThemeId(desc),
      true,
      `Valid descriptor '${desc}' must evaluate to true in isValidCardThemeId`
    );
    const theme = getCardTheme(desc);
    assert.ok(
      theme && typeof theme === "object",
      `Theme for '${desc}' must return a valid object`
    );
    if (typeof desc === "string" && (CARD_THEME_IDS.includes(desc) || ANDROID_THEME_IDS.includes(desc))) {
      assert.equal(theme.id, desc);
    } else {
      assert.equal(theme.id, desc);
    }
  }
});

test("CHALLENGE 7: Dynamic Theme Generation Across 100 Diverse and Extreme Seeds", () => {
  // Generate 100 diverse seed colors
  const seeds = [
    "#000000", "#ffffff", "#808080", "#ff0000", "#00ff00", "#0000ff",
    "#ffff00", "#00ffff", "#ff00ff", "#71717a", "#6750a4", "#1a73e8",
    "#1e8e3e", "#8430ce", "#f9ab00", "#202124", "#010101", "#fefefe",
    "#333333", "#cccccc", "#123456", "#654321", "#abcdef", "#fedcba"
  ];
  // Add 76 procedural seeds across hue circle
  for (let h = 0; h < 360; h += 360 / 76) {
    const hex = getTone(Math.round(h), 50, 50);
    seeds.push(hex);
  }

  let totalThemesGenerated = 0;
  for (const seed of seeds) {
    for (const mode of ["dark", "light"]) {
      totalThemesGenerated++;
      const theme = generateThemeFromSeed(seed, { mode });

      assert.ok(theme.id, `Theme ID missing for seed ${seed}`);
      assert.ok(theme.palettes, `Palettes missing for seed ${seed}`);
      assert.ok(theme.roles, `Roles missing for seed ${seed}`);
      assert.ok(theme.canvas, `Canvas tokens missing for seed ${seed}`);
      assert.ok(theme.material, `Material tokens missing for seed ${seed}`);
      assert.ok(theme.lighting, `Lighting tokens missing for seed ${seed}`);
      assert.ok(theme.homeCss, `HomeCss tokens missing for seed ${seed}`);

      // Verify palettes have 13 valid stops
      for (const palKey of ["primary", "secondary", "tertiary", "neutral", "neutralVariant"]) {
        const pal = theme.palettes[palKey];
        assert.ok(pal, `Missing palette ${palKey}`);
        for (const stop of ANDROID_TONE_LEVELS) {
          assert.match(pal[stop], /^#[0-9a-f]{6}$/, `Invalid hex in ${palKey}[${stop}]`);
        }
      }

      // Check WCAG AA contrast for text roles
      const activeRoles = mode === "dark" ? theme.roles : theme.lightRoles;
      const surfaceContrast = getContrastRatio(activeRoles.onSurface, activeRoles.surface);
      assert.ok(
        surfaceContrast >= 4.5,
        `Surface contrast failed for ${seed} (${mode}): ${surfaceContrast.toFixed(2)}:1`
      );

      const primaryContrast = getContrastRatio(activeRoles.onPrimary, activeRoles.primary);
      assert.ok(
        primaryContrast >= 4.5,
        `Primary contrast failed for ${seed} (${mode}): ${primaryContrast.toFixed(2)}:1`
      );
    }
  }

  console.log(`  Generated and validated ${totalThemesGenerated} dynamic themes across diverse seeds.`);
});
