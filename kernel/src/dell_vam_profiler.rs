// ============================================================================
// POST CARD OS: DELL ACCELERATOR TASK PROFILING & VIRTUAL ACCELERATOR MANAGER
// Based on US 2022/0043664 A1 (Dell Products L.P.)
// "Systems and Methods for Accelerator Task Profiling via Virtual Accelerator
//  Manager Based on Slot Speed"
// ============================================================================

#![allow(dead_code)]

/// Accelerator hardware category (US 2022/0043664 A1, [0043]).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum AcceleratorKind {
    GpuCompute = 0,     // Graphics Processing Unit (e.g. Tensor/Shader core)
    FpgaReconfig = 1,   // Field-Programmable Gate Array pipeline
    IoOffloadEngine = 2,// Cryptographic / Compression / Storage I/O accelerator
    DspArray = 3,       // Digital Signal Processor array
}

pub fn accelerator_kind_str(k: AcceleratorKind) -> &'static str {
    match k {
        AcceleratorKind::GpuCompute => "GPU_COMPUTE (Direct Rendering / Tensor Pipeline)",
        AcceleratorKind::FpgaReconfig => "FPGA_RECONFIG (Hardware Pipeline Synthesis)",
        AcceleratorKind::IoOffloadEngine => "IO_OFFLOAD (Hardware Crypto/Compression Engine)",
        AcceleratorKind::DspArray => "DSP_ARRAY (Real-Time Signal Processing)",
    }
}

/// Memory generation & technology on accelerator card (US 2022/0043664 A1, [0044]).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MemoryTechnology {
    Gddr5 = 0,
    Gddr6 = 1,
    Hbm2 = 2,
    Hbm3 = 3,
}

pub fn memory_tech_str(m: MemoryTechnology) -> &'static str {
    match m {
        MemoryTechnology::Gddr5 => "GDDR5",
        MemoryTechnology::Gddr6 => "GDDR6",
        MemoryTechnology::Hbm2 => "HBM2 (High-Bandwidth 3D Stack)",
        MemoryTechnology::Hbm3 => "HBM3 (Ultra-High-Bandwidth 3D Stack)",
    }
}

/// Physical PCIe slot speed & link width attributes (US 2022/0043664 A1, [0008], [0044]).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum PcieSlotSpeed {
    PcieGen3x4 = 0,  // ~3,940 MB/s
    PcieGen3x8 = 1,  // ~7,880 MB/s
    PcieGen4x8 = 2,  // ~15,750 MB/s
    PcieGen4x16 = 3, // ~31,500 MB/s
    PcieGen5x16 = 4, // ~63,000 MB/s
}

pub fn pcie_slot_speed_mbps(s: PcieSlotSpeed) -> u32 {
    match s {
        PcieSlotSpeed::PcieGen3x4 => 3940,
        PcieSlotSpeed::PcieGen3x8 => 7880,
        PcieSlotSpeed::PcieGen4x8 => 15750,
        PcieSlotSpeed::PcieGen4x16 => 31500,
        PcieSlotSpeed::PcieGen5x16 => 63000,
    }
}

pub fn pcie_slot_name(s: PcieSlotSpeed) -> &'static str {
    match s {
        PcieSlotSpeed::PcieGen3x4 => "PCIe Gen3 x4 (3.9 GB/s)",
        PcieSlotSpeed::PcieGen3x8 => "PCIe Gen3 x8 (7.9 GB/s)",
        PcieSlotSpeed::PcieGen4x8 => "PCIe Gen4 x8 (15.8 GB/s)",
        PcieSlotSpeed::PcieGen4x16 => "PCIe Gen4 x16 (31.5 GB/s)",
        PcieSlotSpeed::PcieGen5x16 => "PCIe Gen5 x16 (63.0 GB/s)",
    }
}

/// Static and dynamic profiling parameters for a physical accelerator device.
/// (US 2022/0043664 A1, [0044]-[0045], FIG. 2, 250-1, 250-2).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct AcceleratorDescriptor {
    pub device_id: u32,
    pub name: [u8; 16],
    pub kind: AcceleratorKind,
    pub slot_speed: PcieSlotSpeed,
    pub memory_tech: MemoryTechnology,
    pub memory_frequency_mhz: u32,
    pub internal_bus_width_bits: u32,
    pub total_memory_mb: u32,

    // Dynamic metrics
    pub free_memory_mb: u32,
    pub task_memory_affinity_pct: u8, // 1..100
    pub workload_busy_pct: u8,        // 1..100
    pub tasks_scheduled: u64,
    pub total_bytes_transferred: u64,
}

impl AcceleratorDescriptor {
    pub const fn empty() -> Self {
        Self {
            device_id: 0,
            name: [0; 16],
            kind: AcceleratorKind::GpuCompute,
            slot_speed: PcieSlotSpeed::PcieGen3x4,
            memory_tech: MemoryTechnology::Gddr5,
            memory_frequency_mhz: 0,
            internal_bus_width_bits: 0,
            total_memory_mb: 0,
            free_memory_mb: 0,
            task_memory_affinity_pct: 50,
            workload_busy_pct: 10,
            tasks_scheduled: 0,
            total_bytes_transferred: 0,
        }
    }

    /// Computes device internal memory bandwidth in Megabytes/sec:
    /// (frequency_mhz * bus_width_bits / 8)
    pub fn memory_bandwidth_mbs(&self) -> u32 {
        (self.memory_frequency_mhz.saturating_mul(self.internal_bus_width_bits)) / 8
    }

    /// Calculates the Performance Index (PI) according to US 2022/0043664 A1, [0044]:
    /// "calculated as a product of the bandwidth and the interface speed of the accelerator device,
    ///  divided by the product of available free memory, task memory affinity percentage, and available workload percentage"
    /// Scaled to prevent integer overflow and fractional truncation.
    pub fn calculate_performance_index(&self) -> u64 {
        let mem_bw = self.memory_bandwidth_mbs() as u64;
        let slot_bw = pcie_slot_speed_mbps(self.slot_speed) as u64;
        let numerator = mem_bw.saturating_mul(slot_bw);

        let free_mem = (self.free_memory_mb.max(1)) as u64;
        let affinity = (self.task_memory_affinity_pct.max(1)) as u64;
        let workload = (self.workload_busy_pct.max(1)) as u64;
        let denominator = (free_mem.saturating_mul(affinity).saturating_mul(workload)) / 1000;

        numerator / denominator.max(1)
    }

    pub fn name_str(&self) -> &str {
        core::str::from_utf8(&self.name).unwrap_or("unknown").trim_matches(char::from(0))
    }
}

/// Task profiling classification based on host-accelerator data transfer volume
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum TaskProfileClass {
    HighBandwidthIntensive = 0, // Massive host-to-device dataset transfer (prefers PCIe Gen5/Gen4 x16)
    MediumBalanced = 1,         // Moderate transfer & balanced compute
    ComputeBoundLowData = 2,    // Negligible host transfer, heavy on-chip ALUs (suited for lower slot speed)
}

pub fn profile_class_str(p: TaskProfileClass) -> &'static str {
    match p {
        TaskProfileClass::HighBandwidthIntensive => "HIGH_BANDWIDTH_INTENSIVE (Fast Slot Required)",
        TaskProfileClass::MediumBalanced => "MEDIUM_BALANCED (Balanced Slot Speed)",
        TaskProfileClass::ComputeBoundLowData => "COMPUTE_BOUND_LOW_DATA (Low Slot Speed OK)",
    }
}

/// Virtual Accelerator Manager (VAM 204) with Task Performance Enhancer (TPE 210)
/// (US 2022/0043664 A1, FIG. 1-2).
pub struct VirtualAcceleratorManager {
    pub accelerators: [AcceleratorDescriptor; 4],
    pub accelerator_count: usize,
    pub total_tasks_dispatched: u64,
    pub total_host_data_transferred_kb: u64,
    pub bottleneck_mitigations: u64,
}

impl VirtualAcceleratorManager {
    pub const fn new() -> Self {
        Self {
            accelerators: [
                // Accelerator #0: High-End Neural Graphics Accelerator (PCIe Gen5 x16, HBM3)
                AcceleratorDescriptor {
                    device_id: 0,
                    name: *b"dell-aero-hbm3\0\0",
                    kind: AcceleratorKind::GpuCompute,
                    slot_speed: PcieSlotSpeed::PcieGen5x16,
                    memory_tech: MemoryTechnology::Hbm3,
                    memory_frequency_mhz: 3200,
                    internal_bus_width_bits: 4096,
                    total_memory_mb: 65536,
                    free_memory_mb: 49152,
                    task_memory_affinity_pct: 85,
                    workload_busy_pct: 35,
                    tasks_scheduled: 0,
                    total_bytes_transferred: 0,
                },
                // Accelerator #1: Mid-Range Graphics & Ray-Tracing (PCIe Gen4 x16, GDDR6)
                AcceleratorDescriptor {
                    device_id: 1,
                    name: *b"dell-rtx-gddr6\0\0",
                    kind: AcceleratorKind::GpuCompute,
                    slot_speed: PcieSlotSpeed::PcieGen4x16,
                    memory_tech: MemoryTechnology::Gddr6,
                    memory_frequency_mhz: 1750,
                    internal_bus_width_bits: 256,
                    total_memory_mb: 16384,
                    free_memory_mb: 10240,
                    task_memory_affinity_pct: 60,
                    workload_busy_pct: 45,
                    tasks_scheduled: 0,
                    total_bytes_transferred: 0,
                },
                // Accelerator #2: FPGA Reconfigurable Pipeline (PCIe Gen4 x8, HBM2)
                AcceleratorDescriptor {
                    device_id: 2,
                    name: *b"dell-fpga-hbm2\0\0",
                    kind: AcceleratorKind::FpgaReconfig,
                    slot_speed: PcieSlotSpeed::PcieGen4x8,
                    memory_tech: MemoryTechnology::Hbm2,
                    memory_frequency_mhz: 1600,
                    internal_bus_width_bits: 2048,
                    total_memory_mb: 16384,
                    free_memory_mb: 12288,
                    task_memory_affinity_pct: 70,
                    workload_busy_pct: 20,
                    tasks_scheduled: 0,
                    total_bytes_transferred: 0,
                },
                // Accelerator #3: Crypto & I/O Offload Accelerator (PCIe Gen3 x4, GDDR5)
                AcceleratorDescriptor {
                    device_id: 3,
                    name: *b"dell-qcom-sec\0\0\0",
                    kind: AcceleratorKind::IoOffloadEngine,
                    slot_speed: PcieSlotSpeed::PcieGen3x4,
                    memory_tech: MemoryTechnology::Gddr5,
                    memory_frequency_mhz: 1500,
                    internal_bus_width_bits: 128,
                    total_memory_mb: 8192,
                    free_memory_mb: 6144,
                    task_memory_affinity_pct: 90,
                    workload_busy_pct: 15,
                    tasks_scheduled: 0,
                    total_bytes_transferred: 0,
                },
            ],
            accelerator_count: 4,
            total_tasks_dispatched: 0,
            total_host_data_transferred_kb: 0,
            bottleneck_mitigations: 0,
        }
    }

    /// Task Performance Enhancer (TPE 210) Profiles and Selects optimal accelerator based on:
    /// 1. Host-to-Device data transfer size
    /// 2. Device-to-Host result transfer size
    /// 3. Physical PCIe slot speed and performance index (US 2022/0043664 A1, [0044]-[0045]).
    pub fn profile_and_schedule_task(
        &mut self,
        task_id: u32,
        host_to_dev_bytes: usize,
        dev_to_host_bytes: usize,
    ) -> Result<(usize, TaskProfileClass, u64), &'static str> {
        if self.accelerator_count == 0 {
            return Err("vam_err: no physical accelerator devices registered");
        }

        let total_transfer_bytes = host_to_dev_bytes.saturating_add(dev_to_host_bytes);
        let profile_class = if total_transfer_bytes >= 32 * 1024 * 1024 {
            TaskProfileClass::HighBandwidthIntensive
        } else if total_transfer_bytes >= 2 * 1024 * 1024 {
            TaskProfileClass::MediumBalanced
        } else {
            TaskProfileClass::ComputeBoundLowData
        };

        // Select accelerator with matching slot speed capability
        let mut best_idx = 0usize;
        let mut best_score = 0u64;

        for i in 0..self.accelerator_count {
            let acc = &self.accelerators[i];
            let pi = acc.calculate_performance_index();
            let slot_bw = pcie_slot_speed_mbps(acc.slot_speed) as u64;

            // Compute selection fitness score
            let fitness = match profile_class {
                TaskProfileClass::HighBandwidthIntensive => slot_bw.saturating_mul(10).saturating_add(pi / 100),
                TaskProfileClass::MediumBalanced => pi.saturating_add(slot_bw),
                TaskProfileClass::ComputeBoundLowData => {
                    // Save high-bandwidth slots for heavy tasks; prefer lower bandwidth slots if available
                    let penalty = slot_bw / 2;
                    pi.saturating_sub(penalty)
                }
            };

            if fitness > best_score {
                best_score = fitness;
                best_idx = i;
            }
        }

        // Account for bottleneck prevention if a heavy task avoided a Gen3x4 slot
        if profile_class == TaskProfileClass::HighBandwidthIntensive && best_idx <= 1 {
            self.bottleneck_mitigations = self.bottleneck_mitigations.saturating_add(1);
        }

        let chosen = &mut self.accelerators[best_idx];
        chosen.tasks_scheduled = chosen.tasks_scheduled.saturating_add(1);
        chosen.total_bytes_transferred = chosen.total_bytes_transferred.saturating_add(total_transfer_bytes as u64);

        self.total_tasks_dispatched = self.total_tasks_dispatched.saturating_add(1);
        self.total_host_data_transferred_kb = self.total_host_data_transferred_kb
            .saturating_add((total_transfer_bytes as u64) / 1024);

        let chosen_pi = chosen.calculate_performance_index();
        let _ = task_id;
        Ok((best_idx, profile_class, chosen_pi))
    }
}

pub static mut VIRTUAL_ACCELERATOR_MGR: VirtualAcceleratorManager = VirtualAcceleratorManager::new();

/// Initializes the Dell Virtual Accelerator Manager subsystem.
pub unsafe fn init_dell_vam_subsystem() {
    // Perform initial task profiling simulation
    let _ = VIRTUAL_ACCELERATOR_MGR.profile_and_schedule_task(1, 64 * 1024 * 1024, 4 * 1024 * 1024);
}
