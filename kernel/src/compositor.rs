// ============================================================================
// THE GLASS COCKPIT // NATIVE SPATIAL CARD DECK COMPOSITOR
// ============================================================================
// Full 2D/3D-accented window and card deck compositor for Post Card Spatial OS.
// Renders directly into the UEFI GOP linear framebuffer (1024x768x32).
//
// Features:
//   * Double-buffered dirty-rect software cursor (216-pixel restore, 60+ FPS).
//   * Interactive draggable "Post Cards" with titlebar grip, z-ordering, and buttons.
//   * Real-time subsystem wiring:
//       - Card 0: Avionics & Telemetry HUD (live TSC, ticks, memory, thermal state)
//       - Card 1: The Catapult (Ring 3 ELF64 loader with live execution buttons)
//       - Card 2: The Black Box (FAT32 storage status & sync/touch controls)
//       - Card 3: PA-Romy Vault (Micro-VM capsule hypervisor monitor & VM-run steps)
//   * Smooth toggling between full GUI Desktop and SPATIAL> Console shell.

use crate::blockdev;
use crate::fat32;
use crate::glyph_8x8;
use crate::mouse::{self, MouseState};
use crate::nvidia_maxq_estimator::{self, OptimizationMode, NVIDIA_MAXQ_ESTIMATOR};
use crate::shm_ipc::VOYAGER_SHM_IPC;
use crate::GopFramebufferInfo;
use crate::CAPSULES;
use crate::PROCS;
use crate::TICKS;
use crate::VTX_STATE;
use core::sync::atomic::Ordering;

// ----------------------------------------------------------------------------
// Color Palette (Cosmic Obsidian + Aerospace Glass)
// ----------------------------------------------------------------------------
pub const COLOR_BG: u32 = 0x000B0C10; // Cosmic Obsidian
pub const COLOR_PANEL_BG: u32 = 0x00141C30; // Deep Space Navy
pub const COLOR_CARD_BG: u32 = 0x00101726; // Card Body
pub const COLOR_CARD_HEADER: u32 = 0x001E293B; // Card Header Bar
pub const COLOR_CARD_BORDER: u32 = 0x00334155; // Muted Border
pub const COLOR_TEXT_LIGHT: u32 = 0x00F8FAFC; // High-contrast White
pub const COLOR_TEXT_MUTED: u32 = 0x0094A3B8; // Slate Gray

pub const COLOR_AMBER: u32 = 0x00FFB81C; // Flight Amber
pub const COLOR_EMERALD: u32 = 0x0022C55E; // Systems Nominal
pub const COLOR_CYAN: u32 = 0x0038BDF8; // Storage & VFS
pub const COLOR_VIOLET: u32 = 0x00A855F7; // Neural Enclave
pub const COLOR_CRIMSON: u32 = 0x00EF4444; // Warning / Fault
#[allow(dead_code)]
const _UNUSED_CRIMSON: u32 = COLOR_CRIMSON;

// ----------------------------------------------------------------------------
// Software Cursor Engine (12x18 Arrow Sprite + Dirty-Rect Restore)
// ----------------------------------------------------------------------------
pub const CURSOR_W: u32 = 12;
pub const CURSOR_H: u32 = 18;

// 1 = dark border (0x000F172A), 2 = bright cyan interior (0x0038BDF8), 3 = white tip (0x00FFFFFF)
#[rustfmt::skip]
const CURSOR_BITMAP: [u8; (CURSOR_W * CURSOR_H) as usize] = [
    1,0,0,0,0,0,0,0,0,0,0,0,
    1,3,0,0,0,0,0,0,0,0,0,0,
    1,3,3,0,0,0,0,0,0,0,0,0,
    1,3,2,3,0,0,0,0,0,0,0,0,
    1,3,2,2,3,0,0,0,0,0,0,0,
    1,3,2,2,2,3,0,0,0,0,0,0,
    1,3,2,2,2,2,3,0,0,0,0,0,
    1,3,2,2,2,2,2,3,0,0,0,0,
    1,3,2,2,2,2,2,2,3,0,0,0,
    1,3,2,2,2,2,2,2,2,3,0,0,
    1,3,2,2,2,2,1,1,1,1,1,0,
    1,3,2,3,2,2,1,0,0,0,0,0,
    1,3,3,0,1,2,2,1,0,0,0,0,
    1,3,0,0,1,2,2,1,0,0,0,0,
    1,0,0,0,0,1,2,2,1,0,0,0,
    0,0,0,0,0,1,2,2,1,0,0,0,
    0,0,0,0,0,0,1,1,1,0,0,0,
    0,0,0,0,0,0,0,0,0,0,0,0,
];

static mut CURSOR_BG: [u32; (CURSOR_W * CURSOR_H) as usize] = [0; (CURSOR_W * CURSOR_H) as usize];
static mut CURSOR_PREV_X: i32 = -1;
static mut CURSOR_PREV_Y: i32 = -1;
static mut CURSOR_VISIBLE: bool = false;

// ----------------------------------------------------------------------------
// Low-Level Drawing Primitives
// ----------------------------------------------------------------------------
#[inline(always)]
pub unsafe fn put_pixel(fb: &GopFramebufferInfo, x: i32, y: i32, rgb: u32) {
    if x < 0 || y < 0 || x >= fb.width as i32 || y >= fb.height as i32 {
        return;
    }
    let bpp = (fb.bpp as u32) / 8;
    let offset = ((y as u32) * fb.pitch + (x as u32) * bpp) as usize;
    let ptr = (fb.addr as usize + offset) as *mut u8;
    if bpp == 4 {
        core::ptr::write_volatile(ptr as *mut u32, rgb);
    } else if bpp == 3 {
        core::ptr::write_volatile(ptr, (rgb & 0xFF) as u8);
        core::ptr::write_volatile(ptr.add(1), ((rgb >> 8) & 0xFF) as u8);
        core::ptr::write_volatile(ptr.add(2), ((rgb >> 16) & 0xFF) as u8);
    }
}

#[inline(always)]
pub unsafe fn get_pixel(fb: &GopFramebufferInfo, x: i32, y: i32) -> u32 {
    if x < 0 || y < 0 || x >= fb.width as i32 || y >= fb.height as i32 {
        return 0;
    }
    let bpp = (fb.bpp as u32) / 8;
    let offset = ((y as u32) * fb.pitch + (x as u32) * bpp) as usize;
    let ptr = (fb.addr as usize + offset) as *const u8;
    if bpp == 4 {
        core::ptr::read_volatile(ptr as *const u32)
    } else if bpp == 3 {
        let b0 = core::ptr::read_volatile(ptr) as u32;
        let b1 = core::ptr::read_volatile(ptr.add(1)) as u32;
        let b2 = core::ptr::read_volatile(ptr.add(2)) as u32;
        b0 | (b1 << 8) | (b2 << 16)
    } else {
        0
    }
}

pub unsafe fn fill_rect(fb: &GopFramebufferInfo, x: i32, y: i32, w: i32, h: i32, rgb: u32) {
    let x_start = x.max(0);
    let y_start = y.max(0);
    let x_end = (x + w).min(fb.width as i32);
    let y_end = (y + h).min(fb.height as i32);
    for py in y_start..y_end {
        for px in x_start..x_end {
            put_pixel(fb, px, py, rgb);
        }
    }
}

pub unsafe fn draw_rect_border(fb: &GopFramebufferInfo, x: i32, y: i32, w: i32, h: i32, border_rgb: u32) {
    fill_rect(fb, x, y, w, 1, border_rgb);
    fill_rect(fb, x, y + h - 1, w, 1, border_rgb);
    fill_rect(fb, x, y, 1, h, border_rgb);
    fill_rect(fb, x + w - 1, y, 1, h, border_rgb);
}

pub unsafe fn draw_str(fb: &GopFramebufferInfo, x: i32, y: i32, s: &str, fg: u32, bg: Option<u32>) {
    for (idx, ch) in s.bytes().enumerate() {
        let bx = x + (idx as i32) * 8;
        if bx + 8 > fb.width as i32 || y + 8 > fb.height as i32 {
            break;
        }
        let bitmap = glyph_8x8(ch);
        for gy in 0..8i32 {
            let bits = bitmap[gy as usize];
            for gx in 0..8i32 {
                if (bits & (0x80 >> gx)) != 0 {
                    put_pixel(fb, bx + gx, y + gy, fg);
                } else if let Some(bg_rgb) = bg {
                    put_pixel(fb, bx + gx, y + gy, bg_rgb);
                }
            }
        }
    }
}

// ----------------------------------------------------------------------------
// Cursor Restoration & Drawing
// ----------------------------------------------------------------------------
pub unsafe fn cursor_restore(fb: &GopFramebufferInfo) {
    if !CURSOR_VISIBLE || CURSOR_PREV_X < 0 || CURSOR_PREV_Y < 0 {
        return;
    }
    for cy in 0..CURSOR_H as i32 {
        for cx in 0..CURSOR_W as i32 {
            let px = CURSOR_PREV_X + cx;
            let py = CURSOR_PREV_Y + cy;
            let idx = (cy * CURSOR_W as i32 + cx) as usize;
            put_pixel(fb, px, py, CURSOR_BG[idx]);
        }
    }
    CURSOR_VISIBLE = false;
}

pub unsafe fn cursor_draw(fb: &GopFramebufferInfo, x: i32, y: i32) {
    cursor_restore(fb);

    // Save background under new position
    for cy in 0..CURSOR_H as i32 {
        for cx in 0..CURSOR_W as i32 {
            let px = x + cx;
            let py = y + cy;
            let idx = (cy * CURSOR_W as i32 + cx) as usize;
            CURSOR_BG[idx] = get_pixel(fb, px, py);
        }
    }

    // Draw sprite
    for cy in 0..CURSOR_H as i32 {
        for cx in 0..CURSOR_W as i32 {
            let idx = (cy * CURSOR_W as i32 + cx) as usize;
            let pixel_type = CURSOR_BITMAP[idx];
            let color = match pixel_type {
                1 => 0x000F172A, // Outline
                2 => 0x0038BDF8, // Cyan body
                3 => 0x00FFFFFF, // White highlight
                _ => continue,
            };
            put_pixel(fb, x + cx, y + cy, color);
        }
    }

    CURSOR_PREV_X = x;
    CURSOR_PREV_Y = y;
    CURSOR_VISIBLE = true;
}

// ----------------------------------------------------------------------------
// Spatial Card Data Structure
// ----------------------------------------------------------------------------
#[derive(Clone, Copy)]
pub struct SpatialCard {
    pub id: usize,
    pub title: &'static str,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub accent: u32,
    pub status: &'static str,
}

pub const NUM_CARDS: usize = 5;

static mut CARDS: [SpatialCard; NUM_CARDS] = [
    SpatialCard {
        id: 0,
        title: "AVIONICS // SPACE PLANE HUD",
        x: 24,
        y: 96,
        w: 320,
        h: 290,
        accent: COLOR_AMBER,
        status: "ACTIVE",
    },
    SpatialCard {
        id: 1,
        title: "THE CATAPULT // ELF64 LAUNCHER",
        x: 360,
        y: 96,
        w: 320,
        h: 290,
        accent: COLOR_EMERALD,
        status: "READY",
    },
    SpatialCard {
        id: 2,
        title: "THE BLACK BOX // DISK PERSISTENCE",
        x: 24,
        y: 402,
        w: 320,
        h: 300,
        accent: COLOR_CYAN,
        status: "MOUNTED",
    },
    SpatialCard {
        id: 3,
        title: "PA-ROMY VAULT // MICRO-VM ENCLAVE",
        x: 360,
        y: 402,
        w: 320,
        h: 300,
        accent: COLOR_VIOLET,
        status: "LOCKED",
    },
    SpatialCard {
        id: 4,
        title: "PATENT ENGINE // MAX-Q & SHM",
        x: 696,
        y: 96,
        w: 304,
        h: 606,
        accent: COLOR_CYAN,
        status: "ONLINE",
    },
];

static mut Z_ORDER: [usize; NUM_CARDS] = [0, 1, 2, 3, 4];
static mut ACTIVE_DRAG_CARD: Option<usize> = None;
static mut DRAG_OFFSET_X: i32 = 0;
static mut DRAG_OFFSET_Y: i32 = 0;
static mut LAST_ACTION_MSG: &'static str = "Spatial OS Compositor online. Click or drag cards.";

pub fn active_drag_card() -> Option<usize> {
    unsafe { ACTIVE_DRAG_CARD }
}

// ----------------------------------------------------------------------------
// Card Rendering Subroutines
// ----------------------------------------------------------------------------
unsafe fn render_card_frame(fb: &GopFramebufferInfo, card: &SpatialCard, is_top: bool) {
    // Drop shadow
    fill_rect(fb, card.x + 4, card.y + 4, card.w, card.h, 0x00050810);
    // Background
    fill_rect(fb, card.x, card.y, card.w, card.h, COLOR_CARD_BG);
    // Border
    let border_color = if is_top { card.accent } else { COLOR_CARD_BORDER };
    draw_rect_border(fb, card.x, card.y, card.w, card.h, border_color);

    // Titlebar
    fill_rect(fb, card.x, card.y, card.w, 24, COLOR_CARD_HEADER);
    fill_rect(fb, card.x, card.y + 23, card.w, 1, card.accent);
    // Accent grip pip
    fill_rect(fb, card.x + 8, card.y + 7, 10, 10, card.accent);
    // Title
    draw_str(fb, card.x + 24, card.y + 8, card.title, COLOR_TEXT_LIGHT, None);
    // Status Tag
    draw_str(fb, card.x + card.w - 70, card.y + 8, card.status, card.accent, None);
}

unsafe fn render_card_content(fb: &GopFramebufferInfo, card: &SpatialCard) {
    let bx = card.x + 12;
    let mut by = card.y + 34;

    match card.id {
        0 => {
            // Avionics Telemetry
            draw_str(fb, bx, by, "Chassis: Al-Li 2195 Cryo Hull", COLOR_TEXT_LIGHT, None);
            by += 16;
            draw_str(fb, bx, by, "Heap: 16384K LockedArena", COLOR_TEXT_MUTED, None);
            by += 16;
            draw_str(fb, bx, by, "Thermal: Loop [STABILIZED]", COLOR_EMERALD, None);
            by += 16;
            let t = TICKS.load(Ordering::Relaxed);
            let mut buf = [0u8; 32];
            let uptime_str = format_num(t / 1000, &mut buf);
            draw_str(fb, bx, by, "Uptime:", COLOR_TEXT_MUTED, None);
            draw_str(fb, bx + 64, by, uptime_str, COLOR_AMBER, None);
            draw_str(fb, bx + 120, by, "sec", COLOR_TEXT_MUTED, None);
            by += 20;

            // VT-x State
            if VTX_STATE.vmx_root_active {
                draw_str(fb, bx, by, "VT-x: VMXON Root Active", COLOR_EMERALD, None);
            } else {
                draw_str(fb, bx, by, "VT-x: 4 Capsule Slots Armed", COLOR_AMBER, None);
            }
            by += 24;

            // Visual Fuel / Power Meter Bar
            draw_str(fb, bx, by, "AVIONICS BUS 28V:", COLOR_TEXT_MUTED, None);
            by += 12;
            fill_rect(fb, bx, by, card.w - 24, 12, 0x000F172A);
            fill_rect(fb, bx + 2, by + 2, (card.w - 28) * 85 / 100, 8, COLOR_AMBER);
            by += 20;

            // Interactive Button
            draw_button(fb, bx, by, 120, 22, "[CALIBRATE]", COLOR_AMBER);
        }
        1 => {
            // The Catapult Launcher
            draw_str(fb, bx, by, "Ring 3 Spatial Process Deck:", COLOR_TEXT_MUTED, None);
            by += 18;

            let targets = ["telemetry", "bench", "radiator", "romy"];
            for (i, name) in targets.iter().enumerate() {
                let p = &PROCS[i + 4];
                draw_str(fb, bx, by + 4, name, COLOR_TEXT_LIGHT, None);
                let btn_label = if p.runs > 0 { "[EXEC+]" } else { "[LAUNCH]" };
                draw_button(fb, bx + 160, by, 90, 18, btn_label, COLOR_EMERALD);
                by += 22;
            }

            by += 14;
            draw_str(fb, bx, by, "Scheduler: Preemptive R-R", COLOR_TEXT_MUTED, None);
            by += 14;
            draw_str(fb, bx, by, "Syscalls: IA32_EFER.SCE=1", COLOR_EMERALD, None);
        }
        2 => {
            // The Black Box (Storage)
            let dev_count = blockdev::device_count();
            if dev_count > 0 {
                if let Some(d) = blockdev::device(0) {
                    draw_str(fb, bx, by, "Controller:", COLOR_TEXT_MUTED, None);
                    draw_str(fb, bx + 96, by, d.kind_str(), COLOR_CYAN, None);
                    by += 16;
                    draw_str(fb, bx, by, "Drive Model:", COLOR_TEXT_MUTED, None);
                    by += 14;
                    draw_str(fb, bx + 8, by, d.model_str(), COLOR_TEXT_LIGHT, None);
                    by += 18;
                }
            } else {
                draw_str(fb, bx, by, "Storage: RAM-only VFS", COLOR_AMBER, None);
                by += 18;
            }

            if fat32::is_mounted() {
                if let Some((dev, _part, label)) = fat32::mounted_summary() {
                    draw_str(fb, bx, by, "Volume: /POSTCARD (FAT32)", COLOR_EMERALD, None);
                    by += 14;
                    draw_str(fb, bx, by, "Mount:", COLOR_TEXT_MUTED, None);
                    draw_str(fb, bx + 56, by, dev, COLOR_CYAN, None);
                    draw_str(fb, bx + 110, by, label, COLOR_TEXT_LIGHT, None);
                    by += 20;
                }
            } else {
                draw_str(fb, bx, by, "FAT32: Not mounted", COLOR_AMBER, None);
                by += 20;
            }

            // Storage Action Buttons
            draw_button(fb, bx, by, 110, 22, "[SYNC FLUSH]", COLOR_CYAN);
            draw_button(fb, bx + 124, by, 110, 22, "[TOUCH NOTE]", COLOR_TEXT_LIGHT);
            by += 32;

            draw_str(fb, bx, by, "Safety: Writes locked to /POSTCARD", COLOR_TEXT_MUTED, None);
        }
        3 => {
            // PA-Romy Enclave
            draw_str(fb, bx, by, "Micro-VM Isolation Capsules:", COLOR_TEXT_MUTED, None);
            by += 16;

            for i in 0..4usize {
                let cap = &CAPSULES[i];
                let mut name_buf = [0u8; 12];
                let n = cap.name_len.min(12);
                name_buf[..n].copy_from_slice(&cap.name[..n]);
                let name = core::str::from_utf8(&name_buf[..n]).unwrap_or("capsule");

                draw_str(fb, bx, by + 3, name, COLOR_TEXT_LIGHT, None);
                draw_button(fb, bx + 140, by, 72, 18, "[VM-RUN]", COLOR_VIOLET);
                by += 22;
            }

            by += 6;
            draw_button(fb, bx, by, 220, 20, "[FLY PAPER AIRPLANE]", COLOR_AMBER);
            by += 24;

            let hsm_auth = crate::softhsm::SOFTHSM_CTX.is_authenticated();
            if hsm_auth {
                draw_str(fb, bx, by, "HSM: 5GSH [G-SSO ACTIVE]", COLOR_EMERALD, None);
            } else {
                draw_str(fb, bx, by, "HSM: 5GSH [UNVERIFIED]", COLOR_CRIMSON, None);
            }
            by += 14;

            draw_str(fb, bx, by, "Isolation: Ring 0/VMX Root", COLOR_VIOLET, None);
        }
        4 => {
            // Card 4: Patent Engine (Max-Q Dynamic Boost & Voyager SHM)
            draw_str(fb, bx, by, "NVIDIA MAX-Q Dynamic Boost:", COLOR_TEXT_LIGHT, None);
            by += 16;

            let cur = &NVIDIA_MAXQ_ESTIMATOR.current_point;
            let mode_str = nvidia_maxq_estimator::opt_mode_str(NVIDIA_MAXQ_ESTIMATOR.mode);
            draw_str(fb, bx, by, "Mode:", COLOR_TEXT_MUTED, None);
            draw_str(fb, bx + 48, by, mode_str, COLOR_CYAN, None);
            by += 16;

            draw_str(fb, bx, by, "GPU Clock:", COLOR_TEXT_MUTED, None);
            let mut buf_g = [0u8; 32];
            let g_str = format_num(cur.gpu_freq_mhz as u64, &mut buf_g);
            draw_str(fb, bx + 84, by, g_str, COLOR_EMERALD, None);
            draw_str(fb, bx + 128, by, "MHz", COLOR_TEXT_MUTED, None);
            by += 16;

            draw_str(fb, bx, by, "V-F Draw:", COLOR_TEXT_MUTED, None);
            let mut buf_p = [0u8; 32];
            let p_str = format_num(cur.predicted_total_power_w as u64, &mut buf_p);
            draw_str(fb, bx + 76, by, p_str, COLOR_AMBER, None);
            draw_str(fb, bx + 100, by, "W / 80W TDP", COLOR_TEXT_MUTED, None);
            by += 14;

            // Power Gauge Bar
            fill_rect(fb, bx, by, card.w - 24, 10, 0x000F172A);
            let fill_w = ((card.w - 28) * (cur.predicted_total_power_w as i32)).min(card.w - 28) / 80;
            fill_rect(fb, bx + 2, by + 2, fill_w.max(2), 6, COLOR_AMBER);
            by += 18;

            draw_button(fb, bx, by, 130, 22, "[CYCLE MODE]", COLOR_CYAN);
            draw_button(fb, bx + 138, by, 130, 22, "[STEP MAX-Q]", COLOR_EMERALD);
            by += 32;

            // Voyager SHM Section
            draw_str(fb, bx, by, "Voyager SHM Ring Bus:", COLOR_TEXT_LIGHT, None);
            by += 16;
            draw_str(fb, bx, by, "Topics: 3 Registered", COLOR_TEXT_MUTED, None);
            by += 14;
            draw_str(fb, bx, by, "Sync: tail & pending_tail", COLOR_EMERALD, None);
            by += 14;
            draw_str(fb, bx, by, "Overwrites: 0 (Lossless)", COLOR_CYAN, None);
            by += 18;
            draw_button(fb, bx, by, 268, 22, "[PUBLISH TELEMETRY SHM]", COLOR_AMBER);
            by += 32;

            // Subsystem Status Matrix
            draw_str(fb, bx, by, "Kwasm: wasm64 Kernel-Safe", COLOR_EMERALD, None);
            by += 14;
            draw_str(fb, bx, by, "FPU: STRICTLY DISABLED", COLOR_TEXT_MUTED, None);
            by += 14;
            draw_str(fb, bx, by, "ARAIS: >99.9% Vector Bandwidth", COLOR_CYAN, None);
            by += 14;
            draw_str(fb, bx, by, "Tala Guard: GAST Enforced", COLOR_EMERALD, None);
            by += 14;
            draw_str(fb, bx, by, "Wave MD-DMA: 5-D Tensor PE Quad", COLOR_AMBER, None);
        }
        _ => {}
    }
}

pub unsafe fn draw_button(fb: &GopFramebufferInfo, x: i32, y: i32, w: i32, h: i32, text: &str, border: u32) {
    fill_rect(fb, x, y, w, h, 0x00141C30);
    draw_rect_border(fb, x, y, w, h, border);
    let str_w = (text.len() as i32) * 8;
    let tx = x + (w - str_w) / 2;
    let ty = y + (h - 8) / 2;
    draw_str(fb, tx, ty, text, COLOR_TEXT_LIGHT, None);
}

// ----------------------------------------------------------------------------
// Compositor Desktop Shell & Mission Header
// ----------------------------------------------------------------------------
pub unsafe fn render_desktop(fb: &GopFramebufferInfo) {
    // 1. Cosmic Obsidian Background (#0B0C10)
    fill_rect(fb, 0, 0, fb.width as i32, fb.height as i32, COLOR_BG);

    // 2. Subtle Coordinate Grid Points (every 64 px)
    for gy in (84..fb.height as i32).step_by(64) {
        for gx in (32..fb.width as i32).step_by(64) {
            put_pixel(fb, gx, gy, 0x001E293B);
        }
    }

    // 3. Top Mission Header Bar (Glass Cockpit)
    fill_rect(fb, 16, 16, (fb.width - 32) as i32, 54, COLOR_PANEL_BG);
    fill_rect(fb, 16, 68, (fb.width - 32) as i32, 2, COLOR_AMBER);

    // Header Badges
    fill_rect(fb, 28, 26, 14, 14, COLOR_EMERALD);
    draw_str(fb, 50, 29, "POST CARD SPATIAL OS // DECK COMPOSITOR", COLOR_TEXT_LIGHT, None);
    draw_str(fb, 50, 45, "Native Bare-Metal Windowing Engine v1.0.5", COLOR_TEXT_MUTED, None);

    // Top Action Buttons
    draw_button(fb, (fb.width - 240) as i32, 26, 100, 28, "[RESET POS]", COLOR_CYAN);
    draw_button(fb, (fb.width - 130) as i32, 26, 104, 28, "[CONSOLE]", COLOR_AMBER);

    // 4. Render Spatial Cards according to Z-order
    for &idx in Z_ORDER.iter() {
        let is_top = idx == Z_ORDER[NUM_CARDS - 1];
        let card = CARDS[idx];
        render_card_frame(fb, &card, is_top);
        render_card_content(fb, &card);
    }

    // 5. Bottom Status / Navigation Bar
    let bottom_y = (fb.height - 32) as i32;
    fill_rect(fb, 0, bottom_y, fb.width as i32, 32, 0x00050810);
    fill_rect(fb, 0, bottom_y, fb.width as i32, 1, 0x001E293B);

    draw_str(fb, 16, bottom_y + 10, "STATUS:", COLOR_AMBER, None);
    draw_str(fb, 80, bottom_y + 10, LAST_ACTION_MSG, COLOR_TEXT_LIGHT, None);

    draw_str(fb, (fb.width - 380) as i32, bottom_y + 10, "[TAB / ESC] Console", COLOR_TEXT_MUTED, None);
    draw_str(fb, (fb.width - 220) as i32, bottom_y + 10, "[DRAG] Move Cards", COLOR_CYAN, None);
}

// ----------------------------------------------------------------------------
// Click & Drag Interaction Dispatcher
// ----------------------------------------------------------------------------
pub unsafe fn handle_click(fb: &GopFramebufferInfo, m: &MouseState) -> Option<&'static str> {
    // 1. Check Top Bar Buttons
    // Reset positions button: (fb.width - 240, 26, 100, 28)
    if m.x >= (fb.width - 240) as i32 && m.x <= (fb.width - 140) as i32 && m.y >= 26 && m.y <= 54 {
        CARDS[0].x = 24;
        CARDS[0].y = 96;
        CARDS[1].x = 360;
        CARDS[1].y = 96;
        CARDS[2].x = 24;
        CARDS[2].y = 402;
        CARDS[3].x = 360;
        CARDS[3].y = 402;
        CARDS[4].x = 696;
        CARDS[4].y = 96;
        LAST_ACTION_MSG = "Card positions reset to default grid.";
        render_desktop(fb);
        return None;
    }

    // Console exit button: (fb.width - 130, 26, 104, 28)
    if m.x >= (fb.width - 130) as i32 && m.x <= (fb.width - 26) as i32 && m.y >= 26 && m.y <= 54 {
        return Some("EXIT_CONSOLE");
    }

    // 2. Check Cards in Reverse Z-Order (topmost card receives clicks first)
    for i in (0..NUM_CARDS).rev() {
        let card_idx = Z_ORDER[i];
        let card = &mut CARDS[card_idx];

        if m.x >= card.x && m.x <= card.x + card.w && m.y >= card.y && m.y <= card.y + card.h {
            // Bring this card to front of Z-order
            bring_to_front(card_idx);

            // A. Check Titlebar Grip Drag (y in card.y .. card.y + 24)
            if m.y <= card.y + 24 {
                ACTIVE_DRAG_CARD = Some(card_idx);
                DRAG_OFFSET_X = m.x - card.x;
                DRAG_OFFSET_Y = m.y - card.y;
                render_desktop(fb);
                return None;
            }

            // B. Card-Specific Content Buttons
            let rel_x = m.x - card.x;
            let rel_y = m.y - card.y;

            match card.id {
                0 => {
                    // Card 0: Calibrate Button (12, 192, 120, 22)
                    if rel_x >= 12 && rel_x <= 132 && rel_y >= 190 && rel_y <= 214 {
                        LAST_ACTION_MSG = "Avionics Calibrated: 1000Hz tick loop stable.";
                        render_desktop(fb);
                        return None;
                    }
                }
                1 => {
                    // Card 1: Launcher Buttons
                    let targets = ["telemetry", "bench", "radiator", "romy"];
                    let mut btn_y = 52;
                    for target in targets {
                        if rel_x >= 172 && rel_x <= 262 && rel_y >= btn_y && rel_y <= btn_y + 18 {
                            let _ = crate::catapult_load_and_exec(target, false);
                            LAST_ACTION_MSG = "Catapult spawned Ring 3 ELF64 binary!";
                            render_desktop(fb);
                            return None;
                        }
                        btn_y += 22;
                    }
                }
                2 => {
                    // Card 2: Storage Buttons
                    // Sync Flush (12, 182, 110, 22)
                    if rel_x >= 12 && rel_x <= 122 && rel_y >= 180 && rel_y <= 204 {
                        let _ = fat32::sync();
                        LAST_ACTION_MSG = "The Black Box: FSInfo committed and cache flushed!";
                        render_desktop(fb);
                        return None;
                    }
                    // Touch Note (136, 182, 110, 22)
                    if rel_x >= 136 && rel_x <= 246 && rel_y >= 180 && rel_y <= 204 {
                        let _ = fat32::write_file("notes.txt", b"Created from Spatial Card Deck.\n", true);
                        LAST_ACTION_MSG = "Wrote /POSTCARD/notes.txt to internal drive.";
                        render_desktop(fb);
                        return None;
                    }
                }
                3 => {
                    // Card 3: VM Run Buttons
                    let mut btn_y = 50;
                    for slot in 0..4usize {
                        if rel_x >= 152 && rel_x <= 224 && rel_y >= btn_y && rel_y <= btn_y + 18 {
                            let (ret, cyc) = crate::execute_capsule_vmrun(slot);
                            let _ = (ret, cyc);
                            LAST_ACTION_MSG = "Micro-VM capsule VM-exit executed successfully.";
                            render_desktop(fb);
                            return None;
                        }
                        btn_y += 22;
                    }

                    // Fly Paper Airplane Button (bx, by: rel_x in 12..232, rel_y in 144..166)
                    if rel_x >= 12 && rel_x <= 232 && rel_y >= 144 && rel_y <= 166 {
                        let mut manifest = crate::handover::CapsuleCheckpointManifest {
                            capsule_id: 0,
                            name: [0; 20],
                            role_code: 0,
                            _pad: [0; 2],
                            vm_exits: 0,
                            last_cycles: 0,
                            last_result: 0,
                            mem_kib: 0,
                        };
                        let mut header = crate::handover::PaperAirplaneHeader {
                            magic: 0,
                            msg_type: 0,
                            source_slot: 0,
                            target_node: 0,
                            payload_len: 0,
                            sequence_num: 0,
                            crc32: 0,
                            _reserved: 0,
                        };
                        if let Ok(_payload) = crate::handover::HANDOVER_MGR.serialize_capsule_state(0, 0x5173, &mut manifest, &mut header) {
                            LAST_ACTION_MSG = "Paper Airplane: Capsule 0 checkpoint serialized in flight!";
                        }
                        render_desktop(fb);
                        return None;
                    }
                }
                4 => {
                    // Card 4: Patent Engine Buttons
                    // Cycle Mode Button: (rel_x in 12..142, rel_y in 108..132)
                    if rel_x >= 12 && rel_x <= 142 && rel_y >= 108 && rel_y <= 132 {
                        NVIDIA_MAXQ_ESTIMATOR.mode = match NVIDIA_MAXQ_ESTIMATOR.mode {
                            OptimizationMode::MaximizePerformance => OptimizationMode::MinimizePower,
                            OptimizationMode::MinimizePower => OptimizationMode::MaximizeEfficiency,
                            OptimizationMode::MaximizeEfficiency => OptimizationMode::MaximizePerformance,
                        };
                        LAST_ACTION_MSG = "Max-Q: Switched Optimization Mode!";
                        render_desktop(fb);
                        return None;
                    }
                    // Step Max-Q Button: (rel_x in 150..280, rel_y in 108..132)
                    if rel_x >= 150 && rel_x <= 280 && rel_y >= 108 && rel_y <= 132 {
                        let _ = NVIDIA_MAXQ_ESTIMATOR.step_optimization_cycle(false);
                        LAST_ACTION_MSG = "Max-Q: Stepped telemetry & recalculated optimal V-F point!";
                        render_desktop(fb);
                        return None;
                    }
                    // Publish SHM Button: (rel_x in 12..280, rel_y in 196..220)
                    if rel_x >= 12 && rel_x <= 280 && rel_y >= 196 && rel_y <= 220 {
                        let _ = VOYAGER_SHM_IPC.publish_message(1, b"SPATIAL_GUI_TELEMETRY_SAMPLE");
                        LAST_ACTION_MSG = "Voyager SHM: Published zero-copy telemetry packet!";
                        render_desktop(fb);
                        return None;
                    }
                }
                _ => {}
            }

            render_desktop(fb);
            return None;
        }
    }

    None
}

unsafe fn bring_to_front(card_idx: usize) {
    let mut found_pos = 0;
    for (pos, &id) in Z_ORDER.iter().enumerate() {
        if id == card_idx {
            found_pos = pos;
            break;
        }
    }
    for pos in found_pos..(NUM_CARDS - 1) {
        Z_ORDER[pos] = Z_ORDER[pos + 1];
    }
    Z_ORDER[NUM_CARDS - 1] = card_idx;
}

pub unsafe fn handle_drag(fb: &GopFramebufferInfo, m: &MouseState) {
    if let Some(card_idx) = ACTIVE_DRAG_CARD {
        if m.left {
            let card = &mut CARDS[card_idx];
            let new_x = (m.x - DRAG_OFFSET_X).clamp(0, (fb.width - (card.w as u32)) as i32);
            let new_y = (m.y - DRAG_OFFSET_Y).clamp(76, (fb.height - (card.h as u32) - 34) as i32);
            if card.x != new_x || card.y != new_y {
                card.x = new_x;
                card.y = new_y;
                render_desktop(fb);
            }
        } else {
            ACTIVE_DRAG_CARD = None;
        }
    }
}

// ----------------------------------------------------------------------------
// Simple integer formatting helper without heap allocation
// ----------------------------------------------------------------------------
fn format_num<'a>(mut val: u64, buf: &'a mut [u8; 32]) -> &'a str {
    if val == 0 {
        buf[0] = b'0';
        return core::str::from_utf8(&buf[..1]).unwrap_or("0");
    }
    let mut i = 32;
    while val > 0 && i > 0 {
        i -= 1;
        buf[i] = b'0' + (val % 10) as u8;
        val /= 10;
    }
    core::str::from_utf8(&buf[i..]).unwrap_or("")
}

// ----------------------------------------------------------------------------
// Full GUI Desktop Interactive Event Loop
// ----------------------------------------------------------------------------
/// Launches the full-screen spatial card deck compositor loop.
/// Exits when the user presses ESC, 'q', or clicks the [CONSOLE] button.
pub unsafe fn run_gui_desktop(fb: &GopFramebufferInfo) {
    render_desktop(fb);
    let mut m = mouse::state();
    cursor_draw(fb, m.x, m.y);

    loop {
        TICKS.fetch_add(1, Ordering::Relaxed);

        // 1. Check for keyboard input to toggle/exit GUI
        let maybe_char = crate::serial_try_getc().or_else(|| crate::ps2_try_getc());
        if let Some(ch) = maybe_char {
            match ch {
                0x1B | b'q' | b'Q' => {
                    // ESC or 'q' -> Exit back to shell
                    cursor_restore(fb);
                    return;
                }
                b'\t' => {
                    // TAB -> Cycle Z-order
                    let top = Z_ORDER[0];
                    for i in 0..(NUM_CARDS - 1) {
                        Z_ORDER[i] = Z_ORDER[i + 1];
                    }
                    Z_ORDER[NUM_CARDS - 1] = top;
                    render_desktop(fb);
                    cursor_draw(fb, m.x, m.y);
                }
                _ => {}
            }
        }

        // 2. Poll PS/2 auxiliary controller for mouse movement and button clicks
        let mut mouse_moved = false;
        while let Some(aux_byte) = mouse::poll_aux_status() {
            if mouse::feed_byte(aux_byte, fb.width, fb.height) {
                mouse_moved = true;
            }
        }

        m = mouse::state();

        if mouse_moved {
            if m.left_clicked {
                if let Some(action) = handle_click(fb, &m) {
                    if action == "EXIT_CONSOLE" {
                        cursor_restore(fb);
                        return;
                    }
                }
            } else if m.left {
                handle_drag(fb, &m);
            } else if m.left_released {
                ACTIVE_DRAG_CARD = None;
            }

            cursor_draw(fb, m.x, m.y);
        } else {
            for _ in 0..100 {
                core::hint::spin_loop();
            }
        }
    }
}
