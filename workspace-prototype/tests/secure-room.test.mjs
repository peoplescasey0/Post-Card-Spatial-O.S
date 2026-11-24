import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("the room exposes a Secure Now control", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<button[^>]+id="secure-now"/);
  assert.match(html, /id="secure-now"[^>]+aria-pressed="false"/);
  assert.match(html, /id="secure-now"[^>]+title="[^"]*Guests keep running/);
});

test("live guest pixels are gated by the secure state", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /const showLiveOnCard =\s*!roomSecured &&/);
  assert.match(main, /roomSecured \? "ROOM SECURED" : "PRIVATE DISPLAY"/);
  assert.match(main, /function setRoomSecured\(secured: boolean\): void/);
});

test("the display viewer, its mirrors and its heading all respect the secure state", async () => {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

  // The viewer refuses to attach an RFB connection while the room is secured.
  assert.match(
    main,
    /function connectGuestDisplay\(websocketPort: number, cardId: string\): void \{\n\s*\/\/ Secure Now owns every live-pixel surface[\s\S]*?if \(roomSecured\) \{[\s\S]*?return;\n  \}/,
  );

  // No frames are copied into card textures while secured.
  assert.match(main, /if \(!guestTargetCardId\) return;\n\s*\/\/ Don't mirror frames[\s\S]*?if \(roomSecured\) return;/);

  // A secured card labels its hidden display as such.
  assert.match(main, /roomSecured && card\.liveCanvas\s*\? "ROOM SECURED"/);

  // Securing disconnects the viewer instead of only closing the dialog.
  assert.match(main, /if \(secured\) \{[\s\S]*?disconnectGuestDisplay\(\);[\s\S]*?guestDialogElement\.close\(\);/);
});
