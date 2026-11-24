# Section 08 — Assets & Config

**Project:** Post Card OS Workspace Prototype  
**Section:** Static assets, guest disk images, env config, build config, and gitignore  
**Current state:**  
- `public/` — favicon, company logo, blueprints (mermaid diagrams).  
- `data/` — master images (Debian golden, Fedora golden), per-card overlays, Windows disks/firmware/TPM, Android disk, paper plane data.  
- `.env.example` — Stripe keys, ISO paths, QEMU/WSL paths.  
- `package.json`, `package-lock.json` — Node/Vite/Three.js dependency pins.  
- `vite.config.mjs`, `tsconfig.json` — build config.  
- `.gitignore` — excludes `data/`, `.env`, `node_modules`, `dist/`, `.vs/`.  
- `AGENTS.md` — workspace agent instructions.  
- `DEMO_VIDEO_PLAN.md` — demo script plan.  

## What this is

Everything that isn't code but makes the project runnable:

- **Guest images** — Debian/Fedora golden masters, Windows install media (bring your own), TPM state.  
- **Public assets** — logo, favicon, architecture blueprints.  
- **Env config** — Stripe keys, guest ISO paths, QEMU/WSL paths, remote KVM settings.  
- **Build config** — Vite, TypeScript, package.json.  

## Current files

```
public/
├── blueprints/          (mermaid diagrams)
├── company-logo.png/svg
└── favicon.svg

data/                    (gitignored)
├── android/
├── master-images/       (debian-golden.qcow2, fedora-golden.qcow2, postcard-minimal-kernel, OVMF)
├── overlays/            (per-card COW overlays)
├── windows/             (disks, firmware, tpm)
├── paper-planes/        (per-card plane folders)
└── card-id-registry.json, checkpoints.json, cpu-profiles.json, custom-isos.json

.env.example
package.json / package-lock.json
vite.config.mjs / tsconfig.json
.gitignore
AGENTS.md / DEMO_VIDEO_PLAN.md
```

## Direction / Vision

- **Public assets:** polish logo, add screenshots/demo GIF for landing page.  
- **Data:** keep gitignored; document setup process (QEMU install, ISO download).  
- **Env:** keep `.env` gitignored; `.env.example` documents all options.  
- **Build:** add `cargo.toml` when Rust backend becomes a Tauri sidecar or native build.  

## How it fits the whole project

Assets and config make the project *runnable*. Without `data/`, the guest orchestration has nothing to boot. Without `public/`, the UI has no brand. Without `.env.example`, onboarding breaks.

## Handoff notes for AI team

1. **Do not commit `data/` or `.env`** — they contain user private state.  
2. **`POSTCARD_WINDOWS_ISO`** must point to a licensed Windows ISO.  
3. **`POSTCARD_DEBIAN_ISO`** points to Debian netinst ISO.  
4. **`data/` size:** large QCOW2 files (multi-GB). Keep on fast storage.  
5. **Adding assets:** put public assets in `public/`, guest images in `data/`.  

---

**Bottom line:** Keep assets organized, keep `data/` gitignored, and document every env var in `.env.example`.

    ⟦ 引导模式｜已完成：PROFILE/SOUL/MEMORY；01-08 分章 README 全部写入；下一步：可选打包压缩或发送资料包给 AI 团队；锚点：Damion, Romy, assets, config, public/, data/, .env.example, gitignore ⟧