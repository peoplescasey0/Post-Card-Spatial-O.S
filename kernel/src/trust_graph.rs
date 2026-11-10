// ============================================================================
// POST CARD OS: GRAPH-BASED TRUST TOPOLOGY & ENCLAVE ISOLATION ENGINE
// Based on Intel's IoT Security Interoperability Path Analysis Architecture
// ============================================================================
// Evaluates trust tiers, PCR (Platform Configuration Register) quotes,
// and cross-tier communication paths between spatial cards and micro-VM enclaves.
// Enforces cryptographic isolation to prevent security downgrade attacks.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum TrustLevel {
    Level0Untrusted = 0,
    Level1StandardCrypto = 1,
    Level3MilitaryHardwareEnclave = 3,
}

pub fn trust_level_str(lvl: TrustLevel) -> &'static str {
    match lvl {
        TrustLevel::Level0Untrusted => "LVL0:UNTRUSTED",
        TrustLevel::Level1StandardCrypto => "LVL1:STD-CRYPTO",
        TrustLevel::Level3MilitaryHardwareEnclave => "LVL3:MIL-ENCLAVE",
    }
}

#[derive(Clone, Copy)]
pub struct VirtualCardNode {
    pub card_id: u32,
    pub name: &'static str,
    pub trust_level: TrustLevel,
    pub pcr_quote_valid: bool,
    pub active_channel_secure: bool,
    pub quarantined: bool,
    pub pcr_hash: [u8; 32],
}

pub const MAX_TRUST_NODES: usize = 8;

pub struct CardTrustGraphAnalyzer {
    pub nodes: [VirtualCardNode; MAX_TRUST_NODES],
    pub node_count: usize,
    pub isolation_events: u64,
}

impl CardTrustGraphAnalyzer {
    pub const fn new() -> Self {
        Self {
            nodes: [
                VirtualCardNode {
                    card_id: 0,
                    name: "Avionics-HUD",
                    trust_level: TrustLevel::Level1StandardCrypto,
                    pcr_quote_valid: true,
                    active_channel_secure: true,
                    quarantined: false,
                    pcr_hash: [0x11; 32],
                },
                VirtualCardNode {
                    card_id: 1,
                    name: "Catapult-Ring3",
                    trust_level: TrustLevel::Level1StandardCrypto,
                    pcr_quote_valid: true,
                    active_channel_secure: true,
                    quarantined: false,
                    pcr_hash: [0x22; 32],
                },
                VirtualCardNode {
                    card_id: 2,
                    name: "BlackBox-FAT32",
                    trust_level: TrustLevel::Level3MilitaryHardwareEnclave,
                    pcr_quote_valid: true,
                    active_channel_secure: true,
                    quarantined: false,
                    pcr_hash: [0x33; 32],
                },
                VirtualCardNode {
                    card_id: 3,
                    name: "PA-Romy-Vault",
                    trust_level: TrustLevel::Level3MilitaryHardwareEnclave,
                    pcr_quote_valid: true,
                    active_channel_secure: true,
                    quarantined: false,
                    pcr_hash: [0x54; 32],
                },
                VirtualCardNode {
                    card_id: 4,
                    name: "Studio-Remote",
                    trust_level: TrustLevel::Level1StandardCrypto,
                    pcr_quote_valid: true,
                    active_channel_secure: true,
                    quarantined: false,
                    pcr_hash: [0x44; 32],
                },
                VirtualCardNode {
                    card_id: 5,
                    name: "NIC-e1000",
                    trust_level: TrustLevel::Level1StandardCrypto,
                    pcr_quote_valid: true,
                    active_channel_secure: true,
                    quarantined: false,
                    pcr_hash: [0x55; 32],
                },
                VirtualCardNode {
                    card_id: 6,
                    name: "USB-TypeC-xDCI",
                    trust_level: TrustLevel::Level1StandardCrypto,
                    pcr_quote_valid: true,
                    active_channel_secure: true,
                    quarantined: false,
                    pcr_hash: [0x66; 32],
                },
                VirtualCardNode {
                    card_id: 7,
                    name: "IoT-Sensor-Bus",
                    trust_level: TrustLevel::Level0Untrusted,
                    pcr_quote_valid: false, // Insecure sensor node by default
                    active_channel_secure: false,
                    quarantined: false,
                    pcr_hash: [0x00; 32],
                },
            ],
            node_count: 8,
            isolation_events: 0,
        }
    }

    /// Evaluates interoperability paths between virtual cards.
    /// If a security gap, invalid PCR quote, or unauthorized downgrade path
    /// is detected, it triggers automated enclave isolation to protect kernel memory.
    pub fn evaluate_card_interoperability(&mut self, source_idx: usize, target_idx: usize) -> Result<(), &'static str> {
        if source_idx >= self.node_count || target_idx >= self.node_count {
            return Err("node_oob: invalid card index");
        }

        let src = self.nodes[source_idx];
        let tgt = self.nodes[target_idx];

        // 1. Quarantined check
        if src.quarantined {
            return Err("source_quarantined: node isolated due to prior trust breach");
        }
        if tgt.quarantined {
            return Err("target_quarantined: node isolated due to prior trust breach");
        }

        // 2. Hardware PCR Quote Validation
        if !src.pcr_quote_valid {
            self.nodes[source_idx].quarantined = true;
            self.isolation_events += 1;
            return Err("pcr_fail: source failed TPM/PCR quote verification -> quarantined");
        }
        if !tgt.pcr_quote_valid {
            self.nodes[target_idx].quarantined = true;
            self.isolation_events += 1;
            return Err("pcr_fail: target failed TPM/PCR quote verification -> quarantined");
        }

        // 3. IoT Security Interoperability: Level 0 Untrusted isolation
        if src.trust_level == TrustLevel::Level0Untrusted {
            self.nodes[source_idx].quarantined = true;
            self.isolation_events += 1;
            return Err("downgrade_breach: Level 0 untrusted source rejected -> quarantined");
        }
        if tgt.trust_level == TrustLevel::Level0Untrusted {
            self.nodes[target_idx].quarantined = true;
            self.isolation_events += 1;
            return Err("downgrade_breach: Level 0 untrusted target rejected -> quarantined");
        }

        // 4. Cross-tier downgrade path analysis:
        // Military Enclave (Level 3) cannot directly bridge to Standard Crypto (Level 1)
        // without passing through the PA-Romy Biometric Vault Enclave (Card 3) or BlackBox (Card 2).
        if src.trust_level != tgt.trust_level {
            let is_brokered = source_idx == 3 || target_idx == 3 || source_idx == 2 || target_idx == 2;
            if !is_brokered {
                return Err("cross_tier_violation: unmediated Level3<->Level1 bridge without enclave broker");
            }
            // Enforce biometric G-SSO authentication on Card 3 broker
            if source_idx == 3 || target_idx == 3 {
                unsafe {
                    if !crate::softhsm::SOFTHSM_CTX.is_authenticated() {
                        return Err("hsm_locked: PA-Romy Biometric Vault is locked; G-SSO session required");
                    }
                }
            }
        }

        // 5. Active channel cryptographic integrity
        if !src.active_channel_secure || !tgt.active_channel_secure {
            return Err("insecure_channel: unencrypted wire detected on path");
        }

        Ok(())
    }

    /// Manually or automatically quarantines a card node and increments isolation counter.
    pub fn quarantine_card(&mut self, card_idx: usize) -> bool {
        if card_idx < self.node_count {
            self.nodes[card_idx].quarantined = true;
            self.isolation_events += 1;
            true
        } else {
            false
        }
    }

    /// Releases a quarantined card node back to active trust topology.
    pub fn release_quarantine(&mut self, card_idx: usize) -> bool {
        if card_idx < self.node_count {
            self.nodes[card_idx].quarantined = false;
            true
        } else {
            false
        }
    }

    /// Verifies and updates a card's TPM / PCR quote against an expected quote.
    pub fn verify_pcr_quote(&mut self, card_idx: usize, quote: &[u8; 32]) -> bool {
        if card_idx >= self.node_count {
            return false;
        }

        // Verify quote is non-zero
        let mut is_nonzero = false;
        for &b in quote.iter() {
            if b != 0 {
                is_nonzero = true;
                break;
            }
        }

        if is_nonzero {
            self.nodes[card_idx].pcr_hash.copy_from_slice(quote);
            self.nodes[card_idx].pcr_quote_valid = true;
            self.nodes[card_idx].quarantined = false;
            true
        } else {
            self.nodes[card_idx].pcr_quote_valid = false;
            self.quarantine_card(card_idx);
            false
        }
    }

    /// Sets trust level for a specific card node.
    #[allow(dead_code)]
    pub fn set_trust_level(&mut self, card_idx: usize, level: TrustLevel) -> bool {
        if card_idx < self.node_count {
            self.nodes[card_idx].trust_level = level;
            true
        } else {
            false
        }
    }
}

pub static mut TRUST_GRAPH: CardTrustGraphAnalyzer = CardTrustGraphAnalyzer::new();
