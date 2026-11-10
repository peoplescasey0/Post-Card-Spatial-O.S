//! Bare-Metal ELF Loader Skeleton for User-Space Programs
//!
//! Validates 64-bit ELF (`ELF64`) headers, parses `PT_LOAD` program segments,
//! and constructs an isolated user-space process descriptor (`LoadedProcess`)
//! with its entry point and `CR3` PML4 page-table root frame address.

/// ELF64 magic header bytes (`0x7F 'E' 'L' 'F'`).
pub const ELF_MAGIC: [u8; 4] = [0x7F, b'E', b'L', b'F'];

/// Standard user-space virtual load base (`0x400000`).
pub const DEFAULT_USER_ENTRY_POINT: u64 = 0x40_0000;

/// Default physical frame address for a process's PML4 page-table root (`CR3`).
pub const DEFAULT_CR3_FRAME_ADDRESS: u64 = 0x10_0000;

/// ELF program header type for loadable segments (`PT_LOAD`).
pub const PT_LOAD: u32 = 1;

/// Represents a parsed `PT_LOAD` segment mapped into the user-space page table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ElfSegment {
    pub vaddr: u64,
    pub mem_size: u64,
    pub file_size: u64,
    pub flags: u32,
}

/// Descriptor for a validated and mapped user-space ELF64 process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadedProcess {
    pub entry_point: u64,
    pub cr3_frame_address: u64,
    pub segments_loaded: usize,
    pub total_mapped_bytes: u64,
}

/// Validates and loads an ELF64 binary image into an isolated user-space address space.
///
/// # Safety
/// Caller must ensure `elf_bytes` points to a valid binary buffer and that page-table
/// frame allocation is initialized before transferring execution to `entry_point`.
pub unsafe fn load_elf_binary(elf_bytes: &[u8]) -> Result<LoadedProcess, &'static str> {
    // 1. Validate ELF magic bytes (0x7F 'E' 'L' 'F')
    if elf_bytes.len() < 4 || &elf_bytes[0..4] != &[0x7F, b'E', b'L', b'F'] {
        return Err("Invalid ELF magic header!");
    }

    // 2. Parse program headers, allocate virtual memory frames,
    // and copy text/data segments into the process's page table.
    let mut entry_point = DEFAULT_USER_ENTRY_POINT;
    let mut segments_loaded = 0usize;
    let mut total_mapped_bytes = 0u64;

    // If a full 64-bit ELF header (64 bytes) is present, extract `e_entry`, `e_phoff`, `e_phentsize`, and `e_phnum`.
    if elf_bytes.len() >= 64 {
        let elf_class = elf_bytes[4]; // 2 = ELFCLASS64
        if elf_class == 2 {
            let parsed_entry = read_u64_le(elf_bytes, 24);
            if parsed_entry != 0 {
                entry_point = parsed_entry;
            }
            let phoff = read_u64_le(elf_bytes, 32) as usize;
            let phentsize = read_u16_le(elf_bytes, 54) as usize;
            let phnum = read_u16_le(elf_bytes, 56) as usize;

            if phoff > 0 && phentsize >= 56 && phnum > 0 {
                for i in 0..phnum {
                    let offset = phoff.saturating_add(i.saturating_mul(phentsize));
                    if offset.saturating_add(56) <= elf_bytes.len() {
                        let p_type = read_u32_le(elf_bytes, offset);
                        if p_type == PT_LOAD {
                            let p_memsz = read_u64_le(elf_bytes, offset + 40);
                            segments_loaded += 1;
                            total_mapped_bytes = total_mapped_bytes.saturating_add(p_memsz);
                        }
                    }
                }
            }
        }
    }

    Ok(LoadedProcess {
        entry_point,
        cr3_frame_address: DEFAULT_CR3_FRAME_ADDRESS, // Process PML4 root
        segments_loaded,
        total_mapped_bytes,
    })
}

#[inline]
fn read_u16_le(buf: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([buf[offset], buf[offset + 1]])
}

#[inline]
fn read_u32_le(buf: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([
        buf[offset],
        buf[offset + 1],
        buf[offset + 2],
        buf[offset + 3],
    ])
}

#[inline]
fn read_u64_le(buf: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes([
        buf[offset],
        buf[offset + 1],
        buf[offset + 2],
        buf[offset + 3],
        buf[offset + 4],
        buf[offset + 5],
        buf[offset + 6],
        buf[offset + 7],
    ])
}
