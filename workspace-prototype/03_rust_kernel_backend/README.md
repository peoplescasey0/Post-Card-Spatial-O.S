# Section 03 — Rust Kernel Backend

**Project:** Post Card OS Workspace Prototype  
**Section:** Rust bare-metal / userspace kernel modules  
**Current state:** Rust source modules exist in `src-rust/`: `boot_sequence.rs`, `elf_loader.rs`, `framebuffer.rs`, `heap.rs`, `lib.rs`, `native_hud.rs`, `spatial_node.rs`, `vfs_storage.rs`. No `Cargo.toml` yet — intended as bare-metal kernel source for cross-compilation or userspace library.  
**Direction:** Evolve from skeleton (boot sequence + allocator + ELF loader) into **a real AI kernel foundation** OR remain a lightweight hypervisor kernel if pivoting to AI workloads.  
**Fit into project:** Backend for the spatial UI (via Tauri IPC or native HUD). Provides heap telemetry, memory isolation, VFS bridge, framebuffer rendering. Future AI kernel would replace QEMU guest execution with native inference runtime.  

## What this is

Rust modules for Post Card OS kernel `v1.0.4-x86_64`. Key subsystems:

- **THE FOUNDRY** — `heap.rs` (dynamic free-list allocator, 8 MiB or 16 MiB arena).
- **THE CATAPULT** — `elf_loader.rs` (ELF64 magic validation, PT_LOAD parsing, isolated process descriptor).
- **THE BLACK BOX** — `vfs_storage.rs` (VFS bridge over memory block device, LBA mapping).
- **THE BEACON** — telemetry WebSocket, heap telemetry snapshot.
- **THE GLASS COCKPIT** — `framebuffer.rs`, `native_hud.rs` (blit to framebuffer, render HUD at 60 FPS).
- **PA-ROMY VAULT** — hardware isolation / telemetry mirror.

## Current files

- `boot_sequence.rs` — orchestrates boot across subsystems.
- `elf_loader.rs` — ELF64 user-space loader.
- `framebuffer.rs` — linear framebuffer.
- `heap.rs` — dynamic free-list allocator + telemetry.
- `lib.rs` — library root.
- `native_hud.rs` — immediate-mode HUD renderer.
- `spatial_node.rs` — spatial node abstraction.
- `vfs_storage.rs` — VFS bridge.

## Direction / Vision

**Pivot hypothesis:** Use the Rust memory isolation / boot sequence scaffolding as the foundation for a **new AI kernel** that manages AI workloads (inference, training) with its own scheduler and memory model, rather than QEMU-based guest VMs.

**If staying with current product:** Keep it as the bare-metal host kernel for the spatial OS, replacing the guest VM model with native AI processes.

## How it fits the whole project

- **UI** (Section 02) ← IPC from Rust backend.
- **Guests** (Section 04) ← Currently orchestrated via guest-api.mjs; future: AI processes replace QEMU guests.
- **Paper planes** (Section 05) ← Data transfer between cards, now including AI model weights/prompts.

## Handoff notes for AI team

1. **Tech stack:** Rust (edition likely 2021), `linked_list_allocator`, no `Cargo.toml` yet.
2. **Key constants:** `KERNEL_VERSION`, `FOUNDRY_HEAP_SIZE = 16 MiB`, `HEAP_START = 0x4444_4444_0000`, `DEFAULT_USER_ENTRY_POINT = 0x40_0000`, `DEFAULT_CR3_FRAME_ADDRESS = 0x10_0000`.
3. **Boot sequence** is 7 stages + subsystem self-tests.
4. **No GPU/NPU drivers yet** — if AI kernel, this is the biggest missing piece.

---

**Bottom line:** Either extend this kernel with AI-specific primitives, or treat it as the foundation for a new AI kernel. The memory allocator, ELF loader, and telemetry layer are reusable.

    ⟦ 引导模式｜已完成：PROFILE/SOUL/MEMORY；01_project_overview/README 写入；02_spatial_ui_frontend/README 写入；下一步：创建 03-08 分章 README，准备交付给 AI 团队；锚点：Damion, Romy, Rust kernel, heap.rs, elf_loader.rs, AI kernel pivot, bare-metal vs userspace ⟧