import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");
const poseTs = fs.readFileSync(path.join(workspaceDir, "src", "carousel-pose.ts"), "utf-8");
const compiledPose = ts.transpileModule(poseTs, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { carouselPoseFromAngle } = await import(
  `data:text/javascript;base64,${Buffer.from(compiledPose).toString("base64")}`
);

test("carousel poses carry cards through a visible spatial depth arc", () => {
  const front = carouselPoseFromAngle(0);
  const right = carouselPoseFromAngle(Math.PI / 2);
  const left = carouselPoseFromAngle(-Math.PI / 2);
  const rear = carouselPoseFromAngle(Math.PI);

  assert.ok(Math.abs(front.x) < 0.001);
  assert.ok(front.z > 2);
  assert.ok(right.x > 4);
  assert.ok(left.x < -4);
  assert.ok(Math.abs(right.z - left.z) < 0.001);
  assert.ok(rear.z < -4);
  assert.ok(front.scale > right.scale);
  assert.ok(right.scale > rear.scale);
  assert.ok(front.scale - rear.scale >= 0.39);
});

test("the 3D path drives rendered card position and scale while inactive faces stay edge-on", () => {
  assert.match(mainTs, /function orbitPositionFromAngle\(theta: number\): THREE\.Vector3[\s\S]*carouselPoseFromAngle\(theta\)/);
  assert.match(mainTs, /const targetScale = carouselPoseFromAngle\(card\.orbitAngle\)\.scale/);
  assert.match(mainTs, /card\.orbitAngle/);
});


