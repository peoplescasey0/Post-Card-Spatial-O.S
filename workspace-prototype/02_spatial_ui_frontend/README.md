# Section 02 — Spatial UI Frontend

**Project:** Post Card OS Workspace Prototype  
**Section:** Tauri app + Three.js spatial card studio  
**Current state:** Vite + TS frontend exists (`src/blueprints.ts`, `src/main.ts`, `index.html`). Tests cover theme engine, carousel poses, selection emissive sync.  
**Direction:** Migrate from bare Vite dev server to **Tauri v2** so it produces signed installers (Windows `.msi`/`.dmg`, macOS `.app`), auto-updates, and native sidecar binaries for QEMU/swtpm.  
**Fit into project:** This is the user-facing product layer. It consumes the Rust backend modules (`native_hud.rs`, `framebuffer.rs`, `heap.rs`) via IPC. When Tauri wraps, the "paper plane" drag-and-drop becomes a Tauri button → sends encrypted payload to target card.  

## What this is

A desktop desktop experience where cards are 3D objects on a curved arc. Users drag cards, scroll to browse, double-click to select, and move data between cards via paper planes. Built with TypeScript/Vite; next step = Tauri wrapper.

## Current files

- `src/blueprints.ts`
- `src/butler.ts`
- `src/card-actions.ts`
- `src/card-buttons.ts`
- `src/card-themes.ts`
- `src/carousel-pose.ts`
- `src/carousel-wheel.ts`
- `src/freeplane-engine.ts`
- `src/main.ts`
- `src/native-hud.ts`
- `src/opml-engine.ts`
- `src/spatial-node.ts`
- `src/style.css`
- `vite.config.mjs`
- `package.json`

## Direction / Vision

- **Tauri v2** production installer.
- **Paper Plane Protocol** as core transfer mechanism (not just a button).
- **Theme engine** persistence across view switches (Home ↔ Studio).
- **Reduced motion** honored during transitions.

## How it fits the whole project

```
┌──────────────────────┐
│  User sees cards     │  ← Section 02 (UI)
│  Paper planes send   │  ← Section 05 (Protocol)
│  Linux/Windows guests│  ← Section 04 (Orchestration)
└──────────────────────┘
```

The UI is the face people interact with daily. Everything else supports it.

## Handoff notes for AI team

1. **Tech stack:** TypeScript 5.9, Vite 7, Three.js 0.180, Tauri (planned), WebSocket telemetry.
2. **Key logic:** `fitWidthZ/H.fitHeightZ` z-depth calc, `distance` max(6.35, fitH, fitW), `twistedFactor`, `ring` layout.
3. **Existing tests:** 285 passing, including adversarial edge cases, rapid theme cycling, CSS specificity, DOM structure.
4. **Next work:** Wrap in Tauri, add signed installer generation, implement paper plane drag-to-send flow.

---

**Bottom line:** Ship a working Tauri app that lets users launch a card, drag another card, and see live VRAM pressure. That's the MVP.

    ⟦ 引导模式｜已完成：PROFILE/SOUL/MEMORY；01_project_overview/README 写入；下一步：创建 02-08 分章 README，准备交付给 AI 团队；锚点：Damion, Romy, Tauri, Three.js, spatial UI, paper planes ⟧