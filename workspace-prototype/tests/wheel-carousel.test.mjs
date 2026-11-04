import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainTs = fs.readFileSync(path.join(workspaceDir, "src", "main.ts"), "utf-8");
const html = fs.readFileSync(path.join(workspaceDir, "index.html"), "utf-8");
const wheelTs = fs.readFileSync(path.join(workspaceDir, "src", "carousel-wheel.ts"), "utf-8");
const compiledWheel = ts.transpileModule(wheelTs, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { attachCarouselWheelListener, createWheelCarouselHandler } = await import(
  `data:text/javascript;base64,${Buffer.from(compiledWheel).toString("base64")}`
);

class FakeElement {
  constructor({ tagName = "div", id = "", className = "", role = "", parentElement = null } = {}) {
    this.tagName = tagName.toLowerCase();
    this.id = id;
    this.classList = new Set(className.split(/\s+/).filter(Boolean));
    this.role = role;
    this.parentElement = parentElement;
  }

  closest(selectorList) {
    const selectors = selectorList.split(",").map((selector) => selector.trim());
    for (let element = this; element; element = element.parentElement) {
      if (selectors.some((selector) => element.matches(selector))) return element;
    }
    return null;
  }

  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.has(selector.slice(1));
    if (selector === "[role='dialog']") return this.role === "dialog";
    return this.tagName === selector;
  }
}

class FakeSceneShell extends FakeElement {
  addEventListener(type, listener, options) {
    assert.equal(type, "wheel");
    this.listener = listener;
    this.options = options;
  }

  wheel(target, deltaY) {
    const event = {
      target,
      deltaY,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    this.listener(event);
    return event;
  }
}

function makeSceneSurface() {
  const shell = new FakeSceneShell({ tagName: "section", id: "room" });
  const canvas = new FakeElement({
    tagName: "canvas",
    parentElement: new FakeElement({ id: "scene", parentElement: shell }),
  });
  const picker = new FakeElement({ tagName: "nav", id: "room-card-nav", parentElement: shell });
  const pickerButton = new FakeElement({ tagName: "button", parentElement: picker });
  const actionStrip = new FakeElement({ className: "card-action-strip", parentElement: shell });
  const cardActionButton = new FakeElement({ tagName: "button", parentElement: actionStrip });
  const paperBin = new FakeElement({ tagName: "button", id: "trash-target", parentElement: shell });
  const settingsPulldown = new FakeElement({ tagName: "details", className: "pulldown", parentElement: shell });
  const settingsButton = new FakeElement({ tagName: "button", parentElement: settingsPulldown });
  const dialog = new FakeElement({ tagName: "section", role: "dialog", parentElement: shell });
  const dialogButton = new FakeElement({ tagName: "button", parentElement: dialog });
  return {
    shell,
    canvas,
    pickerButton,
    cardActionButton,
    paperBin,
    settingsButton,
    dialogButton,
  };
}

test("scene-shell wheel surface advances over canvas and picker, but leaves controls alone", () => {
  const previousElement = globalThis.Element;
  globalThis.Element = FakeElement;
  try {
    const {
      shell,
      canvas,
      pickerButton,
      cardActionButton,
      paperBin,
      settingsButton,
      dialogButton,
    } = makeSceneSurface();
    let now = 200;
    let selectedIndex = 2;
    const wheel = createWheelCarouselHandler(
      () => 5,
      (direction) => {
        selectedIndex = (selectedIndex + direction + 5) % 5;
      },
      () => now,
    );
    attachCarouselWheelListener(shell, wheel);

    assert.deepEqual(shell.options, { capture: true, passive: false });
    const canvasEvent = shell.wheel(canvas, 40);
    assert.equal(canvasEvent.defaultPrevented, true);
    assert.equal(selectedIndex, 3);

    now += 200;
    const pickerEvent = shell.wheel(pickerButton, 40);
    assert.equal(pickerEvent.defaultPrevented, true);
    assert.equal(selectedIndex, 4);

    for (const control of [cardActionButton, paperBin, settingsButton, dialogButton]) {
      now += 200;
      const event = shell.wheel(control, 40);
      assert.equal(event.defaultPrevented, false);
      assert.equal(selectedIndex, 4);
    }
  } finally {
    if (previousElement === undefined) delete globalThis.Element;
    else globalThis.Element = previousElement;
  }
});

test("main wires the shell event surface to carousel movement", () => {
  assert.match(mainTs, /attachCarouselWheelListener\(sceneShellElement, onWheel\)/);
  assert.match(mainTs, /createWheelCarouselHandler\([\s\S]*cycleCarousel\(direction, false\)/);
  assert.match(mainTs, /targetTurntableAngle -= dir \* slotStep/);
  assert.doesNotMatch(mainTs, /renderer\.domElement\.addEventListener\(["']wheel["']/);
  assert.match(html, /<section class="scene-shell" id="room"[\s\S]*<nav class="room-card-nav" id="room-card-nav"/);
  assert.match(html, /<button class="trash-target" id="trash-target"/);
});
