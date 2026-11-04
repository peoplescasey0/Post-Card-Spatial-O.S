import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");
const html = fs.readFileSync(path.join(workspaceDir, "index.html"), "utf-8");
const css = fs.readFileSync(path.join(workspaceDir, "src", "style.css"), "utf-8");

test("the paper bin is persistent, accessible, and offers per-card restore", () => {
  assert.match(html, /<button[^>]+id="trash-target"[^>]+aria-haspopup="dialog"/);
  assert.doesNotMatch(html, /id="trash-target"[^>]*\bhidden\b/);
  assert.match(html, /id="card-bin-action"[^>]+data-card-action="bin"/);
  assert.doesNotMatch(html, /id="bin-card-button"/);
  assert.match(mainTs, /bin: \(\) => beginCardBinFlight\(card\)/);
  assert.match(html, /<dialog[^>]+id="bin-dialog"/);
  assert.match(html, /id="bin-card-list"/);
  assert.match(html, /id="bin-close"/);
  assert.match(css, /\.trash-target\s*\{[^}]*pointer-events:\s*auto;/);
  assert.match(css, /\.bin-restore-button\s*\{/);
});

test("reversible bin state persists card metadata and prevents guest reconciliation from recreating it", () => {
  assert.match(mainTs, /binnedCards:\s*\[\.\.\.binnedCards\.values\(\)\]/);
  assert.match(mainTs, /deletedCardIds\.has\(definition\.id\)\s*\|\|\s*binnedCards\.has\(definition\.id\)/);
  assert.match(mainTs, /!deletedCardIds\.has\(def\.id\)\s*&&\s*!binnedCards\.has\(def\.id\)/);
  assert.match(mainTs, /deletedCardIds\.has\(newId\)\s*\|\|\s*binnedCards\.has\(newId\)/);
  assert.match(mainTs, /function restoreCardFromBin\(cardId: string\)/);
  assert.match(mainTs, /Its guest files and data were preserved/);
  assert.match(mainTs, /deletedIds: \[\.\.\.new Set\(\[\.\.\.legacyDeletedCardIds, \.\.\.deletedCardIds\]\)\]\.sort\(\)/);
  assert.match(mainTs, /binnedCards: \[\.\.\.binnedCards\.values\(\)\]/);
  assert.doesNotMatch(mainTs, /prepareDeletedIdState/);
});

test("move-to-bin flight folds into a plane and never calls the permanent-delete API", () => {
  const start = mainTs.indexOf("function beginCardBinFlight");
  const end = mainTs.indexOf("function finishCardBinFlight", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const binAction = mainTs.slice(start, end);
  assert.match(binAction, /kind:\s*"bin"/);
  assert.match(binAction, /prefersReducedMotion\(\)/);
  assert.doesNotMatch(binAction, /\/api\/guest\/delete/);
  assert.match(mainTs, /const foldEnd = 0\.22/);
  assert.match(mainTs, /airplaneGeometry/);

  const deleteStart = mainTs.indexOf("async function confirmTrashDeletion");
  assert.notEqual(deleteStart, -1);
  assert.match(mainTs.slice(deleteStart), /deleteGuest: \(\) => requestGuestApi\("\/api\/guest\/delete"/);
  assert.match(mainTs.slice(deleteStart), /beginPermanentDeleteFlight\(state\)/);
  assert.match(html, /Delete this card permanently\?/);
});
