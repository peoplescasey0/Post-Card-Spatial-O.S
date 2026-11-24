# Panoramic Cockpit Arc, 6-Room Environments & 9-Dot Tactile Flip Design

**Date:** 2026-11-24  
**Project:** Post Card OS Workspace Prototype (`workspace-prototype`)  
**Status:** Finalized for Approval  

---

## 1. Intent and the "Why"

The Post Card Spatial OS workspace was originally conceived as a **panoramic multi-window cockpit** where multiple virtual machine cards (Debian, Windows 11, Butler, notes) sit comfortably within peripheral view, allowing natural multi-tasking, visual monitoring, and physical data transfer via paper planes.

Alongside this ergonomic layout, the user envisioned:
1. **Environmental Theming:** Full-room transformations inspired by signature Android Material You / Dynamic Color atmospheres (e.g., a warm, wood-and-parchment scholar's library with a brass Rolodex feel, a clean daylight minimalist studio, an orbital flight cockpit, etc.).
2. **Mix-and-Match Customization:** Complete freedom to pair any 3D Room Environment with any 2D/3D Card Surface Style (e.g., placing vintage Rolodex parchment cards inside an orbital cockpit, or glass HUD cards inside a warm walnut library).
3. **Patent Subsystem Demonstrability:** Tangible UI mechanisms to show, test, and fault-inject patent-grade kernel subsystems (OmegaLog UPG, Point-ISA / DataMeld PVM, DIOV Streams, Boot OROM Sandboxing, Inter-Kernel SLM Sharing) even in simulated environments or across networked physical workstations.
4. **9-Dot Tactile Card Face Flip Matrix:** A 3x3 grid of 9 tactile points on the card face where clicking any point physically tumbles the card in that direction—expanding the standard 6-way flips with compound diagonal corner flips that open the dedicated Patent Enclaves.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Panoramic Cockpit Layout:** Retune the turntable orbit into a wide, shallow concave arc where 3 to 4 cards are clearly legible and visible side-by-side (facing inward, scale ~0.95, zero artificial blur on active arc slots).
- **6 Distinct 3D Room Environments:** Implement full 3D room transformations (background/sky, floor material/textures, primary lighting, and environmental accents) for the 6 core themes:
  1. *Pixel Studio* (Clean architectural daylight, warm matte gray/birch floor, studio frame props).
  2. *Sunset Amber Library* (Golden-hour warmth, rich walnut desk surface, banker's lamp glow, wooden book alcove props).
  3. *Forest Emerald* (Botanical conservatory, deep slate/mossy matte surface, vertical bamboo/slate baffle props).
  4. *Lavender Mist* (Twilight horizon, frosted ambient glow, calm minimal architecture).
  5. *Obsidian Monochrome* (Bauhaus gallery, matte carbon floor, crisp neutral overhead spots, zero glare).
  6. *Cyber Mainframe* (The high-tech command deck, glowing telemetry dais, neural monolith towers with LED strips).
- **Decoupled Mix-and-Match Architecture:** Allow the user to independently choose:
  - **Room Environment** (Stage, floor, lighting, backdrop).
  - **Card Surface Style** (Parchment Rolodex, Glass HUD, Squircle Material, Matte Cardstock, OLED Obsidian).
  - Include 1-click **Curated Pairings** so picking a preset applies both the matching room and card style seamlessly.
- **9-Dot Tactile Flip Matrix:**
  - Support a 3x3 touch grid printed on the card face and mirrored in the Studio Flip Compass.
  - 4 cardinal flips (Up, Down, Left, Right) + Center (180° flip).
  - 4 compound diagonal corner flips unlocking Facets 07 (Patent Lab / Chaos Injection), 08 (Inter-Kernel SLM Enclave), and 09 (DIOV Streams Inspector).
- **Card Backface & Cockpit Patent Instrumentation:**
  - Facet 02 Back: Live Hardware Enclave with Option ROM sandbox status and DataMeld PVM metrics.
  - Facets 07–09: Interactive test buttons (`[ Trigger OmegaLog Checkpoint ]`, `[ Inject Faulty ROM ]`, `[ Benchmark SLM Sharing ]`).
  - Cockpit Avionics Dash: Streamline DIOV throughput and kernel telemetry gauges.
- **Persistence:** Save both the selected room environment and card style in `localStorage` with smooth rehydration across boots.
- **Accessibility & Reduced Motion:** Respect `prefers-reduced-motion` settings, keyboard navigation (arrow keys, 1-6 flips), and maintain dual-sided card backface visibility without z-fighting.

### Non-Goals
- Changing the underlying QEMU / WSL 2 / VNC guest orchestration or guest API limits (remains capped at 4 concurrent guests and 8 GiB RAM).
- Replacing Three.js with another 3D rendering library.
- Overhauling noVNC to run 4 concurrent live interactive WebGL RFB streams simultaneously; the active card receives the primary interactive RFB session, while peripheral cards display cached live framebuffer snapshots.

### Anti-Goals
- **No single-card carousel lock-in:** Do not force peripheral cards into extreme edge-on angles or aggressive blur when the user is trying to multitask across cards.
- **No hardcoded monoliths across all themes:** Server monoliths and neon dais lines must belong strictly to the *Cyber Mainframe* theme and must not pollute serene environments like *Pixel Studio* or *Sunset Amber Library*.
- **No breaking changes to existing tests:** Ensure all 338 existing Node tests (adversarial edge cases, dynamic seed generation, texture disposal, dataset syncing, DOM structure) remain 100% green.

---

## 3. Approaches Considered & Builder Decisions

### Approach 1: Decoupled Two-Axis Theming with Curated Pairings (Selected)
- **Concept:** Expose two linked selectors in the studio UI: `Room Environment` and `Card Style`. Curated presets (e.g. "Sunset Library") set both simultaneously, but the user can freely override either independently.
- **Card Arrangement:** Standardize on the Panoramic Cockpit Arc across all themes.

### Builder Review Resolutions
1. **Turntable Physics vs. Panoramic Arc Math:**
   - *Decision:* Retain `carouselPoseFromAngle(theta)` as the underlying math engine so all continuous dragging, inertia flings, wheel stepping, and test regexes remain 100% intact.
   - *Tuning:* The elliptical formula is retuned to a wide concave cockpit arc:
     - `x = 5.85 * Math.sin(theta)` (wider horizontal field)
     - `z = 2.4 * Math.cos(theta) + 0.4` (shallow depth variation so peripheral cards stay forward)
     - `scale = 0.88 + depth * 0.16` (peripheral cards stay large at scale ~0.92–0.96 rather than shrinking to 0.64)
     - `y = 2.64 + (Math.cos(theta) - 1) * 0.18` (subtle vertical curve)
   - Camera is positioned at `(0, 3.4, 12.8)` looking at `(0, 2.5, 0)` with FOV 42° to give immediate touchable presence.
2. **Multi-Tasking Scope on Peripheral Cards:**
   - *Decision:* Peripheral cards remain visually sharp (focus settling angle widened, blur disabled for active arc slots, inward angle clamped to 8°), showing live or cached OS states.
   - User actions (Open Guest, Flip, Settings) remain bound to `selectedCard`, which pops forward `z + 0.5`. Clicking any peripheral card glides it into center focus.
3. **Card Style Taxonomy & Persistence:**
   - Existing `CARD_THEME_IDS` (5 canonical) and `ANDROID_THEME_IDS` (5 Android) remain intact as the **Card Style** catalog.
   - A new `ROOM_ENVIRONMENT_IDS` catalog defines the 6 room environments:
     `["pixel-studio", "sunset-library", "forest-emerald", "lavender-mist", "obsidian-monochrome", "cyber-mainframe"]`.
   - `postcard_studio_room_env` stores the active room (defaults to `"sunset-library"` or `"pixel-studio"`).
   - `postcard_studio_card_theme` stores the card style (defaults to `"classic"` or `"sunset-amber"`).
   - If `seed:#HEX` is supplied, it calculates the Material You tonal palettes for the card and tints the room's accent lighting.
4. **Theme Picker UI Placement:**
   - The 2D Home View (`#home-view`) retains its existing 5 canonical chips (`.home-theme-picker`) to satisfy strict DOM invariants.
   - The 3D Studio View (`#studio-view`) hosts the new **Two-Axis Mix-and-Match Inspector** (Quick Presets, Room Selector, Card Style Selector).
5. **Dais Platform & Collision Height Invariants:**
   - The dais platform height (`y = 0.105`) and `getFloorHeightAt()` clamping logic remain constant across all themes to preserve collision invariants.
   - Floor appearance changes via PBR material swapping (walnut wood grain, matte gray birch, slate, carbon fiber, obsidian mirror).
   - The Observatory Window and Cosmic Starfield are hidden in indoor environments (*Pixel Studio*, *Sunset Library*, *Forest Emerald*) and active in space/tech environments (*Lavender Twilight*, *Cyber Mainframe*).

---

## 4. Architectural & Technical Specification

### 4.1. 9-Dot Tactile Flip Grid & Diagonal Corner Tumbles
Card canvas dimensions are 640x960. The 9-dot touchpoints are positioned on the card face:
```ts
export type FlipDotId =
  | "top-left"     // Facet 07: Patent Lab & Chaos Injection
  | "top-center"   // Facet 05: Top / Quick Actions (W)
  | "top-right"    // Facet 08: Inter-Kernel SLM Enclave
  | "mid-left"     // Facet 03: Left / Security & Network (A)
  | "center"       // Facet 01/02: Front / Back Toggle (F)
  | "mid-right"    // Facet 04: Right / Paper Planes (D)
  | "btm-left"     // Facet 09: DIOV Streams & Fabric Inspector
  | "btm-center"   // Facet 06: Bottom / Telemetry & Ports (S)
  | "btm-right";   // Facet 10: Reset / Memory Map

export const FLIP_DOT_LOCATIONS: Record<FlipDotId, { x: number; y: number }> = {
  "top-left":   { x: 48,  y: 48 },
  "top-center": { x: 320, y: 48 },
  "top-right":  { x: 592, y: 48 },
  "mid-left":   { x: 48,  y: 480 },
  "center":     { x: 320, y: 480 },
  "mid-right":  { x: 592, y: 480 },
  "btm-left":   { x: 48,  y: 912 },
  "btm-center": { x: 320, y: 912 },
  "btm-right":  { x: 592, y: 912 },
};
```
Clicking a corner dot initiates a compound 3D flip animation (`targetRotationY = ±PI/2, targetRotationX = ±PI/2`) into the corresponding diagnostic facet.

### 4.2. Patent Diagnostic Enclaves & Test Triggers
- **Facet 07 (Top-Left): Patent Lab & Chaos Injection**:
  - Live verification of **OmegaLog UPG** microsecond crash checkpoints.
  - Interactive hitboxes: `[ Trigger OmegaLog Checkpoint ]`, `[ Inject Option ROM Fault ]`.
  - Displays instant recovery verdict and verification signature.
- **Facet 08 (Top-Right): Inter-Kernel SLM Memory Sharing**:
  - Live visualization of shared tensor weights across running VMs.
  - Shows zero-copy memory hit rate and cross-kernel throughput (MB/s).
- **Facet 09 (Bottom-Left): DIOV Streams & Virtualization Lanes**:
  - Low-latency EHAS channels, packet flow lanes, and network telemetry.
- **Cockpit Avionics Dash (`src/native-hud.ts`)**:
  - Top or bottom HUD ribbon displaying global kernel health and patent subsystem heartbeats.

### 4.3. Room Environment Engine (`src/room-environments.ts`)
A dedicated manager dynamically controls the Three.js stage:
```ts
export interface RoomEnvironmentDefinition {
  id: string;
  name: string;
  background: string;
  fog: { color: string; density: number };
  floor: {
    color: string;
    roughness: number;
    metalness: number;
    reflectivity?: number;
  };
  lighting: {
    ambientColor: string;
    ambientIntensity: number;
    keyColor: string;
    keyIntensity: number;
    keyPosition: [number, number, number];
    fillColor: string;
    fillIntensity: number;
    duskColor: string;
    duskIntensity: number;
  };
  props: "library-shelves" | "studio-frames" | "botanical-baffles" | "cyber-monoliths" | "minimal";
  showCosmicStarfield: boolean;
}
```

---

## 5. Constraints & Existing Test Suite Preservation

1. **Test Suite Invariants:** All 338 Node tests must remain 100% green without regressions.
2. **Dual-Sided Backface Rendering:** Preserved via `side: THREE.DoubleSide` and proper Z-sorting during flips.
3. **Reduced Motion:** If `prefersReducedMotion()` is active, compound 9-dot flips snap instantly to the target facet.
4. **Performance:** Total room draw calls kept under 50 to maintain 60 FPS with active guest display streams.

---

## 6. What's Left to the Builder

- Exact hex palettes and material roughness for the 6 environments.
- Procedural Three.js geometry for the lightweight thematic props (wooden shelving fins, bamboo baffles, studio frames).
- Visual styling of the 9 tactile dots on the card face texture (subtle metallic rivets that illuminate on hover).
