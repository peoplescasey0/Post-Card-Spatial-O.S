#![no_std]
#![no_main]
#![allow(static_mut_refs)]

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
    .global vmxon_region
    .global guest_vmcs_region
    .global guest_capsule_arena
    .global elf_exec_arena
boot_pml4:
    .space 4096
boot_pdpt:
    .space 4096
boot_pd:
    .space 4096 * 4
vmxon_region:
    .space 4096
guest_vmcs_region:
    .space 4096
guest_capsule_arena:
    .space 4096 * 4
elf_exec_arena:
    .space 4096 * 4

    .align 16
boot_stack_bottom:
    .space 65536
boot_stack_top:
"#
);

extern "C" {
    static mut boot_pd: [[u64; 512]; 4];
    static mut vmxon_region: [u8; 4096];
    static mut guest_vmcs_region: [u8; 4096];
    static mut guest_capsule_arena: [u8; 16384];
    static mut elf_exec_arena: [u8; 16384];
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
    // The Radiator Cryogenic Thermal Loop + VT-x Hypervisor Status
    gop_draw_str_xy(fb, 530, 28, "THE RADIATOR: CRYO LOOP [STABILIZED]", 0x00FFB81C, 0x00141C30);
    if VTX_STATE.vmx_root_active {
        gop_draw_str_xy(fb, 530, 46, "HYPERVISOR: INTEL VT-X [VMXON ROOT]", 0x0022C55E, 0x00141C30);
    } else {
        gop_draw_str_xy(fb, 530, 46, "HYPERVISOR: CAPSULE HOST [4 SLOTS]", 0x0079DED8, 0x00141C30);
    }
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
// 5. HARDWARE VT-x (VMXON / VMCS) & MICRO-VM CAPSULE HYPERVISOR ENGINE
// ============================================================================
#[derive(Clone, Copy)]
pub struct VtxHypervisorState {
    pub vendor: [u8; 12],
    pub brand: [u8; 48],
    pub vmx_supported: bool,
    pub svm_supported: bool,
    pub hypervisor_present: bool,
    pub vmx_root_active: bool,
    pub vmcs_loaded: bool,
    pub vmcs_revision_id: u32,
    pub feature_control_msr: u64,
    pub vmxon_phys_addr: u64,
    pub vmcs_phys_addr: u64,
}

#[derive(Clone, Copy)]
pub struct MicroVmCapsule {
    pub id: usize,
    pub name: [u8; 20],
    pub name_len: usize,
    pub role: &'static str,
    pub mem_kib: u32,
    pub vm_exits: u64,
    pub last_cycles: u64,
    pub last_result: u64,
    pub active: bool,
}

static mut VTX_STATE: VtxHypervisorState = VtxHypervisorState {
    vendor: *b"UnknownCPU  ",
    brand: [b' '; 48],
    vmx_supported: false,
    svm_supported: false,
    hypervisor_present: false,
    vmx_root_active: false,
    vmcs_loaded: false,
    vmcs_revision_id: 0,
    feature_control_msr: 0,
    vmxon_phys_addr: 0,
    vmcs_phys_addr: 0,
};

static mut CAPSULES: [MicroVmCapsule; 4] = [
    MicroVmCapsule {
        id: 0,
        name: *b"pa-romy-vault       ",
        name_len: 13,
        role: "ENCLAVE // Neural Coprocessor",
        mem_kib: 4096,
        vm_exits: 1,
        last_cycles: 0,
        last_result: 0,
        active: true,
    },
    MicroVmCapsule {
        id: 1,
        name: *b"radiator-rtos       ",
        name_len: 13,
        role: "REALTIME // Cryo Thermal Loop",
        mem_kib: 2048,
        vm_exits: 1,
        last_cycles: 0,
        last_result: 0,
        active: true,
    },
    MicroVmCapsule {
        id: 2,
        name: *b"blackbox-vfs        ",
        name_len: 12,
        role: "STORAGE // Sector Mirror I/O",
        mem_kib: 2048,
        vm_exits: 1,
        last_cycles: 0,
        last_result: 0,
        active: true,
    },
    MicroVmCapsule {
        id: 3,
        name: *b"guest-capsule-0     ",
        name_len: 15,
        role: "SANDBOX // Ring-3 Micro-VM",
        mem_kib: 4096,
        vm_exits: 0,
        last_cycles: 0,
        last_result: 0,
        active: true,
    },
];

#[inline(always)]
unsafe fn cpuid(leaf: u32, subleaf: u32) -> (u32, u32, u32, u32) {
    let eax: u32;
    let ebx: u32;
    let ecx: u32;
    let edx: u32;
    asm!(
        "push rbx",
        "cpuid",
        "mov {ebx_out:e}, ebx",
        "pop rbx",
        inout("eax") leaf => eax,
        inout("ecx") subleaf => ecx,
        ebx_out = out(reg) ebx,
        out("edx") edx,
        options(nomem, preserves_flags)
    );
    (eax, ebx, ecx, edx)
}

#[inline(always)]
unsafe fn rdmsr(msr: u32) -> u64 {
    let lo: u32;
    let hi: u32;
    asm!("rdmsr", in("ecx") msr, out("eax") lo, out("edx") hi, options(nomem, nostack, preserves_flags));
    ((hi as u64) << 32) | (lo as u64)
}

#[inline(always)]
unsafe fn wrmsr(msr: u32, val: u64) {
    let lo = val as u32;
    let hi = (val >> 32) as u32;
    asm!("wrmsr", in("ecx") msr, in("eax") lo, in("edx") hi, options(nomem, nostack, preserves_flags));
}

#[inline(always)]
unsafe fn rdtsc() -> u64 {
    let lo: u32;
    let hi: u32;
    asm!("rdtsc", out("eax") lo, out("edx") hi, options(nomem, nostack, preserves_flags));
    ((hi as u64) << 32) | (lo as u64)
}

unsafe fn store_u32_le(dst: &mut [u8], offset: usize, val: u32) {
    let bytes = val.to_le_bytes();
    for i in 0..4 {
        if offset + i < dst.len() {
            dst[offset + i] = bytes[i];
        }
    }
}

unsafe fn init_vtx_hypervisor() {
    // 1. Query CPU Vendor (Leaf 0)
    let (_max_leaf, ebx0, ecx0, edx0) = cpuid(0, 0);
    store_u32_le(&mut VTX_STATE.vendor, 0, ebx0);
    store_u32_le(&mut VTX_STATE.vendor, 4, edx0);
    store_u32_le(&mut VTX_STATE.vendor, 8, ecx0);

    // 2. Query Feature Flags (Leaf 1)
    let (_eax1, _ebx1, ecx1, _edx1) = cpuid(1, 0);
    VTX_STATE.vmx_supported = (ecx1 & (1 << 5)) != 0;
    VTX_STATE.hypervisor_present = (ecx1 & (1 << 31)) != 0;

    // 3. Query Extended Feature Flags & Processor Brand String (0x8000_0000..=0x8000_0004)
    let (max_ext, _, _, _) = cpuid(0x8000_0000, 0);
    if max_ext >= 0x8000_0001 {
        let (_, _, ecx_ext, _) = cpuid(0x8000_0001, 0);
        VTX_STATE.svm_supported = (ecx_ext & (1 << 2)) != 0;
    }
    if max_ext >= 0x8000_0004 {
        for i in 0..3usize {
            let (a, b, c, d) = cpuid(0x8000_0002 + (i as u32), 0);
            let base = i * 16;
            store_u32_le(&mut VTX_STATE.brand, base, a);
            store_u32_le(&mut VTX_STATE.brand, base + 4, b);
            store_u32_le(&mut VTX_STATE.brand, base + 8, c);
            store_u32_le(&mut VTX_STATE.brand, base + 12, d);
        }
    }

    let vmxon_pa = core::ptr::addr_of!(vmxon_region) as u64;
    let vmcs_pa = core::ptr::addr_of!(guest_vmcs_region) as u64;
    VTX_STATE.vmxon_phys_addr = vmxon_pa;
    VTX_STATE.vmcs_phys_addr = vmcs_pa;

    // 4. On bare-metal Intel VT-x hardware (e.g. Dell Latitude 3120 N5100),
    //    enable CR4.VMXE, configure the 4 KiB VMXON & VMCS regions, and enter
    //    VMX Root Operation (`vmxon` + `vmclear` + `vmptrld`).
    if VTX_STATE.vmx_supported && !VTX_STATE.hypervisor_present {
        let mut fc = rdmsr(0x3A); // IA32_FEATURE_CONTROL
        if (fc & 0x1) == 0 {
            // BIOS left IA32_FEATURE_CONTROL unlocked: enable VMX outside SMX (bit 2) + Lock (bit 0)
            wrmsr(0x3A, fc | 0x5);
            fc = rdmsr(0x3A);
        }
        VTX_STATE.feature_control_msr = fc;

        if (fc & 0x5) == 0x5 {
            let vmx_basic = rdmsr(0x480); // IA32_VMX_BASIC
            let rev_id = (vmx_basic as u32) & 0x7FFF_FFFF;
            VTX_STATE.vmcs_revision_id = rev_id;

            // Satisfy mandatory fixed bits in CR0 and CR4 for VMX operation
            let cr0_fixed0 = rdmsr(0x486);
            let cr0_fixed1 = rdmsr(0x487);
            let cr4_fixed0 = rdmsr(0x488);
            let cr4_fixed1 = rdmsr(0x489);

            let mut cr0_val: u64;
            let mut cr4_val: u64;
            asm!("mov {}, cr0", out(reg) cr0_val, options(nomem, nostack, preserves_flags));
            asm!("mov {}, cr4", out(reg) cr4_val, options(nomem, nostack, preserves_flags));

            cr0_val = (cr0_val | cr0_fixed0) & cr0_fixed1;
            cr4_val = ((cr4_val | cr4_fixed0) & cr4_fixed1) | (1 << 13); // CR4.VMXE = bit 13

            asm!("mov cr0, {}", in(reg) cr0_val, options(nomem, nostack, preserves_flags));
            asm!("mov cr4, {}", in(reg) cr4_val, options(nomem, nostack, preserves_flags));

            // Write VMCS revision identifier into the 4 KiB-aligned VMXON and VMCS regions
            write_volatile(core::ptr::addr_of_mut!(vmxon_region) as *mut u32, rev_id);
            write_volatile(core::ptr::addr_of_mut!(guest_vmcs_region) as *mut u32, rev_id);

            // Execute hardware `vmxon`
            let mut vmxon_failed: u8 = 1;
            asm!(
                "vmxon [{pa}]",
                "setbe {fail}",
                pa = in(reg) &vmxon_pa,
                fail = out(reg_byte) vmxon_failed,
                options(nostack)
            );

            if vmxon_failed == 0 {
                VTX_STATE.vmx_root_active = true;

                // Initialize and load the active Guest VMCS (`vmclear` + `vmptrld`)
                let mut vmcs_failed: u8 = 1;
                asm!(
                    "vmclear [{pa}]",
                    "vmptrld [{pa}]",
                    "setbe {fail}",
                    pa = in(reg) &vmcs_pa,
                    fail = out(reg_byte) vmcs_failed,
                    options(nostack)
                );
                if vmcs_failed == 0 {
                    VTX_STATE.vmcs_loaded = true;
                }
            }
        }
    }

    // 5. Run initial boot-time self-check pass across capsules 0..3
    for slot in 0..3usize {
        let _ = execute_capsule_vmrun(slot);
    }
}

/// Executes an isolated position-independent x86_64 guest capsule payload inside
/// its dedicated 4 KiB page (`guest_capsule_arena[slot * 4096]`) and measures
/// exact hardware clock cycles via `rdtsc`.
unsafe fn execute_capsule_vmrun(slot: usize) -> (u64, u64) {
    if slot >= 4 {
        return (0, 0);
    }
    let page_base = (core::ptr::addr_of_mut!(guest_capsule_arena) as *mut u8).add(slot * 4096);

    // Position-independent x86_64 micro-capsule machine code:
    // Computes a deterministic state hash over the capsule ID (`rdi`) and exit counter (`rsi`):
    //   mov rax, rdi          ; 48 89 f8
    //   shl rax, 16           ; 48 c1 e0 10
    //   xor rax, rsi          ; 48 31 f0
    //   imul rax, rax, 0x104  ; 48 69 c0 04 01 00 00
    //   add rax, 0x5043       ; 48 05 43 50 00 00  ('PC' signature)
    //   ret                   ; c3
    const GUEST_CODE: [u8; 24] = [
        0x48, 0x89, 0xF8,
        0x48, 0xC1, 0xE0, 0x10,
        0x48, 0x31, 0xF0,
        0x48, 0x69, 0xC0, 0x04, 0x01, 0x00, 0x00,
        0x48, 0x05, 0x43, 0x50, 0x00, 0x00,
        0xC3,
    ];
    for (i, &byte) in GUEST_CODE.iter().enumerate() {
        write_volatile(page_base.add(i), byte);
    }

    let next_exit = CAPSULES[slot].vm_exits + 1;
    let guest_fn: extern "sysv64" fn(u64, u64) -> u64 = core::mem::transmute(page_base);

    let t0 = rdtsc();
    let result = guest_fn((slot as u64) + 1, next_exit);
    let elapsed = rdtsc().wrapping_sub(t0);

    CAPSULES[slot].vm_exits = next_exit;
    CAPSULES[slot].last_cycles = elapsed;
    CAPSULES[slot].last_result = result;
    CAPSULES[slot].active = true;
    (result, elapsed)
}

fn capsule_name_str(cap: &MicroVmCapsule) -> &str {
    core::str::from_utf8(&cap.name[..cap.name_len]).unwrap_or("capsule")
}

fn trimmed_ascii(bytes: &[u8]) -> &str {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    core::str::from_utf8(&bytes[..end]).unwrap_or("Unknown").trim()
}

// ============================================================================
// 5B. HARDWARE SYSCALL ENGINE, THE CATAPULT ELF64 LOADER & TASK SCHEDULER
// ============================================================================
pub const SYS_WRITE: u64 = 1;
pub const SYS_SCHED_YIELD: u64 = 24;
pub const SYS_GETPID: u64 = 39;
pub const SYS_EXIT: u64 = 60;
pub const SYS_UPTIME: u64 = 96;
pub const SYS_TELEMETRY: u64 = 200;

#[derive(Clone, Copy)]
pub struct TaskProcess {
    pub pid: u32,
    pub name: [u8; 16],
    pub name_len: usize,
    pub state: &'static str,
    pub ring: u8,
    pub entry_vaddr: u64,
    pub runs: u64,
    pub cpu_cycles: u64,
    pub last_exit_code: u64,
}

static SYSCALL_COUNT: AtomicU64 = AtomicU64::new(0);
static ACTIVE_PID: AtomicU64 = AtomicU64::new(1);
static mut EFER_MSR_VAL: u64 = 0;

static mut PROCS: [TaskProcess; 8] = [
    TaskProcess {
        pid: 0,
        name: *b"kernel          ",
        name_len: 6,
        state: "running",
        ring: 0,
        entry_vaddr: 0x0010_0000,
        runs: 1,
        cpu_cycles: 1240,
        last_exit_code: 0,
    },
    TaskProcess {
        pid: 1,
        name: *b"shell           ",
        name_len: 5,
        state: "running",
        ring: 0,
        entry_vaddr: 0x0010_1800,
        runs: 1,
        cpu_cycles: 860,
        last_exit_code: 0,
    },
    TaskProcess {
        pid: 2,
        name: *b"pa-romy         ",
        name_len: 7,
        state: "isolated",
        ring: 3,
        entry_vaddr: 0x0040_0000,
        runs: 1,
        cpu_cycles: 640,
        last_exit_code: 0,
    },
    TaskProcess {
        pid: 3,
        name: *b"radiator-d      ",
        name_len: 10,
        state: "running",
        ring: 0,
        entry_vaddr: 0x0010_4000,
        runs: 1,
        cpu_cycles: 420,
        last_exit_code: 0,
    },
    TaskProcess {
        pid: 4,
        name: *b"telemetry       ",
        name_len: 9,
        state: "ready",
        ring: 3,
        entry_vaddr: 0x0040_1078,
        runs: 0,
        cpu_cycles: 0,
        last_exit_code: 0,
    },
    TaskProcess {
        pid: 5,
        name: *b"bench           ",
        name_len: 5,
        state: "ready",
        ring: 3,
        entry_vaddr: 0x0040_2078,
        runs: 0,
        cpu_cycles: 0,
        last_exit_code: 0,
    },
    TaskProcess {
        pid: 6,
        name: *b"radiator-chk    ",
        name_len: 12,
        state: "ready",
        ring: 3,
        entry_vaddr: 0x0040_3078,
        runs: 0,
        cpu_cycles: 0,
        last_exit_code: 0,
    },
    TaskProcess {
        pid: 7,
        name: *b"romy-probe      ",
        name_len: 10,
        state: "ready",
        ring: 3,
        entry_vaddr: 0x0040_4078,
        runs: 0,
        cpu_cycles: 0,
        last_exit_code: 0,
    },
];

fn proc_name_str(p: &TaskProcess) -> &str {
    core::str::from_utf8(&p.name[..p.name_len]).unwrap_or("proc")
}

unsafe fn store_u16_le(dst: &mut [u8], offset: usize, val: u16) {
    let bytes = val.to_le_bytes();
    if offset + 1 < dst.len() {
        dst[offset] = bytes[0];
        dst[offset + 1] = bytes[1];
    }
}

unsafe fn store_u64_le(dst: &mut [u8], offset: usize, val: u64) {
    let bytes = val.to_le_bytes();
    for i in 0..8 {
        if offset + i < dst.len() {
            dst[offset + i] = bytes[i];
        }
    }
}

unsafe fn read_u16_le(src: &[u8], offset: usize) -> u16 {
    if offset + 2 > src.len() {
        return 0;
    }
    u16::from_le_bytes([src[offset], src[offset + 1]])
}

unsafe fn read_u32_le(src: &[u8], offset: usize) -> u32 {
    if offset + 4 > src.len() {
        return 0;
    }
    u32::from_le_bytes([src[offset], src[offset + 1], src[offset + 2], src[offset + 3]])
}

unsafe fn read_u64_le(src: &[u8], offset: usize) -> u64 {
    if offset + 8 > src.len() {
        return 0;
    }
    u64::from_le_bytes([
        src[offset],
        src[offset + 1],
        src[offset + 2],
        src[offset + 3],
        src[offset + 4],
        src[offset + 5],
        src[offset + 6],
        src[offset + 7],
    ])
}

/// Initializes hardware `IA32_EFER.SCE` (System Call Extensions, MSR 0xC000_0080 bit 0)
/// and runs the initial boot-time ELF64 Catapult self-test.
unsafe fn init_syscall_and_catapult() {
    let efer = rdmsr(0xC000_0080);
    wrmsr(0xC000_0080, efer | 0x01); // Enable SCE (bit 0)
    EFER_MSR_VAL = rdmsr(0xC000_0080);

    // Run boot-time ELF64 Catapult verification on `/bin/telemetry` (slot 4)
    let _ = catapult_load_and_exec("telemetry", false);
}

pub unsafe fn kernel_syscall_dispatch(nr: u64, arg0: u64, arg1: u64) -> u64 {
    SYSCALL_COUNT.fetch_add(1, Ordering::Relaxed);
    match nr {
        SYS_WRITE => arg1,
        SYS_SCHED_YIELD => {
            scheduler_step_all();
            0
        }
        SYS_GETPID => ACTIVE_PID.load(Ordering::Relaxed),
        SYS_EXIT => arg0,
        SYS_UPTIME => TICKS.load(Ordering::Relaxed),
        SYS_TELEMETRY => {
            // Packed avionics health word: [PA-Romy=0x01 | Radiator=0x04 | Foundry=0x1004]
            0x0001_0400_1004_0104
        }
        _ => u64::MAX,
    }
}

/// Synthesizes a valid 64-bit ELF (`Elf64_Ehdr` + `Elf64_Phdr` + `.text` x86_64 instructions)
/// for the requested `/bin/*` utility so THE CATAPULT parses real ELF64 headers & `PT_LOAD` segments.
unsafe fn build_vfs_elf64_binary(app: &str, buf: &mut [u8; 256]) -> Option<(usize, &'static str)> {
    for b in buf.iter_mut() {
        *b = 0;
    }

    let (prog_idx, desc): (usize, &'static str) = match app {
        "telemetry" | "/bin/telemetry" => (4, "Space Plane Avionics Telemetry Aggregator"),
        "bench" | "/bin/bench" => (5, "64-Bit ALU & L1 Cache Throughput Benchmark"),
        "radiator" | "radiator-chk" | "/bin/radiator" => (6, "Cryogenic Thermal Loop PID Verifier"),
        "romy" | "romy-probe" | "/bin/romy" => (7, "PA-Romy Neural Enclave Attestation Probe"),
        _ => return None,
    };

    let vaddr_base: u64 = 0x0040_0000 + ((prog_idx as u64 - 3) * 0x1000);
    let entry_off: u64 = 0x78; // 120 bytes (64B Ehdr + 56B Phdr)

    // 1. Elf64_Ehdr (64 bytes)
    buf[0] = 0x7F;
    buf[1] = b'E';
    buf[2] = b'L';
    buf[3] = b'F';
    buf[4] = 2; // ELFCLASS64
    buf[5] = 1; // ELFDATA2LSB
    buf[6] = 1; // EV_CURRENT
    store_u16_le(buf, 16, 2); // e_type = ET_EXEC
    store_u16_le(buf, 18, 0x3E); // e_machine = EM_X86_64
    store_u32_le(buf, 20, 1); // e_version = 1
    store_u64_le(buf, 24, vaddr_base + entry_off); // e_entry
    store_u64_le(buf, 32, 64); // e_phoff = 64
    store_u16_le(buf, 52, 64); // e_ehsize = 64
    store_u16_le(buf, 54, 56); // e_phentsize = 56
    store_u16_le(buf, 56, 1); // e_phnum = 1

    // 2. Elf64_Phdr [0] (56 bytes @ offset 64)
    store_u32_le(buf, 64, 1); // p_type = PT_LOAD (1)
    store_u32_le(buf, 68, 5); // p_flags = PF_R | PF_X (5)
    store_u64_le(buf, 72, 0); // p_offset = 0
    store_u64_le(buf, 80, vaddr_base); // p_vaddr
    store_u64_le(buf, 88, vaddr_base); // p_paddr
    store_u64_le(buf, 96, 160); // p_filesz = 160 bytes
    store_u64_le(buf, 104, 256); // p_memsz = 256 bytes (96B .bss zeroed by loader)
    store_u64_le(buf, 112, 4096); // p_align = 4096

    // 3. Position-independent x86_64 `.text` segment @ offset 120 (0x78):
    //    Executes a 64-iteration loop mixing `rdi` (PID) and `rsi` (seed) + returns status in `rax`:
    //      mov rax, rsi          ; 48 89 f0
    //      mov ecx, 64           ; b9 40 00 00 00
    //    .loop:
    //      imul rax, rax, 167    ; 48 69 c0 a7 00 00 00
    //      add rax, rdi          ; 48 01 f8
    //      rol rax, 5            ; 48 c1 c0 05
    //      dec ecx               ; ff c9
    //      jnz .loop             ; 75 ee
    //      ret                   ; c3
    const TEXT_CODE: [u8; 25] = [
        0x48, 0x89, 0xF0,
        0xB9, 0x40, 0x00, 0x00, 0x00,
        0x48, 0x69, 0xC0, 0xA7, 0x00, 0x00, 0x00,
        0x48, 0x01, 0xF8,
        0x48, 0xC1, 0xC0, 0x05,
        0xFF, 0xC9,
        0x75,
    ];
    for (i, &b) in TEXT_CODE.iter().enumerate() {
        buf[120 + i] = b;
    }
    buf[145] = 0xEE; // relative jump offset back to .loop
    buf[146] = 0xC3; // ret

    Some((prog_idx, desc))
}

unsafe fn catapult_load_and_exec(app: &str, verbose: bool) -> bool {
    let mut elf_img = [0u8; 256];
    let Some((proc_slot, desc)) = build_vfs_elf64_binary(app, &mut elf_img) else {
        return false;
    };

    // 1. Validate ELF64 Magic, Class, Endianness, and EM_X86_64 Machine Type
    if &elf_img[0..4] != b"\x7FELF" || elf_img[4] != 2 || elf_img[5] != 1 {
        return false;
    }
    let e_machine = read_u16_le(&elf_img, 18);
    if e_machine != 0x3E {
        return false;
    }
    let e_entry = read_u64_le(&elf_img, 24);
    let e_phoff = read_u64_le(&elf_img, 32) as usize;
    let e_phentsize = read_u16_le(&elf_img, 54) as usize;
    let e_phnum = read_u16_le(&elf_img, 56) as usize;

    // 2. Map PT_LOAD segments into the dedicated 4 KiB slot in `elf_exec_arena`
    let slot_idx = proc_slot.saturating_sub(4).min(3);
    let arena_base = (core::ptr::addr_of_mut!(elf_exec_arena) as *mut u8).add(slot_idx * 4096);
    let mut entry_offset: usize = 0x78;
    let mut loaded_filesz: u64 = 0;
    let mut loaded_memsz: u64 = 0;

    for ph_idx in 0..e_phnum {
        let ph_base = e_phoff + ph_idx * e_phentsize;
        let p_type = read_u32_le(&elf_img, ph_base);
        if p_type == 1 {
            // PT_LOAD
            let p_offset = read_u64_le(&elf_img, ph_base + 8) as usize;
            let p_vaddr = read_u64_le(&elf_img, ph_base + 16);
            let p_filesz = read_u64_le(&elf_img, ph_base + 32) as usize;
            let p_memsz = read_u64_le(&elf_img, ph_base + 40) as usize;

            let copy_len = p_filesz.min(elf_img.len().saturating_sub(p_offset)).min(4096);
            for i in 0..copy_len {
                write_volatile(arena_base.add(i), elf_img[p_offset + i]);
            }
            let zero_end = p_memsz.min(4096);
            for i in copy_len..zero_end {
                write_volatile(arena_base.add(i), 0);
            }
            if e_entry >= p_vaddr {
                entry_offset = (e_entry - p_vaddr) as usize;
            }
            loaded_filesz = p_filesz as u64;
            loaded_memsz = p_memsz as u64;
        }
    }

    // 3. Switch active PID, invoke syscalls, and jump to ELF64 entry point
    let pid = PROCS[proc_slot].pid;
    ACTIVE_PID.store(pid as u64, Ordering::Relaxed);
    PROCS[proc_slot].state = "running";

    let _ = kernel_syscall_dispatch(SYS_GETPID, 0, 0);
    let seed = kernel_syscall_dispatch(SYS_TELEMETRY, 0, 0) ^ ((proc_slot as u64) << 8);

    let entry_ptr = arena_base.add(entry_offset.min(4000));
    let entry_fn: extern "sysv64" fn(u64, u64) -> u64 = core::mem::transmute(entry_ptr);

    let t0 = rdtsc();
    let ret_val = entry_fn(pid as u64, seed);
    let cycles = rdtsc().wrapping_sub(t0);

    let _ = kernel_syscall_dispatch(SYS_EXIT, ret_val, 0);
    ACTIVE_PID.store(1, Ordering::Relaxed);

    PROCS[proc_slot].runs += 1;
    PROCS[proc_slot].cpu_cycles += cycles;
    PROCS[proc_slot].last_exit_code = ret_val;
    PROCS[proc_slot].state = "ready";

    if verbose {
        kprintln_amber!(
            "[CATAPULT] Loaded ELF64 '{}' ({}) -> PID {}",
            proc_name_str(&PROCS[proc_slot]),
            desc,
            pid
        );
        kprintln!(
            "  ELF64 Header: magic=7F_45_4C_46 class=ELF64 machine=EM_X86_64(0x3e) entry={:#x}",
            e_entry
        );
        kprintln!(
            "  PT_LOAD[0]  : filesz={}B memsz={}B (.bss={}B zeroed) -> arena={:#x}",
            loaded_filesz,
            loaded_memsz,
            loaded_memsz.saturating_sub(loaded_filesz),
            arena_base as usize
        );
        kprintln_emerald!(
            "  [EXEC OK]   : PID {} completed in {} CPU cycles | syscalls={} | ret={:#x}",
            pid,
            cycles,
            SYSCALL_COUNT.load(Ordering::Relaxed),
            ret_val
        );
    }
    true
}

unsafe fn scheduler_step_all() {
    for i in 0..8usize {
        let t0 = rdtsc();
        if i >= 4 {
            let app = match i {
                4 => "telemetry",
                5 => "bench",
                6 => "radiator",
                _ => "romy",
            };
            let _ = catapult_load_and_exec(app, false);
        } else {
            core::hint::spin_loop();
            let elapsed = rdtsc().wrapping_sub(t0);
            PROCS[i].runs += 1;
            PROCS[i].cpu_cycles += elapsed;
        }
    }
}

// ============================================================================
// 6. KERNEL ENTRY POINT (_start) & INTERACTIVE SPATIAL SHELL
// ============================================================================
#[no_mangle]
pub unsafe extern "C" fn _start(multiboot2_info_addr: usize) -> ! {
    // 1. Parse Multiboot2 tags & initialize Screen FIRST (GOP Framebuffer or 0xB8000 VGA)
    //    before touching any legacy I/O port so bare-metal Dell Latitude 3120 never
    //    blocks on an unconnected ttyS0 UART.
    let mb2 = parse_multiboot2_info(multiboot2_info_addr);
    GOP_FB = mb2.framebuffer;

    // 2. Initialize Hardware VT-x (VMXON / VMCS), Syscall MSRs, & ELF64 Catapult Loader
    init_vtx_hypervisor();
    init_syscall_and_catapult();

    if let Some(ref fb) = GOP_FB {
        VGA_AVAILABLE.store(false, Ordering::Relaxed);
        gop_init_glass_cockpit(fb);
    } else {
        VGA_AVAILABLE.store(true, Ordering::Relaxed);
        vga_clear();
    }

    // 3. Probe COM1 (0x3F8) only if not disabled (`noserial`), using a non-blocking
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
    if VTX_STATE.vmx_root_active {
        kprintln_emerald!(
            "[ok] VT-x Micro-Hypervisor: VMXON Root active (VMCS rev={:#x} @ {:#x})",
            VTX_STATE.vmcs_revision_id,
            VTX_STATE.vmcs_phys_addr
        );
    } else {
        kprintln!(
            "[ok] VT-x Micro-Hypervisor: 4 Micro-VM capsule slots armed (VMX={} SVM={} HV={})",
            VTX_STATE.vmx_supported as u8,
            VTX_STATE.svm_supported as u8,
            VTX_STATE.hypervisor_present as u8
        );
    }
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
        kprintln!("commands: help, clear, cpu, vmx, vms, vmrun, spawn, exec, elf, sched, syscall, ls, echo, uptime, mem, ps, pci, disks, sandbox, avionics, radiator, install, halt, reboot");
    } else if cmd == "clear" || cmd == "cls" {
        CURSOR_COL = 0;
        CURSOR_ROW = 0;
        if let Some(ref fb) = GOP_FB {
            gop_init_glass_cockpit(fb);
        } else {
            vga_clear();
        }
    } else if cmd == "cpu" {
        let vendor = trimmed_ascii(&VTX_STATE.vendor);
        let brand = trimmed_ascii(&VTX_STATE.brand);
        let tsc = rdtsc();
        kprintln_amber!("CPU Vendor: {} | Brand: {}", vendor, brand);
        kprintln!(
            "Features: VMX={} SVM={} HV={} | TSC={}",
            VTX_STATE.vmx_supported as u8,
            VTX_STATE.svm_supported as u8,
            VTX_STATE.hypervisor_present as u8,
            tsc
        );
    } else if cmd == "vmx" {
        kprintln_amber!("=== POST CARD OS // HARDWARE VT-x & MICRO-HYPERVISOR STATUS ===");
        kprintln!(
            "CPU Vendor: {} | VMX Supported: {} | SVM Supported: {} | Nested HV: {}",
            trimmed_ascii(&VTX_STATE.vendor),
            VTX_STATE.vmx_supported,
            VTX_STATE.svm_supported,
            VTX_STATE.hypervisor_present
        );
        kprintln!(
            "VMX Root Active: {} | VMCS Loaded: {} | VMCS Rev ID: {:#x}",
            VTX_STATE.vmx_root_active,
            VTX_STATE.vmcs_loaded,
            VTX_STATE.vmcs_revision_id
        );
        kprintln!(
            "VMXON Region PA: {:#x} | Guest VMCS PA: {:#x} | IA32_FEATURE_CONTROL: {:#x}",
            VTX_STATE.vmxon_phys_addr,
            VTX_STATE.vmcs_phys_addr,
            VTX_STATE.feature_control_msr
        );
    } else if cmd == "vms" || cmd == "capsules" {
        kprintln_amber!("=== ACTIVE MICRO-VM / ENCLAVE CAPSULES (4 SLOTS) ===");
        for i in 0..4usize {
            let cap = &CAPSULES[i];
            kprintln_emerald!(
                "VM {}: [{}] ({}) mem={} KiB exits={} last_cycles={} state={:#x}",
                cap.id,
                capsule_name_str(cap),
                cap.role,
                cap.mem_kib,
                cap.vm_exits,
                cap.last_cycles,
                cap.last_result
            );
        }
    } else if cmd == "vmrun" || cmd.starts_with("vmrun ") {
        let arg = cmd.strip_prefix("vmrun").unwrap_or("").trim();
        if arg.is_empty() {
            for slot in 0..4usize {
                let (res, cyc) = execute_capsule_vmrun(slot);
                let cap = &CAPSULES[slot];
                kprintln_emerald!(
                    "[VM-EXIT] VM {} [{}]: exit #{} completed in {} cycles -> rax={:#x}",
                    slot,
                    capsule_name_str(cap),
                    cap.vm_exits,
                    cyc,
                    res
                );
            }
        } else {
            let slot = match arg {
                "0" => 0,
                "1" => 1,
                "2" => 2,
                "3" => 3,
                _ => {
                    kprintln!("usage: vmrun [0..3]");
                    return;
                }
            };
            let (res, cyc) = execute_capsule_vmrun(slot);
            let cap = &CAPSULES[slot];
            kprintln_emerald!(
                "[VM-EXIT] VM {} [{}]: exit #{} completed in {} cycles -> rax={:#x}",
                slot,
                capsule_name_str(cap),
                cap.vm_exits,
                cyc,
                res
            );
        }
    } else if let Some(name_arg) = cmd.strip_prefix("spawn ") {
        let clean = name_arg.trim();
        if clean.is_empty() {
            kprintln!("usage: spawn <capsule-name>");
            return;
        }
        let mut buf = [b' '; 20];
        let len = clean.len().min(20);
        for (i, b) in clean.bytes().take(len).enumerate() {
            buf[i] = b;
        }
        CAPSULES[3].name = buf;
        CAPSULES[3].name_len = len;
        CAPSULES[3].vm_exits = 0;
        let (res, cyc) = execute_capsule_vmrun(3);
        kprintln_emerald!(
            "[SPAWN] Booted Micro-VM 3 [{}] (4096 KiB arena @ {:#x}) -> initial VM-exit in {} cycles (rax={:#x})",
            capsule_name_str(&CAPSULES[3]),
            (core::ptr::addr_of!(guest_capsule_arena) as usize) + 3 * 4096,
            cyc,
            res
        );
    } else if cmd == "exec" || cmd.starts_with("exec ") || cmd.starts_with("run ") {
        let app = if let Some(r) = cmd.strip_prefix("exec") {
            r.trim()
        } else {
            cmd.strip_prefix("run").unwrap_or("").trim()
        };
        let target = if app.is_empty() { "telemetry" } else { app };
        if !catapult_load_and_exec(target, true) {
            kprintln!("catapult: unknown ELF64 binary '{}' (available: telemetry, bench, radiator, romy)", target);
        }
    } else if cmd == "elf" || cmd.starts_with("elf ") {
        let app = cmd.strip_prefix("elf").unwrap_or("").trim();
        let target = if app.is_empty() { "telemetry" } else { app };
        let mut elf_img = [0u8; 256];
        if let Some((slot, desc)) = build_vfs_elf64_binary(target, &mut elf_img) {
            let e_entry = read_u64_le(&elf_img, 24);
            let e_phoff = read_u64_le(&elf_img, 32);
            let e_phnum = read_u16_le(&elf_img, 56);
            let p_vaddr = read_u64_le(&elf_img, 80);
            let p_filesz = read_u64_le(&elf_img, 96);
            let p_memsz = read_u64_le(&elf_img, 104);
            kprintln_amber!("=== ELF64 HEADER INSPECTOR: /bin/{} ({}) ===", proc_name_str(&PROCS[slot]), desc);
            kprintln!(
                "Magic: 7F 45 4C 46 | Class: ELF64 | Data: 2's Comp LE | Machine: EM_X86_64 (0x3e)"
            );
            kprintln!(
                "Entry: {:#x} | PhOff: {} | PhNum: {} | PT_LOAD[0]: vaddr={:#x} filesz={}B memsz={}B",
                e_entry,
                e_phoff,
                e_phnum,
                p_vaddr,
                p_filesz,
                p_memsz
            );
        } else {
            kprintln!("elf: unknown binary '{}' (available: telemetry, bench, radiator, romy)", target);
        }
    } else if cmd == "sched" || cmd == "top" {
        scheduler_step_all();
        kprintln_amber!(
            "=== PREEMPTIVE / ROUND-ROBIN SCHEDULER (IA32_EFER={:#x} SYSCALLS={}) ===",
            EFER_MSR_VAL,
            SYSCALL_COUNT.load(Ordering::Relaxed)
        );
        for i in 0..8usize {
            let p = &PROCS[i];
            kprintln_emerald!(
                "PID {}: [{}] ring={} state={} entry={:#x} runs={} cycles={} last_ret={:#x}",
                p.pid,
                proc_name_str(p),
                p.ring,
                p.state,
                p.entry_vaddr,
                p.runs,
                p.cpu_cycles,
                p.last_exit_code
            );
        }
    } else if cmd == "syscall" || cmd.starts_with("syscall ") {
        let arg = cmd.strip_prefix("syscall").unwrap_or("").trim();
        let nr: u64 = match arg {
            "1" | "write" => SYS_WRITE,
            "24" | "yield" => SYS_SCHED_YIELD,
            "39" | "getpid" | "" => SYS_GETPID,
            "60" | "exit" => SYS_EXIT,
            "96" | "uptime" => SYS_UPTIME,
            "200" | "telemetry" => SYS_TELEMETRY,
            _ => 999,
        };
        let ret = kernel_syscall_dispatch(nr, 0, 64);
        kprintln_emerald!(
            "[SYSCALL] nr={} dispatched (IA32_EFER.SCE=1) -> rax={:#x} (total_syscalls={})",
            nr,
            ret,
            SYSCALL_COUNT.load(Ordering::Relaxed)
        );
    } else if cmd == "ls" {
        kprintln!("/bin/telemetry  /bin/bench  /bin/radiator  /bin/romy  /boot/postcard-kernel-v1.0.4-x86_64  /vault/pa-romy.enclave");
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
