import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function load() {
  const source = await readFile(new URL("../src/room-environments.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(js)}`);
}

test("a room keeps its own lighting when no overlay is active", async () => {
  const { ROOM_ENVIRONMENTS, ROOM_ENVIRONMENT_ORDER, resolveStudioLighting, DEFAULT_COLOR_GRADE } = await load();
  for (const id of ROOM_ENVIRONMENT_ORDER) {
    const room = ROOM_ENVIRONMENTS[id];
    const lights = resolveStudioLighting(id, DEFAULT_COLOR_GRADE, false);
    assert.equal(lights.fill.color, room.lighting.fill.color, `${id} fill`);
    assert.equal(lights.rim.color, room.lighting.rim.color, `${id} rim`);
    assert.equal(lights.dusk.color, room.lighting.dusk.color, `${id} dusk`);
    assert.equal(lights.key.color, room.lighting.key.color, `${id} key`);
    assert.equal(lights.hemisphere.sky, room.lighting.hemisphere.sky, `${id} hemisphere`);
    assert.equal(lights.exposure, 1.12);
  }
});

test("secops tints the active room without flattening it", async () => {
  const { ROOM_ENVIRONMENTS, resolveStudioLighting, SECOPS_TINT } = await load();
  const room = ROOM_ENVIRONMENTS["pixel-studio"];
  const lights = resolveStudioLighting("pixel-studio", "twilight", true);

  assert.equal(lights.fill.color, SECOPS_TINT.fill);
  assert.equal(lights.rim.color, SECOPS_TINT.rim);
  assert.equal(lights.dusk.color, room.lighting.dusk.color);
  assert.equal(lights.key.color, room.lighting.key.color);
  assert.equal(lights.hemisphere.sky, room.lighting.hemisphere.sky);
  assert.equal(lights.fill.intensity, room.lighting.fill.intensity);
});

test("a colour grade wins over the room and over the secops tint", async () => {
  const { resolveStudioLighting, COLOR_GRADES } = await load();
  const grade = COLOR_GRADES.cyberpunk;
  const lights = resolveStudioLighting("sunset-library", "cyberpunk", true);

  assert.equal(lights.fill.color, grade.lights.fill);
  assert.equal(lights.rim.color, grade.lights.rim);
  assert.equal(lights.dusk.color, grade.lights.dusk);
  assert.equal(lights.exposure, grade.exposure);
  assert.equal(lights.halo.color, grade.halo.color);
  assert.equal(lights.floorGlow.intensity, grade.floorGlow.intensity);
});

test("switching rooms keeps the grade and the room it lands on", async () => {
  const { ROOM_ENVIRONMENTS, resolveStudioLighting } = await load();
  const lights = resolveStudioLighting("forest-emerald", "vintage", false);

  assert.equal(lights.fill.color, "#b45f06");
  assert.equal(lights.fill.intensity, ROOM_ENVIRONMENTS["forest-emerald"].lighting.fill.intensity);
  assert.equal(lights.key.color, ROOM_ENVIRONMENTS["forest-emerald"].lighting.key.color);
});

test("every room, grade and mode resolves to usable light values", async () => {
  const { ROOM_ENVIRONMENT_ORDER, COLOR_GRADES, resolveStudioLighting } = await load();
  for (const roomId of ROOM_ENVIRONMENT_ORDER) {
    for (const gradeId of Object.keys(COLOR_GRADES)) {
      for (const secOpsMode of [false, true]) {
        const lights = resolveStudioLighting(roomId, gradeId, secOpsMode);
        for (const light of [lights.key, lights.fill, lights.rim, lights.dusk]) {
          assert.match(light.color, /^#[0-9a-f]{6}$/i, `${roomId}/${gradeId}/${secOpsMode}`);
          assert.ok(Number.isFinite(light.intensity) && light.intensity > 0);
          assert.equal(light.position.length, 3);
        }
        assert.ok(Number.isFinite(lights.exposure));
      }
    }
  }
});

test("grade ids are validated before use", async () => {
  const { isColorGradeId } = await load();
  assert.equal(isColorGradeId("vintage"), true);
  assert.equal(isColorGradeId("neon"), false);
  assert.equal(isColorGradeId(undefined), false);
});
