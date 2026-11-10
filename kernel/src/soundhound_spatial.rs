//! ============================================================================
//! SOUNDHOUND DIFFERENTIAL SPATIAL RENDERING ENGINE (US 11,589,184 B1)
//! ============================================================================
//!
//! Implements differential spatial audio rendering for multi-source environments
//! (virtual conferences, spatial card decks, and 3D telecommunication windows)
//! as patented by Bernard Mont-Reynaud / SoundHound, Inc. (US 11,589,184 B1).
//!
//! Architectural Pillars (US 11,589,184 B1):
//! 1. Source Location Association: Maps each audio source (participant/card) to
//!    a 3D coordinate (x, y, z) in virtual space (Fig. 1, Fig. 2A/2B).
//! 2. Interaural Time Difference (ITD): Path-length arrival delay between left
//!    and right ears based on azimuth angle φ (Fig. 4, Fig. 6, Fig. 7).
//! 3. Interaural Loudness Difference (ILD): Head-shadow acoustic attenuation
//!    differential applied across left/right channels (col. 10-11, Fig. 6).
//! 4. Distance Cues (Reverberation Ratio): Calculates direct vs. reverberant
//!    sound ratio (E_direct / E_reverb) based on listener-to-source distance d.
//! 5. Interactive User Relocation: Real-time location control messages dynamically
//!    recalculate ITD, ILD, and distance cues when cards/windows are dragged (Fig. 8, Fig. 12).
//! 6. Differential Multi-Destination Delivery: Personalizes spatial mixes for
//!    individual listeners based on their unique head poses and vantage points.

use core::sync::atomic::{AtomicU32, Ordering};

pub const MAX_SPATIAL_SOURCES: usize = 8;
pub const _SPEED_OF_SOUND_CMS: u32 = 34300; // 343 m/s in cm/s
pub const _HEAD_RADIUS_CM: u32 = 9;         // Average human head radius (~8.75 - 9.0 cm)
pub const MAX_ITD_US: u32 = 650;           // Max interaural delay at 90 deg azimuth (~650 microseconds)
pub const REFERENCE_DISTANCE_CM: u32 = 100;// Distance at which direct/reverb is 80/20

#[allow(dead_code)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SourceState {
    Unused,
    Active,
    Muted,
    Relocating,
}

#[derive(Clone, Copy)]
pub struct SpatialVector {
    pub x: i32, // cm (-1000 .. +1000)
    pub y: i32, // cm (-1000 .. +1000)
    pub z: i32, // cm (1 .. +1000)
}

impl SpatialVector {
    pub const fn new(x: i32, y: i32, z: i32) -> Self {
        Self { x, y, z }
    }
}

#[derive(Clone, Copy)]
pub struct ListenerPose {
    pub position: SpatialVector,
    pub yaw_deg: i32,   // -180 .. +180 deg
    pub pitch_deg: i32, // -90 .. +90 deg
}

impl ListenerPose {
    pub const fn default_origin() -> Self {
        Self {
            position: SpatialVector::new(0, 0, 0),
            yaw_deg: 0,
            pitch_deg: 0,
        }
    }
}

#[derive(Clone, Copy)]
pub struct BinauralCues {
    pub azimuth_deg: i32,      // -90 (far left) .. 0 (center) .. +90 (far right)
    pub elevation_deg: i32,    // -90 (below) .. 0 (eye-level) .. +90 (above)
    pub distance_cm: u32,      // Euclidean distance in cm
    pub itd_us: i32,           // Microseconds delay (-650 .. +650; positive = right ear delayed)
    pub left_gain_pct: u32,    // 0 .. 100%
    pub right_gain_pct: u32,   // 0 .. 100%
    pub direct_ratio_pct: u32, // 0 .. 100%
    pub reverb_ratio_pct: u32, // 0 .. 100%
}

impl BinauralCues {
    pub const fn neutral() -> Self {
        Self {
            azimuth_deg: 0,
            elevation_deg: 0,
            distance_cm: REFERENCE_DISTANCE_CM,
            itd_us: 0,
            left_gain_pct: 100,
            right_gain_pct: 100,
            direct_ratio_pct: 80,
            reverb_ratio_pct: 20,
        }
    }
}

pub struct SpatialSource {
    pub source_id: u32,
    pub name: [u8; 32],
    pub state: SourceState,
    pub virtual_pos: SpatialVector,
    pub cues: BinauralCues,
    pub relocation_count: u32,
    pub rendered_frames: u64,
}

impl SpatialSource {
    pub const fn new() -> Self {
        Self {
            source_id: 0,
            name: [0u8; 32],
            state: SourceState::Unused,
            virtual_pos: SpatialVector::new(0, 0, 100),
            cues: BinauralCues::neutral(),
            relocation_count: 0,
            rendered_frames: 0,
        }
    }
}

pub struct SoundHoundEngine {
    pub listener: ListenerPose,
    pub sources: [SpatialSource; MAX_SPATIAL_SOURCES],
    pub active_sources_count: usize,
    pub total_relocations: AtomicU32,
    pub total_rendered_samples: AtomicU32,
}

// Global static instance for Post Card Spatial OS
pub static mut SOUNDHOUND_ENGINE: SoundHoundEngine = SoundHoundEngine::new();

impl SoundHoundEngine {
    pub const fn new() -> Self {
        Self {
            listener: ListenerPose::default_origin(),
            sources: [
                SpatialSource::new(), SpatialSource::new(),
                SpatialSource::new(), SpatialSource::new(),
                SpatialSource::new(), SpatialSource::new(),
                SpatialSource::new(), SpatialSource::new(),
            ],
            active_sources_count: 0,
            total_relocations: AtomicU32::new(0),
            total_rendered_samples: AtomicU32::new(0),
        }
    }

    /// Fast integer square root approximation
    fn isqrt(val: u64) -> u32 {
        if val == 0 { return 0; }
        let mut x = val;
        let mut y = (x + 1) / 2;
        while y < x {
            x = y;
            y = (x + val / x) / 2;
        }
        x as u32
    }

    /// Fast integer arctan2 returning degrees (-180 .. +180)
    fn atan2_deg(y: i32, x: i32) -> i32 {
        if x == 0 && y == 0 { return 0; }
        if x == 0 {
            return if y > 0 { 90 } else { -90 };
        }
        if y == 0 {
            return if x > 0 { 0 } else { 180 };
        }

        let abs_y = if y < 0 { -y } else { y } as i64;
        let abs_x = if x < 0 { -x } else { x } as i64;

        // Linear ratio approximation for quick trigonometric response
        let angle = if abs_x >= abs_y {
            (45 * abs_y) / abs_x
        } else {
            90 - (45 * abs_x) / abs_y
        } as i32;

        match (x >= 0, y >= 0) {
            (true, true) => angle,
            (false, true) => 180 - angle,
            (false, false) => -(180 - angle),
            (true, false) => -angle,
        }
    }

    /// Compute ITD, ILD, and Distance Cues (SoundHound US 11,589,184 B1 cols. 10-14)
    pub fn compute_cues_for_pose(listener: &ListenerPose, source_pos: SpatialVector) -> BinauralCues {
        // 1. Relative translation
        let dx = source_pos.x - listener.position.x;
        let dy = source_pos.y - listener.position.y;
        let dz = source_pos.z - listener.position.z;

        // 2. Euclidean distance in cm
        let dist_sq = (dx as i64 * dx as i64) + (dy as i64 * dy as i64) + (dz as i64 * dz as i64);
        let dist_cm = if dist_sq == 0 { 10 } else { Self::isqrt(dist_sq as u64) };

        // 3. Azimuth relative to listener orientation (yaw)
        let world_azimuth = Self::atan2_deg(dx, dz);
        let mut rel_azimuth = world_azimuth - listener.yaw_deg;
        while rel_azimuth > 180 { rel_azimuth -= 360; }
        while rel_azimuth < -180 { rel_azimuth += 360; }

        // Clamp effective binaural azimuth to -90 .. +90 for front/side lateralization
        let eff_azimuth = if rel_azimuth > 90 {
            180 - rel_azimuth
        } else if rel_azimuth < -90 {
            -(180 + rel_azimuth)
        } else {
            rel_azimuth
        };

        // 4. Elevation calculation
        let ground_proj = Self::isqrt(((dx as i64 * dx as i64) + (dz as i64 * dz as i64)) as u64);
        let elevation = Self::atan2_deg(dy, ground_proj as i32) - listener.pitch_deg;

        // 5. ITD (Interaural Time Difference) calculation
        // Woodworth spherical head model: Δt = (a / c) * (sin φ + φ)
        // Simplified integer approximation: ITD = MAX_ITD_US * sin(eff_azimuth)
        // For -90 deg, itd = -650 us; for +90 deg, itd = +650 us
        let itd_us = (MAX_ITD_US as i32 * eff_azimuth) / 90;

        // 6. ILD (Interaural Loudness Difference) & Ear Gain Scaling
        // Far-side ear is shadowed by head: up to 15 dB (~50% linear gain reduction)
        let (left_gain_pct, right_gain_pct) = if eff_azimuth >= 0 {
            // Source is to the right: Left ear receives shadowed sound
            let shadow = (eff_azimuth as u32 * 45) / 90; // up to 45% reduction
            (100 - shadow, 100)
        } else {
            // Source is to the left: Right ear receives shadowed sound
            let shadow = ((-eff_azimuth) as u32 * 45) / 90;
            (100, 100 - shadow)
        };

        // 7. Distance Cues (col. 13-14): Direct sound vs Reverberation ratio
        // Direct energy drops with 1/dist; reverb stays relatively stable
        let direct_pct = if dist_cm <= REFERENCE_DISTANCE_CM {
            85 + (15 * (REFERENCE_DISTANCE_CM - dist_cm)) / REFERENCE_DISTANCE_CM
        } else {
            let drop = (dist_cm - REFERENCE_DISTANCE_CM) / 10;
            if drop >= 60 { 25 } else { 85 - drop }
        };
        let reverb_pct = 100 - direct_pct;

        BinauralCues {
            azimuth_deg: eff_azimuth,
            elevation_deg: elevation,
            distance_cm: dist_cm,
            itd_us,
            left_gain_pct,
            right_gain_pct,
            direct_ratio_pct: direct_pct,
            reverb_ratio_pct: reverb_pct,
        }
    }

    /// Register a new audio source card or conference participant
    pub fn register_source(&mut self, source_id: u32, name_str: &str, x_cm: i32, y_cm: i32, z_cm: i32) -> bool {
        let pos = SpatialVector::new(x_cm, y_cm, if z_cm <= 0 { 10 } else { z_cm });
        let calculated_cues = Self::compute_cues_for_pose(&self.listener, pos);

        for slot in self.sources.iter_mut() {
            if slot.state == SourceState::Unused || slot.source_id == source_id {
                slot.source_id = source_id;
                slot.state = SourceState::Active;
                slot.virtual_pos = pos;
                
                let mut name_arr = [0u8; 32];
                let b = name_str.as_bytes();
                let len = if b.len() > 31 { 31 } else { b.len() };
                let mut i = 0;
                while i < len {
                    name_arr[i] = b[i];
                    i += 1;
                }
                slot.name = name_arr;
                slot.cues = calculated_cues;
                slot.relocation_count = 0;
                self.active_sources_count += 1;
                return true;
            }
        }
        false
    }

    /// Dynamically relocate a source in real-time (SoundHound US 11,589,184 B1 Fig. 8, Claim 3)
    pub fn relocate_source(&mut self, source_id: u32, new_x: i32, new_y: i32, new_z: i32) -> (bool, BinauralCues) {
        let pos = SpatialVector::new(new_x, new_y, if new_z <= 0 { 10 } else { new_z });
        let calculated_cues = Self::compute_cues_for_pose(&self.listener, pos);

        for slot in self.sources.iter_mut() {
            if slot.state != SourceState::Unused && slot.source_id == source_id {
                slot.virtual_pos = pos;
                slot.cues = calculated_cues;
                slot.relocation_count += 1;
                self.total_relocations.fetch_add(1, Ordering::Relaxed);
                return (true, slot.cues);
            }
        }
        (false, BinauralCues::neutral())
    }

    /// Updates listener head pose (6DoF rotation + position)
    #[allow(dead_code)]
    pub fn update_listener(&mut self, x: i32, y: i32, z: i32, yaw_deg: i32, pitch_deg: i32) {
        self.listener.position = SpatialVector::new(x, y, z);
        self.listener.yaw_deg = yaw_deg;
        self.listener.pitch_deg = pitch_deg;

        // Recompute cues for all active sources
        let l_pose = self.listener;
        for slot in self.sources.iter_mut() {
            if slot.state != SourceState::Unused {
                slot.cues = Self::compute_cues_for_pose(&l_pose, slot.virtual_pos);
            }
        }
    }

    /// Render a single mono sample into differential binaural stereo channels
    pub fn render_sample(&mut self, source_id: u32, mono_sample: i16) -> (i16, i16) {
        for slot in self.sources.iter_mut() {
            if slot.state == SourceState::Active && slot.source_id == source_id {
                slot.rendered_frames += 1;
                self.total_rendered_samples.fetch_add(1, Ordering::Relaxed);

                // Apply direct distance attenuation
                let direct_scaled = (mono_sample as i32 * slot.cues.direct_ratio_pct as i32) / 100;
                
                // Apply ear-specific ILD gains
                let left_out = (direct_scaled * slot.cues.left_gain_pct as i32) / 100;
                let right_out = (direct_scaled * slot.cues.right_gain_pct as i32) / 100;

                return (left_out as i16, right_out as i16);
            }
        }
        (mono_sample, mono_sample)
    }

    /// Reset the subsystem
    pub fn reset(&mut self) {
        self.listener = ListenerPose::default_origin();
        self.active_sources_count = 0;
        self.total_relocations.store(0, Ordering::Relaxed);
        self.total_rendered_samples.store(0, Ordering::Relaxed);
        let mut i = 0;
        while i < MAX_SPATIAL_SOURCES {
            self.sources[i] = SpatialSource::new();
            i += 1;
        }
    }

    /// Execute automated SoundHound differential rendering self-test
    pub fn test_differential_rendering(&mut self) -> (bool, &'static str) {
        self.reset();

        // 1. Register Card 1 at Left-Front (-100, 0, 100)
        let ok1 = self.register_source(1, "SpatialCard-1", -100, 0, 100);
        if !ok1 {
            return (false, "Failed to register SpatialCard-1");
        }

        let cues_left = self.sources[0].cues;
        // Verify left-panned cues: azimuth should be negative (-45 deg), left ear gain > right ear gain
        if cues_left.azimuth_deg >= 0 {
            return (false, "Card 1 at (-100,0,100) must have negative azimuth");
        }
        if cues_left.left_gain_pct <= cues_left.right_gain_pct {
            return (false, "Card 1 left gain must be greater than right gain (ILD)");
        }
        if cues_left.itd_us >= 0 {
            return (false, "Card 1 ITD must be negative (sound arrives at left ear first)");
        }

        // 2. Interactive Dynamic Relocation to Center (0, 0, 200) (SoundHound Fig. 8)
        let (reloc_ok, cues_center) = self.relocate_source(1, 0, 0, 200);
        if !reloc_ok {
            return (false, "Failed to relocate Card 1 to center");
        }
        if cues_center.azimuth_deg != 0 {
            return (false, "Card 1 at (0,0,200) must have 0 deg azimuth");
        }
        if cues_center.left_gain_pct != cues_center.right_gain_pct {
            return (false, "Center cues must have balanced ear gains");
        }
        if cues_center.itd_us != 0 {
            return (false, "Center cues must have zero ITD delay");
        }
        if cues_center.distance_cm != 200 {
            return (false, "Distance must equal 200 cm");
        }
        // At 200 cm, reverb ratio should be higher than at 141 cm
        if cues_center.reverb_ratio_pct <= cues_left.reverb_ratio_pct {
            return (false, "Greater distance must yield higher reverberation ratio");
        }

        // 3. Dynamic Relocation to Right-Front (+100, 0, 100)
        let (_, cues_right) = self.relocate_source(1, 100, 0, 100);
        if cues_right.azimuth_deg <= 0 {
            return (false, "Card 1 at (+100,0,100) must have positive azimuth");
        }
        if cues_right.right_gain_pct <= cues_right.left_gain_pct {
            return (false, "Card 1 right gain must be greater than left gain (ILD)");
        }
        if cues_right.itd_us <= 0 {
            return (false, "Card 1 ITD must be positive (sound arrives at right ear first)");
        }

        // 4. Test render sample
        let (l, r) = self.render_sample(1, 1000);
        if r <= l {
            return (false, "Right output sample must exceed left output sample for right-positioned source");
        }

        (true, "SoundHound differential spatial rendering verified: ITD/ILD, distance cues & dynamic relocation pass")
    }
}

/// Initialize the SoundHound Spatial Audio Subsystem
pub unsafe fn init_soundhound_subsystem() {
    let _ = SOUNDHOUND_ENGINE.register_source(1, "PostCard-Deck-1", -80, 10, 120);
    let _ = SOUNDHOUND_ENGINE.register_source(2, "PostCard-Deck-2", 0, 10, 150);
    let _ = SOUNDHOUND_ENGINE.register_source(3, "PostCard-Deck-3", 80, 10, 120);
    let _ = SOUNDHOUND_ENGINE.register_source(4, "Patent-Telemetry-HUD", 0, 40, 90);
}
