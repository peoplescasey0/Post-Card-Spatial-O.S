import assert from "node:assert/strict";
import test from "node:test";
import { accelerationArgument, resolveAcceleration } from "../guest-api.mjs";

test("a KVM-capable Linux host uses KVM instead of software emulation", () => {
  assert.deepEqual(resolveAcceleration({ platform: "linux", kvmAvailable: true }), {
    mode: "kvm",
    reason: "/dev/kvm is available",
  });
});

test("a Linux host without /dev/kvm falls back to TCG and explains why", () => {
  const result = resolveAcceleration({ platform: "linux", kvmAvailable: false });
  assert.equal(result.mode, "tcg");
  assert.match(result.reason, /\/dev\/kvm/);
});

test("Windows and macOS use their native hypervisor frameworks", () => {
  assert.equal(resolveAcceleration({ platform: "win32" }).mode, "whpx");
  assert.equal(resolveAcceleration({ platform: "darwin" }).mode, "hvf");
});

test("unknown platforms degrade to software emulation", () => {
  const result = resolveAcceleration({ platform: "freebsd" });
  assert.equal(result.mode, "tcg");
  assert.match(result.reason, /freebsd/);
});

test("WHPX keeps its userspace IRQ chip while other modes pass through", () => {
  assert.equal(accelerationArgument("whpx"), "whpx,kernel-irqchip=off");
  for (const mode of ["kvm", "hvf", "tcg"]) {
    assert.equal(accelerationArgument(mode), mode);
  }
});
