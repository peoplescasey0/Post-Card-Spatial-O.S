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

test("Rust immediate-mode HUD, Framebuffer, and Dynamic Free-List Heap modules exist", () => {
  const fbPath = path.join(workspaceDir, "src-rust", "framebuffer.rs");
  const hudPath = path.join(workspaceDir, "src-rust", "native_hud.rs");
  const heapPath = path.join(workspaceDir, "src-rust", "heap.rs");
  assert.ok(fs.existsSync(fbPath), "src-rust/framebuffer.rs must exist");
  assert.ok(fs.existsSync(hudPath), "src-rust/native_hud.rs must exist");
  assert.ok(fs.existsSync(heapPath), "src-rust/heap.rs must exist");

  const hudSource = fs.readFileSync(hudPath, "utf8");
  assert.match(hudSource, /use crate::framebuffer::\{Color, Framebuffer\};/);
  assert.match(hudSource, /pub fn render_native_hud\(/);
  assert.match(hudSource, /let panel_title = "Post Card OS \/\/ Mission Control";/);
  assert.match(hudSource, /if romy_active \{/);
  assert.match(hudSource, /PA-ROMY COPROCESSOR VAULT/);

  const heapSource = fs.readFileSync(heapPath, "utf8");
  assert.match(heapSource, /use linked_list_allocator::LockedHeap;/);
  assert.match(heapSource, /#\[global_allocator\]/);
  assert.match(heapSource, /static ALLOCATOR: LockedHeap = LockedHeap::empty\(\);/);
  assert.match(heapSource, /pub unsafe fn init_dynamic_heap\(heap_start: usize, heap_size: usize\)/);
  assert.match(heapSource, /ALLOCATOR\.lock\(\)\.init\(heap_start, heap_size\);/);

  const elfPath = path.join(workspaceDir, "src-rust", "elf_loader.rs");
  assert.ok(fs.existsSync(elfPath), "src-rust/elf_loader.rs must exist");
  const elfSource = fs.readFileSync(elfPath, "utf8");
  assert.match(elfSource, /pub struct LoadedProcess/);
  assert.match(elfSource, /pub entry_point: u64/);
  assert.match(elfSource, /pub cr3_frame_address: u64/);
  assert.match(elfSource, /pub unsafe fn load_elf_binary\(elf_bytes: &\[u8\]\) -> Result<LoadedProcess, &'static str>/);
  assert.match(elfSource, /&\[0x7F, b'E', b'L', b'F'\]/);
  assert.match(elfSource, /return Err\("Invalid ELF magic header!"\);/);
  assert.match(elfSource, /0x40_?0000/);
  assert.match(elfSource, /0x10_?0000/);

  const vfsPath = path.join(workspaceDir, "src-rust", "vfs_storage.rs");
  assert.ok(fs.existsSync(vfsPath), "src-rust/vfs_storage.rs must exist");
  const vfsSource = fs.readFileSync(vfsPath, "utf8");
  assert.match(vfsSource, /pub trait BlockDevice/);
  assert.match(vfsSource, /fn read_sector\(&mut self, lba: u64, buffer: &mut \[u8\]\) -> Result<\(\), &'static str>;/);
  assert.match(vfsSource, /fn write_sector\(&mut self, lba: u64, buffer: &\[u8\]\) -> Result<\(\), &'static str>;/);
  assert.match(vfsSource, /pub struct VfsStorageBridge<T: BlockDevice>/);
  assert.match(vfsSource, /pub fn persist_node_data\(&mut self, lba: u64, data: &\[u8\]\) -> Result<\(\), &'static str>/);
  assert.match(vfsSource, /self\.device\.write_sector\(lba, data\)/);

  const installerPath = path.join(workspaceDir, "..", "scripts", "rapid_deploy_installer.sh");
  assert.ok(fs.existsSync(installerPath), "scripts/rapid_deploy_installer.sh must exist");
  const installerSource = fs.readFileSync(installerPath, "utf8");
  assert.match(installerSource, /Post Card OS \/\/ Rapid Deployment Installer/);
  assert.match(installerSource, /SPACE PLANE AVIONICS v1\.0\.4/);
  assert.match(installerSource, /Al-Li 2195 Cryogenic Hull Frame/);
  assert.match(installerSource, /BOOT_PART="\$\{TARGET_DRIVE\}p1"/);
  assert.match(installerSource, /ROOT_PART="\$\{TARGET_DRIVE\}p2"/);
  assert.match(installerSource, /parted --script "\$TARGET_DRIVE"/);
  assert.match(installerSource, /mkpart ESP fat32 1MiB 512MiB/);
  assert.match(installerSource, /mkpart primary ext4 512MiB 100%/);
  assert.match(installerSource, /grub-install --target=x86_64-efi/);

  const netbootGrubPath = path.join(workspaceDir, "..", "scripts", "netboot_grub.cfg");
  assert.ok(fs.existsSync(netbootGrubPath), "scripts/netboot_grub.cfg must exist");
  const netbootGrubSource = fs.readFileSync(netbootGrubPath, "utf8");
  assert.match(netbootGrubSource, /menuentry "Post Card OS \/\/ Space Plane Avionics v1\.0\.4 \(Netboot\)"/);
  assert.match(netbootGrubSource, /linux \/postcard-kernel console=ttyS0,115200 root=\/dev\/nvme0n1p2/);
  assert.match(netbootGrubSource, /initrd \/initrd\.img/);

  const bootSeqPath = path.join(workspaceDir, "src-rust", "boot_sequence.rs");
  assert.ok(fs.existsSync(bootSeqPath), "src-rust/boot_sequence.rs must exist");
  const bootSeqSource = fs.readFileSync(bootSeqPath, "utf8");
  assert.match(bootSeqSource, /POST CARD OS \/\/ KERNEL CORE v1\.0\.4-x86_64/);
  assert.match(bootSeqSource, /CPU: Initializing IDT, GDT, & CR3 Page Table Isolation\.\.\. \[ SECURE \]/);
  assert.match(bootSeqSource, /THE FOUNDRY: Locking 16MB dynamic free-list memory arena\.\.\. \[ ALLOCATED \]/);
  assert.match(bootSeqSource, /THE CATAPULT: Loading ELF64 ring 3 segment validator\.\.\. \[ ARMED \]/);
  assert.match(bootSeqSource, /THE BLACK BOX: Mounting VfsStorageBridge over memory sectors\.\.\. \[ PERSISTENT \]/);
  assert.match(bootSeqSource, /PA-ROMY VAULT: Isolating hardware coprocessor core & telemetry mirror\.\.\. \[ LOCKED \]/);
  assert.match(bootSeqSource, /THE BEACON: Binding WebSocket telemetry stream to \/telemetry\.\.\. \[ BROADCASTING \]/);
  assert.match(bootSeqSource, /pub const SPACE_PLANE_AVIONICS_LINES: &\[\(&str, &str, &str\)\] = &\[/);
  assert.match(bootSeqSource, /\("0\.000000", "POST CARD OS \/\/ SPACE PLANE AVIONICS v1\.0\.4", "CORE"\)/);
  assert.match(bootSeqSource, /\("0\.001042", "CHASSIS: Al-Li 2195 Cryogenic Hull Frame", "SECURED"\)/);
  assert.match(bootSeqSource, /\("0\.002890", "THE FOUNDRY: 16MB LockedHeap Arena", "STABLE"\)/);
  assert.match(bootSeqSource, /\("0\.004510", "THE CATAPULT: ELF64 Ring 3 Spatial Loader", "ARMED"\)/);
  assert.match(bootSeqSource, /\("0\.007120", "THE BLACK BOX: VfsStorageBridge Sector Mirror", "LOCKED"\)/);
  assert.match(bootSeqSource, /\("0\.010200", "THE RADIATOR: Cryogenic Thermal Control Loop", "STABILIZED"\)/);
  assert.match(bootSeqSource, /\("0\.014500", "PA-ROMY VAULT: Isolated Neural Coprocessor", "ACTIVE"\)/);
  assert.match(bootSeqSource, /kernel \/boot\/postcard-kernel-v1\.0\.4-x86_64 console=ttyS0,115200 root=\/dev\/nvme0n1p2/);
  assert.match(bootSeqSource, /initrd \/boot\/initrd\.img/);
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
