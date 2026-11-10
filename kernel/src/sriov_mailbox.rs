// ============================================================================
// POST CARD OS: VMWARE SR-IOV PF-VF MAILBOX DYNAMIC INTERCEPT VIRTUALIZER
// Based on US 2021/0209040 A1 (VMware, Inc.)
// "Techniques for Virtualizing PF-VF Mailbox Communication in SR-IOV Devices"
// ============================================================================

#![allow(dead_code)]

/// Communication protocol phase between Guest VF Driver and Host PF Driver
/// (US 2021/0209040 A1, [0041]-[0045], FIG. 4A-4D).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum MailboxProtocolState {
    DirectPassThrough = 0,    // Intercept removed; direct low-latency VF hardware access
    InterceptArmed = 1,       // EPT altered; mailbox page access trapped to hypervisor
    MessageExchanging = 2,    // Hypervisor emulating response (capabilities/MAC/MTU)
    ErrorIsolationActive = 3, // Device error; all MMIO intercepted, writes dropped
}

pub fn protocol_state_str(s: MailboxProtocolState) -> &'static str {
    match s {
        MailboxProtocolState::DirectPassThrough => "DIRECT_PASS_THROUGH (EPT Intercept Removed, Native Speed)",
        MailboxProtocolState::InterceptArmed => "INTERCEPT_ARMED (EPT Altered, Trapping Mailbox Access)",
        MailboxProtocolState::MessageExchanging => "MESSAGE_EXCHANGING (Hypervisor Emulating Protocol)",
        MailboxProtocolState::ErrorIsolationActive => "ERROR_ISOLATION (All MMIO Trapped, Writes Dropped)",
    }
}

/// Emulated hardware mailbox register set for an SR-IOV Virtual Function (VF)
/// (US 2021/0209040 A1, [0024]-[0025], FIG. 1B, 156a).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct VfMailboxRegisterSet {
    pub mailbox_data: u32,
    pub doorbell_flag: bool,
    pub last_response: u32,
}

impl VfMailboxRegisterSet {
    pub const fn new() -> Self {
        Self {
            mailbox_data: 0,
            doorbell_flag: false,
            last_response: 0,
        }
    }
}

/// The SR-IOV Mailbox Intercept & Checkpoint Manager (US 2021/0209040 A1)
pub struct SriovMailboxVirtualizer {
    pub state: MailboxProtocolState,
    pub vf_registers: VfMailboxRegisterSet,
    pub callback_registered: bool,

    // Statistics & Checkpoint Tracking
    pub guest_messages_intercepted: u64,
    pub ept_flips_count: u64,
    pub checkpoint_sync_events: u64,
    pub dropped_error_writes: u64,
}

impl SriovMailboxVirtualizer {
    pub const fn new() -> Self {
        Self {
            state: MailboxProtocolState::DirectPassThrough,
            vf_registers: VfMailboxRegisterSet::new(),
            callback_registered: true,
            guest_messages_intercepted: 0,
            ept_flips_count: 0,
            checkpoint_sync_events: 0,
            dropped_error_writes: 0,
        }
    }

    /// Guest VF driver initiates communication via mailbox register and rings doorbell.
    /// Physical PF driver invokes registered PF intercept callback in hypervisor (FIG. 4A-4C).
    pub fn trigger_guest_communication(&mut self, request_code: u32) -> Result<u32, &'static str> {
        if self.state == MailboxProtocolState::ErrorIsolationActive {
            self.dropped_error_writes = self.dropped_error_writes.saturating_add(1);
            return Err("sriov_err: device in error lockdown, writes dropped");
        }

        // 1. Arm EPT intercept for mailbox page (Setup_PF_intercept_for_mailbox_access)
        self.state = MailboxProtocolState::InterceptArmed;
        self.ept_flips_count = self.ept_flips_count.saturating_add(1);

        // 2. Intercept module emulates protocol (FIG. 4D)
        self.state = MailboxProtocolState::MessageExchanging;
        self.vf_registers.mailbox_data = request_code;
        self.vf_registers.doorbell_flag = true;
        self.guest_messages_intercepted = self.guest_messages_intercepted.saturating_add(1);

        // Compute simulated response (e.g. SR-IOV capability bits 0x5249_0000 | req)
        let response = 0x5249_0000 | (request_code & 0xFFFF);
        self.vf_registers.last_response = response;
        self.vf_registers.doorbell_flag = false;

        // 3. Checkpointing state updated: hypervisor now has exact device capability state!
        self.checkpoint_sync_events = self.checkpoint_sync_events.saturating_add(1);

        // 4. Remove EPT intercept (Remove_PF_intercept_for_mailbox_access)
        self.state = MailboxProtocolState::DirectPassThrough;
        self.ept_flips_count = self.ept_flips_count.saturating_add(1);

        Ok(response)
    }

    /// Simulates hardware error notification from SR-IOV device (FIG. 6A-6C).
    /// Hypervisor sets up PF intercept for ALL MMIO regions and drops writes.
    pub fn trigger_device_error(&mut self) {
        self.state = MailboxProtocolState::ErrorIsolationActive;
        self.ept_flips_count = self.ept_flips_count.saturating_add(1);
    }

    /// Resets error state back to normal pass-through after device recovery.
    pub fn reset_device_recovery(&mut self) {
        self.state = MailboxProtocolState::DirectPassThrough;
        self.ept_flips_count = self.ept_flips_count.saturating_add(1);
    }
}

pub static mut SRIOV_VIRTUALIZER: SriovMailboxVirtualizer = SriovMailboxVirtualizer::new();

/// Initializes the VMware SR-IOV Mailbox Intercept subsystem.
pub unsafe fn init_sriov_mailbox_subsystem() {
    // Register PF intercept callback and verify initial direct pass-through state
    let _ = SRIOV_VIRTUALIZER.trigger_guest_communication(0x0001); // Query capabilities
}
