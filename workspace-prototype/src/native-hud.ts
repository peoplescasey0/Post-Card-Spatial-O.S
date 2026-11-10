/**
 * Native Immediate-Mode UI & Kernel Telemetry Bridge
 * Synchronized with src-rust/framebuffer.rs and src-rust/native_hud.rs
 */

export const KERNEL_VERSION = "v1.0.4-x86_64";
export const AVIONICS_VERSION = "v1.0.4";
export const CHASSIS_ALLOY = "Al-Li 2195 Cryogenic Hull Frame";
export const KERNEL_IMAGE_PATH = "/boot/postcard-kernel-v1.0.4-x86_64";
export const KERNEL_CMDLINE = "console=ttyS0,115200 root=/dev/nvme0n1p2";
export const INITRD_IMAGE_PATH = "/boot/initrd.img";
export const KERNEL_HEAP_CAPACITY_KB = 8192;
export const FOUNDRY_HEAP_SIZE_MB = 16;
export const KERNEL_HEAP_START = 0x4444_4444_0000;
export const ELF_MAGIC_BYTES = [0x7f, 0x45, 0x4c, 0x46] as const;
export const SECTOR_SIZE = 512;

export const KERNEL_BOOT_LOG_LINES: readonly string[] = [
  "[ 0.000000 ] POST CARD OS // KERNEL CORE v1.0.4-x86_64",
  "[ 0.001042 ] CPU: Initializing IDT, GDT, & CR3 Page Table Isolation... [ SECURE ]",
  "[ 0.002890 ] THE FOUNDRY: Locking 16MB dynamic free-list memory arena... [ ALLOCATED ]",
  "[ 0.004510 ] THE CATAPULT: Loading ELF64 ring 3 segment validator... [ ARMED ]",
  "[ 0.007120 ] THE BLACK BOX: Mounting VfsStorageBridge over memory sectors... [ PERSISTENT ]",
  "[ 0.010200 ] PA-ROMY VAULT: Isolating hardware coprocessor core & telemetry mirror... [ LOCKED ]",
  "[ 0.014500 ] THE BEACON: Binding WebSocket telemetry stream to /telemetry... [ BROADCASTING ]",
] as const;

export const SPACE_PLANE_AVIONICS_LINES: readonly (readonly [string, string, string])[] = [
  ["0.000000", "POST CARD OS // SPACE PLANE AVIONICS v1.0.4", "CORE"],
  ["0.001042", "CHASSIS: Al-Li 2195 Cryogenic Hull Frame", "SECURED"],
  ["0.002890", "THE FOUNDRY: 16MB LockedHeap Arena", "STABLE"],
  ["0.004510", "THE CATAPULT: ELF64 Ring 3 Spatial Loader", "ARMED"],
  ["0.007120", "THE BLACK BOX: VfsStorageBridge Sector Mirror", "LOCKED"],
  ["0.010200", "THE RADIATOR: Cryogenic Thermal Control Loop", "STABILIZED"], // <--- NEW STAGE
  ["0.014500", "PA-ROMY VAULT: Isolated Neural Coprocessor", "ACTIVE"],
] as const;

export const SPACE_PLANE_AVIONICS_LOG_LINES: readonly string[] = [
  "========================================================================",
  ...SPACE_PLANE_AVIONICS_LINES.map(
    ([ts, subsystem, status]) => `[ ${ts} ] ${subsystem}... [ ${status} ]`,
  ),
  "========================================================================",
] as const;

export interface BlockDevice {
  read_sector(lba: number, buffer: Uint8Array): void;
  write_sector(lba: number, buffer: Uint8Array): void;
}

/**
 * TypeScript mirror of `src-rust/vfs_storage.rs::VfsStorageBridge<T>`.
 * Flushes modified VFS nodes (Freeplane files or telemetry states) to LBA block sectors.
 */
export class VfsStorageBridge<T extends BlockDevice> {
  private readonly device: T;

  constructor(device: T) {
    this.device = device;
  }

  persist_node_data(lba: number, data: Uint8Array): void {
    this.device.write_sector(lba, data);
  }

  load_node_data(lba: number, buffer: Uint8Array): void {
    this.device.read_sector(lba, buffer);
  }
}

export interface LoadedProcess {
  entry_point: number;
  cr3_frame_address: number;
  segments_loaded?: number;
  total_mapped_bytes?: number;
}

/**
 * TypeScript mirror of `src-rust/elf_loader.rs::load_elf_binary`.
 * Validates ELF magic bytes (`0x7F 'E' 'L' 'F'`) and returns the user-space LoadedProcess descriptor.
 */
export function loadElfBinary(elfBytes: Uint8Array | number[]): LoadedProcess {
  if (
    elfBytes.length < 4 ||
    elfBytes[0] !== 0x7f ||
    elfBytes[1] !== 0x45 ||
    elfBytes[2] !== 0x4c ||
    elfBytes[3] !== 0x46
  ) {
    throw new Error("Invalid ELF magic header!");
  }
  return {
    entry_point: 0x400000, // Standard user-space load base
    cr3_frame_address: 0x100000, // Process PML4 root
  };
}

export interface KernelTelemetryPacket {
  kernel_version?: string;
  avionics_version?: string;
  chassis_alloy?: string;
  panel_title: string;
  romy_active: boolean;
  romy_coprocessor_state: string;
  heap_allocator?: string;
  heap_start?: string;
  heap_usage_kb: number;
  heap_free_kb?: number;
  heap_pressure: number;
  heap_allocations?: number;
  heap_deallocations?: number;
  elf_loader?: {
    entry_point: string;
    cr3_frame_address: string;
  };
  boot_log?: readonly string[];
  avionics_log?: readonly string[];
  active_guests?: number;
  timestamp?: string;
}

export const DEFAULT_KERNEL_TELEMETRY: KernelTelemetryPacket = {
  kernel_version: KERNEL_VERSION,
  avionics_version: AVIONICS_VERSION,
  chassis_alloy: CHASSIS_ALLOY,
  panel_title: "Post Card OS // Mission Control",
  romy_active: true,
  romy_coprocessor_state: "VAULT ACTIVE // ENCLAVE LOCKED",
  heap_allocator: "linked_list_allocator::LockedHeap",
  heap_start: "0x444444440000",
  heap_usage_kb: 2048,
  heap_free_kb: 6144,
  heap_pressure: 25,
  elf_loader: {
    entry_point: "0x400000",
    cr3_frame_address: "0x100000",
  },
  boot_log: KERNEL_BOOT_LOG_LINES,
  avionics_log: SPACE_PLANE_AVIONICS_LOG_LINES,
};

/**
 * Computes deterministic kernel telemetry state from the active hypervisor & PA-Romy state.
 */
export function buildKernelTelemetryPacket(options: {
  romyActive?: boolean;
  heapUsageKb?: number;
  activeGuests?: number;
} = {}): KernelTelemetryPacket {
  const romyActive = options.romyActive ?? true;
  const heapUsageKb = Math.max(256, Math.min(KERNEL_HEAP_CAPACITY_KB, Math.round(options.heapUsageKb ?? 2048)));
  const heapPressure = Math.min(100, Math.max(0, Math.round((heapUsageKb * 100) / KERNEL_HEAP_CAPACITY_KB)));
  const romyState = romyActive
    ? "VAULT ACTIVE // ENCLAVE LOCKED"
    : "STANDBY // IDLE";

  return {
    panel_title: "Post Card OS // Mission Control",
    romy_active: romyActive,
    romy_coprocessor_state: romyState,
    heap_usage_kb: heapUsageKb,
    heap_pressure: heapPressure,
    active_guests: options.activeGuests ?? 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Immediate-mode 2D Canvas renderer mirroring `src-rust/native_hud.rs::render_native_hud`.
 * Draws the PA-Romy Coprocessor Vault badge and Heap Arena meter directly onto a 2D surface.
 */
export function renderNativeHudToCanvas(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  telemetry: KernelTelemetryPacket,
): void {
  const panelTitle = telemetry.panel_title || "Post Card OS // Mission Control";
  const romyActive = telemetry.romy_active;
  const heapPressure = Math.min(100, Math.max(0, telemetry.heap_pressure));

  ctx.save();

  // Outer panel surface
  ctx.fillStyle = "#141c30";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();

  // Header strip
  ctx.fillStyle = "#1a2642";
  ctx.beginPath();
  ctx.roundRect(x, y, w, 26, [10, 10, 0, 0]);
  ctx.fill();

  // Panel border
  ctx.strokeStyle = "#2a3855";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.stroke();

  // Header title
  ctx.fillStyle = "#79ded8";
  ctx.font = "700 12px 'DM Mono', monospace";
  ctx.fillText(panelTitle.toUpperCase(), x + 12, y + 17);

  // PA-Romy Coprocessor Vault status badge
  const badgeX = x + 12;
  const badgeY = y + 34;
  const badgeW = w - 24;
  const badgeH = 28;
  ctx.fillStyle = romyActive ? "rgba(12, 46, 36, 0.92)" : "#0a1020";
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
  ctx.fill();
  ctx.strokeStyle = romyActive ? "#22c55e" : "#2a3855";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
  ctx.stroke();

  // Status LED indicator
  ctx.fillStyle = romyActive ? "#22c55e" : "#FFB81C";
  ctx.beginPath();
  ctx.arc(badgeX + 14, badgeY + badgeH / 2, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = romyActive ? "#f4f5f7" : "#8a909e";
  ctx.font = "700 11.5px 'DM Mono', monospace";
  ctx.fillText(
    `PA-ROMY: ${telemetry.romy_coprocessor_state}`,
    badgeX + 26,
    badgeY + 18,
  );

  // Heap Arena meter bar
  const meterY = badgeY + badgeH + 10;
  ctx.fillStyle = "#c3c8d1";
  ctx.font = "600 11px 'DM Mono', monospace";
  ctx.fillText(
    `KERNEL HEAP ARENA: ${telemetry.heap_usage_kb} KB / ${KERNEL_HEAP_CAPACITY_KB} KB (${heapPressure}%)`,
    badgeX,
    meterY + 10,
  );

  const barY = meterY + 15;
  const barH = 12;
  ctx.fillStyle = "#0a1020";
  ctx.beginPath();
  ctx.roundRect(badgeX, barY, badgeW, barH, 5);
  ctx.fill();

  const fillW = Math.max(0, Math.round(((badgeW - 4) * heapPressure) / 100));
  if (fillW > 0) {
    ctx.fillStyle =
      heapPressure >= 85 ? "#ef4444" : heapPressure >= 65 ? "#FFB81C" : "#79ded8";
    ctx.beginPath();
    ctx.roundRect(badgeX + 2, barY + 2, fillW, barH - 4, 3);
    ctx.fill();
  }

  ctx.strokeStyle = "#2a3855";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(badgeX, barY, badgeW, barH, 5);
  ctx.stroke();

  // Render Space Plane Avionics v1.0.4 / Kernel Core boot log lines if panel height accommodates it
  const bootLines = telemetry.avionics_log ?? telemetry.boot_log ?? SPACE_PLANE_AVIONICS_LOG_LINES;
  const logStartY = barY + barH + 12;
  if (h >= 190 && bootLines.length > 0) {
    ctx.fillStyle = "rgba(8, 12, 22, 0.92)";
    const logBoxH = Math.min(h - (logStartY - y) - 10, bootLines.length * 13 + 12);
    ctx.beginPath();
    ctx.roundRect(badgeX, logStartY, badgeW, logBoxH, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(121, 222, 216, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(badgeX, logStartY, badgeW, logBoxH, 6);
    ctx.stroke();

    ctx.font = "500 9.5px 'DM Mono', monospace";
    bootLines.forEach((line, idx) => {
      const lineY = logStartY + 12 + idx * 12.5;
      if (lineY < logStartY + logBoxH - 3) {
        ctx.fillStyle =
          line.startsWith("====") || line.includes("SPACE PLANE AVIONICS") || idx === 0
            ? "#FFB81C"
            : line.includes("[ SECURE ]") ||
                line.includes("[ SECURED ]") ||
                line.includes("[ STABLE ]") ||
                line.includes("[ STABILIZED ]") ||
                line.includes("[ LOCKED ]") ||
                line.includes("[ ACTIVE ]") ||
                line.includes("[ BROADCASTING ]")
              ? "#22c55e"
              : "#79ded8";
        ctx.fillText(line.slice(0, 72), badgeX + 8, lineY);
      }
    });
  }

  ctx.restore();
}

/**
 * Applies a KernelTelemetryPacket directly to the DOM elements (`#romy-status` and `#heap-meter`)
 * matching the host-side WebSocket listener contract.
 */
export function applyTelemetryToDom(
  telemetry: KernelTelemetryPacket,
  doc: Pick<Document, "getElementById"> = document,
): void {
  const romyStatusEl = doc.getElementById("romy-status");
  if (romyStatusEl) {
    romyStatusEl.innerText = telemetry.romy_coprocessor_state;
    romyStatusEl.textContent = telemetry.romy_coprocessor_state;
    romyStatusEl.setAttribute("data-romy-active", String(Boolean(telemetry.romy_active)));
  }

  const heapMeterEl = doc.getElementById("heap-meter");
  if (heapMeterEl) {
    heapMeterEl.style.width = `${telemetry.heap_pressure}%`;
    heapMeterEl.setAttribute("aria-valuenow", String(telemetry.heap_pressure));
  }

  const heapLabelEl = doc.getElementById("heap-pressure-label");
  if (heapLabelEl) {
    heapLabelEl.textContent = `${telemetry.heap_pressure}% (${telemetry.heap_usage_kb} KB)`;
  }
}
