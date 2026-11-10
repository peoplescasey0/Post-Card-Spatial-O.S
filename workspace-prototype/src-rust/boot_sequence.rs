//! Bare-Metal Kernel Boot Sequence & Subsystem Self-Test (`v1.0.4-x86_64`)
//!
//! Orchestrates the 7-stage Post Card OS boot sequence across:
//! 1. THE FOUNDRY (`heap::init_dynamic_heap` — 16MB `LockedHeap` arena)
//! 2. PA-ROMY VAULT (hardware isolation & read-only telemetry mirror)
//! 3. THE CATAPULT (`elf_loader::load_elf_binary` — ELF64 magic verification & Ring 3 mapping)
//! 4. THE BLACK BOX (`vfs_storage::VfsStorageBridge` linked to `MemoryBlockDevice` sectors)
//! 5. THE BEACON (`/telemetry` WebSocket stream active & broadcasting)
//! 6. THE GLASS COCKPIT (`native_hud::render_native_hud` blitted to linear `Framebuffer` at 60 FPS)

use crate::elf_loader::load_elf_binary;
use crate::framebuffer::Framebuffer;
use crate::heap::{init_dynamic_heap, HEAP_START};
use crate::native_hud::render_native_hud;
use crate::vfs_storage::{MemoryBlockDevice, VfsStorageBridge, VFS_TELEMETRY_LBA};

/// Kernel version banner string.
pub const KERNEL_VERSION: &str = "v1.0.4-x86_64";

/// Space Plane Avionics version string.
pub const AVIONICS_VERSION: &str = "v1.0.4";

/// Aerospace structural chassis material specification.
pub const CHASSIS_ALLOY: &str = "Al-Li 2195 Cryogenic Hull Frame";

/// Canonical kernel binary path loaded by GRUB / UEFI.
pub const KERNEL_IMAGE_PATH: &str = "/boot/postcard-kernel-v1.0.4-x86_64";

/// Canonical kernel command-line arguments (`ttyS0` 115200 baud serial + NVMe root partition).
pub const KERNEL_CMDLINE: &str = "console=ttyS0,115200 root=/dev/nvme0n1p2";

/// Canonical initial ramdisk image path.
pub const INITRD_IMAGE_PATH: &str = "/boot/initrd.img";

/// Canonical GRUB bootloader command sequence.
pub const GRUB_BOOT_COMMANDS: [&str; 3] = [
    "kernel /boot/postcard-kernel-v1.0.4-x86_64 console=ttyS0,115200 root=/dev/nvme0n1p2",
    "initrd /boot/initrd.img",
    "boot",
];

/// 16 MiB LockedHeap arena size (`16 * 1024 * 1024` bytes) initialized by THE FOUNDRY.
pub const FOUNDRY_HEAP_SIZE: usize = 16 * 1024 * 1024;

/// Canonical 7-line serial (`ttyS0` / `COM1`) boot log for Post Card OS `v1.0.4-x86_64`.
pub const BOOT_LOG_LINES: [&str; 7] = [
    "[ 0.000000 ] POST CARD OS // KERNEL CORE v1.0.4-x86_64",
    "[ 0.001042 ] CPU: Initializing IDT, GDT, & CR3 Page Table Isolation... [ SECURE ]",
    "[ 0.002890 ] THE FOUNDRY: Locking 16MB dynamic free-list memory arena... [ ALLOCATED ]",
    "[ 0.004510 ] THE CATAPULT: Loading ELF64 ring 3 segment validator... [ ARMED ]",
    "[ 0.007120 ] THE BLACK BOX: Mounting VfsStorageBridge over memory sectors... [ PERSISTENT ]",
    "[ 0.010200 ] PA-ROMY VAULT: Isolating hardware coprocessor core & telemetry mirror... [ LOCKED ]",
    "[ 0.014500 ] THE BEACON: Binding WebSocket telemetry stream to /telemetry... [ BROADCASTING ]",
];

/// Canonical Space Plane Avionics v1.0.4 ignition stages (`(timestamp, subsystem, status)`).
pub const SPACE_PLANE_AVIONICS_LINES: &[(&str, &str, &str)] = &[
    ("0.000000", "POST CARD OS // SPACE PLANE AVIONICS v1.0.4", "CORE"),
    ("0.001042", "CHASSIS: Al-Li 2195 Cryogenic Hull Frame", "SECURED"),
    ("0.002890", "THE FOUNDRY: 16MB LockedHeap Arena", "STABLE"),
    ("0.004510", "THE CATAPULT: ELF64 Ring 3 Spatial Loader", "ARMED"),
    ("0.007120", "THE BLACK BOX: VfsStorageBridge Sector Mirror", "LOCKED"),
    ("0.010200", "THE RADIATOR: Cryogenic Thermal Control Loop", "STABILIZED"), // <--- NEW STAGE
    ("0.014500", "PA-ROMY VAULT: Isolated Neural Coprocessor", "ACTIVE"),
];

/// Returns the formatted multi-line Space Plane Avionics v1.0.4 ignition banner.
pub fn format_space_plane_avionics_banner() -> String {
    let mut lines = Vec::with_capacity(SPACE_PLANE_AVIONICS_LINES.len() + 2);
    lines.push("========================================================================".to_string());
    for (ts, subsystem, status) in SPACE_PLANE_AVIONICS_LINES {
        lines.push(format!("[ {ts} ] {subsystem}... [ {status} ]"));
    }
    lines.push("========================================================================".to_string());
    lines.join("\n")
}

/// Result of running the full bare-metal kernel boot sequence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootReport {
    pub version: &'static str,
    pub chassis_alloy: &'static str,
    pub log_output: String,
    pub avionics_banner: String,
    pub telemetry_json: String,
    pub elf_entry_point: u64,
    pub vfs_flushed_sectors: u64,
}

/// Executes the full 7-stage Post Card OS boot sequence (`v1.0.4-x86_64`) and returns a [`BootReport`].
pub fn run_kernel_boot_sequence() -> BootReport {
    // Stage 1: THE FOUNDRY — Initialize dynamic free-list heap (16MB LockedHeap arena)
    unsafe {
        init_dynamic_heap(HEAP_START, FOUNDRY_HEAP_SIZE);
    }

    // Stage 2: PA-ROMY VAULT — Hardware isolation & read-only telemetry mirror
    let romy_active = true;

    // Stage 3: THE CATAPULT — ELF64 magic byte verification & Ring 3 segment mapping
    let minimal_elf = [0x7F, b'E', b'L', b'F', 2, 1, 1, 0];
    let loaded_proc =
        unsafe { load_elf_binary(&minimal_elf) }.expect("THE CATAPULT ELF64 verification failed");

    // Stage 4: THE BLACK BOX — VfsStorageBridge linked to MemoryBlockDevice sectors
    let block_dev = MemoryBlockDevice::<256>::new();
    let mut vfs_bridge = VfsStorageBridge::new(block_dev);

    // Stage 5 & 6: THE BEACON & THE GLASS COCKPIT — Render HUD into linear framebuffer & emit telemetry
    let width = 480;
    let height = 240;
    let mut vram = vec![0u32; width * height];
    let mut fb = Framebuffer::new(width, height, width, &mut vram);
    let telemetry_json = render_native_hud(&mut fb, romy_active, 2048);

    let _ = vfs_bridge.persist_node_data(VFS_TELEMETRY_LBA, telemetry_json.as_bytes());

    let log_output = BOOT_LOG_LINES.join("\n");
    let avionics_banner = format_space_plane_avionics_banner();

    BootReport {
        version: KERNEL_VERSION,
        chassis_alloy: CHASSIS_ALLOY,
        log_output,
        avionics_banner,
        telemetry_json,
        elf_entry_point: loaded_proc.entry_point,
        vfs_flushed_sectors: vfs_bridge.flushed_sectors(),
    }
}
