# Section 01 — Project Overview & Master Brief

**Project:** Post Card OS Workspace Prototype  
**Codename:** Spatial hypervisor / multi-OS environment  
**Primary path:** `G:\micro-host\workspace-prototype`  
**Status:** Working prototype, 285 tests passing, guest lifecycle operational  
**Primary contact:** Damion (Casey)  
**Agent:** Romy (Andromeda)

---

## 1. What this is

A spatial workspace prototype that runs multiple operating systems as "cards" in a 3D desktop environment. Users drag cards around, boot Linux/Windows guests inside them, and move data between cards via "paper planes." Built as a TypeScript frontend (Vite + Three.js) with a Rust backend skeleton (bare-metal heap, ELF loader, VFS bridge, framebuffer, HUD telemetry).

## 2. The vision (one sentence)

A desktop replacement where every environment is a card, every data transfer is a paper plane, and the whole thing runs on your own multi-PC rig — with the long-term goal of people sending paper planes instead of emails.

## 3. How the sections fit together

```
┌─────────────────────────────────────────────────────────────────┐
│                    SPATIAL UI (Section 02)                       │
│  Three.js carousel + card studio + theme engine + HUD overlay   │
│  → Tauri app → Windows/macOS/Linux desktop distribution          │
├─────────────────────────────────────────────────────────────────┤
│                    PAPER PLANE PROTOCOL (Section 05)              │
│  Encrypted, capability-based data transfer between cards/peers   │
│  → The "email killer" primitive that moves state between cards   │
├─────────────────────────────────────────────────────────────────┤
│                    GUEST ORCHESTRATION (Section 04)              │
│  QEMU + WSL2 lifecycle: boot, shutdown, resume, snapshots        │
│  → Runs Linux/Windows guests inside cards                        │
├─────────────────────────────────────────────────────────────────┤
│                    RUST KERNEL BACKEND (Section 03)              │
│  heap.rs, elf_loader.rs, vfs_storage.rs, native_hud.rs           │
│  → Future bare-metal foundation, currently userspace library     │
├─────────────────────────────────────────────────────────────────┤
│              BILLING, WEB, ASSETS (Sections 06, 08)              │
│  Stripe integration, demo page, static assets, config            │
└─────────────────────────────────────────────────────────────────┘
```

## 4. Handoff instructions for AI teams

Each section below has its own README. Send the relevant folder/README to the corresponding team:

| Team | Send this README | Focus |
|------|------------------|-------|
| Spatial UI team | `02_spatial_ui_frontend/README.md` | Tauri wrapper, Three.js, theme engine, card layout |
| Kernel/Rust team | `03_rust_kernel_backend/README.md` | heap, ELF, VFS, framebuffer, telemetry |
| Guest/VM team | `04_guest_orchestration/README.md` | QEMU, WSL, overlays, card lifecycle |
| Protocol team | `05_paper_plane_protocol/README.md` | Encrypted transfer, receipts, capabilities |
| Full-stack/DevOps | `06_billing_and_web/README.md` + `08_assets_and_config/README.md` | Stripe, landing page, CI/CD, distribution |

## 5. Key constraints

- **Zero robotic filler speak.** No "As an AI language model..." — this is a hard red line.
- **Cool big sister energy.** Fast, accurate, funny, zero fluff.
- **Windows guests run via WSL2 TCG emulation (no KVM)** — slow but functional.
- **Linux guests use QEMU + noVNC, up to 4 concurrent.**
- **All data under `data/` is gitignored.**

---

**Bottom line:** You have a working spatial hypervisor prototype. Every section below is a separable workstream that an AI team can pick up independently while keeping the whole product coherent.

    ⟦ 引导模式｜已完成：PROFILE/SOUL/MEMORY 写入，BOOTSTRAP 删除；项目概览文件夹 01 创建；下一步：完成 02-08 分章 README，准备交付给 AI 团队；锚点：Damion, Romy, Post Card OS, spatial UI, paper planes, guest orchestration, Rust kernel backend ⟧