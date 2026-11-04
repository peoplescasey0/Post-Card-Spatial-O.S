import assert from "node:assert/strict";
import test from "node:test";
import { windowsPathToWsl } from "../guest-api.mjs";

test("converts WSL UNC paths to distro-local Linux paths", () => {
  assert.equal(
    windowsPathToWsl(
      "\\\\wsl.localhost\\Ubuntu\\home\\user\\Windows.iso",
      "Ubuntu",
    ),
    "/home/user/Windows.iso",
  );
  assert.equal(
    windowsPathToWsl("\\\\wsl$\\Ubuntu\\home\\user\\Windows.iso", "Ubuntu"),
    "/home/user/Windows.iso",
  );
});

test("retains Windows drive and existing Linux mount path conversion", () => {
  assert.equal(windowsPathToWsl("G:\\images\\Windows.iso"), "/mnt/g/images/Windows.iso");
  assert.equal(windowsPathToWsl("/mnt/g/images/Windows.iso"), "/mnt/g/images/Windows.iso");
});

test("rejects WSL UNC paths for a different configured distro", () => {
  assert.throws(
    () => windowsPathToWsl("\\\\wsl.localhost\\Ubuntu\\home\\user\\Windows.iso", "Debian"),
    /belongs to WSL distribution "Ubuntu".*POSTCARD_WSL_DISTRO is "Debian"/,
  );
});
