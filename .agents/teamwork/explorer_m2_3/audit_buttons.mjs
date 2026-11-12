import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync("workspace-prototype/index.html", "utf8");

const srcFiles = fs.readdirSync("workspace-prototype/src").filter(f => f.endsWith(".ts"));
let allCode = "";
for (const file of srcFiles) {
  allCode += "\n" + fs.readFileSync(path.join("workspace-prototype/src", file), "utf8");
}

const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
let match;
let count = 0;
const buttons = [];

while ((match = buttonRegex.exec(html)) !== null) {
  count++;
  const attrs = match[1];
  const inner = match[2].trim().replace(/\s+/g, " ");
  const idMatch = attrs.match(/id=["']([^"']+)["']/i);
  const classMatch = attrs.match(/class=["']([^"']+)["']/i);
  const dataAttrs = [];
  const dataRegex = /(data-[\w-]+)(?:=["']([^"']*)["'])?/g;
  let d;
  while ((d = dataRegex.exec(attrs)) !== null) {
    dataAttrs.push(d[1] + (d[2] !== undefined ? "=" + d[2] : ""));
  }
  const id = idMatch ? idMatch[1] : null;
  const cls = classMatch ? classMatch[1] : null;
  
  let wired = false;
  let wireDetails = [];
  if (id) {
    if (allCode.includes(`"${id}"`) || allCode.includes(`'${id}'`) || allCode.includes(`#${id}`)) {
      wired = true;
      wireDetails.push("#" + id);
    }
  }
  for (const da of dataAttrs) {
    const key = da.split("=")[0];
    if (allCode.includes(`[${key}]`) || allCode.includes(`"${key}"`) || allCode.includes(key)) {
      wired = true;
      wireDetails.push(key);
    }
  }
  if (!wired && cls) {
    for (const c of cls.split(" ")) {
      if (allCode.includes(`.${c}`) || allCode.includes(`"${c}"`)) {
        wired = true;
        wireDetails.push("." + c);
      }
    }
  }

  const isSubmit = /type=["']submit["']/i.test(attrs);
  const isReset = /type=["']reset["']/i.test(attrs);

  buttons.push({
    num: count,
    id,
    cls,
    isSubmit,
    isReset,
    dataAttrs: dataAttrs.join(", "),
    inner: inner.slice(0, 50),
    wired,
    wireDetails: wireDetails.join(", ")
  });
}

console.log("Total buttons found in index.html:", count);
const unwired = buttons.filter(b => !b.wired && !b.isSubmit && !b.isReset);
console.log("Unwired / unreferenced buttons count:", unwired.length);
console.log(JSON.stringify(unwired, null, 2));

const allWired = buttons.map(b => ({
  num: b.num,
  id: b.id,
  cls: b.cls,
  type: b.isSubmit ? "submit" : b.isReset ? "reset" : "button",
  wired: b.wired || b.isSubmit || b.isReset,
  details: b.wireDetails || (b.isSubmit ? "form submit" : b.isReset ? "form reset" : "UNWIRED"),
  text: b.inner
}));

fs.writeFileSync(".agents/teamwork/explorer_m2_3/button_audit.json", JSON.stringify(allWired, null, 2));
console.log("Wrote button_audit.json");
