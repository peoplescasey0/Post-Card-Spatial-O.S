import assert from "node:assert/strict";
import { test } from "node:test";
import { qemuArguments } from "../guest-api.mjs";

const ports = { vncPort: 5900, websocketPort: 5700, qmpPort: 4444, serialPort: 4544 };

function ideSlots(args) {
  return args
    .filter((arg, index) => args[index - 1] === "-drive")
    .filter((spec) => spec.includes("if=ide"))
    .map((spec) => Number(/index=(\d+)/.exec(spec)?.[1]));
}

test("installer CD does not collide with the paper-plane drive on the IDE bus", () => {
  // A bare -cdrom claims IDE index 2, which is where the paper-plane FAT drive
  // already is, and QEMU refuses to start with
  // "drive with bus=2, unit=0 (index=2) exists".
  const args = qemuArguments({
    bootMode: "installer",
    cardId: "linux",
    diskPath: "/tmp/disk.qcow2",
    isoPath: "/tmp/postcard-spatial-os.iso",
    ports,
    dropDir: "/tmp/drop",
    memoryMb: 2048,
    vcpus: 2,
  });

  assert.ok(!args.includes("-cdrom"), "-cdrom claims a fixed IDE slot; use an explicit drive spec");
  const slots = ideSlots(args);
  assert.ok(slots.length >= 2, `expected the CD and the paper plane on the IDE bus, got [${slots}]`);
  assert.equal(new Set(slots).size, slots.length, `two drives share an IDE slot: [${slots}]`);
  assert.ok(
    args.some((arg) => arg.includes("media=cdrom")),
    "the installer ISO must still be attached as a CD",
  );
});

test("booting an existing disk leaves the CD off the IDE bus", () => {
  const args = qemuArguments({
    bootMode: "disk",
    cardId: "linux",
    diskPath: "/tmp/disk.qcow2",
    isoPath: "",
    ports,
    dropDir: "/tmp/drop",
    memoryMb: 2048,
    vcpus: 2,
  });

  assert.ok(!args.some((arg) => arg.includes("media=cdrom")), "no CD should be attached in disk mode");
  assert.deepEqual(ideSlots(args), [2]);
});
