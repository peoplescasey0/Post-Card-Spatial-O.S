//! Inter-Kernel Shared Local Memory (SLM) Sharing & Neural Layer Handoff
//!
//! Implements bare-metal `no_std` subsystem derived from:
//! - CN 113490917 A (Intel Corp.): Local Memory Sharing Between Kernels.
//!   Manages on-chip Shared Local Memory (SLM) across parallel processor engine partitions:
//!   - Tracks kernel dependency lists (`dep_mask`) and threadgroup thread counts.
//!   - Bypasses SLM flush/clear when sequential/concurrent dependent kernels share identical
//!     thread counts, allowing neural network layers (Layer N -> Layer N+1) to pass
//!     activations in an overlapping SLM region instead of spilling to global DRAM.
//!   - Enforces isolation and performs mandatory SLM clear before dispatching independent
//!     kernels or kernels with mismatched threadgroup dimensions.

#![allow(dead_code)]

use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

pub const MAX_KERNELS: usize = 8;
pub const SLM_WORDS: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SlmAction {
    FlushAndClear,
    BypassFlushShare,
    BlockedIsolation,
}

#[derive(Clone, Copy)]
pub struct KernelDescriptor {
    pub kernel_id: u16,
    pub thread_count: u16,
    pub dep_mask: u32, // Bitmask of upstream kernel_ids depended upon
    pub slm_offset: u16,
    pub slm_len: u16,
    pub executed: bool,
    pub active: bool,
}

impl KernelDescriptor {
    pub const fn empty() -> Self {
        Self {
            kernel_id: 0,
            thread_count: 0,
            dep_mask: 0,
            slm_offset: 0,
            slm_len: 0,
            executed: false,
            active: false,
        }
    }
}

pub struct SlmPartitionManager {
    pub initialized: AtomicBool,
    pub slm_bank: [u64; SLM_WORDS],
    pub owner_mask: u32,
    pub active_thread_count: u16,
    pub kernels: [KernelDescriptor; MAX_KERNELS],
    pub kernel_count: usize,
    pub flushes_bypassed: AtomicU64,
    pub flushes_enforced: AtomicU64,
    pub isolation_blocks: AtomicU64,
    pub nn_layer_handoffs: AtomicU64,
    pub dram_bytes_saved: AtomicU64,
}

impl SlmPartitionManager {
    pub const fn empty() -> Self {
        Self {
            initialized: AtomicBool::new(false),
            slm_bank: [0u64; SLM_WORDS],
            owner_mask: 0,
            active_thread_count: 0,
            kernels: [KernelDescriptor::empty(); MAX_KERNELS],
            kernel_count: 0,
            flushes_bypassed: AtomicU64::new(0),
            flushes_enforced: AtomicU64::new(0),
            isolation_blocks: AtomicU64::new(0),
            nn_layer_handoffs: AtomicU64::new(0),
            dram_bytes_saved: AtomicU64::new(0),
        }
    }

    pub fn flush_slm(&mut self) {
        for w in self.slm_bank.iter_mut() {
            *w = 0;
        }
        self.owner_mask = 0;
        self.flushes_enforced.fetch_add(1, Ordering::Relaxed);
    }

    /// Schedule and execute a kernel on the Engine Block Partition.
    /// Bypasses SLM flush when `dep_mask` intersects `owner_mask` and `thread_count` matches.
    pub fn schedule_kernel(
        &mut self,
        kernel_id: u16,
        thread_count: u16,
        dep_mask: u32,
        slm_offset: u16,
        slm_len: u16,
        seed_or_bias: u64,
    ) -> SlmAction {
        let off = (slm_offset as usize).min(SLM_WORDS);
        let end = (off + (slm_len as usize)).min(SLM_WORDS);

        let shares_dep = self.owner_mask != 0 && (dep_mask & self.owner_mask) != 0;
        let thread_match = self.active_thread_count == thread_count;

        let action = if shares_dep && thread_match {
            // Dependent kernel with matching threadgroup geometry: reuse SLM overlapping region!
            self.flushes_bypassed.fetch_add(1, Ordering::Relaxed);
            self.nn_layer_handoffs.fetch_add(1, Ordering::Relaxed);
            self.dram_bytes_saved
                .fetch_add(((end - off) * 8) as u64, Ordering::Relaxed);
            for idx in off..end {
                // Consume upstream kernel activations in-place & compute next layer output
                self.slm_bank[idx] = self.slm_bank[idx].wrapping_add(seed_or_bias);
            }
            self.owner_mask |= 1u32 << (kernel_id & 31);
            SlmAction::BypassFlushShare
        } else {
            // Independent kernel or thread-count mismatch: must enforce isolation & clear SLM first
            if self.owner_mask != 0 && dep_mask == 0 {
                self.isolation_blocks.fetch_add(1, Ordering::Relaxed);
            }
            self.flush_slm();
            self.active_thread_count = thread_count;
            for idx in off..end {
                self.slm_bank[idx] = seed_or_bias ^ (idx as u64);
            }
            self.owner_mask = 1u32 << (kernel_id & 31);
            SlmAction::FlushAndClear
        };

        let slot = self.kernel_count % MAX_KERNELS;
        self.kernels[slot] = KernelDescriptor {
            kernel_id,
            thread_count,
            dep_mask,
            slm_offset,
            slm_len,
            executed: true,
            active: true,
        };
        self.kernel_count += 1;
        action
    }

    /// Enforce explicit read access guard for a kernel attempting to read another region's SLM.
    pub fn check_slm_read_access(&mut self, kernel_dep_mask: u32) -> bool {
        if self.owner_mask == 0 || (kernel_dep_mask & self.owner_mask) != 0 {
            true
        } else {
            self.isolation_blocks.fetch_add(1, Ordering::Relaxed);
            false
        }
    }
}

pub static mut SLM_SHARE_MGR: SlmPartitionManager = SlmPartitionManager::empty();

pub fn init_slm_share_subsystem() {
    unsafe {
        if SLM_SHARE_MGR.initialized.swap(true, Ordering::SeqCst) {
            return;
        }
        // Seed Kernel #0 (NN Layer 0) -> Kernel #1 (NN Layer 1, dep={0}) sharing 256 threads
        let _ = SLM_SHARE_MGR.schedule_kernel(0, 256, 0, 0, 16, 100);
        let _ = SLM_SHARE_MGR.schedule_kernel(1, 256, 1 << 0, 0, 16, 25);
    }
}

pub fn run_self_test() -> (bool, &'static str) {
    unsafe {
        if !SLM_SHARE_MGR.initialized.load(Ordering::Relaxed) {
            init_slm_share_subsystem();
        }

        // 1. Fresh pipeline: Kernel #0 (NN Layer 0, 256 threads) -> Kernel #1 (dep={0}) -> Kernel #2 (dep={0,1})
        let a0 = SLM_SHARE_MGR.schedule_kernel(0, 256, 0, 0, 8, 10);
        if a0 != SlmAction::FlushAndClear {
            return (false, "CN113490917A Kernel #0 did not initialize clean SLM");
        }
        let val_after_k0 = SLM_SHARE_MGR.slm_bank[0];

        let a1 = SLM_SHARE_MGR.schedule_kernel(1, 256, 1 << 0, 0, 8, 5);
        if a1 != SlmAction::BypassFlushShare || SLM_SHARE_MGR.slm_bank[0] != val_after_k0 + 5 {
            return (false, "CN113490917A dependent Kernel #1 failed in-place SLM handoff");
        }

        let a2 = SLM_SHARE_MGR.schedule_kernel(2, 256, (1 << 0) | (1 << 1), 0, 8, 7);
        if a2 != SlmAction::BypassFlushShare || SLM_SHARE_MGR.slm_bank[0] != val_after_k0 + 12 {
            return (false, "CN113490917A dependent Kernel #2 failed multi-dep SLM reuse");
        }

        // 2. Verify independent kernel cannot read unowned SLM region without clear
        if SLM_SHARE_MGR.check_slm_read_access(0) {
            return (false, "CN113490917A independent kernel allowed raw SLM read");
        }

        // 3. Mismatched thread count (128 != 256) even with dep={2} must trigger FlushAndClear
        let a3 = SLM_SHARE_MGR.schedule_kernel(3, 128, 1 << 2, 0, 8, 99);
        if a3 != SlmAction::FlushAndClear {
            return (false, "CN113490917A thread-count mismatch failed to force SLM flush");
        }

        (
            true,
            "[SLMSHARE PASS] CN113490917A Inter-Kernel SLM Bypass, NN Layer Reuse & Mismatch Flush verified",
        )
    }
}
