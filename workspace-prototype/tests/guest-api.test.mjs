import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createGuestApi } from "../guest-api.mjs";

let server;
let baseUrl;
let previousDataDirectory;
let testDataDirectory;

before(async () => {
  previousDataDirectory = process.env.POSTCARD_VM_DATA;
  testDataDirectory = await mkdtemp(path.join(tmpdir(), "post-card-guest-api-"));
  process.env.POSTCARD_VM_DATA = testDataDirectory;
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
  assert.match((await response.json()).error, /Install Windows 11/);
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

test("PairDrop 6-digit pairing, 5-letter public rooms, and pairdrop:// Paper Plane delivery work end-to-end", async () => {
  const initRes = await fetch(`${baseUrl}/api/guest/pairdrop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "pair-initiate", cardId: "linux" }),
  });
  assert.equal(initRes.status, 200);
  const initPayload = await initRes.json();
  const pairKey = initPayload.pairdropResult.pairKey;
  assert.match(pairKey, /^\d{6}$/);
  assert.equal(initPayload.pairdropResult.roomSecret.length, 64);

  const joinRes = await fetch(`${baseUrl}/api/guest/pairdrop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "pair-join", cardId: "windows", pairKey }),
  });
  assert.equal(joinRes.status, 200);
  const joinPayload = await joinRes.json();
  assert.deepEqual(joinPayload.pairdropResult.peers, ["linux", "windows"]);

  const planeRes = await fetch(`${baseUrl}/api/guest/paper-plane`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromCardId: "linux",
      toCardId: "windows",
      os: "windows",
      message: "pairdrop mesh payload",
      remoteTarget: `pairdrop://${pairKey}`,
    }),
  });
  assert.equal(planeRes.status, 200);
  const planePayload = await planeRes.json();
  const lastPlane = planePayload.paperPlanes.at(-1);
  assert.equal(lastPlane.deliveredToRemote, true);
  assert.match(lastPlane.remoteDeliveryInfo, new RegExp(`pairdrop://${pairKey}`));

  const winDropped = await readFile(
    path.join(testDataDirectory, "paper-planes", "windows", "latest.txt"),
    "utf8",
  );
  assert.equal(winDropped, "pairdrop mesh payload\n");

  const roomRes = await fetch(`${baseUrl}/api/guest/pairdrop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "public-room", cardId: "linux", roomId: "alpha" }),
  });
  assert.equal(roomRes.status, 200);
  const roomPayload = await roomRes.json();
  assert.equal(roomPayload.pairdropResult.roomId, "alpha");

  const linkRes = await fetch(`${baseUrl}/api/guest/pairdrop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "deeplink", cardId: "linux", message: "hello pairdrop cli" }),
  });
  assert.equal(linkRes.status, 200);
  const linkPayload = await linkRes.json();
  assert.match(linkPayload.pairdropResult.url, /\?base64text=hash#/);
});

test("LocalSend v2 info, prepare-upload, and EVE-OS + Easy-GPU-PV integrations report status cleanly", async () => {
  const infoRes = await fetch(`${baseUrl}/api/guest/localsend/v2/info`);
  assert.equal(infoRes.status, 200);
  const info = await infoRes.json();
  assert.equal(info.version, "2.1");
  assert.equal(info.port, 53317);

  const hostPort = new URL(baseUrl).host;
  const lsPlaneRes = await fetch(`${baseUrl}/api/guest/paper-plane`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromCardId: "windows",
      toCardId: "linux",
      os: "linux",
      message: "localsend lan transfer",
      remoteTarget: `localsend://${hostPort}`,
    }),
  });
  assert.equal(lsPlaneRes.status, 200);
  const lsPlanePayload = await lsPlaneRes.json();
  assert.equal(lsPlanePayload.paperPlanes.at(-1).deliveredToRemote, true);
  assert.equal(lsPlanePayload.integrations.bitvisor, true);
  assert.equal(lsPlanePayload.integrations.nvidiaOpenShell, true);
  assert.equal(lsPlanePayload.integrations.pairDrop, true);

  const gpuPvRes = await fetch(`${baseUrl}/api/guest/gpu-pv`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId: "windows", gpuName: "RTX-4090", vramPercent: 50 }),
  });
  assert.equal(gpuPvRes.status, 200);
  const gpuPvPayload = await gpuPvRes.json();
  assert.match(gpuPvPayload.gpuPvResult.powershellScript, /Add-VMGpuPartitionAdapter/);
});
