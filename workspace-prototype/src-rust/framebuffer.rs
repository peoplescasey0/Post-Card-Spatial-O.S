//! Linear Framebuffer Driver & Immediate-Mode 2D Drawing Primitives
//! Designed for bare-metal `no_std` x86_64 execution on Post Card Spatial OS.

/// 32-bit ARGB color pixel (`0xAARRGGBB`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(transparent)]
pub struct Color(pub u32);

impl Color {
    pub const TRANSPARENT: Self = Self(0x0000_0000);
    pub const OBSIDIAN_BG: Self = Self(0xFF0A_1020);
    pub const PANEL_SURFACE: Self = Self(0xFF14_1C30);
    pub const PANEL_HEADER: Self = Self(0xFF1A_2642);
    pub const BORDER_SLATE: Self = Self(0xFF2A_3855);
    pub const CYAN_ACCENT: Self = Self(0xFF79_DED8);
    pub const AMBER_GOLD: Self = Self(0xFFFF_B81C);
    pub const EMERALD_ACTIVE: Self = Self(0xFF22_C55E);
    pub const DANGER_RED: Self = Self(0xFFEF_4444);
    pub const TEXT_PRIMARY: Self = Self(0xFFF4_F5F7);
    pub const TEXT_MUTED: Self = Self(0xFF8A_909E);

    #[inline]
    pub const fn from_rgb(r: u8, g: u8, b: u8) -> Self {
        Self(0xFF00_0000 | ((r as u32) << 16) | ((g as u32) << 8) | (b as u32))
    }
}

/// Linear VRAM Framebuffer representation for immediate-mode kernel HUD rendering.
pub struct Framebuffer<'a> {
    pub width: usize,
    pub height: usize,
    pub stride: usize,
    pub buffer: &'a mut [u32],
}

impl<'a> Framebuffer<'a> {
    /// Creates a new linear framebuffer wrapper around a mutable 32-bit pixel slice.
    pub fn new(width: usize, height: usize, stride: usize, buffer: &'a mut [u32]) -> Self {
        Self {
            width,
            height,
            stride,
            buffer,
        }
    }

    /// Writes a single pixel at `(x, y)` with bounds checking.
    #[inline]
    pub fn put_pixel(&mut self, x: usize, y: usize, color: Color) {
        if x < self.width && y < self.height {
            let idx = y * self.stride + x;
            if idx < self.buffer.len() {
                self.buffer[idx] = color.0;
            }
        }
    }

    /// Reads a pixel at `(x, y)`.
    #[inline]
    pub fn get_pixel(&self, x: usize, y: usize) -> Option<Color> {
        if x < self.width && y < self.height {
            let idx = y * self.stride + x;
            self.buffer.get(idx).copied().map(Color)
        } else {
            None
        }
    }

    /// Fills a solid rectangle clipped to the framebuffer dimensions.
    pub fn fill_rect(&mut self, x: usize, y: usize, w: usize, h: usize, color: Color) {
        let x_end = (x + w).min(self.width);
        let y_end = (y + h).min(self.height);
        if x >= x_end || y >= y_end {
            return;
        }
        for row in y..y_end {
            let row_start = row * self.stride + x;
            let row_end = (row * self.stride + x_end).min(self.buffer.len());
            if row_start < row_end {
                self.buffer[row_start..row_end].fill(color.0);
            }
        }
    }

    /// Draws a 1px or multi-pixel rectangular border.
    pub fn stroke_rect(
        &mut self,
        x: usize,
        y: usize,
        w: usize,
        h: usize,
        thickness: usize,
        color: Color,
    ) {
        if w == 0 || h == 0 || thickness == 0 {
            return;
        }
        let t = thickness.min(w / 2).min(h / 2).max(1);
        // Top and bottom edges
        self.fill_rect(x, y, w, t, color);
        self.fill_rect(x, y + h.saturating_sub(t), w, t, color);
        // Left and right edges
        self.fill_rect(x, y, t, h, color);
        self.fill_rect(x + w.saturating_sub(t), y, t, h, color);
    }

    /// Draws a horizontal progress/pressure meter bar with border, track, and fill.
    pub fn draw_meter_bar(
        &mut self,
        x: usize,
        y: usize,
        w: usize,
        h: usize,
        fill_percent: usize,
        track_color: Color,
        fill_color: Color,
        border_color: Color,
    ) {
        self.fill_rect(x, y, w, h, track_color);
        let clamped_pct = fill_percent.min(100);
        let inner_w = w.saturating_sub(4);
        let inner_h = h.saturating_sub(4);
        let filled_w = (inner_w * clamped_pct) / 100;
        if filled_w > 0 && inner_h > 0 {
            self.fill_rect(x + 2, y + 2, filled_w, inner_h, fill_color);
        }
        self.stroke_rect(x, y, w, h, 1, border_color);
    }

    /// Renders an 8x8 compact bitmap glyph block for each ASCII character in `text`.
    /// Uses a procedural deterministic glyph pattern suitable for `no_std` immediate-mode HUDs.
    pub fn draw_text(&mut self, x: usize, y: usize, text: &str, color: Color) {
        let mut cursor_x = x;
        for byte in text.bytes() {
            if byte == b'\n' {
                break;
            }
            if byte != b' ' {
                self.draw_glyph_8x8(cursor_x, y, byte, color);
            }
            cursor_x += 8;
            if cursor_x >= self.width {
                break;
            }
        }
    }

    fn draw_glyph_8x8(&mut self, x: usize, y: usize, ascii: u8, color: Color) {
        for row in 0..7usize {
            let pattern = glyph_row_bitmap(ascii, row);
            for col in 0..6usize {
                if (pattern >> (5 - col)) & 1 == 1 {
                    self.put_pixel(x + col, y + row, color);
                }
            }
        }
    }
}

/// Compact 6x7 bitmap row generator for core HUD ASCII glyphs.
const fn glyph_row_bitmap(ascii: u8, row: usize) -> u8 {
    match (ascii.to_ascii_uppercase(), row) {
        (b'P', 0) | (b'P', 3) => 0b111100,
        (b'P', 1) | (b'P', 2) => 0b100010,
        (b'P', 4) | (b'P', 5) | (b'P', 6) => 0b100000,
        (b'O', 0) | (b'O', 6) => 0b011100,
        (b'O', _) => 0b100010,
        (b'S', 0) | (b'S', 3) | (b'S', 6) => 0b011110,
        (b'S', 1) | (b'S', 2) => 0b100000,
        (b'S', 4) | (b'S', 5) => 0b000010,
        (b'T', 0) => 0b111110,
        (b'T', _) => 0b001000,
        (b'C', 0) | (b'C', 6) => 0b011110,
        (b'C', _) => 0b100000,
        (b'A', 0) => 0b011100,
        (b'A', 3) => 0b111110,
        (b'A', _) => 0b100010,
        (b'R', 0) | (b'R', 3) => 0b111100,
        (b'R', 1) | (b'R', 2) | (b'R', 5) | (b'R', 6) => 0b100010,
        (b'R', 4) => 0b101000,
        (b'D', 0) | (b'D', 6) => 0b111100,
        (b'D', _) => 0b100010,
        (b'M', 0) | (b'M', 1) => 0b110110,
        (b'M', 2) => 0b101010,
        (b'M', _) => 0b100010,
        (b'I', 0) | (b'I', 6) => 0b111110,
        (b'I', _) => 0b001000,
        (b'N', _) => 0b100110,
        (b'L', 6) => 0b111110,
        (b'L', _) => 0b100000,
        (b'V', 5) | (b'V', 6) => 0b011100,
        (b'V', _) => 0b100010,
        (b'U', 6) => 0b011100,
        (b'U', _) => 0b100010,
        (b'E', 0) | (b'E', 3) | (b'E', 6) => 0b111110,
        (b'E', _) => 0b100000,
        (b'H', 3) => 0b111110,
        (b'H', _) => 0b100010,
        (b'K', 3) => 0b111000,
        (b'K', _) => 0b100100,
        (b'B', 0) | (b'B', 3) | (b'B', 6) => 0b111100,
        (b'B', _) => 0b100010,
        (b'/', r) => 1 << (r % 6),
        (b'-', 3) => 0b011110,
        (b':', 2) | (b':', 4) => 0b001000,
        (b'%', r) => (1 << (r % 6)) | 0b100001,
        (c, _) if c.is_ascii_digit() => 0b101101 ^ ((row as u8) & 0b010101),
        _ => 0b110110,
    }
}
