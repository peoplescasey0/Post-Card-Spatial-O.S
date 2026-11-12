import fs from 'node:fs';

const html = fs.readFileSync('workspace-prototype/index.html', 'utf8');
const mainTs = fs.readFileSync('workspace-prototype/src/main.ts', 'utf8');

const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
let match;
const buttons = [];
while ((match = buttonRegex.exec(html)) !== null) {
  const attrs = match[1];
  const idMatch = attrs.match(/id="([^"]+)"/);
  const classMatch = attrs.match(/class="([^"]+)"/);
  const typeMatch = attrs.match(/type="([^"]+)"/);
  const dataMatches = [...attrs.matchAll(/(data-[a-z0-9_-]+)(?:="([^"]*)")?/g)].map(m => ({
    full: m[0],
    attr: m[1],
    val: m[2]
  }));
  const text = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  buttons.push({
    id: idMatch ? idMatch[1] : null,
    className: classMatch ? classMatch[1] : null,
    type: typeMatch ? typeMatch[1] : null,
    data: dataMatches,
    text
  });
}

console.log(`Checking ${buttons.length} buttons in index.html against main.ts...`);

const report = [];

for (const b of buttons) {
  let handled = false;
  let reason = '';

  // Check by ID
  if (b.id) {
    if (mainTs.includes(`"${b.id}"`) || mainTs.includes(`'${b.id}'`) || mainTs.includes(`#${b.id}`)) {
      handled = true;
      reason = `Matched ID #${b.id}`;
    }
  }

  // Check by data attributes
  if (!handled && b.data && b.data.length > 0) {
    for (const d of b.data) {
      if (mainTs.includes(d.attr) || (d.val && mainTs.includes(d.val))) {
        handled = true;
        reason = `Matched data attribute ${d.attr}`;
        break;
      }
    }
  }

  // Check by class
  if (!handled && b.className) {
    const classes = b.className.split(/\s+/);
    for (const c of classes) {
      if (mainTs.includes(`.${c}`) || mainTs.includes(`"${c}"`) || mainTs.includes(`'${c}'`)) {
        handled = true;
        reason = `Matched class .${c}`;
        break;
      }
    }
  }

  report.push({
    button: b,
    handled,
    reason
  });
}

const unhandled = report.filter(r => !r.handled);
console.log(`Handled: ${report.length - unhandled.length}, Unhandled: ${unhandled.length}`);
if (unhandled.length > 0) {
  console.log('Unhandled buttons:');
  console.log(JSON.stringify(unhandled, null, 2));
}
