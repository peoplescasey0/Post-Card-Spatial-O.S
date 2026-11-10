# Post Card OS: Architectural Overview & Engineering Vision

## 1. The Big Picture & Product Vision
Post Card OS is a next-generation, hardware-adjacent spatial hypervisor and multi-OS environment. It moves away from flat, legacy window managers by treating workspaces as persistent, floating 3D spatial cards with Copy-on-Write (CoW) state management. The ultimate design goal is a precision studio-grade environment, blending high-end Apple/Linear minimalism with a rugged, custom-engineered industrial core.

## 2. Core Technical Stack & Architecture
- **Hypervisor layer:** Built around QEMU and WSL integrations, enabling multi-OS virtualization and local virtual machine management.
- **State & file handling:** CoW overlays for instant snapshot rollbacks, plus a native "paper airplane" state-transfer UI for moving data across development environments.
- **Performance focus:** Low-latency, high-density workspaces optimized for heavy local engineering tasks and spatial visualization.

## 3. Visual Design Language & Color System
Strict **Precision Studio** aesthetic: deep obsidian/slate foundations paired with industrial phosphor amber accents.

- **Logo DNA:** A dark obsidian plate split by a sharp horizontal amber trace line with an active terminal dot (`public/company-logo.svg`).
- **Backgrounds:** Deep matte void `#07090E`; hypervisor slate gutters `#0D111A`.
- **Surfaces:** Frosted glass panels `#14161B` → `#1E2736`; cool smoke borders `#262A33`.
- **Gold accent `#FFB81C`** (brightened from `#F59E0B`, Enterprise-E LCARS gold): Reserved **exclusively** for active states, primary terminal cursors, connection bridges, loading indicators, and critical focus states.
- **Typography:** Main text `#F4F5F7`; muted titanium text `#8A909E`.

---

## 4. System Architecture & Codename Schema (`v1.0.4-x86_64`)

Every layer of the bare-metal kernel and spatial host is mapped to precision aviation and industrial operations:

- **The Foundry (`LockedHeap`):** Dynamic free-list memory allocator (`src-rust/heap.rs`) managing 16 MB RAM arenas and recycling blocks without garbage collection staggers.
- **The Catapult (`ELF64 Loader`):** Binary parsing engine (`src-rust/elf_loader.rs`) validating `0x7F 'E' 'L' 'F'` magic bytes and spawning user-space processes into isolated Ring 3 segments (`0x400000` entry, `0x100000` CR3 PML4 root).
- **The Black Box (`VfsStorageBridge`):** Persistent sector storage (`src-rust/vfs_storage.rs`) bridging modified VFS nodes and Freeplane mind-maps down to raw LBA disk blocks via `MemoryBlockDevice`.
- **The Glass Cockpit (`render_native_hud`):** Immediate-mode framebuffer renderer (`src-rust/native_hud.rs` & `src-rust/framebuffer.rs`) blitting crisp typography and high-contrast telemetry straight into VRAM.
- **The Beacon (`WebSocket Stream`):** Real-time `/telemetry` WebSocket bridge streaming live guest and kernel diagnostics to the host-side Mission Control HUD (`#romy-status` & `#heap-meter`).
- **PA-Romy (`Coprocessor Vault`):** Hardware-isolated neural container with a clean, read-only telemetry mirror.
- **Paper Planes (`Flight Deck & Hangar Bay`):** Lightweight spatial data packets gliding from the Flight Deck queuing buffer on the sending side to the Hangar Bay persistent staging zone on reception.

### Space Plane Avionics & Cold Boot Ignition Sequence
```text
========================================================================
[ 0.000000 ] POST CARD OS // SPACE PLANE AVIONICS v1.0.4... [ CORE ]
[ 0.001042 ] CHASSIS: Al-Li 2195 Cryogenic Hull Frame... [ SECURED ]
[ 0.002890 ] THE FOUNDRY: 16MB LockedHeap Arena... [ STABLE ]
[ 0.004510 ] THE CATAPULT: ELF64 Ring 3 Spatial Loader... [ ARMED ]
[ 0.007120 ] THE BLACK BOX: VfsStorageBridge Sector Mirror... [ LOCKED ]
[ 0.010200 ] THE RADIATOR: Cryogenic Thermal Control Loop... [ STABILIZED ]
[ 0.014500 ] PA-ROMY VAULT: Isolated Neural Coprocessor... [ ACTIVE ]
========================================================================
```

