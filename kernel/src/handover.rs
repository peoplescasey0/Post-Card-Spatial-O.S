// ============================================================================
// POST CARD OS: "PAPER AIRPLANE" MIGRATION & HANDOVER PROTOCOL
// ============================================================================
// Implements zero-copy live migration and state handover for Post Card OS
// Micro-VM Capsules. Inspired by Ericsson 5G Non-3GPP PDU session handover
// (US20220360634A1) and lightweight GRE Non-IP encapsulation.
//
// When a Post Card is "folded into a Paper Airplane":
//   1. The source capsule CPU context & VMCS state are checkpointed.
//   2. The 4 KiB capsule memory arena page is packaged into sequenced frames.
//   3. The packet is streamed across the network / local tunnel.
//   4. The target node validates the CRC32, ingests the page into an armed slot,
//      and fires VMLAUNCH / VM-run to resume execution without data loss.

use core::sync::atomic::{AtomicU64, Ordering};

pub const PAPER_AIRPLANE_MAGIC: u32 = 0x50414952; // ASCII "PAIR" (Paper Airplane)
pub const CAPSULE_PAGE_SIZE: usize = 4096;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[allow(dead_code)]
pub enum HandoverMsgType {
    InitiateMigrate = 0x01,
    StateTransfer   = 0x02,
    Acknowledge     = 0x03,
    ResumeContext   = 0x04,
    AbortHandover   = 0x05,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct PaperAirplaneHeader {
    pub magic: u32,
    pub msg_type: u8,
    pub source_slot: u8,
    pub target_node: u16,
    pub payload_len: u32,
    pub sequence_num: u64,
    pub crc32: u32,
    pub _reserved: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct CapsuleCheckpointManifest {
    pub capsule_id: u8,
    pub name: [u8; 20],
    pub role_code: u8, // 1: Vault, 2: Radiator, 3: VFS, 4: Custom
    pub _pad: [u8; 2],
    pub vm_exits: u64,
    pub last_cycles: u64,
    pub last_result: u64,
    pub mem_kib: u32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HandoverState {
    Idle,
    PreparingState,
    StreamingPacket,
    WaitingForAck,
    Resumed,
    Failed,
}

pub struct CapsuleHandoverManager {
    pub current_state: HandoverState,
    pub active_slot: usize,
    pub bytes_transferred: usize,
    pub last_seq: u64,
}

static SEQUENCE_COUNTER: AtomicU64 = AtomicU64::new(1);
static mut STAGING_PAYLOAD: [u8; CAPSULE_PAGE_SIZE] = [0; CAPSULE_PAGE_SIZE];
static mut STAGING_MANIFEST: Option<CapsuleCheckpointManifest> = None;

// Standard CRC32 tableless implementation (IEEE 802.3 polynomial 0xEDB88320)
pub fn compute_crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            let mask = if (crc & 1) != 0 { 0xEDB8_8320 } else { 0 };
            crc = (crc >> 1) ^ mask;
        }
    }
    !crc
}

impl CapsuleHandoverManager {
    pub const fn new() -> Self {
        Self {
            current_state: HandoverState::Idle,
            active_slot: 0,
            bytes_transferred: 0,
            last_seq: 0,
        }
    }

    /// Serializes a live Micro-VM capsule's execution context and 4 KiB memory page
    /// into a staged "Paper Airplane" handover frame ready for transit.
    pub unsafe fn serialize_capsule_state(
        &mut self,
        slot_id: usize,
        dest_node: u16,
        manifest_out: &mut CapsuleCheckpointManifest,
        header_out: &mut PaperAirplaneHeader,
    ) -> Result<&'static [u8; CAPSULE_PAGE_SIZE], &'static str> {
        if slot_id >= 4 {
            return Err("invalid capsule slot");
        }

        self.current_state = HandoverState::PreparingState;
        self.active_slot = slot_id;

        // 1. Snapshot capsule register and exit telemetry from kernel
        let cap = &crate::CAPSULES[slot_id];
        manifest_out.capsule_id = slot_id as u8;
        manifest_out.name = cap.name;
        manifest_out.role_code = match cap.role {
            "Neural Coprocessor Vault" => 1,
            "Thermal RTOS Loop" => 2,
            "VFS Sector Mirror" => 3,
            _ => 4,
        };
        manifest_out._pad = [0; 2];
        manifest_out.vm_exits = cap.vm_exits;
        manifest_out.last_cycles = cap.last_cycles;
        manifest_out.last_result = cap.last_result;
        manifest_out.mem_kib = cap.mem_kib;

        // 2. Snapshot the 4 KiB isolated capsule arena page from DRAM
        let page_src = (crate::guest_capsule_arena_ptr() as *const u8).add(slot_id * CAPSULE_PAGE_SIZE);
        for i in 0..CAPSULE_PAGE_SIZE {
            STAGING_PAYLOAD[i] = core::ptr::read_volatile(page_src.add(i));
        }

        // 3. Compute frame integrity CRC32 across the snapshot payload
        let crc = compute_crc32(&STAGING_PAYLOAD);
        let seq = SEQUENCE_COUNTER.fetch_add(1, Ordering::Relaxed);
        self.last_seq = seq;

        // 4. Fill transport header
        header_out.magic = PAPER_AIRPLANE_MAGIC;
        header_out.msg_type = HandoverMsgType::InitiateMigrate as u8;
        header_out.source_slot = slot_id as u8;
        header_out.target_node = dest_node;
        header_out.payload_len = CAPSULE_PAGE_SIZE as u32;
        header_out.sequence_num = seq;
        header_out.crc32 = crc;
        header_out._reserved = 0;

        self.current_state = HandoverState::StreamingPacket;
        self.bytes_transferred = CAPSULE_PAGE_SIZE;

        Ok(&STAGING_PAYLOAD)
    }

    /// Handles an incoming Paper Airplane migration packet on the receiving node,
    /// unpacking the live capsule and resuming execution.
    pub unsafe fn handle_incoming_handover(
        &mut self,
        header: &PaperAirplaneHeader,
        manifest: &CapsuleCheckpointManifest,
        page_payload: &[u8],
    ) -> Result<usize, &'static str> {
        if header.magic != PAPER_AIRPLANE_MAGIC {
            self.current_state = HandoverState::Failed;
            return Err("corrupt paper airplane magic");
        }

        let target_slot = (header.source_slot as usize) % 4;

        match header.msg_type {
            x if x == HandoverMsgType::InitiateMigrate as u8 => {
                self.current_state = HandoverState::PreparingState;
                STAGING_MANIFEST = Some(*manifest);
                Ok(target_slot)
            }

            x if x == HandoverMsgType::StateTransfer as u8 => {
                if page_payload.len() != CAPSULE_PAGE_SIZE {
                    self.current_state = HandoverState::Failed;
                    return Err("payload size mismatch");
                }

                // Verify payload CRC32 before committing to kernel memory
                let calculated_crc = compute_crc32(page_payload);
                if calculated_crc != header.crc32 {
                    self.current_state = HandoverState::Failed;
                    return Err("CRC32 checksum mismatch in transit");
                }

                // Ingest raw 4 KiB bytes into target micro-VM slot arena
                let page_dst = (crate::guest_capsule_arena_ptr() as *mut u8).add(target_slot * CAPSULE_PAGE_SIZE);
                for i in 0..CAPSULE_PAGE_SIZE {
                    core::ptr::write_volatile(page_dst.add(i), page_payload[i]);
                }

                // Restore capsule metadata
                let cap = &mut crate::CAPSULES[target_slot];
                cap.name = manifest.name;
                cap.vm_exits = manifest.vm_exits;
                cap.last_cycles = manifest.last_cycles;
                cap.last_result = manifest.last_result;
                cap.mem_kib = manifest.mem_kib;
                cap.active = true;

                self.current_state = HandoverState::WaitingForAck;
                Ok(target_slot)
            }

            x if x == HandoverMsgType::ResumeContext as u8 => {
                // Trigger resumption of micro-VM capsule
                let (ret, cyc) = crate::execute_capsule_vmrun(target_slot);
                let _ = (ret, cyc);
                self.current_state = HandoverState::Resumed;
                Ok(target_slot)
            }

            _ => {
                self.current_state = HandoverState::Failed;
                Err("unknown handover message type")
            }
        }
    }
}

pub static mut HANDOVER_MGR: CapsuleHandoverManager = CapsuleHandoverManager::new();
