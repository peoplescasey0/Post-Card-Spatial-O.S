# Section 04 — Guest Orchestration (QEMU / WSL)

**Project:** Post Card OS Workspace Prototype  
**Section:** VM lifecycle — boot, shutdown, resume, snapshots, TCG fallback  
**Current state:** Working. `guest-api.mjs` handles QEMU/UEFI/TPM lifecycle for Linux and Windows guests. Tests cover offline status, disk persistence, path traversal rejection, idempotent force stop, card deletion.  
**Direction:** Refine into a standalone "VM lifecycle engine" that can run without the Post Card UI, for heads-up display, CLI, or Tauri sidecar binary.  
**Fit into project:** Cards = VMs. Each card's "launch" button triggers the orchestration layer. Paper planes move data between guests.  

## What this is

QEMU/UEFI/TPM lifecycle management for the workspace-prototype guests:

- **Linux guests** — Debian golden base + per-card EVE overlays, up to 4 concurrent.
- **Windows guests** — WSL2 + QEMU + software TPM + OVMF. TCG emulation (no KVM) → slow.
- **Snapshots** — named guest snapshots + rollback.
- **Card deletion** — permanent delete vs reversible bin.

## Current files

- `guest-api.mjs`
- `start-studio.mjs`
- `run-vite.mjs`
- `run-macos.sh`
- `data/master-images/` (Debian golden, Fedora golden, minimal kernel)
- `data/overlays/` (per-card COW overlays)
- `data/windows/disks/`, `data/windows/firmware/`, `data/windows/tpm/`
- `data/android/`

## Direction / Vision

- Keep the QEMU orchestration **stable** while Tauri wraps it.
- Add **Tauri sidecar binary** so the app bundles QEMU/swtpm (no external install).
- Expose lifecycle as a **library** (`postcard-vm` npm package or Rust crate) for other teams.
- Future: replace with **AI workload orchestrator** if pivoting to AI kernel.

## How it fits the whole project

```
UI card "Launch" button
  → guest-api.mjs
    → QEMU + noVNC
      → card face shows live guest framebuffer
```

The orchestration layer is the bridge between spatial metaphor and real compute.

## Handoff notes for AI team

1. **Tech stack:** Node.js ESM (`guest-api.mjs`), QEMU, WSL2, OVMF, swtpm, noVNC.
2. **Env vars:** `POSTCARD_WINDOWS_ISO`, `POSTCARD_KVM_HOST`, `POSTCARD_KVM_WORKDIR`, `POSTCARD_MAC_OSK`, `POSTCARD_DEBIAN_ISO`, `POSTCARD_QEMU`, `POSTCARD_QEMU_IMG`.
3. **Ports:** VNC 5700, QMP 4444, serial 4544, TPM 23200.
4. **Limits:** MAX_GUESTS=16, MAX_CONCURRENT_GUESTS=6, GUEST_MEMORY_MB=2048, WINDOWS_DISK_SIZE="64G".
5. **Windows performance:** No `/dev/kvm` in WSL → TCG software emulation is very slow.

---

**Bottom line:** Solid, tested orchestration. Next step is packaging it as a Tauri sidecar and exposing a stable CLI/library API for other teams.

    ⟦ 引导模式｜已完成：PROFILE/SOUL/MEMORY；01/02/03 README 写入；下一步：继续 04-08 README；锚点：Damion, QEMU, WSL2, guest-api.mjs, card lifecycle, Tauri sidecar ⟧