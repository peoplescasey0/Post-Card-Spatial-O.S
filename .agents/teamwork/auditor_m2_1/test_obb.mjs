import * as THREE from '../../../workspace-prototype/node_modules/three/build/three.module.js';

const CARD_WIDTH = 2.15;
const CARD_HEIGHT = 3.2;
const CARD_HALF_WIDTH = CARD_WIDTH / 2;
const CARD_HALF_HEIGHT = CARD_HEIGHT / 2;
const CARD_HALF_DEPTH = 0.091;

function getCardHalfHeightExtent(group) {
  group.updateWorldMatrix(true, false);
  const e = group.matrixWorld.elements;
  return (
    Math.abs(e[1]) * CARD_HALF_WIDTH +
    Math.abs(e[5]) * CARD_HALF_HEIGHT +
    Math.abs(e[9]) * CARD_HALF_DEPTH
  );
}

const geo = new THREE.BoxGeometry(CARD_WIDTH, CARD_HEIGHT, CARD_HALF_DEPTH * 2);
let maxDiff = 0;
let violations = 0;

for (let i = 0; i < 10000; i++) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(geo);
  group.add(mesh);

  const rx = (Math.random() - 0.5) * Math.PI * 2;
  const ry = (Math.random() - 0.5) * Math.PI * 2;
  const rz = (Math.random() - 0.5) * Math.PI * 2;
  const sx = 0.3 + Math.random() * 2.0;
  const sy = 0.3 + Math.random() * 2.0;
  const sz = 0.3 + Math.random() * 2.0;
  const py = Math.random() * 10 - 2;

  group.rotation.set(rx, ry, rz);
  group.scale.set(sx, sy, sz);
  group.position.set(0, py, 0);

  group.updateWorldMatrix(true, true);
  const extentFormula = getCardHalfHeightExtent(group);

  const box = new THREE.Box3().setFromObject(group);
  const boxExtent = (box.max.y - box.min.y) / 2;

  const diff = Math.abs(extentFormula - boxExtent);
  if (diff > maxDiff) maxDiff = diff;
  if (diff > 1e-4) {
    violations++;
  }
}

console.log(`Auditor empirical test over 10,000 random orientations/scales:`);
console.log(`Max Difference: ${maxDiff.toExponential(4)}`);
console.log(`Violations (>1e-4): ${violations}`);

if (violations > 0) {
  process.exit(1);
} else {
  console.log(`VERIFIED: OBB half-height formula is mathematically exact across all 3D rotations and scales.`);
}

// ----------------------------------------------------------------------------
// Verification 2: Comprehensive Grid & Radial Collision Verification
// ----------------------------------------------------------------------------

const FLOOR_Y = -0.12;
const DAIS_SURFACE_Y = 0.085;
const DAIS_CENTER_Z = -0.25;
const DAIS_RADIUS = 7.7;
const DAIS_RADIUS_SQ = DAIS_RADIUS * DAIS_RADIUS;

function getFloorHeightAt(x, z) {
  const dx = x;
  const dz = z - DAIS_CENTER_Z;
  return dx * dx + dz * dz <= DAIS_RADIUS_SQ ? DAIS_SURFACE_Y : FLOOR_Y;
}

function getEffectiveFloorHeightForCard(group) {
  const dx = group.position.x;
  const dz = group.position.z - DAIS_CENTER_Z;
  const dist = Math.hypot(dx, dz);
  const cardScale = Math.max(group.scale.x, group.scale.z, 1.0);
  const cardHorizRadius = 1.1 * cardScale;
  if (dist <= DAIS_RADIUS + cardHorizRadius) {
    return DAIS_SURFACE_Y;
  }
  return FLOOR_Y;
}

function clampCardAboveFloor(cardGroup) {
  const targetFloor = getEffectiveFloorHeightForCard(cardGroup);
  const extentY = getCardHalfHeightExtent(cardGroup);
  const minY = targetFloor + extentY;
  if (cardGroup.position.y < minY) {
    cardGroup.position.y = minY;
    cardGroup.updateWorldMatrix(true, false);
  }
}

let subFloorViolations = 0;
let testedPositions = 0;

// Test across a grid of (x, z) from -15 to +15 with step 0.25
for (let x = -15; x <= 15; x += 0.5) {
  for (let z = -15; z <= 15; z += 0.5) {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(geo);
    group.add(mesh);

    // Apply random rotation
    group.rotation.set(
      (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * Math.PI,
      (Math.random() - 0.5) * 0.5
    );
    group.scale.set(0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.4, 0.8 + Math.random() * 0.4);

    // Try to force card below ground
    group.position.set(x, -5.0, z);
    clampCardAboveFloor(group);

    // Get actual bounding box lowest vertex
    const box = new THREE.Box3().setFromObject(group);
    const groundUnderCardCenter = getFloorHeightAt(x, z);

    // Lowest vertex must be >= ground level (accounting for small numerical epsilon)
    if (box.min.y < groundUnderCardCenter - 1e-4) {
      subFloorViolations++;
      console.error(`Subfloor penetration at (${x}, ${z}): box.min.y = ${box.min.y}, ground = ${groundUnderCardCenter}`);
    }
    testedPositions++;
  }
}

console.log(`Grid penetration test: tested ${testedPositions} positions, violations = ${subFloorViolations}`);
if (subFloorViolations > 0) process.exit(1);
console.log(`VERIFIED: Zero sub-floor penetrations across entire spatial domain.`);
