import fs from 'node:fs';
import * as themes from '../../../workspace-prototype/src/card-themes.ts';

const testFile = 'workspace-prototype/tests/android-theming-integration.test.mjs';
const content = fs.readFileSync(testFile, 'utf-8');

console.log('=== ADVERSARIAL CHECK 1: USAGE OF ALL 28 IMPORTED SYMBOLS ===');
const importedSymbols = [
  'CARD_THEME_IDS', 'ANDROID_THEME_IDS', 'ALL_PRESET_THEME_IDS', 'DEFAULT_CARD_THEME_ID',
  'THEME_STORAGE_KEY', 'CARD_THEME_STORAGE_KEY', 'ANDROID_TONE_LEVELS', 'ANDROID_PRESETS',
  'ANDROID_PRESET_THEMES', 'ANDROID_THEMES', 'CANONICAL_THEMES', 'CARD_THEMES',
  'srgbToLinear', 'linearToSrgb', 'rgbToXyz', 'xyzToLab', 'labToLch', 'lchToLab',
  'labToXyz', 'xyzToRgb', 'isInGamut', 'hexToRgb', 'rgbToHex', 'hexToRgba',
  'normalizeSeedHex', 'getTone', 'generateThemeFromSeed', 'isValidCardThemeId',
  'getCardTheme', 'loadPersistedTheme', 'persistTheme'
];

importedSymbols.forEach(sym => {
  // Count occurrences after the import block (line 51 onwards)
  const afterImport = content.slice(content.indexOf('} from "../src/card-themes.ts";') + 30);
  const regex = new RegExp(`\\b${sym}\\b`, 'g');
  const count = (afterImport.match(regex) || []).length;
  console.log(`Symbol ${sym.padEnd(25)}: used ${count} times in tests`);
  if (count === 0) {
    console.log(`WARNING: Unused symbol ${sym}`);
  }
});

console.log('\n=== ADVERSARIAL CHECK 2: LOCALSTORAGE ISOLATION & CLEANUP ===');
// Check if localStorage is assigned and restored or cleaned
const hasLocalStorageAssign = content.includes('globalThis.localStorage =');
console.log(`globalThis.localStorage is mocked: ${hasLocalStorageAssign}`);

console.log('\n=== ADVERSARIAL CHECK 3: EMPIRICAL DIVERGENCE ACROSS ALL PRESETS ===');
// Verify that all 5 android presets produce unique accent, background, and surface colors
const presetAccents = new Set();
const presetSurfaces = new Set();
const presetHalos = new Set();
for (const id of themes.ANDROID_THEME_IDS) {
  const t = themes.getCardTheme(id);
  presetAccents.add(t.homeCss.cardAccent);
  presetSurfaces.add(t.roles.surface);
  presetHalos.add(t.lighting.haloColor);
  console.log(`Preset ${id.padEnd(20)}: accent=${t.homeCss.cardAccent}, surface=${t.roles.surface}, halo=${t.lighting.haloColor}`);
}
console.log(`Unique accents: ${presetAccents.size}/5, Unique surfaces: ${presetSurfaces.size}/5, Unique halos: ${presetHalos.size}/5`);

console.log('\n=== ADVERSARIAL CHECK 4: PRODUCTION DOM CONSISTENCY ===');
const html = fs.readFileSync('workspace-prototype/index.html', 'utf-8');
const chips = [...html.matchAll(/data-theme-id="([^"]+)"/g)].map(m => m[1]);
console.log(`index.html declared theme chips: ${JSON.stringify(chips)}`);
console.log(`Matches CANONICAL_THEMES exactly: ${JSON.stringify(chips) === JSON.stringify(themes.CARD_THEME_IDS)}`);
