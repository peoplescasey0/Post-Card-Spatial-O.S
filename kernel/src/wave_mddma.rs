//! # Wave Computing 5-D Multidimensional DMA Engine (US 10,997,102 B2)
//!
// Multidimensional Address Generation for Direct Memory Access (MD-DMA).
// Implements a 256-bit Work Request Descriptor (69-bit common descriptor + 5D tensor strides/offsets),
// 4KB burst alignment optimization, and a reconfigurable Processing Element (PE) Quad Cluster (q0..q3)
// with circular instruction buffers and data-driven sleep/wake states.

#![allow(dead_code)]

pub const MAX_TENSOR_DIMS: usize = 5;
pub const MAX_CIRCULAR_BUFFER_INSTRS: usize = 8;

/// 256-bit Work Request Tensor Address Descriptor (FIG. 2)
#[derive(Copy, Clone, Debug)]
pub struct TensorWorkDescriptor {
    // Common Address Space Descriptor (69 bits)
    pub base_address: u64,       // 64 bits
    pub num_dimensions: u8,      // 2 bits (supports 2D..5D)
    pub element_size_shift: u8,  // 3 bits (1 << element_size_shift = byte size: 1, 2, 4, 8)

    // Dimension-0 Descriptor (35 bits)
    pub dim0_stride: u32,        // 16 bits
    pub dim0_count: u32,         // 19 bits

    // Dimensions 1..4 Descriptors (38 bits each: 19-bit offset, 19-bit count)
    pub offsets: [u32; 4],
    pub counts: [u32; 4],
}

impl TensorWorkDescriptor {
    pub const fn empty() -> Self {
        Self {
            base_address: 0,
            num_dimensions: 2,
            element_size_shift: 2, // 4-byte default (e.g. float/u32)
            dim0_stride: 0,
            dim0_count: 1,
            offsets: [0; 4],
            counts: [1; 4],
        }
    }

    pub fn new_2d(base: u64, elem_shift: u8, rows: u32, cols: u32, row_stride: u32) -> Self {
        let mut d = Self::empty();
        d.base_address = base;
        d.num_dimensions = 2;
        d.element_size_shift = elem_shift;
        d.dim0_count = cols;
        d.dim0_stride = 0;
        d.counts[0] = rows;
        d.offsets[0] = row_stride;
        d
    }

    pub fn new_5d(
        base: u64,
        elem_shift: u8,
        d0_count: u32,
        d0_stride: u32,
        offsets: [u32; 4],
        counts: [u32; 4],
    ) -> Self {
        Self {
            base_address: base,
            num_dimensions: 5,
            element_size_shift: elem_shift,
            dim0_stride: d0_stride,
            dim0_count: d0_count,
            offsets,
            counts,
        }
    }
}

/// Processing Element (PE) state within a cluster quad (FIG. 10 & FIG. 12)
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PeExecutionState {
    LowPowerSleep,
    AwakeDataValid,
    ExecutingBurst,
}

/// A Processing Element Quad Cluster (q0, q1, q2, q3)
pub struct PeQuadCluster {
    pub pe_states: [PeExecutionState; 4],
    pub pe_registers: [u64; 4],
    pub circular_instructions: [u8; MAX_CIRCULAR_BUFFER_INSTRS],
    pub pc: usize,
}

impl PeQuadCluster {
    pub const fn new() -> Self {
        Self {
            pe_states: [PeExecutionState::LowPowerSleep; 4],
            pe_registers: [0; 4],
            circular_instructions: [0x01, 0x02, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00], // MOV, ANDI, ADD, etc.
            pc: 0,
        }
    }

    pub fn cycle_circular_buffer(&mut self) -> u8 {
        let instr = self.circular_instructions[self.pc];
        self.pc = (self.pc + 1) % MAX_CIRCULAR_BUFFER_INSTRS;
        instr
    }

    pub fn wake_on_data(&mut self, pe_index: usize, data_word: u64) {
        if pe_index < 4 {
            self.pe_registers[pe_index] = data_word;
            self.pe_states[pe_index] = PeExecutionState::AwakeDataValid;
        }
    }
}

/// Wave Computing 5-D Multidimensional DMA Subsystem
pub struct WaveMultiDimDmaEngine {
    pub current_descriptor: TensorWorkDescriptor,
    pub cluster: PeQuadCluster,
    pub total_bursts_completed: u64,
    pub total_addresses_synthesized: u64,
    pub total_bytes_transferred: u64,
}

impl WaveMultiDimDmaEngine {
    pub const fn new() -> Self {
        Self {
            current_descriptor: TensorWorkDescriptor::empty(),
            cluster: PeQuadCluster::new(),
            total_bursts_completed: 0,
            total_addresses_synthesized: 0,
            total_bytes_transferred: 0,
        }
    }

    /// Calculates a specific multidimensional element address using hardware loop strides/offsets
    pub fn calculate_address_offset(
        &self,
        indices: [u32; MAX_TENSOR_DIMS],
    ) -> u64 {
        let elem_bytes = 1u64 << self.current_descriptor.element_size_shift;
        let mut offset = self.current_descriptor.base_address;

        // Dim 0: inner stride
        offset = offset.wrapping_add((indices[0] as u64) * (elem_bytes + self.current_descriptor.dim0_stride as u64));

        // Dims 1..4: higher-dimensional tensor offsets
        for d in 1..self.current_descriptor.num_dimensions as usize {
            if d - 1 < 4 {
                offset = offset.wrapping_add((indices[d] as u64) * (self.current_descriptor.offsets[d - 1] as u64));
            }
        }

        offset
    }

    /// Evaluates whether the address allows a 4KB burst transfer (FIG. 4)
    pub fn check_burst_efficiency(&mut self, addr: u64, requested_bytes: u32) -> (u32, bool) {
        let page_offset = (addr & 0xFFF) as u32;
        let max_contiguous = 4096 - page_offset;
        let burst_len = if requested_bytes < max_contiguous {
            requested_bytes
        } else {
            max_contiguous
        };

        let is_4k_aligned = page_offset == 0;
        self.total_bursts_completed = self.total_bursts_completed.saturating_add(1);
        self.total_bytes_transferred = self.total_bytes_transferred.saturating_add(burst_len as u64);

        (burst_len, is_4k_aligned)
    }

    /// Dispatches tensor slice work into the PE quad cluster
    pub fn dispatch_work_request(&mut self, desc: TensorWorkDescriptor) -> u64 {
        self.current_descriptor = desc;
        self.total_addresses_synthesized = self.total_addresses_synthesized.saturating_add(
            (desc.dim0_count as u64) * (desc.counts[0] as u64)
        );

        // Wake PE0 with base address
        self.cluster.wake_on_data(0, desc.base_address);
        let _ = self.cluster.cycle_circular_buffer();

        desc.base_address
    }
}

pub static mut WAVE_MDDMA_ENGINE: WaveMultiDimDmaEngine = WaveMultiDimDmaEngine::new();

/// Initializes the Wave Computing Multidimensional DMA subsystem
pub unsafe fn init_wave_mddma_subsystem() {
    // Configure default 2-D image/HUD frame tensor: 1920x1080 32-bpp (4 bytes per pixel)
    let desc = TensorWorkDescriptor::new_2d(0x0000_0000_E000_0000, 2, 1080, 1920, 1920 * 4);
    let _ = WAVE_MDDMA_ENGINE.dispatch_work_request(desc);
}
