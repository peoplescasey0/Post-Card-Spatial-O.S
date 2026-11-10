// ============================================================================
// POST CARD OS: RUNTIME HYPERVISOR LATE-LAUNCH & STATE CAPTURE ENGINE
// Based on EP 2 024 826 B1 (Microsoft Technology Licensing, LLC)
// "Launching Hypervisor Under Running Operating System"
// ============================================================================

#![allow(dead_code)]

/// Mechanism used to inhibit Non-Maskable Interrupts during late launch
/// (EP 2 024 826 B1, [0038]-[0039], Claim 5).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum NmiInhibitionMethod {
    SelfDeliveredNmiNoIret = 1, // Deliver NMI to self, keep in handler without executing IRET
    TemporaryIdtAndStack = 2,   // Safe temporary page tables, IDT, and dedicated stack
}

pub fn nmi_inhibition_str(m: NmiInhibitionMethod) -> &'static str {
    match m {
        NmiInhibitionMethod::SelfDeliveredNmiNoIret => "Self-Delivered NMI (IRET suppressed, hardware NMI mask active)",
        NmiInhibitionMethod::TemporaryIdtAndStack => "Temporary IDT & Stack Arena (Protected Transition Window)",
    }
}

/// State of the transition from bare-metal Root OS to virtualized guest.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum LateLaunchPhase {
    BareMetalRunning = 0,       // Act 201: OS running directly on physical hardware
    HardwareDiscovered = 1,     // Act 211A: OS discovered physical CPU, RAM, and APIC
    InterruptsInhibited = 2,    // Act 501: Maskable IF=0, Non-Maskable inhibited
    TempVmCreated = 3,          // Act 502: Temporary VM created with intercept instruction
    InterceptTriggered = 4,     // Act 505: Intercept fired, CPU switched to VMX root state
    HypervisorOperational = 5,  // Act 221: Hypervisor active, temp VM destroyed (Act 508)
    RootOsVirtualized = 6,      // Act 233/214: Root OS resumed transparently inside VM
}

pub fn launch_phase_str(p: LateLaunchPhase) -> &'static str {
    match p {
        LateLaunchPhase::BareMetalRunning => "BARE_METAL (Direct Hardware Access)",
        LateLaunchPhase::HardwareDiscovered => "HARDWARE_DISCOVERED (State Handover Ready)",
        LateLaunchPhase::InterruptsInhibited => "INTERRUPTS_INHIBITED (NMI Inactionable)",
        LateLaunchPhase::TempVmCreated => "TEMP_VM_CREATED (Primed for Intercept)",
        LateLaunchPhase::InterceptTriggered => "INTERCEPT_TRIGGERED (Switched to VMX Root)",
        LateLaunchPhase::HypervisorOperational => "HYPERVISOR_OPERATIONAL (Temp VM Destroyed)",
        LateLaunchPhase::RootOsVirtualized => "ROOT_OS_VIRTUALIZED (Transparent Micro-VM Resumed)",
    }
}

/// Processor architecture state captured prior to launching hypervisor
/// (EP 2 024 826 B1, [0027]).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct CapturedProcessorState {
    pub rax: u64,
    pub rbx: u64,
    pub rcx: u64,
    pub rdx: u64,
    pub rsi: u64,
    pub rdi: u64,
    pub rbp: u64,
    pub rsp: u64,
    pub r8: u64,
    pub r9: u64,
    pub r10: u64,
    pub r11: u64,
    pub r12: u64,
    pub r13: u64,
    pub r14: u64,
    pub r15: u64,
    pub rip: u64,
    pub rflags: u64,
    pub cr0: u64,
    pub cr3: u64,
    pub cr4: u64,
    pub gdtr_base: u64,
    pub gdtr_limit: u16,
    pub idtr_base: u64,
    pub idtr_limit: u16,
    pub kernel_gs_base: u64,
    pub lstar: u64,
    pub apic_base_msr: u64,
}

impl CapturedProcessorState {
    pub const fn new() -> Self {
        Self {
            rax: 0, rbx: 0, rcx: 0, rdx: 0,
            rsi: 0, rdi: 0, rbp: 0, rsp: 0x0020_0000,
            r8: 0, r9: 0, r10: 0, r11: 0,
            r12: 0, r13: 0, r14: 0, r15: 0,
            rip: 0x0010_0000,
            rflags: 0x0000_0202, // IF bit set
            cr0: 0x8001_0033,    // PG, WP, NE, ET, PE
            cr3: 0x0010_1000,
            cr4: 0x0000_0668,    // OSFXSR, OSXMMEXCPT, PAE, VME
            gdtr_base: 0x0010_2000,
            gdtr_limit: 0x003F,
            idtr_base: 0x0010_3000,
            idtr_limit: 0x0FFF,
            kernel_gs_base: 0xFFFF_8000_0000_0000,
            lstar: 0x0010_4000,
            apic_base_msr: 0xFEE0_0900,
        }
    }
}

/// Local APIC hardware state captured prior to hypervisor launch
/// (EP 2 024 826 B1, [0028]).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct CapturedLocalApicState {
    pub apic_id: u32,
    pub irr: [u32; 8], // In-Request Registers
    pub isr: [u32; 8], // In-Service Registers
    pub tpr: u32,      // Task Priority Register
    pub mmio_phys_addr: u64,
    pub is_virtualized_intercept_active: bool,
}

impl CapturedLocalApicState {
    pub const fn new() -> Self {
        Self {
            apic_id: 0,
            irr: [0; 8],
            isr: [0; 8],
            tpr: 0,
            mmio_phys_addr: 0xFEE0_0000,
            is_virtualized_intercept_active: false,
        }
    }
}

/// System hardware topology provided by Root OS to Hypervisor
/// (EP 2 024 826 B1, [0029], Claims 1, 8).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct HardwareTopologyReport {
    pub logical_processor_count: u32,
    pub hyperthreading_enabled: bool,
    pub physical_ram_base: u64,
    pub physical_ram_size: u64,
    pub pm_timer_port: u16,
    pub acpi_table_pa: u64,
}

impl HardwareTopologyReport {
    pub const fn new() -> Self {
        Self {
            logical_processor_count: 8,
            hyperthreading_enabled: true,
            physical_ram_base: 0x0000_0000,
            physical_ram_size: 17179869184, // 16 GiB
            pm_timer_port: 0x1808,
            acpi_table_pa: 0x7FFE_0000,
        }
    }
}

/// The Late-Launch Hypervisor Orchestrator (EP 2 024 826 B1)
pub struct LateLaunchHypervisorManager {
    pub phase: LateLaunchPhase,
    pub nmi_method: NmiInhibitionMethod,
    pub cpu_state: CapturedProcessorState,
    pub apic_state: CapturedLocalApicState,
    pub topology: HardwareTopologyReport,
    pub temp_vm_id: u32,
    pub root_vm_id: u32,
    pub transition_events: u64,
    pub apic_trapped_accesses: u64,
}

impl LateLaunchHypervisorManager {
    pub const fn new() -> Self {
        Self {
            phase: LateLaunchPhase::BareMetalRunning,
            nmi_method: NmiInhibitionMethod::SelfDeliveredNmiNoIret,
            cpu_state: CapturedProcessorState::new(),
            apic_state: CapturedLocalApicState::new(),
            topology: HardwareTopologyReport::new(),
            temp_vm_id: 0x7E39_0001, // 'TEMP'
            root_vm_id: 0x524F_0001, // 'ROOT'
            transition_events: 0,
            apic_trapped_accesses: 0,
        }
    }

    /// Captures the running operating system's architectural state
    /// (EP 2 024 826 B1, Act 211A, [0026]-[0028]).
    pub fn discover_and_capture_state(&mut self, current_rip: u64, current_rsp: u64, current_cr3: u64) {
        self.cpu_state.rip = current_rip;
        self.cpu_state.rsp = current_rsp;
        self.cpu_state.cr3 = current_cr3;
        self.phase = LateLaunchPhase::HardwareDiscovered;
        self.transition_events = self.transition_events.saturating_add(1);
    }

    /// Renders all interrupts inactionable (Act 501, [0038]-[0039]).
    pub fn inhibit_interrupts(&mut self, method: NmiInhibitionMethod) {
        self.nmi_method = method;
        self.cpu_state.rflags &= !(1 << 9); // Clear IF (maskable interrupts disabled)
        self.phase = LateLaunchPhase::InterruptsInhibited;
        self.transition_events = self.transition_events.saturating_add(1);
    }

    /// Creates temporary virtual machine instance primed with an intercept instruction
    /// (Acts 502-503, [0040], Claim 4).
    pub fn prime_temporary_vm(&mut self) {
        self.phase = LateLaunchPhase::TempVmCreated;
        self.transition_events = self.transition_events.saturating_add(1);
    }

    /// Resumes the temporary VM, triggering an intercept into hypervisor mode
    /// (Acts 504-507, [0040], Claim 4).
    pub fn trigger_intercept_and_enter_hypervisor(&mut self) {
        self.phase = LateLaunchPhase::InterceptTriggered;
        // Hypervisor initializes, destroys the temporary VM (Act 508, Claim 6)
        self.phase = LateLaunchPhase::HypervisorOperational;
        self.transition_events = self.transition_events.saturating_add(2);
    }

    /// Instantiates Root Partition VM instance initialized with captured Root OS state,
    /// installs APIC page intercepts, and transparently resumes Root OS inside VM
    /// (Acts 231-233, [0032]-[0034], Claim 1).
    pub fn virtualize_root_os(&mut self) {
        // Trap physical APIC accesses by marking page not-present / EPT intercept
        self.apic_state.is_virtualized_intercept_active = true;
        self.phase = LateLaunchPhase::RootOsVirtualized;
        self.transition_events = self.transition_events.saturating_add(1);
    }

    /// Handles a trapped APIC access from the virtualized Root OS.
    pub fn handle_apic_intercept(&mut self, is_write: bool) {
        if self.apic_state.is_virtualized_intercept_active {
            self.apic_trapped_accesses = self.apic_trapped_accesses.saturating_add(1);
            if is_write {
                self.apic_state.tpr = self.apic_state.tpr.wrapping_add(1);
            }
        }
    }
}

pub static mut LATE_HYPERVISOR_MGR: LateLaunchHypervisorManager = LateLaunchHypervisorManager::new();

/// Initializes and demonstrates the late hypervisor launch sequence.
pub unsafe fn init_late_hypervisor_subsystem() {
    // 1. Capture current hardware state (RIP, RSP, CR3)
    LATE_HYPERVISOR_MGR.discover_and_capture_state(0x0010_0000, 0x002F_F000, 0x0010_1000);

    // 2. Inhibit maskable and non-maskable interrupts
    LATE_HYPERVISOR_MGR.inhibit_interrupts(NmiInhibitionMethod::SelfDeliveredNmiNoIret);

    // 3. Create temporary VM and prime with intercept
    LATE_HYPERVISOR_MGR.prime_temporary_vm();

    // 4. Trigger intercept and promote to VMX root hypervisor mode
    LATE_HYPERVISOR_MGR.trigger_intercept_and_enter_hypervisor();

    // 5. Virtualize Root OS with captured state and armed APIC intercepts
    LATE_HYPERVISOR_MGR.virtualize_root_os();
}
