import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");

test("main.ts imports room environments and defines applyRoomEnvironment", () => {
  assert.match(mainTs, /import\s*\{[^}]*getRoomEnvironment[^}]*\}\s*from\s*["']\.\/room-environments["']/);
  assert.match(mainTs, /function applyRoomEnvironment\(envId:\s*string\):\s*void/);
  assert.match(mainTs, /scene\.background\s*=/);
  assert.match(mainTs, /floor\.material/);
});

test("server monoliths and dais ticks are toggled conditionally based on room environment props", () => {
  assert.match(mainTs, /monolithBodyMat|towerGroup/);
  assert.match(mainTs, /env\.props\s*===\s*["']cyber-monoliths["']/);
});

test("applyRoomEnvironment updates lighting rigs and procedural prop groups", () => {
  assert.match(mainTs, /cyberMonolithsGroup\.visible/);
  assert.match(mainTs, /libraryGroup\.visible/);
  assert.match(mainTs, /studioGroup\.visible/);
  assert.match(mainTs, /keyLight\.color/);
  assert.match(mainTs, /fillLight\.color/);
  assert.match(mainTs, /duskLight\.color/);
});

test("main.ts calls applyRoomEnvironment on startup with persisted room environment", () => {
  assert.match(mainTs, /applyRoomEnvironment\(loadPersistedRoomEnvironment\(\)\)/);
});
