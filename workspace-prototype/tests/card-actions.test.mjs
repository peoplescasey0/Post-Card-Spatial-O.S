import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");
const html = fs.readFileSync(path.join(workspaceDir, "index.html"), "utf-8");
const actionsTs = fs.readFileSync(path.join(workspaceDir, "src", "card-actions.ts"), "utf-8");
const compiledActions = ts.transpileModule(actionsTs, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { getOnCardActionState, routeOnCardAction, runConfirmedCardDeletion } = await import(
  `data:text/javascript;base64,${Buffer.from(compiledActions).toString("base64")}`
);

test("on-card guest controls reflect install, launch, resume, running, and busy states", () => {
  const state = (overrides = {}) =>
    getOnCardActionState({
      os: "linux",
      baseReady: false,
      hasDisk: false,
      canMoveToBin: true,
      ...overrides,
    });

  assert.equal(state().guestLabel, "Install");
  assert.equal(state({ baseReady: true }).guestLabel, "Launch");
  assert.equal(state({ baseReady: true, hasDisk: true }).guestLabel, "Resume");
  assert.equal(state({ guestStatus: "running" }).guestLabel, "Open");
  assert.equal(state({ guestStatus: "running" }).showShutdown, true);
  assert.equal(state().showDelete, true);
  assert.equal(state({ guestStatus: "starting" }).guestDisabled, true);
  assert.equal(state({ guestStatus: "stopping" }).guestDisabled, true);
  assert.equal(state({ os: "windows", hasDisk: true }).guestLabel, "Resume");
});

test("bin and shutdown actions are exposed only when valid for the selected card", () => {
  const unavailable = getOnCardActionState({
    os: "linux",
    guestStatus: "offline",
    baseReady: false,
    hasDisk: false,
    canMoveToBin: false,
  });
  assert.equal(unavailable.showShutdown, false);
  assert.equal(unavailable.showBin, false);
  assert.equal(unavailable.showDelete, false);
  assert.equal(unavailable.shutdownDisabled, true);

  const running = getOnCardActionState({
    os: "linux",
    guestStatus: "running",
    baseReady: true,
    hasDisk: true,
    canMoveToBin: true,
  });
  assert.equal(running.showShutdown, true);
  assert.equal(running.showBin, true);
  assert.equal(running.showDelete, true);
});

test("the compact card strip routes into existing guest, settings, and reversible-bin handlers", () => {
  const calls = [];
  const handlers = {
    guest: () => calls.push("guest"),
    shutdown: () => calls.push("shutdown"),
    settings: () => calls.push("settings"),
    bin: () => calls.push("bin"),
    delete: () => calls.push("delete"),
  };
  for (const action of ["guest", "shutdown", "settings", "bin", "delete"]) {
    routeOnCardAction(action, handlers);
  }
  assert.deepEqual(calls, ["guest", "shutdown", "settings", "bin", "delete"]);

  assert.match(html, /id="card-action-strip"[\s\S]*data-card-action="guest"[\s\S]*data-card-action="shutdown"[\s\S]*data-card-action="settings"[\s\S]*data-card-action="bin"/);
  assert.match(html, /id="card-delete-action"[^>]+data-card-action="delete"[^>]+hidden/);
  assert.match(mainTs, /guest: \(\) => openOrStartSelectedGuest\(card\)/);
  assert.match(mainTs, /shutdown: \(\) => void shutdownGuest\(card\)/);
  assert.match(mainTs, /settings: \(\) => flipCardTo\(card, "back"\)/);
  assert.match(mainTs, /bin: \(\) => beginCardBinFlight\(card\)/);
  assert.match(mainTs, /delete: \(\) => beginCardDeleteConfirmation\(card\)/);
  assert.doesNotMatch(html, /id="guest-button"|id="flip-button"|id="bin-card-button"/);
});

test("permanent deletion requires the explicit card action and confirmation", () => {
  assert.match(mainTs, /function beginCardDeleteConfirmation\(card: SystemCard\)[\s\S]*openTrashConfirmation\(captureTrashRestoreState\(card\)\)/);
  assert.match(mainTs, /function openTrashConfirmation\(state: TrashRestoreState\)[\s\S]*trashDialogElement\.showModal\(\)/);
  assert.match(html, /Delete this card permanently\?/);
  assert.match(html, /This cannot be undone/);
  assert.doesNotMatch(mainTs, /beginTrashFlight|pointerIsOverTrash/);
  assert.doesNotMatch(html, /quick flick deletes/i);
});

test("permanent deletion starts the API with the plane flight and removes only after both succeed", async () => {
  const confirmStart = mainTs.indexOf("async function confirmTrashDeletion");
  const confirmEnd = mainTs.indexOf("\nfunction onPointerDown", confirmStart);
  const confirmSource = mainTs.slice(confirmStart, confirmEnd);
  assert.match(confirmSource, /const flightComplete = beginPermanentDeleteFlight\(state\)/);
  assert.match(confirmSource, /deleteGuest: \(\) => requestGuestApi\("\/api\/guest\/delete"/);
  assert.match(confirmSource, /waitForFlight: \(\) => flightComplete/);
  assert.match(confirmSource, /onSuccess: \(status\) => \{[\s\S]*deletedCardIds\.add\(state\.card\.id\)[\s\S]*removeCardFromRoom\(state\.card, status\)/);
  assert.doesNotMatch(confirmSource.slice(confirmSource.indexOf("onFailure:")), /deletedCardIds\.add/);

  let resolveFlight;
  let resolveApi;
  const events = [];
  const flow = runConfirmedCardDeletion({
    deleteGuest: () => {
      events.push("api-start");
      return new Promise((resolve) => { resolveApi = resolve; });
    },
    waitForFlight: () => new Promise((resolve) => { resolveFlight = resolve; }),
    onSuccess: () => events.push("removed"),
    onFailure: () => events.push("restored"),
  });
  assert.deepEqual(events, ["api-start"]);
  resolveApi({ deleted: true });
  await Promise.resolve();
  assert.deepEqual(events, ["api-start"]);
  resolveFlight();
  await flow;
  assert.deepEqual(events, ["api-start", "removed"]);
});

test("API failure restores the card without a deleted ID or success message", async () => {
  const confirmStart = mainTs.indexOf("async function confirmTrashDeletion");
  const confirmEnd = mainTs.indexOf("\nfunction onPointerDown", confirmStart);
  const failureSource = mainTs.slice(confirmStart, confirmEnd).split("onFailure:")[1];
  assert.match(failureSource, /disposeTrashFlightPlane\(flight\)/);
  assert.match(failureSource, /restoreTrashCardState\(state\)/);
  assert.match(failureSource, /The card remains in the room/);
  assert.doesNotMatch(failureSource, /deletedCardIds\.add|removeCardFromRoom|showToast/);

  const calls = [];
  await runConfirmedCardDeletion({
    deleteGuest: async () => { throw new Error("service unavailable"); },
    waitForFlight: async () => calls.push("flight"),
    onSuccess: () => calls.push("success"),
    onFailure: (error) => calls.push(error.message),
  });
  assert.deepEqual(calls, ["service unavailable"]);
  assert.doesNotMatch(mainTs, /prepareDeletedIdState/);
});

test("card shutdown keeps the existing stop API and does not disconnect another card's display", () => {
  const start = mainTs.indexOf("async function shutdownGuest(card?: SystemCard)");
  const end = mainTs.indexOf("async function forceStopGuest", start);
  const shutdown = mainTs.slice(start, end);
  assert.match(shutdown, /requestGuestApi\("\/api\/guest\/stop"/);
  assert.match(shutdown, /displayedGuestCardId === targetCardId/);
});
