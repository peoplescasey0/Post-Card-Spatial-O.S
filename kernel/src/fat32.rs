// ============================================================================
// THE BLACK BOX // FAT32 FILESYSTEM (READ + WRITE-THROUGH PERSISTENCE)
// ============================================================================
// Partition discovery (GPT / MBR / superfloppy) and a write-through FAT32 driver
// on top of `blockdev`, so files created from `SPATIAL>` survive power cycles.
//
// Safety rules (the internal drive may also hold Windows / other OS data):
//   * Partition tables are only ever READ, never written.
//   * Every mutating operation is confined to the `/POSTCARD` directory of the
//     mounted volume (created on first use). Relative paths resolve there.
//   * Every operation is write-through: data sectors -> FAT copies -> directory
//     entry -> FSInfo, then a device cache flush before returning.
//   * New names are created as 8.3 short names (with the NT lowercase flags so
//     `notes.txt` stays lowercase on Windows/Linux). Long names are readable.

use crate::blockdev::{self, SECTOR_SIZE};
use crate::{console_putc, inb, kprintln_colored, outb};

type R<T> = Result<T, &'static str>;

pub const HOME_DIR: &str = "POSTCARD";
const ATTR_DIR: u8 = 0x10;
const ATTR_ARCHIVE: u8 = 0x20;
const ATTR_VOLUME: u8 = 0x08;
const ATTR_LFN: u8 = 0x0F;
const EOC: u32 = 0x0FFF_FFFF;
const MAX_CAT_BYTES: u32 = 64 * 1024;

// ----------------------------------------------------------------------------
// Partition table discovery
// ----------------------------------------------------------------------------
#[derive(Clone, Copy)]
pub struct Partition {
    pub dev: usize,
    pub index: usize,
    pub lba: u64,
    pub sectors: u64,
    pub scheme: &'static str,
    /// 0 = no FAT volume, otherwise 12 / 16 / 32.
    pub fat_bits: u8,
    pub esp: bool,
    pub label: [u8; 11],
}

impl Partition {
    pub fn label_str(&self) -> &str {
        core::str::from_utf8(&self.label).unwrap_or("?").trim_end()
    }
}

const MAX_PARTS: usize = 16;
static mut PARTS: [Option<Partition>; MAX_PARTS] = [None; MAX_PARTS];
static mut PART_COUNT: usize = 0;

const ESP_GUID: [u8; 16] = [0x28, 0x73, 0x2A, 0xC1, 0x1F, 0xF8, 0xD2, 0x11, 0xBA, 0x4B, 0x00, 0xA0, 0xC9, 0x3E, 0xC9, 0x3B];

#[inline]
fn le16(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}
#[inline]
fn le32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}
#[inline]
fn le64(b: &[u8], o: usize) -> u64 {
    (le32(b, o) as u64) | ((le32(b, o + 4) as u64) << 32)
}

#[derive(Clone, Copy)]
struct Bpb {
    fat_bits: u8,
    spc: u32,
    reserved: u32,
    num_fats: u32,
    root_entries: u32,
    total: u64,
    fat_size: u32,
    root_cluster: u32,
    fsinfo_sec: u16,
    label: [u8; 11],
}

/// Parses a FAT12/16/32 boot sector. The width is decided from the cluster
/// count, as the specification requires: the "FAT16" string inside the boot
/// sector is advisory and is simply wrong in plenty of real images.
fn parse_bpb(s: &[u8; SECTOR_SIZE]) -> Option<Bpb> {
    if s[510] != 0x55 || s[511] != 0xAA {
        return None;
    }
    let spc = s[13];
    let reserved = le16(s, 14) as u32;
    let num_fats = s[16] as u32;
    let root_entries = le16(s, 17) as u32;
    let total16 = le16(s, 19) as u64;
    let fat16 = le16(s, 22) as u32;
    let total32 = le32(s, 32) as u64;
    let fat32 = le32(s, 36);
    let root_cluster32 = le32(s, 44);
    if le16(s, 11) != 512 || spc == 0 || !spc.is_power_of_two() || reserved == 0 || !(1..=2).contains(&num_fats) {
        return None;
    }
    let total = if total16 != 0 { total16 } else { total32 };
    if total == 0 {
        return None;
    }
    let (fat_size, root_cluster) = if fat16 != 0 { (fat16, 0) } else { (fat32, root_cluster32) };
    if fat_size == 0 {
        return None;
    }
    let root_dir_sectors = (root_entries * 32).div_ceil(SECTOR_SIZE as u32);
    let overhead = reserved as u64 + num_fats as u64 * fat_size as u64 + root_dir_sectors as u64;
    if total <= overhead {
        return None;
    }
    let clusters = ((total - overhead) / spc as u64) as u32;
    // The shape of the BPB decides first: only FAT32 leaves the 16-bit root
    // entry count and 16-bit FAT size at zero. The cluster count then splits
    // FAT12 from FAT16. Tools do emit volumes whose cluster count sits in
    // FAT16 territory while the BPB is otherwise pure FAT32 (mtools does),
    // and those are meant to be read as FAT32.
    let fat32_shape = fat16 == 0 && root_entries == 0;
    let fat_bits = if fat32_shape {
        if root_cluster32 < 2 {
            return None;
        }
        32
    } else if root_entries == 0 {
        return None;
    } else if clusters < 4085 {
        12
    } else {
        16
    };
    let mut label = [b' '; 11];
    let (sig_off, label_off) = if fat_bits == 32 { (66, 71) } else { (38, 43) };
    if s[sig_off] == 0x29 {
        label.copy_from_slice(&s[label_off..label_off + 11]);
    }
    Some(Bpb {
        fat_bits,
        spc: spc as u32,
        reserved,
        num_fats,
        root_entries,
        total,
        fat_size,
        root_cluster,
        fsinfo_sec: le16(s, 48),
        label,
    })
}

unsafe fn add_partition(dev: usize, index: usize, lba: u64, sectors: u64, scheme: &'static str, esp: bool) {
    if PART_COUNT >= MAX_PARTS || sectors == 0 {
        return;
    }
    let mut s = [0u8; SECTOR_SIZE];
    let mut fat_bits = 0u8;
    let mut label = *b"           ";
    if blockdev::read_sector(dev, lba, &mut s).is_ok() {
        if let Some(b) = parse_bpb(&s) {
            fat_bits = b.fat_bits;
            label = b.label;
        }
    }
    PARTS[PART_COUNT] = Some(Partition { dev, index, lba, sectors, scheme, fat_bits, esp, label });
    PART_COUNT += 1;
}

unsafe fn scan_gpt(dev: usize) {
    let mut h = [0u8; SECTOR_SIZE];
    if blockdev::read_sector(dev, 1, &mut h).is_err() || &h[0..8] != b"EFI PART" {
        return;
    }
    let entries_lba = le64(&h, 72);
    let count = le32(&h, 80).min(128) as usize;
    let esize = le32(&h, 84) as usize;
    if esize < 128 || esize > SECTOR_SIZE || SECTOR_SIZE % esize != 0 {
        return;
    }
    let per_sector = SECTOR_SIZE / esize;
    let mut sec = [0u8; SECTOR_SIZE];
    let mut loaded = u64::MAX;
    for i in 0..count {
        let lba = entries_lba + (i / per_sector) as u64;
        if lba != loaded {
            if blockdev::read_sector(dev, lba, &mut sec).is_err() {
                return;
            }
            loaded = lba;
        }
        let o = (i % per_sector) * esize;
        if sec[o..o + 16].iter().all(|&b| b == 0) {
            continue;
        }
        let first = le64(&sec, o + 32);
        let last = le64(&sec, o + 40);
        if last < first {
            continue;
        }
        let esp = sec[o..o + 16] == ESP_GUID;
        add_partition(dev, i + 1, first, last - first + 1, "GPT", esp);
    }
}

/// Re-reads the partition tables of every block device.
pub unsafe fn scan_partitions() {
    PART_COUNT = 0;
    for dev in 0..blockdev::device_count() {
        let Some(d) = blockdev::device(dev) else { continue };
        let total = d.sectors;
        let mut s = [0u8; SECTOR_SIZE];
        if blockdev::read_sector(dev, 0, &mut s).is_err() {
            continue;
        }
        if parse_bpb(&s).is_some() {
            add_partition(dev, 0, 0, total, "RAW", false);
            continue;
        }
        if s[510] != 0x55 || s[511] != 0xAA {
            continue;
        }
        if (0..4).any(|i| s[446 + i * 16 + 4] == 0xEE) {
            scan_gpt(dev);
            continue;
        }
        for i in 0..4 {
            let e = 446 + i * 16;
            let ptype = s[e + 4];
            if ptype == 0 {
                continue;
            }
            add_partition(dev, i + 1, le32(&s, e + 8) as u64, le32(&s, e + 12) as u64, "MBR", ptype == 0xEF);
        }
    }
}

pub unsafe fn partitions() -> impl Iterator<Item = (usize, Partition)> {
    (0..PART_COUNT).filter_map(|i| PARTS[i].map(|p| (i, p)))
}

// ----------------------------------------------------------------------------
// Mounted volume state + FAT sector cache
// ----------------------------------------------------------------------------
struct Volume {
    mounted: bool,
    part: usize,
    dev: usize,
    base: u64,
    fat_bits: u8,
    /// FAT12/16 keep the root directory in a fixed region instead of a cluster
    /// chain; it is addressed here as pseudo-cluster 1 so the directory walk
    /// and the path resolver need no special case.
    root_region_start: u64,
    root_sectors: u32,
    spc: u32,
    fat_start: u64,
    fat_size: u32,
    num_fats: u32,
    data_start: u64,
    root: u32,
    total_clusters: u32,
    fsinfo_lba: u64,
    fsinfo_valid: bool,
    free_count: u32,
    next_free: u32,
    label: [u8; 11],
}

static mut VOL: Volume = Volume {
    mounted: false,
    part: 0,
    dev: 0,
    base: 0,
    fat_bits: 32,
    root_region_start: 0,
    root_sectors: 0,
    spc: 1,
    fat_start: 0,
    fat_size: 0,
    num_fats: 0,
    data_start: 0,
    root: 2,
    total_clusters: 0,
    fsinfo_lba: 0,
    fsinfo_valid: false,
    free_count: 0xFFFF_FFFF,
    next_free: 0xFFFF_FFFF,
    label: [b' '; 11],
};

static mut FAT_CACHE: [u8; SECTOR_SIZE] = [0; SECTOR_SIZE];
static mut FAT_CACHE_LBA: u64 = u64::MAX;

pub unsafe fn is_mounted() -> bool {
    VOL.mounted
}

pub unsafe fn mount(part_idx: usize) -> R<()> {
    let p = if part_idx < PART_COUNT { PARTS[part_idx] } else { None }.ok_or("no such partition")?;
    if p.fat_bits == 0 {
        return Err("partition is not a FAT volume");
    }
    let mut s = [0u8; SECTOR_SIZE];
    blockdev::read_sector(p.dev, p.lba, &mut s)?;
    let bpb = parse_bpb(&s).ok_or("invalid FAT boot sector")?;
    let spc = bpb.spc;
    let num_fats = bpb.num_fats;
    let fat_size = bpb.fat_size;
    let reserved = bpb.reserved as u64;
    let fat_start = p.lba + reserved;
    let root_sectors = (bpb.root_entries * 32).div_ceil(SECTOR_SIZE as u32);
    let root_region_start = fat_start + num_fats as u64 * fat_size as u64;
    let data_start = root_region_start + root_sectors as u64;
    let data_sectors = bpb.total.saturating_sub(data_start - p.lba);
    // Clamp to what the FAT can describe: 1.5 bytes per entry for FAT12,
    // 2 for FAT16, 4 for FAT32.
    let entries_per_fat = match bpb.fat_bits {
        12 => fat_size as u64 * SECTOR_SIZE as u64 * 2 / 3,
        16 => fat_size as u64 * SECTOR_SIZE as u64 / 2,
        _ => fat_size as u64 * SECTOR_SIZE as u64 / 4,
    };
    let mut total_clusters = (data_sectors / spc as u64) as u32;
    total_clusters = total_clusters.min(entries_per_fat.saturating_sub(2) as u32);
    if total_clusters == 0 {
        return Err("FAT volume has no data clusters");
    }

    VOL.mounted = false;
    VOL.part = part_idx;
    VOL.dev = p.dev;
    VOL.base = p.lba;
    VOL.fat_bits = bpb.fat_bits;
    VOL.root_region_start = root_region_start;
    VOL.root_sectors = root_sectors;
    VOL.spc = spc;
    VOL.fat_start = fat_start;
    VOL.fat_size = fat_size;
    VOL.num_fats = num_fats;
    VOL.data_start = data_start;
    // FAT12/16 have no root cluster: the fixed root region is pseudo-cluster 1.
    VOL.root = if bpb.fat_bits == 32 { bpb.root_cluster } else { 1 };
    VOL.total_clusters = total_clusters;
    VOL.label.copy_from_slice(&bpb.label);
    VOL.fsinfo_valid = false;
    VOL.free_count = 0xFFFF_FFFF;
    VOL.next_free = 0xFFFF_FFFF;
    let fsinfo_sec = bpb.fsinfo_sec as u64;
    if fsinfo_sec != 0 && fsinfo_sec != 0xFFFF && fsinfo_sec < reserved {
        VOL.fsinfo_lba = p.lba + fsinfo_sec;
        let mut fi = [0u8; SECTOR_SIZE];
        if blockdev::read_sector(p.dev, VOL.fsinfo_lba, &mut fi).is_ok()
            && le32(&fi, 0) == 0x4161_5252
            && le32(&fi, 484) == 0x6141_7272
            && le32(&fi, 508) == 0xAA55_0000
        {
            VOL.fsinfo_valid = true;
            VOL.free_count = le32(&fi, 488);
            VOL.next_free = le32(&fi, 492);
            if VOL.free_count != 0xFFFF_FFFF && VOL.free_count > total_clusters {
                VOL.free_count = 0xFFFF_FFFF;
            }
        }
    }
    FAT_CACHE_LBA = u64::MAX;
    VOL.mounted = true;
    Ok(())
}

pub unsafe fn unmount() -> R<()> {
    if VOL.mounted {
        commit()?;
    }
    VOL.mounted = false;
    FAT_CACHE_LBA = u64::MAX;
    Ok(())
}

/// Picks the best FAT volume: label "POSTCARD" > has /POSTCARD > ESP > any.
pub unsafe fn automount() -> Option<usize> {
    let mut best: Option<(usize, u32)> = None;
    for i in 0..PART_COUNT {
        let Some(p) = PARTS[i] else { continue };
        if p.fat_bits == 0 || mount(i).is_err() {
            continue;
        }
        let mut score = 1;
        if p.esp {
            score = 2;
        }
        if matches!(find(0, HOME_DIR), Ok(Some(e)) if e.attr & ATTR_DIR != 0) {
            score = 3;
        }
        if p.label_str().eq_ignore_ascii_case("POSTCARD") {
            score = 4;
        }
        if best.map_or(true, |(_, s)| score > s) {
            best = Some((i, score));
        }
    }
    VOL.mounted = false;
    let (idx, _) = best?;
    mount(idx).ok()?;
    Some(idx)
}

#[inline]
unsafe fn valid_cluster(c: u32) -> bool {
    if VOL.fat_bits != 32 && c == 1 {
        return VOL.root_sectors != 0;
    }
    c >= 2 && c < VOL.total_clusters + 2
}

#[inline]
unsafe fn cluster_lba(c: u32) -> u64 {
    if VOL.fat_bits != 32 && c == 1 {
        return VOL.root_region_start;
    }
    VOL.data_start + (c - 2) as u64 * VOL.spc as u64
}

/// Sectors occupied by a cluster; pseudo-cluster 1 is the fixed root region.
#[inline]
unsafe fn cluster_sectors(c: u32) -> u64 {
    if VOL.fat_bits != 32 && c == 1 {
        VOL.root_sectors as u64
    } else {
        VOL.spc as u64
    }
}

unsafe fn fat_load(lba: u64) -> R<()> {
    if FAT_CACHE_LBA != lba {
        FAT_CACHE_LBA = u64::MAX;
        blockdev::read_sector(VOL.dev, lba, &mut FAT_CACHE)?;
        FAT_CACHE_LBA = lba;
    }
    Ok(())
}

/// Reads one byte of the first FAT copy (FAT12 entries can straddle a sector).
unsafe fn fat_byte(off: u64) -> R<u8> {
    fat_load(VOL.fat_start + off / SECTOR_SIZE as u64)?;
    Ok(FAT_CACHE[(off % SECTOR_SIZE as u64) as usize])
}

unsafe fn fat_put_byte(off: u64, v: u8) -> R<()> {
    let rel = off / SECTOR_SIZE as u64;
    fat_load(VOL.fat_start + rel)?;
    FAT_CACHE[(off % SECTOR_SIZE as u64) as usize] = v;
    for i in 0..VOL.num_fats {
        let lba = VOL.fat_start + i as u64 * VOL.fat_size as u64 + rel;
        blockdev::write_sector(VOL.dev, lba, &FAT_CACHE)?;
    }
    Ok(())
}

unsafe fn fat_get(c: u32) -> R<u32> {
    // The fixed root region is a one-shot chain: report end-of-chain so the
    // directory walk stops after it.
    if VOL.fat_bits != 32 && c == 1 {
        return Ok(if VOL.fat_bits == 12 { 0x0FFF } else { 0xFFFF });
    }
    match VOL.fat_bits {
        12 => {
            let off = c as u64 + c as u64 / 2;
            let v = fat_byte(off)? as u32 | ((fat_byte(off + 1)? as u32) << 8);
            Ok(if c & 1 == 0 { v & 0x0FFF } else { v >> 4 })
        }
        16 => {
            let off = c as u64 * 2;
            fat_load(VOL.fat_start + off / SECTOR_SIZE as u64)?;
            Ok(le16(&FAT_CACHE, (off % SECTOR_SIZE as u64) as usize) as u32)
        }
        _ => {
            let off = c as u64 * 4;
            let rel = off / SECTOR_SIZE as u64;
            fat_load(VOL.fat_start + rel)?;
            Ok(le32(&FAT_CACHE, (off % SECTOR_SIZE as u64) as usize) & 0x0FFF_FFFF)
        }
    }
}

unsafe fn fat_set(c: u32, val: u32) -> R<()> {
    if VOL.fat_bits != 32 && c == 1 {
        return Err("cannot modify the fixed root directory");
    }
    match VOL.fat_bits {
        12 => {
            let off = c as u64 + c as u64 / 2;
            let v = fat_byte(off)? as u32 | ((fat_byte(off + 1)? as u32) << 8);
            let nv = if c & 1 == 0 {
                (v & 0xF000) | (val & 0x0FFF)
            } else {
                (v & 0x000F) | ((val & 0x0FFF) << 4)
            };
            fat_put_byte(off, nv as u8)?;
            fat_put_byte(off + 1, (nv >> 8) as u8)?;
            Ok(())
        }
        16 => {
            let off = c as u64 * 2;
            let rel = off / SECTOR_SIZE as u64;
            let o = (off % SECTOR_SIZE as u64) as usize;
            fat_load(VOL.fat_start + rel)?;
            FAT_CACHE[o..o + 2].copy_from_slice(&((val & 0xFFFF) as u16).to_le_bytes());
            for i in 0..VOL.num_fats {
                let lba = VOL.fat_start + i as u64 * VOL.fat_size as u64 + rel;
                blockdev::write_sector(VOL.dev, lba, &FAT_CACHE)?;
            }
            Ok(())
        }
        _ => {
            let off = c as u64 * 4;
            let rel = off / SECTOR_SIZE as u64;
            let o = (off % SECTOR_SIZE as u64) as usize;
            fat_load(VOL.fat_start + rel)?;
            let old = le32(&FAT_CACHE, o);
            let new = (old & 0xF000_0000) | (val & 0x0FFF_FFFF);
            FAT_CACHE[o..o + 4].copy_from_slice(&new.to_le_bytes());
            for i in 0..VOL.num_fats {
                let lba = VOL.fat_start + i as u64 * VOL.fat_size as u64 + rel;
                blockdev::write_sector(VOL.dev, lba, &FAT_CACHE)?;
            }
            Ok(())
        }
    }
}

unsafe fn alloc_cluster() -> R<u32> {
    if VOL.free_count == 0 {
        return Err("volume full");
    }
    let total = VOL.total_clusters;
    let mut c = if valid_cluster(VOL.next_free) { VOL.next_free } else { 2 };
    for _ in 0..total {
        if fat_get(c)? == 0 {
            fat_set(c, EOC)?;
            let zero = [0u8; SECTOR_SIZE];
            for s in 0..VOL.spc as u64 {
                blockdev::write_sector(VOL.dev, cluster_lba(c) + s, &zero)?;
            }
            if VOL.free_count != 0xFFFF_FFFF {
                VOL.free_count -= 1;
            }
            VOL.next_free = if c + 1 < total + 2 { c + 1 } else { 2 };
            return Ok(c);
        }
        c += 1;
        if c >= total + 2 {
            c = 2;
        }
    }
    Err("volume full")
}

unsafe fn free_chain(mut c: u32) -> R<()> {
    let mut guard = 0u32;
    while valid_cluster(c) {
        let next = fat_get(c)?;
        fat_set(c, 0)?;
        if VOL.free_count != 0xFFFF_FFFF {
            VOL.free_count += 1;
        }
        c = next;
        guard += 1;
        if guard > VOL.total_clusters {
            return Err("cluster chain loop");
        }
    }
    Ok(())
}

/// Writes FSInfo hints and flushes the device write cache.
unsafe fn commit() -> R<()> {
    if VOL.fsinfo_valid {
        let mut fi = [0u8; SECTOR_SIZE];
        blockdev::read_sector(VOL.dev, VOL.fsinfo_lba, &mut fi)?;
        fi[488..492].copy_from_slice(&VOL.free_count.to_le_bytes());
        fi[492..496].copy_from_slice(&VOL.next_free.to_le_bytes());
        blockdev::write_sector(VOL.dev, VOL.fsinfo_lba, &fi)?;
    }
    blockdev::flush(VOL.dev)
}

pub unsafe fn sync() -> R<()> {
    if !VOL.mounted {
        return Err("no FAT volume mounted");
    }
    commit()
}

// ----------------------------------------------------------------------------
// CMOS RTC -> FAT timestamps
// ----------------------------------------------------------------------------
unsafe fn cmos(reg: u8) -> u8 {
    outb(0x70, reg | 0x80);
    inb(0x71)
}

fn bcd(v: u8) -> u8 {
    (v & 0x0F) + (v >> 4) * 10
}

unsafe fn fat_now() -> (u16, u16) {
    let mut spins = 0;
    while cmos(0x0A) & 0x80 != 0 && spins < 100_000 {
        spins += 1;
    }
    let (mut s, mut m, mut h, mut day, mut mon, mut yr) = (cmos(0x00), cmos(0x02), cmos(0x04), cmos(0x07), cmos(0x08), cmos(0x09));
    let b = cmos(0x0B);
    let pm = h & 0x80 != 0;
    h &= 0x7F;
    if b & 0x04 == 0 {
        s = bcd(s);
        m = bcd(m);
        h = bcd(h);
        day = bcd(day);
        mon = bcd(mon);
        yr = bcd(yr);
    }
    if b & 0x02 == 0 && pm {
        h = (h % 12) + 12;
    }
    if s > 59 || m > 59 || h > 23 || !(1..=31).contains(&day) || !(1..=12).contains(&mon) || yr > 99 {
        return (0, (46 << 9) | (1 << 5) | 1); // 2026-01-01 00:00
    }
    let year = 2000u16 + yr as u16;
    let time = ((h as u16) << 11) | ((m as u16) << 5) | ((s as u16) / 2);
    let date = ((year - 1980) << 9) | ((mon as u16) << 5) | day as u16;
    (time, date)
}

// ----------------------------------------------------------------------------
// Directory entries
// ----------------------------------------------------------------------------
#[derive(Clone, Copy)]
pub struct DirEntry {
    pub short: [u8; 11],
    pub nt: u8,
    pub lfn: [u8; 128],
    pub lfn_len: usize,
    pub attr: u8,
    pub cluster: u32,
    pub size: u32,
    lba: u64,
    off: usize,
    lfn_locs: [(u64, u16); 20],
    lfn_count: usize,
}

impl DirEntry {
    fn display(&self, out: &mut [u8; 128]) -> usize {
        if self.lfn_len > 0 {
            out[..self.lfn_len].copy_from_slice(&self.lfn[..self.lfn_len]);
            return self.lfn_len;
        }
        let mut n = 0;
        let lower_base = self.nt & 0x08 != 0;
        let lower_ext = self.nt & 0x10 != 0;
        for &c in self.short[..8].iter() {
            if c == b' ' {
                break;
            }
            out[n] = if lower_base { c.to_ascii_lowercase() } else { c };
            n += 1;
        }
        if self.short[8] != b' ' {
            out[n] = b'.';
            n += 1;
            for &c in self.short[8..].iter() {
                if c == b' ' {
                    break;
                }
                out[n] = if lower_ext { c.to_ascii_lowercase() } else { c };
                n += 1;
            }
        }
        n
    }

    fn matches(&self, name: &str) -> bool {
        let mut buf = [0u8; 128];
        let n = self.display(&mut buf);
        if buf[..n].eq_ignore_ascii_case(name.as_bytes()) {
            return true;
        }
        // Always allow matching the 8.3 alias too (e.g. PROGRA~1).
        if self.lfn_len > 0 {
            let mut alias = *self;
            alias.lfn_len = 0;
            let n = alias.display(&mut buf);
            return buf[..n].eq_ignore_ascii_case(name.as_bytes());
        }
        false
    }
}

fn lfn_checksum(short: &[u8]) -> u8 {
    let mut sum: u8 = 0;
    for &b in short.iter().take(11) {
        sum = ((sum & 1) << 7).wrapping_add(sum >> 1).wrapping_add(b);
    }
    sum
}

/// Walks a directory (0 = root). `f` returns true to stop. Returns whether stopped.
unsafe fn dir_walk<F: FnMut(&DirEntry) -> bool>(dir: u32, mut f: F) -> R<bool> {
    let mut c = if dir == 0 { VOL.root } else { dir };
    let mut lfn = [0u8; 128];
    let mut lfn_ok = false;
    let mut lfn_len = 0usize;
    let mut lfn_chk = 0u8;
    let mut locs = [(0u64, 0u16); 20];
    let mut nlocs = 0usize;
    let mut guard = 0u32;
    const LFN_POS: [usize; 13] = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
    while valid_cluster(c) {
        for s in 0..cluster_sectors(c) {
            let lba = cluster_lba(c) + s;
            let mut sec = [0u8; SECTOR_SIZE];
            blockdev::read_sector(VOL.dev, lba, &mut sec)?;
            for e in 0..(SECTOR_SIZE / 32) {
                let o = e * 32;
                let b0 = sec[o];
                if b0 == 0x00 {
                    return Ok(false);
                }
                if b0 == 0xE5 {
                    nlocs = 0;
                    lfn_ok = false;
                    continue;
                }
                let attr = sec[o + 11];
                if attr & 0x3F == ATTR_LFN {
                    let seq = (b0 & 0x1F) as usize;
                    if b0 & 0x40 != 0 {
                        lfn = [0u8; 128];
                        nlocs = 0;
                        lfn_len = 0;
                        lfn_ok = true;
                        lfn_chk = sec[o + 13];
                    }
                    if seq == 0 {
                        lfn_ok = false;
                        continue;
                    }
                    if nlocs < locs.len() {
                        locs[nlocs] = (lba, o as u16);
                        nlocs += 1;
                    }
                    for (k, &p) in LFN_POS.iter().enumerate() {
                        let ch = le16(&sec, o + p);
                        if ch == 0 || ch == 0xFFFF {
                            continue;
                        }
                        let idx = (seq - 1) * 13 + k;
                        if idx < lfn.len() {
                            lfn[idx] = if ch < 0x80 { ch as u8 } else { b'?' };
                            lfn_len = lfn_len.max(idx + 1);
                        } else {
                            lfn_ok = false;
                        }
                    }
                    continue;
                }
                if attr & ATTR_VOLUME != 0 {
                    nlocs = 0;
                    lfn_ok = false;
                    continue;
                }
                let mut ent = DirEntry {
                    short: [0; 11],
                    nt: sec[o + 12],
                    lfn: [0; 128],
                    lfn_len: 0,
                    attr,
                    cluster: ((le16(&sec, o + 20) as u32) << 16) | le16(&sec, o + 26) as u32,
                    size: le32(&sec, o + 28),
                    lba,
                    off: o,
                    lfn_locs: [(0, 0); 20],
                    lfn_count: 0,
                };
                ent.short.copy_from_slice(&sec[o..o + 11]);
                if ent.short[0] == 0x05 {
                    ent.short[0] = 0xE5;
                }
                if lfn_ok && nlocs > 0 && lfn_chk == lfn_checksum(&sec[o..o + 11]) {
                    ent.lfn = lfn;
                    ent.lfn_len = lfn_len;
                    ent.lfn_locs = locs;
                    ent.lfn_count = nlocs;
                }
                if f(&ent) {
                    return Ok(true);
                }
                nlocs = 0;
                lfn_ok = false;
            }
        }
        c = fat_get(c)?;
        guard += 1;
        if guard > VOL.total_clusters {
            return Err("directory chain loop");
        }
    }
    Ok(false)
}

unsafe fn find(dir: u32, name: &str) -> R<Option<DirEntry>> {
    let mut found = None;
    dir_walk(dir, |e| {
        if e.matches(name) {
            found = Some(*e);
            true
        } else {
            false
        }
    })?;
    Ok(found)
}

#[inline]
unsafe fn norm_dir(cluster: u32) -> u32 {
    if cluster == VOL.root { 0 } else { cluster }
}

/// Resolves an absolute directory path to its first cluster (0 = root).
unsafe fn resolve_dir(path: &str) -> R<u32> {
    let mut cur = 0u32;
    for comp in path.split('/') {
        if comp.is_empty() || comp == "." {
            continue;
        }
        let e = find(cur, comp)?.ok_or("no such file or directory")?;
        if e.attr & ATTR_DIR == 0 {
            return Err("not a directory");
        }
        cur = norm_dir(e.cluster);
    }
    Ok(cur)
}

fn split_parent(path: &str) -> (&str, &str) {
    let p = path.trim_end_matches('/');
    match p.rfind('/') {
        Some(i) => (&p[..i], &p[i + 1..]),
        None => ("", p),
    }
}

/// Builds an absolute path: relative inputs resolve inside /POSTCARD.
fn abs_path<'a>(input: &str, buf: &'a mut [u8; 192]) -> R<&'a str> {
    let input = input.trim();
    let mut n = 0usize;
    let mut push = |s: &[u8], n: &mut usize| -> R<()> {
        if *n + s.len() > buf.len() {
            return Err("path too long");
        }
        buf[*n..*n + s.len()].copy_from_slice(s);
        *n += s.len();
        Ok(())
    };
    if !input.starts_with('/') {
        push(b"/", &mut n)?;
        push(HOME_DIR.as_bytes(), &mut n)?;
        if !input.is_empty() {
            push(b"/", &mut n)?;
        }
    }
    push(input.as_bytes(), &mut n)?;
    core::str::from_utf8(&buf[..n]).map_err(|_| "invalid path")
}

/// Ensures a mutating path stays inside /POSTCARD (no `..` escapes).
fn check_writable(path: &str) -> R<()> {
    let mut comps = path.split('/').filter(|c| !c.is_empty() && *c != ".");
    match comps.next() {
        Some(first) if first.eq_ignore_ascii_case(HOME_DIR) => {}
        _ => return Err("writes are confined to /POSTCARD (use a relative path)"),
    }
    if comps.clone().any(|c| c == "..") {
        return Err("'..' is not allowed in write paths");
    }
    if comps.next().is_none() {
        return Err("refusing to modify /POSTCARD itself");
    }
    Ok(())
}

/// 8.3 short name + NT case flags (0x08 lowercase base, 0x10 lowercase ext).
fn to_short(name: &str) -> Option<([u8; 11], u8)> {
    if name == "." || name == ".." {
        return None;
    }
    let (base, ext) = match name.rfind('.') {
        Some(i) => (&name[..i], &name[i + 1..]),
        None => (name, ""),
    };
    if base.is_empty() || base.len() > 8 || ext.len() > 3 || base.contains('.') {
        return None;
    }
    let ok = |c: u8| c.is_ascii_alphanumeric() || b"!#$%&'()-@^_`{}~".contains(&c);
    if !base.bytes().all(ok) || !ext.bytes().all(ok) {
        return None;
    }
    let mut short = [b' '; 11];
    for (i, c) in base.bytes().enumerate() {
        short[i] = c.to_ascii_uppercase();
    }
    for (i, c) in ext.bytes().enumerate() {
        short[8 + i] = c.to_ascii_uppercase();
    }
    let case_flag = |s: &str, flag: u8| -> u8 {
        let has_lower = s.bytes().any(|c| c.is_ascii_lowercase());
        let has_upper = s.bytes().any(|c| c.is_ascii_uppercase());
        if has_lower && !has_upper { flag } else { 0 }
    };
    // Mixed-case names cannot be represented without an LFN: store uppercase.
    let nt = case_flag(base, 0x08) | case_flag(ext, 0x10);
    Some((short, nt))
}

fn make_raw(short: &[u8; 11], nt: u8, attr: u8, cluster: u32, size: u32, time: u16, date: u16) -> [u8; 32] {
    let mut r = [0u8; 32];
    r[0..11].copy_from_slice(short);
    r[11] = attr;
    r[12] = nt;
    r[14..16].copy_from_slice(&time.to_le_bytes());
    r[16..18].copy_from_slice(&date.to_le_bytes());
    r[18..20].copy_from_slice(&date.to_le_bytes());
    r[20..22].copy_from_slice(&((cluster >> 16) as u16).to_le_bytes());
    r[22..24].copy_from_slice(&time.to_le_bytes());
    r[24..26].copy_from_slice(&date.to_le_bytes());
    r[26..28].copy_from_slice(&(cluster as u16).to_le_bytes());
    r[28..32].copy_from_slice(&size.to_le_bytes());
    r
}

/// Inserts a raw 32-byte entry into a directory, extending it if full.
unsafe fn dir_add(dir: u32, raw: &[u8; 32]) -> R<(u64, usize)> {
    let mut c = if dir == 0 { VOL.root } else { dir };
    let mut last = c;
    let mut guard = 0u32;
    while valid_cluster(c) {
        for s in 0..cluster_sectors(c) {
            let lba = cluster_lba(c) + s;
            let mut sec = [0u8; SECTOR_SIZE];
            blockdev::read_sector(VOL.dev, lba, &mut sec)?;
            for e in 0..(SECTOR_SIZE / 32) {
                let o = e * 32;
                if sec[o] == 0x00 || sec[o] == 0xE5 {
                    sec[o..o + 32].copy_from_slice(raw);
                    blockdev::write_sector(VOL.dev, lba, &sec)?;
                    return Ok((lba, o));
                }
            }
        }
        last = c;
        c = fat_get(c)?;
        guard += 1;
        if guard > VOL.total_clusters {
            return Err("directory chain loop");
        }
    }
    if VOL.fat_bits != 32 && last == 1 {
        return Err("root directory is full");
    }
    let n = alloc_cluster()?;
    fat_set(last, n)?;
    let lba = cluster_lba(n);
    let mut sec = [0u8; SECTOR_SIZE];
    sec[0..32].copy_from_slice(raw);
    blockdev::write_sector(VOL.dev, lba, &sec)?;
    Ok((lba, 0))
}

unsafe fn update_entry(lba: u64, off: usize, cluster: u32, size: u32, time: u16, date: u16) -> R<()> {
    let mut sec = [0u8; SECTOR_SIZE];
    blockdev::read_sector(VOL.dev, lba, &mut sec)?;
    sec[off + 18..off + 20].copy_from_slice(&date.to_le_bytes());
    sec[off + 20..off + 22].copy_from_slice(&((cluster >> 16) as u16).to_le_bytes());
    sec[off + 22..off + 24].copy_from_slice(&time.to_le_bytes());
    sec[off + 24..off + 26].copy_from_slice(&date.to_le_bytes());
    sec[off + 26..off + 28].copy_from_slice(&(cluster as u16).to_le_bytes());
    sec[off + 28..off + 32].copy_from_slice(&size.to_le_bytes());
    blockdev::write_sector(VOL.dev, lba, &sec)
}

unsafe fn mark_deleted(lba: u64, off: usize) -> R<()> {
    let mut sec = [0u8; SECTOR_SIZE];
    blockdev::read_sector(VOL.dev, lba, &mut sec)?;
    sec[off] = 0xE5;
    blockdev::write_sector(VOL.dev, lba, &sec)
}

unsafe fn mkdir_in(parent: u32, short: &[u8; 11], nt: u8) -> R<u32> {
    let (t, d) = fat_now();
    let n = alloc_cluster()?;
    let mut sec = [0u8; SECTOR_SIZE];
    sec[0..32].copy_from_slice(&make_raw(b".          ", 0, ATTR_DIR, n, 0, t, d));
    sec[32..64].copy_from_slice(&make_raw(b"..         ", 0, ATTR_DIR, parent, 0, t, d));
    blockdev::write_sector(VOL.dev, cluster_lba(n), &sec)?;
    dir_add(parent, &make_raw(short, nt, ATTR_DIR, n, 0, t, d))?;
    Ok(n)
}

unsafe fn ensure_home() -> R<u32> {
    match find(0, HOME_DIR)? {
        Some(e) if e.attr & ATTR_DIR != 0 => Ok(norm_dir(e.cluster)),
        Some(_) => Err("/POSTCARD exists but is not a directory"),
        None => mkdir_in(0, b"POSTCARD   ", 0),
    }
}

fn require_mounted() -> R<()> {
    if unsafe { VOL.mounted } { Ok(()) } else { Err("no FAT volume mounted (try `disks` / `mount`)") }
}

// ----------------------------------------------------------------------------
// Public file operations (used by the SPATIAL> shell)
// ----------------------------------------------------------------------------
/// Creates/truncates (or appends to) a file inside /POSTCARD. Returns new size.
pub unsafe fn write_file(path: &str, data: &[u8], append: bool) -> R<u32> {
    require_mounted()?;
    let mut pbuf = [0u8; 192];
    let full = abs_path(path, &mut pbuf)?;
    check_writable(full)?;
    let (parent_path, name) = split_parent(full);
    if name.is_empty() {
        return Err("missing file name");
    }
    ensure_home()?;
    let parent = resolve_dir(parent_path)?;
    let (t, d) = fat_now();
    let (lba, off, mut first, mut size) = match find(parent, name)? {
        Some(e) if e.attr & ATTR_DIR != 0 => return Err("is a directory"),
        Some(e) => (e.lba, e.off, e.cluster, e.size),
        None => {
            let (short, nt) = to_short(name).ok_or("new file names must be 8.3 (e.g. notes.txt)")?;
            let (lba, off) = dir_add(parent, &make_raw(&short, nt, ATTR_ARCHIVE, 0, 0, t, d))?;
            (lba, off, 0, 0)
        }
    };
    if !append {
        if valid_cluster(first) {
            free_chain(first)?;
        }
        first = 0;
        size = 0;
    }
    if (size as u64) + (data.len() as u64) > 0xFFFF_FFFF {
        return Err("file would exceed 4 GiB");
    }
    if !data.is_empty() {
        let cb = VOL.spc as usize * SECTOR_SIZE;
        let (mut cur, mut used) = if !valid_cluster(first) {
            first = alloc_cluster()?;
            (first, 0usize)
        } else {
            let mut cur = first;
            let mut steps = if size == 0 { 0 } else { (size as usize - 1) / cb };
            while steps > 0 {
                cur = fat_get(cur)?;
                if !valid_cluster(cur) {
                    return Err("corrupt cluster chain");
                }
                steps -= 1;
            }
            (cur, if size == 0 { 0 } else { (size as usize - 1) % cb + 1 })
        };
        let mut written = 0usize;
        while written < data.len() {
            if used == cb {
                let n = alloc_cluster()?;
                fat_set(cur, n)?;
                cur = n;
                used = 0;
            }
            let lba = cluster_lba(cur) + (used / SECTOR_SIZE) as u64;
            let sec_off = used % SECTOR_SIZE;
            let mut sec = [0u8; SECTOR_SIZE];
            if sec_off != 0 {
                blockdev::read_sector(VOL.dev, lba, &mut sec)?;
            }
            let n = (SECTOR_SIZE - sec_off).min(data.len() - written);
            sec[sec_off..sec_off + n].copy_from_slice(&data[written..written + n]);
            blockdev::write_sector(VOL.dev, lba, &sec)?;
            written += n;
            used += n;
        }
        size += data.len() as u32;
    }
    update_entry(lba, off, first, size, t, d)?;
    commit()?;
    Ok(size)
}

pub unsafe fn mkdir(path: &str) -> R<()> {
    require_mounted()?;
    let mut pbuf = [0u8; 192];
    let full = abs_path(path, &mut pbuf)?;
    check_writable(full)?;
    let (parent_path, name) = split_parent(full);
    ensure_home()?;
    let parent = resolve_dir(parent_path)?;
    if find(parent, name)?.is_some() {
        return Err("already exists");
    }
    let (short, nt) = to_short(name).ok_or("directory names must be 8.3")?;
    mkdir_in(parent, &short, nt)?;
    commit()
}

pub unsafe fn remove(path: &str) -> R<()> {
    require_mounted()?;
    let mut pbuf = [0u8; 192];
    let full = abs_path(path, &mut pbuf)?;
    check_writable(full)?;
    let (parent_path, name) = split_parent(full);
    let parent = resolve_dir(parent_path)?;
    let e = find(parent, name)?.ok_or("no such file or directory")?;
    if e.short[0] == b'.' {
        return Err("cannot remove . or ..");
    }
    if e.attr & ATTR_DIR != 0 {
        let not_empty = dir_walk(norm_dir(e.cluster), |c| c.short[0] != b'.')?;
        if not_empty {
            return Err("directory not empty");
        }
    }
    if valid_cluster(e.cluster) && norm_dir(e.cluster) != 0 {
        free_chain(e.cluster)?;
    }
    for i in 0..e.lfn_count {
        let (lba, off) = e.lfn_locs[i];
        mark_deleted(lba, off as usize)?;
    }
    mark_deleted(e.lba, e.off)?;
    commit()
}

/// Lists a directory (relative paths resolve inside /POSTCARD).
pub unsafe fn list(path: &str) -> R<()> {
    require_mounted()?;
    let mut pbuf = [0u8; 192];
    let full = if path.trim().is_empty() {
        if matches!(find(0, HOME_DIR)?, Some(e) if e.attr & ATTR_DIR != 0) { "/POSTCARD" } else { "/" }
    } else {
        abs_path(path, &mut pbuf)?
    };
    let dir = resolve_dir(full)?;
    kprintln_colored(0x0E, 0x00FFB81C, format_args!("Directory of {}", full));
    let mut files = 0u32;
    let mut dirs = 0u32;
    let mut bytes = 0u64;
    dir_walk(dir, |e| {
        let mut nb = [0u8; 128];
        let n = e.display(&mut nb);
        let name = core::str::from_utf8(&nb[..n]).unwrap_or("?");
        if e.attr & ATTR_DIR != 0 {
            if e.short[0] != b'.' {
                dirs += 1;
            }
            kprintln_colored(0x0B, 0x0038BDF8, format_args!("  <DIR>            {}/", name));
        } else {
            files += 1;
            bytes += e.size as u64;
            kprintln_colored(0x0F, 0x00F4F5F7, format_args!("  {:>10} bytes  {}", e.size, name));
        }
        false
    })?;
    kprintln_colored(0x0A, 0x0022C55E, format_args!("  {} file(s), {} dir(s), {} bytes", files, dirs, bytes));
    Ok(())
}

/// Prints a file's contents to the console. Returns its size.
pub unsafe fn cat(path: &str) -> R<u32> {
    require_mounted()?;
    let mut pbuf = [0u8; 192];
    let full = abs_path(path, &mut pbuf)?;
    let (parent_path, name) = split_parent(full);
    if name.is_empty() {
        return Err("is a directory");
    }
    let parent = resolve_dir(parent_path)?;
    let e = find(parent, name)?.ok_or("no such file or directory")?;
    if e.attr & ATTR_DIR != 0 {
        return Err("is a directory");
    }
    let mut remaining = e.size.min(MAX_CAT_BYTES);
    let mut c = e.cluster;
    let mut last = b'\n';
    let mut guard = 0u32;
    'outer: while remaining > 0 && valid_cluster(c) {
        for s in 0..VOL.spc as u64 {
            let mut sec = [0u8; SECTOR_SIZE];
            blockdev::read_sector(VOL.dev, cluster_lba(c) + s, &mut sec)?;
            let n = (remaining as usize).min(SECTOR_SIZE);
            for &b in &sec[..n] {
                let ch = match b {
                    b'\n' => b'\n',
                    b'\r' => continue,
                    b'\t' => b' ',
                    0x20..=0x7E => b,
                    _ => b'.',
                };
                console_putc(ch, 0x0F, 0x00F4F5F7);
                last = ch;
            }
            remaining -= n as u32;
            if remaining == 0 {
                break 'outer;
            }
        }
        c = fat_get(c)?;
        guard += 1;
        if guard > VOL.total_clusters {
            return Err("cluster chain loop");
        }
    }
    if last != b'\n' {
        console_putc(b'\n', 0x0F, 0x00F4F5F7);
    }
    if e.size > MAX_CAT_BYTES {
        kprintln_colored(0x0E, 0x00FFB81C, format_args!("[cat] output truncated at {} of {} bytes", MAX_CAT_BYTES, e.size));
    }
    Ok(e.size)
}

/// Counts free clusters by scanning the FAT (used when FSInfo is unknown).
unsafe fn count_free() -> R<u32> {
    let mut free = 0u32;
    for c in 2..(VOL.total_clusters + 2) {
        if fat_get(c)? == 0 {
            free += 1;
        }
    }
    Ok(free)
}

pub unsafe fn status() -> R<()> {
    require_mounted()?;
    if VOL.free_count == 0xFFFF_FFFF {
        VOL.free_count = count_free()?;
    }
    let dev = blockdev::device(VOL.dev).ok_or("device vanished")?;
    let p = PARTS[VOL.part].ok_or("partition vanished")?;
    let cluster_bytes = VOL.spc as u64 * SECTOR_SIZE as u64;
    let label = core::str::from_utf8(&VOL.label).unwrap_or("?").trim_end();
    kprintln_colored(
        0x0E,
        0x00FFB81C,
        format_args!("FAT{} volume \"{}\" on {} part {} ({} @ LBA {})", VOL.fat_bits, label, dev.name_str(), p.index, p.scheme, p.lba),
    );
    kprintln_colored(
        0x0F,
        0x00F4F5F7,
        format_args!(
            "  cluster={} B  clusters={}  free={} ({} MiB free of {} MiB)  FATs={}  home=/{}",
            cluster_bytes,
            VOL.total_clusters,
            VOL.free_count,
            VOL.free_count as u64 * cluster_bytes / (1024 * 1024),
            VOL.total_clusters as u64 * cluster_bytes / (1024 * 1024),
            VOL.num_fats,
            HOME_DIR
        ),
    );
    kprintln_colored(
        0x0F,
        0x00F4F5F7,
        format_args!("  device I/O: {} sector reads, {} sector writes (write-through + flush)", dev.reads, dev.writes),
    );
    Ok(())
}

/// Short summary for boot logs: (device name, partition index, label).
pub unsafe fn mounted_summary() -> Option<(&'static str, usize, &'static str)> {
    if !VOL.mounted {
        return None;
    }
    let dev = blockdev::device(VOL.dev)?;
    let p = PARTS[VOL.part].as_ref()?;
    let label = core::str::from_utf8(&VOL.label).unwrap_or("?").trim_end();
    Some((dev.name_str(), p.index, label))
}
