// ============================================================================
// ANJUNA SECURE RUNTIME / OS BRIDGE & BARKLY HYPERVISOR MSR SHADOW MONITOR
//
// Architectural Blueprint & Patent Implementations:
//   1. US 11,714,895 B2 (Anjuna Security, Inc. / Michalevsky et al.):
//      "Secure runtime systems and methods"
//      - 6-Stage Secure Application Loader (FIG. 4): Loads OS Bridge,
//        in-enclave ELF loader, unmodified ELF binary, shared libs, init,
//        and execution inside hardware enclave.
//      - 11-NOP Binary Rewriting Trampoline & Dual-Stack Syscall Switching
//        (FIG. 5): Saves enclave stack, executes syscall on trusted stack,
//        encrypts file/socket I/O transparently, restores original stack.
//      - Multi-Enclave Identical Data Key Provisioning (FIG. 6): Uses
//        MRENCLAVE seal-key + AES-GCM private key + MRSIGNER X.509 quote.
//   2. US 9,589,132 B2 (Barkly Protects, Inc. / Swidowski et al.):
//      "Method and apparatus for hypervisor based monitoring of system
//       interactions"
//      - Hybrid In-Band Software Monitor + Out-of-Band Hypervisor:
//        Zero VMEXIT overhead on frequent syscalls.
//      - EPT Execute-Only / Read-Only + IOMMU fortification obscuring the
//        monitor from code-signature scanners and rootkits.
//      - IA32_LSTAR MSR Read Shadow (returns Fake_IA32LSTAR to integrity
//        checkers like PatchGuard) & MSR Write Mask (blocks relocation).
// ============================================================================

#![allow(dead_code)]

use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

pub const MAX_RUNTIME_ENCLAVES: usize = 8;

/// 6-Stage Secure Application Loader phases (US 11,714,895 B2, FIG. 4: 402..412).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoaderStage {
    Uninitialized,
    OsBridgeLoaded,       // 402
    InEnclaveElfLoaded,   // 404
    BinaryMapped,         // 406
    SharedLibsLinked,     // 408
    EnclaveInitialized,   // 410
    ApplicationRunning,   // 412
}

/// Anjuna Secure Runtime Enclave Descriptor (US 11,714,895 B2).
#[derive(Debug, Clone, Copy)]
pub struct SecureRuntimeEnclave {
    pub enclave_id: u16,
    pub mrenclave: u64,
    pub mrsigner: u64,
    pub seal_key: u64,
    pub wrapped_data_key: u64,
    pub loader_stage: LoaderStage,
    pub app_stack_ptr: u64,
    pub syscall_stack_ptr: u64,
    pub nop11_trampoline_patched: bool,
    pub encrypt_io_active: bool,
    pub syscalls_serviced: u64,
    pub active: bool,
}

impl SecureRuntimeEnclave {
    pub const fn empty() -> Self {
        Self {
            enclave_id: 0,
            mrenclave: 0,
            mrsigner: 0,
            seal_key: 0,
            wrapped_data_key: 0,
            loader_stage: LoaderStage::Uninitialized,
            app_stack_ptr: 0,
            syscall_stack_ptr: 0,
            nop11_trampoline_patched: false,
            encrypt_io_active: false,
            syscalls_serviced: 0,
            active: false,
        }
    }
}

/// EPT Page Permissions enforcing Execute-Only invisibility (US 9,589,132 B2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EptMonitorProtection {
    pub monitor_base: u64,
    pub monitor_size: u64,
    pub ept_readable: bool,    // false => Execute-Only (obscured from scanners)
    pub ept_writable: bool,    // false => Tamper-proof
    pub ept_executable: bool,  // true
    pub iommu_dma_blocked: bool,
    pub ept_violations_trapped: u64,
}

impl EptMonitorProtection {
    pub const fn new() -> Self {
        Self {
            monitor_base: 0xFFFF_8000_0040_0000,
            monitor_size: 0x0001_0000,
            ept_readable: false,
            ept_writable: false,
            ept_executable: true,
            iommu_dma_blocked: true,
            ept_violations_trapped: 0,
        }
    }
}

/// Unified Anjuna Secure Runtime + Barkly Hypervisor MSR Monitor Engine.
pub struct AnjunaBarklyManager {
    // US 11,714,895 B2
    pub enclaves: [SecureRuntimeEnclave; MAX_RUNTIME_ENCLAVES],
    pub common_cluster_key: u64,
    pub total_syscalls_bridged: AtomicU64,
    pub total_io_encrypted_ops: AtomicU64,
    pub stack_switches: AtomicU64,

    // US 9,589,132 B2
    pub active_ia32_lstar: u64,
    pub fake_ia32_lstar: u64,
    pub monitor_entry_point: u64,
    pub ept_protection: EptMonitorProtection,
    pub read_shadow_active: AtomicBool,
    pub write_mask_active: AtomicBool,
    pub trapped_rdmsr_count: AtomicU64,
    pub blocked_wrmsr_count: AtomicU64,
}

impl AnjunaBarklyManager {
    pub const fn new() -> Self {
        Self {
            enclaves: [SecureRuntimeEnclave::empty(); MAX_RUNTIME_ENCLAVES],
            common_cluster_key: 0x9182_7364_5544_3322,
            total_syscalls_bridged: AtomicU64::new(0),
            total_io_encrypted_ops: AtomicU64::new(0),
            stack_switches: AtomicU64::new(0),
            active_ia32_lstar: 0xFFFF_8000_0040_1000, // Points to In-Band Monitor 44
            fake_ia32_lstar: 0xFFFF_8000_0010_0000,   // Original OS Handler 16
            monitor_entry_point: 0xFFFF_8000_0040_1000,
            ept_protection: EptMonitorProtection::new(),
            read_shadow_active: AtomicBool::new(false),
            write_mask_active: AtomicBool::new(false),
            trapped_rdmsr_count: AtomicU64::new(0),
            blocked_wrmsr_count: AtomicU64::new(0),
        }
    }

    pub fn init(&mut self) {
        self.read_shadow_active.store(true, Ordering::Relaxed);
        self.write_mask_active.store(true, Ordering::Relaxed);
        self.active_ia32_lstar = self.monitor_entry_point;

        // Boot Enclave #1 with full 6-stage Secure Application Loader
        let _ = self.launch_secure_enclave(1, 0xAAAA_1111_2222_3333, 0xBBBB_4444_5555_6666);
    }

    /// Execute the 6-Stage Secure Application Loader (US 11,714,895 B2, FIG. 4).
    pub fn launch_secure_enclave(
        &mut self,
        enclave_id: u16,
        mrenclave: u64,
        mrsigner: u64,
    ) -> Result<usize, &'static str> {
        for (idx, enc) in self.enclaves.iter_mut().enumerate() {
            if !enc.active {
                let seal_key = mrenclave ^ 0x5E41_C0DE_0000_0001;
                let wrapped_data_key = self.common_cluster_key ^ seal_key;
                *enc = SecureRuntimeEnclave {
                    enclave_id,
                    mrenclave,
                    mrsigner,
                    seal_key,
                    wrapped_data_key,
                    loader_stage: LoaderStage::ApplicationRunning,
                    app_stack_ptr: 0x7FFF_0000_8000 + (idx as u64) * 0x1_0000,
                    syscall_stack_ptr: 0xFFFF_9000_4000 + (idx as u64) * 0x1_0000,
                    nop11_trampoline_patched: true,
                    encrypt_io_active: true,
                    syscalls_serviced: 0,
                    active: true,
                };
                return Ok(idx);
            }
        }
        Err("Enclave table full")
    }

    /// Patch `SYSCALL` followed by 11 NOP instructions (`0x90`) into inline bridge jump.
    pub fn verify_11_nop_rewrite(&self, code: &[u8]) -> bool {
        // Check for x86_64 `syscall` opcode (0x0F 0x05) followed by 11 NOPs (0x90)
        if code.len() < 13 {
            return false;
        }
        code[0] == 0x0F && code[1] == 0x05 && code[2..13].iter().all(|&b| b == 0x90)
    }

    /// Execute Dual-Stack Syscall via OS Bridge (US 11,714,895 B2, FIG. 5).
    /// 1. Saves original enclave stack, switches to trusted syscall stack.
    /// 2. Encrypts file/socket payload transparently if `encrypt_io_active`.
    /// 3. Switches back to original enclave stack.
    pub fn execute_dual_stack_syscall(
        &mut self,
        enclave_id: u16,
        syscall_nr: u64,
        payload_hash: u64,
    ) -> Result<u64, &'static str> {
        for enc in self.enclaves.iter_mut() {
            if enc.active && enc.enclave_id == enclave_id {
                let saved_rsp = enc.app_stack_ptr;
                // Switch to trusted stack -> execute -> restore saved_rsp
                let _active_rsp = enc.syscall_stack_ptr;
                self.stack_switches.fetch_add(2, Ordering::Relaxed);
                self.total_syscalls_bridged.fetch_add(1, Ordering::Relaxed);
                enc.syscalls_serviced += 1;

                let result = if enc.encrypt_io_active && (syscall_nr == 1 || syscall_nr == 44) {
                    self.total_io_encrypted_ops.fetch_add(1, Ordering::Relaxed);
                    payload_hash ^ (enc.wrapped_data_key ^ enc.seal_key)
                } else {
                    payload_hash
                };

                enc.app_stack_ptr = saved_rsp;
                return Ok(result);
            }
        }
        Err("Unknown enclave ID")
    }

    /// Out-of-Band Hypervisor `RDMSR(IA32_LSTAR)` Trap (US 9,589,132 B2 Read Shadow).
    /// Returns `Fake_IA32LSTAR` so kernel integrity checkers (PatchGuard) see an unaltered OS.
    pub fn trapped_rdmsr_lstar(&self) -> u64 {
        self.trapped_rdmsr_count.fetch_add(1, Ordering::Relaxed);
        if self.read_shadow_active.load(Ordering::Relaxed) {
            self.fake_ia32_lstar
        } else {
            self.active_ia32_lstar
        }
    }

    /// Out-of-Band Hypervisor `WRMSR(IA32_LSTAR)` Trap (US 9,589,132 B2 Write Mask).
    /// Blocks malicious attempts to relocate the syscall monitor handler.
    pub fn trapped_wrmsr_lstar(&mut self, attempted_val: u64) -> bool {
        if self.write_mask_active.load(Ordering::Relaxed) {
            // Update fake shadow instead of tearing down real monitor_entry_point
            self.fake_ia32_lstar = attempted_val;
            self.blocked_wrmsr_count.fetch_add(1, Ordering::Relaxed);
            false // Blocked hardware relocation!
        } else {
            self.active_ia32_lstar = attempted_val;
            true
        }
    }

    /// Simulate EPT Violation check when code-scanner attempts to read Monitor memory.
    pub fn check_ept_read_attempt(&mut self, addr: u64) -> Result<(), &'static str> {
        let base = self.ept_protection.monitor_base;
        let end = base + self.ept_protection.monitor_size;
        if addr >= base && addr < end && !self.ept_protection.ept_readable {
            self.ept_protection.ept_violations_trapped += 1;
            return Err("EPT_VIOLATION: Execute-Only Monitor Page (read blocked)");
        }
        Ok(())
    }

    /// Run self-tests for US 11,714,895 B2 & US 9,589,132 B2.
    pub fn run_self_test(&mut self) -> (bool, &'static str) {
        // Test 1: Verify 11-NOP binary rewrite detection
        let mut snippet = [0x90u8; 13];
        snippet[0] = 0x0F;
        snippet[1] = 0x05;
        if !self.verify_11_nop_rewrite(&snippet) {
            return (false, "11-NOP syscall binary rewrite pattern check failed");
        }

        // Test 2: Launch Enclave #2 and verify dual-stack encrypted syscall + identical cluster key
        if self.launch_secure_enclave(2, 0xAAAA_9999_8888_7777, 0xBBBB_4444_5555_6666).is_err() {
            return (false, "Secure Application Loader failed for Enclave #2");
        }
        let res = self.execute_dual_stack_syscall(2, 1, 0xCAFE_1234);
        let expected = 0xCAFE_1234 ^ self.common_cluster_key;
        if res != Ok(expected) {
            return (false, "Dual-stack OS Bridge key provisioning / encryption mismatch");
        }

        // Test 3: Barkly IA32_LSTAR Read Shadow -> PatchGuard must see Fake_IA32LSTAR
        let shadowed = self.trapped_rdmsr_lstar();
        if shadowed != self.fake_ia32_lstar || shadowed == self.active_ia32_lstar {
            return (false, "IA32_LSTAR Read Shadow exposed active monitor address");
        }

        // Test 4: Barkly WRMSR Write Mask -> Rootkit hijack must be blocked
        let relocated = self.trapped_wrmsr_lstar(0xFFFF_DEAD_0000_1234);
        if relocated || self.active_ia32_lstar != self.monitor_entry_point {
            return (false, "IA32_LSTAR Write Mask failed to block hijack");
        }

        // Test 5: EPT Execute-Only Scanner Defense -> Memory read must fault to hypervisor
        if self.check_ept_read_attempt(self.ept_protection.monitor_base + 0x100).is_ok() {
            return (false, "EPT Execute-Only monitor protection failed to trap scan");
        }

        (true, "US11714895B2 Enclave Runtime & US9589132B2 MSR Shadow/EPT verified")
    }
}

pub static mut ANJUNA_BARKLY_MGR: AnjunaBarklyManager = AnjunaBarklyManager::new();

pub fn init_anjuna_barkly_subsystem() {
    unsafe {
        ANJUNA_BARKLY_MGR.init();
    }
}
