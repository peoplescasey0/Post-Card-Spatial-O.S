// ============================================================================
// THE GLASS COCKPIT // PS/2 MOUSE & TRACKPAD DRIVER
// ============================================================================
// Drives the PS/2 auxiliary controller (8042 port 0x60/0x64) found on the
// Dell Latitude 3120 and standard QEMU PCs.
//
// Operates in non-blocking polled mode (synchronous with the main loop).
// Multiplexes with the PS/2 keyboard by inspecting 8042 status bit 5:
//   bit 5 == 1 -> data in port 0x60 is from the mouse/touchpad
//   bit 5 == 0 -> data in port 0x60 is from the keyboard

use crate::{inb, outb};

const PS2_DATA_PORT: u16 = 0x60;
const PS2_STATUS_PORT: u16 = 0x64;
const PS2_COMMAND_PORT: u16 = 0x64;

const STATUS_OUTPUT_FULL: u8 = 0x01;
const STATUS_INPUT_FULL: u8 = 0x02;
const STATUS_AUX_DATA: u8 = 0x20;

#[derive(Clone, Copy, Default)]
pub struct MouseState {
    pub x: i32,
    pub y: i32,
    pub left: bool,
    pub right: bool,
    pub middle: bool,
    pub left_clicked: bool,
    pub right_clicked: bool,
    pub left_released: bool,
}

static mut MOUSE_STATE: MouseState = MouseState {
    x: 512,
    y: 384,
    left: false,
    right: false,
    middle: false,
    left_clicked: false,
    right_clicked: false,
    left_released: false,
};

static mut PACKET_BUF: [u8; 3] = [0; 3];
static mut PACKET_IDX: usize = 0;
static mut MOUSE_INITIALIZED: bool = false;

unsafe fn wait_write() -> bool {
    for _ in 0..50_000 {
        if (inb(PS2_STATUS_PORT) & STATUS_INPUT_FULL) == 0 {
            return true;
        }
        core::hint::spin_loop();
    }
    false
}

unsafe fn wait_read() -> bool {
    for _ in 0..50_000 {
        if (inb(PS2_STATUS_PORT) & STATUS_OUTPUT_FULL) != 0 {
            return true;
        }
        core::hint::spin_loop();
    }
    false
}

unsafe fn send_mouse_cmd(cmd: u8) -> bool {
    if !wait_write() {
        return false;
    }
    outb(PS2_COMMAND_PORT, 0xD4); // Route next byte to auxiliary/mouse port
    if !wait_write() {
        return false;
    }
    outb(PS2_DATA_PORT, cmd);
    true
}

unsafe fn read_mouse_ack() -> Option<u8> {
    if wait_read() {
        Some(inb(PS2_DATA_PORT))
    } else {
        None
    }
}

/// Initializes the PS/2 Auxiliary device (trackpad/mouse) on the 8042 controller.
pub unsafe fn init(screen_w: u32, screen_h: u32) -> bool {
    MOUSE_STATE.x = (screen_w / 2) as i32;
    MOUSE_STATE.y = (screen_h / 2) as i32;

    // 1. Enable auxiliary device (Command 0xA8)
    if !wait_write() {
        return false;
    }
    outb(PS2_COMMAND_PORT, 0xA8);

    // 2. Read Controller Configuration Byte (Command 0x20)
    if !wait_write() {
        return false;
    }
    outb(PS2_COMMAND_PORT, 0x20);
    let mut cfg = match read_mouse_ack() {
        Some(b) => b,
        None => return false,
    };

    // Enable Aux interrupt flag (bit 1) and Aux clock (clear bit 5)
    cfg |= 0x02;
    cfg &= !0x20;

    // Write back configuration byte (Command 0x60)
    if !wait_write() {
        return false;
    }
    outb(PS2_COMMAND_PORT, 0x60);
    if !wait_write() {
        return false;
    }
    outb(PS2_DATA_PORT, cfg);

    // 3. Set default settings (0xF6)
    if send_mouse_cmd(0xF6) {
        let _ = read_mouse_ack();
    }

    // 4. Set sample rate to 100 Hz for responsive trackpad tracking
    if send_mouse_cmd(0xF3) {
        let _ = read_mouse_ack();
        if wait_write() {
            outb(PS2_COMMAND_PORT, 0xD4);
            if wait_write() {
                outb(PS2_DATA_PORT, 100);
                let _ = read_mouse_ack();
            }
        }
    }

    // 5. Enable data reporting / streaming mode (0xF4)
    if send_mouse_cmd(0xF4) {
        let _ = read_mouse_ack();
    }

    MOUSE_INITIALIZED = true;
    true
}

/// Checks if there is pending data on port 0x60 and whether it belongs to the mouse.
#[inline(always)]
pub unsafe fn poll_aux_status() -> Option<u8> {
    let status = inb(PS2_STATUS_PORT);
    if (status & STATUS_OUTPUT_FULL) != 0 && (status & STATUS_AUX_DATA) != 0 {
        Some(inb(PS2_DATA_PORT))
    } else {
        None
    }
}

/// Consumes incoming mouse bytes and updates the cursor coordinates and button state.
pub unsafe fn feed_byte(byte: u8, max_w: u32, max_h: u32) -> bool {
    MOUSE_STATE.left_clicked = false;
    MOUSE_STATE.right_clicked = false;
    MOUSE_STATE.left_released = false;

    if PACKET_IDX == 0 {
        // In standard PS/2 mouse packets, bit 3 of byte 0 must ALWAYS be 1.
        // If not 1, we are out of packet alignment; discard byte.
        if (byte & 0x08) == 0 {
            return false;
        }
        PACKET_BUF[0] = byte;
        PACKET_IDX = 1;
        return false;
    } else if PACKET_IDX == 1 {
        PACKET_BUF[1] = byte;
        PACKET_IDX = 2;
        return false;
    } else {
        PACKET_BUF[2] = byte;
        PACKET_IDX = 0;

        let b0 = PACKET_BUF[0];
        let b1 = PACKET_BUF[1];
        let b2 = PACKET_BUF[2];

        // Parse buttons
        let prev_left = MOUSE_STATE.left;
        let prev_right = MOUSE_STATE.right;

        let now_left = (b0 & 0x01) != 0;
        let now_right = (b0 & 0x02) != 0;
        let now_mid = (b0 & 0x04) != 0;

        if now_left && !prev_left {
            MOUSE_STATE.left_clicked = true;
        }
        if !now_left && prev_left {
            MOUSE_STATE.left_released = true;
        }
        if now_right && !prev_right {
            MOUSE_STATE.right_clicked = true;
        }

        MOUSE_STATE.left = now_left;
        MOUSE_STATE.right = now_right;
        MOUSE_STATE.middle = now_mid;

        // Parse 9-bit signed X and Y deltas (ignoring overflow packets for smooth motion)
        let x_overflow = (b0 & 0x40) != 0;
        let y_overflow = (b0 & 0x80) != 0;

        if !x_overflow && !y_overflow {
            let dx = if (b0 & 0x10) != 0 {
                (b1 as i32) | !0xFF
            } else {
                b1 as i32
            };

            // In PS/2, upward motion is positive Y, but on screen downward is positive Y.
            let dy = if (b0 & 0x20) != 0 {
                (b2 as i32) | !0xFF
            } else {
                b2 as i32
            };

            let new_x = MOUSE_STATE.x + dx;
            let new_y = MOUSE_STATE.y - dy;

            let bound_x = (max_w.saturating_sub(1)) as i32;
            let bound_y = (max_h.saturating_sub(1)) as i32;

            MOUSE_STATE.x = new_x.clamp(0, bound_x);
            MOUSE_STATE.y = new_y.clamp(0, bound_y);
        }

        return true;
    }
}

pub unsafe fn state() -> MouseState {
    MOUSE_STATE
}

pub unsafe fn is_initialized() -> bool {
    MOUSE_INITIALIZED
}
