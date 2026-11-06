# Post Card Spatial OS — Official User Manual & Field Guide

Welcome to **Post Card Spatial OS**, a next-generation spatial computing environment and lightweight hypervisor interface. The system renders operating systems (Windows, Linux, macOS, Kali Linux, and Android) as interactive 3D cards arranged on a spatial turntable, backed by QEMU, KVM, and 100% local AI orchestration.

---

## Table of Contents
1. [Core Architecture & Concept](#1-core-architecture--concept)
2. [3D Turntable Navigation & Card Interaction](#2-3d-turntable-navigation--card-interaction)
3. [6-Way Directional Card Flip](#3-6-way-directional-card-flip)
4. [Multi-OS Hypervisor & Guest Management](#4-multi-os-hypervisor--guest-management)
5. [Dual-Engine AI Butler ("The One")](#5-dual-engine-ai-butler-the-one)
6. [Freeplane Mind Map Engine & SpatialNode 3D Topology](#6-freeplane-mind-map-engine--spatialnode-3d-topology)
7. [SecOps Playbooks & Hypervisor Operations](#7-secops-playbooks--hypervisor-operations)
8. [Paper Airplane Relays & Inter-VM Data Drops](#8-paper-airplane-relays--inter-vm-data-drops)
9. [Pro AV Studio Rack & Color Grading](#9-pro-av-studio-rack--color-grading)
10. [DirectLink 10.0.0.2 Swarm Gateway](#10-directlink-10002-swarm-gateway)
11. [3D Reversible Paper Bin](#11-3d-reversible-paper-bin)
12. [Commercial Editions & Modular Add-On Marketplace](#12-commercial-editions--modular-add-on-marketplace)
13. [Keyboard & Gesture Reference](#13-keyboard--gesture-reference)

---

## 1. Core Architecture & Concept
* **Frontend**: Three.js WebGL/WebGPU spatial studio with custom PBR materials, dynamic metallic edges, and responsive camera framing.
* **Backend Hypervisor**: Local QEMU/QMP process manager (`guest-api.mjs`) communicating via loopback WebSocket (`5700+`) and QMP (`4444+`).
* **Hardware Interop**: Native KVM acceleration on Linux/macOS, software TPM 2.0 (`swtpm`) for Windows 11, and DirectLink tunnel offloading to secondary workstation nodes.

---

## 2. 3D Turntable Navigation & Card Interaction
* **Turntable Carousel**: Scroll with your mouse wheel or press `↑` / `↓` / `←` / `→` to rotate through the circular card deck.
* **Focus & Jump**: Press `Home` to jump to the primary card, or `End` to jump to the last card.
* **3D Space Drag**: Hold `Shift` while dragging a card to freely float and position it above the studio floor in 3D coordinate space.
* **2× Retina OLED Zoom**: Press `Z` or click the focused card to zoom in directly. Press `Esc` or `Z` again to reset back to studio framing.
* **Front Bench Mode**: Click the bench counter (`1`, `2`, or `3`) or use the top dock to pull multiple VM cards side-by-side for parallel side-by-side monitoring.

---

## 3. 6-Way Directional Card Flip
Every system card is a multi-dimensional spatial object with 6 distinct functional faces:
1. **Face 1 — Display (Front)**: Live guest OS display over noVNC with zero-latency pointer lock.
2. **Face 2 — Settings (Back)**: Guest hardware allocation, CPU profile (Eco/Balanced/Gaming), ISO selection, and base disk management (`Enter` or double-click to flip).
3. **Face 3 — Security (Top)**: SUID privilege auditing, TPM 2.0 key status, and virtual network firewall rules.
4. **Face 4 — Planes (Bottom)**: Incoming and spooled paper airplane notes, VVFAT payload attachments, and flight recorder audit logs.
5. **Face 5 — Actions (Left)**: One-click snapshots, fork copy-on-write clone overlays, and memory checkpoint rewinds.
6. **Face 6 — Telemetry (Right)**: Real-time guest CPU load, VirtIO balloon memory usage, disk IOPS, and network throughput.

Use keyboard shortcuts `1` through `6` or edge handles to rotate directly to any face.

---

## 4. Multi-OS Hypervisor & Guest Management
* **Windows 11 Pro**: Boots with private software TPM 2.0 (`swtpm`) and OVMF Secure Boot UEFI. Persistent 64 GiB QCOW2 virtual drive.
* **Debian Linux**: Powered by a shared `debian-golden.qcow2` master image with per-card copy-on-write overlays (`data/overlays/<card-id>.qcow2`).
* **macOS (DirectLink)**: Boots via OpenCore EFI with AppleSMC support, offloaded to the DirectLink workstation (`10.0.0.2`) with native `/dev/kvm` hardware acceleration.
* **Kali Linux Cyber Range**: Security red-team card pre-configured on an isolated multicast virtual network (`230.0.0.1:4550`).
* **Android**: Illustrated preview and sandbox container for mobile application testing.

---

## 5. Dual-Engine AI Butler ("The One")
The AI Butler operates with **100% local privacy** over the DirectLink mesh tunnel (`10.0.0.2:11434`), ensuring no user data or guest memory ever leaves your private network.

### Dual-Engine Setup
* **`qwen2.5-coder:1.5b` (Code & Terminal)**:
  * Fine-tuned for code synthesis, QEMU commands, terminal diagnostics, outliners, and shell scripting.
  * Size: 986 MB — ultra-low latency response (~1.2s).
* **`llama3.2:1b` (Conversation & Guidance)**:
  * High-capability conversational co-pilot for general guidance, troubleshooting, and natural language instruction.
  * Size: 1.3 GB.
* **Smart Auto-Routing**: Automatically inspects query semantics. If you ask for code, bash commands, or hypervisor scripts, it automatically routes to Qwen; for conversational queries, it routes to Llama. You can also manually switch engines via the `#butler-model-select` dropdown.

### System Architecture Blueprint Ingestion
The Butler has full native awareness of the core architecture blueprints stored in `workspace-prototype/public/blueprints/`:
1. `system-mindmap.mmd`: Hypervisor architecture, UI layout, and DirectLink topology.
2. `erd-data-model.mmd`: Entity relationship model between cards, overlays, checkpoints, and telemetry.
3. `ci-cd-pipeline.mmd`: Automated testing, typechecking, and release automation.
4. `lidar-decimation-filter.mmd`: UART streaming filter and hardware state-machine specs.
5. `product-flowchart.mmd`: Complete user journey and guest provisioning flow.

### Virtual Tooling
* **SwiftShader Vulkan Software Rasterizer**: Headless GPU emulation via `vk_swiftshader_icd.json` and `libEGL.so`.
* **VS Code CLI Extensions Hook**: Direct integration with `code --install-extension` for automated editor workflows.

---

## 6. Freeplane Mind Map Engine & SpatialNode 3D Topology

### Freeplane / FreeMind 1.11+ Integration
* **File Format**: Generates clean, standard `.mm` XML documents compatible with Freeplane, FreeMind, and modern mind-mapping suites.
* **Dynamic Calculations**: Supports live spreadsheet-style node calculations (e.g. `=3+4` calculates to `7`).
* **Visual Semantics**: Cloud nodes (colored backgrounds), relationship arrows with custom labels, summary brackets grouping child nodes, and rich HTML node details.
* **Workspace Sync**: Instant outliner synthesis from active cards and system state.

### `SpatialNode` 3D Topology
Both Rust (`spatial_node.rs`) and TypeScript (`spatial-node.ts`) implement the unified spatial node structure:
```rust
pub struct SpatialNode {
    pub id: u64,
    pub title: String,
    pub details: Option<String>,
    pub position: [f32; 3], // X, Y, Z coordinates
    pub children: Vec<u64>,
    pub state: NodeState,   // Pinned, Floating, Collapsed, Active
}
```
* **Floating Nodes**: Double-click any open area in the spatial studio to create a floating spatial node.
* **Pinned Nodes**: Lock node coordinates to prevent displacement during turntable rotation.

---

## 7. SecOps Playbooks & Hypervisor Operations
The top toolbar provides two dedicated operations menus:

### 🛡️ SecOps Playbooks ▾
* **Host Isolation**: Disconnects all virtual NICs instantly, severing guest network interfaces without killing the process.
* **RAM Sanitizer**: Commands the VirtIO memory balloon to expand to guest limits, flushing cached memory pages and scrubbed sectors.
* **SSH Lockdown**: Drops active remote management sessions and rotates tunnel tokens.
* **C2 Decoy**: Deploys simulated honeypot sockets across isolated multicast interfaces.

### ⚡ Hypervisor Ops ▾
* **🍃 Eco RAM Thinning**: Cycles between Eco (1–2 GiB), Balanced (2–4 GiB), and High-Performance memory limits.
* **Emergency Crashdump**: Dumps active guest CPU registers and kernel stack to `/data/crashdumps/` via QMP.
* **VRAM Compact**: Defragments Three.js WebGL textures and offscreen canvas framebuffers.
* **Cold Evacuate**: Gracefully flushes dirty disk overlays to storage and powers down all active guests.

---

## 8. Paper Airplane Relays & Inter-VM Data Drops
* **Send Note**: Click *Send Paper Plane* on any card to compose a note. The card folds into a 3D paper airplane, animates through the room, and delivers itself to the recipient card.
* **Heavy File Drops**: Attach payloads up to 512 KB. The hypervisor dynamically attaches a QEMU Virtual FAT (VVFAT) drive, allowing files to appear natively inside the target VM's filesystem.
* **QMP Console Typing**: Notes can optionally type directly into the guest OS's active terminal or serial console (`ttyS0` / `COM1`).

---

## 9. Pro AV Studio Rack & Color Grading
* **Pro AV Controls**: Master audio fader with Intel HDA duplex audio emulation.
* **Stereo VU Meters**: Dual-channel LED peak meters (CH 1 L / CH 2 R) responding to guest audio output.
* **Color Grading Themes**:
  1. *Twilight Atelier*: Deep slate background with warm amber highlights.
  2. *Cyberpunk SecOps*: Electric violet atmosphere with neon cyan cards.
  3. *Matrix Terminal*: Classic phosphor green monochrome HUD.
  4. *Vintage Rolodex*: Tactile warm brass and archival paper card stock.
* **CRT Scanline Filter**: Optional phosphor scanlines and curved glass reflection overlay.

---

## 10. DirectLink 10.0.0.2 Swarm Gateway
* **Workstation Offloading**: Heavy virtualization workloads (e.g., macOS KVM, Ollama AI inference) run transparently on the Fedora 45 workstation at `10.0.0.2`.
* **Zero Configuration**: Persistent SSH reverse tunnels forward ports `5700` (VNC), `4444` (QMP), and `11434` (Ollama AI) over a dedicated 1 Gbps direct peer-to-peer Ethernet link.

---

## 11. 3D Reversible Paper Bin
* **Zero-Data-Loss Deletion**: Dragging a card into the bin or clicking *Move to bin* folds the card into an airplane and flies it into the corner trash bin.
* **State Preservation**: The QCOW2 disk overlay, RAM checkpoints, and TPM credentials remain completely untouched on disk.
* **1-Click Restore**: Open the paper bin dialog at any time to instantly restore cards back onto the 3D turntable.

---

## 12. Commercial Editions & Modular Add-On Marketplace

### Available Editions
1. **Community Edition (Free Forever)**: Open-core Rust micro-host, 3D card turntable, and standard QEMU virtualization.
2. **Pro Edition ($19/mo or $190/yr)**: Unlocks 24-VM concurrent scaling, Pro AV matrix, and NVIDIA GPU compute sandboxing.
3. **Enterprise B2B (Custom Contract)**: Air-gapped SecOps compliance appliance, tamper-evident audit logging, and golden base locks.
4. **AI Butler Subscription ($29/mo or $290/yr)**: 100% local privacy AI co-pilot with automated VM orchestration and predictive failure healing.

### Modular Add-On Marketplace (Live DLC Slots)
* 🎛️ **The A/V Production Plugin**: Stereo VU peak meters, Intel HDA duplex, low-latency DAC.
* 🕵️ **The Deep-Dive Forensics Pack**: SUID privilege auditor, live memory dumper, socket tracer.
* ⚡ **Advanced NVIDIA Compute Module**: DirectLink GPU acceleration, CUDA passthrough, and vGPU partitioning.
* 🌐 **Swarm DirectLink 10.0.0.2 Gateway**: 1 Gbps direct peer-to-peer Ethernet mesh tunnel.

---

## 13. Keyboard & Gesture Reference

| Key / Action | Function |
|---|---|
| `Scroll` / `↑` `↓` | Browse turntable deck and focus cards |
| `Click` | Select card and bring to foreground |
| `Enter` / `Double-Click` | Flip card to Settings side |
| `1` – `6` | Jump directly to card faces (Display, Settings, Security, Planes, Actions, Telemetry) |
| `Z` | Zoom 2× into focused card display |
| `Esc` | Zoom out / dismiss active dialog |
| `Shift + Drag` | Reposition card freely in 3D studio coordinates |
| `Home` / `End` | Jump to first / last card in turntable |
| `?` | Open this User Manual & Field Guide |
| `T` | 3D Twist expansion of viewport |

---
*Post Card Spatial OS — 100% Local Hypervisor & Spatial Workspace.*

