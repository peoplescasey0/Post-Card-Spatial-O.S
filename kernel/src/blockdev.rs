// ============================================================================
// THE BLACK BOX // RAW BLOCK-DEVICE LAYER (PCI + NVMe + SDHCI eMMC/SD + ATA PIO)
// ============================================================================
// Real hardware storage path for the Dell Latitude 3120 (64 GB eMMC on the Intel
// Jasper Lake SDHCI controller, or an M.2 NVMe SSD on other SKUs), plus a legacy
// ATA PIO fallback so QEMU `-machine pc` IDE disks work in automated tests.
//
// Design rules:
//   * Polling only (no IRQs) - every wait loop is bounded by a TSC-based timeout,
//     so a missing/odd controller can never hang the boot or the shell.
//   * All DMA buffers (NVMe queues + bounce page) live in identity-mapped .bss
//     below 4 GiB, so virtual == physical for PRP pointers.
//   * SDHCI uses PIO through the Buffer Data Port (no ADMA descriptors needed).
//   * The layer exposes 512-byte logical sectors regardless of the native LBA
//     size (4 KiB-formatted NVMe namespaces are handled with read-modify-write).

use core::arch::asm;
use core::ptr::{addr_of, addr_of_mut, read_volatile, write_volatile};
use core::sync::atomic::{compiler_fence, Ordering};

use crate::{cpuid, inb, kprintln_colored, outb, rdtsc};

pub const SECTOR_SIZE: usize = 512;

// ----------------------------------------------------------------------------
// Port I/O helpers (16/32-bit) not provided by the crate root
// ----------------------------------------------------------------------------
#[inline(always)]
unsafe fn outw(port: u16, val: u16) {
    asm!("out dx, ax", in("dx") port, in("ax") val, options(nomem, nostack, preserves_flags));
}

#[inline(always)]
unsafe fn inw(port: u16) -> u16 {
    let val: u16;
    asm!("in ax, dx", out("ax") val, in("dx") port, options(nomem, nostack, preserves_flags));
    val
}

#[inline(always)]
unsafe fn outl(port: u16, val: u32) {
    asm!("out dx, eax", in("dx") port, in("eax") val, options(nomem, nostack, preserves_flags));
}

#[inline(always)]
unsafe fn inl(port: u16) -> u32 {
    let val: u32;
    asm!("in eax, dx", out("eax") val, in("dx") port, options(nomem, nostack, preserves_flags));
    val
}

// ----------------------------------------------------------------------------
// TSC-calibrated delays & bounded waits
// ----------------------------------------------------------------------------
static mut TSC_PER_US: u64 = 0;

/// Calibrates the TSC: CPUID.16h base MHz (Jasper Lake reports it), else the
/// legacy 8254 PIT channel 2 (QEMU), else a conservative 1 GHz assumption.
unsafe fn calibrate_tsc() {
    if TSC_PER_US != 0 {
        return;
    }
    let (max_leaf, _, _, _) = cpuid(0, 0);
    if max_leaf >= 0x16 {
        let (base_mhz, _, _, _) = cpuid(0x16, 0);
        if base_mhz & 0xFFFF != 0 {
            TSC_PER_US = (base_mhz & 0xFFFF) as u64;
            return;
        }
    }
    // PIT channel 2, mode 0, 10 ms one-shot (11932 ticks @ 1.193182 MHz).
    let gate = inb(0x61);
    outb(0x61, (gate & !0x02) | 0x01);
    outb(0x43, 0xB0);
    outb(0x42, (11932u16 & 0xFF) as u8);
    outb(0x42, (11932u16 >> 8) as u8);
    let start = rdtsc();
    let mut spins: u64 = 0;
    let mut ok = false;
    while spins < 50_000_000 {
        if inb(0x61) & 0x20 != 0 {
            ok = true;
            break;
        }
        spins += 1;
    }
    let end = rdtsc();
    outb(0x61, gate);
    TSC_PER_US = if ok && end > start { ((end - start) / 10_000).max(1) } else { 1000 };
}

pub unsafe fn udelay(us: u64) {
    if TSC_PER_US == 0 {
        calibrate_tsc();
    }
    let deadline = rdtsc().wrapping_add(us.saturating_mul(TSC_PER_US));
    let mut max_spins: u64 = us.saturating_mul(100).max(5_000_000);
    while max_spins > 0 && rdtsc() < deadline {
        max_spins -= 1;
        core::hint::spin_loop();
    }
}

/// Polls `cond` until it returns true or `timeout_us` elapses.
/// Protected by both a calibrated TSC deadline and a hard upper-bound iteration counter.
unsafe fn wait_until<F: FnMut() -> bool>(timeout_us: u64, mut cond: F) -> bool {
    if TSC_PER_US == 0 {
        calibrate_tsc();
    }
    let deadline = rdtsc().wrapping_add(timeout_us.saturating_mul(TSC_PER_US));
    let mut max_spins: u64 = timeout_us.saturating_mul(100).max(5_000_000);
    loop {
        if cond() {
            return true;
        }
        if max_spins == 0 || rdtsc() >= deadline {
            return cond();
        }
        max_spins -= 1;
        core::hint::spin_loop();
    }
}

// ----------------------------------------------------------------------------
// PCI configuration space (mechanism #1, ports 0xCF8 / 0xCFC)
// ----------------------------------------------------------------------------
#[derive(Clone, Copy)]
pub struct PciDevice {
    pub bus: u8,
    pub dev: u8,
    pub func: u8,
    pub vendor: u16,
    pub device: u16,
    pub class: u8,
    pub subclass: u8,
    pub prog_if: u8,
}

const PCI_EMPTY: PciDevice = PciDevice { bus: 0, dev: 0, func: 0, vendor: 0xFFFF, device: 0xFFFF, class: 0, subclass: 0, prog_if: 0 };
const MAX_PCI: usize = 64;
static mut PCI_DEVICES: [PciDevice; MAX_PCI] = [PCI_EMPTY; MAX_PCI];
static mut PCI_COUNT: usize = 0;

pub unsafe fn pci_read32(bus: u8, dev: u8, func: u8, off: u8) -> u32 {
    let addr = 0x8000_0000u32 | ((bus as u32) << 16) | ((dev as u32) << 11) | ((func as u32) << 8) | ((off as u32) & 0xFC);
    outl(0xCF8, addr);
    inl(0xCFC)
}

pub unsafe fn pci_write32(bus: u8, dev: u8, func: u8, off: u8, val: u32) {
    let addr = 0x8000_0000u32 | ((bus as u32) << 16) | ((dev as u32) << 11) | ((func as u32) << 8) | ((off as u32) & 0xFC);
    outl(0xCF8, addr);
    outl(0xCFC, val);
}

unsafe fn pci_record(bus: u8, dev: u8, func: u8) {
    let id = pci_read32(bus, dev, func, 0x00);
    let class = pci_read32(bus, dev, func, 0x08);
    if PCI_COUNT < MAX_PCI {
        PCI_DEVICES[PCI_COUNT] = PciDevice {
            bus,
            dev,
            func,
            vendor: (id & 0xFFFF) as u16,
            device: (id >> 16) as u16,
            class: (class >> 24) as u8,
            subclass: (class >> 16) as u8,
            prog_if: (class >> 8) as u8,
        };
        PCI_COUNT += 1;
    }
}

/// Brute-force enumerates every bus/device/function (8192 probes, a few ms).
pub unsafe fn pci_scan() {
    PCI_COUNT = 0;
    for bus in 0..=255u8 {
        for dev in 0..32u8 {
            let id = pci_read32(bus, dev, 0, 0x00);
            if id & 0xFFFF == 0xFFFF {
                continue;
            }
            pci_record(bus, dev, 0);
            let header = (pci_read32(bus, dev, 0, 0x0C) >> 16) as u8;
            if header & 0x80 != 0 {
                for func in 1..8u8 {
                    if pci_read32(bus, dev, func, 0x00) & 0xFFFF != 0xFFFF {
                        pci_record(bus, dev, func);
                    }
                }
            }
        }
    }
}

pub unsafe fn pci_devices() -> &'static [PciDevice] {
    &PCI_DEVICES[..PCI_COUNT]
}

pub fn pci_class_name(class: u8, sub: u8) -> &'static str {
    match (class, sub) {
        (0x01, 0x01) => "IDE controller",
        (0x01, 0x06) => "SATA/AHCI controller",
        (0x01, 0x08) => "NVMe controller",
        (0x01, _) => "mass storage",
        (0x02, _) => "network controller",
        (0x03, _) => "display/GOP",
        (0x04, _) => "multimedia/audio",
        (0x05, _) => "memory controller",
        (0x06, 0x00) => "host bridge",
        (0x06, 0x01) => "ISA/LPC bridge",
        (0x06, 0x04) => "PCI-PCI bridge",
        (0x06, _) => "bridge",
        (0x07, _) => "serial/comm controller",
        (0x08, 0x05) => "SD/eMMC host (SDHCI)",
        (0x08, _) => "system peripheral",
        (0x0C, 0x03) => "USB controller",
        (0x0C, 0x05) => "SMBus",
        (0x0C, _) => "serial bus",
        (0x0D, _) => "wireless controller",
        (0x10, _) => "crypto/encryption",
        (0x11, _) => "signal processing",
        _ => "device",
    }
}

/// Reads a memory BAR (handles 64-bit BARs). Returns 0 for I/O BARs or floating/unmapped lines.
pub unsafe fn pci_mem_bar(p: &PciDevice, idx: u8) -> u64 {
    let off = 0x10 + idx * 4;
    let lo = pci_read32(p.bus, p.dev, p.func, off);
    if lo == 0xFFFF_FFFF || lo == 0 || (lo & 1) != 0 {
        return 0;
    }
    let mut addr = (lo & 0xFFFF_FFF0) as u64;
    if (lo >> 1) & 0x3 == 0x2 {
        let hi = pci_read32(p.bus, p.dev, p.func, off + 4);
        if hi == 0xFFFF_FFFF {
            return 0;
        }
        addr |= (hi as u64) << 32;
    }
    if addr == 0 || addr >= 0xFFFF_FFFF_FFFF_0000 {
        return 0;
    }
    addr
}

/// Enables MMIO decode + bus mastering, masks legacy INTx (we poll).
pub unsafe fn pci_enable(p: &PciDevice) {
    let cmd = pci_read32(p.bus, p.dev, p.func, 0x04);
    // Upper 16 bits are the RW1C status register: write zeros there.
    let new = (cmd & 0xFFFF) | 0x0002 | 0x0004 | 0x0400;
    pci_write32(p.bus, p.dev, p.func, 0x04, new);
}

// ----------------------------------------------------------------------------
// MMIO window for BARs outside the 0..0xFE00_0000 identity map
// ----------------------------------------------------------------------------
// Boot paging identity-maps 0..4 GiB, but the top 32 MiB may be repurposed as the
// GOP framebuffer window and 64-bit BARs can live above 4 GiB. Those BARs get
// mapped (uncached, 2 MiB pages) into a dedicated 1 GiB window at PDPT[4]
// (virtual 0x1_0000_0000..0x1_3FFF_FFFF).
#[repr(C, align(4096))]
struct PageTable([u64; 512]);

#[repr(C, align(4096))]
struct Page([u8; 4096]);

static mut MMIO_PD: PageTable = PageTable([0; 512]);
static mut MMIO_NEXT: usize = 0;
const MMIO_WINDOW_BASE: u64 = 0x1_0000_0000;

extern "C" {
    static mut boot_pdpt: [u64; 512];
}

unsafe fn map_mmio(phys: u64, size: u64) -> Option<u64> {
    if phys == 0 || phys >= 0xFFFF_FFFF_FFFF_0000 || phys == 0xFFFF_FFF0 {
        return None;
    }
    if phys.saturating_add(size) <= 0xFE00_0000 {
        return Some(phys);
    }
    let base = phys & !0x1F_FFFFu64;
    let end = (phys + size + 0x1F_FFFF) & !0x1F_FFFFu64;
    let pages = ((end - base) >> 21) as usize;
    if MMIO_NEXT + pages > 512 {
        return None;
    }
    let first = MMIO_NEXT;
    for i in 0..pages {
        MMIO_PD.0[first + i] = (base + (i as u64) * 0x20_0000) | 0x83 | (1 << 3) | (1 << 4);
    }
    MMIO_NEXT += pages;
    boot_pdpt[4] = (addr_of!(MMIO_PD) as u64) | 0x03;
    let cr3: u64;
    asm!("mov {}, cr3", out(reg) cr3, options(nomem, nostack, preserves_flags));
    asm!("mov cr3, {}", in(reg) cr3, options(nostack, preserves_flags));
    Some(MMIO_WINDOW_BASE + (first as u64) * 0x20_0000 + (phys - base))
}

#[inline(always)]
unsafe fn mr8(base: u64, off: usize) -> u8 {
    read_volatile((base as usize + off) as *const u8)
}
#[inline(always)]
unsafe fn mr16(base: u64, off: usize) -> u16 {
    read_volatile((base as usize + off) as *const u16)
}
#[inline(always)]
unsafe fn mr32(base: u64, off: usize) -> u32 {
    read_volatile((base as usize + off) as *const u32)
}
#[inline(always)]
unsafe fn mr64(base: u64, off: usize) -> u64 {
    // Split into two dword reads: some controllers reject 64-bit MMIO cycles.
    let lo = mr32(base, off) as u64;
    let hi = mr32(base, off + 4) as u64;
    lo | (hi << 32)
}
#[inline(always)]
unsafe fn mw8(base: u64, off: usize, v: u8) {
    write_volatile((base as usize + off) as *mut u8, v)
}
#[inline(always)]
unsafe fn mw16(base: u64, off: usize, v: u16) {
    write_volatile((base as usize + off) as *mut u16, v)
}
#[inline(always)]
unsafe fn mw32(base: u64, off: usize, v: u32) {
    write_volatile((base as usize + off) as *mut u32, v)
}
#[inline(always)]
unsafe fn mw64(base: u64, off: usize, v: u64) {
    mw32(base, off, v as u32);
    mw32(base, off + 4, (v >> 32) as u32);
}

// ----------------------------------------------------------------------------
// Block device registry
// ----------------------------------------------------------------------------
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DevKind {
    Ata,
    Nvme,
    Sdhci,
}

#[derive(Clone, Copy)]
pub struct BlockDevice {
    pub kind: DevKind,
    pub name: [u8; 8],
    pub name_len: usize,
    pub model: [u8; 40],
    pub model_len: usize,
    /// Capacity in 512-byte sectors.
    pub sectors: u64,
    pub reads: u64,
    pub writes: u64,
    // ATA PIO
    io_base: u16,
    ctrl_base: u16,
    slave: bool,
    lba48: bool,
    // MMIO controllers (virtual base)
    mmio: u64,
    // NVMe: log2 of native LBA size; SDHCI: block (sector) addressing flag
    lba_shift: u32,
    block_addressing: bool,
    rca: u32,
}

impl BlockDevice {
    pub fn name_str(&self) -> &str {
        core::str::from_utf8(&self.name[..self.name_len]).unwrap_or("?")
    }
    pub fn model_str(&self) -> &str {
        core::str::from_utf8(&self.model[..self.model_len]).unwrap_or("?").trim()
    }
    pub fn kind_str(&self) -> &'static str {
        match self.kind {
            DevKind::Ata => "ATA-PIO",
            DevKind::Nvme => "NVMe",
            DevKind::Sdhci => "SDHCI",
        }
    }
}

const MAX_DEVICES: usize = 4;
static mut DEVICES: [Option<BlockDevice>; MAX_DEVICES] = [None; MAX_DEVICES];
static mut DEV_COUNT: usize = 0;

pub unsafe fn device_count() -> usize {
    DEV_COUNT
}

pub unsafe fn device(idx: usize) -> Option<&'static BlockDevice> {
    if idx < DEV_COUNT {
        DEVICES[idx].as_ref()
    } else {
        None
    }
}

fn fill_name(dst: &mut [u8], src: &[u8]) -> usize {
    let n = src.len().min(dst.len());
    dst[..n].copy_from_slice(&src[..n]);
    n
}

unsafe fn register(mut dev: BlockDevice, prefix: &[u8]) -> Option<usize> {
    if DEV_COUNT >= MAX_DEVICES {
        return None;
    }
    // name = prefix + per-kind ordinal (nvme0, mmc0, ata0 ...)
    let mut ordinal = 0u8;
    for i in 0..DEV_COUNT {
        if let Some(d) = DEVICES[i] {
            if d.kind == dev.kind {
                ordinal += 1;
            }
        }
    }
    let mut n = fill_name(&mut dev.name, prefix);
    if n < dev.name.len() {
        dev.name[n] = b'0' + ordinal;
        n += 1;
    }
    dev.name_len = n;
    let idx = DEV_COUNT;
    DEVICES[idx] = Some(dev);
    DEV_COUNT += 1;
    Some(idx)
}

fn blank_device(kind: DevKind) -> BlockDevice {
    BlockDevice {
        kind,
        name: [0; 8],
        name_len: 0,
        model: [b' '; 40],
        model_len: 0,
        sectors: 0,
        reads: 0,
        writes: 0,
        io_base: 0,
        ctrl_base: 0,
        slave: false,
        lba48: false,
        mmio: 0,
        lba_shift: 9,
        block_addressing: true,
        rca: 0,
    }
}

/// Probes every supported storage controller. Safe to call once at boot.
pub unsafe fn init() {
    calibrate_tsc();
    kprintln_colored(0x03, 0x0006B6D4, format_args!("[probe] Initializing block storage subsystems (TSC: {} ticks/us)...", TSC_PER_US));
    pci_scan();
    DEV_COUNT = 0;
    let mut have_ide = false;
    kprintln_colored(0x03, 0x0006B6D4, format_args!("[probe] PCI bus scan discovered {} total devices", PCI_COUNT));
    for i in 0..PCI_COUNT {
        let p = PCI_DEVICES[i];
        match (p.class, p.subclass) {
            (0x01, 0x08) if p.prog_if == 0x02 => {
                let bar = pci_mem_bar(&p, 0);
                kprintln_colored(0x0B, 0x0038BDF8, format_args!("[probe] -> NVMe controller identified at {:02x}:{:02x}.{} (BAR0={:#x}). Initializing...", p.bus, p.dev, p.func, bar));
                match nvme_init(&p) {
                    Ok(idx) => log_device(idx),
                    Err(e) => kprintln_colored(0x0E, 0x00FFB81C, format_args!("[warn] nvme {:02x}:{:02x}.{}: {}", p.bus, p.dev, p.func, e)),
                }
            }
            (0x08, 0x05) => {
                let bar = pci_mem_bar(&p, 0);
                kprintln_colored(0x0B, 0x0038BDF8, format_args!("[probe] -> SDHCI eMMC/SD controller identified at {:02x}:{:02x}.{} (BAR0={:#x}). Initializing...", p.bus, p.dev, p.func, bar));
                match sdhci_init(&p) {
                    Ok(idx) => log_device(idx),
                    Err(e) => kprintln_colored(0x0E, 0x00FFB81C, format_args!("[warn] sdhci {:02x}:{:02x}.{}: {}", p.bus, p.dev, p.func, e)),
                }
            }
            (0x01, 0x01) => {
                kprintln_colored(0x0B, 0x0038BDF8, format_args!("[probe] -> PCI IDE Controller identified at {:02x}:{:02x}.{}", p.bus, p.dev, p.func));
                have_ide = true;
            }
            _ => {}
        }
    }
    // Legacy IDE ports are only touched when a PCI IDE controller exists
    // (QEMU PIIX); modern laptops never get poked at 0x1F0/0x170.
    if have_ide {
        for &(io, ctrl) in &[(0x1F0u16, 0x3F6u16), (0x170u16, 0x376u16)] {
            for &slave in &[false, true] {
                kprintln_colored(0x03, 0x0006B6D4, format_args!("[probe] -> Checking ATA channel {:#x} (ctrl={:#x}, slave={})...", io, ctrl, slave));
                if let Some(idx) = ata_probe(io, ctrl, slave) {
                    log_device(idx);
                }
            }
        }
    }
    kprintln_colored(0x0A, 0x0022C55E, format_args!("[probe] Storage probe cycle finished: {} device(s) active", DEV_COUNT));
}

unsafe fn log_device(idx: usize) {
    if let Some(d) = device(idx) {
        kprintln_colored(
            0x0A,
            0x0022C55E,
            format_args!(
                "[ok] block device {}: {} \"{}\" {} sectors ({} MiB)",
                d.name_str(),
                d.kind_str(),
                d.model_str(),
                d.sectors,
                d.sectors / 2048
            ),
        );
    }
}

/// Reads one 512-byte logical sector.
pub unsafe fn read_sector(idx: usize, lba: u64, buf: &mut [u8; SECTOR_SIZE]) -> Result<(), &'static str> {
    let Some(dev) = (if idx < DEV_COUNT { DEVICES[idx].as_mut() } else { None }) else {
        return Err("no such block device");
    };
    if lba >= dev.sectors {
        return Err("LBA beyond end of device");
    }
    let r = match dev.kind {
        DevKind::Ata => ata_rw(dev, lba, buf.as_mut_ptr(), false),
        DevKind::Nvme => nvme_read_512(dev, lba, buf),
        DevKind::Sdhci => sdhci_read_block(dev, lba, buf),
    };
    if r.is_ok() {
        dev.reads += 1;
    }
    r
}

/// Writes one 512-byte logical sector (write-through; call `flush` to commit caches).
pub unsafe fn write_sector(idx: usize, lba: u64, buf: &[u8; SECTOR_SIZE]) -> Result<(), &'static str> {
    let Some(dev) = (if idx < DEV_COUNT { DEVICES[idx].as_mut() } else { None }) else {
        return Err("no such block device");
    };
    if lba >= dev.sectors {
        return Err("LBA beyond end of device");
    }
    let r = match dev.kind {
        DevKind::Ata => ata_rw(dev, lba, buf.as_ptr() as *mut u8, true),
        DevKind::Nvme => nvme_write_512(dev, lba, buf),
        DevKind::Sdhci => sdhci_write_block(dev, lba, buf),
    };
    if r.is_ok() {
        dev.writes += 1;
    }
    r
}

/// Flushes any volatile write cache on the device so data survives power loss.
pub unsafe fn flush(idx: usize) -> Result<(), &'static str> {
    let Some(dev) = (if idx < DEV_COUNT { DEVICES[idx].as_mut() } else { None }) else {
        return Err("no such block device");
    };
    match dev.kind {
        DevKind::Ata => ata_flush(dev),
        DevKind::Nvme => nvme_flush(),
        DevKind::Sdhci => Ok(()), // CMD24 completes only after the card leaves programming state
    }
}

// ============================================================================
// ATA PIO (legacy IDE, QEMU PIIX)
// ============================================================================
const ATA_SR_BSY: u8 = 0x80;
const ATA_SR_DF: u8 = 0x20;
const ATA_SR_DRQ: u8 = 0x08;
const ATA_SR_ERR: u8 = 0x01;

unsafe fn ata_400ns(ctrl: u16) {
    for _ in 0..4 {
        inb(ctrl);
    }
}

unsafe fn ata_wait_not_busy(io: u16) -> Result<u8, &'static str> {
    let mut status = 0u8;
    if !wait_until(2_000_000, || {
        status = inb(io + 7);
        status & ATA_SR_BSY == 0
    }) {
        return Err("ata: BSY timeout");
    }
    Ok(status)
}

unsafe fn ata_wait_drq(io: u16) -> Result<(), &'static str> {
    let mut status = 0u8;
    if !wait_until(2_000_000, || {
        status = inb(io + 7);
        status & ATA_SR_BSY == 0 && (status & (ATA_SR_DRQ | ATA_SR_ERR | ATA_SR_DF)) != 0
    }) {
        return Err("ata: DRQ timeout");
    }
    if status & (ATA_SR_ERR | ATA_SR_DF) != 0 {
        return Err("ata: device error");
    }
    Ok(())
}

unsafe fn ata_probe(io: u16, ctrl: u16, slave: bool) -> Option<usize> {
    if inb(io + 7) == 0xFF {
        return None; // floating bus
    }
    outb(ctrl, 0x02); // nIEN: polling only
    outb(io + 6, 0xA0 | if slave { 0x10 } else { 0 });
    ata_400ns(ctrl);
    outb(io + 2, 0);
    outb(io + 3, 0);
    outb(io + 4, 0);
    outb(io + 5, 0);
    outb(io + 7, 0xEC); // IDENTIFY DEVICE
    ata_400ns(ctrl);
    if inb(io + 7) == 0 {
        return None;
    }
    if ata_wait_not_busy(io).is_err() {
        return None;
    }
    if inb(io + 4) != 0 || inb(io + 5) != 0 {
        return None; // ATAPI (CD-ROM) or SATA signature: not a PIO disk
    }
    if ata_wait_drq(io).is_err() {
        return None;
    }
    let mut ident = [0u16; 256];
    for w in ident.iter_mut() {
        *w = inw(io);
    }
    let lba48 = ident[83] & (1 << 10) != 0;
    let sectors = if lba48 {
        (ident[100] as u64) | ((ident[101] as u64) << 16) | ((ident[102] as u64) << 32) | ((ident[103] as u64) << 48)
    } else {
        (ident[60] as u64) | ((ident[61] as u64) << 16)
    };
    if sectors == 0 {
        return None;
    }
    let mut dev = blank_device(DevKind::Ata);
    dev.io_base = io;
    dev.ctrl_base = ctrl;
    dev.slave = slave;
    dev.lba48 = lba48;
    dev.sectors = sectors;
    for i in 0..20 {
        let w = ident[27 + i];
        dev.model[i * 2] = (w >> 8) as u8;
        dev.model[i * 2 + 1] = (w & 0xFF) as u8;
    }
    dev.model_len = 40;
    register(dev, b"ata")
}

unsafe fn ata_rw(dev: &BlockDevice, lba: u64, buf: *mut u8, write: bool) -> Result<(), &'static str> {
    let io = dev.io_base;
    let sel = if dev.slave { 0x10u8 } else { 0 };
    ata_wait_not_busy(io)?;
    if dev.lba48 {
        outb(io + 6, 0x40 | sel);
        ata_400ns(dev.ctrl_base);
        outb(io + 2, 0);
        outb(io + 3, (lba >> 24) as u8);
        outb(io + 4, (lba >> 32) as u8);
        outb(io + 5, (lba >> 40) as u8);
        outb(io + 2, 1);
        outb(io + 3, lba as u8);
        outb(io + 4, (lba >> 8) as u8);
        outb(io + 5, (lba >> 16) as u8);
        outb(io + 7, if write { 0x34 } else { 0x24 });
    } else {
        outb(io + 6, 0xE0 | sel | ((lba >> 24) as u8 & 0x0F));
        ata_400ns(dev.ctrl_base);
        outb(io + 2, 1);
        outb(io + 3, lba as u8);
        outb(io + 4, (lba >> 8) as u8);
        outb(io + 5, (lba >> 16) as u8);
        outb(io + 7, if write { 0x30 } else { 0x20 });
    }
    ata_400ns(dev.ctrl_base);
    ata_wait_drq(io)?;
    for i in 0..256usize {
        if write {
            let w = (*buf.add(i * 2) as u16) | ((*buf.add(i * 2 + 1) as u16) << 8);
            outw(io, w);
        } else {
            let w = inw(io);
            *buf.add(i * 2) = w as u8;
            *buf.add(i * 2 + 1) = (w >> 8) as u8;
        }
    }
    if write {
        let st = ata_wait_not_busy(io)?;
        if st & (ATA_SR_ERR | ATA_SR_DF) != 0 {
            return Err("ata: write error");
        }
    }
    Ok(())
}

unsafe fn ata_flush(dev: &BlockDevice) -> Result<(), &'static str> {
    let io = dev.io_base;
    ata_wait_not_busy(io)?;
    outb(io + 6, 0xA0 | if dev.slave { 0x10 } else { 0 });
    ata_400ns(dev.ctrl_base);
    outb(io + 7, if dev.lba48 { 0xEA } else { 0xE7 });
    ata_400ns(dev.ctrl_base);
    let st = ata_wait_not_busy(io)?;
    if st & ATA_SR_ERR != 0 {
        return Err("ata: flush error");
    }
    Ok(())
}

// ============================================================================
// NVMe (single controller, admin queue + one I/O queue pair, polled)
// ============================================================================
static mut NVME_ASQ: Page = Page([0; 4096]);
static mut NVME_ACQ: Page = Page([0; 4096]);
static mut NVME_IOSQ: Page = Page([0; 4096]);
static mut NVME_IOCQ: Page = Page([0; 4096]);
static mut NVME_IDENT: Page = Page([0; 4096]);
static mut NVME_BOUNCE: Page = Page([0; 4096]);

struct NvmeQueue {
    sq: *mut u8,
    cq: *mut u8,
    depth: u16,
    sq_tail: u16,
    cq_head: u16,
    phase: u32,
    qid: u16,
}

struct NvmeState {
    present: bool,
    mmio: u64,
    dstrd: u32,
    nsid: u32,
    lba_shift: u32,
    cid: u16,
    admin: NvmeQueue,
    io: NvmeQueue,
}

static mut NVME: NvmeState = NvmeState {
    present: false,
    mmio: 0,
    dstrd: 0,
    nsid: 1,
    lba_shift: 9,
    cid: 0,
    admin: NvmeQueue { sq: core::ptr::null_mut(), cq: core::ptr::null_mut(), depth: 0, sq_tail: 0, cq_head: 0, phase: 1, qid: 0 },
    io: NvmeQueue { sq: core::ptr::null_mut(), cq: core::ptr::null_mut(), depth: 0, sq_tail: 0, cq_head: 0, phase: 1, qid: 1 },
};

const NVME_CAP: usize = 0x00;
const NVME_CC: usize = 0x14;
const NVME_CSTS: usize = 0x1C;
const NVME_AQA: usize = 0x24;
const NVME_ASQ_REG: usize = 0x28;
const NVME_ACQ_REG: usize = 0x30;

unsafe fn nvme_submit(admin: bool, mut cmd: [u32; 16]) -> Result<u32, &'static str> {
    let mmio = NVME.mmio;
    let stride = 4usize << NVME.dstrd;
    NVME.cid = NVME.cid.wrapping_add(1);
    let cid = NVME.cid;
    cmd[0] = (cmd[0] & 0xFFFF) | ((cid as u32) << 16);
    let q = if admin { &mut NVME.admin } else { &mut NVME.io };
    let slot = q.sq.add(q.sq_tail as usize * 64) as *mut u32;
    for (i, dw) in cmd.iter().enumerate() {
        write_volatile(slot.add(i), *dw);
    }
    compiler_fence(Ordering::SeqCst);
    q.sq_tail = (q.sq_tail + 1) % q.depth;
    mw32(mmio, 0x1000 + (2 * q.qid as usize) * stride, q.sq_tail as u32);

    let cqe = q.cq.add(q.cq_head as usize * 16) as *const u32;
    let expected_phase = q.phase;
    if !wait_until(5_000_000, || (read_volatile(cqe.add(3)) >> 16) & 1 == expected_phase) {
        return Err("nvme: command timeout");
    }
    compiler_fence(Ordering::SeqCst);
    let dw0 = read_volatile(cqe);
    let dw3 = read_volatile(cqe.add(3));
    q.cq_head += 1;
    if q.cq_head == q.depth {
        q.cq_head = 0;
        q.phase ^= 1;
    }
    mw32(mmio, 0x1000 + (2 * q.qid as usize + 1) * stride, q.cq_head as u32);
    if (dw3 >> 17) & 0x7FFF != 0 {
        return Err("nvme: command failed");
    }
    Ok(dw0)
}

unsafe fn nvme_init(p: &PciDevice) -> Result<usize, &'static str> {
    if NVME.present {
        return Err("only one NVMe controller supported");
    }
    pci_enable(p);
    let bar = pci_mem_bar(p, 0);
    let mmio = map_mmio(bar, 0x4000).ok_or("BAR0 unmappable")?;
    let cap = mr64(mmio, NVME_CAP);
    let mqes = (cap & 0xFFFF) as u16;
    let timeout_us = (((cap >> 24) & 0xFF).max(1)) * 500_000;
    let dstrd = ((cap >> 32) & 0xF) as u32;
    let mpsmin = ((cap >> 48) & 0xF) as u32;
    if mpsmin != 0 {
        return Err("controller requires >4 KiB pages");
    }

    // Disable, program admin queues, re-enable.
    let cc = mr32(mmio, NVME_CC);
    if cc & 1 != 0 {
        mw32(mmio, NVME_CC, cc & !1);
    }
    if !wait_until(timeout_us, || mr32(mmio, NVME_CSTS) & 1 == 0) {
        return Err("controller did not disable");
    }
    let depth = (mqes as u32 + 1).min(64) as u16;
    for page in [addr_of_mut!(NVME_ASQ), addr_of_mut!(NVME_ACQ), addr_of_mut!(NVME_IOSQ), addr_of_mut!(NVME_IOCQ)] {
        (*page).0.fill(0);
    }
    NVME.mmio = mmio;
    NVME.dstrd = dstrd;
    NVME.admin = NvmeQueue { sq: addr_of_mut!(NVME_ASQ) as *mut u8, cq: addr_of_mut!(NVME_ACQ) as *mut u8, depth, sq_tail: 0, cq_head: 0, phase: 1, qid: 0 };
    NVME.io = NvmeQueue { sq: addr_of_mut!(NVME_IOSQ) as *mut u8, cq: addr_of_mut!(NVME_IOCQ) as *mut u8, depth, sq_tail: 0, cq_head: 0, phase: 1, qid: 1 };
    mw32(mmio, NVME_AQA, ((depth as u32 - 1) << 16) | (depth as u32 - 1));
    mw64(mmio, NVME_ASQ_REG, addr_of!(NVME_ASQ) as u64);
    mw64(mmio, NVME_ACQ_REG, addr_of!(NVME_ACQ) as u64);
    // CSS=NVM, MPS=4K, AMS=RR, IOSQES=64B (6), IOCQES=16B (4), EN=1
    mw32(mmio, NVME_CC, (6 << 16) | (4 << 20) | 1);
    if !wait_until(timeout_us, || {
        let s = mr32(mmio, NVME_CSTS);
        s & 1 == 1 || s & 2 != 0
    }) || mr32(mmio, NVME_CSTS) & 2 != 0
    {
        return Err("controller failed to become ready");
    }

    let ident = addr_of_mut!(NVME_IDENT) as *mut u8;
    // Identify Controller (CNS=1) -> model number
    let mut cmd = [0u32; 16];
    cmd[0] = 0x06;
    cmd[6] = ident as u32;
    cmd[7] = ((ident as u64) >> 32) as u32;
    cmd[10] = 1;
    nvme_submit(true, cmd)?;
    let mut dev = blank_device(DevKind::Nvme);
    for i in 0..40 {
        dev.model[i] = *ident.add(24 + i);
    }
    dev.model_len = 40;

    // Active namespace list (CNS=2) -> first NSID (fallback 1)
    cmd[1] = 0;
    cmd[10] = 2;
    let nsid = if nvme_submit(true, cmd).is_ok() {
        let first = read_volatile(ident as *const u32);
        if first == 0 { 1 } else { first }
    } else {
        1
    };

    // Identify Namespace (CNS=0)
    cmd[1] = nsid;
    cmd[10] = 0;
    nvme_submit(true, cmd)?;
    let nsze = read_volatile(ident as *const u64);
    let flbas = (*ident.add(26) & 0x0F) as usize;
    let lbaf = read_volatile(ident.add(128 + flbas * 4) as *const u32);
    let lba_shift = (lbaf >> 16) & 0xFF;
    if !(9..=12).contains(&lba_shift) {
        return Err("unsupported LBA format");
    }

    // Create I/O Completion Queue (qid 1, physically contiguous, no IRQ)
    let mut cq = [0u32; 16];
    cq[0] = 0x05;
    cq[6] = addr_of!(NVME_IOCQ) as u32;
    cq[7] = ((addr_of!(NVME_IOCQ) as u64) >> 32) as u32;
    cq[10] = ((depth as u32 - 1) << 16) | 1;
    cq[11] = 1;
    nvme_submit(true, cq)?;
    // Create I/O Submission Queue (qid 1 -> cq 1)
    let mut sq = [0u32; 16];
    sq[0] = 0x01;
    sq[6] = addr_of!(NVME_IOSQ) as u32;
    sq[7] = ((addr_of!(NVME_IOSQ) as u64) >> 32) as u32;
    sq[10] = ((depth as u32 - 1) << 16) | 1;
    sq[11] = (1 << 16) | 1;
    nvme_submit(true, sq)?;

    NVME.nsid = nsid;
    NVME.lba_shift = lba_shift;
    NVME.present = true;
    dev.mmio = mmio;
    dev.lba_shift = lba_shift;
    dev.sectors = nsze << (lba_shift - 9);
    register(dev, b"nvme").ok_or("device table full")
}

unsafe fn nvme_io(write: bool, native_lba: u64) -> Result<(), &'static str> {
    let buf = addr_of!(NVME_BOUNCE) as u64;
    let mut cmd = [0u32; 16];
    cmd[0] = if write { 0x01 } else { 0x02 };
    cmd[1] = NVME.nsid;
    cmd[6] = buf as u32;
    cmd[7] = (buf >> 32) as u32;
    cmd[10] = native_lba as u32;
    cmd[11] = (native_lba >> 32) as u32;
    cmd[12] = 0; // NLB = 1 block (0-based)
    nvme_submit(false, cmd).map(|_| ())
}

unsafe fn nvme_read_512(dev: &BlockDevice, lba: u64, out: &mut [u8; SECTOR_SIZE]) -> Result<(), &'static str> {
    let per = 1u64 << (dev.lba_shift - 9);
    nvme_io(false, lba / per)?;
    let off = ((lba % per) as usize) * SECTOR_SIZE;
    out.copy_from_slice(&NVME_BOUNCE.0[off..off + SECTOR_SIZE]);
    Ok(())
}

unsafe fn nvme_write_512(dev: &BlockDevice, lba: u64, data: &[u8; SECTOR_SIZE]) -> Result<(), &'static str> {
    let per = 1u64 << (dev.lba_shift - 9);
    if per > 1 {
        nvme_io(false, lba / per)?; // read-modify-write for 4 KiB namespaces
    }
    let off = ((lba % per) as usize) * SECTOR_SIZE;
    NVME_BOUNCE.0[off..off + SECTOR_SIZE].copy_from_slice(data);
    nvme_io(true, lba / per)
}

unsafe fn nvme_flush() -> Result<(), &'static str> {
    let mut cmd = [0u32; 16];
    cmd[0] = 0x00;
    cmd[1] = NVME.nsid;
    nvme_submit(false, cmd).map(|_| ())
}

// ============================================================================
// SDHCI (eMMC + SD), PIO single-block transfers, 1-bit bus @ <=25 MHz
// ============================================================================
const SD_BLKSIZE: usize = 0x04;
const SD_BLKCNT: usize = 0x06;
const SD_ARG: usize = 0x08;
const SD_XFER: usize = 0x0C;
const SD_CMD: usize = 0x0E;
const SD_RESP: usize = 0x10;
const SD_DATA: usize = 0x20;
const SD_PRESENT: usize = 0x24;
const SD_HOSTCTL: usize = 0x28;
const SD_POWER: usize = 0x29;
const SD_CLOCK: usize = 0x2C;
const SD_TIMEOUT: usize = 0x2E;
const SD_RESET: usize = 0x2F;
const SD_NINT: usize = 0x30;
const SD_EINT: usize = 0x32;
const SD_NINT_EN: usize = 0x34;
const SD_EINT_EN: usize = 0x36;
const SD_NSIG_EN: usize = 0x38;
const SD_ESIG_EN: usize = 0x3A;
const SD_HOSTCTL2: usize = 0x3E;
const SD_CAPS: usize = 0x40;
const SD_VERSION: usize = 0xFE;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Resp {
    None,
    R1,
    R1b,
    R2,
    R3,
}

unsafe fn sd_reset_lines(base: u64, mask: u8) {
    mw8(base, SD_RESET, mask);
    wait_until(100_000, || mr8(base, SD_RESET) & mask == 0);
}

unsafe fn sd_cmd(base: u64, idx: u8, arg: u32, resp: Resp, data_read: Option<bool>) -> Result<[u32; 4], &'static str> {
    let inhibit = if data_read.is_some() || resp == Resp::R1b { 0x3 } else { 0x1 };
    if !wait_until(500_000, || mr32(base, SD_PRESENT) & inhibit == 0) {
        sd_reset_lines(base, 0x06);
        return Err("sdhci: command inhibit timeout");
    }
    mw16(base, SD_NINT, 0xFFFF);
    mw16(base, SD_EINT, 0xFFFF);
    match data_read {
        Some(read) => {
            mw16(base, SD_BLKSIZE, 0x7000 | SECTOR_SIZE as u16);
            mw16(base, SD_BLKCNT, 1);
            mw16(base, SD_XFER, if read { 0x0012 } else { 0x0002 });
        }
        None => mw16(base, SD_XFER, 0),
    }
    mw32(base, SD_ARG, arg);
    let flags: u16 = match resp {
        Resp::None => 0x00,
        Resp::R2 => 0x01 | 0x08,
        Resp::R3 => 0x02,
        Resp::R1 => 0x02 | 0x08 | 0x10,
        Resp::R1b => 0x03 | 0x08 | 0x10,
    } | if data_read.is_some() { 0x20 } else { 0 };
    mw16(base, SD_CMD, ((idx as u16) << 8) | flags);

    let mut status = 0u16;
    if !wait_until(1_000_000, || {
        status = mr16(base, SD_NINT);
        status & 0x8001 != 0
    }) {
        sd_reset_lines(base, 0x06);
        return Err("sdhci: command complete timeout");
    }
    if status & 0x8000 != 0 {
        mw16(base, SD_EINT, 0xFFFF);
        mw16(base, SD_NINT, 0xFFFF);
        sd_reset_lines(base, 0x06);
        return Err("sdhci: command error");
    }
    mw16(base, SD_NINT, 0x0001);
    let r = [mr32(base, SD_RESP), mr32(base, SD_RESP + 4), mr32(base, SD_RESP + 8), mr32(base, SD_RESP + 12)];
    if resp == Resp::R1b {
        // Busy signalling on DAT0 ends with Transfer Complete.
        wait_until(1_000_000, || mr16(base, SD_NINT) & 0x8002 != 0);
        mw16(base, SD_NINT, 0x0002);
    }
    Ok(r)
}

unsafe fn sd_wait_int(base: u64, bit: u16, what: &'static str) -> Result<(), &'static str> {
    let mut status = 0u16;
    if !wait_until(1_000_000, || {
        status = mr16(base, SD_NINT);
        status & (bit | 0x8000) != 0
    }) {
        sd_reset_lines(base, 0x06);
        return Err(what);
    }
    if status & 0x8000 != 0 {
        mw16(base, SD_EINT, 0xFFFF);
        mw16(base, SD_NINT, 0xFFFF);
        sd_reset_lines(base, 0x06);
        return Err("sdhci: data error");
    }
    mw16(base, SD_NINT, bit);
    Ok(())
}

unsafe fn sd_set_clock(base: u64, spec_v3: bool, base_mhz: u32, target_khz: u32) {
    mw16(base, SD_CLOCK, 0);
    let base_khz = base_mhz.max(1) * 1000;
    let div: u32 = if spec_v3 {
        // 10-bit divided clock: f = base / (2N), N = 0 -> base
        if base_khz <= target_khz { 0 } else { ((base_khz + 2 * target_khz - 1) / (2 * target_khz)).min(1023) }
    } else {
        // 8-bit power-of-two divisor, register = divisor / 2
        let mut d = 1u32;
        while d < 256 && base_khz / d > target_khz {
            d *= 2;
        }
        d / 2
    };
    let val = (((div & 0xFF) << 8) | (((div >> 8) & 0x3) << 6) | 0x1) as u16;
    mw16(base, SD_CLOCK, val);
    wait_until(150_000, || mr16(base, SD_CLOCK) & 0x2 != 0);
    mw16(base, SD_CLOCK, val | 0x4);
    udelay(1000);
}

unsafe fn sdhci_init(p: &PciDevice) -> Result<usize, &'static str> {
    pci_enable(p);
    let bar = pci_mem_bar(p, 0);
    let base = map_mmio(bar, 0x100).ok_or("BAR0 unmappable")?;

    // 1. Full controller reset
    mw8(base, SD_RESET, 0x01);
    if !wait_until(500_000, || mr8(base, SD_RESET) & 0x01 == 0) {
        return Err("controller reset timeout");
    }
    let version = mr16(base, SD_VERSION) & 0xFF;
    let spec_v3 = version >= 2;
    let caps = mr32(base, SD_CAPS);
    let mut base_mhz = if spec_v3 { (caps >> 8) & 0xFF } else { (caps >> 8) & 0x3F };
    if base_mhz == 0 {
        base_mhz = 50;
    }

    // 2. Interrupt status latching on, signal (IRQ) delivery off: we poll.
    mw16(base, SD_NINT_EN, 0xFEFF);
    mw16(base, SD_EINT_EN, 0xFFFF);
    mw16(base, SD_NSIG_EN, 0);
    mw16(base, SD_ESIG_EN, 0);
    mw8(base, SD_TIMEOUT, 0x0E);

    // 3. Bus power: prefer 3.3 V, then 3.0 V, then 1.8 V (embedded eMMC).
    let volt: u8 = if caps & (1 << 24) != 0 {
        0x0E
    } else if caps & (1 << 25) != 0 {
        0x0C
    } else {
        0x0A
    };
    mw8(base, SD_POWER, 0);
    udelay(1000);
    mw8(base, SD_POWER, volt | 0x01);
    udelay(10_000);
    mw8(base, SD_HOSTCTL, 0); // 1-bit bus, normal speed, SDMA off
    mw16(base, SD_HOSTCTL2, 0);

    // 4. Identification clock (400 kHz) + card power-up delay
    sd_set_clock(base, spec_v3, base_mhz, 400);
    udelay(10_000);

    // 5. Card identification: SD (CMD8/ACMD41) first, then eMMC (CMD1).
    sd_cmd(base, 0, 0, Resp::None, None)?;
    udelay(2000);
    let mut dev = blank_device(DevKind::Sdhci);
    dev.mmio = base;
    let is_sd = match sd_cmd(base, 8, 0x1AA, Resp::R1, None) {
        Ok(r) => r[0] & 0xFFF == 0x1AA,
        Err(_) => false,
    };
    let mut ocr = 0u32;
    if is_sd {
        let ok = wait_until(1_500_000, || {
            if sd_cmd(base, 55, 0, Resp::R1, None).is_err() {
                return false;
            }
            match sd_cmd(base, 41, 0x40FF_8000, Resp::R3, None) {
                Ok(r) => {
                    ocr = r[0];
                    ocr & 0x8000_0000 != 0
                }
                Err(_) => false,
            }
        });
        if !ok {
            return Err("SD card ACMD41 power-up timeout");
        }
        dev.block_addressing = ocr & 0x4000_0000 != 0;
    } else {
        sd_cmd(base, 0, 0, Resp::None, None)?;
        udelay(2000);
        let ok = wait_until(1_500_000, || match sd_cmd(base, 1, 0x40FF_8080, Resp::R3, None) {
            Ok(r) => {
                ocr = r[0];
                ocr & 0x8000_0000 != 0
            }
            Err(_) => false,
        });
        if !ok {
            return Err("no SD/eMMC card responded (CMD1 timeout)");
        }
        dev.block_addressing = (ocr >> 29) & 0x3 == 0x2;
    }

    // CID -> product name
    let cid = sd_cmd(base, 2, 0, Resp::R2, None)?;
    let cid128 = (cid[0] as u128) | ((cid[1] as u128) << 32) | ((cid[2] as u128) << 64) | ((cid[3] as u128) << 96);
    let pnm_len = if is_sd { 5 } else { 6 };
    let prefix: &[u8] = if is_sd { b"SD " } else { b"eMMC " };
    let mut n = fill_name(&mut dev.model, prefix);
    for i in 0..pnm_len {
        let c = ((cid128 >> (88 - 8 * i)) & 0xFF) as u8;
        dev.model[n] = if (0x20..0x7F).contains(&c) { c } else { b'?' };
        n += 1;
    }
    dev.model_len = n;

    // RCA
    dev.rca = if is_sd {
        let r = sd_cmd(base, 3, 0, Resp::R1, None)?;
        r[0] >> 16
    } else {
        sd_cmd(base, 3, 1 << 16, Resp::R1, None)?;
        1
    };

    // CSD -> capacity (SD v1/v2, eMMC byte-mode)
    let csd = sd_cmd(base, 9, dev.rca << 16, Resp::R2, None)?;
    let csd128 = (csd[0] as u128) | ((csd[1] as u128) << 32) | ((csd[2] as u128) << 64) | ((csd[3] as u128) << 96);
    let csd_structure = ((csd128 >> 118) & 0x3) as u32;
    let mut sectors: u64 = if is_sd && csd_structure == 1 {
        let c_size = ((csd128 >> 40) & 0x3F_FFFF) as u64;
        (c_size + 1) * 1024
    } else {
        let c_size = ((csd128 >> 54) & 0xFFF) as u64;
        let mult = ((csd128 >> 39) & 0x7) as u32;
        let read_bl_len = ((csd128 >> 72) & 0xF) as u32;
        ((c_size + 1) << (mult + 2)) * (1u64 << read_bl_len) / 512
    };

    // Select card (transfer state)
    sd_cmd(base, 7, dev.rca << 16, Resp::R1b, None)?;

    // eMMC sector-mode capacity lives in EXT_CSD[215:212] (SEC_COUNT)
    if !is_sd && dev.block_addressing {
        let mut ext = [0u8; SECTOR_SIZE];
        sd_cmd(base, 8, 0, Resp::R1, Some(true))?;
        sd_pio_read(base, &mut ext)?;
        let sec_count = u32::from_le_bytes([ext[212], ext[213], ext[214], ext[215]]) as u64;
        if sec_count != 0 {
            sectors = sec_count;
        }
    }
    if !dev.block_addressing {
        let _ = sd_cmd(base, 16, SECTOR_SIZE as u32, Resp::R1, None);
    }
    if sectors == 0 {
        return Err("card reported zero capacity");
    }
    dev.sectors = sectors;

    // Default-speed data clock (SD 25 MHz / eMMC legacy 26 MHz)
    sd_set_clock(base, spec_v3, base_mhz, 25_000);
    register(dev, b"mmc").ok_or("device table full")
}

unsafe fn sd_pio_read(base: u64, out: &mut [u8; SECTOR_SIZE]) -> Result<(), &'static str> {
    sd_wait_int(base, 0x0020, "sdhci: buffer read ready timeout")?;
    for i in 0..(SECTOR_SIZE / 4) {
        let v = mr32(base, SD_DATA);
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_le_bytes());
    }
    sd_wait_int(base, 0x0002, "sdhci: read transfer complete timeout")
}

unsafe fn sdhci_read_block(dev: &BlockDevice, lba: u64, out: &mut [u8; SECTOR_SIZE]) -> Result<(), &'static str> {
    let arg = if dev.block_addressing { lba as u32 } else { (lba * SECTOR_SIZE as u64) as u32 };
    sd_cmd(dev.mmio, 17, arg, Resp::R1, Some(true))?;
    sd_pio_read(dev.mmio, out)
}

unsafe fn sdhci_write_block(dev: &BlockDevice, lba: u64, data: &[u8; SECTOR_SIZE]) -> Result<(), &'static str> {
    let base = dev.mmio;
    let arg = if dev.block_addressing { lba as u32 } else { (lba * SECTOR_SIZE as u64) as u32 };
    sd_cmd(base, 24, arg, Resp::R1, Some(false))?;
    sd_wait_int(base, 0x0010, "sdhci: buffer write ready timeout")?;
    for i in 0..(SECTOR_SIZE / 4) {
        let v = u32::from_le_bytes([data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]]);
        mw32(base, SD_DATA, v);
    }
    sd_wait_int(base, 0x0002, "sdhci: write transfer complete timeout")?;
    // Wait until the card leaves programming state (CMD13: READY_FOR_DATA + TRAN).
    let rca = dev.rca;
    if !wait_until(2_000_000, || match sd_cmd(base, 13, rca << 16, Resp::R1, None) {
        Ok(r) => r[0] & (1 << 8) != 0 && (r[0] >> 9) & 0xF == 4,
        Err(_) => false,
    }) {
        return Err("sdhci: card stuck in programming state");
    }
    Ok(())
}
