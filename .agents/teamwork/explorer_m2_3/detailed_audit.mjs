import fs from "node:fs";

const html = fs.readFileSync("workspace-prototype/index.html", "utf8");
const mainTs = fs.readFileSync("workspace-prototype/src/main.ts", "utf8");

const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
let match;
let count = 0;
const results = [];

while ((match = buttonRegex.exec(html)) !== null) {
  count++;
  const attrs = match[1];
  const inner = match[2].trim().replace(/\s+/g, " ").replace(/<[^>]+>/g, "").trim();
  const idMatch = attrs.match(/id=["']([^"']+)["']/i);
  const classMatch = attrs.match(/class=["']([^"']+)["']/i);
  const typeMatch = attrs.match(/type=["']([^"']+)["']/i);
  const dataAttrs = [];
  const dataRegex = /(data-[\w-]+)(?:=["']([^"']*)["'])?/g;
  let d;
  while ((d = dataRegex.exec(attrs)) !== null) {
    dataAttrs.push({ key: d[1], val: d[2] });
  }
  const id = idMatch ? idMatch[1] : null;
  const cls = classMatch ? classMatch[1] : null;
  const type = typeMatch ? typeMatch[1] : "submit"; // HTML default for button is submit!

  // Context: find enclosing dialog or section
  const htmlBefore = html.slice(0, match.index);
  const lastDialogMatch = [...htmlBefore.matchAll(/<dialog\b[^>]*\bid=["']([^"']+)["']/gi)].pop();
  const enclosingDialog = lastDialogMatch ? lastDialogMatch[1] : null;
  const lastSectionMatch = [...htmlBefore.matchAll(/<(?:section|main|header|nav)\b[^>]*\bclass=["']([^"']+)["']/gi)].pop();
  const enclosingSection = lastSectionMatch ? lastSectionMatch[1] : null;

  // Check event listeners or handlers in mainTs
  const findings = [];

  if (id) {
    // Check if queried by id
    const idRef = new RegExp(`["']#?${id}["']`, "g");
    const found = mainTs.match(idRef);
    if (found) {
      findings.push(`ID referenced (${found.length} times)`);
    } else {
      findings.push(`ID not referenced in main.ts`);
    }
  }

  for (const { key, val } of dataAttrs) {
    if (mainTs.includes(key)) {
      findings.push(`data attribute ${key} handled`);
    } else {
      findings.push(`data attribute ${key} NOT in main.ts`);
    }
  }

  results.push({
    num: count,
    id,
    type,
    cls,
    text: inner.slice(0, 35),
    dialog: enclosingDialog,
    section: enclosingSection,
    findings: findings.join("; ")
  });
}

fs.writeFileSync(".agents/teamwork/explorer_m2_3/detailed_button_audit.json", JSON.stringify(results, null, 2));

// Summary by container
const byContainer = {};
for (const r of results) {
  const container = r.dialog ? `dialog#${r.dialog}` : (r.section || "root");
  byContainer[container] = (byContainer[container] || 0) + 1;
}

console.log("Button counts by container:", JSON.stringify(byContainer, null, 2));
console.log("Total buttons:", results.length);
