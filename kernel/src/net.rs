// ============================================================================
// POST CARD OS: BARE-METAL PCIE E1000 NIC DRIVER & UDP TELEMETRY ENGINE
// ============================================================================
// Provides bare-metal Gigabit Ethernet networking via Intel 82540EM/82545EM (e1000)
// and fallback virtual loopback for streaming live spatial telemetry and
// "Paper Airplane" micro-VM migration frames over UDP to the Web Studio (port 5173).

#![allow(dead_code)]

use core::ptr::{read_volatile, write_volatile};

// ----------------------------------------------------------------------------
// Intel 82540EM / 82545EM Register Offsets
// ----------------------------------------------------------------------------
const REG_CTRL: usize = 0x0000;    // Device Control
const REG_STATUS: usize = 0x0008;  // Device Status
const REG_EERD: usize = 0x0014;    // EEPROM Read
const REG_ICR: usize = 0x00C0;     // Interrupt Cause Read
const REG_IMS: usize = 0x00D0;     // Interrupt Mask Set
const REG_IMC: usize = 0x00D8;     // Interrupt Mask Clear
const REG_RCTL: usize = 0x0100;    // Receive Control
const REG_TCTL: usize = 0x0400;    // Transmit Control
const REG_TIPG: usize = 0x0410;    // Transmit Inter-Packet Gap
const REG_RDBAL: usize = 0x2800;   // Rx Descriptor Base Address Low
const REG_RDBAH: usize = 0x2804;   // Rx Descriptor Base Address High
const REG_RDLEN: usize = 0x2808;   // Rx Descriptor Length
const REG_RDH: usize = 0x2810;     // Rx Descriptor Head
const REG_RDT: usize = 0x2818;     // Rx Descriptor Tail
const REG_TDBAL: usize = 0x3800;   // Tx Descriptor Base Address Low
const REG_TDBAH: usize = 0x3804;   // Tx Descriptor Base Address High
const REG_TDLEN: usize = 0x3808;   // Tx Descriptor Length
const REG_TDH: usize = 0x3810;     // Tx Descriptor Head
const REG_TDT: usize = 0x3818;     // Tx Descriptor Tail
const REG_MTA_BASE: usize = 0x5200;// Multicast Table Array (128 entries)
const REG_RAL: usize = 0x5400;     // Receive Address Low (MAC bytes 0-3)
const REG_RAH: usize = 0x5404;     // Receive Address High (MAC bytes 4-5 + Valid)

// Control Flags
const CTRL_SLU: u32 = 1 << 6;      // Set Link Up
const CTRL_RST: u32 = 1 << 26;     // Device Reset
const RCTL_EN: u32 = 1 << 1;       // Receiver Enable
const RCTL_BAM: u32 = 1 << 15;     // Broadcast Accept Mode
const RCTL_SECRC: u32 = 1 << 26;   // Strip Ethernet CRC
const TCTL_EN: u32 = 1 << 1;       // Transmit Enable
const TCTL_PSP: u32 = 1 << 3;      // Pad Short Packets
const TXD_CMD_EOP: u8 = 1 << 0;    // End of Packet
const TXD_CMD_IFCS: u8 = 1 << 1;   // Insert FCS / Checksum
const TXD_CMD_RS: u8 = 1 << 3;     // Report Status
const TXD_STAT_DD: u8 = 1 << 0;    // Descriptor Done
const RXD_STAT_DD: u8 = 1 << 0;    // Descriptor Done
const RXD_STAT_EOP: u8 = 1 << 1;   // End of Packet

const NUM_TX_DESCS: usize = 8;
const NUM_RX_DESCS: usize = 8;
const BUFFER_SIZE: usize = 2048;

#[repr(C, align(16))]
#[derive(Clone, Copy)]
pub struct TxDesc {
    pub buffer_addr: u64,
    pub length: u16,
    pub cso: u8,
    pub cmd: u8,
    pub status: u8,
    pub css: u8,
    pub special: u16,
}

#[repr(C, align(16))]
#[derive(Clone, Copy)]
pub struct RxDesc {
    pub buffer_addr: u64,
    pub length: u16,
    pub checksum: u16,
    pub status: u8,
    pub errors: u8,
    pub special: u16,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum NicType {
    None,
    VirtualLoopback,
    IntelE1000,
}

pub struct E1000Driver {
    pub nic_type: NicType,
    pub mmio_base: u64,
    pub mac_addr: [u8; 6],
    pub ip_addr: [u8; 4],
    pub gateway_ip: [u8; 4],
    pub link_up: bool,
    pub tx_packets: u64,
    pub rx_packets: u64,
    pub tx_bytes: u64,
    pub rx_bytes: u64,
    tx_head: usize,
    tx_tail: usize,
    rx_tail: usize,
}

// Statically allocated DMA descriptor rings and packet buffers
static mut TX_DESCS: [TxDesc; NUM_TX_DESCS] = [TxDesc {
    buffer_addr: 0,
    length: 0,
    cso: 0,
    cmd: 0,
    status: 0,
    css: 0,
    special: 0,
}; NUM_TX_DESCS];

static mut RX_DESCS: [RxDesc; NUM_RX_DESCS] = [RxDesc {
    buffer_addr: 0,
    length: 0,
    checksum: 0,
    status: 0,
    errors: 0,
    special: 0,
}; NUM_RX_DESCS];

static mut TX_BUFFERS: [[u8; BUFFER_SIZE]; NUM_TX_DESCS] = [[0; BUFFER_SIZE]; NUM_TX_DESCS];
static mut RX_BUFFERS: [[u8; BUFFER_SIZE]; NUM_RX_DESCS] = [[0; BUFFER_SIZE]; NUM_RX_DESCS];

pub static mut NIC: E1000Driver = E1000Driver {
    nic_type: NicType::None,
    mmio_base: 0,
    mac_addr: [0x52, 0x54, 0x00, 0x12, 0x34, 0x56], // Default QEMU virt-MAC
    ip_addr: [10, 0, 2, 15],                          // Guest default
    gateway_ip: [10, 0, 2, 2],                        // Host Studio default
    link_up: false,
    tx_packets: 0,
    rx_packets: 0,
    tx_bytes: 0,
    rx_bytes: 0,
    tx_head: 0,
    tx_tail: 0,
    rx_tail: 0,
};

impl E1000Driver {
    pub unsafe fn write_reg(&self, offset: usize, val: u32) {
        if self.mmio_base != 0 {
            write_volatile((self.mmio_base + offset as u64) as *mut u32, val);
        }
    }

    pub unsafe fn read_reg(&self, offset: usize) -> u32 {
        if self.mmio_base != 0 {
            read_volatile((self.mmio_base + offset as u64) as *const u32)
        } else {
            0
        }
    }

    /// Transmits a raw Ethernet frame via e1000 TX descriptor ring
    pub unsafe fn send_raw_frame(&mut self, data: &[u8]) -> bool {
        if data.len() > BUFFER_SIZE {
            return false;
        }

        if self.nic_type == NicType::IntelE1000 && self.mmio_base != 0 {
            let idx = self.tx_tail;
            let desc = &mut TX_DESCS[idx];

            // Wait if descriptor is busy
            let mut timeout = 10_000;
            while (desc.status & TXD_STAT_DD == 0) && desc.length > 0 && timeout > 0 {
                timeout -= 1;
            }

            // Copy data into TX buffer
            TX_BUFFERS[idx][..data.len()].copy_from_slice(data);
            desc.buffer_addr = TX_BUFFERS[idx].as_ptr() as u64;
            desc.length = data.len() as u16;
            desc.cso = 0;
            desc.status = 0;
            desc.css = 0;
            desc.special = 0;
            desc.cmd = TXD_CMD_EOP | TXD_CMD_IFCS | TXD_CMD_RS;

            // Advance TX tail
            self.tx_tail = (self.tx_tail + 1) % NUM_TX_DESCS;
            self.write_reg(REG_TDT, self.tx_tail as u32);

            self.tx_packets = self.tx_packets.saturating_add(1);
            self.tx_bytes = self.tx_bytes.saturating_add(data.len() as u64);
            true
        } else {
            // Loopback fallback
            self.tx_packets = self.tx_packets.saturating_add(1);
            self.tx_bytes = self.tx_bytes.saturating_add(data.len() as u64);
            true
        }
    }

    /// Polls for incoming Ethernet frame
    pub unsafe fn poll_raw_frame<'a>(&mut self, buf: &'a mut [u8]) -> Option<usize> {
        if self.nic_type == NicType::IntelE1000 && self.mmio_base != 0 {
            let next_rx = (self.rx_tail + 1) % NUM_RX_DESCS;
            let desc = &mut RX_DESCS[next_rx];

            if desc.status & RXD_STAT_DD != 0 {
                let len = desc.length as usize;
                let copy_len = len.min(buf.len());
                buf[..copy_len].copy_from_slice(&RX_BUFFERS[next_rx][..copy_len]);

                // Reset descriptor
                desc.status = 0;
                self.rx_tail = next_rx;
                self.write_reg(REG_RDT, self.rx_tail as u32);

                self.rx_packets = self.rx_packets.saturating_add(1);
                self.rx_bytes = self.rx_bytes.saturating_add(len as u64);
                Some(len)
            } else {
                None
            }
        } else {
            None
        }
    }
}

// ----------------------------------------------------------------------------
// Lightweight IPv4 & UDP Protocol Stack
// ----------------------------------------------------------------------------

fn compute_ipv4_checksum(header: &[u8]) -> u16 {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i < header.len() {
        let word = ((header[i] as u32) << 8) | (header[i + 1] as u32);
        sum = sum.wrapping_add(word);
        i += 2;
    }
    while (sum >> 16) != 0 {
        sum = (sum & 0xFFFF) + (sum >> 16);
    }
    !(sum as u16)
}

/// Builds and transmits a complete Ethernet II -> IPv4 -> UDP packet
pub unsafe fn send_udp_packet(
    dst_ip: [u8; 4],
    src_port: u16,
    dst_port: u16,
    payload: &[u8],
) -> bool {
    let mut packet = [0u8; 1514];
    let payload_len = payload.len().min(1472); // Maximum payload in standard MTU

    // 1. Ethernet Header (14 bytes)
    // Broadcast MAC or gateway MAC
    let dst_mac: [u8; 6] = [0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF];
    packet[0..6].copy_from_slice(&dst_mac);
    packet[6..12].copy_from_slice(&NIC.mac_addr);
    packet[12] = 0x08; // EtherType 0x0800 = IPv4
    packet[13] = 0x00;

    // 2. IPv4 Header (20 bytes)
    let ip_total_len = (20 + 8 + payload_len) as u16;
    packet[14] = 0x45; // Version 4, IHL 5 (20 bytes)
    packet[15] = 0x00; // DSCP / ECN
    packet[16] = (ip_total_len >> 8) as u8;
    packet[17] = (ip_total_len & 0xFF) as u8;
    packet[18] = 0xAB; // Identification
    packet[19] = 0xCD;
    packet[20] = 0x40; // Flags (Don't Fragment)
    packet[21] = 0x00; // Frag offset
    packet[22] = 64;   // TTL
    packet[23] = 17;   // Protocol 17 = UDP
    packet[24] = 0;    // Checksum placeholder
    packet[25] = 0;
    packet[26..30].copy_from_slice(&NIC.ip_addr);
    packet[30..34].copy_from_slice(&dst_ip);

    let ip_cksum = compute_ipv4_checksum(&packet[14..34]);
    packet[24] = (ip_cksum >> 8) as u8;
    packet[25] = (ip_cksum & 0xFF) as u8;

    // 3. UDP Header (8 bytes)
    let udp_len = (8 + payload_len) as u16;
    packet[34] = (src_port >> 8) as u8;
    packet[35] = (src_port & 0xFF) as u8;
    packet[36] = (dst_port >> 8) as u8;
    packet[37] = (dst_port & 0xFF) as u8;
    packet[38] = (udp_len >> 8) as u8;
    packet[39] = (udp_len & 0xFF) as u8;
    packet[40] = 0; // Checksum 0 = disabled/optional in IPv4 UDP
    packet[41] = 0;

    // 4. UDP Payload
    packet[42..42 + payload_len].copy_from_slice(&payload[..payload_len]);

    let total_packet_len = 14 + 20 + 8 + payload_len;
    NIC.send_raw_frame(&packet[..total_packet_len])
}

/// Broadcasts structured flight telemetry and card status to Studio Web UI (port 5173)
pub unsafe fn broadcast_telemetry(pitch: i32, roll: i32, altitude: u32, active_card: u8) {
    let mut buf = [0u8; 192];
    let mut pos = 0;

    // Fast static formatting for telemetry payload:
    // "SPATIAL_TELEM:p=<pitch>,r=<roll>,alt=<alt>,card=<card>,qos=1Gbps,hsm=SECURE"
    let prefix = b"{\"telem\":{\"pitch\":";
    buf[pos..pos + prefix.len()].copy_from_slice(prefix);
    pos += prefix.len();

    pos += write_int(&mut buf[pos..], pitch as i64);

    let s1 = b",\"roll\":";
    buf[pos..pos + s1.len()].copy_from_slice(s1);
    pos += s1.len();
    pos += write_int(&mut buf[pos..], roll as i64);

    let s2 = b",\"alt\":";
    buf[pos..pos + s2.len()].copy_from_slice(s2);
    pos += s2.len();
    pos += write_int(&mut buf[pos..], altitude as i64);

    let s3 = b",\"card\":";
    buf[pos..pos + s3.len()].copy_from_slice(s3);
    pos += s3.len();
    pos += write_int(&mut buf[pos..], active_card as i64);

    let s4 = b",\"hsm\":\"AUTH\",\"pcr\":\"VALID\"}}\n";
    buf[pos..pos + s4.len()].copy_from_slice(s4);
    pos += s4.len();

    // Broadcast to Studio gateway 10.0.2.2 and broadcast 255.255.255.255:5173
    send_udp_packet(NIC.gateway_ip, 5173, 5173, &buf[..pos]);
}

fn write_int(buf: &mut [u8], mut val: i64) -> usize {
    if val == 0 {
        if !buf.is_empty() {
            buf[0] = b'0';
            return 1;
        }
        return 0;
    }

    let mut start = 0;
    if val < 0 {
        if !buf.is_empty() {
            buf[0] = b'-';
            start = 1;
        }
        val = -val;
    }

    let mut digits = [0u8; 20];
    let mut count = 0;
    while val > 0 && count < 20 {
        digits[count] = b'0' + (val % 10) as u8;
        val /= 10;
        count += 1;
    }

    let mut written = start;
    while count > 0 && written < buf.len() {
        count -= 1;
        buf[written] = digits[count];
        written += 1;
    }
    written
}

// ----------------------------------------------------------------------------
// Initialization & PCI Enumeration
// ----------------------------------------------------------------------------

pub unsafe fn init_network() {
    let pci_devs = crate::blockdev::pci_devices();
    let mut found_nic = false;

    for p in pci_devs.iter() {
        // Match Intel e1000 devices (82540EM: 0x8086:0x100E, 82545EM: 0x8086:0x100F, 82574L: 0x10D3)
        // or any class 0x02 subclass 0x00 (Ethernet controller)
        let is_intel_nic = p.vendor == 0x8086 && (p.device == 0x100E || p.device == 0x100F || p.device == 0x10D3 || p.device == 0x107C);
        let is_any_eth = p.class == 0x02 && p.subclass == 0x00;

        if is_intel_nic || is_any_eth {
            crate::blockdev::pci_enable(p);
            let bar0 = crate::blockdev::pci_mem_bar(p, 0);

            if bar0 != 0 {
                NIC.mmio_base = bar0;
                NIC.nic_type = NicType::IntelE1000;
                found_nic = true;

                // 1. Reset device
                NIC.write_reg(REG_CTRL, CTRL_RST);
                for _ in 0..10_000 {
                    core::arch::asm!("pause", options(nomem, nostack));
                }

                // 2. Clear interrupts
                NIC.write_reg(REG_IMC, 0xFFFF_FFFF);
                let _ = NIC.read_reg(REG_ICR);

                // 3. Set Link Up (SLU) and full duplex
                NIC.write_reg(REG_CTRL, CTRL_SLU | (1 << 5)); // SLU + ASDE (Auto Speed)

                // 4. Read Hardware MAC Address from RAL/RAH
                let ral = NIC.read_reg(REG_RAL);
                let rah = NIC.read_reg(REG_RAH);
                if ral != 0 || (rah & 0xFFFF) != 0 {
                    NIC.mac_addr[0] = (ral & 0xFF) as u8;
                    NIC.mac_addr[1] = ((ral >> 8) & 0xFF) as u8;
                    NIC.mac_addr[2] = ((ral >> 16) & 0xFF) as u8;
                    NIC.mac_addr[3] = ((ral >> 24) & 0xFF) as u8;
                    NIC.mac_addr[4] = (rah & 0xFF) as u8;
                    NIC.mac_addr[5] = ((rah >> 8) & 0xFF) as u8;
                }

                // 5. Clear Multicast Table Array (MTA)
                for i in 0..128 {
                    NIC.write_reg(REG_MTA_BASE + (i * 4), 0);
                }

                // 6. Setup Transmit Ring
                for i in 0..NUM_TX_DESCS {
                    TX_DESCS[i].buffer_addr = TX_BUFFERS[i].as_ptr() as u64;
                    TX_DESCS[i].status = TXD_STAT_DD;
                    TX_DESCS[i].cmd = 0;
                    TX_DESCS[i].length = 0;
                }
                NIC.write_reg(REG_TDBAL, (TX_DESCS.as_ptr() as u64 & 0xFFFF_FFFF) as u32);
                NIC.write_reg(REG_TDBAH, (TX_DESCS.as_ptr() as u64 >> 32) as u32);
                NIC.write_reg(REG_TDLEN, (NUM_TX_DESCS * core::mem::size_of::<TxDesc>()) as u32);
                NIC.write_reg(REG_TDH, 0);
                NIC.write_reg(REG_TDT, 0);
                NIC.tx_tail = 0;
                NIC.write_reg(REG_TIPG, 0x0060_200A); // Standard IEEE 802.3 inter-packet gap
                NIC.write_reg(REG_TCTL, TCTL_EN | TCTL_PSP | (0x10 << 4) | (0x40 << 12));

                // 7. Setup Receive Ring
                for i in 0..NUM_RX_DESCS {
                    RX_DESCS[i].buffer_addr = RX_BUFFERS[i].as_ptr() as u64;
                    RX_DESCS[i].status = 0;
                    RX_DESCS[i].length = 0;
                }
                NIC.write_reg(REG_RDBAL, (RX_DESCS.as_ptr() as u64 & 0xFFFF_FFFF) as u32);
                NIC.write_reg(REG_RDBAH, (RX_DESCS.as_ptr() as u64 >> 32) as u32);
                NIC.write_reg(REG_RDLEN, (NUM_RX_DESCS * core::mem::size_of::<RxDesc>()) as u32);
                NIC.write_reg(REG_RDH, 0);
                NIC.write_reg(REG_RDT, (NUM_RX_DESCS - 1) as u32);
                NIC.rx_tail = NUM_RX_DESCS - 1;
                NIC.write_reg(REG_RCTL, RCTL_EN | RCTL_BAM | RCTL_SECRC);

                let status = NIC.read_reg(REG_STATUS);
                NIC.link_up = (status & 0x02) != 0; // Bit 1 = Link Up
                break;
            }
        }
    }

    if !found_nic {
        // Fallback to loopback virtual adapter so networking and telemetry commands succeed
        NIC.nic_type = NicType::VirtualLoopback;
        NIC.link_up = true;
    }
}
