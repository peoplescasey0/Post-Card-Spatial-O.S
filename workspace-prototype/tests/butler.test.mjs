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

test("short prompts route to the matching control", async () => {
  const { butlerInterpretPrompt } = await loadButler();
  assert.equal(butlerInterpretPrompt("zoom in", base).action, "zoom");
  assert.equal(butlerInterpretPrompt("zoom out", base).action, "unzoom");
  assert.equal(butlerInterpretPrompt("change the room", base).action, "next-room");
  assert.equal(butlerInterpretPrompt("switch card style", base).action, "next-style");
  assert.equal(butlerInterpretPrompt("add another card", base).action, "new-instance");
  assert.equal(butlerInterpretPrompt("open the bin", base).action, "bin");
  assert.equal(butlerInterpretPrompt("install the guest", base).action, "install");
});

test("questions fall through to the notebook topics", async () => {
  const { butlerInterpretPrompt } = await loadButler();
  const keys = butlerInterpretPrompt("what are the keyboard shortcuts", base);
  assert.equal(keys.topic, "keys");
  assert.match(keys.reply, /Ctrl\+K/);

  const rooms = butlerInterpretPrompt("which rooms can i pick", base);
  assert.equal(rooms.topic, "rooms");
  assert.match(rooms.reply, /Sunset Library/);

  const bin = butlerInterpretPrompt("where is the bin", base);
  assert.equal(bin.choice, "bin");

  const savepoints = butlerInterpretPrompt("how do savepoints work", base);
  assert.equal(savepoints.topic, "savepoints");
});

test("card commands are left for the card, not the notebook", async () => {
  const { butlerInterpretPrompt } = await loadButler();
  assert.deepEqual(butlerInterpretPrompt("recon ports", base), {});
  assert.deepEqual(butlerInterpretPrompt("ls -la /etc", base), {});
  assert.deepEqual(butlerInterpretPrompt("audit suid binaries", base), {});
});

test("every choice has a label and an answer", async () => {
  const { BUTLER_CHOICE_LABELS, butlerAnswer } = await loadButler();
  for (const id of Object.keys(BUTLER_CHOICE_LABELS)) {
    assert.ok(butlerAnswer(id, base).length > 0);
  }
});

test("known phrasing answers without asking the router", async () => {
  const { butlerInterpretPromptWithRouter } = await loadButler();
  let calls = 0;
  const route = async () => {
    calls += 1;
    return { action: "next-room" };
  };

  assert.equal((await butlerInterpretPromptWithRouter("zoom in", base, route)).action, "zoom");
  assert.equal((await butlerInterpretPromptWithRouter("how do savepoints work", base, route)).topic, "savepoints");
  assert.equal((await butlerInterpretPromptWithRouter("where is the bin", base, route)).choice, "bin");
  assert.equal(calls, 0);
});

test("unmatched prompts ask the router once and use its answer", async () => {
  const { butlerInterpretPromptWithRouter } = await loadButler();
  const prompt = "undo everything since breakfast";
  const seen = [];
  const routed = await butlerInterpretPromptWithRouter(prompt, base, async (text) => {
    seen.push(text);
    return { topic: "savepoints" };
  });

  assert.deepEqual(seen, [prompt]);
  assert.equal(routed.topic, "savepoints");
});

test("a router that finds nothing leaves the prompt to be confirmed", async () => {
  const { butlerInterpretPromptWithRouter, butlerNeedsRouter } = await loadButler();
  const prompt = "undo everything since breakfast";

  const nothing = await butlerInterpretPromptWithRouter(prompt, base, async () => undefined);
  assert.deepEqual(nothing, {});
  assert.equal(butlerNeedsRouter(nothing), true);

  assert.equal(butlerNeedsRouter({ action: "zoom" }), false);
  assert.equal(butlerNeedsRouter({ topic: "savepoints" }), false);
  assert.equal(butlerNeedsRouter({ reply: "Done." }), false);
  assert.equal(butlerNeedsRouter({ choice: "dismiss" }), false);
});
