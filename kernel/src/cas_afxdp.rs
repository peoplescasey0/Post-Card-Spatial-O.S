//! # CAS CNIC Dual-Stack AF_XDP Engine (CN 115714679 A)
//!
//! Network Data Packet Processing Method, Apparatus, Electronic Device, and Storage Medium
//! (Computer Network Information Center, Chinese Academy of Sciences).
//! Filters packets at early XDP Hook into Class 1 (User Space Protocol Stack via AF_XDP/XSKMAP)
//! and Class 2 (Kernel Space Stack), with zero-copy UMEM memory pool rings and multi-NIC 1:1 binding.

#![allow(dead_code)]

pub const MAX_XSK_SOCKETS: usize = 4;
pub const UMEM_CHUNK_SIZE: usize = 2048;
pub const UMEM_RING_SIZE: usize = 16;

/// Packet classification category at XDP Hook (CN 115714679 A [0004]-[0008])
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum PacketClass {
    Class1UserSpace,  // Diverted via AF_XDP into user-space protocol stack
    Class2KernelSpace, // Retained in kernel for standard OS networking
}

pub fn class_str(c: PacketClass) -> &'static str {
    match c {
        PacketClass::Class1UserSpace => "CLASS_1_USER_SPACE (AF_XDP)",
        PacketClass::Class2KernelSpace => "CLASS_2_KERNEL_SPACE (In-Kernel Stack)",
    }
}

/// A zero-copy UMEM descriptor chunk (CN 115714679 A [0084]-[0088])
#[derive(Copy, Clone, Debug)]
pub struct UmemChunkDesc {
    pub chunk_addr: u64,
    pub length: u32,
    pub options: u32,
}

impl UmemChunkDesc {
    pub const fn empty() -> Self {
        Self {
            chunk_addr: 0,
            length: 0,
            options: 0,
        }
    }
}

/// An AF_XDP Socket (XSK) representation bound to a NIC Queue (CN 115714679 A Fig. 3)
#[derive(Copy, Clone, Debug)]
pub struct AfXdpSocket {
    pub socket_id: u32,
    pub bound_nic_id: u8,
    pub queue_id: u16,
    pub xsk_fd: u32,
    pub rx_ring_head: u32,
    pub rx_ring_tail: u32,
    pub tx_ring_head: u32,
    pub tx_ring_tail: u32,
    pub fill_ring_head: u32,
    pub fill_ring_tail: u32,
    pub packets_transferred_zero_copy: u64,
    pub active: bool,
}

impl AfXdpSocket {
    pub const fn empty() -> Self {
        Self {
            socket_id: 0,
            bound_nic_id: 0,
            queue_id: 0,
            xsk_fd: 0,
            rx_ring_head: 0,
            rx_ring_tail: 0,
            tx_ring_head: 0,
            tx_ring_tail: 0,
            fill_ring_head: 0,
            fill_ring_tail: 0,
            packets_transferred_zero_copy: 0,
            active: false,
        }
    }
}

/// CAS CNIC AF_XDP Zero-Copy Multiplexer Subsystem
pub struct CasAfXdpEngine {
    pub sockets: [AfXdpSocket; MAX_XSK_SOCKETS],
    pub socket_count: usize,
    pub xsk_map: [u32; MAX_XSK_SOCKETS], // BPF_MAP_TYPE_XSKMAP: maps queue_id -> socket_id
    pub total_rx_classified: u64,
    pub total_class1_user_space: u64,
    pub total_class2_kernel_space: u64,
    pub total_zero_copy_bytes: u64,
}

impl CasAfXdpEngine {
    pub const fn new() -> Self {
        Self {
            sockets: [
                AfXdpSocket::empty(),
                AfXdpSocket::empty(),
                AfXdpSocket::empty(),
                AfXdpSocket::empty(),
            ],
            socket_count: 0,
            xsk_map: [0xFF; MAX_XSK_SOCKETS],
            total_rx_classified: 0,
            total_class1_user_space: 0,
            total_class2_kernel_space: 0,
            total_zero_copy_bytes: 0,
        }
    }

    /// Registers a new AF_XDP socket and binds to NIC queue (CN 115714679 A [0084]-[0087])
    pub fn bind_af_xdp_socket(&mut self, nic_id: u8, queue_id: u16, xsk_fd: u32) -> u32 {
        if self.socket_count < MAX_XSK_SOCKETS {
            let sock_id = self.socket_count as u32;
            self.sockets[self.socket_count] = AfXdpSocket {
                socket_id: sock_id,
                bound_nic_id: nic_id,
                queue_id,
                xsk_fd,
                rx_ring_head: 0,
                rx_ring_tail: 0,
                tx_ring_head: 0,
                tx_ring_tail: 0,
                fill_ring_head: 16,
                fill_ring_tail: 0,
                packets_transferred_zero_copy: 0,
                active: true,
            };
            self.xsk_map[queue_id as usize % MAX_XSK_SOCKETS] = sock_id;
            self.socket_count += 1;
            sock_id
        } else {
            0
        }
    }

    /// Classifies incoming packet at XDP Hook into Class 1 (User Space via UMEM) or Class 2 (Kernel Stack)
    pub fn classify_and_dispatch(
        &mut self,
        _nic_id: u8,
        queue_id: u16,
        is_user_app_traffic: bool,
        packet_len: u32,
    ) -> (PacketClass, &'static str) {
        self.total_rx_classified = self.total_rx_classified.saturating_add(1);

        if is_user_app_traffic {
            // Class 1: Redirect to user-space protocol stack via AF_XDP / XSKMAP
            let map_idx = queue_id as usize % MAX_XSK_SOCKETS;
            let sock_id = self.xsk_map[map_idx];

            if sock_id != 0xFF && (sock_id as usize) < self.socket_count {
                let sock = &mut self.sockets[sock_id as usize];
                sock.rx_ring_tail = (sock.rx_ring_tail + 1) % (UMEM_RING_SIZE as u32);
                sock.packets_transferred_zero_copy = sock.packets_transferred_zero_copy.saturating_add(1);
                self.total_class1_user_space = self.total_class1_user_space.saturating_add(1);
                self.total_zero_copy_bytes = self.total_zero_copy_bytes.saturating_add(packet_len as u64);

                (
                    PacketClass::Class1UserSpace,
                    "AF_XDP_REDIRECT: Zero-copy delivered to User-Space UMEM shared ring",
                )
            } else {
                // Fallback to kernel if socket not bound
                self.total_class2_kernel_space = self.total_class2_kernel_space.saturating_add(1);
                (
                    PacketClass::Class2KernelSpace,
                    "FALLBACK_KERNEL: No active AF_XDP socket registered in XSKMAP",
                )
            }
        } else {
            // Class 2: Ingest into kernel network stack (CN 115714679 A [0038]-[0044])
            self.total_class2_kernel_space = self.total_class2_kernel_space.saturating_add(1);
            (
                PacketClass::Class2KernelSpace,
                "KERNEL_PASS: Routed to OS kernel TCP/IP stack for standard processing",
            )
        }
    }
}

pub static mut CAS_AFXDP_ENGINE: CasAfXdpEngine = CasAfXdpEngine::new();

/// Initializes the CAS CNIC AF_XDP subsystem
pub unsafe fn init_cas_subsystem() {
    CAS_AFXDP_ENGINE = CasAfXdpEngine::new();
    // Pre-bind eth0 queue 0 to Socket 0, eth1 queue 1 to Socket 1
    CAS_AFXDP_ENGINE.bind_af_xdp_socket(0, 0, 101);
    CAS_AFXDP_ENGINE.bind_af_xdp_socket(1, 1, 102);
}
