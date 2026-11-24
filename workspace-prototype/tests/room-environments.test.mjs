import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roomTs = fs.readFileSync(path.join(workspaceDir, "src", "room-environments.ts"), "utf-8");
const compiled = ts.transpileModule(roomTs, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const {
  ROOM_ENVIRONMENT_IDS,
  ROOM_ENVIRONMENTS,
  getRoomEnvironment,
  isValidRoomEnvironmentId,
  loadPersistedRoomEnvironment,
  persistRoomEnvironment,
  DEFAULT_ROOM_ENVIRONMENT_ID,
  ROOM_ENVIRONMENT_STORAGE_KEY,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("room environments catalog provides all 6 distinct environments with valid PBR and lighting schemas", () => {
  assert.equal(ROOM_ENVIRONMENT_IDS.length, 6);
  assert.deepEqual(ROOM_ENVIRONMENT_IDS, [
    "pixel-studio",
    "sunset-library",
    "forest-emerald",
    "lavender-mist",
    "obsidian-monochrome",
    "cyber-mainframe",
  ]);

  for (const id of ROOM_ENVIRONMENT_IDS) {
    const env = getRoomEnvironment(id);
    assert.equal(env.id, id);
    assert.ok(env.name, `Environment ${id} must have a name`);
    assert.ok(env.description, `Environment ${id} must have a description`);
    assert.ok(env.background.startsWith("#"), `Environment ${id} background must be a valid hex color`);

    assert.ok(typeof env.floor.roughness === "number", `Environment ${id} floor roughness must be number`);
    assert.ok(typeof env.floor.metalness === "number", `Environment ${id} floor metalness must be number`);
    assert.ok(env.floor.color.startsWith("#"), `Environment ${id} floor color must be a valid hex color`);

    assert.ok(env.fog.color.startsWith("#"), `Environment ${id} fog color must be a valid hex color`);
    assert.ok(typeof env.fog.density === "number", `Environment ${id} fog density must be number`);

    assert.ok(env.lighting.ambientColor.startsWith("#"), `Environment ${id} ambientColor must be hex`);
    assert.ok(typeof env.lighting.ambientIntensity === "number");
    assert.ok(env.lighting.keyColor.startsWith("#"), `Environment ${id} keyColor must be hex`);
    assert.ok(typeof env.lighting.keyIntensity === "number");
    assert.ok(Array.isArray(env.lighting.keyPosition) && env.lighting.keyPosition.length === 3);
    assert.ok(env.lighting.fillColor.startsWith("#"), `Environment ${id} fillColor must be hex`);
    assert.ok(typeof env.lighting.fillIntensity === "number");
    assert.ok(env.lighting.duskColor.startsWith("#"), `Environment ${id} duskColor must be hex`);
    assert.ok(typeof env.lighting.duskIntensity === "number");

    assert.ok(env.props, `Environment ${id} must have props assigned`);
    assert.ok(
      ["library-shelves", "studio-frames", "botanical-baffles", "cyber-monoliths", "minimal"].includes(env.props),
      `Environment ${id} props must match valid prop types`
    );
    assert.equal(typeof env.showCosmicStarfield, "boolean");
  }
});

test("getRoomEnvironment falls back to default on invalid or unknown id", () => {
  const fallback = getRoomEnvironment("non-existent-room");
  assert.equal(fallback.id, DEFAULT_ROOM_ENVIRONMENT_ID);
  assert.equal(fallback.name, "Pixel Studio");

  const nullFallback = getRoomEnvironment(null);
  assert.equal(nullFallback.id, DEFAULT_ROOM_ENVIRONMENT_ID);
});

test("isValidRoomEnvironmentId guards known identifiers", () => {
  assert.equal(isValidRoomEnvironmentId("pixel-studio"), true);
  assert.equal(isValidRoomEnvironmentId("sunset-library"), true);
  assert.equal(isValidRoomEnvironmentId("forest-emerald"), true);
  assert.equal(isValidRoomEnvironmentId("lavender-mist"), true);
  assert.equal(isValidRoomEnvironmentId("obsidian-monochrome"), true);
  assert.equal(isValidRoomEnvironmentId("cyber-mainframe"), true);
  assert.equal(isValidRoomEnvironmentId("cyberpunk"), false);
  assert.equal(isValidRoomEnvironmentId(""), false);
  assert.equal(isValidRoomEnvironmentId(123), false);
  assert.equal(isValidRoomEnvironmentId(null), false);
});

test("room environment persistence roundtrips through localStorage with fallback to default", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, String(v)),
  };

  assert.equal(ROOM_ENVIRONMENT_STORAGE_KEY, "postcard_studio_room_env");
  assert.equal(loadPersistedRoomEnvironment(), DEFAULT_ROOM_ENVIRONMENT_ID);

  persistRoomEnvironment("sunset-library");
  assert.equal(loadPersistedRoomEnvironment(), "sunset-library");

  persistRoomEnvironment("cyber-mainframe");
  assert.equal(loadPersistedRoomEnvironment(), "cyber-mainframe");

  // Invalid value stored in storage falls back to default
  storage.set(ROOM_ENVIRONMENT_STORAGE_KEY, "invalid-env-name");
  assert.equal(loadPersistedRoomEnvironment(), DEFAULT_ROOM_ENVIRONMENT_ID);
});

test("room environment persistence handles localStorage exceptions gracefully", () => {
  globalThis.localStorage = {
    getItem: () => {
      throw new Error("SecurityError: Access is denied");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };

  assert.doesNotThrow(() => {
    const loaded = loadPersistedRoomEnvironment();
    assert.equal(loaded, DEFAULT_ROOM_ENVIRONMENT_ID);
  });

  assert.doesNotThrow(() => {
    persistRoomEnvironment("forest-emerald");
  });
});

