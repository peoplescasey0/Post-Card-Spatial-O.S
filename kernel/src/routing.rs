// ============================================================================
// POST CARD OS: MULTI-PRONGED HARDWARE & ROUTING RESOURCE ALLOCATOR
// Integrating USB Type-C Arbitration, IoT Security Interop, & Dataflow QoS
// ============================================================================
// Manages QoS-governed virtual interconnect routes between spatial cards,
// micro-VM capsules, hardware storage, USB-C xDCI controllers, and outbound
// "Paper Airplane" streams.

// ----------------------------------------------------------------------------
// 1. USB Type-C Hardware Controller Arbitration
// ----------------------------------------------------------------------------
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[allow(dead_code)]
pub enum UsbPortState {
    Disconnected = 0x00,
    SimpleCharger = 0x01,
    RemoteHost = 0x02,
    ActiveDevice = 0x03,
}

pub fn usb_port_state_str(state: UsbPortState) -> &'static str {
    match state {
        UsbPortState::Disconnected => "DISCONNECTED",
        UsbPortState::SimpleCharger => "SIMPLE_CHARGER",
        UsbPortState::RemoteHost => "REMOTE_HOST",
        UsbPortState::ActiveDevice => "ACTIVE_DEVICE",
    }
}

pub struct UsbTypeCDeviceControllerArbitrator {
    pub port_1_state: UsbPortState,
    pub port_2_state: UsbPortState,
    pub shared_xdci_mapped_to_port: u8, // 1 or 2
}

impl UsbTypeCDeviceControllerArbitrator {
    pub const fn new() -> Self {
        Self {
            port_1_state: UsbPortState::Disconnected,
            port_2_state: UsbPortState::Disconnected,
            shared_xdci_mapped_to_port: 0,
        }
    }

    /// Evaluates line state and CC/DP-DN receiver feedback to prevent
    /// a simple power charger from locking up the shared device controller (xDCI).
    pub fn evaluate_port_insertion(&mut self, port_id: u8, line_state_high: bool, is_dfp: bool) {
        if is_dfp && line_state_high {
            // Detected a simple power charger presenting as a downstream facing port
            if port_id == 1 {
                self.port_1_state = UsbPortState::SimpleCharger;
            } else {
                self.port_2_state = UsbPortState::SimpleCharger;
            }
            // Free up or remap the controller away from the charger port
            if self.shared_xdci_mapped_to_port == port_id {
                self.shared_xdci_mapped_to_port = if port_id == 1 { 2 } else { 1 };
            }
        } else {
            // Active remote host or functional device
            if port_id == 1 {
                self.port_1_state = UsbPortState::RemoteHost;
            } else {
                self.port_2_state = UsbPortState::RemoteHost;
            }
            self.shared_xdci_mapped_to_port = port_id;
        }
    }
}

pub static mut USB_ARBITRATOR: UsbTypeCDeviceControllerArbitrator = UsbTypeCDeviceControllerArbitrator::new();

// ----------------------------------------------------------------------------
// 2. IoT Security Interoperability & Downgrade Prevention Analyzer
// ----------------------------------------------------------------------------
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum IoTSecurityLevel {
    Level0Unsecured = 0,
    Level1Encrypted128 = 1,
    Level3MilitaryAES256 = 3,
}

pub fn iot_security_level_str(lvl: IoTSecurityLevel) -> &'static str {
    match lvl {
        IoTSecurityLevel::Level0Unsecured => "LVL0:UNSECURED",
        IoTSecurityLevel::Level1Encrypted128 => "LVL1:AES-128",
        IoTSecurityLevel::Level3MilitaryAES256 => "LVL3:MILITARY-AES-256",
    }
}

pub struct IoTSecurityInteroperabilityAnalyzer {
    pub device_security_levels: [IoTSecurityLevel; 8],
}

impl IoTSecurityInteroperabilityAnalyzer {
    pub const fn new() -> Self {
        Self {
            device_security_levels: [IoTSecurityLevel::Level3MilitaryAES256; 8],
        }
    }

    /// Identifies security interoperability gaps and prevents encryption downgrades
    /// across mixed-tier IoT channels and micro-kernel enclaves.
    pub fn check_connectivity_allowed(&self, source_dev: usize, target_dev: usize) -> bool {
        if source_dev >= 8 || target_dev >= 8 {
            return false;
        }
        let src_lvl = self.device_security_levels[source_dev] as u8;
        let tgt_lvl = self.device_security_levels[target_dev] as u8;

        // Prevent insecure downgrade paths unless mediated by an isolated broker enclave
        if src_lvl != tgt_lvl && (src_lvl == 0 || tgt_lvl == 0) {
            false // Isolate unverified devices
        } else {
            true
        }
    }
}

pub static mut SECURITY_ANALYZER: IoTSecurityInteroperabilityAnalyzer = IoTSecurityInteroperabilityAnalyzer::new();

// ----------------------------------------------------------------------------
// 3. Dynamic Quality of Service Dataflow Routing
// ----------------------------------------------------------------------------
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum QualityOfServiceTier {
    LowLatencyRealtime = 0, // For mouse compositor & telemetry streams
    StandardData = 1,       // For card state snapshots & file I/O
    BulkTransfer = 2,       // For "Paper Airplane" memory migration
}

pub fn qos_name(tier: QualityOfServiceTier) -> &'static str {
    match tier {
        QualityOfServiceTier::LowLatencyRealtime => "REALTIME",
        QualityOfServiceTier::StandardData => "STANDARD",
        QualityOfServiceTier::BulkTransfer => "BULK-XFER",
    }
}

pub fn card_name(card_id: u8) -> &'static str {
    match card_id {
        0 => "Avionics-HUD",
        1 => "Catapult-Ring3",
        2 => "BlackBox-FAT32",
        3 => "PA-Romy-Vault",
        4 => "Studio-Remote",
        5 => "NIC-e1000",
        6 => "USB-TypeC-xDCI",
        7 => "IoT-Sensor-Bus",
        _ => "Virtual-Card",
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct VirtualCardRoute {
    pub id: u8,
    pub source_card_id: u8,
    pub target_card_id: u8,
    pub target_bandwidth_mbps: u32,
    pub target_latency_ns: u32,
    pub qos_tier: QualityOfServiceTier,
    pub is_allocated: bool,
    pub packets_routed: u64,
}

pub struct KernelResourceManager {
    pub routes: [VirtualCardRoute; 8], // 8 slots matching process table / scheduler
    pub rated_interconnect_bandwidth_mbps: u32,
    pub rated_interconnect_latency_ns: u32,
    pub total_allocated_bandwidth_mbps: u32,
}

impl KernelResourceManager {
    pub const fn new() -> Self {
        Self {
            routes: [
                VirtualCardRoute {
                    id: 0,
                    source_card_id: 0,
                    target_card_id: 0,
                    target_bandwidth_mbps: 0,
                    target_latency_ns: 0,
                    qos_tier: QualityOfServiceTier::StandardData,
                    is_allocated: false,
                    packets_routed: 0,
                },
                VirtualCardRoute {
                    id: 1,
                    source_card_id: 0,
                    target_card_id: 0,
                    target_bandwidth_mbps: 0,
                    target_latency_ns: 0,
                    qos_tier: QualityOfServiceTier::StandardData,
                    is_allocated: false,
                    packets_routed: 0,
                },
                VirtualCardRoute {
                    id: 2,
                    source_card_id: 0,
                    target_card_id: 0,
                    target_bandwidth_mbps: 0,
                    target_latency_ns: 0,
                    qos_tier: QualityOfServiceTier::StandardData,
                    is_allocated: false,
                    packets_routed: 0,
                },
                VirtualCardRoute {
                    id: 3,
                    source_card_id: 0,
                    target_card_id: 0,
                    target_bandwidth_mbps: 0,
                    target_latency_ns: 0,
                    qos_tier: QualityOfServiceTier::StandardData,
                    is_allocated: false,
                    packets_routed: 0,
                },
                VirtualCardRoute {
                    id: 4,
                    source_card_id: 0,
                    target_card_id: 0,
                    target_bandwidth_mbps: 0,
                    target_latency_ns: 0,
                    qos_tier: QualityOfServiceTier::StandardData,
                    is_allocated: false,
                    packets_routed: 0,
                },
                VirtualCardRoute {
                    id: 5,
                    source_card_id: 0,
                    target_card_id: 0,
                    target_bandwidth_mbps: 0,
                    target_latency_ns: 0,
                    qos_tier: QualityOfServiceTier::StandardData,
                    is_allocated: false,
                    packets_routed: 0,
                },
                VirtualCardRoute {
                    id: 6,
                    source_card_id: 0,
                    target_card_id: 0,
                    target_bandwidth_mbps: 0,
                    target_latency_ns: 0,
                    qos_tier: QualityOfServiceTier::StandardData,
                    is_allocated: false,
                    packets_routed: 0,
                },
                VirtualCardRoute {
                    id: 7,
                    source_card_id: 0,
                    target_card_id: 0,
                    target_bandwidth_mbps: 0,
                    target_latency_ns: 0,
                    qos_tier: QualityOfServiceTier::StandardData,
                    is_allocated: false,
                    packets_routed: 0,
                },
            ],
            rated_interconnect_bandwidth_mbps: 1000, // 1 Gbps local bus / link limit
            rated_interconnect_latency_ns: 50,       // 50ns base hop latency
            total_allocated_bandwidth_mbps: 0,
        }
    }

    /// Evaluates incoming virtual card connection requests against security policy & hardware limits.
    pub fn allocate_route(
        &mut self,
        source: u8,
        target: u8,
        req_bandwidth: u32,
        req_latency: u32,
        tier: QualityOfServiceTier,
    ) -> Result<usize, &'static str> {
        // 1. Graph-Based Trust Topology & IoT Security Interoperability Check
        unsafe {
            crate::trust_graph::TRUST_GRAPH.evaluate_card_interoperability(source as usize, target as usize)?;
            if !SECURITY_ANALYZER.check_connectivity_allowed(source as usize, target as usize) {
                return Err("security_violation: unmediated cross-tier IoT encryption downgrade prevented");
            }
        }

        // 2. Total Interconnect Capacity Check
        if self.total_allocated_bandwidth_mbps.saturating_add(req_bandwidth) > self.rated_interconnect_bandwidth_mbps {
            return Err("alloc_fail: cumulative bandwidth exceeds rated 1Gbps interconnect limit");
        }

        // 3. Latency Comparison Check
        if req_latency < self.rated_interconnect_latency_ns {
            return Err("alloc_fail: target latency constraint is tighter than 50ns hardware capability");
        }

        // 4. Find an open route slot in our allocation table
        for (idx, route) in self.routes.iter_mut().enumerate() {
            if !route.is_allocated {
                route.id = idx as u8;
                route.source_card_id = source;
                route.target_card_id = target;
                route.target_bandwidth_mbps = req_bandwidth;
                route.target_latency_ns = req_latency;
                route.qos_tier = tier;
                route.is_allocated = true;
                route.packets_routed = 0;
                self.total_allocated_bandwidth_mbps += req_bandwidth;
                return Ok(idx);
            }
        }

        Err("alloc_fail: resource pool exhausted (no free route slots)")
    }

    pub fn free_route(&mut self, slot_idx: usize) -> bool {
        if slot_idx < self.routes.len() && self.routes[slot_idx].is_allocated {
            self.total_allocated_bandwidth_mbps = self
                .total_allocated_bandwidth_mbps
                .saturating_sub(self.routes[slot_idx].target_bandwidth_mbps);
            self.routes[slot_idx].is_allocated = false;
            true
        } else {
            false
        }
    }

    pub fn record_packet(&mut self, slot_idx: usize) {
        if slot_idx < self.routes.len() && self.routes[slot_idx].is_allocated {
            self.routes[slot_idx].packets_routed = self.routes[slot_idx].packets_routed.saturating_add(1);
        }
    }
}

pub static mut RESOURCE_MGR: KernelResourceManager = KernelResourceManager::new();

/// Pre-allocates core architectural system routes during kernel initialization.
pub unsafe fn init_default_system_routes() {
    // Initialize USB Type-C controller state (Port 1: Remote Host active, Port 2: Charger connected)
    USB_ARBITRATOR.evaluate_port_insertion(2, true, true); // Port 2 = simple charger
    USB_ARBITRATOR.evaluate_port_insertion(1, true, false); // Port 1 = remote host -> xDCI binds to Port 1

    // Pre-seed Route 0: Flight Telemetry & Mouse Cursor -> Realtime (200 Mbps, 100ns)
    let _ = RESOURCE_MGR.allocate_route(0, 4, 200, 100, QualityOfServiceTier::LowLatencyRealtime);
    // Pre-seed Route 1: Black Box Storage VFS -> Standard (300 Mbps, 250ns)
    let _ = RESOURCE_MGR.allocate_route(2, 4, 300, 250, QualityOfServiceTier::StandardData);
    // Pre-seed Route 2: PA-Romy Capsule Enclave -> Bulk Migration (400 Mbps, 500ns)
    let _ = RESOURCE_MGR.allocate_route(3, 4, 400, 500, QualityOfServiceTier::BulkTransfer);
}
