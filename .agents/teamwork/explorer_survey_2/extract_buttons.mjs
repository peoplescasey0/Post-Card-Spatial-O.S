import fs from 'node:fs';

const html = fs.readFileSync('workspace-prototype/index.html', 'utf8');
const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
let match;
const buttons = [];
while ((match = buttonRegex.exec(html)) !== null) {
  const attrs = match[1];
  const idMatch = attrs.match(/id="([^"]+)"/);
  const classMatch = attrs.match(/class="([^"]+)"/);
  const typeMatch = attrs.match(/type="([^"]+)"/);
  const dataMatches = [...attrs.matchAll(/(data-[a-z0-9_-]+)(?:="([^"]*)")?/g)].map(m => m[2] !== undefined ? `${m[1]}="${m[2]}"` : m[1]);
  const text = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  buttons.push({
    id: idMatch ? idMatch[1] : null,
    className: classMatch ? classMatch[1] : null,
    type: typeMatch ? typeMatch[1] : null,
    data: dataMatches.length > 0 ? dataMatches : null,
    text
  });
}

console.log(`Total buttons found: ${buttons.length}`);
console.log(JSON.stringify(buttons, null, 2));
