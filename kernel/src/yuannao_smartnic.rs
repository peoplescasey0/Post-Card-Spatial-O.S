//! # YuanNao SmartNIC Hardware-Offloaded XDP Engine (CN 116996602 B)
//!
//! Method, Apparatus, Storage Medium, and Electronic Device for Processing Data Packets.
//! Offloads eBPF/XDP execution directly into SmartNIC NPU memory with isolated metadata regions,
//! strict execution time watchdog (preventing RX queue head-of-line blocking),
//! header anomaly pruning, and zero-host-CPU hardware NAT redirection.

#![allow(dead_code)]

pub const MAX_SMARTNIC_RULES: usize = 16;
pub const SMARTNIC_MAX_INSTRUCTIONS: u32 = 3000;
pub const SMARTNIC_MAX_EXEC_TIME_US: u32 = 15; // T1 watchdog deadline

/// SmartNIC Offloaded Action
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum SmartNicAction {
    DropAnomaly,                       // Dropped in NIC for bad headers (e.g. TTL=0)
    PassToHostKernel,                  // Passed to server host kernel protocol stack
    TxHardwareNat(u32, u16),          // In-NIC NAT: rewrite dest IP and port, transmit out
    RedirectInterface(u8),            // Transmit out alternate physical port (load balancing)
    DropTimeoutDeadline,              // Execution exceeded T1 limit -> dropped to avoid queue stall
}

pub fn action_str(a: SmartNicAction) -> &'static str {
    match a {
        SmartNicAction::DropAnomaly => "DROP_ANOMALY (In-NIC Pruned)",
        SmartNicAction::PassToHostKernel => "PASS_TO_HOST_KERNEL",
        SmartNicAction::TxHardwareNat(_, _) => "TX_HARDWARE_NAT (Rewritten & Egressed)",
        SmartNicAction::RedirectInterface(_) => "REDIRECT_INTERFACE (Alternate Port)",
        SmartNicAction::DropTimeoutDeadline => "DROP_TIMEOUT_DEADLINE (Watchdog Fault)",
    }
}

/// Metadata table entry located inside SmartNIC SRAM/DRAM (CN 116996602 B [0101]-[0106])
#[derive(Copy, Clone, Debug)]
pub struct SmartNicMetadataEntry {
    pub ingress_proto: u8,
    pub match_src_ip: [u8; 4],
    pub match_dst_ip: [u8; 4],
    pub target_action: SmartNicAction,
    pub hit_count: u64,
    pub valid: bool,
}

impl SmartNicMetadataEntry {
    pub const fn empty() -> Self {
        Self {
            ingress_proto: 0,
            match_src_ip: [0; 4],
            match_dst_ip: [0; 4],
            target_action: SmartNicAction::PassToHostKernel,
            hit_count: 0,
            valid: false,
        }
    }
}

/// The YuanNao SmartNIC Hardware-Offloaded XDP Subsystem
pub struct YuanNaoSmartNicEngine {
    pub metadata_table: [SmartNicMetadataEntry; MAX_SMARTNIC_RULES],
    pub rule_count: usize,
    pub total_rx_packets: u64,
    pub total_offloaded_nat: u64,
    pub total_passed_to_host: u64,
    pub total_anomaly_drops: u64,
    pub total_watchdog_timeouts: u64,
    pub host_cpu_utilization_pct: u32, // Maintained at 0% for offloaded flows
}

impl YuanNaoSmartNicEngine {
    pub const fn new() -> Self {
        Self {
            metadata_table: [
                SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(),
                SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(),
                SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(),
                SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(), SmartNicMetadataEntry::empty(),
            ],
            rule_count: 0,
            total_rx_packets: 0,
            total_offloaded_nat: 0,
            total_passed_to_host: 0,
            total_anomaly_drops: 0,
            total_watchdog_timeouts: 0,
            host_cpu_utilization_pct: 0,
        }
    }

    /// Installs a hardware NAT or forwarding rule into SmartNIC isolated memory
    pub fn install_rule(
        &mut self,
        ingress_proto: u8,
        match_src_ip: [u8; 4],
        match_dst_ip: [u8; 4],
        action: SmartNicAction,
    ) {
        if self.rule_count < MAX_SMARTNIC_RULES {
            let idx = self.rule_count;
            self.metadata_table[idx] = SmartNicMetadataEntry {
                ingress_proto,
                match_src_ip,
                match_dst_ip,
                target_action: action,
                hit_count: 0,
                valid: true,
            };
            self.rule_count += 1;
        }
    }

    /// In-NIC Packet Processing Pipeline (CN 116996602 B Fig. 2 & [0040]-[0093]):
    /// 1. Verifies packet validity (e.g. checks TTL != 0)
    /// 2. Queries SmartNIC metadata table
    /// 3. Executes NAT or interface forwarding
    /// 4. Checks execution time watchdog (< T1)
    pub fn process_packet_on_nic(
        &mut self,
        ttl: u8,
        proto: u8,
        src_ip: [u8; 4],
        dst_ip: [u8; 4],
        simulated_time_us: u32,
    ) -> (SmartNicAction, &'static str) {
        self.total_rx_packets = self.total_rx_packets.saturating_add(1);

        // Step 1: Anomaly validation (CN 116996602 B [0052]-[0055])
        if ttl == 0 {
            self.total_anomaly_drops = self.total_anomaly_drops.saturating_add(1);
            return (
                SmartNicAction::DropAnomaly,
                "ANOMALY_DROP: TTL=0 packet pruned directly in NIC hardware",
            );
        }

        // Step 2: Execution time watchdog (CN 116996602 B [0020]-[0021], [0108]-[0112])
        if simulated_time_us > SMARTNIC_MAX_EXEC_TIME_US {
            self.total_watchdog_timeouts = self.total_watchdog_timeouts.saturating_add(1);
            return (
                SmartNicAction::DropTimeoutDeadline,
                "WATCHDOG_TIMEOUT: Execution exceeded T1 deadline (15us), dropped to prevent queue HOL blocking",
            );
        }

        // Step 3: Lookup SmartNIC isolated metadata table
        for i in 0..self.rule_count {
            let rule = &mut self.metadata_table[i];
            if rule.valid && (rule.ingress_proto == 0 || rule.ingress_proto == proto) {
                if (rule.match_dst_ip == [0, 0, 0, 0] || rule.match_dst_ip == dst_ip)
                    && (rule.match_src_ip == [0, 0, 0, 0] || rule.match_src_ip == src_ip)
                {
                    rule.hit_count = rule.hit_count.saturating_add(1);
                    match rule.target_action {
                        SmartNicAction::TxHardwareNat(_, _) | SmartNicAction::RedirectInterface(_) => {
                            self.total_offloaded_nat = self.total_offloaded_nat.saturating_add(1);
                            return (
                                rule.target_action,
                                "OFFLOAD_SUCCESS: Hardware NAT & Egress executed in NIC (Host CPU 0%)",
                            );
                        }
                        SmartNicAction::PassToHostKernel => {
                            self.total_passed_to_host = self.total_passed_to_host.saturating_add(1);
                            return (
                                SmartNicAction::PassToHostKernel,
                                "PASS_HOST: Packet routed to host server kernel network stack",
                            );
                        }
                        SmartNicAction::DropAnomaly | SmartNicAction::DropTimeoutDeadline => {
                            self.total_anomaly_drops = self.total_anomaly_drops.saturating_add(1);
                            return (rule.target_action, "FILTER_DROP: Metadata rule specified DROP");
                        }
                    }
                }
            }
        }

        // Default: If no metadata rule matches, pass to host kernel for conventional handling
        self.total_passed_to_host = self.total_passed_to_host.saturating_add(1);
        (
            SmartNicAction::PassToHostKernel,
            "DEFAULT_PASS: No SmartNIC offload rule matched, passed to host kernel",
        )
    }
}

pub static mut YUANNAO_SMARTNIC_ENGINE: YuanNaoSmartNicEngine = YuanNaoSmartNicEngine::new();

/// Initializes the YuanNao SmartNIC subsystem
pub unsafe fn init_yuannao_subsystem() {
    YUANNAO_SMARTNIC_ENGINE = YuanNaoSmartNicEngine::new();
    // Seed hardware NAT rule: 192.168.1.100 -> 10.0.2.200:8080 on Interface 1
    YUANNAO_SMARTNIC_ENGINE.install_rule(
        6, // TCP
        [192, 168, 1, 100],
        [10, 0, 2, 15],
        SmartNicAction::TxHardwareNat(0x0A0002C8, 8080),
    );
    // Seed Alternate Interface Redirect rule: 192.168.1.101 -> Interface 2
    YUANNAO_SMARTNIC_ENGINE.install_rule(
        17, // UDP
        [192, 168, 1, 101],
        [0, 0, 0, 0],
        SmartNicAction::RedirectInterface(2),
    );
}
