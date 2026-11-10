//! # Langhe Service Mesh Sockops Acceleration Engine (CN 114025370 B)
//!
//! Data Message Transmission Method, Medium, System, and Computing Device
//! (Hangzhou Langhe Technology Co., Ltd.).
//! Accelerates Cloud-Native / Container Service Mesh (Sidecar Envoy) communications,
//! bypassing 4 to 6 kernel TCP/IP protocol stacks using eBPF sockops, bidirectional
//! port translation (sockmap skops1 & skops2), and ARP broadcast dual-synchronization.

#![allow(dead_code)]

pub const MAX_MESH_MAPPINGS: usize = 16;
pub const SIDECAR_PROXY_PORT: u16 = 15001; // Standard Envoy Sidecar inbound proxy port

/// Bidirectional Port Mapping in Service Mesh Acceleration (CN 114025370 B [0116]-[0120])
#[derive(Copy, Clone, Debug)]
pub struct SockmapTupleEntry {
    pub client_src_port: u16,
    pub original_dst_port: u16,
    pub sidecar_proxy_port: u16,
    pub pod_id: u8,
    pub hit_count: u64,
    pub valid: bool,
}

impl SockmapTupleEntry {
    pub const fn empty() -> Self {
        Self {
            client_src_port: 0,
            original_dst_port: 0,
            sidecar_proxy_port: SIDECAR_PROXY_PORT,
            pod_id: 0,
            hit_count: 0,
            valid: false,
        }
    }
}

/// Result of Service Mesh redirection
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum MeshRedirectResult {
    EgressDivertedToSidecar(u16),      // Egress redirected to local Sidecar port 15001
    IngressRestoredOriginalPort(u16),  // Ingress returned from Sidecar, original port restored
    ArpBroadcastDualSynced,            // ARP replicated to both user space and kernel
    PassthroughKernel,                 // Traffic outside configured mesh port range
}

/// The Langhe Service Mesh Subsystem
pub struct LangheServiceMeshEngine {
    pub sockmap: [SockmapTupleEntry; MAX_MESH_MAPPINGS],
    pub mapping_count: usize,
    pub total_egress_redirected: u64,
    pub total_ingress_restored: u64,
    pub total_arp_dual_synced: u64,
    pub total_stacks_bypassed: u64, // Tracks cumulative TCP/IP protocol stacks eliminated
    pub configured_service_port_min: u16,
    pub configured_service_port_max: u16,
}

impl LangheServiceMeshEngine {
    pub const fn new() -> Self {
        Self {
            sockmap: [
                SockmapTupleEntry::empty(), SockmapTupleEntry::empty(), SockmapTupleEntry::empty(), SockmapTupleEntry::empty(),
                SockmapTupleEntry::empty(), SockmapTupleEntry::empty(), SockmapTupleEntry::empty(), SockmapTupleEntry::empty(),
                SockmapTupleEntry::empty(), SockmapTupleEntry::empty(), SockmapTupleEntry::empty(), SockmapTupleEntry::empty(),
                SockmapTupleEntry::empty(), SockmapTupleEntry::empty(), SockmapTupleEntry::empty(), SockmapTupleEntry::empty(),
            ],
            mapping_count: 0,
            total_egress_redirected: 0,
            total_ingress_restored: 0,
            total_arp_dual_synced: 0,
            total_stacks_bypassed: 0,
            configured_service_port_min: 1000,
            configured_service_port_max: 9000,
        }
    }

    /// Intercepts egress packet before TCP stack, records two-way sockmap tuple,
    /// and rewrites destination port to Sidecar Envoy proxy port (15001)
    pub fn accelerate_egress(
        &mut self,
        pod_id: u8,
        src_port: u16,
        dst_port: u16,
    ) -> (MeshRedirectResult, &'static str) {
        if dst_port < self.configured_service_port_min || dst_port > self.configured_service_port_max {
            return (
                MeshRedirectResult::PassthroughKernel,
                "PASSTHROUGH: Destination port not in service mesh accelerated range",
            );
        }

        // Check if tuple already exists
        for i in 0..self.mapping_count {
            let entry = &mut self.sockmap[i];
            if entry.valid && entry.client_src_port == src_port && entry.original_dst_port == dst_port {
                entry.hit_count = entry.hit_count.saturating_add(1);
                self.total_egress_redirected = self.total_egress_redirected.saturating_add(1);
                self.total_stacks_bypassed = self.total_stacks_bypassed.saturating_add(4); // Bypasses 4 TCP/IP stacks
                return (
                    MeshRedirectResult::EgressDivertedToSidecar(SIDECAR_PROXY_PORT),
                    "SOCKOPS_EGRESS: Diverted to Sidecar proxy port 15001 (Bypassed 4 TCP/IP stacks)",
                );
            }
        }

        // Install new two-way sockmap tuple (CN 114025370 B [0116]-[0120])
        if self.mapping_count < MAX_MESH_MAPPINGS {
            let idx = self.mapping_count;
            self.sockmap[idx] = SockmapTupleEntry {
                client_src_port: src_port,
                original_dst_port: dst_port,
                sidecar_proxy_port: SIDECAR_PROXY_PORT,
                pod_id,
                hit_count: 1,
                valid: true,
            };
            self.mapping_count += 1;
        }

        self.total_egress_redirected = self.total_egress_redirected.saturating_add(1);
        self.total_stacks_bypassed = self.total_stacks_bypassed.saturating_add(4);

        (
            MeshRedirectResult::EgressDivertedToSidecar(SIDECAR_PROXY_PORT),
            "SOCKOPS_EGRESS: New connection mapped & redirected to Sidecar Envoy (15001)",
        )
    }

    /// Restores original destination port on response packet returning from Sidecar proxy
    pub fn restore_ingress(
        &mut self,
        _pod_id: u8,
        src_port: u16,
        proxy_dst_port: u16,
    ) -> (MeshRedirectResult, &'static str) {
        if proxy_dst_port != SIDECAR_PROXY_PORT {
            return (
                MeshRedirectResult::PassthroughKernel,
                "PASSTHROUGH: Not destined to Sidecar proxy port",
            );
        }

        for i in 0..self.mapping_count {
            let entry = &mut self.sockmap[i];
            if entry.valid && entry.client_src_port == src_port {
                entry.hit_count = entry.hit_count.saturating_add(1);
                self.total_ingress_restored = self.total_ingress_restored.saturating_add(1);
                self.total_stacks_bypassed = self.total_stacks_bypassed.saturating_add(2); // Ingress bypass

                return (
                    MeshRedirectResult::IngressRestoredOriginalPort(entry.original_dst_port),
                    "SOCKOPS_INGRESS: Restored original microservice port from sockmap",
                );
            }
        }

        (
            MeshRedirectResult::PassthroughKernel,
            "PASSTHROUGH: No reverse sockmap entry found",
        )
    }

    /// Replicates ARP broadcast packet to both user space and kernel (CN 114025370 B [0160]-[0164])
    pub fn handle_arp_dual_sync(&mut self) -> (MeshRedirectResult, &'static str) {
        self.total_arp_dual_synced = self.total_arp_dual_synced.saturating_add(1);
        (
            MeshRedirectResult::ArpBroadcastDualSynced,
            "ARP_DUAL_SYNC: Replicated ARP broadcast to user-space mesh proxy and kernel MAC table",
        )
    }
}

pub static mut LANGHE_MESH_ENGINE: LangheServiceMeshEngine = LangheServiceMeshEngine::new();

/// Initializes the Langhe Service Mesh subsystem
pub unsafe fn init_langhe_subsystem() {
    LANGHE_MESH_ENGINE = LangheServiceMeshEngine::new();
    // Pre-install microservice RPC mapping: Pod 1 (Client port 37058) -> Pod 2 (Service port 8080)
    let _ = LANGHE_MESH_ENGINE.accelerate_egress(1, 37058, 8080);
}
