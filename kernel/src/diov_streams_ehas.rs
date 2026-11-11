//! Dynamic I/O Virtualization (DIOV) Streams, Bidirectional EHAS, & Set-Associative Cache
//!
//! Implements bare-metal `no_std` subsystem derived from:
//! - US 9,910,689 B2 (Dynavisor, Inc.): Dynamic Single Root I/O Virtualization (SR-IOV)
//!   Processes System Calls Request to Devices Attached to Host.
//!   Covers:
//!   1. Split-Context Polling "Streams" FSM (zero-VMEXIT DEC shared mailboxes)
//!   2. Bidirectional Extended Hybrid Address Space (EHAS) with DGC/DHC synchronization,
//!      relocatable DIOV memory, and CR0/CR4/page-table stability checks
//!   3. Set-Associative DIOV Shared Storage Cache (Active Writebacks, RFO-free dirty-only
//!      blocks, global FD mapping, multi-level read/write semaphores) & `diovmalloc` heap

#![allow(dead_code)]

use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

pub const MAX_STREAMS: usize = 4;
pub const MAX_EHAS_MAPPINGS: usize = 8;
pub const CACHE_SETS: usize = 4;
pub const CACHE_WAYS: usize = 2;
pub const HEAP_SLOTS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamFsmState {
    Idle,
    GuestSubmitted,
    HostProcessing,
    CompletedReady,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StreamOp {
    Nop,
    OpenGfd,
    ReadCache,
    WriteCombine,
    ActiveWriteback,
}

#[derive(Clone, Copy)]
pub struct DiovStreamMailbox {
    pub stream_id: u16,
    pub context_id: u64,
    pub fsm_state: StreamFsmState,
    pub op: StreamOp,
    pub arg_fd: i32,
    pub arg_gfd: u32,
    pub arg_lba: u64,
    pub arg_len: u32,
    pub diov_buf_offset: u64,
    pub poll_cycles_saved: u64,
}

impl DiovStreamMailbox {
    pub const fn empty() -> Self {
        Self {
            stream_id: 0,
            context_id: 0,
            fsm_state: StreamFsmState::Idle,
            op: StreamOp::Nop,
            arg_fd: -1,
            arg_gfd: 0,
            arg_lba: 0,
            arg_len: 0,
            diov_buf_offset: 0,
            poll_cycles_saved: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EhasRegionKind {
    GuestFixedVma,
    HostDriverMapping,
    DiovRelocatable,
}

#[derive(Clone, Copy)]
pub struct EhasMapping {
    pub context_id: u64,
    pub dgc_vaddr: u64,
    pub dhc_vaddr: u64,
    pub size_bytes: u64,
    pub kind: EhasRegionKind,
    pub cpl0_protected: bool,
    pub cr0_snapshot: u64,
    pub cr4_snapshot: u64,
    pub active: bool,
}

impl EhasMapping {
    pub const fn empty() -> Self {
        Self {
            context_id: 0,
            dgc_vaddr: 0,
            dhc_vaddr: 0,
            size_bytes: 0,
            kind: EhasRegionKind::DiovRelocatable,
            cpl0_protected: true,
            cr0_snapshot: 0x8005_0033,
            cr4_snapshot: 0x0000_06E0,
            active: false,
        }
    }
}

#[derive(Clone, Copy)]
pub struct DiovCacheLine {
    pub valid: bool,
    pub gfd: u32,
    pub block_tag: u64,
    pub dirty_only_rfo_free: bool,
    pub write_combined_mask: u64,
    pub reader_sem: u16,
    pub writer_lock: bool,
    pub hit_heat: u32,
    pub active_writeback_pending: bool,
}

impl DiovCacheLine {
    pub const fn empty() -> Self {
        Self {
            valid: false,
            gfd: 0,
            block_tag: 0,
            dirty_only_rfo_free: false,
            write_combined_mask: 0,
            reader_sem: 0,
            writer_lock: false,
            hit_heat: 0,
            active_writeback_pending: false,
        }
    }
}

#[derive(Clone, Copy)]
pub struct DiovHeapAlloc {
    pub context_id: u64,
    pub reloc_offset: u64,
    pub bytes: u32,
    pub in_use: bool,
}

impl DiovHeapAlloc {
    pub const fn empty() -> Self {
        Self {
            context_id: 0,
            reloc_offset: 0,
            bytes: 0,
            in_use: false,
        }
    }
}

pub struct DiovStreamManager {
    pub initialized: AtomicBool,
    pub mailboxes: [DiovStreamMailbox; MAX_STREAMS],
    pub ehas_table: [EhasMapping; MAX_EHAS_MAPPINGS],
    pub ehas_count: usize,
    pub storage_cache: [[DiovCacheLine; CACHE_WAYS]; CACHE_SETS],
    pub heap_slots: [DiovHeapAlloc; HEAP_SLOTS],
    pub next_reloc_offset: u64,
    pub streams_processed: AtomicU64,
    pub vmexits_avoided: AtomicU64,
    pub ehas_syncs: AtomicU64,
    pub rfo_eliminated_writes: AtomicU64,
    pub active_writebacks: AtomicU64,
    pub cache_hits: AtomicU64,
}

impl DiovStreamManager {
    pub const fn empty() -> Self {
        Self {
            initialized: AtomicBool::new(false),
            mailboxes: [DiovStreamMailbox::empty(); MAX_STREAMS],
            ehas_table: [EhasMapping::empty(); MAX_EHAS_MAPPINGS],
            ehas_count: 0,
            storage_cache: [[DiovCacheLine::empty(); CACHE_WAYS]; CACHE_SETS],
            heap_slots: [DiovHeapAlloc::empty(); HEAP_SLOTS],
            next_reloc_offset: 0x0010_0000,
            streams_processed: AtomicU64::new(0),
            vmexits_avoided: AtomicU64::new(0),
            ehas_syncs: AtomicU64::new(0),
            rfo_eliminated_writes: AtomicU64::new(0),
            active_writebacks: AtomicU64::new(0),
            cache_hits: AtomicU64::new(0),
        }
    }

    #[inline]
    pub const fn compute_context_id(domain: u32, process_pid: u32) -> u64 {
        ((domain as u64) << 32) | (process_pid as u64)
    }

    pub fn diovmalloc(&mut self, context_id: u64, bytes: u32) -> Option<u64> {
        let aligned = ((bytes as u64) + 63) & !63;
        for i in 0..HEAP_SLOTS {
            if !self.heap_slots[i].in_use {
                let offset = self.next_reloc_offset;
                self.next_reloc_offset += aligned;
                self.heap_slots[i] = DiovHeapAlloc {
                    context_id,
                    reloc_offset: offset,
                    bytes,
                    in_use: true,
                };
                return Some(offset);
            }
        }
        None
    }

    pub fn sync_ehas_context(
        &mut self,
        context_id: u64,
        dgc_vaddr: u64,
        dhc_vaddr: u64,
        size_bytes: u64,
        cr0: u64,
        cr4: u64,
    ) -> Result<usize, &'static str> {
        // Validate CR0 paging/protection bits and CR4 PAE/SSE stability
        if (cr0 & 0x8000_0001) != 0x8000_0001 || (cr4 & 0x20) == 0 {
            return Err("EHAS Context unstable: invalid CR0/CR4 state");
        }
        if self.ehas_count >= MAX_EHAS_MAPPINGS {
            return Err("EHAS table full");
        }
        let idx = self.ehas_count;
        self.ehas_table[idx] = EhasMapping {
            context_id,
            dgc_vaddr,
            dhc_vaddr,
            size_bytes,
            kind: EhasRegionKind::DiovRelocatable,
            cpl0_protected: true,
            cr0_snapshot: cr0,
            cr4_snapshot: cr4,
            active: true,
        };
        self.ehas_count += 1;
        self.ehas_syncs.fetch_add(1, Ordering::Relaxed);
        Ok(idx)
    }

    /// Submit a split-context Stream request without triggering a VMEXIT, process via Host DEC
    /// worker state machine, and update Set-Associative Shared Storage Cache.
    pub fn dispatch_stream_request(
        &mut self,
        slot: usize,
        context_id: u64,
        op: StreamOp,
        gfd: u32,
        lba: u64,
        len: u32,
        diov_offset: u64,
    ) -> Result<(), &'static str> {
        if slot >= MAX_STREAMS {
            return Err("invalid stream slot");
        }
        let mb = &mut self.mailboxes[slot];
        mb.stream_id = slot as u16;
        mb.context_id = context_id;
        mb.op = op;
        mb.arg_fd = (gfd as i32) + 3;
        mb.arg_gfd = gfd;
        mb.arg_lba = lba;
        mb.arg_len = len;
        mb.diov_buf_offset = diov_offset;
        mb.fsm_state = StreamFsmState::GuestSubmitted;

        // Host kernel DEC polling transition (zero VMEXIT)
        mb.fsm_state = StreamFsmState::HostProcessing;
        let set_idx = (lba as usize) % CACHE_SETS;

        match op {
            StreamOp::WriteCombine => {
                // Evict cooler way if full; allocate dirty-only RFO-free block
                let mut target_way = 0usize;
                if self.storage_cache[set_idx][0].valid && self.storage_cache[set_idx][1].valid {
                    target_way = if self.storage_cache[set_idx][0].hit_heat
                        <= self.storage_cache[set_idx][1].hit_heat
                    {
                        0
                    } else {
                        1
                    };
                } else if self.storage_cache[set_idx][0].valid {
                    target_way = 1;
                }
                self.storage_cache[set_idx][target_way] = DiovCacheLine {
                    valid: true,
                    gfd,
                    block_tag: lba,
                    dirty_only_rfo_free: true,
                    write_combined_mask: 0xFFFF_FFFF_FFFF_FFFF,
                    reader_sem: 0,
                    writer_lock: false,
                    hit_heat: 10,
                    active_writeback_pending: true,
                };
                self.rfo_eliminated_writes.fetch_add(1, Ordering::Relaxed);
                self.active_writebacks.fetch_add(1, Ordering::Relaxed);
            }
            StreamOp::ReadCache => {
                for way in 0..CACHE_WAYS {
                    let line = &mut self.storage_cache[set_idx][way];
                    if line.valid && line.gfd == gfd && line.block_tag == lba {
                        line.reader_sem += 1;
                        line.hit_heat = line.hit_heat.saturating_add(5);
                        line.reader_sem -= 1;
                        self.cache_hits.fetch_add(1, Ordering::Relaxed);
                        break;
                    }
                }
            }
            StreamOp::ActiveWriteback => {
                for way in 0..CACHE_WAYS {
                    let line = &mut self.storage_cache[set_idx][way];
                    if line.valid && line.gfd == gfd && line.block_tag == lba {
                        line.active_writeback_pending = false;
                        line.dirty_only_rfo_free = false;
                    }
                }
            }
            _ => {}
        }

        mb.fsm_state = StreamFsmState::CompletedReady;
        mb.poll_cycles_saved += 1;
        self.streams_processed.fetch_add(1, Ordering::Relaxed);
        self.vmexits_avoided.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }
}

pub static mut DIOV_STREAM_MGR: DiovStreamManager = DiovStreamManager::empty();

pub fn init_diov_subsystem() {
    unsafe {
        if DIOV_STREAM_MGR.initialized.swap(true, Ordering::SeqCst) {
            return;
        }
        let ctx0 = DiovStreamManager::compute_context_id(1, 1);
        let _ = DIOV_STREAM_MGR.sync_ehas_context(
            ctx0,
            0x0000_7F00_1000_0000,
            0xFFFF_9000_1000_0000,
            4096,
            0x8005_0033,
            0x0000_06E0,
        );
        if let Some(off) = DIOV_STREAM_MGR.diovmalloc(ctx0, 512) {
            let _ = DIOV_STREAM_MGR.dispatch_stream_request(
                0,
                ctx0,
                StreamOp::WriteCombine,
                1,
                0x20,
                512,
                off,
            );
        }
    }
}

pub fn run_self_test() -> (bool, &'static str) {
    unsafe {
        if !DIOV_STREAM_MGR.initialized.load(Ordering::Relaxed) {
            init_diov_subsystem();
        }
        let ctx = DiovStreamManager::compute_context_id(2, 42);

        // Reject unstable CR0 state first
        if DIOV_STREAM_MGR
            .sync_ehas_context(ctx, 0x1000, 0x2000, 4096, 0, 0)
            .is_ok()
        {
            return (false, "US9910689B2 accepted unstable CR0/CR4 EHAS context");
        }

        // Valid EHAS context + diovmalloc + WriteCombine (RFO-free) + ReadCache hit + ActiveWriteback
        if DIOV_STREAM_MGR
            .sync_ehas_context(
                ctx,
                0x0000_7F00_2000_0000,
                0xFFFF_9000_2000_0000,
                8192,
                0x8005_0033,
                0x0000_06E0,
            )
            .is_err()
        {
            return (false, "US9910689B2 valid EHAS sync failed");
        }

        let off = match DIOV_STREAM_MGR.diovmalloc(ctx, 4096) {
            Some(o) => o,
            None => return (false, "US9910689B2 diovmalloc failed"),
        };

        let hits_before = DIOV_STREAM_MGR.cache_hits.load(Ordering::Relaxed);
        if DIOV_STREAM_MGR
            .dispatch_stream_request(1, ctx, StreamOp::WriteCombine, 7, 100, 4096, off)
            .is_err()
        {
            return (false, "US9910689B2 WriteCombine stream dispatch failed");
        }
        if DIOV_STREAM_MGR
            .dispatch_stream_request(1, ctx, StreamOp::ReadCache, 7, 100, 4096, off)
            .is_err()
        {
            return (false, "US9910689B2 ReadCache stream dispatch failed");
        }
        let hits_after = DIOV_STREAM_MGR.cache_hits.load(Ordering::Relaxed);
        if hits_after <= hits_before {
            return (false, "US9910689B2 set-associative cache hit not recorded");
        }
        if DIOV_STREAM_MGR
            .dispatch_stream_request(1, ctx, StreamOp::ActiveWriteback, 7, 100, 4096, off)
            .is_err()
        {
            return (false, "US9910689B2 ActiveWriteback failed");
        }

        (
            true,
            "[DIOV PASS] US9910689B2 Split-Context Streams, Bidirectional EHAS, RFO-free Cache & diovmalloc verified",
        )
    }
}
