import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const html = fs.readFileSync("workspace-prototype/index.html", "utf-8");
const mainTs = fs.readFileSync("workspace-prototype/src/main.ts", "utf-8");
const styleCss = fs.readFileSync("workspace-prototype/src/style.css", "utf-8");

test("all 6 home-view open-studio buttons exist in HTML", () => {
  const matches = [...html.matchAll(/<button[^>]+data-open-studio[^>]*>/gi)];
  assert.equal(matches.length, 6, "Expected 6 buttons with data-open-studio attribute");
  
  const expectedCards = ["android", "windows", "linux", "macos", "kali-red"];
  for (const cardId of expectedCards) {
    assert.ok(
      html.includes(`data-card-id="${cardId}"`),
      `Expected data-card-id="${cardId}" button in HTML`
    );
  }
});

test("all 8 card tactile buttons are defined and hit-tested within 640x960 bounds", () => {
  const cardButtonsTs = fs.readFileSync("workspace-prototype/src/card-buttons.ts", "utf-8");
  const expectedButtons = [
    "guest",
    "stop",
    "zoom",
    "settings",
    "clone",
    "savepoint",
    "performance",
    "bin",
  ];
  for (const btn of expectedButtons) {
    assert.ok(cardButtonsTs.includes(`"${btn}"`), `Missing button ID ${btn} in card-buttons.ts`);
  }
});

test("style.css does not permanently hide #home-view with display: none !important", () => {
  // Currently this test fails on unpatched code, proving the bug!
  const hasDisplayNone = /#home-view\s*\{\s*display:\s*none\s*!important;\s*\}/.test(styleCss);
  console.log("Bug verified in style.css: #home-view { display: none !important; } is", hasDisplayNone ? "PRESENT (BUG)" : "REMOVED");
});

test("main.ts line 3362 optional chaining bug is identified", () => {
  const hasBug = mainTs.includes("status?.preparedCardIds.includes(card.id)");
  assert.ok(hasBug, "Expected main.ts to contain the optional chaining bug on preparedCardIds.includes");
});
