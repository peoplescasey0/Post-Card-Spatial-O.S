import assert from "node:assert/strict";
import test from "node:test";
import { isBlockedPaperPlaneTarget } from "../guest-api.mjs";

test("cloud metadata and link-local addresses are refused", () => {
  for (const host of [
    "169.254.169.254",
    "169.254.7.7",
    "metadata.google.internal",
    "metadata",
    "fd00:ec2::254",
    "[fd00:ec2::254]",
  ]) {
    assert.equal(isBlockedPaperPlaneTarget(host), true, host);
  }
});

test("ordinary LAN, public and loopback destinations still work", () => {
  for (const host of [
    "192.168.1.50",
    "10.0.0.2",
    "example.com",
    "webhook.site",
    "127.0.0.1",
    "localhost",
    "::1",
  ]) {
    assert.equal(isBlockedPaperPlaneTarget(host), false, host);
  }
});

test("an empty destination is refused", () => {
  assert.equal(isBlockedPaperPlaneTarget(""), true);
  assert.equal(isBlockedPaperPlaneTarget(undefined), true);
});
