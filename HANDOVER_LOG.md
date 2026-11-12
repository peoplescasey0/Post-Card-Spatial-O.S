# Post Card Spatial OS: Architecture, Status & Handover Guide
*For VS Code Copilot, Claude, or any follow-on AI agent taking over the project.*

## 1. Project Overview & Architecture
Post Card Spatial OS is a 3D desktop virtualization studio built with **Three.js + TypeScript + Vite** on top of a multi-OS QEMU hypervisor engine in Node.js.

### Core Metaphors
- **3D Spatial Room**: Up to 6 concurrent Post Cards arranged on an orbital turntable.
- **6-Way Card Facets**:
  - `01 · DISPLAY`: Live guest video surface / noVNC screen.
  - `02 · SETTINGS`: CPU profiles, Eco RAM thinning, and persistent disk mounts.
  - `03 · SECURITY`: Zero-trust isolation boundary, golden base locks, Time-Travel savepoint logs.
  - `04 · PLANES`: Paper airplane note relay (QMP keystroke injection & VVFAT file drop).
  - `05 · ACTIONS`: Quick sandbox actions (Boot, Clone, Reset overlay, Send plane).
  - `06 · TELEMETRY`: Live ports (`5700` websocket, `4444` QMP, `4544` serial bridge), vCPU/RAM utilization.

---

## 2. Current Implementation Status

| Component | Status | Details & Paths |
| :--- | :---: | :--- |
| **Studio Web App** | ✅ Live | Running on `http://localhost:5173/` (`workspace-prototype`). |
| **Windows (bring your own ISO)** | ✅ BYO | No Windows media is bundled or defaulted. Users supply a licensed ISO via `POSTCARD_WINDOWS_ISO` or the card's custom-ISO action. Local installs live under gitignored `data/windows/`. |
| **Fedora Workstation** | ✅ Complete | Replaced legacy Debian. Base image at `data/master-images/fedora-golden.qcow2` (556 MB), overlay at `data/overlays/linux.qcow2`. |
| **Kali Cyber Range** | ✅ Complete | Card `kali-red`, isolated multicast VLAN (`230.0.0.1:4550`). |
| **Android Pocket Lab** | ✅ Complete | Official Android-x86 9.0 Pie image downloaded to `archive/guest-vm-setup/android-x86_64.iso` (965 MB). Successfully booted in QEMU with Eco RAM profile. |
| **macOS Cupertino** | ✅ Complete | Booted and verified via OpenCore UEFI + AppleSMC emulator (`isa-applesmc`) with `BaseSystem.img` on native Linux KVM via DirectLink Workstation (`10.0.0.2`). Reached the full graphical **macOS Utilities** desktop (Reinstall macOS, Disk Utility, Safari) in ~15 seconds (`ws: 5700`, `qmp: 4444`). |
| **DirectLink Workstation**| ✅ Connected | 1 Gbps direct link tunnel `10.0.0.1` ↔ `10.0.0.2` on Fedora 45 COSMIC Atomic (`casey@10.0.0.2`). Container builder `localhost/postcard-kvm:latest` ready. |
| **Automated Tests** | ✅ Passing | 44 / 44 tests green (`npm test` / `node --test tests/*.test.mjs`). Typecheck passes (`npx tsc --noEmit`). |

---

## 3. Key Files & Directory Layout
```text
g:/micro-host/
├── workspace-prototype/
│   ├── src/
│   │   ├── main.ts              # 3D room, card meshes, turntable, facets, animations
│   │   ├── card-actions.ts      # Card button routes (guest, shutdown, settings, bin)
│   │   ├── card-buttons.ts      # Canvas button hit-testing and states
│   │   ├── carousel-pose.ts     # 3D card layout and spatial depth arc
│   │   ├── butler.ts            # AI Butler assistance logic
│   │   └── style.css            # Studio UI styles & HUD styling
│   ├── guest-api.mjs            # Hypervisor engine: QEMU, swtpm, QMP, paper planes, snapshots
│   ├── index.html               # Main DOM shell, HUD buttons, modal dialogs
│   ├── data/
│   │   ├── master-images/       # fedora-golden.qcow2, debian-golden.qcow2
│   │   ├── overlays/            # linux.qcow2, android.qcow2, kali-red.qcow2
│   │   ├── windows/             # disks/windows.qcow2, firmware/windows-VARS.fd, tpm/
│   │   ├── custom-isos.json     # Custom ISO/QCOW2 path mappings per card
│   │   ├── paper-planes.json    # Flight logs and SHA-256 hash chains
│   │   └── checkpoints.json     # Time-Travel savepoint registry
│   └── tests/                   # 44 Node.js unit tests
├── archive/
│   └── guest-vm-setup/
│       └── android-x86_64.iso   # 965 MB Android-x86 9.0 Pie image
└── HANDOVER_LOG.md              # THIS FILE
```

---

## 4. Current Status & Next Polish Tasks

### Step 1: Operating System Verification (100% Complete)
- ✅ **Windows**: bring-your-own ISO only (nothing bundled); local installs boot from `data/windows/disks/<card>.qcow2`.
- ✅ **Fedora 45 Workstation**: Cloud base image at `data/master-images/fedora-golden.qcow2` with private overlay.
- ✅ **Kali Cyber Range**: Isolated multicast VLAN (`230.0.0.1:4550`).
- ✅ **Android Pocket Lab**: Booted from `android-x86_64.iso` with Eco RAM profile.
- ✅ **macOS Cupertino**: OpenCore UEFI + AppleSMC (`OpenCore.qcow2` on `sata.2`, `BaseSystem.img` on `sata.3`, private disk on `sata.4`). Boot picker and Apple kernel verified.

### Step 2: Implemented Studio Upgrades (Design Pillars 1–4 Complete)
- ✅ **Pillar 1: 3D Spatial Room & Lighting (Atmosphere)**:
  - Deep polished obsidian specular floor (`color: #070b14, roughness: 0.16, metalness: 0.88`) reflecting overhead spotlights and glowing card halos.
  - Dark titanium composite dais (`color: #0a101f, metalness: 0.84, roughness: 0.22`) with illuminated concentric rings.
  - Dynamic `cardHaloLight` and under-card specular pool `cardFloorGlow` that smoothly interpolate color and 3D position to track whichever Post Card is front-facing.
  - Translucent dais `glowDisc` with breathing pulsation and brand-matching tint.
- ✅ **Pillar 2: Physical Card Materials & Screen Bezels**:
  - Machined hex fasteners at all 4 chassis corners of every 3D card mesh and on 2D facet textures.
  - Top-right chassis status LED bead with dynamic emissive signaling (`#22c55e` running, `#f59e0b` starting/booting, `#06b6d4` standby, `#ef4444` error) and organic breathing pulse.
  - Chamfered hardware screen bezel frame enclosing the Facet 01 viewport.
  - CRT curvature perimeter vignette and diagonal glass specular reflection streak for authentic physical display feel.
- ✅ **Pillar 3: HUD & Pro AV Control Rack**:
  - Stereo VU peak meters in `av-suite-dialog` (CH 1 L / CH 2 R) with animated green, amber warn, and red clipping segments reacting to master volume and guest activity.
  - Live real-time sparkline telemetry waveform and vCPU burst grid on Facet 06 (Bottom).
  - Apple VisionOS frosted glassmorphism HUD (`blur(28px) saturate(190%)`) with inset specular highlights.
  - **Bubble UI Overhaul**: Replaced all stiff rectangular dialogs with 28px curved floating glass capsules, floating pill action buttons (`border-radius: 9999px`), organic spring entrance animations (`bubbleBloom`), capsule legends, and floating under-card action pod (`.card-action-strip`).
  - **Native Web Audio Synthesizer (Studio Sound FX)**: Zero external audio dependencies. Programmatic Web Audio API synthesizers for card facet flips (mechanical bandpass clicks), paper airplane launches (aerodynamic swept-filter whooshes), hypervisor boot chimes (warm harmonic triads), and master volume slider feedback pips.
- ✅ **Pillar 4: Dynamic Atmosphere Themes & Accessibility**:
  - Full-room dynamic lighting switching across 4 color-grade presets: Twilight Atelier (deep slate & amber), Cyberpunk SecOps (electric violet & neon cyan/magenta), Matrix Terminal (phosphor green & terminal black), and Vintage Rolodex (warm cardstock & brass).
  - CRT phosphor scanline toggle and reduced-motion accessibility accommodations.
- ✅ **Operator Field Guide & Help Manual**:
  - Comprehensive 9-chapter manual in `#help-dialog` covering 3D turntable navigation, 6-way facet flips, multi-OS hypervisor profiles, paper airplane note relays, pro AV control rack, DirectLink KVM acceleration, front bench mode (`B`), 3D reversible paper bin, and commercial editions. Includes persistent operator scratch notes stored in `localStorage`.
- ✅ **1-Click Desktop Launchers**:
  - `start-studio.bat`: Windows batch script that checks prerequisites, auto-installs dependencies if needed, verifies port 5173, starts the Vite background server, and opens the default browser automatically.
  - `launch-postcard-os.ps1`: Modern PowerShell launcher with port testing, background process spawning, and clean diagnostic output.
- ✅ **Bare-Metal Rust Micro-Host Kernel Attached**:
  - Restored compiled bare-metal `postcard-minimal-kernel` ELF (270 KB) and `ramdisk.img` (40 KB) to `target/x86_64-unknown-none/release/` and `workspace-prototype/data/master-images/`.
  - Updated `workspace-prototype/guest-api.mjs` to support direct `-kernel` and `-initrd` QEMU boot execution for `postcard-os` and custom kernel cards.
  - Added template option in `#add-card-template` and `ADD_CARD_TEMPLATES` for instant 1-click provisioning of the Rust Micro-Host Kernel card.
- ✅ **The 4 Commercial Monetization Models & Add-On Marketplace**:
  - **1. Freemium Core + Pro Suite (The Developer Model)**: Open-core Rust micro-host, basic QEMU virtualization, and 3D card turntable free forever. Paid Pro ($49/yr or $99 perpetual) unlocks Pro AV matrix, NVIDIA GPU compute sandbox, and 24-VM concurrent scaling.
  - **2. Enterprise Security & Forensics Edition (B2B SaaS / Appliance)**: Air-gapped compliance workstation for SecOps and corporate IT. Licensed per-seat / per-node with tamper-evident audit logs, isolated snapshot Time-Travel recovery, and golden base locks.
  - **3. AI Butler & Automation Subscription (Cloud-Assisted / Local Hybrid)**: $19/mo co-pilot subscription where hypervisor runs 100% locally protecting data privacy, while cloud-assisted intelligence orchestrates custom agent scripting, automated multi-VM provisioning, and predictive diagnostics.
  - **4. Modular "Add-On Marketplace" (The App Store Approach)**: Clean canvas with modular card slots. Purchase standalone DLCs: Pro A/V Plugin ($19), Deep-Dive Forensics Pack ($29), Advanced NVIDIA Compute Module ($39), or Swarm DirectLink 10.0.0.2 Gateway ($24).
  - Supported via interactive `#editions-dialog` (Key `M`), live `#selected-tier` HUD badge, and persistent storage.
- ✅ **AI Guided 3D Spatial Tour & 60FPS Video Demo**:
  - Built-in 62-second 7-stage automated cinematic tour (`#tour-button` / Key `T`).
  - Native 60FPS canvas video recorder (`#record-tour-button`) capturing directly via `canvas.captureStream(60)` and `MediaRecorder` into high-definition WebM/MP4 download (`postcard-spatial-os-demo-60fps.webm`).
  - Interruption-safe state machine covering Overview -> Traversal -> 6-Way Facets -> Paper Plane -> AV VU Rack -> SecOps Lab -> Commercial Matrix.

### Step 3: Next Horizons & Packaging Roadmap
1. **Single-Binary / Desktop App Packaging**:
   - Package the workspace prototype and hypervisor scripts into an Electron or Tauri desktop bundle with bundled QEMU binaries and direct link auto-discovery.
2. **Audio Stream Forwarding**:
   - Pipe virtual sound card audio (`ich9-intel-hda`) to browser Web Audio API via WebSocket.

---

## 5. Verification Commands
Always verify changes before concluding tasks:
```powershell
Set-Location g:\micro-host\workspace-prototype
npx tsc --noEmit
node --test tests/guest-api.test.mjs tests/butler.test.mjs tests/card-buttons.test.mjs tests/card-actions.test.mjs tests/card-bin.test.mjs tests/carousel-pose.test.mjs tests/wheel-carousel.test.mjs tests/compact-private-preview.test.mjs tests/windows-path.test.mjs
git status --short
```


## 6. Legal posture: bring-your-own media
Post Card OS ships **no** Windows or Apple media, keys, or personal hosts.
- Windows: supply your own ISO via `POSTCARD_WINDOWS_ISO` or the card's custom-ISO action.
- macOS: supply your own recovery image, OpenCore, and SMC key (`POSTCARD_MAC_OSK`; on a remote KVM host, put it in `<workdir>/mac-osk.txt`). The remote host is opt-in via `POSTCARD_KVM_HOST`.
- All of the above live in gitignored `.env` / `data/`. Never commit them.
