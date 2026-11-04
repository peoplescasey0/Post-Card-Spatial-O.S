import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function loadButler() {
  const source = await readFile(new URL("../src/butler.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(js)}`);
}

const base = { idleSeconds: 0, guestRunning: false, serviceUnavailable: false, displayOpen: false };

test("butler stays quiet when all is well", async () => {
  const { butlerCheckIn } = await loadButler();
  assert.equal(butlerCheckIn(base), undefined);
});

test("butler offers help on guest errors first", async () => {
  const { butlerCheckIn } = await loadButler();
  const note = butlerCheckIn({ ...base, guestError: "QEMU exited", idleSeconds: 500, cardName: "Linux" });
  assert.match(note.message, /QEMU exited/);
  assert.ok(note.choices.includes("stuck"));
});

test("butler checks in after idling and when the service is down", async () => {
  const { butlerCheckIn, IDLE_CHECK_IN_SECONDS } = await loadButler();
  assert.ok(butlerCheckIn({ ...base, idleSeconds: IDLE_CHECK_IN_SECONDS }));
  assert.equal(butlerCheckIn({ ...base, serviceUnavailable: true }).key, "service");
});

test("every choice has a label and an answer", async () => {
  const { BUTLER_CHOICE_LABELS, butlerAnswer } = await loadButler();
  for (const id of Object.keys(BUTLER_CHOICE_LABELS)) {
    assert.ok(butlerAnswer(id, base).length > 0);
  }
});
