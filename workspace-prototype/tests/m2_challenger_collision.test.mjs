/**
 * Adversarial Challenger M2 Test Suite: Card Collision & Floor Boundary Clamping
 *
 * Implements rigorous stress testing per Milestone M2 instructions:
 * 1. Extreme orientations: Euler rotations in X, Y, Z, tumble quaternions, pitch flips.
 * 2. Extreme scales: twisted cards (scale 1.18, 1.53), non-uniform scaling (scale.y = 1.53).
 * 3. Boundary transitions: dais rim (R = 7.7), overhang detection.
 * 4. Pointer dragging simulations: raycasting at Y = -5.0, -100.0.
 * 5. Vertex penetration oracle: under NO circumstance may any card vertex drop below dais (+0.085) or floor (-0.12).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";

const __filename = fileURLToPath(import.meta.url);
const testsDir = path.dirname(__filename);
const workspaceDir = path.resolve(testsDir, "..");
const mainTsPath = path.join(workspaceDir, "src", "main.ts");
const mainTs = fs.readFileSync(mainTsPath, "utf-8");

// Constants from main.ts
const FLOOR_Y = -0.12;
const DAIS_SURFACE_Y = 0.085;
const DAIS_CENTER_Z = -0.25;
const DAIS_RADIUS = 7.7;
const DAIS_RADIUS_SQ = DAIS_RADIUS * DAIS_RADIUS;

const CARD_WIDTH = 2.15;
const CARD_HEIGHT = 3.2;
const CARD_HALF_WIDTH = CARD_WIDTH / 2;   // 1.075
const CARD_HALF_HEIGHT = CARD_HEIGHT / 2; // 1.600
const CARD_HALF_DEPTH = 0.091;

// 1. Ground truth floor oracle
export function getFloorHeightAt(x, z) {
  const dx = x;
  const dz = z - DAIS_CENTER_Z;
  return dx * dx + dz * dz <= DAIS_RADIUS_SQ ? DAIS_SURFACE_Y : FLOOR_Y;
}

// 2. Extent Y as implemented in main.ts
export function getCardHalfHeightExtent(card) {
  card.group.updateWorldMatrix(true, false);
  const e = card.group.matrixWorld.elements;
  return (
    Math.abs(e[1]) * CARD_HALF_WIDTH +
    Math.abs(e[5]) * CARD_HALF_HEIGHT +
    Math.abs(e[9]) * CARD_HALF_DEPTH
  );
}

// 3. Current implementation of getEffectiveFloorHeightForCard in main.ts
export function getEffectiveFloorHeightCurrent(card) {
  const dx = card.group.position.x;
  const dz = card.group.position.z - DAIS_CENTER_Z;
  const dist = Math.hypot(dx, dz);
  const cardScale = Math.max(card.group.scale.x, card.group.scale.z, 1.0);
  const cardHorizRadius = 1.1 * cardScale;
  if (dist <= DAIS_RADIUS + cardHorizRadius) {
    return DAIS_SURFACE_Y;
  }
  return FLOOR_Y;
}

// 4. Clamping function matching main.ts:1117-1134
export function clampCardAboveFloor(card, useBox3 = false, floorFn = getEffectiveFloorHeightCurrent) {
  const targetFloor = floorFn(card);
  if (useBox3) {
    card.group.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(card.group);
    if (box.min.y < targetFloor) {
      card.group.position.y += targetFloor - box.min.y;
      card.group.updateWorldMatrix(true, false);
    }
  } else {
    const extentY = getCardHalfHeightExtent(card);
    const minY = targetFloor + extentY;
    if (card.group.position.y < minY) {
      card.group.position.y = minY;
      card.group.updateWorldMatrix(true, false);
    }
  }
}

// 5. Proposed Exact OBB Horizontal Footprint Fix
export function getEffectiveFloorHeightExactOBB(card) {
  card.group.updateWorldMatrix(true, false);
  const e = card.group.matrixWorld.elements;
  const dx = card.group.position.x;
  const dz = card.group.position.z - DAIS_CENTER_Z;
  const dist = Math.hypot(dx, dz);

  let maxHorizDist = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const hx = e[0] * sx * CARD_HALF_WIDTH + e[4] * sy * CARD_HALF_HEIGHT + e[8] * sz * CARD_HALF_DEPTH;
        const hz = e[2] * sx * CARD_HALF_WIDTH + e[6] * sy * CARD_HALF_HEIGHT + e[10] * sz * CARD_HALF_DEPTH;
        const r = Math.hypot(hx, hz);
        if (r > maxHorizDist) maxHorizDist = r;
      }
    }
  }

  return (dist <= DAIS_RADIUS + maxHorizDist) ? DAIS_SURFACE_Y : FLOOR_Y;
}

// 8 Local Bounding Corners
const LOCAL_CORNERS = [];
for (const sx of [-1, 1]) {
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      LOCAL_CORNERS.push(new THREE.Vector3(sx * CARD_HALF_WIDTH, sy * CARD_HALF_HEIGHT, sz * CARD_HALF_DEPTH));
    }
  }
}

export function evaluatePenetration(card) {
  card.group.updateWorldMatrix(true, false);
  let maxPenetration = 0;
  let worst = null;

  for (const corner of LOCAL_CORNERS) {
    const worldCorner = corner.clone().applyMatrix4(card.group.matrixWorld);
    const floorH = getFloorHeightAt(worldCorner.x, worldCorner.z);
    const pen = floorH - worldCorner.y;
    if (pen > 1e-4) {
      if (pen > maxPenetration) {
        maxPenetration = pen;
        worst = { worldPos: worldCorner, floorHeight: floorH, penetration: pen };
      }
    }
  }

  return { penetrated: maxPenetration > 0, maxPenetration, worst };
}

function createCard(options = {}) {
  const group = new THREE.Group();
  group.position.set(options.x ?? 0, options.y ?? 2.0, options.z ?? -0.25);
  if (options.scale !== undefined) {
    if (typeof options.scale === "number") {
      group.scale.set(options.scale, options.scale, options.scale);
    } else {
      group.scale.copy(options.scale);
    }
  }
  if (options.rotationX) group.rotation.x = options.rotationX;
  if (options.rotationY) group.rotation.y = options.rotationY;
  if (options.rotationZ) group.rotation.z = options.rotationZ;
  if (options.quaternion) group.quaternion.copy(options.quaternion);

  const geom = new THREE.BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_HALF_DEPTH * 2);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
  group.add(mesh);

  group.updateWorldMatrix(true, true);
  return { id: options.id ?? "card", group };
}

// ============================================================================
// EMPIRICAL CHALLENGER TESTS
// ============================================================================

test("Adversarial 1: Upright cards across dais interior, perimeter, and exterior floor", () => {
  // Center of dais
  const cDais = createCard({ x: 0, y: -20.0, z: -0.25 });
  clampCardAboveFloor(cDais, false);
  assert.equal(evaluatePenetration(cDais).penetrated, false);
  assert.ok(cDais.group.position.y >= DAIS_SURFACE_Y + CARD_HALF_HEIGHT);

  // Exterior floor
  const cFloor = createCard({ x: 15.0, y: -100.0, z: 0.0 });
  clampCardAboveFloor(cFloor, false);
  assert.equal(evaluatePenetration(cFloor).penetrated, false);
  assert.ok(cFloor.group.position.y >= FLOOR_Y + CARD_HALF_HEIGHT);

  // Rim boundary sweep while upright
  for (let r = 6.0; r <= 10.0; r += 0.1) {
    const cRim = createCard({ x: r, y: -5.0, z: -0.25 });
    clampCardAboveFloor(cRim, false);
    const res = evaluatePenetration(cRim);
    assert.equal(res.penetrated, false, `Upright card at r=${r} must not penetrate floor`);
  }
});

test("Adversarial 2: Bug Demonstration — Pitch flip (90 deg) near dais rim penetrates dais by 0.205 units", () => {
  // Distance from center = 8.877 (between 8.80 and 9.63)
  // Reached via valid pointer drag coordinates: x = -7.5, z = -5.0 (drag clamp allows [-7.8, 7.2] x [-6.6, 2.5])
  const card = createCard({ x: -7.5, y: -5.0, z: -5.0 });
  const bearingToCenter = Math.atan2(0 - (-7.5), -0.25 - (-5.0));
  card.group.rotation.y = bearingToCenter;
  card.group.rotation.x = -Math.PI / 2; // 90 degree pitch flip
  card.group.updateWorldMatrix(true, true);

  // Test against CURRENT main.ts implementation
  clampCardAboveFloor(card, false, getEffectiveFloorHeightCurrent);
  const currentResult = evaluatePenetration(card);

  // BUG CONFIRMATION: The current implementation penetrates the raised dais!
  assert.equal(currentResult.penetrated, true, "Current implementation exhibits penetration bug at dais boundary");
  assert.ok(
    currentResult.maxPenetration >= 0.20,
    `Penetration must reach ~0.205 units (actual: ${currentResult.maxPenetration})`
  );
  assert.equal(currentResult.worst.floorHeight, DAIS_SURFACE_Y, "Worst corner is on the raised dais (+0.085)");
  assert.ok(
    currentResult.worst.worldPos.y < 0,
    `Corner drops to sub-zero (${currentResult.worst.worldPos.y}) while dais is +0.085`
  );

  // VERIFICATION OF PROPOSED FIX: Exact OBB horizontal extent completely prevents penetration
  const fixedCard = createCard({ x: -7.5, y: -5.0, z: -5.0 });
  fixedCard.group.rotation.y = bearingToCenter;
  fixedCard.group.rotation.x = -Math.PI / 2;
  fixedCard.group.updateWorldMatrix(true, true);

  clampCardAboveFloor(fixedCard, false, getEffectiveFloorHeightExactOBB);
  const fixedResult = evaluatePenetration(fixedCard);
  assert.equal(fixedResult.penetrated, false, "Proposed OBB fix must eliminate penetration completely");
});

test("Adversarial 3: Bug Demonstration — Non-uniform scaling (scale.y = 1.53) creates 1.57-unit blind spot", () => {
  // Current code only inspects Math.max(scale.x, scale.z, 1.0), ignoring scale.y!
  // At scale.y = 1.53, card height is 4.896 (half-height 2.448).
  // At 60 deg pitch, horizontal extent is 2.448 * sin(60) = 2.12 units.
  const r = 9.2; // 9.2 > 8.8 (7.7 + 1.1)
  const card = createCard({
    x: 0,
    y: -5.0,
    z: DAIS_CENTER_Z + r,
    scale: new THREE.Vector3(1.0, 1.53, 1.0),
    rotationX: Math.PI / 2, // 90 deg pitch
  });

  clampCardAboveFloor(card, false, getEffectiveFloorHeightCurrent);
  const res = evaluatePenetration(card);
  assert.equal(res.penetrated, true, "Non-uniform scaling with pitch penetrates dais");
  assert.ok(res.maxPenetration >= 0.20);

  // Fixed OBB check
  const fixedCard = createCard({
    x: 0,
    y: -5.0,
    z: DAIS_CENTER_Z + r,
    scale: new THREE.Vector3(1.0, 1.53, 1.0),
    rotationX: Math.PI / 2,
  });
  clampCardAboveFloor(fixedCard, false, getEffectiveFloorHeightExactOBB);
  assert.equal(evaluatePenetration(fixedCard).penetrated, false);
});

test("Adversarial 4: Sweep of 500 Random 3D Tumble Quaternions across boundary", () => {
  let currentFailures = 0;
  let fixedFailures = 0;

  for (let i = 0; i < 500; i++) {
    const sx = 0.8 + ((i * 0.17) % 1.0);
    const sy = 0.8 + ((i * 0.23) % 1.2);
    const sz = 0.8 + ((i * 0.11) % 0.8);

    const r = 7.0 + ((i * 1.618) % 3.5);
    const angle = (i * 0.53) % (2 * Math.PI);
    const pos = new THREE.Vector3(Math.cos(angle) * r, -5.0, DAIS_CENTER_Z + Math.sin(angle) * r);

    const euler = new THREE.Euler(
      (i * 0.31) % (2 * Math.PI),
      (i * 0.47) % (2 * Math.PI),
      (i * 0.73) % (2 * Math.PI)
    );

    // Current
    const cardCurrent = createCard({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      scale: new THREE.Vector3(sx, sy, sz),
    });
    cardCurrent.group.quaternion.setFromEuler(euler);
    clampCardAboveFloor(cardCurrent, false, getEffectiveFloorHeightCurrent);
    if (evaluatePenetration(cardCurrent).penetrated) currentFailures++;

    // Fixed
    const cardFixed = createCard({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      scale: new THREE.Vector3(sx, sy, sz),
    });
    cardFixed.group.quaternion.setFromEuler(euler);
    clampCardAboveFloor(cardFixed, false, getEffectiveFloorHeightExactOBB);
    if (evaluatePenetration(cardFixed).penetrated) fixedFailures++;
  }

  assert.ok(currentFailures > 0, `Current implementation must fail random tumble sweep (failed ${currentFailures}/500)`);
  assert.equal(fixedFailures, 0, `Fixed implementation must pass 100% of random tumble sweep (failed ${fixedFailures}/500)`);
});

test("Adversarial 5: Pointer Dragging Simulation with Extreme Negative Y (-100.0)", () => {
  // Test drag on floor: clamping to obsidian floor (-0.12) is safe when card is strictly outside dais
  const cardFarFloor = createCard({ x: 12.0, y: -100.0, z: 0.0 });
  clampCardAboveFloor(cardFarFloor, false, getEffectiveFloorHeightCurrent);
  assert.equal(evaluatePenetration(cardFarFloor).penetrated, false);
  assert.equal(cardFarFloor.group.position.y, FLOOR_Y + CARD_HALF_HEIGHT);

  // Test drag on dais: clamping to dais (+0.085) is safe when card is strictly inside dais
  const cardCenterDais = createCard({ x: 0.0, y: -100.0, z: -0.25 });
  clampCardAboveFloor(cardCenterDais, false, getEffectiveFloorHeightCurrent);
  assert.equal(evaluatePenetration(cardCenterDais).penetrated, false);
  assert.equal(cardCenterDais.group.position.y, DAIS_SURFACE_Y + CARD_HALF_HEIGHT);
});
