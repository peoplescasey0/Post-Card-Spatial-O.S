import fs from 'node:fs';
import path from 'node:path';

function findFiles(dir, filterFn, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findFiles(full, filterFn, acc);
    } else if (filterFn(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const suspicious = findFiles('.', (name) => {
  const lower = name.toLowerCase();
  return lower.endsWith('.log') || lower.includes('result') || lower.includes('output');
});

console.log('Suspicious pre-populated files found:');
suspicious.forEach(f => console.log(f));
console.log(`Total count: ${suspicious.length}`);
