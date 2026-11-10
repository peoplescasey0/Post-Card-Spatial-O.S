// ============================================================================
// POST CARD OS: NVIDIA OPTIMAL OPERATING POINT ESTIMATOR (MAX-Q DYNAMIC BOOST)
// Based on CN 111143174 B / US 16/179,620 (NVIDIA Corporation)
// "Optimal Operating Point Estimator for Hardware Operating Under Shared Power/Thermal Constraints"
// ============================================================================

#![allow(dead_code)]

/// Optimization modes for balancing performance and power under shared TDP
/// (CN 111143174 B, claims 12-15, FIG. 1, 106, FIG. 2E).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum OptimizationMode {
    MaximizePerformance = 0, // Maximize FPS / throughput without exceeding TDP limit
    MinimizePower = 1,       // Minimize power draw without dropping below target FPS
    MaximizeEfficiency = 2,  // Maximize performance while marginal efficiency dPerf/dPower >= threshold
}

pub fn opt_mode_str(m: OptimizationMode) -> &'static str {
    match m {
        OptimizationMode::MaximizePerformance => "MAX_PERFORMANCE (Bounded by Power Ceiling)",
        OptimizationMode::MinimizePower => "MIN_POWER (Bounded by Target Performance)",
        OptimizationMode::MaximizeEfficiency => "MAX_EFFICIENCY (Tangent dPerf/dPower Slope Threshold)",
    }
}

/// State machine for closed-loop operating point estimation (FIG. 2F, 150-158)
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum EstimatorState {
    ReadyIdle = 0,          // Ready/Idle 150
    AccumulateTelemetry = 1,// Accumulating frame counters and component power 152
    ReadRegisters = 2,      // Reading telemetry registers 154
    AiInference = 3,        // Running predictor model across candidate V-F operating points 156
    VfUpdate = 4,           // Applying optimal Voltage-Frequency updates to GPU & DRAM 158
}

pub fn state_str(s: EstimatorState) -> &'static str {
    match s {
        EstimatorState::ReadyIdle => "READY_IDLE (Waiting for workload epoch)",
        EstimatorState::AccumulateTelemetry => "ACCUMULATE_TELEMETRY (Sampling frame metrics)",
        EstimatorState::ReadRegisters => "READ_REGISTERS (Reading component telemetry)",
        EstimatorState::AiInference => "AI_INFERENCE (Evaluating candidate V-F states)",
        EstimatorState::VfUpdate => "VF_UPDATE (Applying optimal Voltage/Frequency to GPU & DRAM)",
    }
}

/// Voltage-Frequency operating point for GPU core and DRAM memory subsystem
/// (CN 111143174 B, [0050]-[0051], FIG. 2B-2C, 140).
#[derive(Clone, Copy, Debug)]
#[repr(C)]
pub struct VfOperatingPoint {
    pub gpu_freq_mhz: u32,
    pub gpu_voltage_mv: u32,
    pub dram_freq_mhz: u32,
    pub dram_voltage_mv: u32,
    pub predicted_fps: u32,
    pub predicted_total_power_w: u32,
}

impl VfOperatingPoint {
    pub const fn new(gpu_mhz: u32, gpu_mv: u32, dram_mhz: u32, dram_mv: u32) -> Self {
        Self {
            gpu_freq_mhz: gpu_mhz,
            gpu_voltage_mv: gpu_mv,
            dram_freq_mhz: dram_mhz,
            dram_voltage_mv: dram_mv,
            predicted_fps: 0,
            predicted_total_power_w: 0,
        }
    }
}

/// NVIDIA Shared Power & Thermal Budget Estimator (NVIDIA Max-Q Architecture)
pub struct NvidiaMaxQEstimator {
    pub state: EstimatorState,
    pub mode: OptimizationMode,
    pub shared_tdp_limit_w: u32,   // Total thermal design power (e.g. 80W)
    pub target_fps: u32,           // Performance target (e.g. 60 or 120 FPS)
    pub min_efficiency_slope: u32, // dPerf / dPower scaled by 100 (e.g. 150 = 1.5 FPS/W)

    // Current active hardware states
    pub current_point: VfOperatingPoint,
    pub frame_sample_count: u32,
    pub sample_window_size: u32,

    // Statistics & Telemetry
    pub total_vf_switches: u64,
    pub power_budget_violations_prevented: u64,
    pub clock_caps_applied_for_bottlenecks: u64,
}

impl NvidiaMaxQEstimator {
    pub const fn new() -> Self {
        Self {
            state: EstimatorState::ReadyIdle,
            mode: OptimizationMode::MaximizeEfficiency,
            shared_tdp_limit_w: 80,
            target_fps: 60,
            min_efficiency_slope: 100, // 1.0x slope threshold
            current_point: VfOperatingPoint::new(1500, 850, 7000, 1200),
            frame_sample_count: 0,
            sample_window_size: 16, // Sample over 16 frames
            total_vf_switches: 0,
            power_budget_violations_prevented: 0,
            clock_caps_applied_for_bottlenecks: 0,
        }
    }

    /// Evaluates candidate operating points using the AI predictor model (FIG. 2B-2E)
    pub fn predict_candidate(&self, gpu_mhz: u32, dram_mhz: u32, memory_bottleneck: bool) -> (u32, u32) {
        // Power model calibrated for Max-Q envelope (shared 80-115W system budget)
        let gpu_power = 10 + ((gpu_mhz as u64 * 20) / 1000) as u32;
        let dram_power = 5 + ((dram_mhz as u64 * 3) / 1000) as u32;
        let total_power = gpu_power + dram_power;

        // Performance model (FPS):
        let mut perf = (gpu_mhz / 25) + (dram_mhz / 250);
        if memory_bottleneck && gpu_mhz > 1400 {
            // Memory bound: high GPU core clocks yield diminishing returns
            perf = 45 + (dram_mhz / 200);
        }

        (perf, total_power)
    }

    /// Advances the state machine and recalculates the optimal V-F operating point (FIG. 2F)
    pub fn step_optimization_cycle(&mut self, is_memory_bound: bool) -> (VfOperatingPoint, &'static str) {
        self.state = EstimatorState::AccumulateTelemetry;
        self.frame_sample_count = self.sample_window_size;

        self.state = EstimatorState::ReadRegisters;
        self.state = EstimatorState::AiInference;

        // Candidate V-F table across dynamic frequency steps
        let candidate_configs = [
            (900, 750, 5000, 1100),
            (1200, 800, 6000, 1150),
            (1500, 850, 7000, 1200),
            (1800, 950, 7500, 1250),
            (2100, 1050, 8000, 1300),
        ];

        let mut best_point = self.current_point;
        let mut best_score: i64 = -1;
        let mut reason = "Default profile preserved";

        for &(g_mhz, g_mv, d_mhz, d_mv) in candidate_configs.iter() {
            let (fps, pwr) = self.predict_candidate(g_mhz, d_mhz, is_memory_bound);

            match self.mode {
                OptimizationMode::MaximizePerformance => {
                    // Maximize FPS while power <= TDP limit
                    if pwr <= self.shared_tdp_limit_w {
                        if (fps as i64) > best_score {
                            best_score = fps as i64;
                            best_point = VfOperatingPoint {
                                gpu_freq_mhz: g_mhz,
                                gpu_voltage_mv: g_mv,
                                dram_freq_mhz: d_mhz,
                                dram_voltage_mv: d_mv,
                                predicted_fps: fps,
                                predicted_total_power_w: pwr,
                            };
                            reason = "Optimal performance within TDP budget";
                        }
                    } else {
                        self.power_budget_violations_prevented = self.power_budget_violations_prevented.saturating_add(1);
                    }
                }
                OptimizationMode::MinimizePower => {
                    // Minimize power while FPS >= target
                    if fps >= self.target_fps {
                        let score = 1000 - pwr as i64;
                        if score > best_score {
                            best_score = score;
                            best_point = VfOperatingPoint {
                                gpu_freq_mhz: g_mhz,
                                gpu_voltage_mv: g_mv,
                                dram_freq_mhz: d_mhz,
                                dram_voltage_mv: d_mv,
                                predicted_fps: fps,
                                predicted_total_power_w: pwr,
                            };
                            reason = "Minimal power meeting target framerate";
                        }
                    }
                }
                OptimizationMode::MaximizeEfficiency => {
                    // Maximize efficiency dPerf/dPower slope (FIG. 2E)
                    let d_perf = fps.saturating_sub(30) as u64;
                    let d_pwr = pwr.saturating_sub(25).max(1) as u64;
                    let slope = (d_perf * 100) / d_pwr;

                    if pwr <= self.shared_tdp_limit_w && slope >= (self.min_efficiency_slope as u64) {
                        let score = (fps as i64 * 100) - (pwr as i64 * 50);
                        if score > best_score {
                            best_score = score;
                            best_point = VfOperatingPoint {
                                gpu_freq_mhz: g_mhz,
                                gpu_voltage_mv: g_mv,
                                dram_freq_mhz: d_mhz,
                                dram_voltage_mv: d_mv,
                                predicted_fps: fps,
                                predicted_total_power_w: pwr,
                            };
                            reason = "Optimal operating point on efficiency curve (dPerf/dPower tangent)";
                        }
                    }
                }
            }
        }

        // Cap GPU core clock if memory bottlenecked to prevent wasting power (patent paragraph [0038])
        if is_memory_bound && best_point.gpu_freq_mhz > 1500 {
            best_point.gpu_freq_mhz = 1500;
            best_point.gpu_voltage_mv = 850;
            self.clock_caps_applied_for_bottlenecks = self.clock_caps_applied_for_bottlenecks.saturating_add(1);
            reason = "GPU clock capped: memory bottleneck detected, power saved";
        }

        self.state = EstimatorState::VfUpdate;
        self.current_point = best_point;
        self.total_vf_switches = self.total_vf_switches.saturating_add(1);
        self.state = EstimatorState::ReadyIdle;

        (best_point, reason)
    }
}

pub static mut NVIDIA_MAXQ_ESTIMATOR: NvidiaMaxQEstimator = NvidiaMaxQEstimator::new();

/// Initializes the NVIDIA Max-Q Optimal Operating Point Estimator subsystem.
pub unsafe fn init_nvidia_maxq_subsystem() {
    let _ = NVIDIA_MAXQ_ESTIMATOR.step_optimization_cycle(false);
}
