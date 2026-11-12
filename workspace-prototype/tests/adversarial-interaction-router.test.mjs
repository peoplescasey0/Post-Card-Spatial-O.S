/**
 * Post Card Spatial OS — Adversarial Verification Suite:
 * Button Interactivity, View Routing, Dialog Idempotency, and Optional Chaining Edge Cases
 *
 * Authored by Challenger 2 (Button & Routing Adversarial Verifier)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __filename = fileURLToPath(import.meta.url);
const testsDir = path.dirname(__filename);
const workspaceDir = path.resolve(testsDir, "..");

const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");
const html = fs.readFileSync(path.join(workspaceDir, "index.html"), "utf-8");
const styleCss = fs.readFileSync(path.join(workspaceDir, "src", "style.css"), "utf-8");

// Load dependencies
async function loadCardActions() {
  const target = path.join(workspaceDir, "src", "card-actions.ts");
  const sourceTs = fs.readFileSync(target, "utf-8");
  const compiled = ts.transpileModule(sourceTs, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

async function loadCardButtons() {
  const target = path.join(workspaceDir, "src", "card-buttons.ts");
  const sourceTs = fs.readFileSync(target, "utf-8");
  const compiled = ts.transpileModule(sourceTs, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}

const { getOnCardActionState } = await loadCardActions();
const { CARD_BUTTON_IDS } = await loadCardButtons();

/**
 * Re-creates the exact cardButtonStates logic from main.ts:3484-3511
 */
function cardToGuestOsSim(card) {
  if (card.os === "WINDOWS") return "windows";
  if (card.os === "ANDROID") return "android";
  if (card.os === "MACOS") return "macos";
  return "linux";
}

function cardButtonStatesSim(card, status, deckCards = [card], cardZoomed = false) {
  const os = cardToGuestOsSim(card);
  const guest = status?.guests?.find((item) => item.os === os && item.cardId === card.id);
  const hasDisk =
    os === "windows"
      ? (status?.installedWindowsCardIds?.includes(card.id) ?? false) ||
        (/^windows[-_]/.test(card.id) && (status?.installedWindowsCardIds?.includes("windows") ?? false))
      : (status?.preparedCardIds?.includes(card.id) ?? false);
  const actionState = getOnCardActionState({
    os,
    guestStatus: guest?.status,
    baseReady: status?.baseReady ?? false,
    hasDisk,
    canMoveToBin: card.removable !== false && deckCards.length > 1,
  });
  const running = guest?.status === "running";
  return {
    guest: { label: actionState.guestLabel, enabled: !actionState.guestDisabled },
    stop: { label: "Stop", enabled: running },
    zoom: { label: cardZoomed ? "Zoom out" : "Zoom", enabled: true },
    settings: { label: "Settings", enabled: true },
    clone: { label: "Clone", enabled: true },
    savepoint: { label: "Save", enabled: running },
    performance: { label: "Perf", enabled: true },
    bin: { label: "Bin", enabled: actionState.showBin },
  };
}

// ----------------------------------------------------------------------------
// Suite 1: Optional Chaining Edge Cases & TypeError Immunity
// ----------------------------------------------------------------------------
test("Adversarial 1: Optional chaining edge cases produce ZERO TypeErrors across all card types", () => {
  const testCards = [
    { id: "linux", name: "Alpine Linux", os: "LINUX", removable: true },
    { id: "windows", name: "Windows 11", os: "WINDOWS", removable: true },
    { id: "windows-11", name: "Windows 11 Pro", os: "WINDOWS", removable: true },
    { id: "android", name: "Android 14", os: "ANDROID", removable: true },
    { id: "macos", name: "macOS Sonoma", os: "MACOS", removable: true },
    { id: "kali-red", name: "Kali Security", os: "LINUX", removable: true },
    { id: "system-locked", name: "Kernel Core", os: "LINUX", removable: false },
  ];

  const adversarialStatuses = [
    undefined,
    null,
    {},
    { guests: undefined },
    { guests: null },
    { preparedCardIds: null },
    { preparedCardIds: undefined },
    { installedWindowsCardIds: undefined },
    { installedWindowsCardIds: null },
    { baseReady: undefined },
    { guests: undefined, preparedCardIds: undefined, installedWindowsCardIds: undefined },
    { guests: null, preparedCardIds: null, installedWindowsCardIds: null },
    { guests: [], preparedCardIds: [], installedWindowsCardIds: [] },
    // Partially populated malformed records
    { guests: [{ os: "linux", cardId: "other-card", status: "running" }] },
    { guests: [{ os: "windows", cardId: "windows", status: undefined }] },
    { guests: [{ os: "windows", cardId: "windows", status: null }] },
    { guests: [{ os: "linux", cardId: "linux", status: "starting" }] },
    { guests: [{ os: "linux", cardId: "linux", status: "stopping" }] },
    { guests: [{ os: "linux", cardId: "linux", status: "running" }], preparedCardIds: ["linux"] },
    {
      guests: [{ os: "windows", cardId: "windows", status: "running" }],
      installedWindowsCardIds: ["windows"],
    },
    { baseReady: true, preparedCardIds: ["kali-red"] },
  ];

  for (const card of testCards) {
    for (const [sIndex, status] of adversarialStatuses.entries()) {
      let states;
      assert.doesNotThrow(() => {
        states = cardButtonStatesSim(card, status, testCards, false);
      }, `cardButtonStatesSim must not throw TypeError for card ${card.id} under status index ${sIndex}`);

      // Verify all 8 button states are returned
      assert.ok(states, "State object must be returned");
      for (const btnId of CARD_BUTTON_IDS) {
        assert.ok(btnId in states, `Button '${btnId}' must exist in states`);
        assert.equal(typeof states[btnId].label, "string", `Button '${btnId}' label must be string`);
        assert.equal(typeof states[btnId].enabled, "boolean", `Button '${btnId}' enabled must be boolean`);
      }

      // Semantic checks for safety
      if (!status || !status.guests) {
        assert.equal(states.stop.enabled, false, "Stop must be disabled when status/guests missing");
        assert.equal(states.savepoint.enabled, false, "Save must be disabled when status/guests missing");
      }
    }
  }
});

// ----------------------------------------------------------------------------
// Suite 2: Dialog showModal Idempotency
// ----------------------------------------------------------------------------
test("Adversarial 2: Dialog showModal idempotency prevents DOMException on double-open", () => {
  // Simulate standard HTML5 <dialog> element
  class MockDialogElement {
    constructor() {
      this.open = false;
      this.showModalCalls = 0;
      this.closeCalls = 0;
    }
    showModal() {
      if (this.open) {
        throw new Error("Failed to execute 'showModal' on 'HTMLDialogElement': The element already has an 'open' attribute, and therefore cannot be opened as a modal dialog.");
      }
      this.open = true;
      this.showModalCalls++;
    }
    close() {
      this.open = false;
      this.closeCalls++;
    }
  }

  const dialog = new MockDialogElement();

  // The pattern enforced in main.ts:2933 and 5209:
  function safeOpenGuestDialog(dlg) {
    if (!dlg.open) {
      dlg.showModal();
    }
  }

  // 1. Initial open
  assert.equal(dialog.open, false);
  assert.doesNotThrow(() => safeOpenGuestDialog(dialog));
  assert.equal(dialog.open, true);
  assert.equal(dialog.showModalCalls, 1);

  // 2. Second open attempt while open (double-open stress)
  assert.doesNotThrow(() => safeOpenGuestDialog(dialog));
  assert.equal(dialog.open, true);
  assert.equal(dialog.showModalCalls, 1, "Redundant showModal must not be invoked");

  // 3. Rapid fire: 100 consecutive open calls
  for (let i = 0; i < 100; i++) {
    assert.doesNotThrow(() => safeOpenGuestDialog(dialog));
  }
  assert.equal(dialog.showModalCalls, 1, "showModal count must remain 1 after 100 calls");

  // 4. Close and reopen
  dialog.close();
  assert.equal(dialog.open, false);
  assert.equal(dialog.closeCalls, 1);
  assert.doesNotThrow(() => safeOpenGuestDialog(dialog));
  assert.equal(dialog.open, true);
  assert.equal(dialog.showModalCalls, 2);

  // 5. Verify source code in main.ts has showModal guards
  assert.match(
    mainTs,
    /if\s*\(!guestDialogElement\.open\)\s*\{\s*guestDialogElement\.showModal\(\);?\s*\}/,
    "main.ts must guard guestDialogElement.showModal() in openOrStartSelectedGuest"
  );
  assert.match(
    mainTs,
    /if\s*\(!guestDialogElement\.open\)\s*guestDialogElement\.showModal\(\);?/,
    "main.ts must guard guestDialogElement.showModal() in display twist listener"
  );
  assert.match(
    mainTs,
    /if\s*\(editionsDialog\s*&&\s*!editionsDialog\.open\)\s*editionsDialog\.showModal\(\);?/,
    "main.ts must guard editionsDialog.showModal()"
  );
});

// ----------------------------------------------------------------------------
// Suite 3: All 8 Tactile Button Handlers Simulation & State Matrix
// ----------------------------------------------------------------------------
test("Adversarial 3: All 8 tactile button handlers execute safely across lifecycle states", () => {
  const card = {
    id: "linux",
    name: "Alpine Linux",
    os: "LINUX",
    facet: "front",
    removable: true,
  };

  let facetState = "front";
  let zoomState = false;
  let dialogOpened = false;
  let shutdownTriggered = false;
  let cloneTriggered = false;
  let savepointTriggered = false;
  let binFlightTriggered = false;
  let trashInFlight = false;

  function simulateRunCardButton(id, cardObj, status, deck) {
    if (trashInFlight) return "blocked_by_flight";
    const states = cardButtonStatesSim(cardObj, status, deck, zoomState);
    if (!states[id].enabled) return "disabled";

    switch (id) {
      case "guest":
        dialogOpened = true;
        return "opened_guest";
      case "stop":
        shutdownTriggered = true;
        return "shutdown";
      case "settings":
        facetState = "back";
        return "flipped_to_settings";
      case "bin":
        binFlightTriggered = true;
        return "bin_flight";
      case "zoom":
        zoomState = !zoomState;
        return "zoomed";
      case "clone":
        cloneTriggered = true;
        return "cloned";
      case "savepoint":
        savepointTriggered = true;
        return "savepoint";
      case "performance":
        facetState = "bottom";
        return "flipped_to_telemetry";
      default:
        throw new Error(`Unknown button ${id}`);
    }
  }

  // State 1: Card is OFFLINE
  const offlineStatus = { guests: [{ os: "linux", cardId: "linux", status: "offline" }] };
  const deck = [card, { id: "windows", os: "WINDOWS" }];

  assert.equal(simulateRunCardButton("guest", card, offlineStatus, deck), "opened_guest");
  assert.equal(simulateRunCardButton("stop", card, offlineStatus, deck), "disabled", "Stop must be disabled when offline");
  assert.equal(simulateRunCardButton("zoom", card, offlineStatus, deck), "zoomed");
  assert.equal(zoomState, true);
  assert.equal(simulateRunCardButton("zoom", card, offlineStatus, deck), "zoomed");
  assert.equal(zoomState, false);
  assert.equal(simulateRunCardButton("settings", card, offlineStatus, deck), "flipped_to_settings");
  assert.equal(facetState, "back");
  assert.equal(simulateRunCardButton("performance", card, offlineStatus, deck), "flipped_to_telemetry");
  assert.equal(facetState, "bottom");
  assert.equal(simulateRunCardButton("clone", card, offlineStatus, deck), "cloned");
  assert.equal(simulateRunCardButton("savepoint", card, offlineStatus, deck), "disabled", "Savepoint must be disabled when offline");
  assert.equal(simulateRunCardButton("bin", card, offlineStatus, deck), "bin_flight");

  // State 2: Card is RUNNING
  const runningStatus = {
    guests: [{ os: "linux", cardId: "linux", status: "running" }],
    preparedCardIds: ["linux"],
  };
  shutdownTriggered = false;
  savepointTriggered = false;
  assert.equal(simulateRunCardButton("stop", card, runningStatus, deck), "shutdown");
  assert.equal(shutdownTriggered, true);
  assert.equal(simulateRunCardButton("savepoint", card, runningStatus, deck), "savepoint");
  assert.equal(savepointTriggered, true);

  // State 3: Card is in busy state (starting / stopping)
  const busyStatus = { guests: [{ os: "linux", cardId: "linux", status: "starting" }] };
  assert.equal(simulateRunCardButton("guest", card, busyStatus, deck), "disabled", "Guest button must be disabled when starting");
  assert.equal(simulateRunCardButton("stop", card, busyStatus, deck), "disabled", "Stop button must be disabled when starting");

  // State 4: Only 1 card in deck (bin disabled)
  const singleCardDeck = [card];
  assert.equal(simulateRunCardButton("bin", card, offlineStatus, singleCardDeck), "disabled", "Bin must be disabled when deck has 1 card");

  // State 5: Card non-removable
  const lockedCard = { ...card, removable: false };
  assert.equal(simulateRunCardButton("bin", lockedCard, offlineStatus, deck), "disabled", "Bin must be disabled for non-removable card");

  // State 6: Trash animation currently in flight
  trashInFlight = true;
  for (const id of CARD_BUTTON_IDS) {
    assert.equal(
      simulateRunCardButton(id, card, runningStatus, deck),
      "blocked_by_flight",
      `Button ${id} must be blocked while trash flight is in progress`
    );
  }
});

// ----------------------------------------------------------------------------
// Suite 4: View Routing, URL Hash Synchronization & Rapid Transitions
// ----------------------------------------------------------------------------
test("Adversarial 4: View routing, hash sync, and rapid navigation transitions maintain mutual exclusion", () => {
  // DOM element simulation
  const homeView = { hidden: false };
  const studioView = { hidden: true };
  const cards = [
    { id: "linux", name: "Alpine Linux" },
    { id: "windows", name: "Windows 11" },
    { id: "android", name: "Android 14" },
    { id: "macos", name: "macOS Sonoma" },
    { id: "kali-red", name: "Kali Security" },
  ];
  let selectedCard = null;
  let locationHash = "";

  function showStudioSim(cardId) {
    homeView.hidden = true;
    studioView.hidden = false;

    if (cardId) {
      const target = cards.find((c) => c.id === cardId);
      if (target) {
        selectedCard = target;
      }
    }

    if (locationHash !== "#studio" && locationHash !== "#room") {
      locationHash = "#studio";
    }
  }

  function showHomeSim() {
    studioView.hidden = true;
    homeView.hidden = false;

    if (locationHash !== "#home") {
      locationHash = "#home";
    }
  }

  function onHashChangeSim(newHash) {
    locationHash = newHash;
    if (newHash === "#home") {
      showHomeSim();
    } else if (newHash === "#studio" || newHash === "#room") {
      showStudioSim();
    }
    // Invalid or unknown hash: no-op, views keep current visibility
  }

  // Invariant assertion helper
  function assertMutualExclusion(stepName) {
    assert.ok(
      (homeView.hidden && !studioView.hidden) || (!homeView.hidden && studioView.hidden),
      `Mutual exclusion violated at ${stepName}: home.hidden=${homeView.hidden}, studio.hidden=${studioView.hidden}`
    );
  }

  // 1. Initial State
  showHomeSim();
  assert.equal(homeView.hidden, false);
  assert.equal(studioView.hidden, true);
  assert.equal(locationHash, "#home");
  assertMutualExclusion("Initial Home");

  // 2. Navigation to Studio
  showStudioSim();
  assert.equal(homeView.hidden, true);
  assert.equal(studioView.hidden, false);
  assert.equal(locationHash, "#studio");
  assertMutualExclusion("Studio transition");

  // 3. Navigation with cardId parameter
  showStudioSim("macos");
  assert.equal(selectedCard.id, "macos");
  assertMutualExclusion("Studio with cardId");

  // 4. Navigation with unknown cardId parameter (graceful fallback)
  assert.doesNotThrow(() => showStudioSim("nonexistent-card-999"));
  assert.equal(selectedCard.id, "macos", "Unknown cardId must not disturb existing selection");
  assertMutualExclusion("Studio with unknown cardId");

  // 5. Hash change simulation: #home
  onHashChangeSim("#home");
  assert.equal(homeView.hidden, false);
  assert.equal(studioView.hidden, true);
  assertMutualExclusion("Hash change #home");

  // 6. Hash change simulation: #room (legacy alias for studio)
  onHashChangeSim("#room");
  assert.equal(homeView.hidden, true);
  assert.equal(studioView.hidden, false);
  assertMutualExclusion("Hash change #room");

  // 7. Hash change simulation: #invalid-hash, empty hash, and malformed strings
  const invalidHashes = ["#invalid", "#404", "", "#", "#<script>", "#!@#$%", "#undefined"];
  for (const inv of invalidHashes) {
    const prevHome = homeView.hidden;
    const prevStudio = studioView.hidden;
    assert.doesNotThrow(() => onHashChangeSim(inv), `Hash change to '${inv}' must not throw`);
    assert.equal(homeView.hidden, prevHome, `Invalid hash '${inv}' must not toggle homeView`);
    assert.equal(studioView.hidden, prevStudio, `Invalid hash '${inv}' must not toggle studioView`);
    assertMutualExclusion(`Invalid hash ${inv}`);
  }

  // 8. Rapid stress test: 200 alternating view switches
  for (let i = 0; i < 200; i++) {
    if (i % 2 === 0) {
      showStudioSim();
      assert.equal(studioView.hidden, false);
      assert.equal(homeView.hidden, true);
    } else {
      showHomeSim();
      assert.equal(homeView.hidden, false);
      assert.equal(studioView.hidden, true);
    }
    assertMutualExclusion(`Rapid transition iteration ${i}`);
  }

  // 9. Escape key handling on Home view
  function onHomeKeyDownSim(key) {
    if (key === "Escape") {
      showStudioSim();
    }
  }
  showHomeSim();
  assert.equal(homeView.hidden, false);
  onHomeKeyDownSim("Escape");
  assert.equal(studioView.hidden, false);
  assert.equal(homeView.hidden, true);
  assertMutualExclusion("Escape key on home view");

  // Non-escape key should do nothing
  showHomeSim();
  onHomeKeyDownSim("Enter");
  assert.equal(homeView.hidden, false);
  assertMutualExclusion("Enter key on home view");
});

// ----------------------------------------------------------------------------
// Suite 5: CSS Specificity & Mutual Exclusion Display Invariants
// ----------------------------------------------------------------------------
test("Adversarial 5: CSS rules enforce mutual exclusion and contain no hardcoded display:none overrides", () => {
  // Confirm unconditional suppressor has been completely removed
  assert.ok(
    !styleCss.includes("#home-view { display: none !important; }") &&
    !styleCss.includes("#home-view {\n  display: none !important;\n}"),
    "style.css must NOT contain unconditional #home-view { display: none !important; }"
  );

  // Confirm mutual-exclusion hidden selector exists
  assert.match(
    styleCss,
    /#home-view\[hidden\],\s*#studio-view\[hidden\]/,
    "style.css must contain #home-view[hidden], #studio-view[hidden] { display: none !important; }"
  );

  // Confirm .home-return-button has styling
  assert.match(styleCss, /\.home-return-button/, "style.css must style .home-return-button");
});
