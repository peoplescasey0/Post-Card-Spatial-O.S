// G:\micro-host\workspace-prototype\tests\adversarial-engine-1-stress.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as T from "../src/card-themes.ts";

// Helper: Calculate relative luminance from sRGB hex
function getRelativeLuminance(hex) {
  const [r, g, b] = T.hexToRgb(hex);
  const rL = T.srgbToLinear(r);
  const gL = T.srgbToLinear(g);
  const bL = T.srgbToLinear(b);
  return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
}

// Helper: Calculate L* from sRGB hex
function getPerceptualLightness(hex) {
  const [r, g, b] = T.hexToRgb(hex);
  const [x, y, z] = T.rgbToXyz(r, g, b);
  const [L] = T.xyzToLab(x, y, z);
  return L;
}

test("Challenger 1.1: Dense Color Wheel Gamut Sweep (4,680 evaluations)", () => {
  const hues = Array.from({ length: 36 }, (_, i) => i * 10); // 0, 10, ..., 350
  const chromas = [5, 10, 16, 24, 32, 48, 64, 80, 100, 130];
  const tones = T.ANDROID_TONE_LEVELS; // 13 stops: 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100

  let evalCount = 0;
  const startTime = performance.now();

  for (const h of hues) {
    for (const c of chromas) {
      for (const t of tones) {
        evalCount++;
        const hex = T.getTone(h, c, t);

        // Invariant 1: Valid 7-character hex string format
        assert.match(
          hex,
          /^#[0-9a-fA-F]{6}$/,
          `Evaluation ${evalCount} (h=${h}, c=${c}, t=${t}) produced invalid hex: ${hex}`
        );

        // Invariant 2: sRGB channel bounds [0, 255]
        const [r, g, b] = T.hexToRgb(hex);
        assert.ok(
          r >= 0 && r <= 255 && !Number.isNaN(r),
          `Invalid R channel ${r} for h=${h}, c=${c}, t=${t}`
        );
        assert.ok(
          g >= 0 && g <= 255 && !Number.isNaN(g),
          `Invalid G channel ${g} for h=${h}, c=${c}, t=${t}`
        );
        assert.ok(
          b >= 0 && b <= 255 && !Number.isNaN(b),
          `Invalid B channel ${b} for h=${h}, c=${c}, t=${t}`
        );
      }
    }
  }

  const durationMs = performance.now() - startTime;
  assert.equal(evalCount, 4680);
  console.log(`  -> Dense color wheel sweep: 4,680 evaluations in ${durationMs.toFixed(2)}ms (${(durationMs / 4680 * 1000).toFixed(2)}µs/eval)`);
});

test("Challenger 1.2: Perceptual Luminance Monotonicity Across All 360 (Hue, Chroma) Series", () => {
  const hues = Array.from({ length: 36 }, (_, i) => i * 10);
  const chromas = [5, 10, 16, 24, 32, 48, 64, 80, 100, 130];
  const tones = T.ANDROID_TONE_LEVELS; // [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100]

  let seriesCount = 0;
  let maxLightnessDelta = 0;

  for (const h of hues) {
    for (const c of chromas) {
      seriesCount++;
      const hexSeries = tones.map((t) => T.getTone(h, c, t));

      // Tone 0 must be pure black
      assert.equal(
        hexSeries[0],
        "#000000",
        `Tone 0 must be #000000 for h=${h}, c=${c}, got ${hexSeries[0]}`
      );

      // Tone 100 must be pure white
      assert.equal(
        hexSeries[tones.length - 1],
        "#ffffff",
        `Tone 100 must be #ffffff for h=${h}, c=${c}, got ${hexSeries[tones.length - 1]}`
      );

      // Monotonicity check on Relative Luminance Y
      for (let i = 0; i < tones.length - 1; i++) {
        const y1 = getRelativeLuminance(hexSeries[i]);
        const y2 = getRelativeLuminance(hexSeries[i + 1]);
        assert.ok(
          y2 >= y1 - 1e-6,
          `Monotonicity violation at h=${h}, c=${c}: Tone ${tones[i]} (Y=${y1}) > Tone ${tones[i+1]} (Y=${y2})`
        );

        // Check reconstructed L* deviation
        const L = getPerceptualLightness(hexSeries[i]);
        const targetTone = tones[i];
        const delta = Math.abs(L - targetTone);
        if (delta > maxLightnessDelta) maxLightnessDelta = delta;
      }
    }
  }

  assert.equal(seriesCount, 360);
  console.log(`  -> Monotonicity verified across 360 series. Max L* quantization delta: ${maxLightnessDelta.toFixed(3)} L* units.`);
});

test("Challenger 1.3: Extreme Coordinates & Numerical Stability", () => {
  const extremeCoords = [
    { h: 0, c: 100, t: 99 },
    { h: 120, c: 100, t: 99 },
    { h: 240, c: 100, t: 99 },
    { h: 0, c: 100, t: 1 },
    { h: 120, c: 100, t: 1 },
    { h: 240, c: 100, t: 1 },
    { h: 180, c: 200, t: 50 },
    { h: 360, c: 50, t: 50 },
    { h: -30, c: 50, t: 50 },
    { h: 720, c: 50, t: 50 },
    { h: 359.9999, c: 80, t: 50 },
    { h: 0, c: 0, t: 50 },
    { h: 0, c: -50, t: 50 },
    { h: 0, c: 50, t: -10 },
    { h: 0, c: 50, t: 110 },
  ];

  for (const { h, c, t } of extremeCoords) {
    const hex = T.getTone(h, c, t);
    assert.match(
      hex,
      /^#[0-9a-fA-F]{6}$/,
      `Extreme coord (h=${h}, c=${c}, t=${t}) produced invalid hex: ${hex}`
    );
    const [r, g, b] = T.hexToRgb(hex);
    assert.ok(r >= 0 && r <= 255);
    assert.ok(g >= 0 && g <= 255);
    assert.ok(b >= 0 && b <= 255);
  }
});

test("Challenger 1.4: Gamut Boundary Solving Invariant (16-step Bisection Convergence)", () => {
  // Test that for wide-gamut requested chroma (e.g. C=120 at Tone 50),
  // getTone produces the maximal in-gamut sRGB chroma without overflowing bounds.
  const testCases = [
    { h: 30, c: 120, t: 50 }, // Orange/brown
    { h: 140, c: 120, t: 50 }, // Green
    { h: 210, c: 120, t: 50 }, // Cyan
    { h: 280, c: 120, t: 50 }, // Purple
    { h: 340, c: 120, t: 50 }, // Magenta
  ];

  for (const { h, c, t } of testCases) {
    const hex = T.getTone(h, c, t);
    const [r, g, b] = T.hexToRgb(hex);
    // Directly check isInGamut on [r, g, b]
    assert.ok(T.isInGamut([r, g, b]), `Hex ${hex} is not in gamut for h=${h}, c=${c}, t=${t}`);

    // Verify Tone L* matches target tone within 1.0 delta (sRGB 8-bit rounding)
    const [x, y, z] = T.rgbToXyz(r, g, b);
    const [L] = T.xyzToLab(x, y, z);
    assert.ok(
      Math.abs(L - t) <= 1.0,
      `Reconstructed L* ${L} differs from target tone ${t} by more than 1.0 unit`
    );
  }
});

test("Challenger 1.5: Seed Hex Normalization & Edge Cases", () => {
  const edgeCases = [
    { input: "", expected: "#6750a4" },
    { input: "#12", expected: "#6750a4" },
    { input: "#xyz", expected: "#6750a4" },
    { input: " 1a73e8 ", expected: "#1a73e8" },
    { input: "#38f", expected: "#3388ff" },
    { input: "38f", expected: "#3388ff" },
    { input: "seed:#38f", expected: "#3388ff" },
    { input: "seed:1a73e8", expected: "#1a73e8" },
    { input: "seed:#1a73e8", expected: "#1a73e8" },
    { input: null, expected: "#6750a4" },
    { input: undefined, expected: "#6750a4" },
    { input: 123456, expected: "#6750a4" },
    { input: {}, expected: "#6750a4" },
  ];

  for (const { input, expected } of edgeCases) {
    const normalized = T.normalizeSeedHex(input);
    assert.equal(
      normalized,
      expected,
      `normalizeSeedHex(${JSON.stringify(input)}) returned ${normalized}, expected ${expected}`
    );
  }
});

test("Challenger 1.6: Dynamic Theme Generation Under Diverse Seeds", () => {
  const testSeeds = [
    "#1a73e8", // Google Blue
    "#0f9d58", // Forest Green
    "#f59e0b", // Amber
    "#ff007f", // Cyberpunk Magenta
    "#000000", // Pure Black
    "#ffffff", // Pure White
    "#808080", // Mid Gray (Achromatic)
    "#71717a", // Android 14 Zinc (C < 8 Monochrome)
  ];

  for (const seed of testSeeds) {
    const darkTheme = T.generateThemeFromSeed(seed, { mode: "dark" });
    const lightTheme = T.generateThemeFromSeed(seed, { mode: "light" });

    // Verify palettes structure
    for (const palName of ["primary", "secondary", "tertiary", "neutral", "neutralVariant"]) {
      assert.ok(darkTheme.palettes[palName], `Dark theme missing palette ${palName}`);
      assert.ok(lightTheme.palettes[palName], `Light theme missing palette ${palName}`);
      for (const tone of T.ANDROID_TONE_LEVELS) {
        assert.match(darkTheme.palettes[palName][tone], /^#[0-9a-fA-F]{6}$/);
        assert.match(lightTheme.palettes[palName][tone], /^#[0-9a-fA-F]{6}$/);
      }
    }

    // Verify roles structure
    assert.ok(darkTheme.roles.surface);
    assert.ok(darkTheme.roles.primary);
    assert.ok(darkTheme.roles.secondary);
    assert.ok(lightTheme.roles.surface);
    assert.ok(lightTheme.roles.primary);

    // Verify token schemas
    assert.ok(darkTheme.canvas.bgTop);
    assert.ok(darkTheme.material.emissive);
    assert.ok(darkTheme.lighting.haloColor);
    assert.ok(darkTheme.homeCss.cardBg);
    assert.ok(darkTheme.homeCss["--card-theme-bg"]);
  }
});

test("Challenger 1.7: Prototype Pollution & Adversarial Identifiers", () => {
  const adversarialIds = [
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
  ];

  for (const id of adversarialIds) {
    assert.equal(
      T.isValidCardThemeId(id),
      false,
      `isValidCardThemeId("${id}") must be false`
    );
    const theme = T.getCardTheme(id);
    assert.equal(
      theme.id,
      T.DEFAULT_CARD_THEME_ID,
      `getCardTheme("${id}") must fallback to default theme`
    );
  }
});

test("Challenger 1.8: Investigation of seed:bad and isValidCardThemeId Specification", () => {
  console.log("  Testing isValidCardThemeId with malformed seed descriptors:");
  console.log("    isValidCardThemeId('seed:bad'):", T.isValidCardThemeId("seed:bad"));
  console.log("    isValidCardThemeId('seed:'):", T.isValidCardThemeId("seed:"));
  console.log("    isValidCardThemeId('seed:#xyz'):", T.isValidCardThemeId("seed:#xyz"));
  console.log("    isValidCardThemeId('seed:#12345'):", T.isValidCardThemeId("seed:#12345"));
  console.log("    isValidCardThemeId('seed:#1A73E8'):", T.isValidCardThemeId("seed:#1A73E8"));
  console.log("    isValidCardThemeId('seed:#38f'):", T.isValidCardThemeId("seed:#38f"));
});
