# Technical Survey & Architecture Report: Test Infrastructure, Fedora Workstation Utilization, and Spatial Card Theming

**State Folder**: `g:\micro-host\.agents\teamwork\explorer_survey_3\`  
**Date**: 2026-11-11  
**Integrity Mode**: Development  

---

## 1. Observation

### 1.1 Automated Test Suite and Build Infrastructure
- **Workspace Prototype Test Runner**:
  - `workspace-prototype/package.json` line 10 specifies `"test": "node --test"`.
  - Executing `cd workspace-prototype; npm test` ran all 12 test files across 63 tests in 22.5s:
    ```text
    ✔ butler stays quiet when all is well (406.3988ms)
    ✔ on-card guest controls reflect install, launch, resume, running, and busy states (1.9884ms)
    ✔ every printed button is hit at its own center and stays inside the card (249.6793ms)
    ✔ carousel poses carry cards through a visible spatial depth arc (2.2892ms)
    ✔ guest status reports persistent Windows card disks (166.341ms)
    ✔ Milestone 5 DOM Stress Test: index.html HUD buttons, overlay, and badges (12.095ms)
    ✔ Milestone 5 CSS & Z-Index Layering: style.css HUD & Tour overlay (2.6087ms)
    ℹ tests 63 | pass 63 | fail 0 | cancelled 0 | skipped 0
    ```
  - `npm run build` in `workspace-prototype` executes `tsc --noEmit && vite build`. Transpilation and bundling completed cleanly in 7.28s generating `dist/index.html` (87.05 kB), `dist/assets/index-*.css` (92.83 kB), and `dist/assets/index-*.js` (867.55 kB).
- **Full System Build Pipeline (`build-all.ps1`)**:
  - `build-all.ps1` lines 36-153 orchestrates:
    1. IPC Client SDK (`cargo check` in `integrations/romy-ipc-sdk`)
    2. Spatial Studio 3D UI (`npm run build` in `workspace-prototype`)
    3. Bare-Metal Micro-Kernel (`cargo build --release --target x86_64-unknown-none --target-dir target` in `kernel`)
    4. Multiboot2 ELF verification via WSL (`grub-file --is-x86-multiboot2`)
    5. Bootable Hybrid ISO generation via WSL (`bash scripts/create_iso.sh`)
    6. Optional `-RunTests` flag running `npm test` and WSL QEMU Serial Shell test suite (`bash scripts/shell_test.sh -t 40`, 159 tests).
- **Existing Test Coverage & Identified Gaps**:
  - `workspace-prototype/tests/card-buttons.test.mjs` lines 12-25 tests UV hit-testing (`hitCardButton`) for the 8 printed buttons (`guest`, `stop`, `zoom`, `settings`, `clone`, `savepoint`, `performance`, `bin`).
  - `workspace-prototype/tests/card-actions.test.mjs` lines 19-64 tests button state transitions (`getOnCardActionState`) and shutdown/delete isolation.
  - `workspace-prototype/tests/carousel-pose.test.mjs` lines 18-39 tests 3D arc positions and perspective scale.
  - `workspace-prototype/tests/m5_challenger_tour.test.mjs` lines 10-62 tests DOM HUD elements, styles, and tier matrix.
  - **Gap G1 (Floor Collision)**: No existing test verifies that cards cannot be dragged or placed below the floor plane during direct manipulation (`drag.mode === 'move'`).
  - **Gap G2 (Card Theming)**: No existing test verifies card theme definitions, palette tokens, theme selector controls, or canvas/material theme re-rendering.
  - **Gap G3 (Home Screen Buttons)**: No test dispatches events across the 123 DOM buttons and landing home screen card links (`[data-open-studio]`, `[data-card-id]`).

### 1.2 Fedora Workstation Environment & Connectivity (Requirement R3)
- **Local WSL vs Remote Workstation Configuration**:
  - Running `wsl -l -v` confirmed local WSL has only one distribution installed:
    `Ubuntu (Version 2, State: Running)`.
  - `C:\Users\Casey\.ssh\config` lines 1-11 configures SSH host aliases:
    ```ssh
    Host fedora fedora-workstation directlink
        HostName 10.0.0.2
        User casey
        IdentityFile ~/.ssh/id_ed25519
        StrictHostKeyChecking accept-new
    ```
  - `workspace-prototype/.env` lines 14-15 specifies:
    ```env
    POSTCARD_KVM_HOST=casey@10.0.0.2
    POSTCARD_KVM_WORKDIR=/home/casey/postcard-kvm
    ```
- **Direct Link Connectivity & Latency**:
  - Executing `ssh -o BatchMode=yes fedora "ping -c 2 10.0.0.1"` succeeded with 0% packet loss and 0.70 ms round-trip latency over the 1 Gbps direct peer-to-peer Ethernet link.
- **Fedora Workstation Hardware & OS Verification**:
  - Executing `ssh -o BatchMode=yes fedora "uname -a; cat /etc/os-release"` confirmed:
    - OS: Fedora Linux 45.20261030.n.0 (COSMIC Atomic desktop), Kernel `7.2.11-300.fc45.x86_64`.
    - CPU: Intel Core i5-10300H (4 cores / 8 threads @ 2.50 GHz up to 4.50 GHz).
    - RAM: 15 GiB total (13 GiB available, 2.2 GiB used, 8.0 GiB swap).
    - Storage: NVMe filesystem mounted at `/var/home` with 314 GB free (34% used of 475 GB).
- **Installed Runtimes & Containerization on Fedora**:
  - Node.js: `/home/casey/.nvm/versions/node/v26.13.0/bin/node` (v26.13.0) and npm.
  - Rust: `/home/casey/.cargo/bin/cargo` and `rustc`.
  - Podman: `/usr/bin/podman` with pre-built images:
    - `localhost/postcard-kvm:latest` (516 MB container containing QEMU, swtpm, edk2-ovmf, socat, python3-websockify).
    - `quay.io/fedora/fedora-bootc:43` and `localhost/postcard-linux`.
  - Virtualization & Tooling: `/usr/bin/qemu-system-x86_64`, `/usr/bin/python3`, `/usr/bin/git`.
  - Headless Browser: `/usr/bin/firefox` (Mozilla Firefox 158.0.1).
  - Executing `ssh fedora "firefox --headless --screenshot /tmp/test.png https://example.com"` generated a valid 95 KB screenshot headlessly in ~3 seconds.
- **Existing Workloads in `/home/casey/postcard-kvm`**:
  - `run-macos.sh`: Automated macOS KVM boot with OpenCore UEFI and AppleSMC emulator.
  - `remote_fedora_node.py`: Micro HTTP service on port `8080` serving `/api/node/status` with CPU load, free memory, and system telemetry.
  - `control-server.py`: HTTP service on port `6080` sending QMP keystrokes (space, enter, BypassNRO) to running QEMU instances.

### 1.3 Card Theming Landscape & Current Workspace State (Requirement R1)
- **Current Color Grading Profile vs Card Theming**:
  - `workspace-prototype/src/main.ts` lines 2707-2749 contains a room lighting selector `#color-grade-profile` (Twilight, Cyberpunk, Monochrome, Vintage).
  - This selector **only** modifies Three.js point lights (`cardHaloLight`, `cardFloorGlow`, `fillLight`, `rimLight`, `duskLight`) and `renderer.toneMappingExposure`.
  - It does **not** alter card facet textures, 2D canvas backgrounds, borders, buttons, or typography.
- **Card Rendering Pipeline**:
  - `workspace-prototype/src/main.ts` lines 3064-3120 (`makeCardTexture`): Card textures are rendered to an offscreen 1280x1920 HTML5 Canvas (`context.scale(2, 2)`).
  - Card background is hardcoded:
    `const gradient = context.createLinearGradient(0, 0, 640, 960);`
    `gradient.addColorStop(0, "#14161B"); gradient.addColorStop(0.58, "#0D111A"); gradient.addColorStop(1, "#0D111A");`
  - Card border is hardcoded to `${meta.accent}55` with width 2.
  - Card buttons in `drawCardButtons` lines 3383-3405 have hardcoded background `#07090ee8`, border accent `${accent}b0`, and text `#f4f5f7`.
  - Three.js material in lines 2991-3016 is hardcoded: `roughness: 0.88`, `metalness: 0.02`, `emissive: "#ffffff"`, `emissiveIntensity: 0.82`.
  - Texture caching in `refreshCardTexture` lines 4676-4705 relies on `computeCardContentKey(card)`. The key currently tracks `status`, `facet`, `twisted`, `resetCount`, and notes, but has **no knowledge of card theme**.
- **Home Screen vs Studio Layout**:
  - `workspace-prototype/index.html` lines 17-165 defines `<main class="home-view" id="home-view" hidden>` with system cards (`.home-system-card` for Android, Windows, Linux, macOS, Kali) and `<button class="home-primary-button" data-open-studio>`.
  - In `src/main.ts`, line 249 selects `#studio-view`, but `[data-open-studio]` has no attached event listener; `#home-view` is statically hidden while `#studio-view` is active.

### 1.4 Card Floor Collision Defect Analysis (Requirement R2)
- **Geometry & Coordinate Definitions**:
  - `workspace-prototype/src/main.ts` lines 983-984: `CARD_WIDTH = 2.15; CARD_HEIGHT = 3.2;`.
  - The card mesh geometry origin is centered at `(0, 0, 0)`.
  - Card bottom edge is at $y_{\text{bottom}} = y_{\text{center}} - \frac{\text{CARD\_HEIGHT}}{2} \cdot \text{scale} = y_{\text{center}} - 1.6 \cdot \text{scale}$.
  - Floor mesh (lines 587-596) has position `floor.position.y = -0.12`.
- **Observed Direct Manipulation Clamping**:
  - `workspace-prototype/src/main.ts` lines 6347-6352 handles free dragging:
    ```typescript
    if (drag.mode === "move" && drag.card) {
      if (!raycaster.ray.intersectPlane(dragPlane, dragPoint)) return;
      drag.card.group.position.copy(dragPoint.add(drag.offset ?? new THREE.Vector3()));
      drag.card.group.position.x = THREE.MathUtils.clamp(drag.card.group.position.x, -7.8, 7.2);
      drag.card.group.position.y = THREE.MathUtils.clamp(drag.card.group.position.y, 0.6, 5.2);
      drag.card.group.position.z = THREE.MathUtils.clamp(drag.card.group.position.z, -6.6, 2.5);
    ```
  - Clamping `position.y` to a minimum of `0.6` causes the card's bottom edge to reach $0.6 - 1.6 = -1.0$.
  - Because the floor plane is at $y = -0.12$, the card penetrates through the floor by $-0.12 - (-1.0) = 0.88$ units (almost 1 meter below the floor).
- **Secondary Collision Gaps**:
  - `resolveCardCollisions` (lines 4182-4220) checks only horizontal overlap `minSepX` and `minSepZ`, ignoring floor bounds.
  - When releasing a drag (`pointerup`, lines 6446-6453), `layoutOffset` stores the displacement without clamping, allowing cards to remain positioned below the floor during turntable rotations.

---

## 2. Logic Chain

1. **Test Infrastructure & Automation**:
   - *Premise*: Acceptance criteria require workspace automated test suites to pass and verification of card interactions, theming, and buttons.
   - *Step 1*: The workspace already has an automated runner (`node --test`) with 63 passing unit tests and a TypeScript typechecking build (`tsc --noEmit && vite build`).
   - *Step 2*: Creating a new test file `workspace-prototype/tests/card-theming-collision.test.mjs` will fit natively into `npm test` without introducing third-party dependencies or altering the build pipeline.
   - *Step 3*: The test can transpile and import the theming tokens, floor collision clamping function, and DOM button handlers using the proven patterns in `tests/card-buttons.test.mjs` and `tests/m5_challenger_tour.test.mjs`.

2. **Fedora Workstation Utilization (R3)**:
   - *Premise*: R3 mandates utilizing the Fedora workstation for executing, offloading, or validating tasks as needed.
   - *Step 1*: The Fedora workstation at `10.0.0.2` is online, reachable via SSH (`ssh fedora`), has 8 CPU threads, 13 GB free RAM, and a 0.7 ms direct link to Windows.
   - *Step 2*: Fedora has Node.js v26.13.0 and npm, allowing remote execution of test suites (`ssh fedora "cd ...; npm test"`).
   - *Step 3*: Fedora has Mozilla Firefox 158 with verified headless screenshot capabilities (`firefox --headless --screenshot`).
   - *Step 4*: By serving the built prototype (`npm run preview` on `http://0.0.0.0:5173`), headless Firefox on Fedora can load `http://10.0.0.1:5173/`, exercise the DOM, and capture screenshots of card themes and floor placement without consuming host Windows GPU/CPU.
   - *Step 5*: Fedora's `remote_fedora_node.py` on port 8080 provides a ready-made health/telemetry endpoint for cross-node validation.

3. **Spatial Card Theming Architecture (R1)**:
   - *Premise*: Spatial card theming requires harmonious styling across 2D canvas textures, 3D Three.js physical materials, and spatial lighting.
   - *Step 1 (Theming Patterns)*: Android Material 3 Dynamic Color, AMOLED minimal dark, cyberpunk neon, and frosted glass represent the most effective visual paradigms for spatial interfaces.
   - *Step 2 (Token System)*: Defining a centralized theme dictionary (`CARD_THEMES`) with tokens for canvas gradients, border strokes, button colors, Three.js roughness/metalness/emissive, and halo lighting creates a single source of truth.
   - *Step 3 (Theme Invalidation)*: Injecting `card.theme` into `computeCardContentKey` ensures that when a theme changes, `refreshCardTexture(card, true)` automatically invalidates cached canvas textures and re-renders all facets.
   - *Step 4 (Controls & UI)*: Providing both a global theme selector (in the topbar / home screen) and a per-card theme option in Card Settings satisfies both broad customization and fine-grained per-system branding.
   - *Step 5 (Persistence)*: Storing the active theme in `localStorage` under `postcard_studio_card_theme` matches existing storage patterns in `main.ts` (`PROFILE_STORAGE_KEY`, `REDUCE_MOTION_KEY`).

4. **Card Floor Collision Enforcement (R2)**:
   - *Premise*: Cards cannot be moved, dragged, or placed below the floor plane ($y = -0.12$).
   - *Step 1*: With card half-height $1.6$ and an elevation clearance of $0.04$ to prevent z-fighting with the dais, the absolute minimum center $y$ is:
     $$y_{\text{min}} = y_{\text{floor}} + \left(\frac{\text{CARD\_HEIGHT}}{2}\right) \cdot \text{scale} + \text{clearance} = -0.12 + 1.6 \cdot \text{scale} + 0.04 = 1.52 \cdot \text{scale}$$
     For full-scale cards ($\text{scale} = 1.0$), $y_{\text{min}} = 1.52$. When considering corner tilt ($\pm 15^\circ$), a conservative bound of $y_{\text{min}} = 1.55$ guarantees clearance under all angular orientations.
   - *Step 2*: Enforcing this bound in three places guarantees complete collision immunity:
     1. Drag handler: `drag.card.group.position.y = Math.max(minCenterY, clampedY)`
     2. Collision resolver: `resolveCardCollisions` iterates all cards and clamps `pos.y = Math.max(minCenterY, pos.y)`
     3. Drop/offset handler: When computing `layoutOffset`, ensure `targetPosition.y = basePosition.y + layoutOffset.y >= minCenterY`.

5. **Button Reliability Verification (R2)**:
   - *Premise*: All interactive buttons across the cards and home screen interface must function reliably without runtime errors.
   - *Step 1*: On-card buttons (8 buttons) use UV hit-testing in `hitCardButton`. Existing tests verify coordinate hit detection.
   - *Step 2*: Home screen landing buttons (`[data-open-studio]`, `[data-card-id]`) require event handlers to smoothly transition between `#home-view` and `#studio-view`.
   - *Step 3*: Dialog close buttons and action buttons must have fail-safe event listeners to guarantee no uncaught exceptions.

---

## 3. Caveats

1. **DirectLink Network Dependency**:
   - The primary IP `10.0.0.2` relies on the physical direct link Ethernet cable being connected between Windows and the Fedora workstation. A secondary Wi-Fi IP (`10.0.0.130`) exists in `~/.ssh/config` as fallback if the direct link interface is down.
2. **WebGL Context in Headless Browser**:
   - Headless Firefox on Fedora renders standard DOM, CSS glassmorphism, and SVG cleanly. Full Three.js WebGL 3D canvas rendering in headless mode depends on Mesa software rasterization (llvmpipe/swrast), which was verified functional on Fedora, but may render at lower framerates than a hardware GPU.
3. **Card Scale Dynamic Variation**:
   - Cards in the turntable deck scale between $0.64$ (rear of turntable) and $1.04$ (front focus). The minimum center $Y$ calculation should dynamically scale with `card.scale` or use the safe upper bound $1.55$ so cards never clip when dragged across varying depth planes.

---

## 4. Conclusion

### 4.1 Fedora Workstation Utilization Plan (R3)
- **Role 1 — Headless Automated Validation**:
  - Run `firefox --headless --screenshot <output_path> http://10.0.0.1:5173/` on the Fedora workstation to visually validate theme switching, layout compliance, and button states.
- **Role 2 — Cross-Platform Test Execution**:
  - Use SSH to execute workspace unit tests under Fedora's native Linux Node.js v26 runtime:
    `ssh fedora "node --test ..."` to ensure complete cross-platform parity between Windows and Linux.
- **Role 3 — Virtualization Offloading**:
  - Retain and leverage existing DirectLink KVM workloads (`localhost/postcard-kvm:latest`) for heavy guest virtualization (macOS Cupertino KVM, Ollama AI inference on port 11434).

### 4.2 Card Theming Architecture (R1)
Implement 5 rich, distinct card themes:
1. **Classic Studio**: Slate cardstock (`#14161b` -> `#0d111a`), cyan precision border (`#70d5cf`), matte texture (`roughness: 0.85, metalness: 0.05`).
2. **Cyberpunk Neon**: Midnight obsidian (`#0b0416` -> `#05020a`), neon magenta/cyan dual-stroke (`#ff007f` / `#00f0ff`), high emissive glow (`intensity: 0.95`), glossy chassis (`roughness: 0.25, metalness: 0.70`).
3. **Minimal Dark**: Pure AMOLED black (`#050505` -> `#000000`), micro-thin zinc border (`#27272a`), muted silver typography (`#a1a1aa`), anti-reflective matte (`roughness: 0.96, metalness: 0.0`).
4. **Glass / Frosted**: Translucent ice-blue gradient (`rgba(26, 38, 57, 0.75)` -> `rgba(13, 20, 32, 0.85)`), crystal specular highlight, polished acrylic (`roughness: 0.15, metalness: 0.10`), ethereal cyan halo.
5. **Material Vibrant**: Android Expressive indigo surface (`#181124` -> `#0e0918`), warm amber/coral accents (`#f59e0b` / `#8b5cf6`), satin tactile finish (`roughness: 0.65, metalness: 0.15`).

**Theming Data Structure**:
```typescript
export type CardThemeId = "classic" | "cyberpunk" | "minimal-dark" | "glass" | "material-vibrant";

export interface CardThemeDefinition {
  id: CardThemeId;
  name: string;
  description: string;
  canvas: {
    bgTop: string;
    bgBottom: string;
    borderStroke: string;
    borderWidth: number;
    badgeColor: string;
    headerColor: string;
    titleColor: string;
    detailColor: string;
    buttonFill: string;
    buttonStroke: string;
    buttonText: string;
    fastenerRim: string;
    fastenerHead: string;
  };
  material: {
    roughness: number;
    metalness: number;
    emissive: string;
    emissiveIntensity: number;
  };
  lighting: {
    haloColor: string;
    haloIntensity: number;
    floorGlowColor: string;
    floorGlowIntensity: number;
  };
}
```

**UI Controls**:
- Provide a theme picker dropdown/chips in the Spatial Studio topbar and on the `#home-view` landing screen.
- Persist theme selection in `localStorage` (`postcard_studio_card_theme`).
- Update `computeCardContentKey(card)` to include `card.theme ?? globalTheme` so `refreshCardTexture(card, true)` automatically repaints the canvas textures.

### 4.3 Floor Collision Enforcement (R2)
- Replace arbitrary `MathUtils.clamp(pos.y, 0.6, 5.2)` with:
  ```typescript
  const FLOOR_Y = -0.12;
  const CARD_HALF_HEIGHT = 1.6;
  const FLOOR_CLEARANCE = 0.04;
  export function minCardCenterY(scale = 1.0): number {
    return FLOOR_Y + CARD_HALF_HEIGHT * scale + FLOOR_CLEARANCE; // >= 1.52
  }
  ```
- Enforce `minCardCenterY` in:
  1. `drag.mode === "move"`
  2. `resolveCardCollisions`
  3. `completedDrag.mode === "move"` offset calculation
  4. Turntable frame update loop

### 4.4 Button & Home Screen Navigation Polish (R2)
- Wire `[data-open-studio]` on `#home-view` to reveal `#studio-view`, hide `#home-view`, and select the targeted card (`data-card-id`).
- Add a topbar "Home" / "Overview" button to allow users to navigate back to `#home-view` from the Spatial Studio.
- Ensure all 123 buttons in `index.html` have click handlers, native `<form method="dialog">` handling, or explicit delegation handlers.

---

## 5. Verification Method

### 5.1 Workspace Unit Test Suite
Run from `workspace-prototype/`:
```powershell
cd g:\micro-host\workspace-prototype
npm test
```
*Expected*: All existing 63 tests pass, plus any new theming, collision, and button tests.

### 5.2 TypeScript Compilation & Production Build
```powershell
cd g:\micro-host\workspace-prototype
npm run build
```
*Expected*: `tsc --noEmit` exits with 0 errors and `vite build` bundles cleanly into `dist/`.

### 5.3 Fedora Workstation Remote Validation
Test connectivity and headless browser offload:
```powershell
# 1. Verify SSH and Node on Fedora
ssh -o BatchMode=yes fedora "node -v"

# 2. Verify headless screenshot rendering
ssh -o BatchMode=yes fedora "firefox --headless --screenshot /tmp/fedora_ui_test.png https://example.com"
```
*Expected*: Both commands return exit code 0.

### 5.4 Floor Collision & Interactive Verification
- Start dev server: `npm run dev` (or `launch-postcard-os.ps1`).
- Open `http://localhost:5173/`.
- Press `Shift + Drag` to move any card down toward the floor.
- *Expected*: The bottom edge of the card comes to a hard physical stop above the obsidian floor ($y \ge -0.12$) and cannot be dragged through the dais or floor plane.
- Click theme selector: switch between Classic, Cyberpunk, Minimal Dark, Glass, and Material Vibrant.
- *Expected*: All cards on the home screen immediately repaint their canvas textures, 3D material reflections, and floor halos.
- Refresh the browser: theme choice persists from `localStorage`.
