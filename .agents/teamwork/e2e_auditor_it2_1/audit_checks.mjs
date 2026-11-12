import fs from 'node:fs';

const testFile = 'workspace-prototype/tests/android-theming-integration.test.mjs';
const content = fs.readFileSync(testFile, 'utf-8');
const lines = content.split('\n');

console.log('=== CHECK 1: STORAGE PERSISTENCE CALLS ===');
lines.forEach((line, i) => {
  if (line.includes('loadPersistedTheme') || line.includes('persistTheme')) {
    console.log(`${i + 1}: ${line.trim()}`);
  }
});

console.log('\n=== CHECK 2: PHANTOM UI CONTROLS (#theme-seed-picker) ===');
lines.forEach((line, i) => {
  if (line.includes('theme-seed-picker') || line.includes('seed-picker')) {
    console.log(`${i + 1}: ${line.trim()}`);
  }
});
if (!content.includes('theme-seed-picker')) {
  console.log('PASSED: Exactly 0 occurrences of theme-seed-picker');
}

console.log('\n=== CHECK 3: PRODUCTION DOM INSPECTION (index.html) ===');
const indexHtmlMentions = lines.filter((l, i) => l.includes('index.html') || l.includes('htmlPath'));
console.log(`Found ${indexHtmlMentions.length} lines referencing index.html / htmlPath`);

console.log('\n=== CHECK 4: 11 NON-TAUTOLOGICAL REPLACEMENTS ===');
const targetTiers = [
  'Tier 1.16', 'Tier 1.17', 'Tier 1.19', 'Tier 1.29',
  'Tier 2.16', 'Tier 2.18', 'Tier 2.19', 'Tier 2.20', 'Tier 2.27',
  'Tier 3.4', 'Tier 3.5'
];

targetTiers.forEach(tier => {
  const lineIdx = lines.findIndex(l => l.includes(tier));
  if (lineIdx !== -1) {
    console.log(`FOUND ${tier} at line ${lineIdx + 1}: ${lines[lineIdx].trim()}`);
  } else {
    console.log(`MISSING: ${tier}`);
  }
});
