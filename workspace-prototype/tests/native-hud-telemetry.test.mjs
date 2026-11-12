import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createGuestApi } from "../guest-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceDir = path.resolve(__dirname, "..");

let server;
let baseUrl;
let wsUrl;
let testDataDirectory;
let previousDataDirectory;

before(async () => {
  previousDataDirectory = process.env.POSTCARD_VM_DATA;
  testDataDirectory = await mkdtemp(path.join(process.cwd(), ".post-card-telemetry-"));
  process.env.POSTCARD_VM_DATA = testDataDirectory;

  const guestApi = createGuestApi();
  server = createServer(guestApi);
  const openSockets = new Set();
  server.on("connection", (sock) => {
    openSockets.add(sock);
    sock.on("close", () => openSockets.delete(sock));
  });
  server.on("upgrade", (req, socket) => {
    if (!guestApi.handleUpgrade?.(req, socket)) {
      socket.destroy();
    }
  });
  server.destroyOpenSockets = () => {
    for (const sock of openSockets) sock.destroy();
  };
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}/telemetry`;
});

after(async () => {
  try {
    server?.destroyOpenSockets?.();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  } finally {
    if (previousDataDirectory === undefined) delete process.env.POSTCARD_VM_DATA;
    else process.env.POSTCARD_VM_DATA = previousDataDirectory;
    await rm(testDataDirectory, { recursive: true, force: true });
  }
});

test("index.html includes #romy-status and #heap-meter in the Mission Control HUD pod", () => {
  const htmlPath = path.join(workspaceDir, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /id="romy-status"/, "#romy-status must exist in index.html");
  assert.match(html, /id="heap-meter"/, "#heap-meter must exist in index.html");
  assert.match(html, /Post Card OS \/\/ Mission Control/, "Panel title must appear in index.html");
});

test("HTTP GET and POST /api/guest/telemetry report and mutate PA-Romy and heap pressure", async () => {
  const initialRes = await fetch(`${baseUrl}/api/guest/telemetry`);
  assert.equal(initialRes.status, 200);
  const initial = await initialRes.json();
  assert.equal(initial.panel_title, "Post Card OS // Mission Control");
  assert.equal(initial.chassis_alloy, "Al-Li 2195 Cryogenic Hull Frame");
  assert.ok(Array.isArray(initial.avionics_log), "avionics_log must be an array");
  assert.ok(
    initial.avionics_log.some((line) => line.includes("POST CARD OS // SPACE PLANE AVIONICS v1.0.4")),
    "avionics_log must include Space Plane Avionics header",
  );
  assert.ok(
    initial.avionics_log.some((line) => line.includes("THE RADIATOR: Cryogenic Thermal Control Loop... [ STABILIZED ]")),
    "avionics_log must include THE RADIATOR stage",
  );
  assert.equal(initial.romy_active, true);
  assert.equal(initial.romy_coprocessor_state, "VAULT ACTIVE // ENCLAVE LOCKED");
  assert.equal(typeof initial.heap_pressure, "number");

  const updateRes = await fetch(`${baseUrl}/api/guest/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ romy_active: false, heap_usage_kb: 4096 }),
  });
  assert.equal(updateRes.status, 200);
  const updated = await updateRes.json();
  assert.equal(updated.romy_active, false);
  assert.equal(updated.romy_coprocessor_state, "STANDBY // IDLE");
  assert.equal(updated.heap_usage_kb, 4096);
  assert.equal(updated.heap_pressure, 50);
});

test("WebSocket /telemetry streams real-time JSON packets to host-side listener", async () => {
  // Reset back to active before connecting WebSocket
  await fetch(`${baseUrl}/api/guest/telemetry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ romy_active: true, heap_usage_kb: 2048 }),
  });

  const receivedPackets = [];
  const ws = new WebSocket(wsUrl);

  const firstPacket = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for WebSocket telemetry")), 4000);
    ws.onmessage = (event) => {
      clearTimeout(timer);
      const telemetry = JSON.parse(String(event.data));
      receivedPackets.push(telemetry);
      resolve(telemetry);
    };
    ws.onerror = (err) => {
      clearTimeout(timer);
      reject(err);
    };
  });

  assert.equal(firstPacket.panel_title, "Post Card OS // Mission Control");
  assert.equal(firstPacket.romy_coprocessor_state, "VAULT ACTIVE // ENCLAVE LOCKED");
  assert.equal(firstPacket.heap_pressure, 25);

  // Trigger a state change and verify live WebSocket broadcast
  const broadcastPacket = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for broadcast telemetry")), 4000);
    ws.onmessage = (event) => {
      clearTimeout(timer);
      resolve(JSON.parse(String(event.data)));
    };
    fetch(`${baseUrl}/api/guest/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ romy_active: true, heap_usage_kb: 6144 }),
    }).catch(reject);
  });

  assert.equal(broadcastPacket.heap_usage_kb, 6144);
  assert.equal(broadcastPacket.heap_pressure, 75);

  ws.close();
});
