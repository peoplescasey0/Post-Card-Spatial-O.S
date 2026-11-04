import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function load() {
  const source = await readFile(new URL("../src/card-buttons.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(js)}`);
}

test("every printed button is hit at its own center and stays inside the card", async () => {
  const { CARD_BUTTON_IDS, cardButtonRect, hitCardButton } = await load();
  for (const [index, id] of CARD_BUTTON_IDS.entries()) {
    const r = cardButtonRect(index);
    assert.ok(r.x >= 48 && r.x + r.w <= 592 && r.y + r.h <= 810);
    assert.equal(hitCardButton((r.x + r.w / 2) / 640, 1 - (r.y + r.h / 2) / 960), id);
  }
});

test("gaps and the preview area are not buttons", async () => {
  const { hitCardButton } = await load();
  assert.equal(hitCardButton(0.5, 1 - 500 / 960), undefined);
  assert.equal(hitCardButton((48 + 130 + 4) / 640, 1 - 735 / 960), undefined);
});
