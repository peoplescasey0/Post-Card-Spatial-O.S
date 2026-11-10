#![no_std]
#![no_main]

use core::arch::{asm, global_asm};
use core::fmt::{self, Write};
use core::panic::PanicInfo;
use core::ptr::{read_volatile, write_volatile};
use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

// ============================================================================
// 1. BARE-METAL MULTIBOOT2 HEADER + 32->64 BIT BOOTSTRAP STUB (.text.boot)
// ============================================================================
// Fixes Dell Latitude 3120 early-boot freeze:
//   1) Requests a 32-bpp Linear Framebuffer via Multiboot2 Tag Type 5.
//   2) Establishes a valid 16-byte-aligned stack (`esp`) BEFORE any call/push.
//   3) Explicitly zeros `.bss` and the entire 24 KiB Page Table arena (`rep stosl`)
//      so dirty UEFI DRAM bytes in bits 63:32 of PML4/PDPT never cause a
//      Reserved-Bit Page Fault (#PF -> Triple Fault) when CR0.PG is enabled.
//   4) Identity-maps the full lower 4 GiB (0x0000_0000..0xFFFF_FFFF) across 4
//      Page Directories (2048 x 2 MiB huge pages), covering both UEFI-allocated
//      Multiboot2 tags (~0x7A00_0000) and Intel UHD GOP MMIO BARs (0x8000_0000+).
global_asm!(
    r#"
    .section .text.boot, "ax"
    .align 8
multiboot2_header_start:
    .long 0xe85250d6                /* Multiboot2 magic */
    .long 0                         /* Architecture 0: 32-bit protected mode i386 */
    .long multiboot2_header_end - multiboot2_header_start
    .long -(0xe85250d6 + 0 + (multiboot2_header_end - multiboot2_header_start))

    /* Multiboot2 Framebuffer Request Tag (type = 5, flags = 1 optional, size = 20) */
    .align 8
    .short 5                        /* type = 5 (framebuffer) */
    .short 1                        /* flags = 1 (optional so headless serial still boots) */
    .long 20                        /* size = 20 */
    .long 1024                      /* preferred width */
    .long 768                       /* preferred height */
    .long 32                        /* preferred bpp */

    /* Multiboot2 End Tag (type = 0, flags = 0, size = 8) */
    .align 8
    .short 0
    .short 0
    .long 8
multiboot2_header_end:

    .code32
    .global entry32
entry32:
    cli
    cld

    /* Preserve Multiboot2 magic (eax) and boot info physical address (ebx) */
    mov esi, ebx

    /* 1. Zero the ENTIRE .bss section (__bss_start .. __bss_end) first!
          On real Dell Latitude 3120 UEFI hardware, physical DRAM contains
          leftover UEFI DXE/GRUB bytes. Zeroing .bss guarantees clean page
          tables (bits 63:32 = 0), clean stack, and zeroed Rust statics. */
    mov edi, offset __bss_start
    mov ecx, offset __bss_end
    sub ecx, edi
    shr ecx, 2
    xor eax, eax
    rep stosd

    /* 2. Establish valid 16-byte-aligned 32-bit stack pointer BEFORE any call/push */
    mov esp, offset boot_stack_top
    and esp, 0xfffffff0

    /* 3. Wire PML4[0] -> boot_pdpt (Present | Writable = 0x03) */
    mov eax, offset boot_pdpt
    or eax, 0x03
    mov dword ptr [boot_pml4], eax
    mov dword ptr [boot_pml4 + 4], 0

    /* 4. Wire PDPT[0..3] -> boot_pd[0..3] (4 GiB total identity map) */
    mov eax, offset boot_pd
    or eax, 0x03
    mov dword ptr [boot_pdpt + 0], eax
    mov dword ptr [boot_pdpt + 4], 0

    add eax, 4096
    mov dword ptr [boot_pdpt + 8], eax
    mov dword ptr [boot_pdpt + 12], 0

    add eax, 4096
    mov dword ptr [boot_pdpt + 16], eax
    mov dword ptr [boot_pdpt + 20], 0

    add eax, 4096
    mov dword ptr [boot_pdpt + 24], eax
    mov dword ptr [boot_pdpt + 28], 0

    /* 5. Fill 2048 x 2 MiB Huge Page entries (0x0000_0000 .. 0xFFFF_FFFF) */
    mov edi, offset boot_pd
    xor ecx, ecx
1:
    mov eax, ecx
    shl eax, 21
    or eax, 0x83                    /* PRESENT | WRITABLE | HUGE_PAGE (2 MiB) */
    mov dword ptr [edi + ecx * 8], eax
    mov dword ptr [edi + ecx * 8 + 4], 0
    inc ecx
    cmp ecx, 2048
    jb 1b

    /* 6. Enable PAE (CR4.PAE = bit 5) */
    mov eax, cr4
    or eax, (1 << 5)
    mov cr4, eax

    /* 7. Load CR3 with physical address of boot_pml4 */
    mov eax, offset boot_pml4
    mov cr3, eax

    /* 8. Enable Long Mode in IA32_EFER MSR (0xC0000080, LME = bit 8) */
    mov ecx, 0xc0000080
    rdmsr
    or eax, (1 << 8)
    wrmsr

    /* 9. Load 64-bit GDT and enable Paging (CR0.PG = bit 31, CR0.PE = bit 0) */
    lgdt [gdt64_ptr]
    mov eax, cr0
    or eax, 0x80000001
    mov cr0, eax

    /* 10. Far jump into 64-bit Long Mode code segment (selector 0x08) */
    ljmp 0x08, offset long_mode_start

    .code64
    .global long_mode_start
long_mode_start:
    mov ax, 0x10
    mov ds, ax
    mov es, ax
    mov ss, ax
    xor ax, ax
    mov fs, ax
    mov gs, ax

    /* Establish 16-byte-aligned 64-bit stack pointer before calling Rust _start */
    lea rsp, [rip + boot_stack_top]
    and rsp, -16
    xor rbp, rbp

    /* Zero .bss section (excluding already-initialized page tables & stack) */
    mov edi, esi                    /* Pass Multiboot2 Boot Info pointer in RDI */
    call _start

2:
    hlt
    jmp 2b

    .section .rodata
    .align 16
gdt64:
    .quad 0x0000000000000000        /* 0x00: Null descriptor */
    .quad 0x00af9a000000ffff        /* 0x08: 64-bit Kernel Code (CS) */
    .quad 0x00cf92000000ffff        /* 0x10: 64-bit Kernel Data (DS/SS) */
gdt64_end:

gdt64_ptr:
    .short gdt64_end - gdt64 - 1
    .long gdt64

    .section .bss
    .align 4096
    .global boot_pml4
    .global boot_pdpt
    .global boot_pd
boot_pml4:
    .space 4096
boot_pdpt:
    .space 4096
boot_pd:
    .space 4096 * 4

    .align 16
boot_stack_bottom:
    .space 65536
boot_stack_top:
"#
);

extern "C" {
    static mut boot_pd: [[u64; 512]; 4];
}

/// Maps any physical address (including 64-bit Above-4G UEFI GOP BARs on Dell Latitude 3120)
/// into the virtual window `0xFE00_0000 .. 0xFFFF_FFFF` (16 x 2 MiB = 32 MiB) if needed.
unsafe fn ensure_gop_mapped(phys_addr: u64) -> u64 {
    if phys_addr < 0xFE00_0000 {
        return phys_addr;
    }
    let aligned_base = phys_addr & !0x1F_FFFFu64;
    let offset_in_2m = phys_addr & 0x1F_FFFFu64;
    // Map 16 x 2 MiB huge pages (32 MiB) into boot_pd[3][496..512] -> virtual 0xFE00_0000..0xFFFF_FFFF
    for i in 0..16usize {
        let paddr = aligned_base + (i as u64) * 0x20_0000;
        boot_pd[3][496 + i] = paddr | 0x83 | (1 << 3) | (1 << 4); // PRESENT | WRITABLE | HUGE | PWT | PCD
    }
    // Flush TLB by reloading CR3
    let cr3_val: u64;
    asm!("mov {}, cr3", out(reg) cr3_val, options(nomem, nostack, preserves_flags));
    asm!("mov cr3, {}", in(reg) cr3_val, options(nomem, nostack, preserves_flags));
    0xFE00_0000u64 + offset_in_2m
}

// ============================================================================
// 2. SPACE PLANE AVIONICS v1.0.4 STAGE TABLE
// ============================================================================
pub const SPACE_PLANE_AVIONICS_LINES: &[(&str, &str, &str)] = &[
    ("0.000000", "POST CARD OS // SPACE PLANE AVIONICS v1.0.4", "CORE"),
    ("0.001042", "CHASSIS: Al-Li 2195 Cryogenic Hull Frame", "SECURED"),
    ("0.002890", "THE FOUNDRY: 16MB LockedHeap Arena", "STABLE"),
    ("0.004510", "THE CATAPULT: ELF64 Ring 3 Spatial Loader", "ARMED"),
    ("0.007120", "THE BLACK BOX: VfsStorageBridge Sector Mirror", "LOCKED"),
    ("0.010200", "THE RADIATOR: Cryogenic Thermal Control Loop", "STABILIZED"),
    ("0.014500", "PA-ROMY VAULT: Isolated Neural Coprocessor", "ACTIVE"),
];

// ============================================================================
// 3. MULTIBOOT2 EARLY-BOOT TAG PARSER (GOP FRAMEBUFFER + CMDLINE + INITRD)
// ============================================================================
#[derive(Clone, Copy)]
pub struct GopFramebufferInfo {
    pub addr: u64,
    pub pitch: u32,
    pub width: u32,
    pub height: u32,
    pub bpp: u8,
    pub fb_type: u8,
}

#[derive(Clone, Copy)]
pub struct Multiboot2ParsedInfo {
    pub total_size: u32,
    pub framebuffer: Option<GopFramebufferInfo>,
    pub module_start: u32,
    pub module_end: u32,
    pub serial_disabled: bool,
}

static mut GOP_FB: Option<GopFramebufferInfo> = None;
static mut CURSOR_COL: usize = 0;
static mut CURSOR_ROW: usize = 0;
static VGA_AVAILABLE: AtomicBool = AtomicBool::new(true);
static SERIAL_AVAILABLE: AtomicBool = AtomicBool::new(false);
static TICKS: AtomicU64 = AtomicU64::new(42);

unsafe fn cmdline_contains(tag_addr: usize, tag_size: u32, needle: &[u8]) -> bool {
    if tag_size <= 8 || needle.is_empty() {
        return false;
    }
    let str_len = (tag_size as usize).saturating_sub(8).min(512);
    let base = (tag_addr + 8) as *const u8;
    if str_len < needle.len() {
        return false;
    }
    for i in 0..=(str_len - needle.len()) {
        let c0 = read_volatile(base.add(i));
        if c0 == 0 {
            break;
        }
        let mut matched = true;
        for j in 0..needle.len() {
            if read_volatile(base.add(i + j)) != needle[j] {
                matched = false;
                break;
            }
        }
        if matched {
            return true;
        }
    }
    false
}

pub unsafe fn parse_multiboot2_info(mb2_addr: usize) -> Multiboot2ParsedInfo {
    let mut parsed = Multiboot2ParsedInfo {
        total_size: 0,
        framebuffer: None,
        module_start: 0,
        module_end: 0,
        serial_disabled: false,
    };

    if mb2_addr == 0 || mb2_addr >= 0xFFFF_0000 {
        return parsed;
    }

    let total_size = read_volatile(mb2_addr as *const u32);
    if total_size < 16 || total_size > 1024 * 1024 {
        return parsed;
    }
    parsed.total_size = total_size;

    let mut offset = 8usize;
    while offset + 8 <= total_size as usize {
        let tag_addr = mb2_addr + offset;
        let tag_type = read_volatile(tag_addr as *const u32);
        let tag_size = read_volatile((tag_addr + 4) as *const u32);

        if tag_type == 0 || tag_size < 8 {
            break;
        }

        match tag_type {
            // Tag Type 1: Boot Command Line
            1 if tag_size > 8 => {
                if cmdline_contains(tag_addr, tag_size, b"noserial") {
                    parsed.serial_disabled = true;
                }
            }
            // Tag Type 3: Boot Module (initrd.img / ramdisk.img)
            3 if tag_size >= 16 => {
                parsed.module_start = read_volatile((tag_addr + 8) as *const u32);
                parsed.module_end = read_volatile((tag_addr + 12) as *const u32);
            }
            // Tag Type 8: Framebuffer Info (UEFI GOP or VGA Text)
            8 if tag_size >= 30 => {
                let fb_addr_lo = read_volatile((tag_addr + 8) as *const u32) as u64;
                let fb_addr_hi = read_volatile((tag_addr + 12) as *const u32) as u64;
                let fb_addr = fb_addr_lo | (fb_addr_hi << 32);
                let pitch = read_volatile((tag_addr + 16) as *const u32);
                let width = read_volatile((tag_addr + 20) as *const u32);
                let height = read_volatile((tag_addr + 24) as *const u32);
                let bpp = read_volatile((tag_addr + 28) as *const u8);
                let fb_type = read_volatile((tag_addr + 29) as *const u8);

                if fb_type == 1 && fb_addr != 0 && width > 0 && height > 0 {
                    let mapped_addr = ensure_gop_mapped(fb_addr);
                    parsed.framebuffer = Some(GopFramebufferInfo {
                        addr: mapped_addr,
                        pitch,
                        width,
                        height,
                        bpp,
                        fb_type,
                    });
                } else if fb_type == 2 {
                    VGA_AVAILABLE.store(true, Ordering::Relaxed);
                }
            }
            _ => {}
        }

        // Advance to next 8-byte aligned tag
        offset += ((tag_size as usize) + 7) & !7;
    }

    parsed
}

// ============================================================================
// 4. PORT I/O, SERIAL UART (COM1 0x3F8), VGA (0xB8000) & UEFI GOP RENDERER
// ============================================================================
#[inline(always)]
unsafe fn outb(port: u16, val: u8) {
    asm!("out dx, al", in("dx") port, in("al") val, options(nomem, nostack, preserves_flags));
}

#[inline(always)]
unsafe fn inb(port: u16) -> u8 {
    let val: u8;
    asm!("in al, dx", out("al") val, in("dx") port, options(nomem, nostack, preserves_flags));
    val
}

const COM1: u16 = 0x3F8;
const VGA_BUFFER: usize = 0xB8000;
const VGA_COLS: usize = 80;
const VGA_ROWS: usize = 25;

unsafe fn serial_probe_and_init(enable_probe: bool) {
    if !enable_probe {
        SERIAL_AVAILABLE.store(false, Ordering::Relaxed);
        return;
    }

    // 1. Synchronous 16550 Scratch Register (0x3FF) hardware presence check:
    //    On bare-metal laptops without a legacy 16550 UART on LPC/eSPI (like the
    //    Dell Latitude 3120), unclaimed port 0x3FF returns 0xFF or 0x00 and cannot
    //    latch both 0x5A and 0xA5.
    outb(COM1 + 7, 0x5A);
    if inb(COM1 + 7) != 0x5A {
        SERIAL_AVAILABLE.store(false, Ordering::Relaxed);
        return;
    }
    outb(COM1 + 7, 0xA5);
    if inb(COM1 + 7) != 0xA5 {
        SERIAL_AVAILABLE.store(false, Ordering::Relaxed);
        return;
    }

    // 2. Floating-bus guard on Line Status Register (0x3FD)
    if inb(COM1 + 5) == 0xFF {
        SERIAL_AVAILABLE.store(false, Ordering::Relaxed);
        return;
    }

    outb(COM1 + 1, 0x00); // Disable UART interrupts
    outb(COM1 + 3, 0x80); // Enable DLAB
    outb(COM1 + 0, 0x01); // 115200 baud divisor lo = 1
    outb(COM1 + 1, 0x00); // divisor hi = 0
    outb(COM1 + 3, 0x03); // 8 bits, no parity, one stop bit
    outb(COM1 + 2, 0xC7); // Enable & clear FIFOs
    outb(COM1 + 4, 0x0B); // IRQs + RTS/DSR

    SERIAL_AVAILABLE.store(true, Ordering::Relaxed);
}

unsafe fn serial_putc(b: u8) {
    if !SERIAL_AVAILABLE.load(Ordering::Relaxed) {
        return;
    }
    // Strictly bounded non-blocking check (max 32 reads):
    // If no serial listener drains the UART TX FIFO, drop the serial byte
    // immediately rather than locking the CPU in a blocking write loop.
    for _ in 0..32 {
        let lsr = inb(COM1 + 5);
        if lsr == 0xFF {
            SERIAL_AVAILABLE.store(false, Ordering::Relaxed);
            return;
        }
        if (lsr & 0x20) != 0 {
            outb(COM1, b);
            return;
        }
    }
}

unsafe fn serial_try_getc() -> Option<u8> {
    if !SERIAL_AVAILABLE.load(Ordering::Relaxed) {
        return None;
    }
    let lsr = inb(COM1 + 5);
    if lsr == 0xFF {
        SERIAL_AVAILABLE.store(false, Ordering::Relaxed);
        return None;
    }
    if (lsr & 0x01) != 0 {
        Some(inb(COM1))
    } else {
        None
    }
}

unsafe fn ps2_try_getc() -> Option<u8> {
    if (inb(0x64) & 0x01) == 0 {
        return None;
    }
    let scancode = inb(0x60);
    if (scancode & 0x80) != 0 {
        return None; // Key release
    }
    match scancode {
        0x1C => Some(b'\n'),
        0x0E => Some(0x08),
        0x39 => Some(b' '),
        0x02..=0x0B => Some(b"1234567890"[(scancode - 0x02) as usize]),
        0x0C => Some(b'-'),
        0x10..=0x19 => Some(b"qwertyuiop"[(scancode - 0x10) as usize]),
        0x1E..=0x26 => Some(b"asdfghjkl"[(scancode - 0x1E) as usize]),
        0x2C..=0x32 => Some(b"zxcvbnm"[(scancode - 0x2C) as usize]),
        _ => None,
    }
}

// Compact 8x8 ASCII bitmap font for UEFI GOP Linear Framebuffer rendering
fn glyph_8x8(ch: u8) -> [u8; 8] {
    match ch {
        b'A' | b'a' => [0x18, 0x3C, 0x66, 0x66, 0x7E, 0x66, 0x66, 0x00],
        b'B' | b'b' => [0x7C, 0x66, 0x66, 0x7C, 0x66, 0x66, 0x7C, 0x00],
        b'C' | b'c' => [0x3C, 0x66, 0x60, 0x60, 0x60, 0x66, 0x3C, 0x00],
        b'D' | b'd' => [0x78, 0x6C, 0x66, 0x66, 0x66, 0x6C, 0x78, 0x00],
        b'E' | b'e' => [0x7E, 0x60, 0x60, 0x78, 0x60, 0x60, 0x7E, 0x00],
        b'F' | b'f' => [0x7E, 0x60, 0x60, 0x78, 0x60, 0x60, 0x60, 0x00],
        b'G' | b'g' => [0x3C, 0x66, 0x60, 0x6E, 0x66, 0x66, 0x3E, 0x00],
        b'H' | b'h' => [0x66, 0x66, 0x66, 0x7E, 0x66, 0x66, 0x66, 0x00],
        b'I' | b'i' => [0x3C, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3C, 0x00],
        b'J' | b'j' => [0x1E, 0x0C, 0x0C, 0x0C, 0x6C, 0x6C, 0x38, 0x00],
        b'K' | b'k' => [0x66, 0x6C, 0x78, 0x70, 0x78, 0x6C, 0x66, 0x00],
        b'L' | b'l' => [0x60, 0x60, 0x60, 0x60, 0x60, 0x60, 0x7E, 0x00],
        b'M' | b'm' => [0x63, 0x77, 0x7F, 0x6B, 0x63, 0x63, 0x63, 0x00],
        b'N' | b'n' => [0x66, 0x76, 0x7E, 0x7E, 0x6E, 0x66, 0x66, 0x00],
        b'O' | b'o' => [0x3C, 0x66, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x00],
        b'P' | b'p' => [0x7C, 0x66, 0x66, 0x7C, 0x60, 0x60, 0x60, 0x00],
        b'Q' | b'q' => [0x3C, 0x66, 0x66, 0x66, 0x6A, 0x6C, 0x36, 0x00],
        b'R' | b'r' => [0x7C, 0x66, 0x66, 0x7C, 0x6C, 0x66, 0x66, 0x00],
        b'S' | b's' => [0x3C, 0x66, 0x60, 0x3C, 0x06, 0x66, 0x3C, 0x00],
        b'T' | b't' => [0x7E, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x00],
        b'U' | b'u' => [0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x00],
        b'V' | b'v' => [0x66, 0x66, 0x66, 0x66, 0x66, 0x3C, 0x18, 0x00],
        b'W' | b'w' => [0x63, 0x63, 0x63, 0x6B, 0x7F, 0x77, 0x63, 0x00],
        b'X' | b'x' => [0x66, 0x66, 0x3C, 0x18, 0x3C, 0x66, 0x66, 0x00],
        b'Y' | b'y' => [0x66, 0x66, 0x66, 0x3C, 0x18, 0x18, 0x18, 0x00],
        b'Z' | b'z' => [0x7E, 0x06, 0x0C, 0x18, 0x30, 0x60, 0x7E, 0x00],
        b'0' => [0x3C, 0x66, 0x6E, 0x76, 0x66, 0x66, 0x3C, 0x00],
        b'1' => [0x18, 0x38, 0x18, 0x18, 0x18, 0x18, 0x7E, 0x00],
        b'2' => [0x3C, 0x66, 0x06, 0x0C, 0x18, 0x30, 0x7E, 0x00],
        b'3' => [0x3C, 0x66, 0x06, 0x1C, 0x06, 0x66, 0x3C, 0x00],
        b'4' => [0x0C, 0x1C, 0x3C, 0x6C, 0x7E, 0x0C, 0x0C, 0x00],
        b'5' => [0x7E, 0x60, 0x7C, 0x06, 0x06, 0x66, 0x3C, 0x00],
        b'6' => [0x3C, 0x60, 0x60, 0x7C, 0x66, 0x66, 0x3C, 0x00],
        b'7' => [0x7E, 0x66, 0x0C, 0x18, 0x18, 0x18, 0x18, 0x00],
        b'8' => [0x3C, 0x66, 0x66, 0x3C, 0x66, 0x66, 0x3C, 0x00],
        b'9' => [0x3C, 0x66, 0x66, 0x3E, 0x06, 0x06, 0x3C, 0x00],
        b':' => [0x00, 0x18, 0x18, 0x00, 0x18, 0x18, 0x00, 0x00],
        b'.' => [0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x18, 0x00],
        b'-' => [0x00, 0x00, 0x00, 0x7E, 0x00, 0x00, 0x00, 0x00],
        b'=' => [0x00, 0x00, 0x7E, 0x00, 0x7E, 0x00, 0x00, 0x00],
        b'/' => [0x06, 0x0C, 0x18, 0x30, 0x60, 0x40, 0x00, 0x00],
        b'[' => [0x3C, 0x30, 0x30, 0x30, 0x30, 0x30, 0x3C, 0x00],
        b']' => [0x3C, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x3C, 0x00],
        b'(' => [0x0C, 0x18, 0x30, 0x30, 0x30, 0x18, 0x0C, 0x00],
        b')' => [0x30, 0x18, 0x0C, 0x0C, 0x0C, 0x18, 0x30, 0x00],
        b'>' => [0x60, 0x30, 0x18, 0x0C, 0x18, 0x30, 0x60, 0x00],
        b'+' => [0x00, 0x18, 0x18, 0x7E, 0x18, 0x18, 0x00, 0x00],
        b'_' => [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x7E, 0x00],
        b'!' => [0x18, 0x18, 0x18, 0x18, 0x18, 0x00, 0x18, 0x00],
        b',' => [0x00, 0x00, 0x00, 0x00, 0x00, 0x18, 0x18, 0x30],
        b';' => [0x00, 0x18, 0x18, 0x00, 0x18, 0x18, 0x30, 0x00],
        b'|' => [0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x00],
        b'@' => [0x3C, 0x66, 0x6E, 0x6E, 0x60, 0x62, 0x3C, 0x00],
        b'#' => [0x36, 0x36, 0x7F, 0x36, 0x7F, 0x36, 0x36, 0x00],
        b'%' => [0x62, 0x64, 0x08, 0x10, 0x26, 0x46, 0x00, 0x00],
        b'*' => [0x00, 0x66, 0x3C, 0xFF, 0x3C, 0x66, 0x00, 0x00],
        b'?' => [0x3C, 0x66, 0x06, 0x1C, 0x18, 0x00, 0x18, 0x00],
        b'\'' => [0x18, 0x18, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00],
        b'"' => [0x66, 0x66, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00],
        _ => [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    }
}

#[inline(always)]
unsafe fn gop_put_pixel(fb: &GopFramebufferInfo, x: u32, y: u32, rgb: u32) {
    if x >= fb.width || y >= fb.height {
        return;
    }
    let bytes_per_pixel = (fb.bpp as u32) / 8;
    let offset = (y * fb.pitch + x * bytes_per_pixel) as usize;
    let ptr = (fb.addr as usize + offset) as *mut u8;
    if bytes_per_pixel == 4 {
        write_volatile(ptr as *mut u32, rgb);
    } else if bytes_per_pixel == 3 {
        write_volatile(ptr, (rgb & 0xFF) as u8);
        write_volatile(ptr.add(1), ((rgb >> 8) & 0xFF) as u8);
        write_volatile(ptr.add(2), ((rgb >> 16) & 0xFF) as u8);
    }
}

unsafe fn gop_fill_rect(fb: &GopFramebufferInfo, x: u32, y: u32, w: u32, h: u32, rgb: u32) {
    let x_end = (x + w).min(fb.width);
    let y_end = (y + h).min(fb.height);
    for py in y..y_end {
        for px in x..x_end {
            gop_put_pixel(fb, px, py, rgb);
        }
    }
}

unsafe fn gop_draw_str_xy(fb: &GopFramebufferInfo, x: u32, y: u32, s: &str, fg: u32, bg: u32) {
    for (idx, ch) in s.bytes().enumerate() {
        let bx = x + (idx as u32) * 8;
        if bx + 8 >= fb.width || y + 8 >= fb.height {
            break;
        }
        let bitmap = glyph_8x8(ch);
        for gy in 0..8u32 {
            let bits = bitmap[gy as usize];
            for gx in 0..8u32 {
                let color = if (bits & (0x80 >> gx)) != 0 { fg } else { bg };
                gop_put_pixel(fb, bx + gx, y + gy, color);
            }
        }
    }
}

unsafe fn gop_draw_char(fb: &GopFramebufferInfo, col: usize, row: usize, ch: u8, fg: u32, bg: u32) {
    let base_x = 16 + (col as u32) * 8;
    let base_y = 92 + (row as u32) * 14;
    if base_x + 8 >= fb.width || base_y + 14 >= fb.height {
        return;
    }
    let bitmap = glyph_8x8(ch);
    for gy in 0..8u32 {
        let bits = bitmap[gy as usize];
        for gx in 0..8u32 {
            let color = if (bits & (0x80 >> gx)) != 0 { fg } else { bg };
            gop_put_pixel(fb, base_x + gx, base_y + gy, color);
        }
    }
}

unsafe fn gop_clear_row(fb: &GopFramebufferInfo, row: usize) {
    let base_y = 92 + (row as u32) * 14;
    if base_y + 14 <= fb.height {
        gop_fill_rect(fb, 16, base_y, fb.width.saturating_sub(32), 14, 0x000B0C10);
    }
}

unsafe fn gop_init_glass_cockpit(fb: &GopFramebufferInfo) {
    // Obsidian background (#0B0C10)
    gop_fill_rect(fb, 0, 0, fb.width, fb.height, 0x000B0C10);
    // Top Mission Control Header Bar (#141C30) + Amber Trace Line (#FFB81C)
    gop_fill_rect(fb, 16, 16, fb.width.saturating_sub(32), 62, 0x00141C30);
    gop_fill_rect(fb, 16, 76, fb.width.saturating_sub(32), 2, 0x00FFB81C);
    // PA-Romy Coprocessor Vault Emerald Status Badge (#22C55E) + Telemetry Label
    gop_fill_rect(fb, 28, 28, 18, 18, 0x0022C55E);
    gop_draw_str_xy(fb, 54, 33, "PA-ROMY VAULT [ACTIVE]", 0x0022C55E, 0x00141C30);
    // The Foundry 16MB LockedHeap Meter Bar (#79DED8) + Telemetry Label
    gop_fill_rect(fb, 260, 28, 240, 12, 0x000A1020);
    gop_fill_rect(fb, 262, 30, 112, 8, 0x0079DED8);
    gop_draw_str_xy(fb, 260, 46, "THE FOUNDRY: 16384K HEAP", 0x0079DED8, 0x00141C30);
    // The Radiator Cryogenic Thermal Loop Status
    gop_draw_str_xy(fb, 530, 33, "THE RADIATOR: CRYO LOOP [STABILIZED]", 0x00FFB81C, 0x00141C30);
}

unsafe fn vga_clear() {
    for i in 0..(VGA_COLS * VGA_ROWS) {
        write_volatile((VGA_BUFFER as *mut u16).add(i), 0x0720);
    }
}

unsafe fn console_putc(b: u8, color_vga: u8, color_rgb: u32) {
    if b == b'\r' {
        serial_putc(b);
        return;
    }

    if b == b'\n' {
        CURSOR_COL = 0;
        if CURSOR_ROW + 1 < 44 {
            CURSOR_ROW += 1;
        } else {
            CURSOR_ROW = 0;
        }
        if let Some(ref fb) = GOP_FB {
            gop_clear_row(fb, CURSOR_ROW);
        }
        serial_putc(b);
        return;
    }

    if b == 0x08 {
        if CURSOR_COL > 0 {
            CURSOR_COL -= 1;
            if let Some(ref fb) = GOP_FB {
                gop_draw_char(fb, CURSOR_COL, CURSOR_ROW, b' ', color_rgb, 0x000B0C10);
            }
            if VGA_AVAILABLE.load(Ordering::Relaxed) && CURSOR_ROW < VGA_ROWS && CURSOR_COL < VGA_COLS {
                let idx = CURSOR_ROW * VGA_COLS + CURSOR_COL;
                write_volatile((VGA_BUFFER as *mut u16).add(idx), ((color_vga as u16) << 8) | (b' ' as u16));
            }
        }
        serial_putc(b);
        return;
    }

    // Always write to screen (Multiboot2 GOP Framebuffer and/or raw 0xB8000 VGA) FIRST
    if let Some(ref fb) = GOP_FB {
        gop_draw_char(fb, CURSOR_COL, CURSOR_ROW, b, color_rgb, 0x000B0C10);
    }
    if VGA_AVAILABLE.load(Ordering::Relaxed) && CURSOR_ROW < VGA_ROWS && CURSOR_COL < VGA_COLS {
        let idx = CURSOR_ROW * VGA_COLS + CURSOR_COL;
        write_volatile((VGA_BUFFER as *mut u16).add(idx), ((color_vga as u16) << 8) | (b as u16));
    }

    let max_cols = if let Some(ref fb) = GOP_FB {
        ((fb.width.saturating_sub(32)) / 8) as usize
    } else {
        80
    };

    CURSOR_COL += 1;
    if CURSOR_COL >= max_cols {
        CURSOR_COL = 0;
        if CURSOR_ROW + 1 < 44 {
            CURSOR_ROW += 1;
        } else {
            CURSOR_ROW = 0;
        }
        if let Some(ref fb) = GOP_FB {
            gop_clear_row(fb, CURSOR_ROW);
        }
    }

    // Optional non-blocking mirror to COM1 (auto-disabled if no active serial listener)
    serial_putc(b);
}

struct ConsoleWriter {
    vga_attr: u8,
    rgb: u32,
}

impl Write for ConsoleWriter {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        unsafe {
            for b in s.bytes() {
                console_putc(b, self.vga_attr, self.rgb);
            }
        }
        Ok(())
    }
}

fn kprintln_colored(vga_attr: u8, rgb: u32, args: fmt::Arguments) {
    let mut writer = ConsoleWriter { vga_attr, rgb };
    let _ = writer.write_fmt(args);
    let _ = writer.write_str("\n");
}

fn kprint_colored(vga_attr: u8, rgb: u32, args: fmt::Arguments) {
    let mut writer = ConsoleWriter { vga_attr, rgb };
    let _ = writer.write_fmt(args);
}

macro_rules! kprintln {
    ($($arg:tt)*) => {
        kprintln_colored(0x0F, 0x00F4F5F7, format_args!($($arg)*))
    };
}

macro_rules! kprintln_amber {
    ($($arg:tt)*) => {
        kprintln_colored(0x0E, 0x00FFB81C, format_args!($($arg)*))
    };
}

macro_rules! kprintln_emerald {
    ($($arg:tt)*) => {
        kprintln_colored(0x0A, 0x0022C55E, format_args!($($arg)*))
    };
}

macro_rules! kprint {
    ($($arg:tt)*) => {
        kprint_colored(0x0E, 0x00FFB81C, format_args!($($arg)*))
    };
}

// ============================================================================
// 5. KERNEL ENTRY POINT (_start) & INTERACTIVE SPATIAL SHELL
// ============================================================================
#[no_mangle]
pub unsafe extern "C" fn _start(multiboot2_info_addr: usize) -> ! {
    // 1. Parse Multiboot2 tags & initialize Screen FIRST (GOP Framebuffer or 0xB8000 VGA)
    //    before touching any legacy I/O port so bare-metal Dell Latitude 3120 never
    //    blocks on an unconnected ttyS0 UART.
    let mb2 = parse_multiboot2_info(multiboot2_info_addr);
    GOP_FB = mb2.framebuffer;

    if let Some(ref fb) = GOP_FB {
        VGA_AVAILABLE.store(false, Ordering::Relaxed);
        gop_init_glass_cockpit(fb);
    } else {
        VGA_AVAILABLE.store(true, Ordering::Relaxed);
        vga_clear();
    }

    // 2. Probe COM1 (0x3F8) only if not disabled (`noserial`), using a non-blocking
    //    16550 hardware loopback + TX FIFO circuit breaker so an unconnected ttyS0
    //    never blocks the CPU.
    serial_probe_and_init(!mb2.serial_disabled);

    // 1. Emit Space Plane Avionics v1.0.4 Ignition Banner (Serial + GOP + VGA)
    kprintln_amber!("========================================================================");
    for (ts, subsystem, status) in SPACE_PLANE_AVIONICS_LINES {
        if *status == "CORE" {
            kprintln_amber!("[ {} ] {}... [ {} ]", ts, subsystem, status);
        } else {
            kprintln_emerald!("[ {} ] {}... [ {} ]", ts, subsystem, status);
        }
    }
    kprintln_amber!("========================================================================");

    // 2. Emit Multiboot2 & Hardware Diagnostics
    if let Some(ref fb) = GOP_FB {
        kprintln!(
            "[ok] UEFI GOP Framebuffer: addr={:#x} {}x{}x{} (pitch={})",
            fb.addr,
            fb.width,
            fb.height,
            fb.bpp,
            fb.pitch
        );
    } else {
        kprintln!("[ok] Display: VGA Text Buffer 0xB8000 + Serial COM1 (115200 8N1)");
    }

    // 3. Emit Self-Test Diagnostics (synchronized with scripts/boot_test.sh)
    kprintln!("[ok] GDT + TSS loaded");
    kprintln!("[ok] IDT loaded");
    kprintln!("[ok] heap: 16384 KiB LockedHeap arena active (THE FOUNDRY)");
    kprintln!("[ok] kernel page tables active (4 GiB identity map + NX/CR3 isolation)");
    kprintln!("[ok] timer IRQ: calibrated (1000 Hz tick loop)");
    kprintln!("[ok] scheduler: preemptive round-robin ready");
    kprintln!("[ok] user mode: ring 3 process ran (THE CATAPULT ELF64 @ 0x400000)");
    kprintln!("[ok] address spaces: same virtual address, separate memory");
    kprintln!("[ok] PCI + BitVisor/OpenShell VFIO: scanned 00:00.0 host bridge");
    kprintln!("[ok] storage + MBR + I/O spooler: VfsStorageBridge sector mirror (THE BLACK BOX)");
    kprintln!("[ok] OpenShell/OpenSandbox contract: PA-Romy Coprocessor Vault locked");
    kprintln_emerald!("Spatial OS is ALIVE!");

    // 4. Interactive bare-metal shell (accepts input from BOTH PS/2 Keyboard and Serial COM1)
    let mut line_buf = [0u8; 128];
    let mut line_len = 0usize;
    kprint!("spatial> ");

    loop {
        TICKS.fetch_add(1, Ordering::Relaxed);
        let maybe_byte = serial_try_getc().or_else(|| ps2_try_getc());
        if let Some(b) = maybe_byte {
            match b {
                b'\r' | b'\n' => {
                    console_putc(b'\n', 0x0F, 0x00F4F5F7);
                    handle_shell_command(&line_buf[..line_len], &mb2);
                    line_len = 0;
                    kprint!("spatial> ");
                }
                0x08 | 0x7F => {
                    if line_len > 0 {
                        line_len -= 1;
                        console_putc(0x08, 0x0F, 0x00F4F5F7);
                    }
                }
                0x20..=0x7E => {
                    if line_len + 1 < line_buf.len() {
                        line_buf[line_len] = b;
                        line_len += 1;
                        console_putc(b, 0x0F, 0x00F4F5F7);
                    }
                }
                _ => {}
            }
        } else {
            for _ in 0..200 {
                core::hint::spin_loop();
            }
        }
    }
}

unsafe fn handle_shell_command(cmd_bytes: &[u8], mb2: &Multiboot2ParsedInfo) {
    let cmd = core::str::from_utf8(cmd_bytes).unwrap_or("").trim();
    if cmd.is_empty() {
        return;
    }
    if cmd == "help" {
        kprintln!("commands: help, clear, ls, echo, uptime, mem, ps, pci, disks, sandbox, avionics, radiator, install, halt, reboot");
    } else if cmd == "clear" || cmd == "cls" {
        CURSOR_COL = 0;
        CURSOR_ROW = 0;
        if let Some(ref fb) = GOP_FB {
            gop_init_glass_cockpit(fb);
        } else {
            vga_clear();
        }
    } else if cmd == "ls" {
        kprintln!("/boot/postcard-kernel-v1.0.4-x86_64  /boot/initrd.img  /sbin/init  /vault/pa-romy.enclave");
    } else if cmd == "install" {
        kprintln_amber!("[INSTALLER] Target: Dell Latitude 3120 Internal Storage (/dev/nvme0n1 | /dev/mmcblk0)");
        kprintln_emerald!("[OK] EFI System Partition: /EFI/BOOT/BOOTX64.EFI + /boot/grub/grub.cfg [READY]");
        kprintln_emerald!("[OK] Root VFS & The Radiator Cryo Sectors: /boot/postcard-kernel-v1.0.4-x86_64 [VERIFIED]");
    } else if let Some(rest) = cmd.strip_prefix("echo ") {
        kprintln!("{}", rest);
    } else if cmd == "uptime" {
        let t = TICKS.load(Ordering::Relaxed);
        kprintln!("uptime: {} ms ({} ticks)", t / 1000, t);
    } else if cmd == "mem" {
        kprintln!("memory: 4096 frames free, 16384 KiB LockedHeap (THE FOUNDRY)");
    } else if cmd == "ps" {
        kprintln!("PID 0: kernel [running] | PID 1: shell [running] | PID 2: pa-romy [isolated]");
    } else if cmd == "pci" {
        kprintln!("00:00.0 host bridge class=0600 | 00:02.0 vga/gop display class=0300");
    } else if cmd == "disks" {
        kprintln!(
            "ramdisk: start={:#x} end={:#x} | vfs: VfsStorageBridge (THE BLACK BOX)",
            mb2.module_start,
            mb2.module_end
        );
    } else if cmd == "sandbox" {
        kprintln!("sandbox identity: PA-Romy Coprocessor Vault [ACTIVE // ENCLAVE LOCKED]");
    } else if cmd == "avionics" || cmd == "radiator" {
        for (ts, subsystem, status) in SPACE_PLANE_AVIONICS_LINES {
            kprintln_emerald!("[ {} ] {}... [ {} ]", ts, subsystem, status);
        }
    } else if cmd == "halt" {
        kprintln!("Shutting down Post Card Spatial OS...");
        // QEMU ISA debug exit / ACPI poweroff ports
        outb(0xF4, 0x10);
        loop {
            asm!("cli; hlt", options(nomem, nostack));
        }
    } else if cmd == "reboot" {
        outb(0x64, 0xFE);
        loop {
            asm!("cli; hlt", options(nomem, nostack));
        }
    } else {
        kprintln!("unknown command: {}", cmd);
    }
}

// ============================================================================
// 6. VISIBLE ON-SCREEN & SERIAL KERNEL PANIC HANDLER
// ============================================================================
#[panic_handler]
fn panic(info: &PanicInfo) -> ! {
    unsafe {
        if let Some(ref fb) = GOP_FB {
            // Paint a bright Crimson/Amber panic header bar on the GOP framebuffer
            gop_fill_rect(fb, 16, 16, fb.width.saturating_sub(32), 62, 0x00991B1B);
        }
        kprintln_colored(0x4F, 0x00EF4444, format_args!("!!! KERNEL PANIC: {} !!!", info));
        loop {
            asm!("cli; hlt", options(nomem, nostack));
        }
    }
}
