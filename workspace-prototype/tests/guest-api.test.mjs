import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { createGuestApi } from "../guest-api.mjs";

let server;
let baseUrl;
let previousDataDirectory;
let previousLinuxBase;
let testDataDirectory;

before(async () => {
  previousDataDirectory = process.env.POSTCARD_VM_DATA;
  previousLinuxBase = process.env.POSTCARD_LINUX_BASE;
  testDataDirectory = await mkdtemp(path.join(process.cwd(), ".post-card-guest-api-"));
  process.env.POSTCARD_VM_DATA = testDataDirectory;
  delete process.env.POSTCARD_LINUX_BASE;
  server = createServer(createGuestApi());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  try {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  } finally {
    if (previousDataDirectory === undefined) delete process.env.POSTCARD_VM_DATA;
    else process.env.POSTCARD_VM_DATA = previousDataDirectory;
    if (previousLinuxBase === undefined) delete process.env.POSTCARD_LINUX_BASE;
    else process.env.POSTCARD_LINUX_BASE = previousLinuxBase;
    await rm(testDataDirectory, { recursive: true, force: true });
  }
});

test("guest status reports offline before QEMU has been launched", async () => {
  const response = await fetch(`${baseUrl}/api/guest/status`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const status = await response.json();
  assert.equal(status.baseReady, false);
  assert.deepEqual(status.preparedCardIds, []);
  assert.deepEqual(status.preparedWindowsCardIds, []);
  assert.deepEqual(status.guests, []);
  assert.match(status.baseDiskPath, /debian-golden\.qcow2$/);
});

test("CPU performance profiles are validated and saved per card", async () => {
  const invalidResponse = await fetch(`${baseUrl}/api/guest/cpu-profile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId: "studio", cpuProfile: "overclock" }),
  });
  assert.equal(invalidResponse.status, 400);

  const response = await fetch(`${baseUrl}/api/guest/cpu-profile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId: "studio", cpuProfile: "gaming" }),
  });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.cpuProfiles.studio, "gaming");
  assert.ok(status.cpuCapacity >= 1);
});

test("guest status reports persistent Windows card disks", async () => {
  const windowsDiskDirectory = path.join(testDataDirectory, "windows", "disks");
  await mkdir(windowsDiskDirectory, { recursive: true });
  await writeFile(path.join(windowsDiskDirectory, "studio.qcow2"), "");

  const response = await fetch(`${baseUrl}/api/guest/status`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).preparedWindowsCardIds, ["studio"]);
});

test("guest start rejects unknown boot modes without launching QEMU", async () => {
  const response = await fetch(`${baseUrl}/api/guest/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bootMode: "windows" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /bootMode/);
});

test("guest start rejects unknown operating systems before launching any backend", async () => {
  const response = await fetch(`${baseUrl}/api/guest/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ os: "haiku", bootMode: "disk", cardId: "studio" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /os must/);
});

test("Windows guest cannot boot from an uninitialized disk", async () => {
  const response = await fetch(`${baseUrl}/api/guest/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ os: "windows", bootMode: "disk", cardId: "uninstalled" }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Install Windows/);
});

test("guest start rejects path traversal in card IDs", async () => {
  const response = await fetch(`${baseUrl}/api/guest/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bootMode: "disk", cardId: "..\\outside" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /cardId/);
});

test("guest control requires JSON and rejects unknown endpoints", async () => {
  const invalidContentType = await fetch(`${baseUrl}/api/guest/stop`, {
    method: "POST",
    body: "{}",
  });
  assert.equal(invalidContentType.status, 415);

  const unknownEndpoint = await fetch(`${baseUrl}/api/guest/reboot`);
  assert.equal(unknownEndpoint.status, 404);
});

test("wake-screen validates guest identifiers and rejects offline guests", async () => {
  const invalidCardResponse = await fetch(`${baseUrl}/api/guest/wake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId: "../outside", os: "linux" }),
  });
  assert.equal(invalidCardResponse.status, 400);
  assert.match((await invalidCardResponse.json()).error, /cardId/);

  const invalidOsResponse = await fetch(`${baseUrl}/api/guest/wake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId: "studio", os: "haiku" }),
  });
  assert.equal(invalidOsResponse.status, 400);
  assert.match((await invalidOsResponse.json()).error, /os must/);

  const offlineResponse = await fetch(`${baseUrl}/api/guest/wake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId: "studio", os: "windows" }),
  });
  assert.equal(offlineResponse.status, 409);
  assert.match((await offlineResponse.json()).error, /Start this guest before waking/);
});

test("force stop is idempotent for an offline card", async () => {
  const response = await fetch(`${baseUrl}/api/guest/force-stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId: "offline-card" }),
  });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.guests.some((guest) => guest.cardId === "offline-card"), false);
});

test("offline card deletion removes only its scoped Linux files and keyed metadata", async () => {
  const cardId = "delete-offline";
  const overlayDir = path.join(testDataDirectory, "overlays");
  const spoolDir = path.join(testDataDirectory, "paper-planes");
  const masterDir = path.join(testDataDirectory, "master-images");
  const basePath = path.join(masterDir, "debian-golden.qcow2");
  const markerPath = path.join(testDataDirectory, "debian-golden.ready.json");
  await mkdir(overlayDir, { recursive: true });
  await mkdir(masterDir, { recursive: true });
  await mkdir(path.join(spoolDir, cardId), { recursive: true });
  await mkdir(path.join(spoolDir, "keep-card"), { recursive: true });
  const ownedDisk = path.join(overlayDir, `${cardId}.qcow2`);
  const ownedCheckpoint = `${ownedDisk}.checkpoint`;
  await writeFile(ownedDisk, "private overlay fixture");
  await writeFile(ownedCheckpoint, "private checkpoint fixture");
  await writeFile(basePath, "shared Debian base fixture");
  await writeFile(markerPath, JSON.stringify({ version: 1, baseDiskPath: basePath }));
  await writeFile(path.join(spoolDir, cardId, "latest.txt"), "private spool");
  await writeFile(path.join(spoolDir, "keep-card", "latest.txt"), "other card spool");
  await writeFile(
    path.join(testDataDirectory, "checkpoints.json"),
    JSON.stringify({ [cardId]: { tag: "saved" }, "keep-card": { tag: "keep" } }),
  );
  await writeFile(
    path.join(testDataDirectory, "network-modes.json"),
    JSON.stringify({ [cardId]: "airgap", "keep-card": "nat" }),
  );
  await writeFile(
    path.join(testDataDirectory, "memory-profiles.json"),
    JSON.stringify({ [cardId]: "eco", "keep-card": "balanced" }),
  );
  await writeFile(
    path.join(testDataDirectory, "cpu-profiles.json"),
    JSON.stringify({ [cardId]: "gaming", "keep-card": "balanced" }),
  );
  await writeFile(
    path.join(testDataDirectory, "paper-planes.json"),
    JSON.stringify([
      { id: "to-card", fromCardId: "other", toCardId: cardId },
      { id: "from-card", fromCardId: cardId, toCardId: "other" },
      { id: "unrelated", fromCardId: "keep-card", toCardId: "other" },
    ]),
  );

  const response = await fetch(`${baseUrl}/api/guest/delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId, os: "linux", confirm: true }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).guests.some((guest) => guest.cardId === cardId), false);
  await assert.rejects(readFile(ownedDisk), { code: "ENOENT" });
  await assert.rejects(readFile(ownedCheckpoint), { code: "ENOENT" });
  assert.equal(await readFile(basePath, "utf8"), "shared Debian base fixture");
  assert.equal(
    await readFile(markerPath, "utf8"),
    JSON.stringify({ version: 1, baseDiskPath: basePath }),
  );
  await assert.rejects(readFile(path.join(spoolDir, cardId, "latest.txt")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(spoolDir, "keep-card", "latest.txt"), "utf8"), "other card spool");
  assert.deepEqual(JSON.parse(await readFile(path.join(testDataDirectory, "checkpoints.json"), "utf8")), {
    "keep-card": { tag: "keep" },
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(testDataDirectory, "network-modes.json"), "utf8")), {
    "keep-card": "nat",
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(testDataDirectory, "memory-profiles.json"), "utf8")), {
    "keep-card": "balanced",
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(testDataDirectory, "cpu-profiles.json"), "utf8")), {
    "keep-card": "balanced",
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(testDataDirectory, "paper-planes.json"), "utf8")), [
    { id: "unrelated", fromCardId: "keep-card", toCardId: "other" },
  ]);
  await rm(path.join(testDataDirectory, "paper-planes.json"), { force: true });
  await rm(basePath, { force: true });
  await rm(markerPath, { force: true });
});

test("confirmed deletion calls the mock force-stop for only the selected running guest first", async () => {
  const cardId = "running-fixture";
  const diskPath = path.join(testDataDirectory, "overlays", `${cardId}.qcow2`);
  await mkdir(path.dirname(diskPath), { recursive: true });
  await writeFile(diskPath, "running guest disk fixture");
  const sequence = [];
  const mockServer = createServer(createGuestApi({
    isGuestRunning: (selectedCardId, os) => {
      sequence.push(`check:${os}:${selectedCardId}`);
      return selectedCardId === cardId && os === "linux";
    },
    forceStopGuest: async (selectedCardId, os) => {
      sequence.push(`stop:${os}:${selectedCardId}`);
      assert.equal(await readFile(diskPath, "utf8"), "running guest disk fixture");
    },
  }));
  await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const address = mockServer.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/guest/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cardId, os: "linux", confirm: true }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(sequence, [`check:linux:${cardId}`, `stop:linux:${cardId}`]);
    await assert.rejects(readFile(diskPath), { code: "ENOENT" });
  } finally {
    await new Promise((resolve, reject) => {
      mockServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("card deletion validates OS, identifier, and explicit confirmation", async () => {
  const invalidCases = [
    { cardId: "..\\outside", os: "linux", confirm: true },
    { cardId: "valid-card", os: "haiku", confirm: true },
    { cardId: "valid-card", os: "linux", confirm: false },
  ];
  for (const body of invalidCases) {
    const response = await fetch(`${baseUrl}/api/guest/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /cardId|os must|confirmation/i);
  }
});

test("Windows card deletion removes private TPM and UEFI state while preserving shared base and firmware", async () => {
  const cardId = "windows-owned";
  const masterDir = path.join(testDataDirectory, "master-images");
  const windowsRoot = path.join(testDataDirectory, "windows");
  const disksDir = path.join(windowsRoot, "disks");
  const firmwareDir = path.join(windowsRoot, "firmware");
  const tpmDir = path.join(windowsRoot, "tpm");
  await mkdir(masterDir, { recursive: true });
  await mkdir(disksDir, { recursive: true });
  await mkdir(firmwareDir, { recursive: true });
  await mkdir(path.join(tpmDir, cardId), { recursive: true });
  await mkdir(path.join(tpmDir, "windows-keep"), { recursive: true });
  const basePath = path.join(masterDir, "debian-golden.qcow2");
  const markerPath = path.join(testDataDirectory, "debian-golden.ready.json");
  const windowsDisk = path.join(disksDir, `${cardId}.qcow2`);
  const windowsVars = path.join(firmwareDir, `${cardId}-VARS.fd`);
  const templatePath = path.join(firmwareDir, "OVMF_VARS_TEMPLATE.fd");
  await writeFile(basePath, "shared Debian base fixture");
  await writeFile(markerPath, JSON.stringify({ version: 1, baseDiskPath: basePath }));
  await writeFile(windowsDisk, "private Windows disk fixture");
  await writeFile(windowsVars, "private UEFI variables fixture");
  await writeFile(path.join(tpmDir, cardId, "state.bin"), "private TPM fixture");
  await writeFile(path.join(tpmDir, "windows-keep", "state.bin"), "other TPM fixture");
  await writeFile(templatePath, "shared firmware template fixture");
  await writeFile(path.join(disksDir, "windows-keep.qcow2"), "other Windows disk fixture");

  const response = await fetch(`${baseUrl}/api/guest/delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId, os: "windows", confirm: true }),
  });
  assert.equal(response.status, 200);
  await assert.rejects(readFile(windowsDisk), { code: "ENOENT" });
  await assert.rejects(readFile(windowsVars), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(tpmDir, cardId, "state.bin")), { code: "ENOENT" });
  assert.equal(await readFile(basePath, "utf8"), "shared Debian base fixture");
  assert.equal(await readFile(markerPath, "utf8"), JSON.stringify({ version: 1, baseDiskPath: basePath }));
  assert.equal(await readFile(templatePath, "utf8"), "shared firmware template fixture");
  assert.equal(await readFile(path.join(disksDir, "windows-keep.qcow2"), "utf8"), "other Windows disk fixture");
  assert.equal(await readFile(path.join(tpmDir, "windows-keep", "state.bin"), "utf8"), "other TPM fixture");
  await rm(basePath, { force: true });
  await rm(markerPath, { force: true });
  await rm(windowsRoot, { recursive: true, force: true });
});

test("clone-overlay and reset-overlay manage card disk overlays safely", async () => {
  const overlayDir = path.join(testDataDirectory, "overlays");
  await mkdir(overlayDir, { recursive: true });
  await writeFile(path.join(overlayDir, "linux.qcow2"), "fake-qcow2-overlay");

  const cloneRes = await fetch(`${baseUrl}/api/guest/clone-overlay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ os: "linux", sourceCardId: "linux", targetCardId: "linux-clone" }),
  });
  assert.equal(cloneRes.status, 200);
  const afterClone = await cloneRes.json();
  assert.equal(afterClone.preparedCardIds.includes("linux"), true);
  assert.equal(afterClone.preparedCardIds.includes("linux-clone"), true);

  const dupCloneRes = await fetch(`${baseUrl}/api/guest/clone-overlay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ os: "linux", sourceCardId: "linux", targetCardId: "linux-clone" }),
  });
  assert.equal(dupCloneRes.status, 409);

  const resetRes = await fetch(`${baseUrl}/api/guest/reset-overlay`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ os: "linux", cardId: "linux-clone" }),
  });
  assert.equal(resetRes.status, 200);
  const afterReset = await resetRes.json();
  assert.equal(afterReset.preparedCardIds.includes("linux-clone"), false);
  await rm(path.join(overlayDir, "linux.qcow2"), { force: true });
});

test("paper-plane spools messages to disk and enforces running VM for manual QMP injection", async () => {
  const sendRes = await fetch(`${baseUrl}/api/guest/paper-plane`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromCardId: "windows",
      toCardId: "linux",
      os: "linux",
      message: "echo 'hello from windows'",
    }),
  });
  assert.equal(sendRes.status, 200);
  const statusAfterSend = await sendRes.json();
  assert.equal(Array.isArray(statusAfterSend.paperPlanes), true);
  assert.equal(statusAfterSend.paperPlanes.length, 1);
  assert.equal(statusAfterSend.paperPlanes[0].fromCardId, "windows");
  assert.equal(statusAfterSend.paperPlanes[0].toCardId, "linux");
  assert.equal(statusAfterSend.paperPlanes[0].deliveredToVm, false);

  const spooledText = await readFile(
    path.join(testDataDirectory, "paper-planes", "linux", "latest.txt"),
    "utf8",
  );
  assert.equal(spooledText, "echo 'hello from windows'\n");

  const catchRes = await fetch(`${baseUrl}/api/guest/paper-plane/catch`);
  assert.equal(catchRes.status, 200);
  assert.equal(await catchRes.text(), "echo 'hello from windows'\n");

  const remoteSendRes = await fetch(`${baseUrl}/api/guest/paper-plane`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromCardId: "linux",
      toCardId: "remote-peer",
      os: "remote",
      message: "live peer ping",
      remoteTarget: baseUrl,
    }),
  });
  assert.equal(remoteSendRes.status, 200);
  const statusAfterRemote = await remoteSendRes.json();
  const lastRecord = statusAfterRemote.paperPlanes[statusAfterRemote.paperPlanes.length - 1];
  assert.equal(lastRecord.deliveredToRemote, true);

  const injectOfflineRes = await fetch(`${baseUrl}/api/guest/paper-plane/inject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cardId: "linux",
      os: "linux",
    }),
  });
  assert.equal(injectOfflineRes.status, 409);
  assert.match((await injectOfflineRes.json()).error, /Start this guest before injecting/);
});

test("ai-command synthesizes OS-specific SecOps playbooks and snapshot manages Time-Travel savepoints", async () => {
  const aiRes = await fetch(`${baseUrl}/api/guest/ai-command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "recon-ports",
      targetCardId: "linux",
      os: "linux",
    }),
  });
  assert.equal(aiRes.status, 200);
  const aiPayload = await aiRes.json();
  assert.equal(aiPayload.aiResult.category, "SECOPS · NETWORK RECON");
  assert.match(aiPayload.aiResult.command, /ss -tulpn/);

  const saveRes = await fetch(`${baseUrl}/api/guest/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "save",
      cardId: "linux",
      os: "linux",
      tag: "pre-exploit",
    }),
  });
  assert.equal(saveRes.status, 200);
  const savePayload = await saveRes.json();
  assert.equal(savePayload.checkpoints.linux.tag, "pre-exploit");

  const rewindRes = await fetch(`${baseUrl}/api/guest/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "rewind",
      cardId: "linux",
      os: "linux",
      tag: "pre-exploit",
    }),
  });
  assert.equal(rewindRes.status, 200);
  const rewindPayload = await rewindRes.json();
  assert.equal(typeof rewindPayload.checkpoints.linux.rewoundAt, "string");

  const netRes = await fetch(`${baseUrl}/api/guest/network-mode`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cardId: "kali-red",
      networkMode: "cyber-range",
    }),
  });
  assert.equal(netRes.status, 200);
  const netPayload = await netRes.json();
  assert.equal(netPayload.networkModes["kali-red"], "cyber-range");

  const swarmRes = await fetch(`${baseUrl}/api/guest/swarm-fork`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceCardId: "linux",
      os: "linux",
      count: 2,
      targetCardIds: ["linux-swarm-a", "linux-swarm-b"],
    }),
  });
  assert.equal(swarmRes.status, 200);
  const swarmPayload = await swarmRes.json();
  assert.deepEqual(swarmPayload.swarmResult.createdCardIds, ["linux-swarm-a", "linux-swarm-b"]);
  assert.equal(typeof swarmPayload.paperPlanes[0].chainHash, "string");

  const fileDropRes = await fetch(`${baseUrl}/api/guest/file-drop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromCardId: "windows",
      toCardId: "linux",
      os: "linux",
      fileName: "payload.sh",
      contentBase64: Buffer.from("#!/bin/sh\necho heavy-plane\n").toString("base64"),
    }),
  });
  assert.equal(fileDropRes.status, 200);
  const droppedContent = await readFile(
    path.join(testDataDirectory, "paper-planes", "linux", "payload.sh"),
    "utf8",
  );
  assert.equal(droppedContent, "#!/bin/sh\necho heavy-plane\n");

  const serialOfflineRes = await fetch(`${baseUrl}/api/guest/serial-exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cardId: "linux",
      os: "linux",
      command: "uname -a",
    }),
  });
  assert.equal(serialOfflineRes.status, 409);
  assert.match((await serialOfflineRes.json()).error, /Start this guest before/);

  const memProfileRes = await fetch(`${baseUrl}/api/guest/memory-profile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cardId: "windows-2",
      profile: "eco",
    }),
  });
  assert.equal(memProfileRes.status, 200);
  const memProfilePayload = await memProfileRes.json();
  assert.equal(memProfilePayload.memoryProfiles["windows-2"], "eco");
  assert.equal(memProfilePayload.maxConcurrentGuests, 6);
});

test("guest start says QEMU was not found instead of spawning a bare name", async () => {
  // A bare executable name used to be reported as "present" without ever checking
  // PATH, so this guard was dead code and a missing QEMU only surfaced later as a
  // raw `spawn qemu-system-x86_64 ENOENT`.
  const previousQemu = process.env.POSTCARD_QEMU;
  process.env.POSTCARD_QEMU = "post-card-no-such-qemu-binary";
  let api;
  try {
    api = createServer(createGuestApi());
    await new Promise((resolve) => api.listen(0, "127.0.0.1", resolve));
    const response = await fetch(`http://127.0.0.1:${api.address().port}/api/guest/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ os: "linux", bootMode: "installer", cardId: "linux" }),
    });
    assert.equal(response.status, 503);
    assert.match(
      (await response.json()).error,
      /QEMU was not found at post-card-no-such-qemu-binary\. Set POSTCARD_QEMU/,
    );
  } finally {
    if (api) await new Promise((resolve) => api.close(resolve));
    if (previousQemu === undefined) delete process.env.POSTCARD_QEMU;
    else process.env.POSTCARD_QEMU = previousQemu;
  }
});
