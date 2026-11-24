import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const btnTs = fs.readFileSync(path.join(workspaceDir, "src", "card-buttons.ts"), "utf-8");
const compiled = ts.transpileModule(btnTs, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { hitFlipDot, FLIP_DOT_LOCATIONS, FLIP_DOT_IDS } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("9-dot matrix provides 9 tactile touchpoints covering corners, edges, and center", () => {
  const dotIds = Object.keys(FLIP_DOT_LOCATIONS);
  assert.equal(dotIds.length, 9);
  assert.ok(dotIds.includes("top-left"));
  assert.ok(dotIds.includes("top-center"));
  assert.ok(dotIds.includes("top-right"));
  assert.ok(dotIds.includes("mid-left"));
  assert.ok(dotIds.includes("center"));
  assert.ok(dotIds.includes("mid-right"));
  assert.ok(dotIds.includes("btm-left"));
  assert.ok(dotIds.includes("btm-center"));
  assert.ok(dotIds.includes("btm-right"));

  for (const [id, loc] of Object.entries(FLIP_DOT_LOCATIONS)) {
    assert.ok(typeof loc.x === "number" && loc.x > 0 && loc.x < 640, `${id} x must be within canvas width`);
    assert.ok(typeof loc.y === "number" && loc.y > 0 && loc.y < 960, `${id} y must be within canvas height`);
    assert.ok(typeof loc.r === "number" && loc.r > 0, `${id} radius must be positive`);
  }
});

test("hitFlipDot resolves UV coordinates to correct tactile dot", () => {
  // top-left corner (u ~ 0.075, v ~ 0.95 in standard texture UV where v=1 is top)
  const dot = hitFlipDot(0.075, 0.95);
  assert.equal(dot, "top-left");

  // center (u ~ 0.5, v ~ 0.5)
  const centerDot = hitFlipDot(0.5, 0.5);
  assert.equal(centerDot, "center");

  // top-center
  assert.equal(hitFlipDot(0.5, 0.95), "top-center");

  // top-right
  assert.equal(hitFlipDot(0.925, 0.95), "top-right");

  // mid-left
  assert.equal(hitFlipDot(0.075, 0.5), "mid-left");

  // mid-right
  assert.equal(hitFlipDot(0.925, 0.5), "mid-right");

  // btm-left (v ~ 0.05 is bottom)
  assert.equal(hitFlipDot(0.075, 0.05), "btm-left");

  // btm-center
  assert.equal(hitFlipDot(0.5, 0.05), "btm-center");

  // btm-right
  assert.equal(hitFlipDot(0.925, 0.05), "btm-right");

  // Off-target locations return undefined
  assert.equal(hitFlipDot(0.25, 0.25), undefined);
  assert.equal(hitFlipDot(0.5, 0.7), undefined);
});
