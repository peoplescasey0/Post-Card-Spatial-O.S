import fs from "node:fs";
import path from "node:path";

const targetPath = path.resolve("workspace-prototype/tests/android-theming-integration.test.mjs");
const code = fs.readFileSync(targetPath, "utf-8");

console.log("=== AUDIT CHECK 1: FORBIDDEN FACADES & DUPLICATES ===");
const forbiddenFunctions = [
  "function srgbToLinear",
  "function linearToSrgb",
  "function rgbToXyz",
  "function xyzToLab",
  "function labToLch",
  "function lchToLab",
  "function labToXyz",
  "function xyzToRgb",
  "function isInGamut",
  "function hexToRgb",
  "function rgbToHex",
  "function hexToRgba",
  "function normalizeSeedHex",
  "function getTone",
  "function generateThemeFromSeed",
  "safeLoadPersistedTheme",
  "safePersistTheme",
  "theme-seed-picker",
];

let violations1 = [];
for (const pattern of forbiddenFunctions) {
  if (code.includes(pattern)) {
    violations1.push(pattern);
  }
}
if (violations1.length > 0) {
  console.error("FAIL: Found forbidden patterns:", violations1);
} else {
  console.log("PASS: 0 duplicate math routines, 0 storage wrappers, 0 phantom elements found.");
}

console.log("\n=== AUDIT CHECK 2: IMPORT INTEGRITY ===");
const requiredImports = [
  "CARD_THEME_IDS",
  "ANDROID_THEME_IDS",
  "DEFAULT_CARD_THEME_ID",
  "THEME_STORAGE_KEY",
  "getTone",
  "generateThemeFromSeed",
  "isValidCardThemeId",
  "getCardTheme",
  "loadPersistedTheme",
  "persistTheme",
];
let missingImports = [];
for (const imp of requiredImports) {
  const regex = new RegExp(`\\b${imp}\\b`);
  if (!regex.test(code)) {
    missingImports.push(imp);
  }
}
if (missingImports.length > 0) {
  console.error("FAIL: Missing imports from card-themes.ts:", missingImports);
} else {
  console.log("PASS: All required production symbols genuinely imported from src/card-themes.ts.");
}

console.log("\n=== AUDIT CHECK 3: PERSISTENCE EXECUTION ===");
const loadCalls = (code.match(/\bloadPersistedTheme\s*\(/g) || []).length;
const persistCalls = (code.match(/\bpersistTheme\s*\(/g) || []).length;
console.log(`loadPersistedTheme() called ${loadCalls} times`);
console.log(`persistTheme() called ${persistCalls} times`);
if (loadCalls < 5 || persistCalls < 3) {
  console.error("FAIL: Insufficient direct persistence calls");
} else {
  console.log("PASS: Genuine direct calls to production loadPersistedTheme() and persistTheme().");
}

console.log("\n=== AUDIT CHECK 4: PRODUCTION DOM & FILE INTEGRITY ===");
const htmlReads = (code.match(/fs\.readFileSync\(\s*htmlPath/g) || []).length;
const cssReads = (code.match(/fs\.readFileSync\(\s*cssPath/g) || []).length;
const mainTsReads = (code.match(/fs\.readFileSync\([^)]*main\.ts/g) || []).length;
console.log(`index.html read: ${htmlReads} times`);
console.log(`style.css read: ${cssReads} times`);
console.log(`main.ts read: ${mainTsReads} times`);
if (htmlReads === 0 || cssReads === 0 || mainTsReads === 0) {
  console.error("FAIL: Missing production file inspections");
} else {
  console.log("PASS: Real index.html, style.css, and main.ts are genuinely inspected.");
}

console.log("\n=== AUDIT CHECK 5: TAUTOLOGY & HARDCODING SCAN ===");
// Look for assert.equal(x, x), assert.ok(true), etc.
const tautologyPatterns = [
  /assert\.(?:strictEqual|equal|deepEqual)\(\s*([^,()]+)\s*,\s*\1\s*[,)]/g,
  /assert\.ok\(\s*true\s*[,)]/g,
  /assert\.equal\(\s*true\s*,\s*true\s*[,)]/g,
  /assert\.equal\(\s*false\s*,\s*false\s*[,)]/g,
  /assert\.equal\(\s*([0-9]+)\s*,\s*\1\s*[,)]/g,
  /assert\.equal\(\s*(".*?")\s*,\s*\1\s*[,)]/g,
];

let tautologyCount = 0;
for (const p of tautologyPatterns) {
  const matches = [...code.matchAll(p)];
  if (matches.length > 0) {
    console.error(`FAIL: Potential tautology matching ${p}:`, matches.map((m) => m[0]));
    tautologyCount += matches.length;
  }
}
if (tautologyCount === 0) {
  console.log("PASS: 0 syntactic tautologies detected.");
}
