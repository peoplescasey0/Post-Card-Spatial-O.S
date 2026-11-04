import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");
const readme = fs.readFileSync(path.join(workspaceDir, "README.md"), "utf-8");
const roadmap = fs.readFileSync(path.join(workspaceDir, "ROADMAP.md"), "utf-8");

test("the guest display preview occupies about one quarter of a card face", () => {
  const width = Number(mainTs.match(/const GUEST_PREVIEW_WIDTH = (\d+);/)?.[1]);
  const height = Number(mainTs.match(/const GUEST_PREVIEW_HEIGHT = (\d+);/)?.[1]);
  assert.ok(Number.isFinite(width) && Number.isFinite(height));
  const footprint = (width * height) / (640 * 960);
  assert.ok(footprint >= 0.24 && footprint <= 0.26, `preview footprint was ${footprint}`);

  const start = mainTs.indexOf("function drawMockDisplay(");
  const end = mainTs.indexOf("function drawCardSettings(", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const drawPreview = mainTs.slice(start, end);
  assert.match(drawPreview, /const width = GUEST_PREVIEW_WIDTH;/);
  assert.match(drawPreview, /const height = GUEST_PREVIEW_HEIGHT;/);
  assert.match(drawPreview, /card\.liveCanvas && card === selectedCard/);
  assert.match(drawPreview, /PRIVATE DISPLAY/);
  assert.match(drawPreview, /card === selectedCard && card\.serialOutput/);
});

test("selection turns cards edge-on and refreshes private previews across selection routes", () => {
  const rotationStart = mainTs.indexOf("function cardDisplayRotation(");
  const rotationEnd = mainTs.indexOf("function wheelPosition(", rotationStart);
  assert.notEqual(rotationStart, -1);
  assert.notEqual(rotationEnd, -1);
  const displayRotation = mainTs.slice(rotationStart, rotationEnd);
  assert.match(displayRotation, /camera\.position\.x - card\.group\.position\.x/);
  assert.match(displayRotation, /camera\.position\.z - card\.group\.position\.z/);
  assert.match(displayRotation, /card\.orbitAngle/);
  assert.doesNotMatch(displayRotation, /Math\.sin\(card\.orbitAngle\)/);

  const selectStart = mainTs.indexOf("function selectCard(");
  const privacyStart = mainTs.indexOf("function refreshPrivateGuestPreview(", selectStart);
  const selectCard = mainTs.slice(selectStart, privacyStart);
  assert.match(selectCard, /const previousCard = selectedCard/);
  assert.match(selectCard, /selectedCard = card/);
  assert.match(selectCard, /refreshPrivateGuestPreview\(previousCard, card\)/);

  const navStart = mainTs.indexOf('roomCardNavElement.addEventListener("click"');
  const navEnd = mainTs.indexOf("\n});", navStart);
  assert.notEqual(navStart, -1);
  assert.match(mainTs.slice(navStart, navEnd), /selectCard\(card, true\)/);
  const keyboardStart = mainTs.indexOf("function onCanvasKeyDown(");
  const keyboardEnd = mainTs.indexOf("\nfunction onDoubleClick(", keyboardStart);
  assert.notEqual(keyboardStart, -1);
  const keyboardHandler = mainTs.slice(keyboardStart, keyboardEnd);
  assert.match(keyboardHandler, /cycleCarousel\(1, true\)/);
  assert.match(keyboardHandler, /selectCard\(cards\[0\], true\)/);
  assert.match(keyboardHandler, /selectCard\(cards\[cards.length - 1\], true\)/);

  const automaticSelectionStart = mainTs.indexOf("if (closestCard !== selectedCard");
  const automaticSelectionEnd = mainTs.indexOf("\n  if (drag?.mode === \"move\")", automaticSelectionStart);
  assert.notEqual(automaticSelectionStart, -1);
  assert.match(
    mainTs.slice(automaticSelectionStart, automaticSelectionEnd),
    /refreshPrivateGuestPreview\(previousCard, closestCard\)/,
  );
  const helperStart = mainTs.indexOf("function refreshPrivateGuestPreview(");
  const helperEnd = mainTs.indexOf("\nfunction updateGuestActionButton(", helperStart);
  assert.match(
    mainTs.slice(helperStart, helperEnd),
    /cards\.includes\(card\)\)\s*refreshCardTexture\(card, true\)/,
  );
  assert.match(mainTs, /drag\.card\.group\.rotation\.y = cardDisplayRotation\(drag\.card\)/);
});

test("private preview turns respect reduced motion and documentation marks the step complete", () => {
  assert.match(mainTs, /const reducePreviewMotion = prefersReducedMotion\(\)/);
  assert.match(mainTs, /card\.group\.rotation\.y = reducePreviewMotion\s*\?\s*targetRotationY/);
  assert.match(readme, /Only the selected card shows its live guest framebuffer/);
  assert.match(readme, /With reduced motion\s+enabled/);
  assert.match(roadmap, /2\. \[x\] \*\*Compact, private multi-card previews\*\*/);
});

test("reduced motion snaps workspace transitions and pauses ambient scene animation", () => {
  const carouselStart = mainTs.indexOf("function cycleCarousel(");
  const carouselEnd = mainTs.indexOf("\nfunction resolveCardCollisions(", carouselStart);
  assert.match(
    mainTs.slice(carouselStart, carouselEnd),
    /prefersReducedMotion\(\)[\s\S]*selectCard\(cards\[nextIndex\]\)/,
  );
  assert.match(mainTs, /turntableAngle = targetTurntableAngle;\s*\}/);
  assert.match(mainTs, /card\.group\.position\.copy\(targetPosition\)/);
  assert.match(mainTs, /camera\.position\.copy\(desiredCamPos\)/);
  assert.match(mainTs, /cameraLookTarget\.copy\(desiredLookAt\)/);
  assert.match(mainTs, /drag\.mode === "carousel"\) \{\s*if \(prefersReducedMotion\(\) \|\| cardZoomed\) return;/);
  const flipStart = mainTs.indexOf("function flipCardTo(");
  const flipEnd = mainTs.indexOf("\nfunction flipCardToSide(", flipStart);
  const flipCard = mainTs.slice(flipStart, flipEnd);
  assert.match(flipCard, /prefersReducedMotion\(\)[\s\S]*card\.facet = targetFacet/);
  assert.match(flipCard, /card\.backFaceVisible = !card\.backFaceVisible/);
  assert.match(flipCard, /card\.flipAnim = undefined/);
  assert.match(mainTs, /if \(card\.flipAnim && reducePreviewMotion\)/);

  const ambientStart = mainTs.indexOf("overheadHaloGroup.rotation.y = now");
  const ambientEnd = mainTs.indexOf("\n  renderer.render(scene, camera);", ambientStart);
  assert.notEqual(ambientStart, -1);
  assert.match(mainTs.slice(ambientStart - 35, ambientEnd), /if \(!reducePreviewMotion\) \{/);
  assert.match(mainTs, /starMaterial\.size = 0\.088 \+ 0\.012 \* Math\.sin/);
  assert.match(mainTs, /mat\.emissiveIntensity = 0\.55 \+ 0\.4 \* Math\.sin/);
  assert.match(mainTs, /card\.targetRotation = targetRot;[\s\S]*card\.facet = targetFacet/);
  assert.match(readme, /carousel dragging is disabled/);
});




