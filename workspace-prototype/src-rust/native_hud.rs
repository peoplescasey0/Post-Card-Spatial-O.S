//! Native Immediate-Mode UI Integration using an embedded crate

use crate::framebuffer::{Color, Framebuffer};

/// Total heap arena capacity in KiB for the bare-metal Post Card micro-host kernel.
pub const KERNEL_HEAP_CAPACITY_KB: usize = 8192;

/// Renders the immediate-mode Mission Control HUD directly into the linear VRAM framebuffer
/// and returns a serialized JSON telemetry packet suitable for the host serial/WebSocket bridge.
pub fn render_native_hud(
    framebuffer: &mut Framebuffer,
    romy_active: bool,
    heap_usage_kb: usize,
) -> String {
    // The UI library handles the mouse raycasting and vertex generation automatically.
    // You just declare what widgets you want to see on screen this frame:

    let panel_title = "Post Card OS // Mission Control";

    // Draw outer Mission Control immediate-mode window container
    let panel_x = 16;
    let panel_y = 16;
    let panel_w = framebuffer.width.saturating_sub(32).min(420);
    let panel_h = framebuffer.height.saturating_sub(32).min(180);

    framebuffer.fill_rect(panel_x, panel_y, panel_w, panel_h, Color::PANEL_SURFACE);
    framebuffer.fill_rect(panel_x, panel_y, panel_w, 28, Color::PANEL_HEADER);
    framebuffer.stroke_rect(panel_x, panel_y, panel_w, panel_h, 2, Color::BORDER_SLATE);
    framebuffer.draw_text(panel_x + 12, panel_y + 10, panel_title, Color::CYAN_ACCENT);

    // In a real immediate-mode implementation, this draws directly to your VRAM
    // via the linear framebuffer driver we built:
    let romy_state = if romy_active {
        // Render status badge for PA-Romy Coprocessor Vault
        let badge_x = panel_x + 12;
        let badge_y = panel_y + 42;
        let badge_w = panel_w.saturating_sub(24);
        let badge_h = 34;

        framebuffer.fill_rect(badge_x, badge_y, badge_w, badge_h, Color::from_rgb(12, 46, 36));
        framebuffer.stroke_rect(badge_x, badge_y, badge_w, badge_h, 1, Color::EMERALD_ACTIVE);
        // Active LED indicator pip
        framebuffer.fill_rect(badge_x + 10, badge_y + 11, 12, 12, Color::EMERALD_ACTIVE);
        framebuffer.draw_text(
            badge_x + 30,
            badge_y + 13,
            "PA-ROMY COPROCESSOR VAULT: ACTIVE",
            Color::TEXT_PRIMARY,
        );
        "VAULT ACTIVE // ENCLAVE LOCKED"
    } else {
        let badge_x = panel_x + 12;
        let badge_y = panel_y + 42;
        let badge_w = panel_w.saturating_sub(24);
        let badge_h = 34;

        framebuffer.fill_rect(badge_x, badge_y, badge_w, badge_h, Color::OBSIDIAN_BG);
        framebuffer.stroke_rect(badge_x, badge_y, badge_w, badge_h, 1, Color::BORDER_SLATE);
        framebuffer.fill_rect(badge_x + 10, badge_y + 11, 12, 12, Color::AMBER_GOLD);
        framebuffer.draw_text(
            badge_x + 30,
            badge_y + 13,
            "PA-ROMY COPROCESSOR VAULT: STANDBY",
            Color::TEXT_MUTED,
        );
        "STANDBY // IDLE"
    };

    // Compute normalized heap pressure percentage (0..=100)
    let heap_pressure = ((heap_usage_kb.saturating_mul(100)) / KERNEL_HEAP_CAPACITY_KB).min(100);
    let meter_fill_color = if heap_pressure >= 85 {
        Color::DANGER_RED
    } else if heap_pressure >= 65 {
        Color::AMBER_GOLD
    } else {
        Color::CYAN_ACCENT
    };

    let meter_x = panel_x + 12;
    let meter_y = panel_y + 92;
    let meter_w = panel_w.saturating_sub(24);
    framebuffer.draw_text(
        meter_x,
        meter_y,
        &format!("HEAP ARENA: {} KB ({}%)", heap_usage_kb, heap_pressure),
        Color::TEXT_PRIMARY,
    );
    framebuffer.draw_meter_bar(
        meter_x,
        meter_y + 16,
        meter_w,
        22,
        heap_pressure,
        Color::OBSIDIAN_BG,
        meter_fill_color,
        Color::BORDER_SLATE,
    );

    format!(
        "{{\"panel_title\":\"{}\",\"romy_active\":{},\"romy_coprocessor_state\":\"{}\",\"heap_usage_kb\":{},\"heap_pressure\":{}}}",
        panel_title, romy_active, romy_state, heap_usage_kb, heap_pressure
    )
}
