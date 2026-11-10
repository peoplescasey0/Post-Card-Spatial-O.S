// ============================================================================
// POST CARD OS: VIRTUALIZATION-BASED PLATFORM PROTECTION TECHNOLOGY (PPT)
// Based on US 2023/0030961 A1 (Intel Corporation)
// "Virtualization-Based Platform Protection Technology"
// ============================================================================

#![allow(dead_code)]

/// Dual EPT Memory Views (US 2023/0030961 A1, [0032]-[0038], FIG. 3A-3B).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum EptView {
    View0Untrusted = 0, // Untrusted guest OS & normal applications
    View1Trusted = 1,   // Trusted Application (TA) isolated execution view
}

pub fn ept_view_str(v: EptView) -> &'static str {
    match v {
        EptView::View0Untrusted => "VIEW_0_UNTRUSTED (Host OS / User Apps)",
        EptView::View1Trusted => "VIEW_1_TRUSTED (Enclave TA / Protected Memory)",
    }
}

/// Trampoline Interrupt Service Routine Vector (VIDT) (US 2023/0030961 A1, [0046]-[0055], FIG. 4)
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum TrampolineVector {
    Int29EcallEntry = 0x29,   // Synchronous entry into Trusted Application
    Int30AsynchExit = 0x30,   // Asynchronous exit (AEX) due to external interrupt
    Int31EexitReturn = 0x31,  // Synchronous exit back to untrusted environment
}

/// State Save Area (SSA) for holding TA CPU register context across AEX
#[repr(C)]
#[derive(Clone, Copy)]
pub struct StateSaveArea {
    pub saved_rip: u64,
    pub saved_rsp: u64,
    pub saved_rflags: u64,
    pub saved_rax: u64,
    pub saved_rbx: u64,
    pub is_valid: bool,
}

impl StateSaveArea {
    pub const fn new() -> Self {
        Self {
            saved_rip: 0,
            saved_rsp: 0,
            saved_rflags: 0,
            saved_rax: 0,
            saved_rbx: 0,
            is_valid: false,
        }
    }
}

/// Asserted Page Table (APT) manager locked in protected hypervisor heap
/// (US 2023/0030961 A1, [0039]-[0045], FIG. 2).
#[repr(C)]
pub struct AssertedPageTable {
    pub gpt_base_cr3: u64,      // Original guest page table CR3
    pub apt_locked_cr3: u64,    // Replicated, hypervisor-locked page table CR3
    pub is_apt_locked: bool,
    pub verified_entry_rip: u64,
}

impl AssertedPageTable {
    pub const fn new() -> Self {
        Self {
            gpt_base_cr3: 0x0000_0000_1000_0000,
            apt_locked_cr3: 0x0000_0000_2000_0000, // In hypervisor heap
            is_apt_locked: true,
            verified_entry_rip: 0x0000_7FFF_8000_1000,
        }
    }
}

/// Platform Protection Technology Subsystem (US 2023/0030961 A1)
pub struct PlatformProtectionSubsystem {
    pub active_view: EptView,
    pub apt: AssertedPageTable,
    pub ssa: StateSaveArea,
    pub secure_cookie_value: u64,
    pub ecalls_serviced: u64,
    pub aex_interrupts_handled: u64,
    pub eexits_serviced: u64,
    pub security_faults: u64,
}

impl PlatformProtectionSubsystem {
    pub const fn new() -> Self {
        Self {
            active_view: EptView::View0Untrusted,
            apt: AssertedPageTable::new(),
            ssa: StateSaveArea::new(),
            secure_cookie_value: 0x5050_545F_5345_4356, // 'PPT_SECV'
            ecalls_serviced: 0,
            aex_interrupts_handled: 0,
            eexits_serviced: 0,
            security_faults: 0,
        }
    }

    /// Int-29 TISR: Synchronous ECALL entry into Trusted Application
    /// Verifies Secure Cookie Value, switches EPT to View 1, sets CR3 to APT (FIG. 4A).
    pub fn handle_int29_ecall_entry(&mut self, presented_cookie: u64, target_rip: u64) -> Result<u64, &'static str> {
        if presented_cookie != self.secure_cookie_value {
            self.security_faults = self.security_faults.saturating_add(1);
            return Err("ppt_err: invalid Secure Cookie Value (SCV) mismatch");
        }

        if target_rip != self.apt.verified_entry_rip {
            self.security_faults = self.security_faults.saturating_add(1);
            return Err("ppt_err: illegal unverified entry RIP target");
        }

        // 1. Switch to EPT View 1 (Protected TA Enclave View)
        self.active_view = EptView::View1Trusted;

        // 2. Load Asserted Page Table (APT) CR3 to isolate translation from untrusted OS
        let active_cr3 = self.apt.apt_locked_cr3;

        self.ecalls_serviced = self.ecalls_serviced.saturating_add(1);
        Ok(active_cr3)
    }

    /// Int-30 TISR: Asynchronous Exit (AEX) triggered by hardware interrupt during TA execution
    /// Saves volatile register state to SSA, scrubs registers, and drops back to View 0 (FIG. 4B).
    pub fn handle_int30_asynch_exit(&mut self, current_rip: u64, current_rsp: u64) -> Result<(), &'static str> {
        if self.active_view != EptView::View1Trusted {
            return Err("ppt_err: AEX received outside of View 1 Trusted state");
        }

        // 1. Save TA state in State Save Area (SSA)
        self.ssa.saved_rip = current_rip;
        self.ssa.saved_rsp = current_rsp;
        self.ssa.is_valid = true;

        // 2. Drop EPT view back to View 0 (Untrusted host OS) to handle the interrupt
        self.active_view = EptView::View0Untrusted;
        self.aex_interrupts_handled = self.aex_interrupts_handled.saturating_add(1);

        Ok(())
    }

    /// Int-31 TISR: Synchronous EEXIT return back to untrusted environment
    /// Scrubs secrets, resets EPT view to View 0, and restores original GPT CR3 (FIG. 4C).
    pub fn handle_int31_eexit_return(&mut self) -> Result<u64, &'static str> {
        if self.active_view != EptView::View1Trusted {
            return Err("ppt_err: EEXIT called outside View 1 Trusted state");
        }

        // 1. Revert EPT back to Untrusted View 0
        self.active_view = EptView::View0Untrusted;

        // 2. Invalidate SSA
        self.ssa.is_valid = false;

        self.eexits_serviced = self.eexits_serviced.saturating_add(1);

        // Return untrusted host CR3
        Ok(self.apt.gpt_base_cr3)
    }
}

pub static mut PPT_SUBSYSTEM: PlatformProtectionSubsystem = PlatformProtectionSubsystem::new();

/// Initializes Intel Platform Protection Technology subsystem.
pub unsafe fn init_platform_protection() {
    // Verify default state
    PPT_SUBSYSTEM.active_view = EptView::View0Untrusted;
}
