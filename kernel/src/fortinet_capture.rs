//! # Fortinet Kernel-Space Packet Capture & EOS Engine (US 11,870,693 B2)
//!
//! Kernel Space Based Capture Using Intelligent Packet Selection Paradigm
//! and Event Output Storage (EOS) Determination Methodology.
//! Extracts fixed 78-byte TCP/UDP header prefixes in eBPF/XDP kernel space,
//! enforces intelligent packet dropping, and benchmarks EOS storage protocols
//! (Pragma OMP, MSPSC lockless ring buffer, MPSC queue) with accuracy ratio tracking.

#![allow(dead_code)]

pub const CAPTURE_HEADER_LEN: usize = 78;
pub const EOS_RING_CAPACITY: usize = 16;

/// Event Output Storage (EOS) Protocol Selection (US 11,870,693 B2 Col. 7 & Fig. 11)
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum EosProtocolType {
    PragmaOmp,          // Default atomic ring buffer
    MspscLocklessRing,  // Multi-Producer Single-Consumer lockless queue (best for >= 4 cores)
    MpscQueue,          // Multi-Producer Single-Consumer queue (best for <= 4 cores)
}

pub fn eos_proto_str(p: EosProtocolType) -> &'static str {
    match p {
        EosProtocolType::PragmaOmp => "PRAGMA_OMP",
        EosProtocolType::MspscLocklessRing => "MSPSC_LOCKLESS_RING",
        EosProtocolType::MpscQueue => "MPSC_QUEUE",
    }
}

/// A captured 78-byte packet header event entry (Ethernet 14B + IP 20B + TCP/UDP 20B + Options 24B)
#[derive(Copy, Clone, Debug)]
pub struct CapturedPacketEvent {
    pub slot_id: u32,
    pub timestamp_ticks: u64,
    pub eth_proto: u16,
    pub ip_proto: u8,
    pub src_ip: [u8; 4],
    pub dst_ip: [u8; 4],
    pub src_port: u16,
    pub dst_port: u16,
    pub header_bytes: [u8; CAPTURE_HEADER_LEN],
    pub valid: bool,
}

impl CapturedPacketEvent {
    pub const fn empty() -> Self {
        Self {
            slot_id: 0,
            timestamp_ticks: 0,
            eth_proto: 0,
            ip_proto: 0,
            src_ip: [0; 4],
            dst_ip: [0; 4],
            src_port: 0,
            dst_port: 0,
            header_bytes: [0; CAPTURE_HEADER_LEN],
            valid: false,
        }
    }
}

/// Fortinet Intelligent Packet Capture Subsystem
pub struct FortinetCaptureEngine {
    pub active_eos_protocol: EosProtocolType,
    pub allocated_cores: u32,
    pub ring_buffer: [CapturedPacketEvent; EOS_RING_CAPACITY],
    pub ring_head: usize,
    pub ring_tail: usize,
    pub total_rx_packets: u64,
    pub total_destined_local_passed: u64,
    pub total_useful_captured: u64,
    pub total_junk_dropped: u64,
    pub total_eos_stored_correctly: u64,
    pub total_eos_lost_events: u64,
}

impl FortinetCaptureEngine {
    pub const fn new() -> Self {
        Self {
            active_eos_protocol: EosProtocolType::MspscLocklessRing,
            allocated_cores: 4,
            ring_buffer: [
                CapturedPacketEvent::empty(), CapturedPacketEvent::empty(), CapturedPacketEvent::empty(), CapturedPacketEvent::empty(),
                CapturedPacketEvent::empty(), CapturedPacketEvent::empty(), CapturedPacketEvent::empty(), CapturedPacketEvent::empty(),
                CapturedPacketEvent::empty(), CapturedPacketEvent::empty(), CapturedPacketEvent::empty(), CapturedPacketEvent::empty(),
                CapturedPacketEvent::empty(), CapturedPacketEvent::empty(), CapturedPacketEvent::empty(), CapturedPacketEvent::empty(),
            ],
            ring_head: 0,
            ring_tail: 0,
            total_rx_packets: 0,
            total_destined_local_passed: 0,
            total_useful_captured: 0,
            total_junk_dropped: 0,
            total_eos_stored_correctly: 0,
            total_eos_lost_events: 0,
        }
    }

    /// Evaluates incoming packet in kernel space according to Fig. 3 / Fig. 4:
    /// 1. Is packet destined to local processing device? -> Pass to upper layer
    /// 2. Is packet useful for IoT / telemetry classification (TCP/UDP)? -> Extract 78B header and store in EOS
    /// 3. Otherwise -> Drop in kernel space (XDP_DROP)
    pub fn process_packet_xdp_filter(
        &mut self,
        is_local_destined: bool,
        is_tcp_or_udp: bool,
        src_ip: [u8; 4],
        dst_ip: [u8; 4],
        src_port: u16,
        dst_port: u16,
    ) -> (&'static str, u32) {
        self.total_rx_packets = self.total_rx_packets.saturating_add(1);

        if is_local_destined {
            self.total_destined_local_passed = self.total_destined_local_passed.saturating_add(1);
            return ("XDP_PASS: Destined for local host stack", 0);
        }

        if !is_tcp_or_udp {
            // Intelligent packet drop in kernel space (prevents CPU saturation at 10M pkts/sec)
            self.total_junk_dropped = self.total_junk_dropped.saturating_add(1);
            return ("XDP_DROP: Non-telemetry background junk pruned in kernel space", 0);
        }

        // Useful for classification: Extract first 78 bytes and push to EOS storage
        self.total_useful_captured = self.total_useful_captured.saturating_add(1);
        let next_tail = (self.ring_tail + 1) % EOS_RING_CAPACITY;

        if next_tail == self.ring_head {
            // Ring buffer full -> EOS event loss
            self.total_eos_lost_events = self.total_eos_lost_events.saturating_add(1);
            return ("EOS_OVERFLOW: Ring buffer full, event dropped", 0);
        }

        let slot = &mut self.ring_buffer[self.ring_tail];
        slot.slot_id = self.ring_tail as u32;
        slot.eth_proto = 0x0800; // IPv4
        slot.ip_proto = 6;      // TCP
        slot.src_ip = src_ip;
        slot.dst_ip = dst_ip;
        slot.src_port = src_port;
        slot.dst_port = dst_port;
        slot.valid = true;

        // Populate simulated 78-byte wire header
        slot.header_bytes[0..6].copy_from_slice(&[0x52, 0x54, 0x00, 0xAA, 0xBB, 0xCC]);
        slot.header_bytes[6..12].copy_from_slice(&[0x52, 0x54, 0x00, 0x11, 0x22, 0x33]);
        slot.header_bytes[12..14].copy_from_slice(&[0x08, 0x00]);
        slot.header_bytes[14] = 0x45; // IPv4, IHL=5
        slot.header_bytes[23] = 6;    // TCP
        slot.header_bytes[26..30].copy_from_slice(&src_ip);
        slot.header_bytes[30..34].copy_from_slice(&dst_ip);
        slot.header_bytes[34..36].copy_from_slice(&src_port.to_be_bytes());
        slot.header_bytes[36..38].copy_from_slice(&dst_port.to_be_bytes());

        self.ring_tail = next_tail;
        self.total_eos_stored_correctly = self.total_eos_stored_correctly.saturating_add(1);

        ("XDP_CAPTURE_78B: Ingested to Event Output Storage (EOS)", CAPTURE_HEADER_LEN as u32)
    }

    /// Evaluates EOS performance and calculates accuracy metric (US 11,870,693 B2 Fig. 10 & 11)
    pub fn test_eos_performance(&mut self, test_packets: u32) -> (u32, EosProtocolType, &'static str) {
        let mut stored: u32 = 0;
        let loss_threshold_pct = 5;

        for i in 0..test_packets {
            let src = [192, 168, 1, (i % 250) as u8];
            let dst = [10, 0, 2, 15];
            let (_, len) = self.process_packet_xdp_filter(false, true, src, dst, 8080, 5173);
            if len == CAPTURE_HEADER_LEN as u32 {
                stored += 1;
                // Consumer drains from EOS ring buffer (US 11,870,693 B2 Fig. 8 block 808 & Fig. 9B)
                self.ring_head = (self.ring_head + 1) % EOS_RING_CAPACITY;
            }
        }

        let accuracy_pct = if test_packets > 0 {
            (stored * 100) / test_packets
        } else {
            100
        };

        // Decision tree from Fig. 11:
        let verdict = if accuracy_pct >= (100 - loss_threshold_pct) {
            "SATISFACTORY_PERFORMANCE: EOS protocol operates within accuracy threshold"
        } else {
            // High loss: upgrade protocol or rebalance cores
            if self.active_eos_protocol == EosProtocolType::PragmaOmp {
                self.active_eos_protocol = EosProtocolType::MspscLocklessRing;
                "HIGH_LOSS_DETECTED: Upgraded EOS to MSPSC Lockless Ring"
            } else if self.active_eos_protocol == EosProtocolType::MpscQueue {
                self.active_eos_protocol = EosProtocolType::MspscLocklessRing;
                "HIGH_LOSS_DETECTED: Switched to MSPSC lockless architecture"
            } else {
                self.allocated_cores = self.allocated_cores.saturating_add(2);
                "HIGH_LOSS_DETECTED: Scaled producer core ratio for MSPSC"
            }
        };

        (accuracy_pct, self.active_eos_protocol, verdict)
    }
}

pub static mut FORTINET_CAPTURE_ENGINE: FortinetCaptureEngine = FortinetCaptureEngine::new();

/// Initializes the Fortinet Packet Capture & EOS subsystem
pub unsafe fn init_fortinet_subsystem() {
    FORTINET_CAPTURE_ENGINE = FortinetCaptureEngine::new();
}
