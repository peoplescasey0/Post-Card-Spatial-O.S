import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeJsonAtomically } from "../guest-api.mjs";

async function withDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "postcard-state-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("state files are written whole and leave no temporary files behind", async () => {
  await withDirectory(async (directory) => {
    const target = path.join(directory, "checkpoints.json");

    await writeJsonAtomically(target, { card: { tag: "one" } }, "test state");
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { card: { tag: "one" } });

    // Overwriting is the common case: every save replaces the live file.
    await writeJsonAtomically(target, { card: { tag: "two" } }, "test state");
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { card: { tag: "two" } });

    const leftovers = (await readdir(directory)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });
});

test("a failed write reports the labelled error and leaves no temp files", async () => {
  await withDirectory(async (directory) => {
    // A plain file where the state directory should be makes mkdir fail.
    const blocker = path.join(directory, "not-a-directory");
    await writeFile(blocker, "x", "utf8");

    await assert.rejects(
      () => writeJsonAtomically(path.join(blocker, "state.json"), {}, "network modes"),
      /Could not save network modes/,
    );

    const leftovers = (await readdir(directory)).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
  });
});
