//! Post Card Spatial OS — Bare-Metal Kernel & Spatial Primitives Crate

pub mod boot_sequence;
pub mod elf_loader;
pub mod framebuffer;
pub mod heap;
pub mod native_hud;
pub mod spatial_node;
pub mod vfs_storage;

pub use boot_sequence::{
    format_space_plane_avionics_banner, run_kernel_boot_sequence, BootReport, AVIONICS_VERSION,
    BOOT_LOG_LINES, CHASSIS_ALLOY, FOUNDRY_HEAP_SIZE, GRUB_BOOT_COMMANDS, INITRD_IMAGE_PATH,
    KERNEL_CMDLINE, KERNEL_IMAGE_PATH, KERNEL_VERSION, SPACE_PLANE_AVIONICS_LINES,
};
pub use elf_loader::{
    load_elf_binary, ElfSegment, LoadedProcess, DEFAULT_CR3_FRAME_ADDRESS,
    DEFAULT_USER_ENTRY_POINT, ELF_MAGIC,
};
pub use framebuffer::{Color, Framebuffer};
pub use heap::{
    heap_telemetry_snapshot, init_dynamic_heap, LockedHeap, ALLOCATOR, HEAP_SIZE, HEAP_START,
};
pub use native_hud::{render_native_hud, KERNEL_HEAP_CAPACITY_KB};
pub use spatial_node::{NodeState, SpatialNode};
pub use vfs_storage::{
    BlockDevice, MemoryBlockDevice, VfsStorageBridge, SECTOR_SIZE, VFS_FREEPLANE_LBA,
    VFS_TELEMETRY_LBA,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_native_hud_romy_active_and_heap_meter() {
        let width = 480;
        let height = 240;
        let mut vram = vec![0u32; width * height];
        let mut fb = Framebuffer::new(width, height, width, &mut vram);

        let packet = render_native_hud(&mut fb, true, 4096);
        assert!(packet.contains("\"panel_title\":\"Post Card OS // Mission Control\""));
        assert!(packet.contains("\"romy_coprocessor_state\":\"VAULT ACTIVE // ENCLAVE LOCKED\""));
        assert!(packet.contains("\"heap_pressure\":50"));
        assert_eq!(fb.get_pixel(28, 70), Some(Color::EMERALD_ACTIVE));
    }

    #[test]
    fn test_render_native_hud_romy_standby() {
        let width = 480;
        let height = 240;
        let mut vram = vec![0u32; width * height];
        let mut fb = Framebuffer::new(width, height, width, &mut vram);

        let packet = render_native_hud(&mut fb, false, 1024);
        assert!(packet.contains("\"romy_coprocessor_state\":\"STANDBY // IDLE\""));
        assert!(packet.contains("\"heap_pressure\":12"));
    }

    #[test]
    fn test_dynamic_free_list_heap_lifecycle() {
        unsafe {
            init_dynamic_heap(HEAP_START, HEAP_SIZE);
        }
        {
            let mut guard = ALLOCATOR.lock();
            guard.allocate_block(512 * 1024);
            guard.allocate_block(256 * 1024);
            assert_eq!(guard.allocations(), 2);
            guard.free_block(256 * 1024);
            assert_eq!(guard.deallocations(), 1);
        }
        let (used_kb, free_kb, total_kb, pressure_pct) = heap_telemetry_snapshot();
        assert_eq!(total_kb, 8192);
        assert!(used_kb >= 512);
        assert_eq!(used_kb + free_kb, total_kb);
        assert!(pressure_pct >= 6);
    }

    #[test]
    fn test_elf_loader_validates_magic_and_returns_loaded_process() {
        let valid_elf = [0x7F, b'E', b'L', b'F', 2, 1, 1, 0];
        let loaded = unsafe { load_elf_binary(&valid_elf) }.expect("valid ELF magic should succeed");
        assert_eq!(loaded.entry_point, 0x400000);
        assert_eq!(loaded.cr3_frame_address, 0x100000);

        let invalid_elf = [b'M', b'Z', 0x90, 0x00];
        let err = unsafe { load_elf_binary(&invalid_elf) }.unwrap_err();
        assert_eq!(err, "Invalid ELF magic header!");
    }

    #[test]
    fn test_vfs_storage_bridge_persists_and_reads_sectors() {
        let dev = MemoryBlockDevice::<256>::new();
        let mut bridge = VfsStorageBridge::new(dev);

        let payload = b"<node ID=\"ID_1\" TEXT=\"Post Card VFS Root\"/>";
        bridge
            .persist_node_data(VFS_FREEPLANE_LBA, payload)
            .expect("sector write should succeed");
        assert_eq!(bridge.flushed_sectors(), 1);
        assert_eq!(bridge.last_written_lba(), Some(VFS_FREEPLANE_LBA));

        let mut read_back = [0u8; 64];
        bridge
            .load_node_data(VFS_FREEPLANE_LBA, &mut read_back)
            .expect("sector read should succeed");
        assert_eq!(&read_back[..payload.len()], payload);
    }

    #[test]
    fn test_kernel_boot_sequence_v1_0_4() {
        let report = run_kernel_boot_sequence();
        assert_eq!(report.version, "v1.0.4-x86_64");
        assert_eq!(report.chassis_alloy, "Al-Li 2195 Cryogenic Hull Frame");
        assert!(report.log_output.contains("[ 0.000000 ] POST CARD OS // KERNEL CORE v1.0.4-x86_64"));
        assert!(report.log_output.contains("[ 0.001042 ] CPU: Initializing IDT, GDT, & CR3 Page Table Isolation... [ SECURE ]"));
        assert!(report.log_output.contains("[ 0.002890 ] THE FOUNDRY: Locking 16MB dynamic free-list memory arena... [ ALLOCATED ]"));
        assert!(report.log_output.contains("[ 0.014500 ] THE BEACON: Binding WebSocket telemetry stream to /telemetry... [ BROADCASTING ]"));
        assert!(report.avionics_banner.contains("[ 0.000000 ] POST CARD OS // SPACE PLANE AVIONICS v1.0.4... [ CORE ]"));
        assert!(report.avionics_banner.contains("[ 0.001042 ] CHASSIS: Al-Li 2195 Cryogenic Hull Frame... [ SECURED ]"));
        assert!(report.avionics_banner.contains("[ 0.002890 ] THE FOUNDRY: 16MB LockedHeap Arena... [ STABLE ]"));
        assert!(report.avionics_banner.contains("[ 0.004510 ] THE CATAPULT: ELF64 Ring 3 Spatial Loader... [ ARMED ]"));
        assert!(report.avionics_banner.contains("[ 0.007120 ] THE BLACK BOX: VfsStorageBridge Sector Mirror... [ LOCKED ]"));
        assert!(report.avionics_banner.contains("[ 0.010200 ] THE RADIATOR: Cryogenic Thermal Control Loop... [ STABILIZED ]"));
        assert!(report.avionics_banner.contains("[ 0.014500 ] PA-ROMY VAULT: Isolated Neural Coprocessor... [ ACTIVE ]"));
        assert_eq!(report.elf_entry_point, 0x400000);
        assert_eq!(report.vfs_flushed_sectors, 1);
    }
}
