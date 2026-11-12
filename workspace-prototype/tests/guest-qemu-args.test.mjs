import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { qemuArguments } from "../guest-api.mjs";

const ports = { vncPort: 5900, websocketPort: 5700, qmpPort: 4444, serialPort: 4544 };

// qemuArguments only attaches media that exists on disk, so these tests need
// real files to point at.
const scratch = mkdtempSync(join(tmpdir(), "postcard-args-"));
function mediaFile(name) {
  const file = join(scratch, name);
  writeFileSync(file, "");
  return file;
}

function ideSlots(args) {
  return args
    .filter((arg, index) => args[index - 1] === "-drive")
    .filter((spec) => spec.includes("if=ide"))
    .map((spec) => Number(/index=(\d+)/.exec(spec)?.[1]));
}

function osDisk(args) {
  return args.find((arg) => arg.startsWith("virtio-blk-pci,drive=osdisk")) ?? "";
}

function bootOrder(args) {
  return args[args.indexOf("-boot") + 1];
}

function assertDistinctIdeSlots(args) {
  const slots = ideSlots(args);
  assert.ok(slots.length >= 2, `expected a CD and the paper-plane drive, got [${slots}]`);
  assert.equal(new Set(slots).size, slots.length, `two drives share an IDE slot: [${slots}]`);
}

test("installer CD does not collide with the paper-plane drive on the IDE bus", () => {
  // A bare -cdrom claims IDE index 2, which is where the paper-plane FAT drive
  // already is, and QEMU refuses to start with
  // "drive with bus=2, unit=0 (index=2) exists".
  const args = qemuArguments({
    bootMode: "installer",
    cardId: "linux",
    diskPath: "/tmp/disk.qcow2",
    isoPath: mediaFile("debian-installer.iso"),
    ports,
    dropDir: "/tmp/drop",
    memoryMb: 2048,
    vcpus: 2,
  });

  assert.ok(!args.includes("-cdrom"), "-cdrom claims a fixed IDE slot; use an explicit drive spec");
  assertDistinctIdeSlots(args);
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

test("a card with its own ISO boots that ISO instead of the kernel loader", () => {
  // QEMU's -kernel loader reads a Linux bzImage, a PVH ELF or a Multiboot1
  // image. The Post Card kernel is Multiboot2, so a card that was handed the
  // built ISO has to start from the CD, with the CD ahead of the OS disk.
  const args = qemuArguments({
    bootMode: "disk",
    cardId: "postcard-os",
    diskPath: "/tmp/disk.qcow2",
    isoPath: mediaFile("postcard-spatial-os.iso"),
    bootFromIso: true,
    ports,
    dropDir: "/tmp/drop",
    memoryMb: 2048,
    vcpus: 2,
  });

  assert.ok(!args.includes("-kernel"), "-kernel cannot load this kernel");
  assert.ok(args.some((arg) => arg.includes("media=cdrom")), "the card ISO must be attached");
  assert.equal(bootOrder(args), "order=d", "the CD must be first in the boot order");
  assertDistinctIdeSlots(args);
  assert.ok(
    !osDisk(args).includes("bootindex=0"),
    "a bootindex on the OS disk would outrank the CD",
  );
});

test("a kernel guest without its own ISO still uses the kernel loader", () => {
  const args = qemuArguments({
    bootMode: "disk",
    cardId: "postcard-os",
    diskPath: "/tmp/disk.qcow2",
    isoPath: "",
    kernelPath: mediaFile("kernel.elf"),
    ports,
    dropDir: "/tmp/drop",
    memoryMb: 2048,
    vcpus: 2,
  });

  assert.ok(args.includes("-kernel"), "the kernel loader is the fallback when no ISO is set");
  assert.ok(!args.some((arg) => arg.includes("media=cdrom")));
});

test("the Debian installer ISO is not booted when the card runs its own disk", () => {
  // isoPath is POSTCARD_DEBIAN_ISO for every Linux card, so only a card's own
  // media may turn the CD into the boot device.
  const args = qemuArguments({
    bootMode: "disk",
    cardId: "linux",
    diskPath: "/tmp/disk.qcow2",
    isoPath: mediaFile("debian-13.iso"),
    ports,
    dropDir: "/tmp/drop",
    memoryMb: 2048,
    vcpus: 2,
  });

  assert.ok(
    !args.some((arg) => arg.includes("media=cdrom")),
    "the Debian ISO must stay unattached here",
  );
  assert.equal(bootOrder(args), "order=c");
});

test("the Android CD takes its own IDE slot", () => {
  const args = qemuArguments({
    bootMode: "installer",
    cardId: "android",
    diskPath: "/tmp/android.qcow2",
    isoPath: mediaFile("android.iso"),
    isAndroid: true,
    ports,
    dropDir: "/tmp/drop",
    memoryMb: 2048,
    vcpus: 2,
  });

  assert.ok(!args.includes("-cdrom"), "-cdrom claims a fixed IDE slot");
  assertDistinctIdeSlots(args);
});
