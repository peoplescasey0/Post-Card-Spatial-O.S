// ============================================================================
// POST CARD OS: INTEL MUSE MEDIATED-DEVICE IN USER SPACE ARCHITECTURE
// Based on WO 2021/086457 A1 (Intel Corporation)
// "Evolving Hypervisor Pass-Through Device to be Consistently Platform-Independent
//  by Mediated-Device in User Space (MUSE)"
// ============================================================================

#![allow(dead_code)]

/// Control plane and data path routing modes (WO 2021/086457 A1, [0028]-[0032], FIG. 1/1a).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MusePathMode {
    ControlPlaneSlowPath = 0, // Relayed through kernel Mdev 120 & MUSE transport to software parent
    DataPlaneFastPath = 1,    // Direct zero-copy access to shared memory descriptor ring bypassing Mdev
}

pub fn path_mode_str(m: MusePathMode) -> &'static str {
    match m {
        MusePathMode::ControlPlaneSlowPath => "CONTROL_PLANE (Slow-Path: Guest -> Mdev -> /dev/muse Relay)",
        MusePathMode::DataPlaneFastPath => "DATA_PATH (Fast-Path: Direct Zero-Copy Ring Bypass via DPDK)",
    }
}

/// Decoupled Interrupt association tracking IRQFD & EVENTFD (FIG. 7, [0061]-[0064]).
#[derive(Clone, Copy)]
pub struct DecoupledInterruptPair {
    pub vector_id: u16,
    pub irqfd: u32,
    pub eventfd: u32,
    pub interrupts_delivered: u64,
    pub is_armed: bool,
}

impl DecoupledInterruptPair {
    pub const fn new() -> Self {
        Self {
            vector_id: 0,
            irqfd: 0,
            eventfd: 0,
            interrupts_delivered: 0,
            is_armed: false,
        }
    }
}

/// Shared memory DMA area containing descriptor ring buffer (FIG. 1a, 136/138/140).
#[derive(Clone, Copy)]
pub struct MuseDmaRingBuffer {
    pub guest_phys_addr: u64,
    pub host_virt_addr: u64,
    pub ring_capacity: u32,
    pub head_index: u32,
    pub tail_index: u32,
    pub packets_processed: u64,
    pub bytes_processed: u64,
}

impl MuseDmaRingBuffer {
    pub const fn new() -> Self {
        Self {
            guest_phys_addr: 0x0080_0000,
            host_virt_addr: 0x7FFF_8000_0000,
            ring_capacity: 512,
            head_index: 0,
            tail_index: 0,
            packets_processed: 0,
            bytes_processed: 0,
        }
    }

    pub fn push_packet_fastpath(&mut self, packet_len: u32) -> u32 {
        let slot = self.tail_index;
        self.tail_index = (self.tail_index + 1) % self.ring_capacity;
        self.packets_processed = self.packets_processed.saturating_add(1);
        self.bytes_processed = self.bytes_processed.saturating_add(packet_len as u64);
        slot
    }
}

/// Mediated Device instance in kernel space (Mdev 120, FIG. 1a).
#[derive(Clone, Copy)]
pub struct KernelMdevInstance {
    pub mdev_id: u32,
    pub is_active: bool,
    pub shadow_bar0: u64,
    pub shadow_bar0_size: u32,
    pub slow_path_relays: u64,
}

impl KernelMdevInstance {
    pub const fn new() -> Self {
        Self {
            mdev_id: 0,
            is_active: false,
            shadow_bar0: 0xFEB0_0000,
            shadow_bar0_size: 0x0001_0000, // 64 KiB MMIO
            slow_path_relays: 0,
        }
    }
}

/// User space Software Parent Device (instance 114, FIG. 1a).
pub struct UserSpaceSoftwareParentDevice {
    pub instance_id: u32,
    pub csr_registers: [u32; 16],
    pub process_virt_addr: u64,
    pub physical_frame_number: u64,
    pub mmio_mapped_gva: u64,
    pub fuse_requests_served: u64,
}

impl UserSpaceSoftwareParentDevice {
    pub const fn new() -> Self {
        Self {
            instance_id: 0,
            csr_registers: [0; 16],
            process_virt_addr: 0x0000_7FFF_1000,
            physical_frame_number: 0x0001_F000,
            mmio_mapped_gva: 0x0000_F000_0000,
            fuse_requests_served: 0,
        }
    }
}

/// Intel MUSE Mediated-Device Orchestrator (WO 2021/086457 A1)
pub struct MuseMediatorEngine {
    pub mdev_kernel_instances: [KernelMdevInstance; 4],
    pub user_parent_devices: [UserSpaceSoftwareParentDevice; 4],
    pub dma_rings: [MuseDmaRingBuffer; 4],
    pub interrupt_pairs: [DecoupledInterruptPair; 4],
    pub fuse_daemon_connected: bool,
    pub total_fastpath_packets: u64,
    pub total_slowpath_relays: u64,
}

impl MuseMediatorEngine {
    pub const fn new() -> Self {
        Self {
            mdev_kernel_instances: [KernelMdevInstance::new(); 4],
            user_parent_devices: [
                UserSpaceSoftwareParentDevice::new(),
                UserSpaceSoftwareParentDevice::new(),
                UserSpaceSoftwareParentDevice::new(),
                UserSpaceSoftwareParentDevice::new(),
            ],
            dma_rings: [MuseDmaRingBuffer::new(); 4],
            interrupt_pairs: [DecoupledInterruptPair::new(); 4],
            fuse_daemon_connected: false,
            total_fastpath_packets: 0,
            total_slowpath_relays: 0,
        }
    }

    /// Initializes MUSE Transport (/dev/muse) and connects the FUSE server daemon
    /// (WO 2021/086457 A1, [0035]-[0038], FIG. 3, Block 302).
    pub fn connect_muse_transport(&mut self) {
        self.fuse_daemon_connected = true;
    }

    /// Creates a Mediated Device instance in kernel space (Mdev 120, Block 306).
    pub fn create_mdev_instance(&mut self, slot: usize) -> Result<u32, &'static str> {
        if slot >= self.mdev_kernel_instances.len() {
            return Err("muse_err: invalid slot");
        }
        self.mdev_kernel_instances[slot].mdev_id = 0x4D44_0000 | (slot as u32); // 'MD'
        self.mdev_kernel_instances[slot].is_active = true;

        // Associate decoupled IRQFD and EVENTFD for guest interrupts (FIG. 7, Block 708)
        self.interrupt_pairs[slot].vector_id = (32 + slot) as u16;
        self.interrupt_pairs[slot].irqfd = (100 + slot) as u32;
        self.interrupt_pairs[slot].eventfd = (200 + slot) as u32;
        self.interrupt_pairs[slot].is_armed = true;

        Ok(self.mdev_kernel_instances[slot].mdev_id)
    }

    /// Relays a control-plane operation from guest driver through Mdev 120 and
    /// /dev/muse to user-space software parent device (FIG. 4, Block 404).
    pub fn relay_control_plane_op(&mut self, slot: usize, csr_idx: usize, val: u32) -> Result<u32, &'static str> {
        if slot >= self.mdev_kernel_instances.len() || !self.mdev_kernel_instances[slot].is_active {
            return Err("muse_err: mdev not active");
        }
        self.mdev_kernel_instances[slot].slow_path_relays = self.mdev_kernel_instances[slot].slow_path_relays.saturating_add(1);
        self.total_slowpath_relays = self.total_slowpath_relays.saturating_add(1);

        let parent = &mut self.user_parent_devices[slot];
        parent.fuse_requests_served = parent.fuse_requests_served.saturating_add(1);
        if csr_idx < parent.csr_registers.len() {
            parent.csr_registers[csr_idx] = val;
        }

        Ok(val)
    }

    /// Dispatches a high-speed packet directly through the user-space DPDK data path,
    /// completely bypassing Mdev 120 and the kernel (FIG. 1a, [0028], [0032], [0054]).
    pub fn dispatch_fastpath_packet(&mut self, slot: usize, length: u32) -> Result<u32, &'static str> {
        if slot >= self.dma_rings.len() {
            return Err("muse_err: invalid ring slot");
        }
        let tail = self.dma_rings[slot].push_packet_fastpath(length);
        self.total_fastpath_packets = self.total_fastpath_packets.saturating_add(1);

        // Inject decoupled guest interrupt via EVENTFD -> IRQFD
        self.interrupt_pairs[slot].interrupts_delivered = self.interrupt_pairs[slot].interrupts_delivered.saturating_add(1);

        Ok(tail)
    }
}

pub static mut MUSE_ENGINE: MuseMediatorEngine = MuseMediatorEngine::new();

/// Initializes the Intel MUSE subsystem with default Mdev instances.
pub unsafe fn init_muse_subsystem() {
    MUSE_ENGINE.connect_muse_transport();
    let _ = MUSE_ENGINE.create_mdev_instance(0); // vNIC-0 (VFIO-MDEV)
    let _ = MUSE_ENGINE.create_mdev_instance(1); // vNIC-1 (SDN/NFV)
}
