import fs from "node:fs";
import path from "node:path";

const targetFile = path.resolve("workspace-prototype/tests/android-theming-integration.test.mjs");
const content = fs.readFileSync(targetFile, "utf-8");

// Extract all test(...) blocks
const testMatches = [...content.matchAll(/test\(\s*["']([^"']+)["']\s*,\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{([\s\S]*?)\n\}\);/g)];

console.log(`Found ${testMatches.length} tests in android-theming-integration.test.mjs`);

const testSummary = [];
let totalAssertions = 0;

for (const match of testMatches) {
  const name = match[1];
  const body = match[2];
  
  // Count assert calls
  const asserts = body.match(/assert\.[a-zA-Z0-9_]+\s*\(/g) || [];
  totalAssertions += asserts.length;

  testSummary.push({
    name,
    assertCount: asserts.length,
    hasCardThemesImports: /generateThemeFromSeed|getTone|getCardTheme|isValidCardThemeId|loadPersistedTheme|persistTheme/.test(body),
    hasDOMOrCSS: /homeEl|studioEl|SyntheticElement|htmlPath|cssPath|style\.css|index\.html/.test(body),
    hasThreeOrCanvas: /THREE|TrackingTexture|MockCanvas|computeCardContentKey|refreshCardTexture/.test(body),
    hasStorage: /MockLocalStorage|localStorage|loadPersistedTheme|persistTheme/.test(body),
  });
}

console.log(`Total assertions counted across test suite: ${totalAssertions}`);
console.log(`Tests with 0 assertions: ${testSummary.filter(t => t.assertCount === 0).length}`);

// Breakdown by tier
const tier1 = testSummary.filter(t => t.name.startsWith("Tier 1"));
const tier2 = testSummary.filter(t => t.name.startsWith("Tier 2"));
const tier3 = testSummary.filter(t => t.name.startsWith("Tier 3"));
const tier4 = testSummary.filter(t => t.name.startsWith("Tier 4"));

console.log(`Tier 1: ${tier1.length} tests, ${tier1.reduce((acc, t) => acc + t.assertCount, 0)} assertions`);
console.log(`Tier 2: ${tier2.length} tests, ${tier2.reduce((acc, t) => acc + t.assertCount, 0)} assertions`);
console.log(`Tier 3: ${tier3.length} tests, ${tier3.reduce((acc, t) => acc + t.assertCount, 0)} assertions`);
console.log(`Tier 4: ${tier4.length} tests, ${tier4.reduce((acc, t) => acc + t.assertCount, 0)} assertions`);
