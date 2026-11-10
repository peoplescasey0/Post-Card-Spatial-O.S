//! Persistent Storage Block Device Bridge for VFS Write Operations
//!
//! Provides a generic `BlockDevice` hardware trait (e.g., VirtIO-Blk, AHCI/SATA, or RAMDisk)
//! and `VfsStorageBridge<T>` for flushing modified VFS nodes (Freeplane `.mm` mind maps,
//! SpatialNode graphs, or PA-Romy telemetry checkpoints) directly to LBA disk sectors.

/// Standard 512-byte Logical Block Addressing (LBA) sector size.
pub const SECTOR_SIZE: usize = 512;

/// Default LBA sector reserved for Freeplane mind-map & SpatialNode VFS root persistence.
pub const VFS_FREEPLANE_LBA: u64 = 64;

/// Default LBA sector reserved for kernel telemetry & PA-Romy vault state persistence.
pub const VFS_TELEMETRY_LBA: u64 = 128;

pub trait BlockDevice {
    fn read_sector(&mut self, lba: u64, buffer: &mut [u8]) -> Result<(), &'static str>;
    fn write_sector(&mut self, lba: u64, buffer: &[u8]) -> Result<(), &'static str>;
}

pub struct VfsStorageBridge<T: BlockDevice> {
    device: T,
    flushed_sectors: u64,
    last_written_lba: Option<u64>,
}

impl<T: BlockDevice> VfsStorageBridge<T> {
    pub const fn new(device: T) -> Self {
        Self {
            device,
            flushed_sectors: 0,
            last_written_lba: None,
        }
    }

    /// Flushes modified VFS nodes (like Freeplane files or telemetry states) to disk
    pub fn persist_node_data(&mut self, lba: u64, data: &[u8]) -> Result<(), &'static str> {
        self.device.write_sector(lba, data)?;
        self.flushed_sectors = self.flushed_sectors.saturating_add(1);
        self.last_written_lba = Some(lba);
        Ok(())
    }

    /// Reads persisted VFS node data back from the specified LBA sector.
    pub fn load_node_data(&mut self, lba: u64, buffer: &mut [u8]) -> Result<(), &'static str> {
        self.device.read_sector(lba, buffer)
    }

    /// Returns a shared reference to the underlying block device.
    pub const fn device(&self) -> &T {
        &self.device
    }

    /// Returns a mutable reference to the underlying block device.
    pub fn device_mut(&mut self) -> &mut T {
        &mut self.device
    }

    /// Total number of VFS sector flush operations completed.
    pub const fn flushed_sectors(&self) -> u64 {
        self.flushed_sectors
    }

    /// Most recent LBA sector written by the VFS bridge.
    pub const fn last_written_lba(&self) -> Option<u64> {
        self.last_written_lba
    }
}

/// In-memory / VirtIO-backed sector storage driver implementing `BlockDevice`
/// for bare-metal ramdisk or unit-test verification.
pub struct MemoryBlockDevice<const SECTORS: usize = 256> {
    sectors: [[u8; SECTOR_SIZE]; SECTORS],
}

impl<const SECTORS: usize> MemoryBlockDevice<SECTORS> {
    pub const fn new() -> Self {
        Self {
            sectors: [[0u8; SECTOR_SIZE]; SECTORS],
        }
    }
}

impl<const SECTORS: usize> Default for MemoryBlockDevice<SECTORS> {
    fn default() -> Self {
        Self::new()
    }
}

impl<const SECTORS: usize> BlockDevice for MemoryBlockDevice<SECTORS> {
    fn read_sector(&mut self, lba: u64, buffer: &mut [u8]) -> Result<(), &'static str> {
        let idx = lba as usize;
        if idx >= SECTORS {
            return Err("LBA sector out of bounds!");
        }
        if buffer.is_empty() {
            return Err("Read buffer cannot be empty!");
        }
        let copy_len = buffer.len().min(SECTOR_SIZE);
        buffer[..copy_len].copy_from_slice(&self.sectors[idx][..copy_len]);
        Ok(())
    }

    fn write_sector(&mut self, lba: u64, buffer: &[u8]) -> Result<(), &'static str> {
        let idx = lba as usize;
        if idx >= SECTORS {
            return Err("LBA sector out of bounds!");
        }
        if buffer.is_empty() {
            return Err("Write buffer cannot be empty!");
        }
        self.sectors[idx].fill(0);
        let copy_len = buffer.len().min(SECTOR_SIZE);
        self.sectors[idx][..copy_len].copy_from_slice(&buffer[..copy_len]);
        Ok(())
    }
}
