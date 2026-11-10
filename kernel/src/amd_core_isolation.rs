// ============================================================================
// POST CARD OS: AMD HYPERVISOR-BASED PROCESSOR CORE ISOLATION & ACCELERATOR ENGINE
// Based on EP 2 519 877 B1 (Advanced Micro Devices, Inc.)
// "Hypervisor-Based Isolation of Processor Cores"
// ============================================================================

#![allow(dead_code)]

/// State of an isolated/sequestered processor core (EP 2 519 877 B1, [0004], [0014]).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum CoreAssignmentState {
    HostGuestOs = 0,         // Managed by Guest OS (Windows/Linux/Spatial OS)
    SequesteredAccelerator = 1, // Isolated from OS, configured as de facto hardware accelerator
    WorkUnitExecuting = 2,    // Currently executing application work unit
    PageFaultHandling = 3,    // Trapped in #PF VMEXIT, awaiting OS page table update
}

pub fn core_state_str(s: CoreAssignmentState) -> &'static str {
    match s {
        CoreAssignmentState::HostGuestOs => "HOST_OS (Managed by Primary Kernel)",
        CoreAssignmentState::SequesteredAccelerator => "SEQUESTERED (De Facto Accelerator Idle)",
        CoreAssignmentState::WorkUnitExecuting => "EXECUTING (Work Unit Processing)",
        CoreAssignmentState::PageFaultHandling => "PAGE_FAULT (Handling #PF via Fault Queue)",
    }
}

/// Work unit descriptor enqueued in Work Queue 424 (EP 2 519 877 B1, [0020]-[0021]).
#[derive(Clone, Copy)]
pub struct WorkUnitDescriptor {
    pub work_id: u32,
    pub target_core: u8,
    pub payload_size: u32,
    pub virtual_addr: u64,
    pub is_completed: bool,
}

/// Shared virtual memory queue ring (EP 2 519 877 B1, [0018]-[0021], FIG. 3).
/// Includes Work Queue (424), Command Queue (418), Response Queue (420), and Fault Queue (422).
pub struct CoreIsolationQueueFabric {
    pub work_queue: [WorkUnitDescriptor; 8],
    pub work_q_head: usize,
    pub work_q_tail: usize,

    pub command_queue_count: u64,
    pub response_queue_count: u64,
    pub fault_queue_count: u64,

    pub vmmcall_doorbells: u64,
    pub init_ipis_sent: u64,
    pub page_fault_vmexits: u64,
    pub work_units_completed: u64,
}

impl CoreIsolationQueueFabric {
    pub const fn new() -> Self {
        Self {
            work_queue: [WorkUnitDescriptor {
                work_id: 0,
                target_core: 0,
                payload_size: 0,
                virtual_addr: 0,
                is_completed: false,
            }; 8],
            work_q_head: 0,
            work_q_tail: 0,
            command_queue_count: 0,
            response_queue_count: 0,
            fault_queue_count: 0,
            vmmcall_doorbells: 0,
            init_ipis_sent: 0,
            page_fault_vmexits: 0,
            work_units_completed: 0,
        }
    }

    /// Application enqueues a work unit to Work Queue 424 and rings the VMM doorbell
    /// via VMMCALL (EP 2 519 877 B1, [0022]-[0023], FIG. 6).
    pub fn enqueue_work(&mut self, work_id: u32, target_core: u8, size: u32, vaddr: u64) -> Result<usize, &'static str> {
        let next_tail = (self.work_q_tail + 1) % self.work_queue.len();
        if next_tail == self.work_q_head {
            return Err("work_q: queue full");
        }
        let slot = self.work_q_tail;
        self.work_queue[slot] = WorkUnitDescriptor {
            work_id,
            target_core,
            payload_size: size,
            virtual_addr: vaddr,
            is_completed: false,
        };
        self.work_q_tail = next_tail;
        self.vmmcall_doorbells = self.vmmcall_doorbells.saturating_add(1);
        self.init_ipis_sent = self.init_ipis_sent.saturating_add(1);

        Ok(slot)
    }

    /// Dequeues and completes a work unit on a sequestered core (FIG. 8).
    pub fn complete_work(&mut self, slot: usize) -> Result<u32, &'static str> {
        if slot >= self.work_queue.len() || self.work_q_head == self.work_q_tail {
            return Err("work_q: invalid slot");
        }
        self.work_queue[slot].is_completed = true;
        self.work_q_head = (self.work_q_head + 1) % self.work_queue.len();
        self.response_queue_count = self.response_queue_count.saturating_add(1);
        self.work_units_completed = self.work_units_completed.saturating_add(1);

        Ok(self.work_queue[slot].work_id)
    }
}

/// The AMD Hypervisor Core Isolator Manager (EP 2 519 877 B1)
pub struct AmdCoreIsolatorManager {
    pub total_cores: u8,
    pub host_cores: u8,
    pub sequestered_cores: u8,
    pub core_states: [CoreAssignmentState; 8],
    pub queue_fabric: CoreIsolationQueueFabric,
    pub shared_memory_base: u64,
    pub shared_memory_size: u64,
}

impl AmdCoreIsolatorManager {
    pub const fn new() -> Self {
        Self {
            total_cores: 8,
            host_cores: 4,        // Cores 0..3: visible to Guest OS
            sequestered_cores: 4, // Cores 4..7: isolated de facto accelerators
            core_states: [
                CoreAssignmentState::HostGuestOs,
                CoreAssignmentState::HostGuestOs,
                CoreAssignmentState::HostGuestOs,
                CoreAssignmentState::HostGuestOs,
                CoreAssignmentState::SequesteredAccelerator,
                CoreAssignmentState::SequesteredAccelerator,
                CoreAssignmentState::SequesteredAccelerator,
                CoreAssignmentState::SequesteredAccelerator,
            ],
            queue_fabric: CoreIsolationQueueFabric::new(),
            shared_memory_base: 0x4000_0000, // 1 GiB dedicated shared queue arena
            shared_memory_size: 0x1000_0000, // 256 MiB
        }
    }

    /// Dispatches work to an idle sequestered core, transitioning it to executing state
    /// (EP 2 519 877 B1, [0028], FIG. 6).
    pub fn dispatch_accelerator_work(&mut self, work_id: u32, size: u32, vaddr: u64) -> Result<u8, &'static str> {
        // Find available sequestered core (Cores 4..7)
        for i in (self.host_cores as usize)..(self.total_cores as usize) {
            if self.core_states[i] == CoreAssignmentState::SequesteredAccelerator {
                self.core_states[i] = CoreAssignmentState::WorkUnitExecuting;
                let slot = self.queue_fabric.enqueue_work(work_id, i as u8, size, vaddr)?;
                let _ = self.queue_fabric.complete_work(slot);
                self.core_states[i] = CoreAssignmentState::SequesteredAccelerator;
                return Ok(i as u8);
            }
        }
        Err("accelerator_err: all sequestered cores busy")
    }

    /// Simulates a page fault on a sequestered core (#PF VMEXIT) and handles it via
    /// the Fault Queue 422 and Command Queue 418 (EP 2 519 877 B1, [0029], FIG. 7).
    pub fn handle_sequestered_page_fault(&mut self, core_id: u8) -> Result<(), &'static str> {
        if (core_id as usize) >= self.core_states.len() {
            return Err("invalid core id");
        }
        self.core_states[core_id as usize] = CoreAssignmentState::PageFaultHandling;
        self.queue_fabric.page_fault_vmexits = self.queue_fabric.page_fault_vmexits.saturating_add(1);
        self.queue_fabric.fault_queue_count = self.queue_fabric.fault_queue_count.saturating_add(1);

        // KMD Deferred Procedure Call updates page tables and sends CMD_RESUME
        self.queue_fabric.command_queue_count = self.queue_fabric.command_queue_count.saturating_add(1);
        self.core_states[core_id as usize] = CoreAssignmentState::SequesteredAccelerator;

        Ok(())
    }
}

pub static mut AMD_CORE_ISOLATOR: AmdCoreIsolatorManager = AmdCoreIsolatorManager::new();

/// Initializes AMD Hypervisor-Based Core Isolation subsystem.
pub unsafe fn init_amd_core_isolation() {
    // Cores 0..3 assigned to primary OS; Cores 4..7 sequestered as de facto computing accelerators
    let _ = AMD_CORE_ISOLATOR.dispatch_accelerator_work(1001, 4096, 0x0040_0000);
}
