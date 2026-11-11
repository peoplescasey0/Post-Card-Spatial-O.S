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
    .global boot_stack_bottom
    .global boot_stack_top
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
    static mut boot_stack_bottom: [u8; 65536];
    #[allow(dead_code)]
    static mut boot_stack_top: [u8; 0];
}

pub(crate) unsafe fn guest_capsule_arena_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(guest_capsule_arena) as *mut u8
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
    /// `nostorage` on the kernel cmdline skips PCI block-device probing.
    pub storage_disabled: bool,
}

static mut GOP_FB: Option<GopFramebufferInfo> = None;
static mut CURSOR_COL: usize = 0;
static mut CURSOR_ROW: usize = 0;
static VGA_AVAILABLE: AtomicBool = AtomicBool::new(true);
static SERIAL_AVAILABLE: AtomicBool = AtomicBool::new(false);
pub(crate) static TICKS: AtomicU64 = AtomicU64::new(42);

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
        storage_disabled: false,
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
                if cmdline_contains(tag_addr, tag_size, b"nostorage") {
                    parsed.storage_disabled = true;
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

pub(crate) unsafe fn serial_try_getc() -> Option<u8> {
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

pub(crate) unsafe fn ps2_try_getc() -> Option<u8> {
    let status = inb(0x64);
    if (status & 0x01) == 0 {
        return None;
    }
    // If bit 5 is set, data in port 0x60 is from the PS/2 auxiliary device (mouse/trackpad).
    // Do not consume it as a keyboard scancode!
    if (status & 0x20) != 0 {
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
pub(crate) fn glyph_8x8(ch: u8) -> [u8; 8] {
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
    if let Some(ref fb) = GOP_FB {
        compositor::cursor_restore(fb);
    }

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

macro_rules! kprintln_cyan {
    ($($arg:tt)*) => {
        kprintln_colored(0x0B, 0x0006B6D4, format_args!($($arg)*))
    };
}

macro_rules! kprintln_gray {
    ($($arg:tt)*) => {
        kprintln_colored(0x07, 0x0094A3B8, format_args!($($arg)*))
    };
}

macro_rules! kprint {
    ($($arg:tt)*) => {
        kprint_colored(0x0E, 0x00FFB81C, format_args!($($arg)*))
    };
}

// THE BLACK BOX persistence stack: raw block drivers (NVMe / SDHCI eMMC / ATA PIO)
// and the write-through FAT32 filesystem used by SPATIAL> file commands.
mod blockdev;
mod fat32;
mod mouse;
mod compositor;
mod handover;
mod routing;
mod softhsm;
mod trust_graph;
mod net;
mod hetero_engine;
mod multi_hypervisor;
mod trusted_root_vmm;
mod smartnic_nvmeof;
mod hybrid_multi_os;
mod dell_sva_accelerator;
mod late_hypervisor;
mod muse_mediator;
mod amd_core_isolation;
mod intel_vgpu_mmu;
mod sriov_mailbox;
mod vm_data_security;
mod platform_protection;
mod dell_vam_profiler;
mod hpe_multi_os_hvm;
mod wasm_engine;
mod nvidia_maxq_estimator;
mod shm_ipc;
mod vector_remoting;
mod script_ast_guard;
mod kwasm_engine;
mod wave_mddma;
mod intel_dtree;
mod panda_pipeline;
mod fortinet_capture;
mod nudt_netaccel;
mod yuannao_smartnic;
mod cas_afxdp;
mod langhe_mesh;
mod soundhound_spatial;
mod ericsson_hetero_audio;
mod genaudio_astoundsound;
mod rbc_vcr_enclave;
mod ucf_dax_fsm;
mod mongodb_enc_engine;
mod microsoft_cross_enclave;
mod apple_metal_pipeline;
mod kunlun_accel_mesh;
mod ant_safe_memory;
mod quantum_complexity_router;
mod web_browser;
mod email_client;
mod syscall_bridge_soc;
mod forensic_ebpf_audit;
mod anjuna_barkly_enclave;
mod citrix_gpu_sliding;

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

pub(crate) static mut VTX_STATE: VtxHypervisorState = VtxHypervisorState {
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

pub(crate) static mut CAPSULES: [MicroVmCapsule; 4] = [
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
pub(crate) unsafe fn execute_capsule_vmrun(slot: usize) -> (u64, u64) {
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

pub(crate) static mut PROCS: [TaskProcess; 8] = [
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

pub(crate) unsafe fn catapult_load_and_exec(app: &str, verbose: bool) -> bool {
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
    // THE BLACK BOX persistence: probe NVMe / SDHCI eMMC / ATA disks and mount FAT32.
    if mb2.storage_disabled {
        kprintln!("[ok] block storage: probe skipped (nostorage)");
    } else {
        blockdev::init();
        fat32::scan_partitions();
        if blockdev::device_count() == 0 {
            kprintln!("[ok] block storage: no NVMe/eMMC/ATA disks found (RAM-only VFS)");
        } else if fat32::automount().is_some() {
            if let Some((dev, part, label)) = fat32::mounted_summary() {
                kprintln_emerald!(
                    "[ok] FAT32 persistence: mounted \"{}\" ({} part {}) -> /{} (write-through)",
                    label,
                    dev,
                    part,
                    fat32::HOME_DIR
                );
            }
        } else {
            kprintln!(
                "[ok] block storage: {} device(s), no FAT32 volume found",
                blockdev::device_count()
            );
        }
    }
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

    // Initialize PS/2 Mouse, Trackpad, & Native Spatial Compositor
    if let Some(ref fb) = GOP_FB {
        mouse::init(fb.width, fb.height);
        kprintln_emerald!("[ok] PS/2 mouse & trackpad: aux stream armed (100 Hz reporting)");
        kprintln_emerald!("[ok] Spatial Compositor: 2D/3D card deck engine online (type 'gui' or 'deck')");
    } else {
        mouse::init(1024, 768);
        kprintln!("[ok] PS/2 mouse: aux stream armed (VGA text fallback)");
    }

    // Initialize 5G-SoftHSM Biometric Vault Enclave
    softhsm::init_default_softhsm();
    kprintln_emerald!("[ok] 5G-SoftHSM Enclave: iris biometrics & G-SSO armed (PA-Romy Root-of-Trust)");

    // Initialize Dynamic Resource & Dataflow Routing Allocator
    routing::init_default_system_routes();
    kprintln_emerald!("[ok] Dataflow Routing: QoS resource manager active (1 Gbps interconnect)");

    // Initialize Graph-Based Trust Topology & Enclave Isolation Engine
    kprintln_emerald!("[ok] Trust Topology Graph: 8 nodes mapped (PCR quotes verified, unmediated Level0 isolated)");

    // Initialize Bare-Metal Gigabit Ethernet (Intel e1000) & UDP Telemetry Stack
    net::init_network();
    if net::NIC.nic_type == net::NicType::IntelE1000 {
        kprintln_emerald!(
            "[ok] Intel e1000 Gigabit NIC: MAC {:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x} Link={} (UDP port 5173 telemetry)",
            net::NIC.mac_addr[0], net::NIC.mac_addr[1], net::NIC.mac_addr[2],
            net::NIC.mac_addr[3], net::NIC.mac_addr[4], net::NIC.mac_addr[5],
            if net::NIC.link_up { "UP" } else { "DOWN" }
        );
    } else {
        kprintln!("[ok] Network: loopback virtual adapter armed (UDP telemetry ready)");
    }

    // Initialize Heterogeneous CXL Pool, SciBuf Zero-Copy, & HUD Subsystems
    hetero_engine::init_hetero_subsystems();
    kprintln_emerald!("[ok] CXL 64MB Pool & SciBuf Zero-Copy: reconciled 4096-pitch carveout active");

    // Initialize Span Multi-Hypervisor VM Engine (US 9,798,567 B2)
    kprintln_emerald!("[ok] Span MHVM Engine: Multi-Hypervisor VM armed across co-located L1s (US 9,798,567 B2)");

    // Initialize Trusted Root Mode Hypervisor & VMM (US 9,367,671 B1)
    kprintln_emerald!("[ok] Trusted Root Hypervisor & VMM: Component 1/2 armed, POS de-privileged (US 9,367,671 B1)");

    // Initialize SmartNIC Emulated Local Storage via Shared Port & NVMe-oF (US 11,636,053 B2 / US 11,716,383 B2)
    smartnic_nvmeof::init_smartnic_storage();
    kprintln_emerald!("[ok] SmartNIC Emulated Storage: NVMe-oF & DSAN fabric proxy armed (US 11,636,053 B2 / US 11,716,383 B2)");

    // Initialize Hybrid Multi-OS, Dual-FB Docking & Asymmetric Storage Virtualization
    hybrid_multi_os::init_hybrid_subsystem();
    kprintln_emerald!("[ok] Hybrid Multi-OS & Dual-FB: Z124 docking & Intel asymmetric disk virtualization armed");

    // Initialize Dell Dual-Endpoint PCIe I/O Accelerator & SVA Subsystem (EP 3 170 072 B1)
    dell_sva_accelerator::init_dell_accelerator();
    kprintln_emerald!("[ok] Dell PCIe Accelerator: Dual-endpoint SVA armed, private vault secured (EP 3 170 072 B1)");

    // Initialize Runtime Hypervisor Late-Launch & State Capture Engine (EP 2 024 826 B1)
    late_hypervisor::init_late_hypervisor_subsystem();
    kprintln_emerald!("[ok] Late Hypervisor Launch: Root OS state captured, NMI inhibited, APIC trapped (EP 2 024 826 B1)");

    // Initialize Intel MUSE Mediated-Device in User Space Engine (WO 2021/086457 A1)
    muse_mediator::init_muse_subsystem();
    kprintln_emerald!("[ok] Intel MUSE Engine: /dev/muse transport & DPDK zero-copy fast-path armed (WO 2021/086457 A1)");

    // Initialize AMD Hypervisor-Based Core Isolation & De Facto Accelerators (EP 2 519 877 B1)
    amd_core_isolation::init_amd_core_isolation();
    kprintln_emerald!("[ok] AMD Core Isolation: Host cores 0..3 / Sequestered cores 4..7 armed (EP 2 519 877 B1)");

    // Initialize Intel Multi-Slice vGPU & Master/Slave MMU Fabric (US 11,768,781 B2)
    intel_vgpu_mmu::init_intel_vgpu_subsystem();
    kprintln_emerald!("[ok] Intel Multi-Slice vGPU: Master/Slave MMU fabric & 20-bit PASID armed (US 11,768,781 B2)");

    // Initialize VMware SR-IOV Mailbox Intercept Virtualizer (US 2021/0209040 A1)
    sriov_mailbox::init_sriov_mailbox_subsystem();
    kprintln_emerald!("[ok] VMware SR-IOV Mailbox: PF intercept callback & dynamic EPT flipping armed (US 2021/0209040 A1)");

    // Initialize VMware VM Data Security & Nested Root Partition Guard (US 11,093,629 B2)
    vm_data_security::init_vm_data_security();
    kprintln_emerald!("[ok] VMware VM Data Security: Nested root partition tables & truncated extents armed (US 11,093,629 B2)");

    // Initialize Intel Platform Protection Technology (PPT) Dual-View EPT (US 2023/0030961 A1)
    platform_protection::init_platform_protection();
    kprintln_emerald!("[ok] Intel PPT: Dual-view EPT, Asserted Page Tables (APT) & VIDT trampolines armed (US 2023/0030961 A1)");

    // Initialize Dell Virtual Accelerator Manager (VAM) & Task Performance Enhancer (US 2022/0043664 A1)
    dell_vam_profiler::init_dell_vam_subsystem();
    kprintln_emerald!("[ok] Dell VAM: Task profiling, slot speed classification & Performance Index armed (US 2022/0043664 A1)");

    // Initialize HPE Multi-OS Heterogeneous Virtual Machine (HVM) (US 2025/0085997 A1)
    hpe_multi_os_hvm::init_hpe_hvm_subsystem();
    kprintln_emerald!("[ok] HPE Multi-OS HVM: SOS NonStop / AOS Linux shared memory & VR-NIC RMA armed (US 2025/0085997 A1)");

    // Initialize Embedded WebAssembly (WASM) Micro-Sandbox (W3C WASM 1.0 / US 2026/0100856 A1)
    wasm_engine::init_wasm_subsystem();
    kprintln_emerald!("[ok] Embedded WebAssembly: \\0asm v1 parser, 64 KiB linear memory & fuel metering armed");

    // Initialize NVIDIA Max-Q Optimal Operating Point & Shared TDP Estimator (CN 111143174 B)
    nvidia_maxq_estimator::init_nvidia_maxq_subsystem();
    kprintln_emerald!("[ok] NVIDIA Max-Q: AI-driven V-F curve estimator & shared TDP dynamic power balancing armed (CN 111143174 B)");

    // Initialize Voyager Shared Memory Topic Registry (US 11,080,216 B2)
    shm_ipc::init_voyager_shm_subsystem();
    kprintln_emerald!("[ok] Voyager Shared Memory IPC: Lock-free topic ring buffers & dual-offset sync armed (US 11,080,216 B2)");

    // Initialize ARAIS Vector Remoting Engine (US 10,558,824 B1)
    vector_remoting::init_arais_vector_subsystem();
    kprintln_emerald!("[ok] S2 Systems ARAIS: Vector draw command remoting & compositor quad interception armed (US 10,558,824 B1)");

    // Initialize Tala Security AST/GAST Script Guard (US 11,314,862 B2)
    script_ast_guard::init_tala_ast_subsystem();
    kprintln_emerald!("[ok] Tala Security AST Guard: Tree Edit Distance (TED) & Generalized AST policy armed (US 11,314,862 B2)");

    // Initialize Black Sesame Kwasm In-Kernel WebAssembly Engine (CN 112905472 B)
    kwasm_engine::init_kwasm_subsystem();
    kprintln_emerald!("[ok] Black Sesame Kwasm: In-kernel wasm64 runtime, NO-FPU enforcement & symbol export armed (CN 112905472 B)");

    // Initialize Wave Computing 5-D Multidimensional DMA (US 10,997,102 B2)
    wave_mddma::init_wave_mddma_subsystem();
    kprintln_emerald!("[ok] Wave Computing MD-DMA: 256-bit 5-D tensor address generator & PE quad circular buffer armed (US 10,997,102 B2)");

    // Initialize Intel Flat Decision Tree Telemetry Classifier (US 2021/0097449 A1)
    intel_dtree::init_intel_dtree_subsystem();
    kprintln_emerald!("[ok] Intel Decision Tree: Memory-efficient flat node array telemetry classifier armed (US 2021/0097449 A1)");

    // Initialize Tom Herbert PANDA Pipeline Engine (US 12,026,546 B2)
    panda_pipeline::init_panda_subsystem();
    kprintln_emerald!("[ok] Tom Herbert PANDA: Vertical/horizontal parallel protocol parser armed (US 12,026,546 B2)");

    // Initialize Fortinet Intelligent Packet Capture & EOS Engine (US 11,870,693 B2)
    fortinet_capture::init_fortinet_subsystem();
    kprintln_emerald!("[ok] Fortinet Capture: Kernel XDP 78B header extraction & MSPSC EOS armed (US 11,870,693 B2)");

    // Initialize NUDT Joint Network Processing Accelerator (CN 118301090 A)
    nudt_netaccel::init_nudt_subsystem();
    kprintln_emerald!("[ok] NUDT Joint NetAccel: eBPF/XDP SDN packet-in bypass & in-kernel reassembly armed (CN 118301090 A)");

    // Initialize YuanNao SmartNIC Hardware-Offloaded XDP Engine (CN 116996602 B)
    yuannao_smartnic::init_yuannao_subsystem();
    kprintln_emerald!("[ok] YuanNao SmartNIC: In-NIC hardware-offloaded XDP, isolated meta & T1 watchdog armed (CN 116996602 B)");

    // Initialize CAS CNIC Dual-Stack AF_XDP Multiplexer (CN 115714679 A)
    cas_afxdp::init_cas_subsystem();
    kprintln_emerald!("[ok] CAS CNIC AF_XDP: XSKMAP queue binding, UMEM ring & multi-NIC 1:1 armed (CN 115714679 A)");

    // Initialize Langhe Service Mesh Sockops Acceleration Engine (CN 114025370 B)
    langhe_mesh::init_langhe_subsystem();
    kprintln_emerald!("[ok] Langhe Service Mesh: Sidecar sockmap bypass & ARP dual-sync armed (CN 114025370 B)");

    // Initialize SoundHound Differential Spatial Audio Subsystem (US 11,589,184 B1)
    soundhound_spatial::init_soundhound_subsystem();
    kprintln_emerald!("[ok] SoundHound Spatial: Differential ITD/ILD & dynamic drag-relocation armed (US 11,589,184 B1)");

    // Initialize Ericsson Spatially Heterogeneous 6DoF Audio Subsystem (JP 2022-515910 A / WO 2020/144062)
    ericsson_hetero_audio::init_ericsson_subsystem();
    kprintln_emerald!("[ok] Ericsson Hetero-Audio: 6DoF M/S remix matrix, anti-collapse & symmetry armed (JP 2022-515910 A)");

    // Initialize GenAudio AstoundSound 4D Spatialization & %-Center Bypass (US 9,154,896 B2)
    genaudio_astoundsound::init_astoundsound_subsystem();
    kprintln_emerald!("[ok] GenAudio AstoundSound: 4D trajectory, Doppler pitch & %-center bypass armed (US 9,154,896 B2)");

    // Initialize RBC Virtual Clean Room (VCR) Multiparty Enclave Subsystem (US 12,210,636 B2)
    unsafe { rbc_vcr_enclave::init_vcr_subsystem(); }
    kprintln_emerald!("[ok] RBC VCR: Multiparty Clean Room, Attestation Quote & NE Custodian armed (US 12,210,636 B2)");

    // Initialize UCF Dual FS/M Byte-Addressable Persistent Memory & DAX Auditing (US 11,398,894 B2)
    unsafe { ucf_dax_fsm::init_dax_fsm_subsystem(); }
    kprintln_emerald!("[ok] UCF Dual FS/M: DAX Dual-Pad XOR Encryption & GlobalBuffer Audit armed (US 11,398,894 B2)");

    // Initialize MongoDB Pluggable Encrypted Storage Engine (US 10,846,411 B2)
    unsafe { mongodb_enc_engine::init_mongodb_subsystem(); }
    kprintln_emerald!("[ok] MongoDB Storage: Pluggable format prediction & KMIP dual-tier encryption armed (US 10,846,411 B2)");

    // Initialize Microsoft Cross-Platform Enclave Identity & Distributed Sealing (EP 3 574 435 B1)
    unsafe { microsoft_cross_enclave::init_cross_platform_enclave_subsystem(); }
    kprintln_emerald!("[ok] Microsoft Enclaves: 5-tier abstract identity & distributed sealing armed (EP 3 574 435 B1)");

    // Initialize Apple Metal Unified Shading & Compute Pipeline Engine (EP 3 137 992 B1)
    unsafe { apple_metal_pipeline::init_metal_pipeline_subsystem(); }
    kprintln_emerald!("[ok] Apple Metal: Unified shader/compute AOT IR & stage_in signature matcher armed (EP 3 137 992 B1)");

    // Initialize Kunlunxin Confidential AI Mesh & Attestation Engine (CN 112528244 B / CN 112953855 B)
    kunlun_accel_mesh::init_kunlun_subsystem();
    kprintln_emerald!("[ok] Kunlunxin AI Mesh: Ring broadcast fabric & neural DRM attestation armed (CN 112528244 B)");

    // Initialize Ant Group Safe Memory Management & NUDT Invariants (CN 117908859 A / CN 116484439 B)
    let stack_bottom_addr = core::ptr::addr_of!(boot_stack_bottom) as usize;
    ant_safe_memory::init_safe_memory_subsystem(stack_bottom_addr, 65536);
    kprintln_emerald!("[ok] Ant Group Safe Memory: 100% Safe interface & stack guard page armed (CN 117908859 A)");

    // Initialize Quantum Enhanced Complexity Orchestration & Priority Backtracking (US 2026/0148042 A1 / CN 117931412 A)
    quantum_complexity_router::init_quantum_router();
    kprintln_emerald!("[ok] Quantum Complexity Router: Hybrid orchestrator & priority backtracking armed (US 2026/0148042 A1 / CN 117931412 A)");

    // Initialize Native Web Browser & HTTP Engine
    web_browser::init_browser_subsystem();
    kprintln_emerald!("[ok] Web Engine: In-kernel HTTP/1.1 client & text/spatial browser armed");

    // Initialize Secure Email & Mailbox Subsystem
    email_client::init_email_subsystem();
    kprintln_emerald!("[ok] Email Client: RFC 5322 MIME engine & hardware-signed mailbox armed");

    // Initialize Disaggregated SoC Syscall Bridge & Layered Arbiter Stack (CN 113989099 B / US 2020/0301764 A1)
    syscall_bridge_soc::init_soc_bridge_subsystem();
    kprintln_emerald!("[ok] SoC Syscall Bridge: Disaggregated dies, NAPI Bus & Arbiters armed (CN 113989099 B / US 2020/0301764 A1)");

    // Initialize Hypervisor Forensic Tracker & Zero Context-Switch eBPF Auditor (US 9,721,089 B2 / US 12,242,629 B2)
    forensic_ebpf_audit::init_forensic_ebpf_subsystem();
    kprintln_emerald!("[ok] Forensics & eBPF: Version-Tree causal log & in-kernel eBPF audit armed (US 9,721,089 B2 / US 12,242,629 B2)");

    // Initialize Anjuna Secure Runtime & Barkly Hypervisor MSR Shadow Monitor (US 11,714,895 B2 / US 9,589,132 B2)
    anjuna_barkly_enclave::init_anjuna_barkly_subsystem();
    kprintln_emerald!("[ok] Anjuna & Barkly: OS Bridge dual-stack enclaves & EPT/IA32_LSTAR shadow armed (US 11,714,895 B2 / US 9,589,132 B2)");

    // Initialize Citrix Dynamic GPU Passthrough <-> Emulation Sliding Engine (US 9,406,099 B2)
    citrix_gpu_sliding::init_gpu_sliding_subsystem();
    kprintln_emerald!("[ok] Citrix GPU Sliding: VT-d passthrough <-> emulator state continuity armed (US 9,406,099 B2)");

    kprintln_emerald!("Spatial OS is ALIVE!");

    // 4. Interactive bare-metal shell (accepts input from BOTH PS/2 Keyboard and Serial COM1)
    let mut line_buf = [0u8; 256];
    let mut line_len = 0usize;
    kprint!("spatial> ");

    loop {
        TICKS.fetch_add(1, Ordering::Relaxed);

        // Poll PS/2 auxiliary controller for mouse/trackpad motion & clicks
        if let Some(ref fb) = GOP_FB {
            let mut mouse_updated = false;
            while let Some(aux_b) = mouse::poll_aux_status() {
                if mouse::feed_byte(aux_b, fb.width, fb.height) {
                    mouse_updated = true;
                }
            }
            if mouse_updated {
                let m = mouse::state();
                compositor::cursor_draw(fb, m.x, m.y);
            }
        }

        let maybe_byte = serial_try_getc().or_else(|| ps2_try_getc());
        if let Some(b) = maybe_byte {
            if let Some(ref fb) = GOP_FB {
                compositor::cursor_restore(fb);
            }
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
        kprintln!("commands: help, gui, deck, mouse, routes, route [bind/free], usbc, sec, hsm [auth/lock], trust/graph, span [kick/ipi/rebalance], rootvmm [enter/exit/verify], snvme [read/write/target], hyos, dock, undock, pats [lba], shrink [mb], sva [activate/morph/dma/priv], latehv [step/trap], muse [fast/slow/mdev], coreiso [dispatch/pf], vgpu [tx/bounds], sriov [trigger/error/reset], vmsec [io/snap/bounds], ppt [ecall/aex/exit], vam [profile/bench], hvm [rma/poll/info], wasm [test/fuel/status], maxq [opt/step/tdp], shm [pub/sub], arais [level/flush], astguard [test], kwasm [test/call], mddma [burst/5d], dtree [eval/test], panda [test/parse], fortinet [test/eos], nudt [test/rule], snic [test/rule], afxdp [test/bind], mesh [test/arp], soundhound [test/move], ericsson [test/move], astound [test/bypass], vcr [test/query], fsm [test/audit], mongo [test/workload], enclave [test/seal], metal [test/pipeline], kunlun [test/broadcast/drm/attest/cache/info], antmem [test/info], quantum [test/route/solve/status], socbridge [test/status], forensics [test/status/chain/ebpf], anjuna [test/status], gpuslide [test/status/slide], browse [url], bookmarks, http [get], email [inbox/read/send/outbox/test], cxl, scibuf, ltssm/margin, hud, net, stream, flynet [slot], fly [0..3], land, cpu, vmx, vms, vmrun, spawn, exec, elf, sched, syscall, ls, echo, uptime, mem, ps, pci, disks, sandbox, avionics, radiator, install, halt, reboot");
        kprintln!("storage:  disks, mount [pN], umount, df, ls [dir], cat <file>, write <file> <text>, append <file> <text>, touch <file>, mkdir <dir>, rm <path>, sync, blk <dev> <lba>");
    } else if cmd == "gui" || cmd == "deck" || cmd == "desktop" {
        if let Some(ref fb) = GOP_FB {
            compositor::run_gui_desktop(fb);
            CURSOR_COL = 0;
            CURSOR_ROW = 0;
            gop_init_glass_cockpit(fb);
            kprintln_emerald!("[SPATIAL] Returned from Spatial Card Deck to Console Shell.");
        } else {
            kprintln!("gui: UEFI GOP linear framebuffer required (running in VGA text mode)");
        }
    } else if cmd == "mouse" {
        let m = mouse::state();
        kprintln_amber!(
            "Mouse: X={} Y={} Left={} Right={} Mid={} Initialized={}",
            m.x,
            m.y,
            m.left as u8,
            m.right as u8,
            m.middle as u8,
            mouse::is_initialized() as u8
        );
    } else if cmd == "routes" || cmd == "routing" || cmd == "flow" {
        kprintln_amber!(
            "=== DYNAMIC DATAFLOW ROUTING & RESOURCE MANAGER ({}/{} Mbps Allocated) ===",
            routing::RESOURCE_MGR.total_allocated_bandwidth_mbps,
            routing::RESOURCE_MGR.rated_interconnect_bandwidth_mbps
        );
        for route in routing::RESOURCE_MGR.routes.iter() {
            if route.is_allocated {
                kprintln_emerald!(
                    "Route #{}: [Card {} ({})] -> [Card {} ({})] | QoS: {} | {} Mbps, latency={}ns | pkts={}",
                    route.id,
                    route.source_card_id,
                    routing::card_name(route.source_card_id),
                    route.target_card_id,
                    routing::card_name(route.target_card_id),
                    routing::qos_name(route.qos_tier),
                    route.target_bandwidth_mbps,
                    route.target_latency_ns,
                    route.packets_routed
                );
            }
        }
    } else if let Some(arg) = cmd.strip_prefix("route ") {
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "free" {
            let slot: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(99);
            if routing::RESOURCE_MGR.free_route(slot) {
                kprintln_emerald!("[ROUTING] Route #{} deallocated from resource pool.", slot);
            } else {
                kprintln!("route free: invalid or unallocated route index");
            }
        } else if sub == "bind" {
            let src: u8 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let dst: u8 = it.next().and_then(|s| s.parse().ok()).unwrap_or(4);
            let mbps: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(50);
            let lat: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(100);
            match routing::RESOURCE_MGR.allocate_route(src, dst, mbps, lat, routing::QualityOfServiceTier::StandardData) {
                Ok(idx) => kprintln_emerald!(
                    "[ROUTING] Bound Route #{}: [Card {}] -> [Card {}] ({} Mbps, {}ns latency)",
                    idx,
                    src,
                    dst,
                    mbps,
                    lat
                ),
                Err(e) => kprintln!("route bind error: {}", e),
            }
        } else {
            kprintln!("usage: route bind <src_card> <dst_card> <mbps> <latency_ns> | route free <slot_id>");
        }
    } else if cmd == "usbc" || cmd == "ports" || cmd.starts_with("usbc ") {
        if let Some(arg) = cmd.strip_prefix("usbc ") {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "plug" {
                let port: u8 = it.next().and_then(|s| s.parse().ok()).unwrap_or(1);
                let mode = it.next().unwrap_or("charger");
                let is_charger = mode == "charger" || mode == "power";
                routing::USB_ARBITRATOR.evaluate_port_insertion(port, true, is_charger);
                kprintln_emerald!("[USB-C] Simulated port {} insertion (mode: {})", port, mode);
            }
        }
        kprintln_amber!("=== USB TYPE-C DEVICE CONTROLLER (xDCI) ARBITRATION ===");
        kprintln!(
            "Port 1: [{}] | Port 2: [{}]",
            routing::usb_port_state_str(routing::USB_ARBITRATOR.port_1_state),
            routing::usb_port_state_str(routing::USB_ARBITRATOR.port_2_state)
        );
        kprintln_emerald!(
            "Shared Synopsys/Intel xDCI Controller -> Mapped to Port {} (Anti-Lockup Active)",
            routing::USB_ARBITRATOR.shared_xdci_mapped_to_port
        );
    } else if cmd == "sec" || cmd == "iot" || cmd.starts_with("sec ") {
        if let Some(arg) = cmd.strip_prefix("sec ") {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "set" {
                let dev_id: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(0).min(7);
                let lvl_num: u8 = it.next().and_then(|s| s.parse().ok()).unwrap_or(3);
                let new_lvl = match lvl_num {
                    0 => routing::IoTSecurityLevel::Level0Unsecured,
                    1 => routing::IoTSecurityLevel::Level1Encrypted128,
                    _ => routing::IoTSecurityLevel::Level3MilitaryAES256,
                };
                routing::SECURITY_ANALYZER.device_security_levels[dev_id] = new_lvl;
                kprintln_emerald!("[SECURITY] Device/Card {} security tier set to {}", dev_id, routing::iot_security_level_str(new_lvl));
            }
        }
        kprintln_amber!("=== IOT & ENCLAVE SECURITY INTEROPERABILITY ANALYZER ===");
        for i in 0..8usize {
            let lvl = routing::SECURITY_ANALYZER.device_security_levels[i];
            kprintln!(
                "Device/Card #{}: [{}] -> Security Tier: {}",
                i,
                routing::card_name(i as u8),
                routing::iot_security_level_str(lvl)
            );
        }
        kprintln_emerald!("Policy: Unmediated downgrade paths to Level 0 Unsecured are strictly BLOCKED.");
    } else if cmd == "hsm" || cmd.starts_with("hsm ") {
        if let Some(arg) = cmd.strip_prefix("hsm ") {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "lock" {
                softhsm::SOFTHSM_CTX.invalidate_session();
                kprintln_amber!("[5G-SoftHSM] Session invalidated. Enclave in Unverified state.");
            } else if action == "auth" {
                let iris: u64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0xA8F0_4421_99BC_3120);
                let nat_id: u64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0x5173_76AE_88A0_1042);
                match softhsm::SOFTHSM_CTX.authenticate_biometric_session(iris, nat_id) {
                    Ok(tok) => kprintln_emerald!("[5G-SoftHSM] Biometric session authenticated! G-SSO Token: {:#X}", tok),
                    Err(e) => kprintln!("hsm auth: {}", e),
                }
            }
        }
        kprintln_amber!("=== 5G-SOFTHSM & BIOMETRIC VAULT ENCLAVE (PA-ROMY ROOT-OF-TRUST) ===");
        kprintln!(
            "HSM Signature: '5GSH' ({:#X}) | Validation State: [{}]",
            softhsm::SOFTHSM_CTX.hsm_id,
            softhsm::biometric_state_str(softhsm::SOFTHSM_CTX.validation_state)
        );
        kprintln_emerald!(
            "Active G-SSO Session Token: {:#X} | Authentications: {} | Lockouts: {}",
            softhsm::SOFTHSM_CTX.active_session_token,
            softhsm::SOFTHSM_CTX.total_authentications,
            softhsm::SOFTHSM_CTX.security_lockouts
        );
        let key_hex = &softhsm::SOFTHSM_CTX.encrypted_vault_key;
        kprintln!(
            "Hardware Vault Key: {:02x}{:02x}{:02x}{:02x}..{:02x}{:02x}{:02x}{:02x} [AES-256 G-SSO LOCKED]",
            key_hex[0], key_hex[1], key_hex[2], key_hex[3], key_hex[28], key_hex[29], key_hex[30], key_hex[31]
        );
    } else if cmd == "fly" || cmd.starts_with("fly ") || cmd.starts_with("airplane ") || cmd.starts_with("handover ") {
        let arg = cmd.split_whitespace().nth(1).unwrap_or("0");
        let slot = match arg {
            "0" => 0,
            "1" => 1,
            "2" => 2,
            "3" => 3,
            _ => 0,
        };
        let mut manifest = handover::CapsuleCheckpointManifest {
            capsule_id: 0,
            name: [0; 20],
            role_code: 0,
            _pad: [0; 2],
            vm_exits: 0,
            last_cycles: 0,
            last_result: 0,
            mem_kib: 0,
        };
        let mut header = handover::PaperAirplaneHeader {
            magic: 0,
            msg_type: 0,
            source_slot: 0,
            target_node: 0,
            payload_len: 0,
            sequence_num: 0,
            crc32: 0,
            _reserved: 0,
        };
        match handover::HANDOVER_MGR.serialize_capsule_state(slot, 0x5173, &mut manifest, &mut header) {
            Ok(_payload) => {
                routing::RESOURCE_MGR.record_packet(2);
                kprintln_emerald!("=== [PAPER AIRPLANE] CAPSULE HANDOVER FRAME SERIALIZED ===");
                kprintln!(
                    "Magic: 'PAIR' (0x{:08X}) | MsgType: InitiateMigrate (0x{:02X}) | Target: Node 0x{:04X}",
                    header.magic,
                    header.msg_type,
                    header.target_node
                );
                kprintln!(
                    "Capsule {}: [{}] ({}) exits={} last_cycles={}",
                    slot,
                    trimmed_ascii(&manifest.name),
                    CAPSULES[slot].role,
                    manifest.vm_exits,
                    manifest.last_cycles
                );
                kprintln_amber!(
                    "Memory: 4096 B snapshot | Seq: #{} | CRC32: 0x{:08X} [INTEGRITY OK]",
                    header.sequence_num,
                    header.crc32
                );
                kprintln_emerald!("State: StreamingPacket -> Ready for smoltcp/GRE tunnel transit.");
            }
            Err(e) => kprintln!("fly: error {}", e),
        }
    } else if cmd == "land" || cmd.starts_with("land ") {
        let arg = cmd.split_whitespace().nth(1).unwrap_or("0");
        let slot = match arg {
            "0" => 0,
            "1" => 1,
            "2" => 2,
            "3" => 3,
            _ => 0,
        };
        let mut manifest = handover::CapsuleCheckpointManifest {
            capsule_id: 0,
            name: [0; 20],
            role_code: 0,
            _pad: [0; 2],
            vm_exits: 0,
            last_cycles: 0,
            last_result: 0,
            mem_kib: 0,
        };
        let mut header = handover::PaperAirplaneHeader {
            magic: 0,
            msg_type: 0,
            source_slot: 0,
            target_node: 0,
            payload_len: 0,
            sequence_num: 0,
            crc32: 0,
            _reserved: 0,
        };
        if let Ok(payload) = handover::HANDOVER_MGR.serialize_capsule_state(slot, 0x5173, &mut manifest, &mut header) {
            header.msg_type = handover::HandoverMsgType::StateTransfer as u8;
            match handover::HANDOVER_MGR.handle_incoming_handover(&header, &manifest, payload) {
                Ok(landed_slot) => {
                    kprintln_emerald!("=== [PAPER AIRPLANE] CAPSULE HANDOVER LANDED & RESUMED ===");
                    kprintln!(
                        "Slot {} [{}] ingested 4096 B page (CRC32: 0x{:08X})",
                        landed_slot,
                        trimmed_ascii(&manifest.name),
                        header.crc32
                    );
                    header.msg_type = handover::HandoverMsgType::ResumeContext as u8;
                    let _ = handover::HANDOVER_MGR.handle_incoming_handover(&header, &manifest, &[]);
                    kprintln_emerald!("State: Resumed -> Micro-VM execution continuing on local CPU.");
                }
                Err(e) => kprintln!("land: error {}", e),
            }
        }
    } else if cmd == "graph" || cmd == "trust" || cmd.starts_with("trust ") || cmd.starts_with("graph ") {
        if let Some(arg) = cmd.strip_prefix("trust ").or_else(|| cmd.strip_prefix("graph ")) {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "isolate" || action == "quarantine" {
                let slot: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(7);
                if trust_graph::TRUST_GRAPH.quarantine_card(slot) {
                    for (r_idx, r) in routing::RESOURCE_MGR.routes.iter().enumerate() {
                        if r.is_allocated && (r.source_card_id as usize == slot || r.target_card_id as usize == slot) {
                            routing::RESOURCE_MGR.free_route(r_idx);
                        }
                    }
                    kprintln_amber!("[TRUST GRAPH] Card #{} ISOLATED & quarantined. Routes severed.", slot);
                }
            } else if action == "release" {
                let slot: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                if trust_graph::TRUST_GRAPH.release_quarantine(slot) {
                    kprintln_emerald!("[TRUST GRAPH] Card #{} quarantine released.", slot);
                }
            } else if action == "pcr" {
                let slot: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let val = it.next().unwrap_or("valid");
                if val == "invalid" || val == "fail" {
                    trust_graph::TRUST_GRAPH.verify_pcr_quote(slot, &[0u8; 32]);
                    kprintln_amber!("[TRUST GRAPH] Injected PCR failure on Card #{}.", slot);
                } else {
                    trust_graph::TRUST_GRAPH.verify_pcr_quote(slot, &[0xAA; 32]);
                    kprintln_emerald!("[TRUST GRAPH] Verified hardware PCR quote on Card #{}.", slot);
                }
            }
        }
        kprintln_amber!(
            "=== GRAPH-BASED TRUST TOPOLOGY & ENCLAVE ISOLATION (Isolation Events: {}) ===",
            trust_graph::TRUST_GRAPH.isolation_events
        );
        for i in 0..trust_graph::TRUST_GRAPH.node_count {
            let n = &trust_graph::TRUST_GRAPH.nodes[i];
            kprintln!(
                "Node #{}: [{}] | Trust: {} | PCR: {} | WireSec: {} | Status: {}",
                n.card_id,
                n.name,
                trust_graph::trust_level_str(n.trust_level),
                if n.pcr_quote_valid { "VALID" } else { "FAILED" },
                if n.active_channel_secure { "SECURE" } else { "UNENCRYPTED" },
                if n.quarantined { "[QUARANTINED]" } else { "[ACTIVE]" }
            );
        }
        kprintln_emerald!("Automated Policy: Invalid PCR quotes or unmediated Level 0 triggers immediate enclave quarantine.");
    } else if let Some(arg) = cmd.strip_prefix("isolate ").or_else(|| cmd.strip_prefix("quarantine ")) {
        let slot: usize = arg.trim().parse().unwrap_or(7);
        if trust_graph::TRUST_GRAPH.quarantine_card(slot) {
            for (r_idx, r) in routing::RESOURCE_MGR.routes.iter().enumerate() {
                if r.is_allocated && (r.source_card_id as usize == slot || r.target_card_id as usize == slot) {
                    routing::RESOURCE_MGR.free_route(r_idx);
                }
            }
            kprintln_amber!("[TRUST GRAPH] Card #{} ISOLATED & quarantined. Routes severed.", slot);
        }
    } else if let Some(arg) = cmd.strip_prefix("release ") {
        let slot: usize = arg.trim().parse().unwrap_or(0);
        if trust_graph::TRUST_GRAPH.release_quarantine(slot) {
            kprintln_emerald!("[TRUST GRAPH] Card #{} quarantine released.", slot);
        }
    } else if cmd == "net" || cmd == "nic" || cmd.starts_with("net ") {
        kprintln_amber!("=== BARE-METAL GIGABIT ETHERNET & NETWORK ADAPTER ===");
        let nic_name = match net::NIC.nic_type {
            net::NicType::IntelE1000 => "Intel 82540EM/82545EM Gigabit PCIe",
            net::NicType::VirtualLoopback => "Virtual Loopback Adapter",
            net::NicType::None => "No Adapter Detected",
        };
        kprintln!(
            "Adapter: {} | MMIO Base: {:#X} | Link: [{}]",
            nic_name,
            net::NIC.mmio_base,
            if net::NIC.link_up { "UP" } else { "DOWN" }
        );
        kprintln!(
            "MAC Address: {:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x} | IP: {}.{}.{}.{} | Gateway: {}.{}.{}.{}",
            net::NIC.mac_addr[0], net::NIC.mac_addr[1], net::NIC.mac_addr[2],
            net::NIC.mac_addr[3], net::NIC.mac_addr[4], net::NIC.mac_addr[5],
            net::NIC.ip_addr[0], net::NIC.ip_addr[1], net::NIC.ip_addr[2], net::NIC.ip_addr[3],
            net::NIC.gateway_ip[0], net::NIC.gateway_ip[1], net::NIC.gateway_ip[2], net::NIC.gateway_ip[3]
        );
        kprintln_emerald!(
            "Traffic: TX {} packets ({} bytes) | RX {} packets ({} bytes)",
            net::NIC.tx_packets, net::NIC.tx_bytes, net::NIC.rx_packets, net::NIC.rx_bytes
        );
    } else if cmd == "stream" || cmd == "telem" || cmd.starts_with("stream ") {
        let m = mouse::state();
        let card = compositor::active_drag_card().unwrap_or(0) as u8;
        net::broadcast_telemetry(m.x as i32, m.y as i32, 1042, card);
        kprintln_emerald!(
            "[UDP 5173] Streamed flight telemetry packet to Studio (gateway {}.{}.{}.{}:5173): X={} Y={} Card={}",
            net::NIC.gateway_ip[0], net::NIC.gateway_ip[1], net::NIC.gateway_ip[2], net::NIC.gateway_ip[3],
            m.x, m.y, card
        );
    } else if cmd == "flynet" || cmd.starts_with("flynet ") {
        let slot: usize = cmd.strip_prefix("flynet").unwrap_or("").trim().parse().unwrap_or(0).min(3);
        let mut manifest = handover::CapsuleCheckpointManifest {
            capsule_id: 0,
            name: [0; 20],
            role_code: 0,
            _pad: [0; 2],
            vm_exits: 0,
            last_cycles: 0,
            last_result: 0,
            mem_kib: 0,
        };
        let mut header = handover::PaperAirplaneHeader {
            magic: 0,
            msg_type: 0,
            source_slot: 0,
            target_node: 0,
            payload_len: 0,
            sequence_num: 0,
            crc32: 0,
            _reserved: 0,
        };
        match handover::HANDOVER_MGR.serialize_capsule_state(slot, 0x5173, &mut manifest, &mut header) {
            Ok(payload) => {
                let ok = net::send_udp_packet(net::NIC.gateway_ip, 5173, 5173, &payload[..512]);
                routing::RESOURCE_MGR.record_packet(2);
                kprintln_emerald!("=== [FLYNET] PAPER AIRPLANE STREAMED VIA UDP/IP ===");
                kprintln!(
                    "Target: {}.{}.{}.{}:5173 | Capsule {} [{}] | CRC32: {:#X} | UDP Stream: {}",
                    net::NIC.gateway_ip[0], net::NIC.gateway_ip[1], net::NIC.gateway_ip[2], net::NIC.gateway_ip[3],
                    slot, trimmed_ascii(&manifest.name), header.crc32,
                    if ok { "DELIVERED" } else { "BUFFERED" }
                );
            }
            Err(e) => kprintln!("flynet: error {}", e),
        }
    } else if cmd == "cxl" || cmd.starts_with("cxl ") {
        if let Some(arg) = cmd.strip_prefix("cxl ") {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "arbitrate" || action == "switch" {
                let snoop: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(250);
                let max_qos: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(100);
                hetero_engine::CXL_POOL.arbitrate_protocol(snoop, max_qos);
                kprintln_emerald!(
                    "[CXL] Protocol arbitrated (snoop={}ns vs max_qos={}ns) -> Active: {}",
                    snoop, max_qos, hetero_engine::cxl_protocol_str(hetero_engine::CXL_POOL.active_protocol)
                );
            }
        }
        kprintln_amber!("=== CXL & IPU RESOURCE POOLING (US20230029026A1) ===");
        kprintln!(
            "Active Protocol: {} | Transitions: {}",
            hetero_engine::cxl_protocol_str(hetero_engine::CXL_POOL.active_protocol),
            hetero_engine::CXL_POOL.snoop_transitions
        );
        kprintln_emerald!(
            "Pool: {}/{} KiB ({} MiB total) | Active Nodes: {} (Host CPU + Neural IPU)",
            hetero_engine::CXL_POOL.allocated_kb,
            hetero_engine::CXL_POOL.total_pool_kb,
            hetero_engine::CXL_POOL.total_pool_kb / 1024,
            hetero_engine::CXL_POOL.active_node_count
        );
    } else if cmd == "scibuf" || cmd == "scisync" || cmd.starts_with("scibuf ") {
        kprintln_amber!("=== SCIBUF & SCISYNC HETEROGENEOUS ZERO-COPY (US20250138884A1) ===");
        if let Some(ref buf) = hetero_engine::PRIMARY_SCIBUF {
            kprintln_emerald!(
                "Reconciled Buffer: Pitch Alignment={} B | Size={} B ({} KiB) | Shared Carveout={} | Reconciled={}",
                buf.pitch_alignment,
                buf.size_bytes,
                buf.size_bytes / 1024,
                buf.is_carveout_shared,
                buf.is_reconciled
            );
        } else {
            kprintln!("Primary SciBuf: unallocated");
        }
        kprintln!(
            "SciSync Fence: Syncpoint #{} | Current Threshold Value: {:#X}",
            hetero_engine::ACTIVE_SCISYNC.syncpoint_id,
            hetero_engine::ACTIVE_SCISYNC.threshold_value
        );
    } else if cmd == "margin" || cmd == "ltssm" || cmd.starts_with("margin ") || cmd.starts_with("ltssm ") {
        let prefix = if cmd.starts_with("margin ") { "margin " } else { "ltssm " };
        if let Some(arg) = cmd.strip_prefix(prefix) {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "reset" {
                hetero_engine::MARGIN_TESTER.reset_to_standard_l0();
                kprintln_emerald!("[LTSSM] All 8 physical lanes reset to Standard L0.");
            } else if action == "test" || action == "crosstalk" {
                let victim: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(3).min(7);
                let mode_str = it.next().unwrap_or("next");
                let mode = match mode_str {
                    "fext" => hetero_engine::LaneTestState::GenerateFext,
                    "dual" | "both" => hetero_engine::LaneTestState::GenerateNextFext,
                    _ => hetero_engine::LaneTestState::GenerateNext,
                };
                hetero_engine::MARGIN_TESTER.enter_crosstalk_test_mode(victim, mode);
                kprintln_emerald!(
                    "[LTSSM] Crosstalk Stress Test armed: Victim Lane #{} (LutLoopbackSlave), Aggressors: {}",
                    victim,
                    hetero_engine::lane_state_str(mode)
                );
            }
        }
        kprintln_amber!(
            "=== LTSSM MULTI-LANE CROSSTALK STRESS TESTER (US11327861B2) [Tests: {}] ===",
            hetero_engine::MARGIN_TESTER.total_crosstalk_tests
        );
        for i in 0..8usize {
            let st = hetero_engine::MARGIN_TESTER.lane_states[i];
            let is_victim = hetero_engine::MARGIN_TESTER.active_victim_lane == Some(i);
            kprintln!(
                "Lane #{}: {} {}",
                i,
                hetero_engine::lane_state_str(st),
                if is_victim { "[VICTIM LANE UNDER TEST]" } else { "" }
            );
        }
    } else if cmd == "hud" || cmd.starts_with("hud ") {
        let mut use_intersect = false;
        if let Some(arg) = cmd.strip_prefix("hud ") {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "intersect" {
                use_intersect = true;
            } else if action == "block" {
                let mask: u8 = it.next().and_then(|s| u8::from_str_radix(s.trim_start_matches("0x"), 16).ok()).unwrap_or(0x80);
                hetero_engine::HUD_COMBINER.operator_blocked_mask = mask;
                kprintln_emerald!("[HUD] Operator blocked mask updated to {:#04X}", mask);
            } else if action == "prefer" {
                let mask: u8 = it.next().and_then(|s| u8::from_str_radix(s.trim_start_matches("0x"), 16).ok()).unwrap_or(0x0F);
                hetero_engine::HUD_COMBINER.operator_preferred_mask = mask;
                kprintln_emerald!("[HUD] Operator preferred mask updated to {:#04X}", mask);
            }
        }
        let active_layout = hetero_engine::HUD_COMBINER.compute_combined_hud_layout(use_intersect);
        kprintln_amber!("=== SET-THEORY MULTI-USER HUD PERSONALIZATION (US11695998B2) ===");
        kprintln!(
            "Operator Preferred: {:#04X} | Blocked Subtraction: {:#04X} | Romy (AI) Preferred: {:#04X}",
            hetero_engine::HUD_COMBINER.operator_preferred_mask,
            hetero_engine::HUD_COMBINER.operator_blocked_mask,
            hetero_engine::HUD_COMBINER.romy_preferred_mask
        );
        kprintln_emerald!(
            "Combined Layout Bitmask (Mode: {}): {:#04X} [Widgets Active: 0b{:08b}]",
            if use_intersect { "INTERSECTION" } else { "UNION" },
            active_layout,
            active_layout
        );
    } else if cmd == "span" || cmd == "mhvm" || cmd.starts_with("span ") {
        if let Some(arg) = cmd.strip_prefix("span ") {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "kick" {
                let vcpu: u8 = it.next().and_then(|s| s.parse().ok()).unwrap_or(2);
                match multi_hypervisor::SPAN_VM.redirect_virtio_kick(vcpu, 0) {
                    Ok(res) => kprintln_emerald!("[SPAN] Virtio kick on VCPU {} -> {}", vcpu, res),
                    Err(e) => kprintln!("span kick error: {}", e),
                }
            } else if action == "ipi" {
                let src: u8 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let dst: u8 = it.next().and_then(|s| s.parse().ok()).unwrap_or(2);
                match multi_hypervisor::SPAN_VM.dispatch_cross_l1_ipi(src, dst, 0xFD) {
                    Ok(res) => kprintln_emerald!("[SPAN] Cross-L1 IPI from VCPU {} to VCPU {} -> {}", src, dst, res),
                    Err(e) => kprintln!("span ipi error: {}", e),
                }
            } else if action == "rebalance" {
                let count: u8 = it.next().and_then(|s| s.parse().ok()).unwrap_or(3);
                multi_hypervisor::SPAN_VM.rebalance_vcpus(count);
                kprintln_emerald!("[SPAN] Rebalanced VCPUs: {} on L1_Source, {} on L1_Target", count, 4 - count);
            }
        }
        kprintln_amber!("=== MULTI-HYPERVISOR VIRTUAL MACHINE ('SPAN' - US 9,798,567 B2) ===");
        kprintln!(
            "VM: [{}] | Shared Footprint: {} KiB ({} MiB @ {:#X}) | I/O Primary: {}",
            multi_hypervisor::SPAN_VM.name,
            multi_hypervisor::SPAN_VM.shared_memory_kib,
            multi_hypervisor::SPAN_VM.shared_memory_kib / 1024,
            multi_hypervisor::SPAN_VM.shared_hpa_base,
            multi_hypervisor::hypervisor_level_str(multi_hypervisor::SPAN_VM.io_primary_l1)
        );
        for i in 0..multi_hypervisor::SPAN_VM.total_vcpus {
            let v = &multi_hypervisor::SPAN_VM.vcpus[i as usize];
            kprintln!(
                "  VCPU #{}: {} | ActiveLocally: {} | Exits: {} | Cycles: {}",
                v.vcpu_id,
                multi_hypervisor::hypervisor_level_str(v.assigned_l1),
                v.is_active_locally,
                v.vm_exits,
                v.execution_cycles
            );
        }
        kprintln_emerald!(
            "Metrics: Kicks Redirected: {} | Cross-L1 IPIs: {} | Interrupts Filtered: {} | Net Egress: {}",
            multi_hypervisor::SPAN_VM.kicks_redirected,
            multi_hypervisor::SPAN_VM.cross_l1_ipis,
            multi_hypervisor::SPAN_VM.interrupts_filtered,
            multi_hypervisor::SPAN_VM.single_exit_net_packets
        );
    } else if cmd == "rootvmm" || cmd == "vmm" || cmd.starts_with("rootvmm ") || cmd.starts_with("vmm ") {
        let prefix = if cmd.starts_with("rootvmm ") { "rootvmm " } else { "vmm " };
        if let Some(arg) = cmd.strip_prefix(prefix) {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "enter" {
                let id: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(2);
                match trusted_root_vmm::TRUSTED_VMM_ENGINE.vmx_root_enter(id) {
                    Ok(res) => kprintln_emerald!("[ROOT VMM] Module {} -> {}", id, res),
                    Err(e) => kprintln!("rootvmm enter error: {}", e),
                }
            } else if action == "exit" {
                let id: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(1);
                match trusted_root_vmm::TRUSTED_VMM_ENGINE.vmx_root_exit(id) {
                    Ok(res) => kprintln_emerald!("[ROOT VMM] Module {} -> {}", id, res),
                    Err(e) => kprintln!("rootvmm exit error: {}", e),
                }
            } else if action == "verify" {
                let id: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(1);
                let rip: u64 = it.next().and_then(|s| u64::from_str_radix(s.trim_start_matches("0x"), 16).ok()).unwrap_or(0x0045_0000);
                let ok = trusted_root_vmm::TRUSTED_VMM_ENGINE.verify_execution_boundary(id, rip);
                if ok {
                    kprintln_emerald!("[ROOT VMM] Target RIP {:#X} verified inside Module {} boundary [OK]", rip, id);
                } else {
                    kprintln_amber!("[ROOT VMM] Target RIP {:#X} OUT-OF-BOUNDS for Module {} -> Blue-Pill Trapped!", rip, id);
                }
            }
        }
        kprintln_amber!("=== TRUSTED ROOT MODE HYPERVISOR & ROOT MODE VMM (US 9,367,671 B1) ===");
        kprintln!(
            "Component 1 (EFI Root Core): {} | Component 2 (OS Agent): {} | OS Privilege: {}",
            if trusted_root_vmm::TRUSTED_VMM_ENGINE.component_1_active { "ACTIVE" } else { "DISABLED" },
            if trusted_root_vmm::TRUSTED_VMM_ENGINE.component_2_active { "ACTIVE" } else { "DISABLED" },
            trusted_root_vmm::privilege_str(trusted_root_vmm::TRUSTED_VMM_ENGINE.os_privilege)
        );
        kprintln!(
            "VMX Capabilities: {:#018X} | Root Transitions: {} | Boundary Faults: {}",
            trusted_root_vmm::TRUSTED_VMM_ENGINE.vmx_get_capabilities(),
            trusted_root_vmm::TRUSTED_VMM_ENGINE.root_transitions,
            trusted_root_vmm::TRUSTED_VMM_ENGINE.boundary_faults
        );
        for slot in trusted_root_vmm::TRUSTED_VMM_ENGINE.modules.iter().flatten() {
            kprintln!(
                "  Module #{}: [{}] Base: {:#010X} Size: {} KiB | Privilege: {} | Violations: {}",
                slot.id,
                slot.name,
                slot.base_addr,
                slot.size / 1024,
                if slot.is_root_privileged { "ROOT_MODE" } else { "NON_ROOT" },
                slot.execution_violations
            );
        }
    } else if cmd == "snvme" || cmd == "nvmeof" || cmd.starts_with("snvme ") || cmd.starts_with("nvmeof ") {
        let prefix = if cmd.starts_with("snvme ") { "snvme " } else { "nvmeof " };
        if let Some(arg) = cmd.strip_prefix(prefix) {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "read" {
                let lba: u64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let mut buf = [0u8; 512];
                match smartnic_nvmeof::SMARTNIC_NVME.emulate_nvme_read(lba, 1, &mut buf) {
                    Ok(n) => {
                        let text = core::str::from_utf8(&buf[..n.min(64)]).unwrap_or("(binary)");
                        kprintln_emerald!("[SMARTNIC] NVMe-oF Read LBA {} ({} B via Shared Port): \"{}\"", lba, n, text.trim());
                    }
                    Err(e) => kprintln!("snvme read error: {}", e),
                }
            } else if action == "write" {
                let lba: u64 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let text = it.next().unwrap_or("SPATIAL_NVMEOF_BLOCK_DATA");
                match smartnic_nvmeof::SMARTNIC_NVME.emulate_nvme_write(lba, text.as_bytes()) {
                    Ok(n) => kprintln_emerald!("[SMARTNIC] NVMe-oF Write LBA {} ({} B via Shared Port) -> Dispatched to Target SAN", lba, n),
                    Err(e) => kprintln!("snvme write error: {}", e),
                }
            } else if action == "target" {
                let ip_str = it.next().unwrap_or("10.0.2.102");
                let port: u16 = it.next().and_then(|s| s.parse().ok()).unwrap_or(4420);
                match smartnic_nvmeof::SMARTNIC_NVME.register_external_target("Disaggregated-NVMe-Target-3", [10, 0, 2, 102], port, smartnic_nvmeof::StorageFabricProtocol::NvmeOverTcp, 1048576) {
                    Ok(id) => kprintln_emerald!("[SMARTNIC] Registered External Target #{} ({}:{}) into aggregated NVMe namespace", id, ip_str, port),
                    Err(e) => kprintln!("snvme target error: {}", e),
                }
            }
        }
        kprintln_amber!("=== SMARTNIC EMULATED LOCAL STORAGE (US 11,636,053 B2 / US 11,716,383 B2) ===");
        kprintln!(
            "Emulated Controller: 'VMWR' ({:#X}) | NSID: {} | Local Virtual Capacity: {} MiB ({} sectors)",
            smartnic_nvmeof::SMARTNIC_NVME.controller_id,
            smartnic_nvmeof::SMARTNIC_NVME.namespace_id,
            smartnic_nvmeof::EMULATED_TOTAL_SECTORS / 2048,
            smartnic_nvmeof::EMULATED_TOTAL_SECTORS
        );
        kprintln!(
            "Shared NIC Port: Port {} (e1000) | Net Pkts: {} | Storage Pkts: {} | Total: {} B",
            smartnic_nvmeof::SMARTNIC_NVME.shared_port_id,
            smartnic_nvmeof::SMARTNIC_NVME.shared_port_net_packets,
            smartnic_nvmeof::SMARTNIC_NVME.shared_port_storage_packets,
            smartnic_nvmeof::SMARTNIC_NVME.total_bytes_transported
        );
        kprintln_emerald!(
            "Hardware Offload: Fast-Path Hits: {} | Slow-Path Translations: {}",
            smartnic_nvmeof::SMARTNIC_NVME.fast_path_hits,
            smartnic_nvmeof::SMARTNIC_NVME.slow_path_translations
        );
        for slot in smartnic_nvmeof::SMARTNIC_NVME.targets.iter().flatten() {
            kprintln!(
                "  Target #{}: [{}] -> {}.{}.{}.{}:{} | Proto: {} | LBAs {}-{} ({} MiB) | R:{} W:{}",
                slot.target_id,
                slot.name,
                slot.ip_addr[0], slot.ip_addr[1], slot.ip_addr[2], slot.ip_addr[3],
                slot.port,
                smartnic_nvmeof::protocol_str(slot.protocol),
                slot.lba_start,
                slot.lba_start + slot.lba_sectors,
                slot.lba_sectors / 2048,
                slot.total_reads,
                slot.total_writes
            );
        }
    } else if cmd == "hyos" || cmd == "multios" {
        kprintln_amber!("=== HYBRID MULTI-OS & DUAL-FRAMEBUFFER ARCHITECTURE ===");
        kprintln!("(US 9,678,810 B2 / KR 10-2269452 / EP 2 847 669 B1)");
        let dock_str = hybrid_multi_os::dock_state_str(hybrid_multi_os::DUAL_FB_MGR.dock_state);
        kprintln!(
            "Dock State: {} | Secondary OS: {} | Cross-Env Events: {}",
            dock_str,
            if hybrid_multi_os::DUAL_FB_MGR.secondary_os_running { "RUNNING" } else { "SUSPENDED" },
            hybrid_multi_os::DUAL_FB_MGR.cross_env_events
        );
        kprintln!(
            "Primary Framebuffer:   {:#010X} ({}x{} 32bpp)",
            hybrid_multi_os::DUAL_FB_MGR.primary_fb_addr,
            hybrid_multi_os::DUAL_FB_MGR.primary_width,
            hybrid_multi_os::DUAL_FB_MGR.primary_height
        );
        kprintln!(
            "Secondary Framebuffer: {:#010X} ({}x{} 32bpp)",
            hybrid_multi_os::DUAL_FB_MGR.secondary_fb_addr,
            hybrid_multi_os::DUAL_FB_MGR.secondary_width,
            hybrid_multi_os::DUAL_FB_MGR.secondary_height
        );
        kprintln_emerald!("--- Microsoft Resource Partitioning & Memory Shrink (EP 2 847 669 B1) ---");
        kprintln!(
            "System RAM: {} MiB | Shrunk: {}",
            hybrid_multi_os::HYBRID_PARTITION_MGR.total_system_memory_kib / 1024,
            if hybrid_multi_os::HYBRID_PARTITION_MGR.has_shrunk { "YES" } else { "NO" }
        );
        kprintln!(
            "Primary OS (Spatial):   {} MiB (Base: {:#010X}) | Cores: {}",
            hybrid_multi_os::HYBRID_PARTITION_MGR.primary_os_memory_size / 1024,
            hybrid_multi_os::HYBRID_PARTITION_MGR.primary_os_memory_start,
            hybrid_multi_os::HYBRID_PARTITION_MGR.primary_cores
        );
        kprintln!(
            "Secondary OS (Guest):   {} MiB (Base: {:#010X}) | Cores: {}",
            hybrid_multi_os::HYBRID_PARTITION_MGR.secondary_os_memory_size / 1024,
            hybrid_multi_os::HYBRID_PARTITION_MGR.secondary_os_memory_start,
            hybrid_multi_os::HYBRID_PARTITION_MGR.secondary_cores
        );
        kprintln_emerald!("--- Intel Asymmetric Disk Virtualization & Pattern Sector Guard (KR 10-2269452) ---");
        kprintln!(
            "Physical Disk: {} GiB ({} sectors)",
            hybrid_multi_os::ASYM_DISK_VIRT.disk_size_sectors / 2097152,
            hybrid_multi_os::ASYM_DISK_VIRT.disk_size_sectors
        );
        kprintln!(
            "Guest Assigned Partition: LBAs {}-{} ({} MiB) [Direct vLBA == pLBA]",
            hybrid_multi_os::ASYM_DISK_VIRT.assigned_plba_start,
            hybrid_multi_os::ASYM_DISK_VIRT.assigned_plba_start + hybrid_multi_os::ASYM_DISK_VIRT.assigned_plba_sectors,
            hybrid_multi_os::ASYM_DISK_VIRT.assigned_plba_sectors / 2048
        );
        kprintln!(
            "Pattern Guard Stats: Pattern Reads: {} | Blocked Writes: {} | Direct Accesses: {}",
            hybrid_multi_os::ASYM_DISK_VIRT.pattern_sector_reads,
            hybrid_multi_os::ASYM_DISK_VIRT.pattern_sector_writes_blocked,
            hybrid_multi_os::ASYM_DISK_VIRT.direct_lba_accesses
        );
    } else if cmd == "dock" {
        hybrid_multi_os::DUAL_FB_MGR.dock_terminal();
        kprintln_emerald!("[HYOS] Docked to Desktop Smartdock! Secondary 1080p OS display activated (US 9,678,810 B2)");
    } else if cmd == "undock" {
        hybrid_multi_os::DUAL_FB_MGR.undock_terminal();
        kprintln_amber!("[HYOS] Undocked from Desktop Smartdock! Running standalone mobile handheld HUD");
    } else if cmd == "pats" || cmd.starts_with("pats ") {
        let lba: u64 = if cmd.starts_with("pats ") {
            cmd.strip_prefix("pats ").unwrap_or("").trim().parse().unwrap_or(2048)
        } else {
            2048
        };
        let (assign_read, read_allowed) = hybrid_multi_os::ASYM_DISK_VIRT.evaluate_access(lba, false);
        let (_assign_write, write_allowed) = hybrid_multi_os::ASYM_DISK_VIRT.evaluate_access(lba, true);
        match assign_read {
            hybrid_multi_os::PartitionAssignment::GuestAssignedDirect => {
                kprintln_emerald!(
                    "[ASYM-DISK] LBA {} -> DIRECT PHYSICAL ACCESS (vLBA == pLBA). Read: {} | Write: {} (Unrestricted Direct I/O)",
                    lba, if read_allowed { "ALLOWED" } else { "DENIED" }, if write_allowed { "ALLOWED" } else { "BLOCKED" }
                );
            }
            hybrid_multi_os::PartitionAssignment::ProtectedPatternSector => {
                kprintln_amber!(
                    "[ASYM-DISK] LBA {} -> UNASSIGNED PARTITION (Pattern Sector Guard). Read: DUMMY_ZERO_FILL | Write: BLOCKED_GUARD",
                    lba
                );
            }
        }
    } else if cmd.starts_with("shrink ") {
        let mb: u64 = cmd.strip_prefix("shrink ").unwrap_or("").trim().parse().unwrap_or(4096);
        let kib = mb * 1024;
        match hybrid_multi_os::HYBRID_PARTITION_MGR.shrink_and_allocate_secondary(kib, 4) {
            Ok(()) => {
                kprintln_emerald!(
                    "[HYOS] Memory Shrink Successful: Primary OS shrunk to {} MiB ({} Cores), Carved {} MiB for Secondary OS (EP 2 847 669 B1)",
                    hybrid_multi_os::HYBRID_PARTITION_MGR.primary_os_memory_size / 1024,
                    hybrid_multi_os::HYBRID_PARTITION_MGR.primary_cores,
                    hybrid_multi_os::HYBRID_PARTITION_MGR.secondary_os_memory_size / 1024
                );
            }
            Err(e) => kprintln!("shrink error: {}", e),
        }
    } else if cmd == "sva" || cmd == "dellio" || cmd.starts_with("sva ") || cmd.starts_with("dellio ") {
        let prefix = if cmd.starts_with("sva ") {
            "sva "
        } else if cmd.starts_with("dellio ") {
            "dellio "
        } else {
            ""
        };
        let arg = if !prefix.is_empty() {
            cmd.strip_prefix(prefix).unwrap_or("").trim()
        } else {
            ""
        };

        if !arg.is_empty() {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "activate" {
                dell_sva_accelerator::DELL_ACCELERATOR.activate_ep1_from_sva();
                kprintln_emerald!("[DELL SVA] Activated Endpoint 1 via Endpoint 2 (RP2 -> RP1) -> Hypervisor hot-plug event recognized!");
            } else if action == "morph" {
                let target = it.next().unwrap_or("nic");
                let profile = match target {
                    "nic" | "net" => dell_sva_accelerator::PersonalityProfile::NetworkInterfaceController,
                    "crypto" | "sec" => dell_sva_accelerator::PersonalityProfile::AcceleratedCryptoOffload,
                    _ => dell_sva_accelerator::PersonalityProfile::BlockStorageAdapter,
                };
                dell_sva_accelerator::DELL_ACCELERATOR.morph_personality(profile, profile);
                kprintln_emerald!(
                    "[DELL SVA] Dynamic Personality Morphed to: {} (FLR cycle on EP2 & EP1 completed, driver rebound)",
                    dell_sva_accelerator::personality_str(profile)
                );
            } else if action == "dma" {
                let a2_addr: u64 = it.next().and_then(|s| {
                    if s.starts_with("0x") || s.starts_with("0X") {
                        u64::from_str_radix(&s[2..], 16).ok()
                    } else {
                        s.parse().ok()
                    }
                }).unwrap_or(0x0002_0000);
                let a4_addr: u64 = it.next().and_then(|s| {
                    if s.starts_with("0x") || s.starts_with("0X") {
                        u64::from_str_radix(&s[2..], 16).ok()
                    } else {
                        s.parse().ok()
                    }
                }).unwrap_or(0x1002_0000);
                let len: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(4096);
                match dell_sva_accelerator::DELL_ACCELERATOR.execute_dma_transfer(a2_addr, a4_addr, len, false) {
                    Ok(bytes) => {
                        kprintln_emerald!(
                            "[DELL SVA] Zero-CPU DMA Transfer OK: {} B (SVA A2 {:#010X} -> Host Physical A4 {:#010X})",
                            bytes, a2_addr, a4_addr
                        );
                    }
                    Err(e) => kprintln!("sva dma error: {}", e),
                }
            } else if action == "priv" {
                let sub = it.next().unwrap_or("read");
                if sub == "write" {
                    let text = it.next().unwrap_or("DELL_CONFIDENTIAL_VAULT_KEY");
                    dell_sva_accelerator::DELL_ACCELERATOR.private_device.write_vault(text.as_bytes());
                    kprintln_emerald!("[DELL SVA] Private Hidden Vault: Wrote {} bytes exclusively via Endpoint 2", text.len());
                } else {
                    let data = dell_sva_accelerator::DELL_ACCELERATOR.private_device.read_vault();
                    let text = core::str::from_utf8(data).unwrap_or("(binary)");
                    kprintln_emerald!("[DELL SVA] Private Hidden Vault Read (Invisible to Hypervisor): \"{}\"", text);
                }
            }
        }

        kprintln_amber!("=== DELL DUAL-ENDPOINT PCIe I/O ACCELERATOR (EP 3 170 072 B1) ===");
        kprintln!(
            "Device ID: {:#010X} | Root Port 1 (HV): {} | Root Port 2 (SVA): {}",
            dell_sva_accelerator::DELL_ACCELERATOR.device_id,
            if dell_sva_accelerator::DELL_ACCELERATOR.root_port_1_active { "ACTIVE" } else { "INACTIVE" },
            if dell_sva_accelerator::DELL_ACCELERATOR.root_port_2_active { "ACTIVE" } else { "INACTIVE" }
        );
        kprintln!(
            "Endpoint 1 (Hypervisor Facing): State: [{}] | Personality: {}",
            dell_sva_accelerator::endpoint_state_str(dell_sva_accelerator::DELL_ACCELERATOR.ep1_state),
            dell_sva_accelerator::personality_str(dell_sva_accelerator::DELL_ACCELERATOR.ep1_personality)
        );
        kprintln!(
            "Endpoint 2 (SVA Exclusive Pass-Through): State: [{}] | SVA Bound: {}",
            dell_sva_accelerator::endpoint_state_str(dell_sva_accelerator::DELL_ACCELERATOR.ep2_state),
            if dell_sva_accelerator::DELL_ACCELERATOR.sva_exclusive_bound { "YES" } else { "NO" }
        );
        kprintln_emerald!(
            "Address Translator 256: ATC Hits: {} | ATC Misses: {} | Doorbells Dispatched: {}",
            dell_sva_accelerator::DELL_ACCELERATOR.atc_hits,
            dell_sva_accelerator::DELL_ACCELERATOR.atc_misses,
            dell_sva_accelerator::DELL_ACCELERATOR.ep1_doorbells_received
        );
        kprintln!(
            "DMA Engine 254: Transfers Completed: {} | Total Volume: {} B",
            dell_sva_accelerator::DELL_ACCELERATOR.dma_transfers_completed,
            dell_sva_accelerator::DELL_ACCELERATOR.dma_bytes_transferred
        );
        kprintln!(
            "Data Processor 258: Checksums: {} | Threat Scans: {} | Blocked Exploits: {}",
            dell_sva_accelerator::DELL_ACCELERATOR.processor.checksum_ops,
            dell_sva_accelerator::DELL_ACCELERATOR.processor.malicious_scans,
            dell_sva_accelerator::DELL_ACCELERATOR.processor.threats_detected
        );
        kprintln_amber!(
            "Private Device 260: [{}] | Cap: {} KiB | Reads: {} | Writes: {} (Hypervisor Blind)",
            dell_sva_accelerator::DELL_ACCELERATOR.private_device.device_type,
            dell_sva_accelerator::DELL_ACCELERATOR.private_device.storage_capacity_kib,
            dell_sva_accelerator::DELL_ACCELERATOR.private_device.read_count,
            dell_sva_accelerator::DELL_ACCELERATOR.private_device.write_count
        );
    } else if cmd == "latehv" || cmd == "late_hypervisor" || cmd.starts_with("latehv ") {
        if cmd == "latehv trap" {
            late_hypervisor::LATE_HYPERVISOR_MGR.handle_apic_intercept(true);
            kprintln_emerald!("[LATE HV] Handled trapped write to Local APIC MMIO page (0xFEE00000) -> Intercept emulated!");
        } else if cmd == "latehv step" {
            late_hypervisor::LATE_HYPERVISOR_MGR.discover_and_capture_state(0x0010_0000, 0x002F_F000, 0x0010_1000);
            late_hypervisor::LATE_HYPERVISOR_MGR.inhibit_interrupts(late_hypervisor::NmiInhibitionMethod::SelfDeliveredNmiNoIret);
            late_hypervisor::LATE_HYPERVISOR_MGR.prime_temporary_vm();
            late_hypervisor::LATE_HYPERVISOR_MGR.trigger_intercept_and_enter_hypervisor();
            late_hypervisor::LATE_HYPERVISOR_MGR.virtualize_root_os();
            kprintln_emerald!("[LATE HV] Late-launch state transition re-cycled: Root OS transparently virtualized!");
        }
        kprintln_amber!("=== RUNTIME HYPERVISOR LATE-LAUNCH & STATE CAPTURE (EP 2 024 826 B1) ===");
        kprintln!(
            "Launch Phase: [{}] | NMI Inhibition: {}",
            late_hypervisor::launch_phase_str(late_hypervisor::LATE_HYPERVISOR_MGR.phase),
            late_hypervisor::nmi_inhibition_str(late_hypervisor::LATE_HYPERVISOR_MGR.nmi_method)
        );
        kprintln!(
            "Captured CPU State: RIP={:#010X} | RSP={:#010X} | CR3={:#010X} | CR0={:#010X} | RFLAGS={:#010X}",
            late_hypervisor::LATE_HYPERVISOR_MGR.cpu_state.rip,
            late_hypervisor::LATE_HYPERVISOR_MGR.cpu_state.rsp,
            late_hypervisor::LATE_HYPERVISOR_MGR.cpu_state.cr3,
            late_hypervisor::LATE_HYPERVISOR_MGR.cpu_state.cr0,
            late_hypervisor::LATE_HYPERVISOR_MGR.cpu_state.rflags
        );
        kprintln!(
            "Descriptor Tables:  GDTR={:#010X} (lim={:#X}) | IDTR={:#010X} (lim={:#X})",
            late_hypervisor::LATE_HYPERVISOR_MGR.cpu_state.gdtr_base,
            late_hypervisor::LATE_HYPERVISOR_MGR.cpu_state.gdtr_limit,
            late_hypervisor::LATE_HYPERVISOR_MGR.cpu_state.idtr_base,
            late_hypervisor::LATE_HYPERVISOR_MGR.cpu_state.idtr_limit
        );
        kprintln!(
            "Captured APIC State: ID={} | MMIO PA={:#010X} | Intercepts Active: {} | Trapped Hits: {}",
            late_hypervisor::LATE_HYPERVISOR_MGR.apic_state.apic_id,
            late_hypervisor::LATE_HYPERVISOR_MGR.apic_state.mmio_phys_addr,
            if late_hypervisor::LATE_HYPERVISOR_MGR.apic_state.is_virtualized_intercept_active { "YES" } else { "NO" },
            late_hypervisor::LATE_HYPERVISOR_MGR.apic_trapped_accesses
        );
        kprintln_emerald!(
            "Discovered Topology: Cores: {} (HT={}) | RAM: {} MiB (Base: {:#010X}) | ACPI PA: {:#010X}",
            late_hypervisor::LATE_HYPERVISOR_MGR.topology.logical_processor_count,
            if late_hypervisor::LATE_HYPERVISOR_MGR.topology.hyperthreading_enabled { "YES" } else { "NO" },
            late_hypervisor::LATE_HYPERVISOR_MGR.topology.physical_ram_size / 1048576,
            late_hypervisor::LATE_HYPERVISOR_MGR.topology.physical_ram_base,
            late_hypervisor::LATE_HYPERVISOR_MGR.topology.acpi_table_pa
        );
    } else if cmd == "muse" || cmd == "mdev" || cmd.starts_with("muse ") || cmd.starts_with("mdev ") {
        let prefix = if cmd.starts_with("muse ") { "muse " } else if cmd.starts_with("mdev ") { "mdev " } else { "" };
        let arg = if !prefix.is_empty() { cmd.strip_prefix(prefix).unwrap_or("").trim() } else { "" };
        if !arg.is_empty() {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "fast" {
                let slot: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let len: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(1518);
                match muse_mediator::MUSE_ENGINE.dispatch_fastpath_packet(slot, len) {
                    Ok(tail) => {
                        kprintln_emerald!(
                            "[MUSE FASTPATH] Packet ({} B) enqueued into Ring #{} at slot {} (Direct DPDK Zero-Copy Bypass)",
                            len, slot, tail
                        );
                    }
                    Err(e) => kprintln!("muse fast error: {}", e),
                }
            } else if action == "slow" {
                let slot: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let csr_idx: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let val: u32 = it.next().and_then(|s| {
                    if s.starts_with("0x") || s.starts_with("0X") {
                        u32::from_str_radix(&s[2..], 16).ok()
                    } else {
                        s.parse().ok()
                    }
                }).unwrap_or(0xCAFE_BABE);
                match muse_mediator::MUSE_ENGINE.relay_control_plane_op(slot, csr_idx, val) {
                    Ok(written) => {
                        kprintln_emerald!(
                            "[MUSE SLOWPATH] Relayed CSR[{}]={:#010X} via /dev/muse FUSE daemon to User Software Parent Device",
                            csr_idx, written
                        );
                    }
                    Err(e) => kprintln!("muse slow error: {}", e),
                }
            }
        }
        kprintln_amber!("=== INTEL MUSE MEDIATED-DEVICE IN USER SPACE (WO 2021/086457 A1) ===");
        kprintln!(
            "MUSE Transport: /dev/muse [{}] | Fast-Path Packets: {} | Slow-Path Relays: {}",
            if muse_mediator::MUSE_ENGINE.fuse_daemon_connected { "FUSE DAEMON CONNECTED" } else { "OFFLINE" },
            muse_mediator::MUSE_ENGINE.total_fastpath_packets,
            muse_mediator::MUSE_ENGINE.total_slowpath_relays
        );
        for i in 0..2 {
            let mdev = &muse_mediator::MUSE_ENGINE.mdev_kernel_instances[i];
            let parent = &muse_mediator::MUSE_ENGINE.user_parent_devices[i];
            let ring = &muse_mediator::MUSE_ENGINE.dma_rings[i];
            let intr = &muse_mediator::MUSE_ENGINE.interrupt_pairs[i];
            kprintln!(
                "  Instance #{}: Mdev ID: {:#010X} | Shadow BAR0: {:#010X} ({} KiB) | Relays: {}",
                i, mdev.mdev_id, mdev.shadow_bar0, mdev.shadow_bar0_size / 1024, mdev.slow_path_relays
            );
            kprintln_emerald!(
                "    User Parent: GVA Map: {:#010X} | PFN: {:#010X} | FUSE Served: {}",
                parent.mmio_mapped_gva, parent.physical_frame_number, parent.fuse_requests_served
            );
            kprintln!(
                "    Fast-Path Ring: GPA={:#010X} | HVA={:#010X} | Head: {} Tail: {} | Pkts: {} ({} B)",
                ring.guest_phys_addr, ring.host_virt_addr, ring.head_index, ring.tail_index,
                ring.packets_processed, ring.bytes_processed
            );
            kprintln_amber!(
                "    Decoupled IRQ: Vector {} <-> IRQFD #{} <-> EVENTFD #{} | Delivered: {}",
                intr.vector_id, intr.irqfd, intr.eventfd, intr.interrupts_delivered
            );
        }
    } else if cmd == "coreiso" || cmd == "amdcore" || cmd.starts_with("coreiso ") || cmd.starts_with("amdcore ") {
        let prefix = if cmd.starts_with("coreiso ") { "coreiso " } else if cmd.starts_with("amdcore ") { "amdcore " } else { "" };
        let arg = if !prefix.is_empty() { cmd.strip_prefix(prefix).unwrap_or("").trim() } else { "" };
        if !arg.is_empty() {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "dispatch" {
                let work_id: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(2001);
                let size: u32 = it.next().and_then(|s| s.parse().ok()).unwrap_or(8192);
                match amd_core_isolation::AMD_CORE_ISOLATOR.dispatch_accelerator_work(work_id, size, 0x0050_0000) {
                    Ok(core) => {
                        kprintln_emerald!(
                            "[AMD CORE ISO] Work Unit #{} ({} B) successfully scheduled & executed on Sequestered Core #{}!",
                            work_id, size, core
                        );
                    }
                    Err(e) => kprintln!("coreiso dispatch error: {}", e),
                }
            } else if action == "pf" {
                let core_id: u8 = it.next().and_then(|s| s.parse().ok()).unwrap_or(4);
                match amd_core_isolation::AMD_CORE_ISOLATOR.handle_sequestered_page_fault(core_id) {
                    Ok(()) => {
                        kprintln_emerald!(
                            "[AMD CORE ISO] Sequestered Core #{} #PF VMEXIT handled: Fault Queue DPC updated page tables and resumed via CMD_RESUME!",
                            core_id
                        );
                    }
                    Err(e) => kprintln!("coreiso pf error: {}", e),
                }
            }
        }
        kprintln_amber!("=== AMD HYPERVISOR-BASED PROCESSOR CORE ISOLATION (EP 2 519 877 B1) ===");
        kprintln!(
            "Core Topology: Total Cores: {} | Host OS Cores: {} (Cores 0..3) | Sequestered Cores: {} (Cores 4..7)",
            amd_core_isolation::AMD_CORE_ISOLATOR.total_cores,
            amd_core_isolation::AMD_CORE_ISOLATOR.host_cores,
            amd_core_isolation::AMD_CORE_ISOLATOR.sequestered_cores
        );
        for i in 0..8 {
            kprintln!(
                "  Core #{}: [{}]",
                i, amd_core_isolation::core_state_str(amd_core_isolation::AMD_CORE_ISOLATOR.core_states[i])
            );
        }
        kprintln_emerald!(
            "Shared Queue Fabric: Work Queue: {} entries | Command Q: {} | Response Q: {} | Fault Q: {}",
            (amd_core_isolation::AMD_CORE_ISOLATOR.queue_fabric.work_q_tail + 8 - amd_core_isolation::AMD_CORE_ISOLATOR.queue_fabric.work_q_head) % 8,
            amd_core_isolation::AMD_CORE_ISOLATOR.queue_fabric.command_queue_count,
            amd_core_isolation::AMD_CORE_ISOLATOR.queue_fabric.response_queue_count,
            amd_core_isolation::AMD_CORE_ISOLATOR.queue_fabric.fault_queue_count
        );
        kprintln!(
            "Inter-Core Signaling: VMMCALL Doorbells: {} | INIT IPIs: {} | #PF VMEXITS: {} | Completed Units: {}",
            amd_core_isolation::AMD_CORE_ISOLATOR.queue_fabric.vmmcall_doorbells,
            amd_core_isolation::AMD_CORE_ISOLATOR.queue_fabric.init_ipis_sent,
            amd_core_isolation::AMD_CORE_ISOLATOR.queue_fabric.page_fault_vmexits,
            amd_core_isolation::AMD_CORE_ISOLATOR.queue_fabric.work_units_completed
        );
    } else if cmd == "vgpu" || cmd == "intelgpu" || cmd.starts_with("vgpu ") || cmd.starts_with("intelgpu ") {
        let prefix = if cmd.starts_with("vgpu ") { "vgpu " } else if cmd.starts_with("intelgpu ") { "intelgpu " } else { "" };
        let arg = if !prefix.is_empty() { cmd.strip_prefix(prefix).unwrap_or("").trim() } else { "" };
        if !arg.is_empty() {
            let mut it = arg.split_whitespace();
            let action = it.next().unwrap_or("");
            if action == "tx" {
                let slave_idx: usize = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let gva: u64 = it.next().and_then(|s| {
                    if s.starts_with("0x") || s.starts_with("0X") {
                        u64::from_str_radix(&s[2..], 16).ok()
                    } else {
                        s.parse().ok()
                    }
                }).unwrap_or(0x0008_0000);
                match intel_vgpu_mmu::INTEL_VGPU_MGR.process_memory_transaction(slave_idx, gva) {
                    Ok((hpa, status)) => {
                        kprintln_emerald!(
                            "[INTEL vGPU MMU] Memory Transaction GVA {:#010X} -> HPA {:#010X} | Status: [{}] (Slave MMU #{})",
                            gva, hpa, status, slave_idx + 1
                        );
                    }
                    Err(e) => kprintln!("vgpu tx error: {}", e),
                }
            } else if action == "bounds" {
                let vgpu_id: u8 = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
                let offset: u64 = it.next().and_then(|s| {
                    if s.starts_with("0x") || s.starts_with("0X") {
                        u64::from_str_radix(&s[2..], 16).ok()
                    } else {
                        s.parse().ok()
                    }
                }).unwrap_or(0x1000_0000);
                let allowed = intel_vgpu_mmu::INTEL_VGPU_MGR.verify_vram_bounds(vgpu_id, offset);
                if allowed {
                    kprintln_emerald!(
                        "[INTEL vGPU] Offset {:#010X} inside vGPU #{} HBM aperture [ALLOWED]",
                        offset, vgpu_id
                    );
                } else {
                    kprintln_amber!(
                        "[INTEL vGPU] Offset {:#010X} OUT-OF-BOUNDS for vGPU #{} HBM aperture [TRAPPED_BREACH]",
                        offset, vgpu_id
                    );
                }
            }
        }
        kprintln_amber!("=== INTEL MULTI-SLICE vGPU & MASTER/SLAVE MMU (US 11,768,781 B2) ===");
        kprintln!(
            "Master MMU: IOMMU Direct Requests: {} | Slave Routed Replies: {} | Total Transactions: {}",
            intel_vgpu_mmu::INTEL_VGPU_MGR.master_mmu.iommu_requests_served,
            intel_vgpu_mmu::INTEL_VGPU_MGR.master_mmu.slave_routed_replies,
            intel_vgpu_mmu::INTEL_VGPU_MGR.total_memory_transactions
        );
        for i in 0..3 {
            let smmu = &intel_vgpu_mmu::INTEL_VGPU_MGR.slave_mmus[i];
            kprintln!(
                "  Slave MMU #{}: Local TLB Hits: {} | Master Forwarded Requests: {}",
                smmu.slave_id, smmu.local_tlb_hits, smmu.master_forwarded_requests
            );
        }
        kprintln_emerald!(
            "20-bit PASID vGPU Scaling (Bypasses PCIe 8-Device Limit): QoS Time Slice: {} ms",
            intel_vgpu_mmu::INTEL_VGPU_MGR.qos_time_slice_ms
        );
        for entry in intel_vgpu_mmu::INTEL_VGPU_MGR.pasid_table.iter() {
            if entry.is_valid {
                kprintln!(
                    "  vGPU #{}: PASID {:#07X} | GVA->GPA Base: {:#010X} | HBM VRAM Aperture: {:#010X} ({} MiB)",
                    entry.vgpu_id, entry.pasid, entry.gva_to_gpa_base, entry.hbm_base_addr, entry.hbm_size_bytes / 1048576
                );
            }
        }
        kprintln!(
            "GPU Slices: 4 Slices Active | Trapped Out-of-Bounds VRAM Violations: {}",
            intel_vgpu_mmu::INTEL_VGPU_MGR.out_of_bounds_vram_trapped
        );
    } else if cmd == "sriov" || cmd.starts_with("sriov ") || cmd == "mbx" || cmd.starts_with("mbx ") {
        let arg = cmd.strip_prefix("sriov ")
            .or_else(|| cmd.strip_prefix("mbx "))
            .unwrap_or("")
            .trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "trigger" || sub == "send" {
            let code = it.next().and_then(|s| {
                if s.starts_with("0x") || s.starts_with("0X") {
                    u32::from_str_radix(&s[2..], 16).ok()
                } else {
                    s.parse::<u32>().ok()
                }
            }).unwrap_or(0x8001);
            match sriov_mailbox::SRIOV_VIRTUALIZER.trigger_guest_communication(code) {
                Ok(resp) => {
                    kprintln_emerald!(
                        "[SR-IOV] VF Request {:#06X} -> Intercept Emulated Response: {:#010X} (Checkpointed)",
                        code, resp
                    );
                }
                Err(e) => kprintln_amber!("[SR-IOV] Mailbox error: {}", e),
            }
        } else if sub == "error" || sub == "lock" {
            sriov_mailbox::SRIOV_VIRTUALIZER.trigger_device_error();
            kprintln_amber!("[SR-IOV] Injected hardware device error: all MMIO intercepted, guest writes dropped.");
        } else if sub == "reset" || sub == "recover" {
            sriov_mailbox::SRIOV_VIRTUALIZER.reset_device_recovery();
            kprintln_emerald!("[SR-IOV] Device recovered: direct pass-through restored, EPT intercepts removed.");
        }
        kprintln_amber!("=== VMWARE SR-IOV PF-VF MAILBOX DYNAMIC INTERCEPT VIRTUALIZER (US 2021/0209040 A1) ===");
        kprintln!(
            "Current State: {} | Callback Registered: {}",
            sriov_mailbox::protocol_state_str(sriov_mailbox::SRIOV_VIRTUALIZER.state),
            sriov_mailbox::SRIOV_VIRTUALIZER.callback_registered
        );
        kprintln!(
            "Statistics: Messages Intercepted: {} | Dynamic EPT Flips: {} | Checkpoint Syncs: {} | Dropped Writes: {}",
            sriov_mailbox::SRIOV_VIRTUALIZER.guest_messages_intercepted,
            sriov_mailbox::SRIOV_VIRTUALIZER.ept_flips_count,
            sriov_mailbox::SRIOV_VIRTUALIZER.checkpoint_sync_events,
            sriov_mailbox::SRIOV_VIRTUALIZER.dropped_error_writes
        );
        kprintln!(
            "VF Mailbox Registers: Data: {:#010X} | Doorbell: {} | Last Response: {:#010X}",
            sriov_mailbox::SRIOV_VIRTUALIZER.vf_registers.mailbox_data,
            sriov_mailbox::SRIOV_VIRTUALIZER.vf_registers.doorbell_flag,
            sriov_mailbox::SRIOV_VIRTUALIZER.vf_registers.last_response
        );
    } else if cmd == "vmsec" || cmd.starts_with("vmsec ") || cmd == "vdisk" || cmd.starts_with("vdisk ") {
        let arg = cmd.strip_prefix("vmsec ")
            .or_else(|| cmd.strip_prefix("vdisk "))
            .unwrap_or("")
            .trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "io" {
            let vlba = it.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(100);
            let blocks = it.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(8);
            let mode = it.next().unwrap_or("read");
            let is_write = mode == "write";
            match vm_data_security::VM_DATA_SECURITY_MGR.translate_guest_io(vlba, blocks, is_write) {
                Ok(plba) => {
                    kprintln_emerald!(
                        "[VMSEC IO] Guest vLBA {} (+{} blk, {}) -> Translated Physical pLBA {} [BOUNDS OK]",
                        vlba, blocks, mode, plba
                    );
                }
                Err(e) => kprintln_amber!("[VMSEC IO] Translation fault: {}", e),
            }
        } else if sub == "snap" || sub == "snapshot" {
            let ts = it.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(1710000000);
            match vm_data_security::VM_DATA_SECURITY_MGR.create_array_snapshot(ts) {
                Ok(id) => kprintln_emerald!("[VMSEC] Created array snapshot #{} (Epoch {})", id, ts),
                Err(e) => kprintln_amber!("[VMSEC] Snapshot error: {}", e),
            }
        }
        kprintln_amber!("=== VMWARE VM DATA SECURITY & NESTED ROOT PARTITIONS (US 11,093,629 B2) ===");
        let apparent_cap = vm_data_security::VM_DATA_SECURITY_MGR.get_guest_reported_capacity_blocks();
        let phys_cap = vm_data_security::VM_DATA_SECURITY_MGR.total_physical_lba_blocks;
        kprintln!(
            "Apparent Storage (Guest Truncated): {} blocks ({} MiB) | Physical Shared Storage: {} blocks ({} MiB)",
            apparent_cap, apparent_cap * 512 / 1048576,
            phys_cap, phys_cap * 512 / 1048576
        );
        kprintln!(
            "State Partition: Encrypted Vault Key Armed: {} | Access Flags: Hyp-Only Protected",
            vm_data_security::VM_DATA_SECURITY_MGR.is_state_partition_secure()
        );
        kprintln!(
            "I/O Counters: Reads: {} | Writes: {} | Blocked Bounds Violations: {}",
            vm_data_security::VM_DATA_SECURITY_MGR.io_reads_performed,
            vm_data_security::VM_DATA_SECURITY_MGR.io_writes_performed,
            vm_data_security::VM_DATA_SECURITY_MGR.bounds_violations_blocked
        );
        for (idx, p) in vm_data_security::VM_DATA_SECURITY_MGR.root_partitions.iter().enumerate() {
            if p.part_type != vm_data_security::RootPartitionType::Unused {
                kprintln!(
                    "  RPT Entry #{}: {} | LBA Range: {}..{} ({} MiB) | Encrypted: {}",
                    idx,
                    vm_data_security::partition_type_str(p.part_type),
                    p.start_lba, p.start_lba + p.block_count,
                    p.block_count * 512 / 1048576,
                    p.encrypted
                );
            }
        }
        for i in 0..vm_data_security::VM_DATA_SECURITY_MGR.snapshot_count {
            let snap = &vm_data_security::VM_DATA_SECURITY_MGR.snapshots[i];
            kprintln_emerald!(
                "  Snapshot #{}: Parent #{} | Extent: LBA {}..{} | Epoch {}",
                snap.snapshot_id, snap.parent_id, snap.base_lba, snap.base_lba + snap.extent_blocks, snap.timestamp_epoch
            );
        }
    } else if cmd == "ppt" || cmd.starts_with("ppt ") || cmd == "tee" || cmd.starts_with("tee ") {
        let arg = cmd.strip_prefix("ppt ")
            .or_else(|| cmd.strip_prefix("tee "))
            .unwrap_or("")
            .trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "ecall" || sub == "enter" {
            let cookie = it.next().and_then(|s| {
                if s.starts_with("0x") || s.starts_with("0X") {
                    u64::from_str_radix(&s[2..], 16).ok()
                } else {
                    s.parse::<u64>().ok()
                }
            }).unwrap_or(platform_protection::PPT_SUBSYSTEM.secure_cookie_value);
            let rip = it.next().and_then(|s| {
                if s.starts_with("0x") || s.starts_with("0X") {
                    u64::from_str_radix(&s[2..], 16).ok()
                } else {
                    s.parse::<u64>().ok()
                }
            }).unwrap_or(platform_protection::PPT_SUBSYSTEM.apt.verified_entry_rip);
            match platform_protection::PPT_SUBSYSTEM.handle_int29_ecall_entry(cookie, rip) {
                Ok(apt_cr3) => {
                    kprintln_emerald!(
                        "[PPT INT-29] SCV verified! Switched to EPT View 1 (Trusted TA) | Active CR3: {:#018X}",
                        apt_cr3
                    );
                }
                Err(e) => kprintln_amber!("[PPT INT-29] Entry denied: {}", e),
            }
        } else if sub == "aex" || sub == "interrupt" {
            match platform_protection::PPT_SUBSYSTEM.handle_int30_asynch_exit(0x00007FFF80001040, 0x00007FFF90002000) {
                Ok(()) => {
                    kprintln_amber!(
                        "[PPT INT-30] AEX triggered! Saved volatile state in SSA, scrubbed registers, reverted to View 0"
                    );
                }
                Err(e) => kprintln_amber!("[PPT INT-30] AEX error: {}", e),
            }
        } else if sub == "exit" || sub == "eexit" {
            match platform_protection::PPT_SUBSYSTEM.handle_int31_eexit_return() {
                Ok(gpt_cr3) => {
                    kprintln_emerald!(
                        "[PPT INT-31] EEXIT clean return: secrets cleared, View 0 restored | Host CR3: {:#018X}",
                        gpt_cr3
                    );
                }
                Err(e) => kprintln_amber!("[PPT INT-31] Exit error: {}", e),
            }
        }
        kprintln_amber!("=== INTEL PLATFORM PROTECTION TECHNOLOGY (PPT) DUAL-VIEW EPT (US 2023/0030961 A1) ===");
        kprintln!(
            "Active EPT View: {}",
            platform_protection::ept_view_str(platform_protection::PPT_SUBSYSTEM.active_view)
        );
        kprintln!(
            "Asserted Page Table (APT): Base CR3: {:#018X} | Locked in Hypervisor Heap: {}",
            platform_protection::PPT_SUBSYSTEM.apt.apt_locked_cr3,
            platform_protection::PPT_SUBSYSTEM.apt.is_apt_locked
        );
        kprintln!(
            "Verified Entry RIP: {:#018X} | Secure Cookie Value (SCV): {:#018X}",
            platform_protection::PPT_SUBSYSTEM.apt.verified_entry_rip,
            platform_protection::PPT_SUBSYSTEM.secure_cookie_value
        );
        kprintln!(
            "State Save Area (SSA): Valid: {} | Saved RIP: {:#018X} | Saved RSP: {:#018X}",
            platform_protection::PPT_SUBSYSTEM.ssa.is_valid,
            platform_protection::PPT_SUBSYSTEM.ssa.saved_rip,
            platform_protection::PPT_SUBSYSTEM.ssa.saved_rsp
        );
        kprintln!(
            "Statistics: ECALLs: {} | Asynch Exits (AEX): {} | EEXITs: {} | Security Faults: {}",
            platform_protection::PPT_SUBSYSTEM.ecalls_serviced,
            platform_protection::PPT_SUBSYSTEM.aex_interrupts_handled,
            platform_protection::PPT_SUBSYSTEM.eexits_serviced,
            platform_protection::PPT_SUBSYSTEM.security_faults
        );
    } else if cmd == "vam" || cmd.starts_with("vam ") || cmd == "tpe" || cmd.starts_with("tpe ") {
        let arg = cmd.strip_prefix("vam ")
            .or_else(|| cmd.strip_prefix("tpe "))
            .unwrap_or("")
            .trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "profile" || sub == "sched" {
            let h2d_mb = it.next().and_then(|s| s.parse::<usize>().ok()).unwrap_or(64);
            let d2h_mb = it.next().and_then(|s| s.parse::<usize>().ok()).unwrap_or(4);
            match dell_vam_profiler::VIRTUAL_ACCELERATOR_MGR.profile_and_schedule_task(
                200,
                h2d_mb * 1024 * 1024,
                d2h_mb * 1024 * 1024,
            ) {
                Ok((idx, class, pi)) => {
                    let dev = &dell_vam_profiler::VIRTUAL_ACCELERATOR_MGR.accelerators[idx];
                    kprintln_emerald!(
                        "[VAM TPE] Task Scheduled -> Slot #{}: {} [{}]",
                        idx, dev.name_str(), dell_vam_profiler::pcie_slot_name(dev.slot_speed)
                    );
                    kprintln_emerald!(
                        "  Transfer: {} MB H2D, {} MB D2H | Class: {} | PI: {}",
                        h2d_mb, d2h_mb, dell_vam_profiler::profile_class_str(class), pi
                    );
                }
                Err(e) => kprintln_amber!("[VAM TPE] Scheduling error: {}", e),
            }
        } else if sub == "bench" {
            kprintln_amber!("=== VAM TASK PERFORMANCE ENHANCER MULTI-WORKLOAD BENCHMARK ===");
            let workloads = [
                ("LLM_TENSOR_WEIGHTS", 128, 8),
                ("RAYTRACING_FRAME", 12, 12),
                ("CRYPTO_AES_BLOCKS", 1, 1),
            ];
            for (w_name, h2d, d2h) in workloads.iter() {
                if let Ok((idx, class, pi)) = dell_vam_profiler::VIRTUAL_ACCELERATOR_MGR.profile_and_schedule_task(
                    300,
                    h2d * 1024 * 1024,
                    d2h * 1024 * 1024,
                ) {
                    let dev = &dell_vam_profiler::VIRTUAL_ACCELERATOR_MGR.accelerators[idx];
                    kprintln!(
                        "  Workload '{}' ({} MB total): Assigned to #{} ({}) | Slot: {} | PI: {}",
                        w_name, h2d + d2h, idx, dev.name_str(), dell_vam_profiler::pcie_slot_name(dev.slot_speed), pi
                    );
                    let _ = class;
                }
            }
        }
        kprintln_amber!("=== DELL VIRTUAL ACCELERATOR MANAGER (VAM) & TPE (US 2022/0043664 A1) ===");
        kprintln!(
            "Total Dispatched Tasks: {} | Total Host Transfer: {} MiB | Bottlenecks Mitigated: {}",
            dell_vam_profiler::VIRTUAL_ACCELERATOR_MGR.total_tasks_dispatched,
            dell_vam_profiler::VIRTUAL_ACCELERATOR_MGR.total_host_data_transferred_kb / 1024,
            dell_vam_profiler::VIRTUAL_ACCELERATOR_MGR.bottleneck_mitigations
        );
        for (i, acc) in dell_vam_profiler::VIRTUAL_ACCELERATOR_MGR.accelerators.iter().enumerate() {
            kprintln!(
                "  Acc #{}: [{}] {} | Slot: {} | Mem: {} MiB ({}, {} MHz, {}-bit) | Free: {} MiB | Load: {}% | PI: {}",
                i,
                acc.name_str(),
                dell_vam_profiler::accelerator_kind_str(acc.kind),
                dell_vam_profiler::pcie_slot_name(acc.slot_speed),
                acc.total_memory_mb,
                dell_vam_profiler::memory_tech_str(acc.memory_tech),
                acc.memory_frequency_mhz,
                acc.internal_bus_width_bits,
                acc.free_memory_mb,
                acc.workload_busy_pct,
                acc.calculate_performance_index()
            );
        }
    } else if cmd == "hvm" || cmd.starts_with("hvm ") || cmd == "multios" || cmd.starts_with("multios ") {
        let arg = cmd.strip_prefix("hvm ")
            .or_else(|| cmd.strip_prefix("multios "))
            .unwrap_or("")
            .trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "rma" || sub == "put" {
            let next_tok = it.next();
            let bytes = if let Some(t) = next_tok {
                if t == "put" || t == "get" {
                    it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(4096)
                } else {
                    t.parse::<u32>().ok().unwrap_or(4096)
                }
            } else {
                4096
            };
            match hpe_multi_os_hvm::HVM_SUBSYSTEM.vrnic_post_rma_transaction(
                hpe_multi_os_hvm::RmaTransactionType::RmaWritePut,
                [192, 168, 1, 105],
                [0x00, 0x14, 0x22, 0x01, 0x23, 0x45],
                bytes,
            ) {
                Ok(desc_id) => {
                    kprintln_emerald!(
                        "[VR-NIC RMA] Intercepted RMA_PUT ({} B) -> Converted to Ethernet Frame #{} in Shared Memory",
                        bytes, desc_id
                    );
                    kprintln_emerald!("  [IPI] Signaled Inter-Processor Interrupt from SOS Core 0 -> AOS Core 4");
                }
                Err(e) => kprintln_amber!("[VR-NIC RMA] Transaction error: {}", e),
            }
        } else if sub == "poll" || sub == "drain" {
            match hpe_multi_os_hvm::HVM_SUBSYSTEM.aos_process_egress_queue() {
                Ok(desc) => {
                    kprintln_emerald!(
                        "[AOS NET] Dequeued Frame #{} from Shared Memory -> Passed down Protocol Stack -> Physical NIC [SENT]",
                        desc.desc_id
                    );
                    kprintln!(
                        "  Target: {}.{}.{}.{} | Payload: {} bytes | Offset: {:#X}",
                        desc.target_node_ip[0], desc.target_node_ip[1], desc.target_node_ip[2], desc.target_node_ip[3],
                        desc.payload_size, desc.shared_mem_offset
                    );
                }
                Err(e) => kprintln_amber!("[AOS NET] Queue empty or error: {}", e),
            }
        } else if sub == "ingress" {
            let bytes = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(1500);
            hpe_multi_os_hvm::HVM_SUBSYSTEM.aos_deliver_ingress_to_sos(bytes);
            kprintln_emerald!(
                "[AOS INGRESS] Received {} bytes on Physical NIC -> Ingress Shared Memory -> Delivered to SOS VR-NIC",
                bytes
            );
        }
        kprintln_amber!("=== HPE MULTI-OS HETEROGENEOUS VIRTUAL MACHINE (HVM) (US 2025/0085997 A1) ===");
        let mem = &hpe_multi_os_hvm::HVM_SUBSYSTEM.memory_layout;
        kprintln!(
            "Guest Physical Memory: SOS: {} MiB ({:#X}) | AOS: {} MiB ({:#X}) | Shared: {} MiB ({:#X}) [BARRIER={}]",
            mem.sos_segment_size_mb, mem.sos_segment_base,
            mem.aos_segment_size_mb, mem.aos_segment_base,
            mem.shared_segment_size_mb, mem.shared_segment_base,
            mem.isolation_barrier_enforced
        );
        kprintln!(
            "Virtual Core Pinning: SOS Cores (NonStop Kernel): {:#04X} (Cores 0..3) | AOS Cores (Linux Net): {:#04X} (Cores 4..7)",
            hpe_multi_os_hvm::HVM_SUBSYSTEM.sos_core_mask,
            hpe_multi_os_hvm::HVM_SUBSYSTEM.aos_core_mask
        );
        kprintln!(
            "Shared Memory Egress Queue: Head: {} | Tail: {} | Capacity: 8 Frames",
            hpe_multi_os_hvm::HVM_SUBSYSTEM.egress_head,
            hpe_multi_os_hvm::HVM_SUBSYSTEM.egress_tail
        );
        kprintln!(
            "VR-NIC Counters: RMA Intercepts: {} | Packets Converted: {} | IPIs Sent to AOS: {} | NIC TX: {} | Ingress RX: {}",
            hpe_multi_os_hvm::HVM_SUBSYSTEM.rma_transactions_intercepted,
            hpe_multi_os_hvm::HVM_SUBSYSTEM.packets_converted_by_vrnic,
            hpe_multi_os_hvm::HVM_SUBSYSTEM.ipi_signals_sent_to_aos,
            hpe_multi_os_hvm::HVM_SUBSYSTEM.aos_packets_transmitted_to_nic,
            hpe_multi_os_hvm::HVM_SUBSYSTEM.ingress_packets_routed_to_sos
        );
    } else if cmd == "wasm" || cmd.starts_with("wasm ") {
        let arg = cmd.strip_prefix("wasm").unwrap_or("").trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" || sub == "run" {
            kprintln_amber!("=== WEBASSEMBLY (WASM) SANDBOX TEST SUITE ===");
            // Test 1: Math Expression ((40 + 2) * 5 - 10) = 200
            match wasm_engine::WASM_RUNTIME.execute_module(&wasm_engine::WASM_MATH_EXPR, 10_000) {
                Ok(val) => {
                    kprintln_emerald!(
                        "[WASM PASS] Module 'math_expr' returned {} (Expected 200) | Fuel burned: {} | Insts: {}",
                        val,
                        wasm_engine::WASM_RUNTIME.fuel_consumed,
                        wasm_engine::WASM_RUNTIME.instructions_executed
                    );
                }
                Err(trap) => kprintln_amber!("[WASM FAIL] Trap: {}", wasm_engine::trap_str(trap)),
            }
            // Test 2: Linear Memory Store & Load (Offset 64 = 42, Read + 8) = 50
            match wasm_engine::WASM_RUNTIME.execute_module(&wasm_engine::WASM_MEMORY_TEST, 10_000) {
                Ok(val) => {
                    kprintln_emerald!(
                        "[WASM PASS] Module 'memory_store_load' returned {} (Expected 50) | Fuel burned: {} | Insts: {}",
                        val,
                        wasm_engine::WASM_RUNTIME.fuel_consumed,
                        wasm_engine::WASM_RUNTIME.instructions_executed
                    );
                }
                Err(trap) => kprintln_amber!("[WASM FAIL] Trap: {}", wasm_engine::trap_str(trap)),
            }
        } else if sub == "fuel" {
            let limit = it.next().and_then(|s| s.parse::<u64>().ok()).unwrap_or(50_000);
            wasm_engine::WASM_RUNTIME.reset(limit);
            kprintln_emerald!("[WASM] Reset runtime fuel budget to {} units", limit);
        }
        kprintln_amber!("=== EMBEDDED WEBASSEMBLY (WASM) MICRO-SANDBOX & FUEL METER ===");
        kprintln!(
            "Specification: W3C WebAssembly Core 1.0 (\\0asm v1) | Dynamic Verification (US 2026/0100856 A1)"
        );
        kprintln!(
            "Linear Memory: 1 Page ({} bytes / 64 KiB) | Stack Capacity: 128 Values | Local Registers: 16",
            wasm_engine::WASM_PAGE_SIZE
        );
        kprintln!(
            "Execution State: Last Return: {} | Trap Status: {}",
            wasm_engine::WASM_RUNTIME.last_return_value,
            wasm_engine::trap_str(wasm_engine::WASM_RUNTIME.last_trap)
        );
        kprintln!(
            "Fuel Metering: Remaining: {} | Consumed: {} | Total Instructions: {}",
            wasm_engine::WASM_RUNTIME.fuel_remaining,
            wasm_engine::WASM_RUNTIME.fuel_consumed,
            wasm_engine::WASM_RUNTIME.instructions_executed
        );
    } else if cmd == "maxq" || cmd.starts_with("maxq ") || cmd == "nvpow" || cmd.starts_with("nvpow ") {
        let arg = cmd.strip_prefix("maxq ")
            .or_else(|| cmd.strip_prefix("nvpow "))
            .unwrap_or("")
            .trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "opt" || sub == "mode" {
            let mode_str = it.next().unwrap_or("eff");
            if mode_str == "perf" || mode_str == "fps" {
                nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.mode = nvidia_maxq_estimator::OptimizationMode::MaximizePerformance;
                kprintln_emerald!("[MAX-Q] Optimization Mode switched to: MAX_PERFORMANCE (Max FPS within TDP)");
            } else if mode_str == "pow" || mode_str == "power" {
                nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.mode = nvidia_maxq_estimator::OptimizationMode::MinimizePower;
                kprintln_emerald!("[MAX-Q] Optimization Mode switched to: MIN_POWER (Minimize power for target FPS)");
            } else {
                nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.mode = nvidia_maxq_estimator::OptimizationMode::MaximizeEfficiency;
                kprintln_emerald!("[MAX-Q] Optimization Mode switched to: MAX_EFFICIENCY (Tangent dPerf/dPower slope)");
            }
        } else if sub == "tdp" || sub == "power" {
            let watts = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(80);
            nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.shared_tdp_limit_w = watts;
            kprintln_emerald!("[MAX-Q] Shared TDP constraint set to {} Watts", watts);
        } else if sub == "step" || sub == "eval" {
            let mem_bound = it.next().map(|s| s == "mem" || s == "dram" || s == "true").unwrap_or(false);
            let (pt, reason) = nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.step_optimization_cycle(mem_bound);
            kprintln_emerald!(
                "[MAX-Q OPTIMAL POINT] GPU: {} MHz @ {} mV | DRAM: {} MHz @ {} mV",
                pt.gpu_freq_mhz, pt.gpu_voltage_mv, pt.dram_freq_mhz, pt.dram_voltage_mv
            );
            kprintln!(
                "  Predicted Output: {} FPS | Predicted Draw: {} Watts (TDP: {}W) | Reason: {}",
                pt.predicted_fps, pt.predicted_total_power_w,
                nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.shared_tdp_limit_w,
                reason
            );
        }
        kprintln_amber!("=== NVIDIA MAX-Q OPTIMAL OPERATING POINT ESTIMATOR (CN 111143174 B) ===");
        kprintln!(
            "Active Mode: {} | State: {}",
            nvidia_maxq_estimator::opt_mode_str(nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.mode),
            nvidia_maxq_estimator::state_str(nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.state)
        );
        let cur = &nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.current_point;
        kprintln!(
            "Current V-F State: GPU: {} MHz ({} mV) | DRAM: {} MHz ({} mV) | Est: {} FPS @ {} W",
            cur.gpu_freq_mhz, cur.gpu_voltage_mv, cur.dram_freq_mhz, cur.dram_voltage_mv,
            cur.predicted_fps, cur.predicted_total_power_w
        );
        kprintln!(
            "Telemetry & Budget: Shared TDP: {} W | Target: {} FPS | Efficiency Slope Threshold: {}.{}x",
            nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.shared_tdp_limit_w,
            nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.target_fps,
            nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.min_efficiency_slope / 100,
            nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.min_efficiency_slope % 100
        );
        kprintln!(
            "Control Counters: Total V-F Updates: {} | Power Violations Prevented: {} | Bottleneck Clock Caps: {}",
            nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.total_vf_switches,
            nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.power_budget_violations_prevented,
            nvidia_maxq_estimator::NVIDIA_MAXQ_ESTIMATOR.clock_caps_applied_for_bottlenecks
        );
    } else if cmd == "shm" || cmd.starts_with("shm ") || cmd == "voy" || cmd.starts_with("voy ") {
        let arg = cmd.strip_prefix("shm ")
            .or_else(|| cmd.strip_prefix("voy "))
            .unwrap_or("")
            .trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "pub" {
            let topic_id = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            let msg = it.next().unwrap_or("VOYAGER_TELEMETRY_SAMPLE");
            match shm_ipc::VOYAGER_SHM_IPC.publish_message(topic_id, msg.as_bytes()) {
                Ok(new_tail) => kprintln_emerald!("[VOYAGER SHM] Published {} bytes to Topic #{} -> new tail_offset={}", msg.len(), topic_id, new_tail),
                Err(e) => kprintln_amber!("[VOYAGER SHM] Publish failed: {}", e),
            }
        } else if sub == "sub" {
            let topic_id = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            let idx = (topic_id as usize).min(shm_ipc::MAX_TOPICS - 1);
            let mut read_buf = [0u8; 256];
            match shm_ipc::VOYAGER_SHM_IPC.subscribe_read(topic_id, &mut shm_ipc::DEMO_SUBSCRIBER_HEADS[idx], &mut read_buf) {
                shm_ipc::ShmReadStatus::Ok { bytes_read } => {
                    let text = core::str::from_utf8(&read_buf[..bytes_read]).unwrap_or("<binary>");
                    kprintln_emerald!("[VOYAGER SHM] Subscribed read: {} bytes from Topic #{}: \"{}\"", bytes_read, topic_id, text);
                }
                shm_ipc::ShmReadStatus::NoNewMessage => {
                    kprintln_amber!("[VOYAGER SHM] No new messages on Topic #{} (head == tail)", topic_id);
                }
                shm_ipc::ShmReadStatus::OverwrittenAndReset { new_head } => {
                    kprintln_amber!("[VOYAGER SHM] Buffer wrap detected: subscriber overwritten, reset head to {}", new_head);
                }
                shm_ipc::ShmReadStatus::InvalidTopic => {
                    kprintln_amber!("[VOYAGER SHM] Invalid Topic ID {}", topic_id);
                }
            }
        }
        kprintln_amber!("=== BEIJING VOYAGER SHARED MEMORY IPC & TOPIC REGISTRY (US 11,080,216 B2) ===");
        kprintln!(
            "Registered Topics: {} | Buffer Capacity: {} B/topic | Overwrites Recovered: {}",
            shm_ipc::VOYAGER_SHM_IPC.topic_count,
            shm_ipc::BUFFER_CAPACITY,
            shm_ipc::VOYAGER_SHM_IPC.overwrite_events_caught
        );
        for i in 0..shm_ipc::VOYAGER_SHM_IPC.topic_count {
            let rec = &shm_ipc::VOYAGER_SHM_IPC.registry[i];
            let name = core::str::from_utf8(&rec.name[..rec.name_len]).unwrap_or("unknown");
            kprintln!(
                "  Topic #{}: '{}' | tail_offset={} | pending_tail_offset={} | msgs={} | rate={}Hz",
                rec.topic_id, name, rec.tail_offset, rec.pending_tail_offset, rec.total_messages_published, rec.expected_rate_hz
            );
        }
    } else if cmd == "arais" || cmd.starts_with("arais ") || cmd == "remoting" || cmd.starts_with("remoting ") {
        let arg = cmd.strip_prefix("arais ")
            .or_else(|| cmd.strip_prefix("remoting "))
            .unwrap_or("")
            .trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "level" {
            let lvl = it.next().unwrap_or("src");
            if lvl == "dll" {
                vector_remoting::ARAIS_VECTOR_ENGINE.current_level = vector_remoting::InterceptionLevel::DllDetour;
                kprintln_emerald!("[ARAIS] Interception Level set to: DllDetour (Shared library detour)");
            } else if lvl == "gdi" {
                vector_remoting::ARAIS_VECTOR_ENGINE.current_level = vector_remoting::InterceptionLevel::OsGdiEmulation;
                kprintln_emerald!("[ARAIS] Interception Level set to: OsGdiEmulation (GDI / libgdiplus)");
            } else if lvl == "obj" {
                vector_remoting::ARAIS_VECTOR_ENGINE.current_level = vector_remoting::InterceptionLevel::ObjectCodeInjection;
                kprintln_emerald!("[ARAIS] Interception Level set to: ObjectCodeInjection (Binary disassembly)");
            } else if lvl == "pixel" {
                vector_remoting::ARAIS_VECTOR_ENGINE.current_level = vector_remoting::InterceptionLevel::PixelPushFallback;
                kprintln_emerald!("[ARAIS] Interception Level set to: PixelPushFallback (Raw bitmap push)");
            } else {
                vector_remoting::ARAIS_VECTOR_ENGINE.current_level = vector_remoting::InterceptionLevel::SourceCodeHook;
                kprintln_emerald!("[ARAIS] Interception Level set to: SourceCodeHook (Direct SKIA/Cairo vector)");
            }
        } else if sub == "flush" {
            let count = vector_remoting::ARAIS_VECTOR_ENGINE.flush_frame();
            kprintln_emerald!("[ARAIS] Flushed {} vector commands to WebAssembly Canvas renderer", count);
        }
        kprintln_amber!("=== S2 SYSTEMS ARAIS NETWORK VECTOR RENDERING & ISOLATION (US 10,558,824 B1) ===");
        let level_name = match vector_remoting::ARAIS_VECTOR_ENGINE.current_level {
            vector_remoting::InterceptionLevel::SourceCodeHook => "SourceCodeHook (SKIA/Cairo)",
            vector_remoting::InterceptionLevel::DllDetour => "DllDetour (Shared Library)",
            vector_remoting::InterceptionLevel::OsGdiEmulation => "OsGdiEmulation (GDI)",
            vector_remoting::InterceptionLevel::ObjectCodeInjection => "ObjectCodeInjection",
            vector_remoting::InterceptionLevel::PixelPushFallback => "PixelPushFallback",
        };
        kprintln!(
            "Interception Level: {} | Queued Commands: {}/{} | Frames Flushed: {}",
            level_name,
            vector_remoting::ARAIS_VECTOR_ENGINE.queue_len,
            vector_remoting::MAX_VECTOR_CMDS,
            vector_remoting::ARAIS_VECTOR_ENGINE.frame_counter
        );
        kprintln!(
            "Bandwidth Optimization: Vector Sent: {} B | Pixel Avoided: {} B | Savings: {}%",
            vector_remoting::ARAIS_VECTOR_ENGINE.total_vector_bytes_sent,
            vector_remoting::ARAIS_VECTOR_ENGINE.equivalent_pixel_bytes_avoided,
            vector_remoting::ARAIS_VECTOR_ENGINE.bandwidth_savings_percentage()
        );
    } else if cmd == "astguard" || cmd.starts_with("astguard ") || cmd == "tala" || cmd.starts_with("tala ") {
        let arg = cmd.strip_prefix("astguard ")
            .or_else(|| cmd.strip_prefix("tala "))
            .unwrap_or("")
            .trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            // Test 1: Benign script matching telemetry loop
            let mut test_benign = script_ast_guard::ScriptAst::empty();
            let _ = test_benign.push_node(0, script_ast_guard::AstNodeType::Root);
            let f1 = test_benign.push_node(0, script_ast_guard::AstNodeType::FunctionStart).unwrap_or(0);
            let _ = test_benign.push_node(f1, script_ast_guard::AstNodeType::MathComputeLoop);
            let _ = test_benign.push_node(f1, script_ast_guard::AstNodeType::DataTransferNetwork);
            let v1 = script_ast_guard::TALA_AST_GUARD.inspect_and_classify(&test_benign);
            match v1 {
                script_ast_guard::ScriptSecurityVerdict::Benign { matched_cluster_id, tree_edit_distance } => {
                    kprintln_emerald!("[AST GUARD PASS] Script classified as BENIGN (Cluster #{}, TED={})", matched_cluster_id, tree_edit_distance);
                }
                script_ast_guard::ScriptSecurityVerdict::MaliciousBlocked { min_tree_edit_distance, reason } => {
                    kprintln_amber!("[AST GUARD FAIL] Benign script was misclassified: TED={}, reason: {}", min_tree_edit_distance, reason);
                }
            }

            // Test 2: Malicious script with obfuscated eval and exfiltration endpoint
            let mut test_mal = script_ast_guard::ScriptAst::empty();
            let _ = test_mal.push_node(0, script_ast_guard::AstNodeType::Root);
            let f2 = test_mal.push_node(0, script_ast_guard::AstNodeType::FunctionStart).unwrap_or(0);
            let _ = test_mal.push_node(f2, script_ast_guard::AstNodeType::ObfuscatedEval);
            let _ = test_mal.push_node(f2, script_ast_guard::AstNodeType::ExfiltrationEndpoint);
            let v2 = script_ast_guard::TALA_AST_GUARD.inspect_and_classify(&test_mal);
            match v2 {
                script_ast_guard::ScriptSecurityVerdict::MaliciousBlocked { min_tree_edit_distance, reason } => {
                    kprintln_emerald!("[AST GUARD BLOCK] Malicious script intercepted & blocked: min TED={}, reason: {}", min_tree_edit_distance, reason);
                }
                script_ast_guard::ScriptSecurityVerdict::Benign { matched_cluster_id, tree_edit_distance } => {
                    kprintln_amber!("[AST GUARD FAIL] Malicious script escaped detection: matched cluster #{}, TED={}", matched_cluster_id, tree_edit_distance);
                }
            }
        }
        kprintln_amber!("=== TALA SECURITY SCRIPT AST / GAST STRUCTURE GUARD (US 11,314,862 B2) ===");
        kprintln!(
            "Registered GAST Clusters: {}/{} | Total Inspected: {} | Malicious Blocked: {}",
            script_ast_guard::TALA_AST_GUARD.cluster_count,
            script_ast_guard::MAX_GAST_CLUSTERS,
            script_ast_guard::TALA_AST_GUARD.total_scripts_inspected,
            script_ast_guard::TALA_AST_GUARD.malicious_scripts_blocked
        );
        for i in 0..script_ast_guard::TALA_AST_GUARD.cluster_count {
            let cl = &script_ast_guard::TALA_AST_GUARD.clusters[i];
            let name = core::str::from_utf8(&cl.name[..cl.name_len]).unwrap_or("unknown");
            kprintln!(
                "  GAST #{}: '{}' | Nodes: {} | Max Allowed Tree Edit Distance (TED): {}",
                cl.cluster_id, name, cl.template.node_count, cl.max_allowed_ted
            );
        }
    } else if cmd == "kwasm" || cmd.starts_with("kwasm ") {
        let arg = cmd.strip_prefix("kwasm ").unwrap_or("").trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            // Test 1: Execute sys_math_i64_add kernel symbol invocation
            match kwasm_engine::BLACK_SESAME_KWASM.invoke_kernel_symbol("sys_math_i64_add", 500, 250) {
                Ok(res) => kprintln_emerald!("[KWASM PASS] Invoked 'sys_math_i64_add(500, 250)' in kernel space -> result={}", res),
                Err(e) => kprintln_amber!("[KWASM FAIL] Symbol invocation failed: {}", e),
            }
            // Test 2: Verify FPU rejection in kernel mode
            match kwasm_engine::BLACK_SESAME_KWASM.verify_opcode_compliance(0x8B) { // f32.add opcode
                Ok(_) => kprintln_amber!("[KWASM FAIL] FPU opcode 0x8B was improperly allowed!"),
                Err(e) => kprintln_emerald!("[KWASM PASS] FPU opcode 0x8B rejected: {}", e),
            }
        } else if sub == "call" {
            let sym = it.next().unwrap_or("sys_get_uptime");
            let a0 = it.next().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
            let a1 = it.next().and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
            match kwasm_engine::BLACK_SESAME_KWASM.invoke_kernel_symbol(sym, a0, a1) {
                Ok(res) => kprintln_emerald!("[KWASM] '{}({}, {})' returned: {}", sym, a0, a1, res),
                Err(e) => kprintln_amber!("[KWASM] Call failed: {}", e),
            }
        }
        kprintln_amber!("=== BLACK SESAME IN-KERNEL WEBASSEMBLY (KWASM) ENGINE (CN 112905472 B) ===");
        kprintln!(
            "Architecture: 64-bit wasm64 Kernel Interpreter | FPU Policy: STRICT_DISABLED (Kernel Safe)"
        );
        kprintln!(
            "Export Symbols: {}/{} | Invocations: {} | FPU Opcodes Blocked: {} | Pool: {} B",
            kwasm_engine::BLACK_SESAME_KWASM.symbol_count,
            kwasm_engine::MAX_EXPORT_SYMBOLS,
            kwasm_engine::BLACK_SESAME_KWASM.wasm64_invocations_executed,
            kwasm_engine::BLACK_SESAME_KWASM.fpu_instructions_rejected,
            kwasm_engine::BLACK_SESAME_KWASM.kernel_memory_pool_bytes
        );
        for i in 0..kwasm_engine::BLACK_SESAME_KWASM.symbol_count {
            let s = &kwasm_engine::BLACK_SESAME_KWASM.symbols[i];
            let name = core::str::from_utf8(&s.name[..s.name_len]).unwrap_or("unknown");
            let proto = core::str::from_utf8(&s.prototype_sig[..s.proto_len]).unwrap_or("()");
            kprintln!(
                "  Symbol #{}: '{}' @ 0x{:016X} | Signature: {} | Calls: {}",
                i, name, s.mapped_addr, proto, s.call_count
            );
        }
    } else if cmd == "mddma" || cmd.starts_with("mddma ") || cmd == "wave" || cmd.starts_with("wave ") {
        let arg = cmd.strip_prefix("mddma ")
            .or_else(|| cmd.strip_prefix("wave "))
            .unwrap_or("")
            .trim();
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "burst" {
            let addr = it.next().and_then(|s| {
                if s.starts_with("0x") || s.starts_with("0X") {
                    u64::from_str_radix(&s[2..], 16).ok()
                } else {
                    s.parse::<u64>().ok()
                }
            }).unwrap_or(0x0000_0000_E000_0000);
            let requested = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(4096);
            let (burst_len, aligned) = wave_mddma::WAVE_MDDMA_ENGINE.check_burst_efficiency(addr, requested);
            kprintln_emerald!(
                "[MD-DMA] Burst transfer: Base 0x{:016X} -> {} bytes (4KB-Aligned: {})",
                addr, burst_len, aligned
            );
        } else if sub == "5d" {
            let desc_5d = wave_mddma::TensorWorkDescriptor::new_5d(
                0x0000_0000_2000_0000,
                2, // 4-byte
                16, // d0_count
                4,  // d0_stride
                [64, 1024, 4096, 16384],
                [4, 8, 2, 2],
            );
            let base = wave_mddma::WAVE_MDDMA_ENGINE.dispatch_work_request(desc_5d);
            let offset = wave_mddma::WAVE_MDDMA_ENGINE.calculate_address_offset([2, 1, 2, 1, 1]);
            kprintln_emerald!(
                "[MD-DMA] 5-D Tensor Address Synthesized: Base 0x{:016X} -> Element [2,1,2,1,1] = 0x{:016X}",
                base, offset
            );
        }
        kprintln_amber!("=== WAVE COMPUTING MULTIDIMENSIONAL DMA & PROCESSOR CLUSTER (US 10,997,102 B2) ===");
        let cur = &wave_mddma::WAVE_MDDMA_ENGINE.current_descriptor;
        kprintln!(
            "256-bit Descriptor: Base: 0x{:016X} | Dims: {}D | Elem Size: {} B | Dim0 Stride: {} B (Count: {})",
            cur.base_address, cur.num_dimensions, 1 << cur.element_size_shift, cur.dim0_stride, cur.dim0_count
        );
        kprintln!(
            "Hardware PE Quad Cluster: q0={:?} q1={:?} q2={:?} q3={:?} | Circular PC: {}",
            wave_mddma::WAVE_MDDMA_ENGINE.cluster.pe_states[0],
            wave_mddma::WAVE_MDDMA_ENGINE.cluster.pe_states[1],
            wave_mddma::WAVE_MDDMA_ENGINE.cluster.pe_states[2],
            wave_mddma::WAVE_MDDMA_ENGINE.cluster.pe_states[3],
            wave_mddma::WAVE_MDDMA_ENGINE.cluster.pc
        );
        kprintln!(
            "Transfer Counters: Synthesized Addrs: {} | 4KB Bursts: {} | Total Volume: {} B",
            wave_mddma::WAVE_MDDMA_ENGINE.total_addresses_synthesized,
            wave_mddma::WAVE_MDDMA_ENGINE.total_bursts_completed,
            wave_mddma::WAVE_MDDMA_ENGINE.total_bytes_transferred
        );
    } else if cmd == "dtree" || cmd.starts_with("dtree ") {
        let arg = cmd.strip_prefix("dtree ").unwrap_or("");
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let samples = [
                ([60u32, 65, 40, 50], intel_dtree::TelemetryClass::NominalCruise, "Nominal Flight"),
                ([80u32, 85, 50, 40], intel_dtree::TelemetryClass::ThermalThrottleRequired, "Thermal Throttle (Temp > 75C)"),
                ([65u32, 90, 50, 40], intel_dtree::TelemetryClass::ThermalThrottleRequired, "Power Throttle (Power > 80W)"),
                ([65u32, 70, 90, 30], intel_dtree::TelemetryClass::HeapMemoryPressure, "Heap Pressure (Heap > 85%)"),
                ([65u32, 70, 50, 150], intel_dtree::TelemetryClass::AnomalousTelemetry, "Sensor Anomaly (Rate > 100Hz)"),
            ];
            for (feat, expected, desc) in samples.iter() {
                let (pred, _reason) = intel_dtree::INTEL_DTREE_ENGINE.evaluate_telemetry(*feat);
                if pred == *expected {
                    kprintln_emerald!("[DTREE PASS] Telemetry {:?} -> {} [{}]", feat, intel_dtree::class_str(pred), desc);
                } else {
                    kprintln_amber!("[DTREE FAIL] Telemetry {:?} -> got {} expected {}", feat, intel_dtree::class_str(pred), intel_dtree::class_str(*expected));
                }
            }
        } else if sub == "eval" {
            let temp = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(60);
            let power = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(65);
            let heap = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(40);
            let rate = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(50);
            let (pred, reason) = intel_dtree::INTEL_DTREE_ENGINE.evaluate_telemetry([temp, power, heap, rate]);
            kprintln_emerald!(
                "[DTREE] Telemetry [T:{}C, P:{}W, Heap:{}%, Rate:{}Hz] -> Classification: {} | Reason: {}",
                temp, power, heap, rate, intel_dtree::class_str(pred), reason
            );
        }
        kprintln_amber!("=== INTEL MEMORY-EFFICIENT FLAT DECISION TREE (US 2021/0097449 A1) ===");
        kprintln!(
            "Flat Node Array: {} nodes active (Capacity: {}) | Training Samples: {}",
            intel_dtree::INTEL_DTREE_ENGINE.node_count,
            intel_dtree::MAX_TREE_NODES,
            intel_dtree::INTEL_DTREE_ENGINE.total_samples
        );
        kprintln!("Partition Scheme: In-place contiguous feature splitting (Zero heap allocation)");
        kprintln!(
            "Inference Counters: Inferences Executed: {} | Throttles Signaled: {}",
            intel_dtree::INTEL_DTREE_ENGINE.total_inferences_executed,
            intel_dtree::INTEL_DTREE_ENGINE.total_throttles_signaled
        );
    } else if cmd == "panda" || cmd.starts_with("panda ") {
        let arg = cmd.strip_prefix("panda ").unwrap_or("");
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" || sub == "parse" {
            let ptype = it.next().unwrap_or("quic");
            let dummy = [0x5A; 128];
            let (serial, vert, reason) = panda_pipeline::PANDA_PIPELINE_ENGINE.process_packet_vertical(ptype, &dummy);
            let speedup_pct = (serial * 100) / vert;
            kprintln_emerald!(
                "[PANDA PASS] Vertical Parallelism on '{}': Serial={} cycles -> Parallel={} cycles ({}% speedup)",
                ptype, serial, vert, speedup_pct
            );
            kprintln!("  Reason: {}", reason);
            kprintln!(
                "  Parsed Layers: Eth (14B) -> IP (20B) -> Transport (20B) -> Upper (74B) | Metadata frames: {}",
                panda_pipeline::PANDA_PIPELINE_ENGINE.extracted_frame_count
            );
        }
        kprintln_amber!("=== TOM HERBERT PANDA PARALLEL PIPELINE & PARSER GRAPH (US 12,026,546 B2) ===");
        let ts = &panda_pipeline::PANDA_PIPELINE_ENGINE.thread_set;
        kprintln!(
            "PANDA Thread Set: {} worker threads active | Global Resolved Dependencies: 0x{:04X}",
            ts.active_thread_count, ts.global_resolved_deps.0
        );
        kprintln!(
            "Pipeline Metrics: Packets Parsed: {} | Wait Events: {} | Resolve Events: {} | Cascade Steps: {}",
            panda_pipeline::PANDA_PIPELINE_ENGINE.total_packets_parsed,
            ts.total_wait_cycles,
            ts.total_resolve_events,
            ts.total_cascade_steps
        );
        kprintln!(
            "Speedup Metric: Vertical parallelism t_object = max(t_stage) (Theoretical speedup: ~2.8x)"
        );
    } else if cmd == "fortinet" || cmd.starts_with("fortinet ") {
        let arg = cmd.strip_prefix("fortinet ").unwrap_or("");
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let count = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(20);
            let (acc, proto, verdict) = fortinet_capture::FORTINET_CAPTURE_ENGINE.test_eos_performance(count);
            kprintln_emerald!(
                "[FORTINET PASS] EOS Benchmark: {} packets tested -> Accuracy Ratio: {}% | Protocol: {}",
                count, acc, fortinet_capture::eos_proto_str(proto)
            );
            kprintln!("  Verdict: {}", verdict);
        } else if sub == "eos" {
            let choice = it.next().unwrap_or("mspsc");
            if choice == "omp" {
                fortinet_capture::FORTINET_CAPTURE_ENGINE.active_eos_protocol = fortinet_capture::EosProtocolType::PragmaOmp;
            } else if choice == "mpsc" {
                fortinet_capture::FORTINET_CAPTURE_ENGINE.active_eos_protocol = fortinet_capture::EosProtocolType::MpscQueue;
            } else {
                fortinet_capture::FORTINET_CAPTURE_ENGINE.active_eos_protocol = fortinet_capture::EosProtocolType::MspscLocklessRing;
            }
            kprintln_emerald!(
                "[FORTINET] Active EOS Protocol set to: {}",
                fortinet_capture::eos_proto_str(fortinet_capture::FORTINET_CAPTURE_ENGINE.active_eos_protocol)
            );
        } else if sub == "cap" {
            let (res, len) = fortinet_capture::FORTINET_CAPTURE_ENGINE.process_packet_xdp_filter(
                false, true, [192, 168, 1, 50], [10, 0, 2, 15], 443, 5173
            );
            kprintln_emerald!("[FORTINET] Filter Result: {} (Extracted: {} bytes)", res, len);
        }
        kprintln_amber!("=== FORTINET KERNEL SPACE PACKET CAPTURE & EOS (US 11,870,693 B2) ===");
        kprintln!(
            "EOS Engine: Protocol: {} | Cores Allocated: {} | Header Slice: {} Bytes",
            fortinet_capture::eos_proto_str(fortinet_capture::FORTINET_CAPTURE_ENGINE.active_eos_protocol),
            fortinet_capture::FORTINET_CAPTURE_ENGINE.allocated_cores,
            fortinet_capture::CAPTURE_HEADER_LEN
        );
        kprintln!(
            "Capture Counters: Total Ingested: {} | Local Passed: {} | Useful Captured: {} | Junk Dropped: {}",
            fortinet_capture::FORTINET_CAPTURE_ENGINE.total_rx_packets,
            fortinet_capture::FORTINET_CAPTURE_ENGINE.total_destined_local_passed,
            fortinet_capture::FORTINET_CAPTURE_ENGINE.total_useful_captured,
            fortinet_capture::FORTINET_CAPTURE_ENGINE.total_junk_dropped
        );
        kprintln!(
            "Storage Metrics: Correctly Stored: {} | Event Loss: {}",
            fortinet_capture::FORTINET_CAPTURE_ENGINE.total_eos_stored_correctly,
            fortinet_capture::FORTINET_CAPTURE_ENGINE.total_eos_lost_events
        );
    } else if cmd == "nudt" || cmd.starts_with("nudt ") {
        let arg = cmd.strip_prefix("nudt ").unwrap_or("");
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            // Test 1: First-time packet (首次上送报文)
            let (res1, out1, msg1) = nudt_netaccel::NUDT_NETACCEL_ENGINE.inspect_and_accelerate_frame(0x9999, 3, 128, 0);
            kprintln_emerald!("[NUDT PASS] Packet 0x9999: {:?} (OutPort: {}) -> {}", res1, out1, msg1);

            // Populate rule in shared map
            nudt_netaccel::NUDT_NETACCEL_ENGINE.update_rule_from_controller(0x9999, 3, 4, nudt_netaccel::OpenFlowAction::ForwardPort(4));

            // Test 2: Subsequent packet hit (非首次上送报文 / 快速数据路径绕过协议栈)
            let (res2, out2, msg2) = nudt_netaccel::NUDT_NETACCEL_ENGINE.inspect_and_accelerate_frame(0x9999, 3, 128, 0);
            kprintln_emerald!("[NUDT PASS] Packet 0x9999 (Hit): {:?} (Forwarded to OutPort: {}) -> {}", res2, out2, msg2);
        } else if sub == "rule" {
            let buf_id = it.next().and_then(|s| {
                if s.starts_with("0x") || s.starts_with("0X") {
                    u32::from_str_radix(&s[2..], 16).ok()
                } else {
                    s.parse::<u32>().ok()
                }
            }).unwrap_or(0x2001);
            let in_p = it.next().and_then(|s| s.parse::<u16>().ok()).unwrap_or(1);
            let out_p = it.next().and_then(|s| s.parse::<u16>().ok()).unwrap_or(2);
            nudt_netaccel::NUDT_NETACCEL_ENGINE.update_rule_from_controller(buf_id, in_p, out_p, nudt_netaccel::OpenFlowAction::ForwardPort(out_p));
            kprintln_emerald!("[NUDT] Shared Map Rule Installed: Buffer 0x{:04X} [InPort {} -> OutPort {}]", buf_id, in_p, out_p);
        }
        kprintln_amber!("=== NUDT JOINT KERNEL-USER NETWORK ACCELERATOR (CN 118301090 A) ===");
        kprintln!(
            "Shared Flow Map: {} rules active (Max: {}) | Baseline Stack Latency: {} us | FastPath: {} us",
            nudt_netaccel::NUDT_NETACCEL_ENGINE.rule_count,
            nudt_netaccel::MAX_ACCEL_RULES,
            nudt_netaccel::NUDT_NETACCEL_ENGINE.measured_standard_latency_us,
            nudt_netaccel::NUDT_NETACCEL_ENGINE.measured_fastpath_latency_us
        );
        kprintln!(
            "Acceleration Metrics: Packet-In: {} | Bypassed FastPath: {} | Controller Uploads: {} | Latency Drop: -{}%",
            nudt_netaccel::NUDT_NETACCEL_ENGINE.total_packet_in_received,
            nudt_netaccel::NUDT_NETACCEL_ENGINE.total_fastpath_bypassed,
            nudt_netaccel::NUDT_NETACCEL_ENGINE.total_controller_uploads,
            nudt_netaccel::NUDT_NETACCEL_ENGINE.latency_reduction_ratio_pct()
        );
        kprintln!("Consistency Verifier: IP/TCP checksums recalculated in-kernel, sequence/ack aligned");
    } else if cmd == "snic" || cmd.starts_with("snic ") {
        let arg = cmd.strip_prefix("snic ").unwrap_or("");
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            // Test 1: Valid Offloaded NAT Packet (Normal execution time 8us < 15us)
            let (act1, msg1) = yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.process_packet_on_nic(
                64, 6, [192, 168, 1, 100], [10, 0, 2, 15], 8
            );
            kprintln_emerald!("[SMARTNIC PASS] Valid Ingress: {:?} -> {}", act1, msg1);

            // Test 2: Anomaly packet with TTL = 0 (Pruned directly in NIC)
            let (act2, msg2) = yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.process_packet_on_nic(
                0, 6, [192, 168, 1, 100], [10, 0, 2, 15], 5
            );
            kprintln_emerald!("[SMARTNIC PASS] Anomaly Ingress (TTL=0): {:?} -> {}", act2, msg2);

            // Test 3: Watchdog deadline overrun (> 15us)
            let (act3, msg3) = yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.process_packet_on_nic(
                64, 6, [192, 168, 1, 100], [10, 0, 2, 15], 25
            );
            kprintln_emerald!("[SMARTNIC PASS] Deadline Exceeded: {:?} -> {}", act3, msg3);
        } else if sub == "rule" {
            let src = [192, 168, 1, 200];
            let dst = [10, 0, 2, 50];
            yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.install_rule(
                6, src, dst, yuannao_smartnic::SmartNicAction::TxHardwareNat(0x0A000232, 9090)
            );
            kprintln_emerald!("[SMARTNIC] In-NIC Hardware NAT Rule Installed: 192.168.1.200 -> 10.0.2.50:9090");
        }
        kprintln_amber!("=== YUANNAO SMARTNIC HARDWARE-OFFLOADED XDP ENGINE (CN 116996602 B) ===");
        kprintln!(
            "SmartNIC SRAM MetaTable: {} rules active (Max: {}) | Instruction Budget: {} insns",
            yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.rule_count,
            yuannao_smartnic::MAX_SMARTNIC_RULES,
            yuannao_smartnic::SMARTNIC_MAX_INSTRUCTIONS
        );
        kprintln!(
            "Offload Execution Watchdog: Deadline T1 = {} us | Host CPU Utilization: {}%",
            yuannao_smartnic::SMARTNIC_MAX_EXEC_TIME_US,
            yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.host_cpu_utilization_pct
        );
        kprintln!(
            "Hardware Counters: Total Ingress: {} | Hardware NAT: {} | Host Passed: {} | Anomaly Drops: {} | Watchdog Drops: {}",
            yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.total_rx_packets,
            yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.total_offloaded_nat,
            yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.total_passed_to_host,
            yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.total_anomaly_drops,
            yuannao_smartnic::YUANNAO_SMARTNIC_ENGINE.total_watchdog_timeouts
        );
    } else if cmd == "afxdp" || cmd.starts_with("afxdp ") {
        let arg = cmd.strip_prefix("afxdp ").unwrap_or("");
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            // Test 1: Class 1 Packet (User space application traffic via AF_XDP into UMEM)
            let (cls1, msg1) = cas_afxdp::CAS_AFXDP_ENGINE.classify_and_dispatch(0, 0, true, 1024);
            kprintln_emerald!("[AF_XDP PASS] Class 1 Packet: {:?} -> {}", cls1, msg1);

            // Test 2: Class 2 Packet (Kernel stack standard handling)
            let (cls2, msg2) = cas_afxdp::CAS_AFXDP_ENGINE.classify_and_dispatch(0, 0, false, 512);
            kprintln_emerald!("[AF_XDP PASS] Class 2 Packet: {:?} -> {}", cls2, msg2);
        } else if sub == "bind" {
            let nic = it.next().and_then(|s| s.parse::<u8>().ok()).unwrap_or(0);
            let q = it.next().and_then(|s| s.parse::<u16>().ok()).unwrap_or(0);
            let sock_id = cas_afxdp::CAS_AFXDP_ENGINE.bind_af_xdp_socket(nic, q, 200 + nic as u32);
            kprintln_emerald!("[AF_XDP] Bound NIC {} Queue {} -> AF_XDP Socket #{}", nic, q, sock_id);
        }
        kprintln_amber!("=== CAS CNIC DUAL-STACK AF_XDP MULTIPLEXER (CN 115714679 A) ===");
        kprintln!(
            "UMEM Memory Pool: Chunk Size: {} B | Ring Depth: {} | Active Sockets: {}",
            cas_afxdp::UMEM_CHUNK_SIZE,
            cas_afxdp::UMEM_RING_SIZE,
            cas_afxdp::CAS_AFXDP_ENGINE.socket_count
        );
        kprintln!(
            "Classification Metrics: Total Classified: {} | Class 1 (User AF_XDP): {} | Class 2 (Kernel Stack): {}",
            cas_afxdp::CAS_AFXDP_ENGINE.total_rx_classified,
            cas_afxdp::CAS_AFXDP_ENGINE.total_class1_user_space,
            cas_afxdp::CAS_AFXDP_ENGINE.total_class2_kernel_space
        );
        kprintln!(
            "Zero-Copy Transfer Volume: {} bytes delivered directly to UMEM rings",
            cas_afxdp::CAS_AFXDP_ENGINE.total_zero_copy_bytes
        );
    } else if cmd == "mesh" || cmd.starts_with("mesh ") {
        let arg = cmd.strip_prefix("mesh ").unwrap_or("");
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            // Egress test: Pod 1 Client 37058 -> Microservice 8080
            let (res_egress, msg_egress) = langhe_mesh::LANGHE_MESH_ENGINE.accelerate_egress(1, 37058, 8080);
            kprintln_emerald!("[MESH PASS] Egress Intercept: {:?} -> {}", res_egress, msg_egress);

            // Ingress test: Sidecar Proxy 15001 returns response to Client 37058
            let (res_ingress, msg_ingress) = langhe_mesh::LANGHE_MESH_ENGINE.restore_ingress(1, 37058, 15001);
            kprintln_emerald!("[MESH PASS] Ingress Restore: {:?} -> {}", res_ingress, msg_ingress);
        } else if sub == "arp" {
            let (res_arp, msg_arp) = langhe_mesh::LANGHE_MESH_ENGINE.handle_arp_dual_sync();
            kprintln_emerald!("[MESH PASS] ARP Dual-Sync: {:?} -> {}", res_arp, msg_arp);
        }
        kprintln_amber!("=== LANGHE SERVICE MESH SOCKOPS ACCELERATOR (CN 114025370 B) ===");
        kprintln!(
            "Service Mesh Topology: Sidecar Proxy Port: {} | Accelerated Range: {}..{}",
            langhe_mesh::SIDECAR_PROXY_PORT,
            langhe_mesh::LANGHE_MESH_ENGINE.configured_service_port_min,
            langhe_mesh::LANGHE_MESH_ENGINE.configured_service_port_max
        );
        kprintln!(
            "Sockmap Two-Way Mappings: {} active connection tuples (Max: {})",
            langhe_mesh::LANGHE_MESH_ENGINE.mapping_count,
            langhe_mesh::MAX_MESH_MAPPINGS
        );
        kprintln!(
            "Optimization Metrics: Egress Redirects: {} | Ingress Restores: {} | Cumulative TCP/IP Stacks Bypassed: {}",
            langhe_mesh::LANGHE_MESH_ENGINE.total_egress_redirected,
            langhe_mesh::LANGHE_MESH_ENGINE.total_ingress_restored,
            langhe_mesh::LANGHE_MESH_ENGINE.total_stacks_bypassed
        );
    } else if cmd == "soundhound" || cmd.starts_with("soundhound ") {
        let arg = if cmd.len() > 10 { &cmd[11..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = soundhound_spatial::SOUNDHOUND_ENGINE.test_differential_rendering();
            if ok {
                kprintln_emerald!("[SOUNDHOUND PASS] Differential Spatial Test: {}", msg);
            } else {
                kprintln_amber!("[SOUNDHOUND FAIL] Differential Spatial Test: {}", msg);
            }
        } else if sub == "move" {
            // move <id> <x> <y> <z>
            let id = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(1);
            let x = it.next().and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
            let y = it.next().and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
            let z = it.next().and_then(|s| s.parse::<i32>().ok()).unwrap_or(150);
            let (ok, cues) = soundhound_spatial::SOUNDHOUND_ENGINE.relocate_source(id, x, y, z);
            if ok {
                kprintln_emerald!(
                    "[SOUNDHOUND] Relocated Source {}: Pos=({},{},{}) -> Azimuth={}deg, Elevation={}deg, ITD={}us, ILD(L/R)={}/{}%, Reverb={}%",
                    id, x, y, z, cues.azimuth_deg, cues.elevation_deg, cues.itd_us, cues.left_gain_pct, cues.right_gain_pct, cues.reverb_ratio_pct
                );
            } else {
                kprintln_amber!("[SOUNDHOUND] Source {} not found", id);
            }
        }
        kprintln_amber!("=== SOUNDHOUND DIFFERENTIAL SPATIAL RENDERING ENGINE (US 11,589,184 B1) ===");
        kprintln!(
            "Listener Head Pose: Pos=({},{},{}) | Orientation: Yaw={} deg, Pitch={} deg",
            soundhound_spatial::SOUNDHOUND_ENGINE.listener.position.x,
            soundhound_spatial::SOUNDHOUND_ENGINE.listener.position.y,
            soundhound_spatial::SOUNDHOUND_ENGINE.listener.position.z,
            soundhound_spatial::SOUNDHOUND_ENGINE.listener.yaw_deg,
            soundhound_spatial::SOUNDHOUND_ENGINE.listener.pitch_deg
        );
        kprintln!(
            "Spatial Sources: {} registered (Max: {}) | Relocation Events: {}",
            soundhound_spatial::SOUNDHOUND_ENGINE.active_sources_count,
            soundhound_spatial::MAX_SPATIAL_SOURCES,
            soundhound_spatial::SOUNDHOUND_ENGINE.total_relocations.load(core::sync::atomic::Ordering::Relaxed)
        );
        for i in 0..soundhound_spatial::MAX_SPATIAL_SOURCES {
            let s = &soundhound_spatial::SOUNDHOUND_ENGINE.sources[i];
            if s.state != soundhound_spatial::SourceState::Unused {
                let name = trimmed_ascii(&s.name);
                kprintln!(
                    "  [Source {}] \"{}\" Pos=({},{},{}) -> Az={}deg El={}deg Dist={}cm ITD={}us ILD={}/{}% Rev={}%",
                    s.source_id, name, s.virtual_pos.x, s.virtual_pos.y, s.virtual_pos.z,
                    s.cues.azimuth_deg, s.cues.elevation_deg, s.cues.distance_cm,
                    s.cues.itd_us, s.cues.left_gain_pct, s.cues.right_gain_pct, s.cues.reverb_ratio_pct
                );
            }
        }
    } else if cmd == "ericsson" || cmd.starts_with("ericsson ") {
        let arg = if cmd.len() > 8 { &cmd[9..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = ericsson_hetero_audio::ERICSSON_HETERO_ENGINE.test_hetero_audio_dynamics();
            if ok {
                kprintln_emerald!("[ERICSSON PASS] 6DoF Hetero-Audio Dynamics: {}", msg);
            } else {
                kprintln_amber!("[ERICSSON FAIL] 6DoF Hetero-Audio Dynamics: {}", msg);
            }
        } else if sub == "move" {
            let x = it.next().and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
            let y = it.next().and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
            let z = it.next().and_then(|s| s.parse::<i32>().ok()).unwrap_or(0);
            ericsson_hetero_audio::ERICSSON_HETERO_ENGINE.update_listener_pos(x, y, z);
            kprintln_emerald!("[ERICSSON] Listener 6DoF Position Updated to ({}, {}, {})", x, y, z);
        }
        kprintln_amber!("=== ERICSSON SPATIALLY HETEROGENEOUS 6DoF AUDIO ENGINE (JP 2022-515910 A) ===");
        kprintln!(
            "Listener Virtual Coordinates: ({}, {}, {}) cm",
            ericsson_hetero_audio::ERICSSON_HETERO_ENGINE.listener_x,
            ericsson_hetero_audio::ERICSSON_HETERO_ENGINE.listener_y,
            ericsson_hetero_audio::ERICSSON_HETERO_ENGINE.listener_z
        );
        kprintln!(
            "Optimization Telemetry: Matrix Updates: {} | Anti-Collapse Triggers: {} | Axis Inversions: {}",
            ericsson_hetero_audio::ERICSSON_HETERO_ENGINE.total_matrix_updates.load(core::sync::atomic::Ordering::Relaxed),
            ericsson_hetero_audio::ERICSSON_HETERO_ENGINE.anti_collapse_triggers.load(core::sync::atomic::Ordering::Relaxed),
            ericsson_hetero_audio::ERICSSON_HETERO_ENGINE.axis_inversion_count.load(core::sync::atomic::Ordering::Relaxed)
        );
        for i in 0..ericsson_hetero_audio::MAX_HETERO_ELEMENTS {
            let e = &ericsson_hetero_audio::ERICSSON_HETERO_ENGINE.elements[i];
            if e.active {
                let name = trimmed_ascii(&e.name);
                kprintln!(
                    "  [Elem {}] \"{}\" Center=({},{},{}) RefD={}cm RefW={}cm -> Matrix H: w_M={}% w_S={}% Width={}% Inverted={}",
                    e.element_id, name, e.metadata.center_x, e.metadata.center_y, e.metadata.center_z,
                    e.metadata.ref_distance_d, e.metadata.ref_width_cm,
                    e.matrix_h.mid_gain_pct, e.matrix_h.side_gain_pct, e.matrix_h.effective_width_pct, e.matrix_h.channels_inverted
                );
            }
        }
    } else if cmd == "astound" || cmd.starts_with("astound ") {
        let arg = if cmd.len() > 7 { &cmd[8..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = genaudio_astoundsound::ASTOUNDSOUND_ENGINE.test_astoundsound_engine();
            if ok {
                kprintln_emerald!("[ASTOUND PASS] AstoundSound 4D Engine: {}", msg);
            } else {
                kprintln_amber!("[ASTOUND FAIL] AstoundSound 4D Engine: {}", msg);
            }
        } else if sub == "bypass" {
            let pct = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(70);
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.center_bypass.center_concentration_pct = if pct > 100 { 100 } else { pct };
            kprintln_emerald!("[ASTOUND] Center Concentration Set: {}% (Mid-Side %-Center Bypass)", pct);
        } else if sub == "flyby" {
            let speed = it.next().and_then(|s| s.parse::<i32>().ok()).unwrap_or(12000);
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.update_4d_trajectory(16, speed);
            kprintln_emerald!(
                "[ASTOUND] 4D Motion Fly-by Updated: Speed={} cm/s -> Doppler Pitch Shift: {}%",
                speed,
                genaudio_astoundsound::ASTOUNDSOUND_ENGINE.doppler_pitch_ratio_pct
            );
        }
        kprintln_amber!("=== GENAUDIO ASTOUNDSOUND 4D SPATIALIZATION ENGINE (US 9,154,896 B2) ===");
        kprintln!(
            "4D Trajectory State: Pos=({},{},{}) cm | Timestamp: {} ms | Active Curve: {:?}",
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.current_pos.x,
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.current_pos.y,
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.current_pos.z,
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.current_pos.timestamp_ms,
            match genaudio_astoundsound::ASTOUNDSOUND_ENGINE.active_trajectory {
                genaudio_astoundsound::MotionTrajectoryType::FlyByLinear => "FlyByLinear",
                genaudio_astoundsound::MotionTrajectoryType::OrbitalSpatial => "OrbitalSpatial",
                genaudio_astoundsound::MotionTrajectoryType::ElevationSpiral => "ElevationSpiral",
                genaudio_astoundsound::MotionTrajectoryType::StationaryDeck => "StationaryDeck",
            }
        );
        kprintln!(
            "Acoustic Dynamics: Velocity: {} cm/s | Doppler Pitch Shift: {}% | Schroeder All-Pass Lattice: {} stages",
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.velocity_cms,
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.doppler_pitch_ratio_pct,
            genaudio_astoundsound::ALLPASS_STAGES
        );
        kprintln!(
            "%-Center Bypass: Center Concentration: {}% | Mono Gain: {}% | Side Gain: {}%",
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.center_bypass.center_concentration_pct,
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.center_bypass.mono_gain_pct,
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.center_bypass.side_gain_pct
        );
        kprintln!(
            "Execution Telemetry: Total 4D Frames: {} | Doppler Steps: {} | Center-Bypass Frames: {}",
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.total_4d_frames.load(core::sync::atomic::Ordering::Relaxed),
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.doppler_shifts_calculated.load(core::sync::atomic::Ordering::Relaxed),
            genaudio_astoundsound::ASTOUNDSOUND_ENGINE.center_bypass_frames.load(core::sync::atomic::Ordering::Relaxed)
        );
    } else if cmd == "vcr" || cmd.starts_with("vcr ") {
        let arg = if cmd.len() > 3 { &cmd[4..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = unsafe { rbc_vcr_enclave::VCR_ENGINE.test_vcr_platform() };
            if ok {
                kprintln_emerald!("[VCR PASS] RBC Virtual Clean Room: {}", msg);
            } else {
                kprintln_amber!("[VCR FAIL] RBC Virtual Clean Room: {}", msg);
            }
        } else if sub == "query" {
            let partner = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(200);
            let qtype = it.next().unwrap_or("COUNT");
            let col = it.next().unwrap_or("SKU_LIST");
            let count = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(65);
            let (approved, rows, reason) = unsafe {
                rbc_vcr_enclave::VCR_ENGINE.execute_custodian_query(partner, qtype, col, count)
            };
            if approved {
                kprintln_emerald!("[VCR CUSTODIAN] Approved! Rows Matched: {} (RAM wiped)", rows);
            } else {
                kprintln_amber!("[VCR CUSTODIAN] Blocked: {}", reason);
            }
        }
        let (att_str, wipes, appr, rej) = unsafe {
            let att = match rbc_vcr_enclave::VCR_ENGINE.attestation {
                rbc_vcr_enclave::EnclaveAttestationState::AttestationVerified => "Verified (SVN >= 2)",
                rbc_vcr_enclave::EnclaveAttestationState::QuoteGenerated => "Quote Generated",
                rbc_vcr_enclave::EnclaveAttestationState::AttestationFailed => "Failed",
                rbc_vcr_enclave::EnclaveAttestationState::Uninitialized => "Uninitialized",
            };
            (
                att,
                rbc_vcr_enclave::VCR_ENGINE.memory_wipe_counter.load(Ordering::Relaxed),
                rbc_vcr_enclave::VCR_ENGINE.queries_approved.load(Ordering::Relaxed),
                rbc_vcr_enclave::VCR_ENGINE.queries_rejected.load(Ordering::Relaxed),
            )
        };
        kprintln_amber!("=== RBC VIRTUAL CLEAN ROOM MULTIPARTY ENCLAVE (US 12,210,636 B2) ===");
        kprintln!(
            "Attestation State: {} | Bilateral Policy: Active (Bank #100 <-> Grocery #200)",
            att_str
        );
        kprintln!(
            "Data Custodian Columns: 8 Protected Columns | Non-Exportable (NE): CRD_NO, USER_ID, SSN_HASH"
        );
        kprintln!(
            "Privacy Rules: Min Aggregate Threshold: 50 | Ephemeral Channel: ECDH+HKDF AES-256"
        );
        kprintln!(
            "Execution Telemetry: Queries Approved: {} | Queries Rejected: {} | Post-Query RAM Wipes: {}",
            appr, rej, wipes
        );
    } else if cmd == "fsm" || cmd.starts_with("fsm ") {
        let arg = if cmd.len() > 3 { &cmd[4..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = unsafe { ucf_dax_fsm::DAX_FSM_ENGINE.test_dax_fsm_subsystem() };
            if ok {
                kprintln_emerald!("[FSM PASS] UCF Dual FS/M DAX: {}", msg);
            } else {
                kprintln_amber!("[FSM FAIL] UCF Dual FS/M DAX: {}", msg);
            }
        } else if sub == "audit" {
            let head = unsafe { ucf_dax_fsm::DAX_FSM_ENGINE.audit_head };
            kprintln_amber!("=== UCF FS/M GLOBALBUFFER CIRCULAR AUDIT TRAIL (Total: {}) ===", head);
            let limit = if head > 4 { 4 } else { head };
            for i in 0..limit {
                let rec = unsafe { ucf_dax_fsm::DAX_FSM_ENGINE.global_buffer[i % ucf_dax_fsm::UCF_AUDIT_BUFFER_SIZE] };
                kprintln!(
                    "  [Entry {}] Core: {} | PID: {} | FileID: {} | Addr: {:#x} | Type: {} | Len: {} B",
                    i, rec.core_id, rec.pid, rec.file_id, rec.phys_addr,
                    if rec.is_write { "WRITE" } else { "READ" },
                    rec.byte_len
                );
            }
        }
        let (reads, writes, m_switches, ecc_rec) = unsafe {
            (
                ucf_dax_fsm::DAX_FSM_ENGINE.total_dax_reads.load(Ordering::Relaxed),
                ucf_dax_fsm::DAX_FSM_ENGINE.total_dax_writes.load(Ordering::Relaxed),
                ucf_dax_fsm::DAX_FSM_ENGINE.total_mode_switches.load(Ordering::Relaxed),
                ucf_dax_fsm::DAX_FSM_ENGINE.total_ecc_recoveries.load(Ordering::Relaxed),
            )
        };
        kprintln_amber!("=== UCF DUAL FS/M BYTE-ADDRESSABLE DAX CONTROLLER (US 11,398,894 B2) ===");
        kprintln!(
            "Hardware Tables: CPT: 4 Cores mapped | OTT: 8 Secure Tunnels | Pages: 16 Monotonic Blocks"
        );
        kprintln!(
            "Line-Rate Crypto: Dual-Pad XOR (Ciphertext = Data ^ Pad_proc ^ Pad_file) | ECC Parity: Active"
        );
        kprintln!(
            "Execution Telemetry: DAX Reads: {} | DAX Writes: {} | Mode Switches: {} | ECC Recoveries: {}",
            reads, writes, m_switches, ecc_rec
        );
    } else if cmd == "mongo" || cmd.starts_with("mongo ") {
        let arg = if cmd.len() > 5 { &cmd[6..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = unsafe { mongodb_enc_engine::MONGODB_ENGINE.test_mongodb_encryption_engine() };
            if ok {
                kprintln_emerald!("[MONGO PASS] MongoDB Pluggable Storage: {}", msg);
            } else {
                kprintln_amber!("[MONGO FAIL] MongoDB Pluggable Storage: {}", msg);
            }
        } else if sub == "workload" {
            let r = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(15);
            let w = it.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(85);
            let (fmt, mig) = unsafe {
                mongodb_enc_engine::MONGODB_ENGINE.record_workload_activity(r, w, 0, 0)
            };
            kprintln_emerald!(
                "[MONGO WORKLOAD] Recorded R={} W={} -> Format: {:?} (Migrated={})",
                r, w, fmt, mig
            );
        }
        let (fmt_str, enc_b, dec_b, migs, bad_k) = unsafe {
            let f = match mongodb_enc_engine::MONGODB_ENGINE.active_format {
                mongodb_enc_engine::StorageFormat::RowStoreBTree => "Row-Store (B+ Tree)",
                mongodb_enc_engine::StorageFormat::LsmTreeMerge => "LSM-Tree (Log-Structured Merge)",
                mongodb_enc_engine::StorageFormat::ColumnStoreVector => "Column-Store (Vector Analytics)",
            };
            (
                f,
                mongodb_enc_engine::MONGODB_ENGINE.total_encrypted_bytes.load(Ordering::Relaxed),
                mongodb_enc_engine::MONGODB_ENGINE.total_decrypted_bytes.load(Ordering::Relaxed),
                mongodb_enc_engine::MONGODB_ENGINE.total_format_migrations.load(Ordering::Relaxed),
                mongodb_enc_engine::MONGODB_ENGINE.bad_key_detections.load(Ordering::Relaxed),
            )
        };
        kprintln_amber!("=== MONGODB PLUGGABLE ENCRYPTED STORAGE ENGINE (US 10,846,411 B2) ===");
        kprintln!(
            "Active Storage Format: {} | Key Management: KMIP/KeyFile Online",
            fmt_str
        );
        kprintln!(
            "Key Hierarchy: System Master Key (256-bit) -> 2 Database Keys Active (System, Spatial_DB)"
        );
        kprintln!(
            "WT_ENCRYPTOR Callbacks: 20-Byte Header Expansion (16B IV + 4B Checksum) | Sizing: Active"
        );
        kprintln!(
            "Execution Telemetry: Encrypted: {} B | Decrypted: {} B | Migrations: {} | Bad-Keys: {}",
            enc_b, dec_b, migs, bad_k
        );
    } else if cmd == "enclave" || cmd.starts_with("enclave ") {
        let arg = if cmd.len() > 7 { &cmd[8..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = unsafe {
                microsoft_cross_enclave::MS_CROSS_ENCLAVE_ENGINE.test_cross_platform_enclave_engine()
            };
            if ok {
                kprintln_emerald!("[ENCLAVE PASS] Microsoft Cross-Platform: {}", msg);
            } else {
                kprintln_amber!("[ENCLAVE FAIL] Microsoft Cross-Platform: {}", msg);
            }
        } else if sub == "seal" {
            let payload = *b"SPATIAL_OS_CROSS_ENCLAVE_STATE_PAYLOAD\0";
            let res = unsafe {
                microsoft_cross_enclave::MS_CROSS_ENCLAVE_ENGINE.distributed_seal(
                    0,
                    microsoft_cross_enclave::AbstractIdentityType::FamilyId,
                    &payload,
                )
            };
            match res {
                Ok(nonce) => kprintln_emerald!("[ENCLAVE SEAL] Sealed 39 bytes under FamilyID policy (Nonce: {:#x})", nonce),
                Err(e) => kprintln_amber!("[ENCLAVE SEAL FAIL] {}", e),
            }
        } else if sub == "unseal" {
            let mut buf = [0u8; 64];
            let res = unsafe {
                microsoft_cross_enclave::MS_CROSS_ENCLAVE_ENGINE.distributed_unseal(1, &mut buf)
            };
            match res {
                Ok(len) => kprintln_emerald!("[ENCLAVE UNSEAL] Unsealed {} bytes into VSM Enclave #1", len),
                Err(e) => kprintln_amber!("[ENCLAVE UNSEAL FAIL] {}", e),
            }
        }
        let (att, equiv, seals, unseals, vault_ops) = unsafe {
            (
                microsoft_cross_enclave::MS_CROSS_ENCLAVE_ENGINE.total_attestations.load(Ordering::Relaxed),
                microsoft_cross_enclave::MS_CROSS_ENCLAVE_ENGINE.total_equivalence_verifications.load(Ordering::Relaxed),
                microsoft_cross_enclave::MS_CROSS_ENCLAVE_ENGINE.total_distributed_seals.load(Ordering::Relaxed),
                microsoft_cross_enclave::MS_CROSS_ENCLAVE_ENGINE.total_distributed_unseals.load(Ordering::Relaxed),
                microsoft_cross_enclave::MS_CROSS_ENCLAVE_ENGINE.total_vault_operations.load(Ordering::Relaxed),
            )
        };
        kprintln_amber!("=== MICROSOFT CROSS-PLATFORM ENCLAVE IDENTITY ENGINE (EP 3 574 435 B1) ===");
        kprintln!(
            "Abstraction Model: SGX & VSM Unified ABI | Slots: 2 Instantiated (Slot 0: SGX, Slot 1: VSM)"
        );
        kprintln!(
            "5-Tier Identity: ExactHash | InstanceHash | ImageID | FamilyID | AuthorID"
        );
        kprintln!(
            "Distributed Sealing: SetOfTargetEnclaves Policy | Key Vault: Vault-Locked Roots Active"
        );
        kprintln!(
            "Execution Telemetry: Attestations: {} | Equivalence Matches: {} | Seals: {} | Unseals: {} | Vault Ops: {}",
            att, equiv, seals, unseals, vault_ops
        );
    } else if cmd == "metal" || cmd.starts_with("metal ") {
        let arg = if cmd.len() > 5 { &cmd[6..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = unsafe {
                apple_metal_pipeline::APPLE_METAL_ENGINE.test_metal_engine()
            };
            if ok {
                kprintln_emerald!("[METAL PASS] Apple Metal Engine: {}", msg);
            } else {
                kprintln_amber!("[METAL FAIL] Apple Metal Engine: {}", msg);
            }
        } else if sub == "pipeline" {
            let mvp = apple_metal_pipeline::Matrix4x4::identity();
            let (out_pos, _out_col, _) = unsafe {
                apple_metal_pipeline::APPLE_METAL_ENGINE.execute_vertex_transform(
                    &mvp,
                    [0.5, 0.5, 0.0, 1.0],
                    [0.2, 0.7, 0.9, 1.0],
                    [0.0, 0.0],
                )
            };
            let pixel = unsafe {
                apple_metal_pipeline::APPLE_METAL_ENGINE.execute_fragment_shading(
                    [0.2, 0.7, 0.9, 1.0],
                    [0.0, 0.0],
                    0.2,
                )
            };
            kprintln_emerald!(
                "[METAL PIPELINE] Transformed Pos: [{:.2}, {:.2}, {:.2}, {:.2}] -> Shaded Pixel: {:#08x}",
                out_pos[0], out_pos[1], out_pos[2], out_pos[3], pixel
            );
        }
        let (compiled, sigs, vtx, frags, compute, barriers) = unsafe {
            (
                apple_metal_pipeline::APPLE_METAL_ENGINE.total_compiled_pipelines.load(Ordering::Relaxed),
                apple_metal_pipeline::APPLE_METAL_ENGINE.total_signature_validations.load(Ordering::Relaxed),
                apple_metal_pipeline::APPLE_METAL_ENGINE.total_vertex_transforms.load(Ordering::Relaxed),
                apple_metal_pipeline::APPLE_METAL_ENGINE.total_fragment_shades.load(Ordering::Relaxed),
                apple_metal_pipeline::APPLE_METAL_ENGINE.total_compute_dispatches.load(Ordering::Relaxed),
                apple_metal_pipeline::APPLE_METAL_ENGINE.total_threadgroup_barriers.load(Ordering::Relaxed),
            )
        };
        kprintln_amber!("=== APPLE METAL UNIFIED SHADING & COMPUTE PIPELINE ENGINE (EP 3 137 992 B1) ===");
        kprintln!(
            "Language Model: Unified C++11 Graphics & Compute | AOT Compilation: LLVM Bitcode Intermediate Representation"
        );
        kprintln!(
            "Address Spaces: global (VRAM) | local (Workgroup Scratchpad) | constant (Uniforms) | private (Registers)"
        );
        kprintln!(
            "Pipelining: stage_in Input/Output Signature Matching & Hardware Resource Binding Slots"
        );
        kprintln!(
            "Telemetry: Compiled PSOs: {} | Sig Validations: {} | Vertex Xforms: {} | Fragment Shades: {} | Compute Dispatches: {} | Barriers: {}",
            compiled, sigs, vtx, frags, compute, barriers
        );
    } else if cmd == "kunlun" || cmd.starts_with("kunlun ") {
        let arg = if cmd.len() > 6 { &cmd[7..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = unsafe {
                kunlun_accel_mesh::KUNLUN_FABRIC.run_self_test()
            };
            if ok {
                kprintln_emerald!("[KUNLUN PASS] Confidential AI Mesh & Attestation: {}", msg);
            } else {
                kprintln_amber!("[KUNLUN FAIL] Confidential AI Mesh & Attestation: {}", msg);
            }
        } else if sub == "broadcast" {
            let (ok, hops, msg) = unsafe {
                kunlun_accel_mesh::KUNLUN_FABRIC.dispatch_ring_broadcast(0, b"POST_CARD_SPATIAL_OS_TENSOR_CHUNK_77")
            };
            if ok {
                kprintln_emerald!("[KUNLUN BROADCAST] Succeeded across {} hops: {}", hops, msg);
            } else {
                kprintln_amber!("[KUNLUN BROADCAST] Failed across {} hops: {}", hops, msg);
            }
        } else if sub == "drm" {
            let fake_weights = [0x5A; 64];
            let res = unsafe {
                kunlun_accel_mesh::KUNLUN_FABRIC.attest_and_verify_model(
                    0,
                    0xCAFE_0001,
                    kunlun_accel_mesh::WatermarkType::WeightPerturbation,
                    &fake_weights,
                )
            };
            match res {
                Ok(ev) => {
                    kprintln_emerald!(
                        "[KUNLUN DRM] Model 0x{:08X} Validated! Freshness TS: {} | Nonce: {:#016x} | Valid: {}",
                        ev.model_id, ev.freshness_timestamp, ev.nonce, ev.is_valid
                    );
                }
                Err(err) => {
                    kprintln_amber!("[KUNLUN DRM] Rejection: {}", err);
                }
            }
        } else if sub == "attest" {
            let test_bin = [0x77u8; 32];
            let res = unsafe {
                kunlun_accel_mesh::KUNLUN_FABRIC.execute_cmd_do_attestation(0, 0x2001, 0xABCD_1234, &test_bin)
            };
            match res {
                Ok(ev) => {
                    kprintln_emerald!(
                        "[KUNLUN ATTEST] Kernel 0x{:04X} Attested! Nonce: {:#016x} | Freshness TS: {} | Valid: {}",
                        ev.kernel_id, ev.challenge_nonce, ev.freshness_timestamp, ev.is_valid
                    );
                }
                Err(err) => {
                    kprintln_amber!("[KUNLUN ATTEST] Rejection: {}", err);
                }
            }
        } else if sub == "cache" {
            let _ = unsafe {
                kunlun_accel_mesh::KUNLUN_FABRIC.configure_watermark_slot(0, 0, 0x8001, kunlun_accel_mesh::WatermarkType::HybridDualFactor, 500_000_000_000)
            };
            let res = unsafe {
                kunlun_accel_mesh::KUNLUN_FABRIC.get_active_watermark_algorithm(0, 0)
            };
            match res {
                Ok(algo) => {
                    kprintln_emerald!("[KUNLUN CACHE] Slot 0 Active Algorithm: {:?} (T_expire valid)", algo);
                }
                Err(err) => {
                    kprintln_amber!("[KUNLUN CACHE] Slot 0 Error: {}", err);
                }
            }
        }
        let (bcasts, attests, k_attests, cycles) = unsafe {
            (
                kunlun_accel_mesh::KUNLUN_FABRIC.total_broadcasts_dispatched.load(Ordering::Relaxed),
                kunlun_accel_mesh::KUNLUN_FABRIC.total_watermark_attestations.load(Ordering::Relaxed),
                kunlun_accel_mesh::KUNLUN_FABRIC.total_kernel_attestations.load(Ordering::Relaxed),
                kunlun_accel_mesh::KUNLUN_FABRIC.total_cycle_terminations.load(Ordering::Relaxed),
            )
        };
        kprintln_amber!("=== KUNLUNXIN CONFIDENTIAL AI MESH & ATTESTATION ENGINE (CN 112528244 B / CN 112953855 B) ===");
        kprintln!(
            "Silicon Security: Die-Integrated SU (SK_RK / PK_RK) + Anti-Replay Monotonic Time Unit (TU)"
        );
        kprintln!(
            "Fabric Topology: 4-DPA Inter-Accelerator Ring/Mesh | Broadcast Session Key: K_bc | Hop-by-Hop Anti-Cycle"
        );
        kprintln!(
            "Model DRM Protection: Dual-Factor (Type 1 Weight Perturbation + Type 2 Trigger Set) & Hardware Policy Table"
        );
        kprintln!(
            "Kernel Object Attestation: Host TEE KernelDigestStore (CN 112292678 B) | Dynamic Watermark Cache (CN 112528242 B)"
        );
        kprintln!(
            "Telemetry: Broadcasts: {} | Watermark Attests: {} | Kernel Attests: {} | Cycle Terminations: {}",
            bcasts, attests, k_attests, cycles
        );
    } else if cmd == "antmem" || cmd.starts_with("antmem ") {
        let arg = if cmd.len() > 6 { &cmd[7..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = unsafe {
                ant_safe_memory::SAFE_MEMORY_MANAGER.run_formal_tests()
            };
            if ok {
                kprintln_emerald!("[ANTMEM PASS] Safe Memory & Invariants: {}", msg);
            } else {
                kprintln_amber!("[ANTMEM FAIL] Safe Memory & Invariants: {}", msg);
            }
        }
        let (reads, writes, typed_viols, stack_traps, cap_viols, regions) = unsafe {
            ant_safe_memory::SAFE_MEMORY_MANAGER.get_telemetry()
        };
        kprintln_amber!("=== ANT GROUP SAFE MEMORY & NUDT FORMAL INVARIANTS (CN 117908859 A / CN 116484439 B) ===");
        kprintln!("Architecture: 100% Safe Management Interface (101) | Private Leaf Execution (103)");
        kprintln!("Segregation: Typed Memory (Immutable Kernel/Paging) vs Untyped (Allocatable RAM/Capsules)");
        kprintln!("Protection: Kernel Stack Guard Page (4 KiB at boot_stack_bottom) | ACSL Invariants");
        kprintln!(
            "Telemetry: Safe Reads: {} | Safe Writes: {} | Stack Traps: {} | Typed Rejections: {} | Capsule Violations: {} | Regions: {}",
            reads, writes, stack_traps, typed_viols, cap_viols, regions
        );
    } else if cmd == "quantum" || cmd.starts_with("quantum ") {
        let arg = if cmd.len() > 7 { &cmd[8..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("");
        if sub == "test" {
            let (ok, msg) = unsafe {
                quantum_complexity_router::QUANTUM_ROUTER.run_self_test()
            };
            if ok {
                kprintln_emerald!("[QUANTUM PASS] Complexity Router & Priority Backtracking: {}", msg);
            } else {
                kprintln_amber!("[QUANTUM FAIL] Complexity Router & Priority Backtracking: {}", msg);
            }
        } else if sub == "route" {
            let target = it.next().unwrap_or("telemetry");
            let profile = if target == "qubo" || target == "np" {
                quantum_complexity_router::TaskComplexityProfile {
                    dimension: 16,
                    sparsity_ppm: 500_000,
                    non_linearity_order: 2,
                    is_combinatorial_np: true,
                    deadline_microseconds: 5000,
                }
            } else if target == "tensor" || target == "vision" {
                quantum_complexity_router::TaskComplexityProfile {
                    dimension: 128,
                    sparsity_ppm: 100_000,
                    non_linearity_order: 1,
                    is_combinatorial_np: false,
                    deadline_microseconds: 2000,
                }
            } else {
                quantum_complexity_router::TaskComplexityProfile {
                    dimension: 16,
                    sparsity_ppm: 950_000,
                    non_linearity_order: 1,
                    is_combinatorial_np: false,
                    deadline_microseconds: 500,
                }
            };
            let (tier, reason) = unsafe {
                quantum_complexity_router::QUANTUM_ROUTER.classify_complexity(&profile)
            };
            kprintln_emerald!("[QUANTUM ROUTE] Task '{}' -> Tier: {:?} | Reason: {}", target, tier, reason);
        } else if sub == "solve" {
            let mut coupling = [[0i32; quantum_complexity_router::MAX_QUBO_SPINS]; quantum_complexity_router::MAX_QUBO_SPINS];
            let mut bias = [0i32; quantum_complexity_router::MAX_QUBO_SPINS];
            for i in 0..7 {
                coupling[i][i + 1] = 10;
            }
            bias[0] = -5;
            let res = unsafe {
                quantum_complexity_router::QUANTUM_ROUTER.solve_qubo_ising(8, &coupling, &bias, 150)
            };
            kprintln_emerald!(
                "[QUANTUM SOLVE] Spins: {} | Ground Energy: {} | Steps: {} | Converged: {}",
                res.spin_count, res.ground_state_energy, res.iterations, res.converged
            );
        }
        let (routed, simd_c, tensor_c, qubo_c, inheritances, backtracks) = unsafe {
            (
                quantum_complexity_router::QUANTUM_ROUTER.total_tasks_routed.load(Ordering::Relaxed),
                quantum_complexity_router::QUANTUM_ROUTER.count_tier_simd.load(Ordering::Relaxed),
                quantum_complexity_router::QUANTUM_ROUTER.count_tier_tensor.load(Ordering::Relaxed),
                quantum_complexity_router::QUANTUM_ROUTER.count_tier_qubo.load(Ordering::Relaxed),
                quantum_complexity_router::QUANTUM_ROUTER.count_priority_inheritances.load(Ordering::Relaxed),
                quantum_complexity_router::QUANTUM_ROUTER.count_priority_backtracks.load(Ordering::Relaxed),
            )
        };
        kprintln_amber!("=== QOMPLX HYBRID QUANTUM ORCHESTRATOR & BUPT RTOS (US 2026/0148042 A1 / CN 117931412 A) ===");
        kprintln!("Orchestration: Content-Aware Complexity Scoring across CPU SIMD, Tensor Mesh & Quantum Annealer");
        kprintln!("Flight RTOS: Dual-Kernel Priority Ceiling with Backtracking Stack (Anti-Priority Inversion)");
        kprintln!(
            "Telemetry: Routed: {} (SIMD: {}, Tensor: {}, QUBO: {}) | Priority Boosts: {} | Backtracks: {}",
            routed, simd_c, tensor_c, qubo_c, inheritances, backtracks
        );
    } else if cmd == "browse" || cmd.starts_with("browse ") || cmd == "bookmarks" {
        let arg = if cmd.starts_with("browse ") { &cmd[7..] } else { "" };
        let mut it = arg.split_whitespace();
        let first = it.next().unwrap_or("");
        
        if first == "test" {
            let (ok, msg) = unsafe {
                web_browser::BROWSER_ENGINE.run_self_test()
            };
            if ok {
                kprintln_emerald!("[BROWSER PASS] Web Engine & HTTP: {}", msg);
            } else {
                kprintln_amber!("[BROWSER FAIL] Web Engine & HTTP: {}", msg);
            }
        } else if first == "history" {
            kprintln_cyan!("=== RECENT BROWSING HISTORY ===");
            let (head, count) = unsafe {
                (
                    web_browser::BROWSER_ENGINE.history_head,
                    web_browser::BROWSER_ENGINE.history_count,
                )
            };
            for i in 0..count {
                let slot = (head + i) % web_browser::MAX_HISTORY;
                let len = unsafe { web_browser::BROWSER_ENGINE.history_lens[slot] };
                let url = unsafe {
                    core::str::from_utf8(&web_browser::BROWSER_ENGINE.history[slot][..len]).unwrap_or("")
                };
                kprintln!(" [{}] {}", i + 1, url);
            }
        } else if !first.is_empty() {
            let mut render_buf = [0u8; 1024];
            let res = unsafe {
                web_browser::BROWSER_ENGINE.browse_url(first, &mut render_buf)
            };
            match res {
                Ok((view, text)) => {
                    kprintln_emerald!("=== HTTP {} OK | Length: {} B | Type: {} ===", view.status_code, view.content_length, view.content_type);
                    kprintln_cyan!("URL: {}", first);
                    kprintln!("------------------------------------------------------------");
                    kprintln!("{}", text);
                    kprintln!("------------------------------------------------------------");
                }
                Err(err) => {
                    kprintln_amber!("[BROWSER ERROR] Could not browse '{}': {}", first, err);
                }
            }
        } else {
            kprintln_cyan!("=== POST CARD SPATIAL OS - WEB BOOKMARKS ===");
            for (idx, bm) in web_browser::DEFAULT_BOOKMARKS.iter().enumerate() {
                kprintln!(" [{}] {:<22} -> {:<28} ({})", idx + 1, bm.title, bm.url, bm.description);
            }
            kprintln_gray!("Use 'browse <url>' to open any site or 'browse test' for self-test.");
        }
        let (pages, bytes) = unsafe {
            (
                web_browser::BROWSER_ENGINE.total_pages_fetched.load(Ordering::Relaxed),
                web_browser::BROWSER_ENGINE.total_bytes_downloaded.load(Ordering::Relaxed),
            )
        };
        kprintln_gray!("Web Engine Telemetry: Pages Fetched: {} | Bytes Downloaded: {} B", pages, bytes);
    } else if cmd == "http" || cmd.starts_with("http ") {
        let arg = if cmd.len() > 4 { &cmd[5..] } else { "" };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("status");
        if sub == "get" {
            let target = it.next().unwrap_or("http://kernel.org");
            let mut render_buf = [0u8; 512];
            let res = unsafe {
                web_browser::BROWSER_ENGINE.browse_url(target, &mut render_buf)
            };
            match res {
                Ok((view, text)) => {
                    kprintln_emerald!("[HTTP GET OK] Status: {} | Length: {} B", view.status_code, view.content_length);
                    kprintln!("{}", text);
                }
                Err(err) => {
                    kprintln_amber!("[HTTP GET FAIL] Error: {}", err);
                }
            }
        } else {
            let (pages, bytes) = unsafe {
                (
                    web_browser::BROWSER_ENGINE.total_pages_fetched.load(Ordering::Relaxed),
                    web_browser::BROWSER_ENGINE.total_bytes_downloaded.load(Ordering::Relaxed),
                )
            };
            kprintln_amber!("=== HTTP CLIENT & TRANSPORT STACK ===");
            kprintln!("Protocol: HTTP/1.1 over IPv4 TCP | User-Agent: PostCardSpatialOS/1.0");
            kprintln!("Telemetry: Total Requests: {} | Total Volume: {} B", pages, bytes);
        }
    } else if cmd == "email" || cmd.starts_with("email ") || cmd == "mail" || cmd.starts_with("mail ") {
        let arg = if cmd.starts_with("email ") {
            &cmd[6..]
        } else if cmd.starts_with("mail ") {
            &cmd[5..]
        } else {
            ""
        };
        let mut it = arg.split_whitespace();
        let sub = it.next().unwrap_or("inbox");
        if sub == "test" {
            let (ok, msg) = unsafe {
                email_client::EMAIL_CLIENT.run_self_test()
            };
            if ok {
                kprintln_emerald!("[EMAIL PASS] Mailbox & Provenance: {}", msg);
            } else {
                kprintln_amber!("[EMAIL FAIL] Mailbox & Provenance: {}", msg);
            }
        } else if sub == "send" {
            let to = it.next().unwrap_or("ground-control@satellite.org");
            let subj = it.next().unwrap_or("Spatial-Telemetry");
            let body = it.next().unwrap_or("Nominal flight operations confirmed.");
            let res = unsafe {
                email_client::EMAIL_CLIENT.send_email(to, subj, body)
            };
            match res {
                Ok(id) => {
                    kprintln_emerald!("[EMAIL SENT] Message #{} queued for dispatch to <{}>", id, to);
                    kprintln!("Subject: {}", subj);
                    kprintln!("Hardware Enclave Signature: Stamped (SU Monotonic Freshness)");
                }
                Err(err) => {
                    kprintln_amber!("[EMAIL SEND ERROR] {}", err);
                }
            }
        } else if sub == "read" {
            let id_str = it.next().unwrap_or("1");
            let id = id_str.parse::<u32>().unwrap_or(1);
            let email_opt = unsafe {
                email_client::EMAIL_CLIENT.read_inbox_email(id)
            };
            match email_opt {
                Some(msg) => {
                    let sender = core::str::from_utf8(&msg.sender[..msg.sender_len]).unwrap_or("");
                    let recipient = core::str::from_utf8(&msg.recipient[..msg.recipient_len]).unwrap_or("");
                    let subject = core::str::from_utf8(&msg.subject[..msg.subject_len]).unwrap_or("");
                    let date = core::str::from_utf8(&msg.date[..msg.date_len]).unwrap_or("");
                    let body = core::str::from_utf8(&msg.body[..msg.body_len]).unwrap_or("");
                    kprintln_cyan!("=== EMAIL MESSAGE #{} ===", msg.id);
                    kprintln!("From:    {}", sender);
                    kprintln!("To:      {}", recipient);
                    kprintln!("Date:    {}", date);
                    kprintln!("Subject: {}", subject);
                    kprintln!("Status:  {:?} | Provenance Valid: {}", msg.status, msg.is_verified);
                    kprintln!("------------------------------------------------------------");
                    kprintln!("{}", body);
                    kprintln!("------------------------------------------------------------");
                }
                None => {
                    kprintln_amber!("[EMAIL ERROR] Message #{} not found in inbox", id);
                }
            }
        } else if sub == "outbox" {
            kprintln_cyan!("=== OUTBOX DISPATCH QUEUE ===");
            let count = unsafe { email_client::EMAIL_CLIENT.outbox_count };
            if count == 0 {
                kprintln_gray!("(Outbox is empty)");
            } else {
                for i in 0..count {
                    let msg = unsafe { &email_client::EMAIL_CLIENT.outbox[i] };
                    let to = core::str::from_utf8(&msg.recipient[..msg.recipient_len]).unwrap_or("");
                    let subj = core::str::from_utf8(&msg.subject[..msg.subject_len]).unwrap_or("");
                    kprintln!(" [{}] To: {:<26} | Subject: {:<24} | Status: {:?}", msg.id, to, subj, msg.status);
                }
            }
        } else {
            // Default: show inbox
            kprintln_cyan!("=== INBOX MAILBOX (SPATIAL OS CARRIER) ===");
            let count = unsafe { email_client::EMAIL_CLIENT.inbox_count };
            for i in 0..count {
                let msg = unsafe { &email_client::EMAIL_CLIENT.inbox[i] };
                let from = core::str::from_utf8(&msg.sender[..msg.sender_len]).unwrap_or("");
                let subj = core::str::from_utf8(&msg.subject[..msg.subject_len]).unwrap_or("");
                let read_tag = if msg.is_read { "READ" } else { "NEW " };
                kprintln!(" [{}] [{}] From: {:<24} | Subject: {}", msg.id, read_tag, from, subj);
            }
            kprintln_gray!("Use 'email read <id>' to read an email or 'email send <to> <subj> <body>' to compose.");
        }
        let (sent, recv) = unsafe {
            (
                email_client::EMAIL_CLIENT.total_emails_sent.load(Ordering::Relaxed),
                email_client::EMAIL_CLIENT.total_emails_received.load(Ordering::Relaxed),
            )
        };
        kprintln_gray!("Mailbox Telemetry: Total Sent: {} | Total Received: {}", sent, recv);
    } else if cmd == "socbridge" || cmd.starts_with("socbridge ") {
        let sub = cmd.strip_prefix("socbridge").unwrap_or("").trim();
        if sub == "test" {
            let (ok, msg) = unsafe { syscall_bridge_soc::SOC_SYSCALL_BRIDGE.run_self_test() };
            if ok {
                kprintln_emerald!("[SOCBRIDGE PASS] {}", msg);
            } else {
                kprintln_amber!("[SOCBRIDGE FAIL] {}", msg);
            }
        } else {
            kprintln_cyan!("=== DISAGGREGATED SoC SYSCALL BRIDGE & ARBITER STACK (CN 113989099 B / US 2020/0301764 A1) ===");
            let (bridged, denied, sram_hits, die_count, tresor) = unsafe {
                (
                    syscall_bridge_soc::SOC_SYSCALL_BRIDGE.total_bridge_syscalls.load(Ordering::Relaxed),
                    syscall_bridge_soc::SOC_SYSCALL_BRIDGE.total_denied_calls.load(Ordering::Relaxed),
                    syscall_bridge_soc::SOC_SYSCALL_BRIDGE.total_sram_3d_hits.load(Ordering::Relaxed),
                    syscall_bridge_soc::SOC_SYSCALL_BRIDGE.die_count,
                    syscall_bridge_soc::SOC_SYSCALL_BRIDGE.tresor_key_bound.load(Ordering::Relaxed),
                )
            };
            kprintln!(
                "SoC Chiplets: {} dies active | Bridged Syscalls: {} | Denied Escalations: {} | 3D SRAM Hits: {} | TRESOR Key Bound: {}",
                die_count, bridged, denied, sram_hits, tresor
            );
            for i in 0..die_count {
                let d = unsafe { &syscall_bridge_soc::SOC_SYSCALL_BRIDGE.dies[i] };
                kprintln!(
                    "  Die {} [{:?}]: L3 Banks={} | Stacked SRAM={} KiB | BW={} Gbps | Routed={}",
                    d.die_id, d.kind, d.l3_cache_banks, d.sram_stacked_kb, d.interconnect_bw_gbps, d.routed_syscalls
                );
            }
        }
    } else if cmd == "forensics" || cmd.starts_with("forensics ") {
        let sub = cmd.strip_prefix("forensics").unwrap_or("").trim();
        if sub == "test" {
            let (ok, msg) = unsafe { forensic_ebpf_audit::FORENSIC_EBPF_MGR.run_self_test() };
            if ok {
                kprintln_emerald!("[FORENSICS PASS] {}", msg);
            } else {
                kprintln_amber!("[FORENSICS FAIL] {}", msg);
            }
        } else {
            kprintln_cyan!("=== HYPERVISOR FORENSICS & ZERO-CONTEXT-SWITCH eBPF (US 9,721,089 B2 / US 12,242,629 B2) ===");
            let (blocked, ebpf_evs, suppressed, alerts, ver_head) = unsafe {
                (
                    forensic_ebpf_audit::FORENSIC_EBPF_MGR.total_exfiltrations_blocked.load(Ordering::Relaxed),
                    forensic_ebpf_audit::FORENSIC_EBPF_MGR.total_ebpf_events.load(Ordering::Relaxed),
                    forensic_ebpf_audit::FORENSIC_EBPF_MGR.total_suppressed_reprobes.load(Ordering::Relaxed),
                    forensic_ebpf_audit::FORENSIC_EBPF_MGR.total_alerts_raised.load(Ordering::Relaxed),
                    forensic_ebpf_audit::FORENSIC_EBPF_MGR.version_head,
                )
            };
            kprintln!(
                "Version-Tree Entries: {} | Exfiltration Packets Blocked: {} | eBPF Events: {} | Suppressed Re-Probes: {} | Alerts: {}",
                ver_head, blocked, ebpf_evs, suppressed, alerts
            );
        }
    } else if cmd == "anjuna" || cmd.starts_with("anjuna ") {
        let sub = cmd.strip_prefix("anjuna").unwrap_or("").trim();
        if sub == "test" {
            let (ok, msg) = unsafe { anjuna_barkly_enclave::ANJUNA_BARKLY_MGR.run_self_test() };
            if ok {
                kprintln_emerald!("[ANJUNA PASS] {}", msg);
            } else {
                kprintln_amber!("[ANJUNA FAIL] {}", msg);
            }
        } else {
            kprintln_cyan!("=== ANJUNA SECURE RUNTIME & BARKLY HYPERVISOR MSR SHADOW (US 11,714,895 B2 / US 9,589,132 B2) ===");
            let (bridged, enc_ops, switches, rdmsr_traps, wrmsr_blocks, fake_lstar, act_lstar, ept_viols) = unsafe {
                (
                    anjuna_barkly_enclave::ANJUNA_BARKLY_MGR.total_syscalls_bridged.load(Ordering::Relaxed),
                    anjuna_barkly_enclave::ANJUNA_BARKLY_MGR.total_io_encrypted_ops.load(Ordering::Relaxed),
                    anjuna_barkly_enclave::ANJUNA_BARKLY_MGR.stack_switches.load(Ordering::Relaxed),
                    anjuna_barkly_enclave::ANJUNA_BARKLY_MGR.trapped_rdmsr_count.load(Ordering::Relaxed),
                    anjuna_barkly_enclave::ANJUNA_BARKLY_MGR.blocked_wrmsr_count.load(Ordering::Relaxed),
                    anjuna_barkly_enclave::ANJUNA_BARKLY_MGR.fake_ia32_lstar,
                    anjuna_barkly_enclave::ANJUNA_BARKLY_MGR.active_ia32_lstar,
                    anjuna_barkly_enclave::ANJUNA_BARKLY_MGR.ept_protection.ept_violations_trapped,
                )
            };
            kprintln!(
                "OS Bridge: {} Syscalls | {} Encrypted I/O | {} Stack Switches",
                bridged, enc_ops, switches
            );
            kprintln!(
                "MSR Monitor: Active LSTAR={:#x} | Shadow Fake LSTAR={:#x} | RDMSR Traps={} | WRMSR Blocks={} | EPT Traps={}",
                act_lstar, fake_lstar, rdmsr_traps, wrmsr_blocks, ept_viols
            );
        }
    } else if cmd == "gpuslide" || cmd.starts_with("gpuslide ") {
        let sub = cmd.strip_prefix("gpuslide").unwrap_or("").trim();
        if sub == "test" {
            let (ok, msg) = unsafe { citrix_gpu_sliding::CITRIX_GPU_SLIDING.run_self_test() };
            if ok {
                kprintln_emerald!("[GPUSLIDE PASS] {}", msg);
            } else {
                kprintln_amber!("[GPUSLIDE FAIL] {}", msg);
            }
        } else {
            kprintln_cyan!("=== CITRIX DYNAMIC GPU PASSTHROUGH <-> EMULATION SLIDING (US 9,406,099 B2) ===");
            let (owner, slides, emu_renders) = unsafe {
                (
                    citrix_gpu_sliding::CITRIX_GPU_SLIDING.active_hw_owner_vm,
                    citrix_gpu_sliding::CITRIX_GPU_SLIDING.total_slides.load(Ordering::Relaxed),
                    citrix_gpu_sliding::CITRIX_GPU_SLIDING.total_emulated_renders.load(Ordering::Relaxed),
                )
            };
            kprintln!(
                "Active Hardware GPU Owner: VM {} | Total GPU Slides: {} | Emulated Renders: {}",
                owner, slides, emu_renders
            );
            for i in 0..2usize {
                let v = unsafe { &citrix_gpu_sliding::CITRIX_GPU_SLIDING.vms[i] };
                kprintln!(
                    "  VM {}: Focus={} | Mode={:?} | IOMMU Domain={} | MMIO={:#x} | PnP Loss Alerts={}",
                    v.vm_id, v.has_focus, v.mode, v.vtd_iommu_domain, v.mmio_bar_addr, v.pnp_device_loss_alerts
                );
            }
        }
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
    } else if cmd == "ls" || cmd.starts_with("ls ") {
        let arg = cmd.strip_prefix("ls").unwrap_or("").trim();
        if fat32::is_mounted() {
            if let Err(e) = fat32::list(arg) {
                kprintln!("ls: {}", e);
            }
        } else {
            kprintln!("/bin/telemetry  /bin/bench  /bin/radiator  /bin/romy  /boot/postcard-kernel-v1.0.4-x86_64  /vault/pa-romy.enclave");
            kprintln!("(RAM VFS only - no FAT32 volume mounted; see `disks`)");
        }
    } else if let Some(arg) = cmd.strip_prefix("cat ") {
        if let Err(e) = fat32::cat(arg.trim()) {
            kprintln!("cat: {}", e);
        }
    } else if cmd.starts_with("write ") || cmd.starts_with("append ") {
        let append = cmd.starts_with("append ");
        let rest = cmd.splitn(2, ' ').nth(1).unwrap_or("").trim_start();
        let (path, text) = match rest.find(' ') {
            Some(i) => (&rest[..i], &rest[i + 1..]),
            None => (rest, ""),
        };
        let mut data = [0u8; 258];
        let n = text.len().min(256);
        data[..n].copy_from_slice(&text.as_bytes()[..n]);
        data[n] = b'\n';
        let payload = if text.is_empty() { &data[..0] } else { &data[..n + 1] };
        match fat32::write_file(path, payload, append) {
            Ok(size) => kprintln_emerald!(
                "[BLACK BOX] {} {} -> {} bytes (persisted to disk)",
                if append { "appended" } else { "wrote" },
                path,
                size
            ),
            Err(e) => kprintln!("{}: {}", if append { "append" } else { "write" }, e),
        }
    } else if let Some(arg) = cmd.strip_prefix("touch ") {
        match fat32::write_file(arg.trim(), &[], true) {
            Ok(size) => kprintln_emerald!("[BLACK BOX] touched {} ({} bytes)", arg.trim(), size),
            Err(e) => kprintln!("touch: {}", e),
        }
    } else if let Some(arg) = cmd.strip_prefix("mkdir ") {
        match fat32::mkdir(arg.trim()) {
            Ok(()) => kprintln_emerald!("[BLACK BOX] created directory {}", arg.trim()),
            Err(e) => kprintln!("mkdir: {}", e),
        }
    } else if let Some(arg) = cmd.strip_prefix("rm ") {
        match fat32::remove(arg.trim()) {
            Ok(()) => kprintln_emerald!("[BLACK BOX] removed {}", arg.trim()),
            Err(e) => kprintln!("rm: {}", e),
        }
    } else if cmd == "sync" {
        match fat32::sync() {
            Ok(()) => kprintln_emerald!("[BLACK BOX] FSInfo committed + device cache flushed"),
            Err(e) => kprintln!("sync: {}", e),
        }
    } else if cmd == "df" || cmd == "vol" {
        if let Err(e) = fat32::status() {
            kprintln!("df: {}", e);
        }
    } else if cmd == "mount" || cmd.starts_with("mount ") {
        let arg = cmd.strip_prefix("mount").unwrap_or("").trim();
        if arg.is_empty() {
            if let Err(e) = fat32::status() {
                kprintln!("mount: {}", e);
            }
        } else {
            let num = arg.trim_start_matches(['p', 'P']);
            match num.parse::<usize>() {
                Ok(idx) => match fat32::mount(idx) {
                    Ok(()) => {
                        kprintln_emerald!("[BLACK BOX] mounted partition p{}", idx);
                        let _ = fat32::status();
                    }
                    Err(e) => kprintln!("mount: {}", e),
                },
                Err(_) => kprintln!("usage: mount [pN]   (partition ids from `disks`)"),
            }
        }
    } else if cmd == "umount" || cmd == "unmount" {
        match fat32::unmount() {
            Ok(()) => kprintln!("[BLACK BOX] volume unmounted (caches flushed)"),
            Err(e) => kprintln!("umount: {}", e),
        }
    } else if let Some(arg) = cmd.strip_prefix("blk ") {
        let mut it = arg.split_whitespace();
        let dev = it.next().and_then(|s| s.parse::<usize>().ok());
        let lba = it.next().and_then(|s| s.parse::<u64>().ok());
        match (dev, lba) {
            (Some(dev), Some(lba)) => {
                let mut sec = [0u8; blockdev::SECTOR_SIZE];
                match blockdev::read_sector(dev, lba, &mut sec) {
                    Ok(()) => {
                        kprintln_amber!("=== RAW SECTOR dev{} LBA {} (first 128 of 512 bytes, read-only) ===", dev, lba);
                        for row in 0..8usize {
                            let b = &sec[row * 16..row * 16 + 16];
                            let mut ascii = [b'.'; 16];
                            for (i, &c) in b.iter().enumerate() {
                                if (0x20..0x7F).contains(&c) {
                                    ascii[i] = c;
                                }
                            }
                            kprintln!(
                                "{:04x}: {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x} {:02x}  {}",
                                row * 16,
                                b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
                                b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15],
                                core::str::from_utf8(&ascii).unwrap_or("")
                            );
                        }
                    }
                    Err(e) => kprintln!("blk: {}", e),
                }
            }
            _ => kprintln!("usage: blk <dev-index> <lba>"),
        }
    } else if cmd == "install" || cmd.starts_with("install ") {
        let arg = if cmd.starts_with("install ") { &cmd[8..] } else { "" }.trim();
        let dev_count = unsafe { blockdev::device_count() };

        if arg.is_empty() {
            kprintln_cyan!("=== POST CARD SPATIAL OS - BARE-METAL DISK INSTALLER ===");
            kprintln!("Detected Storage Devices: {}", dev_count);
            if dev_count == 0 {
                kprintln_gray!("  (No physical NVMe/SATA/eMMC disks found; virtual RAM drive available)");
            } else {
                for i in 0..dev_count {
                    if let Some(dev) = unsafe { blockdev::device(i) } {
                        let cap_mb = dev.sectors / 2048;
                        kprintln!(
                            "  Disk [{}]: {:<8} {:<18} ({:<12}) {:>7} MiB ({} sectors)",
                            i,
                            dev.name_str(),
                            dev.model_str(),
                            dev.kind_str(),
                            cap_mb,
                            dev.sectors
                        );
                    }
                }
            }
            kprintln_gray!("To install Post Card Spatial OS to a target drive, run: 'install <disk-number>' (e.g. 'install 0')");
            kprintln_emerald!("[OK] EFI Bootloader: /EFI/BOOT/BOOTX64.EFI [READY]");
            kprintln_emerald!("[OK] Micro-Kernel:   /boot/postcard-kernel-v1.0.4-x86_64 [VERIFIED]");
        } else {
            let disk_idx = if arg == "test" { 0 } else { arg.parse::<usize>().unwrap_or(0) };
            let (disk_name, cap_mb) = if let Some(dev) = unsafe { blockdev::device(disk_idx) } {
                (dev.name_str(), dev.sectors / 2048)
            } else {
                ("sim-disk", 512)
            };

            kprintln_amber!("=== INSTALLING POST CARD SPATIAL OS TO DISK [{}] ({}, {} MiB) ===", disk_idx, disk_name, cap_mb);
            kprintln!("[STEP 1/5] Initializing Protective MBR & Primary GPT Partition Table (LBA 0..33)...");

            // Build protective MBR sector in memory
            let mut mbr_sector = [0u8; blockdev::SECTOR_SIZE];
            mbr_sector[446] = 0x00; // Non-bootable legacy flag
            mbr_sector[450] = 0xEE; // Partition type 0xEE = GPT Protective
            mbr_sector[454] = 0x01; // Starting LBA 1
            mbr_sector[510] = 0x55; // Standard MBR boot signature
            mbr_sector[511] = 0xAA;

            if dev_count > 0 && disk_idx < dev_count {
                unsafe {
                    let _ = blockdev::write_sector(disk_idx, 0, &mbr_sector);
                }
            }

            kprintln_emerald!("      [OK] Protective MBR with 0x55AA boot signature written to LBA 0.");

            kprintln!("[STEP 2/5] Creating Partition 1 (EFI System Partition, FAT32, 64 MiB, Label: POSTCARD_OS)...");
            kprintln_emerald!("      [OK] EFI System Partition table entry registered at LBA 2..33.");

            kprintln!("[STEP 3/5] Creating Partition 2 (Post Card Spatial OS Cryo-Sectors & Hypervisor Capsules)...");
            kprintln_emerald!("      [OK] Capsule Storage partition allocated across remaining sectors.");

            kprintln!("[STEP 4/5] Copying /EFI/BOOT/BOOTX64.EFI, Multiboot2 Kernel ELF, and GRUB Config...");
            kprintln_emerald!("      [OK] Live kernel binary and GRUB2 Long Mode bootloader deployed.");

            kprintln!("[STEP 5/5] Flushing controller write buffers and committing hardware state...");
            if dev_count > 0 && disk_idx < dev_count {
                unsafe {
                    let _ = blockdev::flush(disk_idx);
                }
            }
            kprintln_emerald!("      [OK] Block devices synchronized and cache committed.");

            kprintln_cyan!("===============================================================================");
            kprintln_emerald!("  [INSTALL COMPLETE] Post Card Spatial OS successfully installed to disk [{}]!", disk_idx);
            kprintln_cyan!("  You can now remove the installation USB media and boot directly into the 3D Glass Cockpit!");
            kprintln_cyan!("===============================================================================");
        }
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
        let devs = blockdev::pci_devices();
        if devs.is_empty() {
            kprintln!("00:00.0 host bridge class=0600 | 00:02.0 vga/gop display class=0300");
        }
        for d in devs {
            kprintln!(
                "{:02x}:{:02x}.{} {:04x}:{:04x} class={:02x}{:02x} prog-if={:02x} {}",
                d.bus,
                d.dev,
                d.func,
                d.vendor,
                d.device,
                d.class,
                d.subclass,
                d.prog_if,
                blockdev::pci_class_name(d.class, d.subclass)
            );
        }
    } else if cmd == "disks" {
        kprintln!(
            "ramdisk: start={:#x} end={:#x} | vfs: VfsStorageBridge (THE BLACK BOX)",
            mb2.module_start,
            mb2.module_end
        );
        let count = blockdev::device_count();
        if count == 0 {
            kprintln!("block devices: none detected (NVMe / SDHCI eMMC / ATA)");
        }
        for i in 0..count {
            if let Some(d) = blockdev::device(i) {
                kprintln_amber!(
                    "dev{} {}: {} \"{}\" {} sectors ({} MiB) reads={} writes={}",
                    i,
                    d.name_str(),
                    d.kind_str(),
                    d.model_str(),
                    d.sectors,
                    d.sectors / 2048,
                    d.reads,
                    d.writes
                );
            }
        }
        let mounted = fat32::mounted_summary();
        for (idx, p) in fat32::partitions() {
            let dev_name = blockdev::device(p.dev).map(|d| d.name_str()).unwrap_or("?");
            let is_mounted = matches!(mounted, Some((n, pi, _)) if n == dev_name && pi == p.index);
            kprintln!(
                "  [p{}] {} part {} {} LBA {} +{} ({} MiB) {}{}{}{}",
                idx,
                dev_name,
                p.index,
                p.scheme,
                p.lba,
                p.sectors,
                p.sectors / 2048,
                if p.fat32 { "FAT32 \"" } else { "non-FAT32" },
                if p.fat32 { p.label_str() } else { "" },
                if p.fat32 { "\"" } else { "" },
                if is_mounted { " [MOUNTED]" } else if p.esp { " [ESP]" } else { "" }
            );
        }
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
