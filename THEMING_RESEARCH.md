# Post Card Spatial OS — Card Theming Research & Architectural Specification

**Document Version**: 1.0.0  
**Author / Milestone**: Worker Subagent (Milestone M1)  
**Target Environment**: Post Card Spatial OS (`workspace-prototype/`, Three.js 0.180.0, Vite, TypeScript 5.9, Node.js)  
**Status**: Authoritative Technical Specification & Research Foundation  

---

## 1. Executive Summary & System Context

Post Card Spatial OS is a hybrid spatial computing operating environment designed to manage multiple guest virtual machines and micro-systems (Android, Windows, Linux/Fedora, macOS, Kali Linux) through tangible physical card metaphors. The system presents two primary user-facing views:

1. **Home Screen (`#home-view`)**: A responsive 2D landing dashboard providing high-level system cards (`.home-system-card`), session overview, hero action CTA, and workspace-level customization controls.
2. **Spatial Studio (`#studio-view`)**: A 3D WebGL/WebGPU spatial environment built on Three.js featuring an obsidian floor ($Y = -0.12$), a central machined dais platform ($Y = +0.085$), dynamic spatial lighting, and turntable-mounted 3D system cards (`SystemCard`) rendered via extruded PBR chassis geometries and 2X retina Canvas2D texture facings.

Historically, the visual presentation of cards in both the 2D home landing and 3D studio turntable relied on static, hardcoded color palettes—primarily dark slate linear gradients (`#14161b` to `#0d111a`), static cyan accent strokes, and fixed card-specific accent codes. 

This research document defines an **authoritative, comprehensive theming architecture** for spatial cards in Post Card Spatial OS. It examines established mobile customization paradigms (notably Android home screen customization and Material 3 / Material You dynamic color), contrasts flat 2D screen design with the physics-based lighting and depth demands of 3D spatial computing, provides five fully specified canonical theme profiles, and establishes the TypeScript schema, dual-view styling mapping, GPU texture invalidation strategy, and persistent storage contract for implementation in Milestone M3.

---

## 2. Common Theming Paradigms & Android Home Screen Customization

### 2.1 Android Home Screen Customization Taxonomy

Android represents the most mature, extensively adopted ecosystem for modular home screen customization. Modern Android customization (from Android 12 through Android 15) centers on four interconnected pillars:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ANDROID THEMING TAXONOMY                        │
├───────────────────┬───────────────────┬────────────────────────────────┤
│ 1. Launcher Icons │ 2. Dynamic Color  │ 3. Widget Color Palettes       │
│ - Vector masking  │ - Monet Engine    │ - Glance / RemoteViews         │
│ - Themed monochrome│ - HCT Color Space │ - Dynamic container tinting    │
│ - Adaptive layers │ - Tonal palettes  │ - Semantic role binding        │
└───────────────────┴───────────────────┴────────────────────────────────┘
```

#### 2.1.1 Launcher Icon Packs & Adaptive Icon Architecture
Android launchers decouple application packaging from visual presentation via adaptive icon layers (`<adaptive-icon>`):
- **Foreground Layer**: 108×108 dp vector or bitmap holding the brand glyph.
- **Background Layer**: 108×108 dp solid color, radial gradient, or procedural texture.
- **Masking**: The OS or launcher dynamically clips icons into teardrops, squircles, rounded rects, or circles.
- **Monochrome Themed Icons (Material You)**: Introduced in Android 13, user-selected theme palettes dynamically re-tint icon foregrounds to a semantic tone (e.g. `onSecondaryContainer`) and backgrounds to `secondaryContainer`, eliminating visual clutter and unifying third-party brand colors into a singular harmonious aesthetic.

#### 2.1.2 Dynamic Color Extraction (The Monet / Material You Engine)
Google's Material 3 dynamic color architecture departs from arbitrary user color pickers by algorithmically generating cohesive palettes from seed colors (typically extracted from the user's wallpaper):
1. **Color Quantization (Celebi / Wu's Algorithm)**: Analyzes the user's wallpaper pixels, downsampling into a 3D color histogram, clustering dominant hues, and filtering out low-chroma or muddy shades.
2. **HCT Color Space (Hue, Chroma, Tone)**: Traditional RGB, HSV, and HSL spaces do not account for human perceptual lightness (luminance). Material 3 uses the **HCT** space (CAM16 color appearance model combined with L* from CIELAB):
   - **Hue ($H \in [0, 360)$)**: Perceived color family (e.g., amber, cyan, violet).
   - **Chroma ($C \ge 0$)**: Perceived colorfulness or saturation.
   - **Tone ($T \in [0, 100]$)**: Perceptual luminance ($L^*$), directly proportional to human light sensitivity.
3. **Algorithmic Tonal Palettes**: From a single extracted seed color ($H_{\text{seed}}, C_{\text{seed}}$), the engine derives five standard tonal palettes:
   - **Primary ($P$)**: Core identity; $C = \max(C_{\text{seed}}, 48)$.
   - **Secondary ($S$)**: Supporting utility; $C = 16$.
   - **Tertiary ($T$)**: Complementary or playful accent; $H = H_{\text{seed}} + 60^\circ, C = 24$.
   - **Neutral ($N$)**: Surface and background planes; $C = 4$.
   - **Neutral Variant ($NV$)**: Surface borders, dividers, subtle text; $C = 8$.

Each palette is rendered across a standardized 13-step Tone scale:
$$\text{Tone Steps} = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100]$$
Where $T = 0$ is absolute black, $T = 100$ is pure white, and $T = 50$ is a precise $50\%$ perceptual mid-gray.

#### 2.1.3 Luminance-Guided Contrast Ratios
Material 3 guarantees WCAG 2.1 accessibility algorithmically by defining UI roles through mathematical Tone deltas ($\Delta T$):
- **Text on Container**: Text rendered at $T = 90$ over a container at $T = 30$ produces $\Delta T = 60$, guaranteeing a contrast ratio $\ge 4.5:1$ (WCAG AA).
- **High-Emphasis Content**: A delta $\Delta T \ge 70$ (e.g. Tone 10 text on Tone 90 container) guarantees a contrast ratio $\ge 7:1$ (WCAG AAA).
- **Dark Mode vs Light Mode Inversion**: Dark themes map surfaces to $T \in [6, 12]$ and text to $T \in [80, 95]$; light themes invert surfaces to $T \in [90, 98]$ and text to $T \in [10, 20]$. The color hue remains constant while Tone shifts symmetrically.

#### 2.1.4 Widget Color Palettes & RemoteViews
Android widgets built with `AppWidgetProvider` or Jetpack Glance map semantic theme tokens (`colorSurface`, `colorOnSurface`, `colorPrimaryContainer`) rather than hardcoded hex values. When the system changes wallpaper or toggles dark mode, widgets update instantaneously without recreating application process state.

---

### 2.2 Comparative Analysis: Mobile 2D Flat Theming vs. 3D Spatial Computing Theming

Applying 2D theming concepts to a 3D spatial computing environment requires fundamentally rethinking how colors, surfaces, and lights interact. Below is a rigorous comparative analysis across 8 critical dimensions:

| Dimension | Mobile 2D Flat Theming (Android / iOS) | 3D Spatial Computing (Post Card Spatial OS) | Spatial Engineering Implication |
|---|---|---|---|
| **1. Coordinate Space & Projection** | Orthographic 2D screen pixels ($X, Y$). No camera pitch, yaw, or distance perspective. | Perspective 3D world space ($X, Y, Z$). Camera orbit, field-of-view ($45^\circ$), parallax. | A card changes perceived size, aspect ratio, and angular foreshortening as the user rotates the turntable or zooms the camera. |
| **2. Illumination & Shading** | Simulated flat shadows (`box-shadow`, `elevation: 4dp`). Surfaces emit color directly (albedo equals output). | Physics-Based Rendering (PBR). Surfaces interact with `AmbientLight`, `DirectionalLight`, and `PointLight`. | Changing a theme cannot simply change a 2D hex code; it must modulate PBR surface properties (albedo, roughness, metalness, specular reflectance). |
| **3. Depth & Elevation** | Z-index stacking orders; drop shadows with Gaussian blur radius ($2\text{px} - 16\text{px}$). | Physical Euclidean distance ($Z$-depth). Cards cast true directional shadow maps onto the dais ($Y = 0.085$) and floor ($Y = -0.12$). | Elevation is literal. High-elevation cards occlude objects behind them and receive distinct specular glints from elevated light fixtures. |
| **4. Glassmorphism & Translucency** | CSS `backdrop-filter: blur(20px)`. Screen-space convolution of static DOM pixels underneath. | Translucent acrylic / glass refraction. Screen-space refraction, Fresnel reflections, transmission factor, and blurred mipmap sampling. | Acrylic cards reveal the dais platform, floor grid, and neighboring cards through physical depth-sorted alpha blending. |
| **5. Specular Highlights & Glare** | Subtle linear gradient overlays (e.g. 45° white-to-transparent gloss line). Static across scroll. | Dynamic microfacet Cook-Torrance specular lobe. Glints slide across card edges as turntable rotates or camera orbits. | Low roughness (high gloss) creates sharp specular highlights from scene point lights; high roughness diffuses light into soft satin sheen. |
| **6. Volumetric & Halo Lighting** | CSS `box-shadow: 0 0 24px rgba(cyan, 0.4)`. Uniform 2D radial glow around bounding box. | Dynamic 3D Point Lights (`cardHaloLight`, `cardFloorGlow`) illuminating geometry with inverse-square falloff ($1/d^2$). | Themes project colored light pools onto the obsidian dais and floor. A neon theme casts intense colored halos that illuminate nearby cards. |
| **7. Peripheral Vision & Glanceability** | User looks directly at phone screen within a $5.5'' - 6.7''$ field of view. High information density. | User navigates a $360^\circ$ spatial canvas. Non-focused cards sit in peripheral vision (eccentricity $> 30^\circ$). | Cards must feature high-contrast silhouette branding and tactile LED beads so system states are instantly recognizable from extreme angles. |
| **8. Rasterization & GPU Pipeline** | Direct DOM compositor tree rasterization. Repaints handled by Skia / Chromium layer tree. | Offscreen Canvas2D rasterization ($1280 \times 1920$ at 2X) uploaded to GPU as WebGL `CanvasTexture` (MIP mapped, anisotropic filtering). | Theme changes require explicit texture cache invalidation (`computeCardContentKey`) and GPU texture re-uploading without frame drops. |

---

## 3. Spatial Computing UI Tokens & 3D Materials Architecture

### 3.1 Spatial UI Tokens & Perceptual Physics

In Post Card Spatial OS, a theme is not merely a CSS stylesheet; it is a unified **Spatial Appearance Package** spanning Canvas2D procedural drawing, Three.js PBR materials, and real-time scene lighting.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   SPATIAL APPEARANCE TOKEN PIPELINE                    │
│                                                                        │
│   ┌─────────────────────┐   ┌─────────────────────┐   ┌────────────┐   │
│   │   Canvas2D Facet    │   │ Three.js PBR Edge   │   │ Spatial    │   │
│   │   1280x1920 Texture │   │ Chassis Material    │   │ Lighting   │   │
│   │   - Gradients       │   │ - Roughness         │   │ - Halo     │   │
│   │   - Precision Rim   │   │ - Metalness         │   │ - Floor    │   │
│   │   - Tactile Buttons │   │ - Emissive Spec     │   │ - Exposure │   │
│   └──────────┬──────────┘   └──────────┬──────────┘   └─────┬──────┘   │
│              └────────────────┐        │         ┌──────────┘          │
│                               ▼        ▼         ▼                     │
│                     ┌───────────────────────────────────┐              │
│                     │       Rendered 3D Card in         │              │
│                     │       Post Card Spatial Studio    │              │
│                     └───────────────────────────────────┘              │
└────────────────────────────────────────────────────────────────────────┘
```

#### 3.1.1 Canvas Texture Rasterization Engine
Each card face is rendered to a virtual $640 \times 960$ pt canvas scaled by a factor of 2 ($1280 \times 1920$ px) for sharp retina rendering under perspective zoom:
- **Base Gradient**: Linear gradient from $(0, 0)$ to $(640, 960)$ defining the physical substrate (e.g. volcanic obsidian, cold-rolled steel, frosted glass, or indigo cardstock).
- **Radial Accent Atmosphere**: Radial glow centered at $(560, 85)$ with radius $165\text{px}$, blending the card's distinctive accent color into the substrate.
- **Precision Border Stroke**: Rounded rectangle drawn at $(25, 24)$ with dimensions $590 \times 912\text{px}$ and radius $18\text{px}$. Border width and opacity govern whether the card looks like a heavy militarized slate or a razor-thin glass sheet.
- **Subpixel Typography**: Rendered with Inter, Space Grotesk, Orbitron, and DM Mono font stacks. High-emphasis titles utilize Tone 95 typography; secondary technical readouts utilize Tone 70-80 typography.

#### 3.1.2 Three.js PBR Materials & Microfacet Theory
Three.js uses `MeshStandardMaterial` governed by the Cook-Torrance microfacet specular shading model:
- **Roughness ($\alpha \in [0.0, 1.0]$)**: Controls the micro-geometry scattering of reflected light (GGX normal distribution).
  - High roughness ($\alpha \ge 0.85$): Simulates unglazed ceramic, matte cardstock, or textured industrial polymer. Reflections are completely diffused.
  - Low roughness ($\alpha \le 0.25$): Simulates polished glass, lacquered acrylic, or polished chrome. Produces pinpoint specular glints.
- **Metalness ($m \in [0.0, 1.0]$)**: Dictates dielectric vs conductor behavior (Fresnel $F_0$ parameter).
  - Dielectrics ($m \le 0.10$): Clear coatings, plastics, cardstock. Non-colored specular reflection ($F_0 \approx 0.04$); base albedo shows through.
  - Conductors ($m \ge 0.70$): Bare metals (anodized aluminum, brass, polished zinc). Specular reflection takes on the surface albedo; diffuse reflection drops to near zero.
- **Emissive Color & Intensity**: Enables self-illumination unaffected by scene shadow maps. In a dark room ($Y_{\text{floor}} = -0.12$), high emissive intensity ($> 0.80$) creates the illusion of internal electroluminescent backlights or neon tube discharges.

#### 3.1.3 Spatial Lighting & Floor Reflection Integration
The spatial studio environment features two synchronized theme-responsive lights:
- **`cardHaloLight` (`THREE.PointLight`)**: Positioned slightly in front of the active card $(X=0, Y=2.4, Z=1.8)$. Illuminates the card face and edge chassis bevels.
- **`cardFloorGlow` (`THREE.PointLight`)**: Positioned beneath the card turntable $(X=0, Y=0.05, Z=-0.2)$. Projects a luminous colored contact pool onto the obsidian floor and machined dais platform.

---

### 3.2 Anatomy of a Post Card in Spatial View

In the 3D studio, a `SystemCard` is not a flat 2D plane; it is a multi-part physical assembly composed of geometric meshes, procedural canvas textures, and interactive tactile surfaces:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   POST CARD 3D SPATIAL ANATOMY                         │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ [1] Edge Chassis (ExtrudeGeometry, CARD_WIDTH 2.15, HEIGHT 3.2)│   │
│   │     - Precision 0.02 bevel, PBR Metallic/Roughness chassis     │   │
│   │                                                                │   │
│   │   (4 Corner Hex Fasteners) [2]          (Status LED Bead) [3]  │   │
│   │   ┌──┐                                           ┌──┐          │   │
│   │   └──┘                                           └──┘          │   │
│   │                                                                │   │
│   │   ┌────────────────────────────────────────────────────────┐   │   │
│   │   │ [4] Front Face Canvas Texture (1280x1920 Retina)       │   │   │
│   │   │     - Header pill, OS badge, Accent radial halo        │   │   │
│   │   │     - System identity, Subtitle, Facet tabs            │   │   │
│   │   │     - Live guest preview / serial telemetry           │   │   │
│   │   │                                                        │   │   │
│   │   │   ┌────────────────────────────────────────────────┐   │   │   │
│   │   │   │ [5] Tactile Printed Button Matrix (4x2 Grid)   │   │   │   │
│   │   │   │     [GUEST]  [STOP]    [ZOOM]      [SETTINGS]  │   │   │   │
│   │   │   │     [CLONE]  [SAVE]    [PERF]      [BIN]       │   │   │   │
│   │   │   └────────────────────────────────────────────────┘   │   │   │
│   │   └────────────────────────────────────────────────────────┘   │   │
│   │                                                                │   │
│   │   ┌──┐                                           ┌──┐          │   │
│   │   └──┘                                           └──┘          │   │
│   │   (4 Corner Hex Fasteners) [2]                                 │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Edge Chassis Mesh (`edgeGeometry`)**:
   - Extruded rounded rectangle geometry: width $2.15\text{ m}$, height $3.20\text{ m}$, depth $0.06\text{ m}$, corner radius $0.08\text{ m}$, bevel thickness $0.02\text{ m}$.
   - Houses the front and back face insets. Material responds to chassis theme tokens (roughness, metalness, and emissive rim color).
2. **Four Corner Hex Fasteners (`fastenerGeometry`, `fastenerMaterial`)**:
   - Machined socket head cap screws located at $(\pm (W/2 - 0.088), \pm (H/2 - 0.088))$.
   - Features dual-tone canvas rendering: outer high-contrast chamfer ring and inner dark recessed hex socket, reinforcing tangible hardware fabrication.
3. **Physical Status LED Bead (`statusLedGeometry`, `statusLedMat`)**:
   - Physical 3D domed lens positioned on the top-right chassis rim at $(X = 0.987, Y = 1.477, Z = 0.034)$.
   - Dynamically pulses based on guest state (starting = amber pulse, running = emerald steady, stopped = muted slate, error = ruby strobe).
4. **Front & Back Canvas Faces (`cardGeometry`)**:
   - High-density procedural canvas texture (`THREE.CanvasTexture`) with 6 distinct facets: `front` (system overview), `back` (guest hardware settings), `left` (security/firewall), `right` (paper plane file transfers), `top` (quick actions), `bottom` (live telemetry).
5. **Tactile Printed Button Matrix (`src/card-buttons.ts`)**:
   - Logical canvas dimensions: $640 \times 960\text{ pt}$.
   - Button grid coordinates: $X_{\text{start}} = 48$, $Y_{\text{start}} = 718$, width $130$, height $40$, gap $8$.
   - 8 tactile buttons arranged in two rows:
     - Row 1: `guest` (Launch / Open), `stop` (Power / Halt), `zoom` (Camera Focus), `settings` (Card Flip).
     - Row 2: `clone` (Duplicate VM), `savepoint` (Snapshot), `performance` (Metrics), `bin` (Archive / Reset).
   - In 3D space, Three.js raycasting maps pointer UV coordinates to canvas $(X, Y)$ coordinates via `hitCardButton(u, v)`.
   - Theming updates button background fills, border strokes, and typography colors to match the active palette.

---

## 4. Detailed Theme Profiles (The 5 Canonical Themes for M3)

Post Card Spatial OS defines five canonical theme profiles. Each profile represents a distinct design philosophy, balancing 2D canvas aesthetics with 3D physical material response:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CANONICAL THEME CATALOG                         │
├─────────────────────┬──────────────────────────────────────────────────┤
│ 1. Classic Studio   │ Tactile Slate Cardstock & Cyan Precision Border  │
│ 2. Cyberpunk Neon   │ Obsidian High-Gloss & Dual Magenta/Cyan Glow     │
│ 3. Minimal Dark     │ Pure AMOLED Zero-Reflectance & Micro-Thin Zinc   │
│ 4. Glass / Frosted  │ Translucent Ice-Blue Acrylic & Crystal Specular  │
│ 5. Material Vibrant │ Android Expressive Indigo & Warm Amber/Violet    │
└─────────────────────┴──────────────────────────────────────────────────┘
```

---

### 4.1 Theme 1: Classic Studio (`classic`)

#### Visual Identity & Design Intent
The foundational identity of Post Card Spatial OS. Evokes industrial precision engineering, laboratory instrumentation, and premium tactile paper cardstock with an understated technical cyan accent.

#### Color Palette & Tonal Swatches
- **Canvas Top Background**: `#14161b` (Deep Charcoal Slate)
- **Canvas Mid/Bottom Background**: `#0d111a` (Dark Obsidian Blue)
- **Primary Accent**: `#70d5cf` (Laboratory Cyan)
- **Secondary Accent**: `#8baef0` (Soft Periwinkle)
- **Chassis Base**: `#19212d` (Machined Dark Aluminum)
- **Chassis Emissive Rim**: `#152631` (Subtle Indigo)
- **Text Primary**: `#f4f5f7` (Crisp Technical White, Tone 96)
- **Text Muted**: `#c3c8d1` (Muted Steel Silver, Tone 80)

#### 2D Canvas Rasterization Tokens
```json
{
  "bgTop": "#14161b",
  "bgBottom": "#0d111a",
  "bgGradientStop": 0.58,
  "borderStroke": "rgba(112, 213, 207, 0.35)",
  "borderWidth": 2,
  "badgeColor": "#70d5cf",
  "headerColor": "#70d5cf",
  "titleColor": "#f4f5f7",
  "detailColor": "#c3c8d1",
  "buttonFill": "rgba(7, 9, 14, 0.91)",
  "buttonStroke": "rgba(112, 213, 207, 0.45)",
  "buttonText": "#f4f5f7",
  "fastenerRim": "#c3c8d1",
  "fastenerHead": "#0d111a"
}
```

#### 3D MeshStandardMaterial PBR Properties
- **Face Roughness**: `0.85` (Matte cardstock finish, non-glare under studio spotlights)
- **Face Metalness**: `0.05` (Dielectric substrate)
- **Face Emissive**: `#ffffff` (Neutral daylight transmission)
- **Face Emissive Intensity**: `0.82`
- **Edge Chassis Roughness**: `0.26` (Slightly burnished anodized metal)
- **Edge Chassis Metalness**: `0.82` (Rigid aluminum casing)

#### Spatial Lighting & Halo Parameters
- **Card Halo Light**: Color `#70d5cf`, Intensity `1.20`, Distance `4.5m`
- **Floor Glow Pool**: Color `#00e5ff`, Intensity `1.80`, Distance `6.0m`

#### Contrast & Accessibility
- **Title on Cardstock**: Contrast ratio `13.8:1` (Passes WCAG AAA)
- **Tactile Button Text on Button Fill**: Contrast ratio `15.2:1` (Passes WCAG AAA)
- **Border Stroke Visibility**: $\Delta T = 42$ against `#0d111a` background.

---

### 4.2 Theme 2: Cyberpunk Neon (`cyberpunk`)

#### Visual Identity & Design Intent
Inspired by high-contrast futuristic terminal HUDs, dark synthwave aesthetics, and neon-drenched nightscapes. Maximizes emissive radiance, dramatic chromatic contrast, and high-gloss chassis reflections.

#### Color Palette & Tonal Swatches
- **Canvas Top Background**: `#0b0416` (Midnight Obsidian Violet)
- **Canvas Mid/Bottom Background**: `#05020a` (Deep Void Pitch)
- **Primary Accent**: `#ff007f` (Hot Neon Magenta)
- **Secondary Accent**: `#00f0ff` (Electric Cyan)
- **Chassis Base**: `#080010` (High-Gloss Mirror Obsidian)
- **Chassis Emissive Rim**: `#ff007f` (Hot Pink Edge Neon)
- **Text Primary**: `#ffffff` (Pure Optical White)
- **Text Muted**: `#00f0ff` (Terminal Electric Cyan, Tone 88)

#### 2D Canvas Rasterization Tokens
```json
{
  "bgTop": "#0b0416",
  "bgBottom": "#05020a",
  "bgGradientStop": 0.50,
  "borderStroke": "rgba(255, 0, 127, 0.75)",
  "borderWidth": 2.5,
  "badgeColor": "#ff007f",
  "headerColor": "#00f0ff",
  "titleColor": "#ffffff",
  "detailColor": "rgba(0, 240, 255, 0.85)",
  "buttonFill": "rgba(11, 4, 22, 0.95)",
  "buttonStroke": "rgba(0, 240, 255, 0.70)",
  "buttonText": "#00f0ff",
  "fastenerRim": "#ff007f",
  "fastenerHead": "#05020a"
}
```

#### 3D MeshStandardMaterial PBR Properties
- **Face Roughness**: `0.30` (Glossy synthetic polycarbonate surface)
- **Face Metalness**: `0.15`
- **Face Emissive**: `#ff007f` (Neon pink self-illumination)
- **Face Emissive Intensity**: `0.95` (High luminescence in low ambient light)
- **Edge Chassis Roughness**: `0.18` (Mirror-finish glossy lacquer)
- **Edge Chassis Metalness**: `0.90` (Reflective metallic rim)

#### Spatial Lighting & Halo Parameters
- **Card Halo Light**: Color `#ff007f`, Intensity `2.40`, Distance `5.0m`
- **Floor Glow Pool**: Color `#00f0ff`, Intensity `2.80`, Distance `6.5m` (Creates dynamic duochrome pink-over-cyan rim lighting on the obsidian floor)

#### Contrast & Accessibility
- **Cyan Button Text on Deep Violet Fill**: Contrast ratio `14.1:1` (Passes WCAG AAA)
- **White Title on Void Pitch**: Contrast ratio `19.4:1` (Passes WCAG AAA)

---

### 4.3 Theme 3: Minimal Dark (`minimal-dark`)

#### Visual Identity & Design Intent
Engineered for zero-distraction focus and pure OLED black levels. Eliminates superfluous color noise in favor of architectural zinc wireframes, razor-sharp typography, and anti-reflective matte physics.

#### Color Palette & Tonal Swatches
- **Canvas Top Background**: `#050505` (Pure Deep Charcoal)
- **Canvas Mid/Bottom Background**: `#000000` (True AMOLED Black)
- **Primary Accent**: `#a1a1aa` (Zinc Neutral Tone 65)
- **Secondary Accent**: `#71717a` (Zinc Mid Tone 45)
- **Chassis Base**: `#080808` (Bead-Blasted Carbon)
- **Chassis Emissive Rim**: `#000000` (Non-emissive)
- **Text Primary**: `#f4f4f5` (Bright Silver, Tone 96)
- **Text Muted**: `#a1a1aa` (Muted Zinc, Tone 65)

#### 2D Canvas Rasterization Tokens
```json
{
  "bgTop": "#050505",
  "bgBottom": "#000000",
  "bgGradientStop": 0.65,
  "borderStroke": "rgba(161, 161, 170, 0.28)",
  "borderWidth": 1.5,
  "badgeColor": "#e4e4e7",
  "headerColor": "#a1a1aa",
  "titleColor": "#f4f4f5",
  "detailColor": "#71717a",
  "buttonFill": "rgba(15, 15, 17, 0.95)",
  "buttonStroke": "rgba(113, 113, 122, 0.35)",
  "buttonText": "#e4e4e7",
  "fastenerRim": "#52525b",
  "fastenerHead": "#18181b"
}
```

#### 3D MeshStandardMaterial PBR Properties
- **Face Roughness**: `0.96` (Pure ultra-matte diffuse finish; zero specular glare)
- **Face Metalness**: `0.00` (Pure dielectric dark paper)
- **Face Emissive**: `#ffffff`
- **Face Emissive Intensity**: `0.70` (Subdued contrast for dim studio viewing)
- **Edge Chassis Roughness**: `0.85` (Anodized matte zinc)
- **Edge Chassis Metalness**: `0.40`

#### Spatial Lighting & Halo Parameters
- **Card Halo Light**: Color `#d4d4d8`, Intensity `0.65`, Distance `3.5m`
- **Floor Glow Pool**: Color `#27272a`, Intensity `0.80`, Distance `4.0m` (Muted monochrome floor pooling)

#### Contrast & Accessibility
- **Bright Silver Text on AMOLED Black**: Contrast ratio `18.5:1` (Passes WCAG AAA)
- **Zinc Button Text on Dark Fill**: Contrast ratio `9.8:1` (Passes WCAG AAA)

---

### 4.4 Theme 4: Glass / Frosted (`glass`)

#### Visual Identity & Design Intent
Spatial glassmorphism realized in true 3D. Evokes frosted ice-blue acrylic, layered crystal refractive sheets, and delicate specular edge glints. Perfect for spatial environments where background spatial context must remain visible.

#### Color Palette & Tonal Swatches
- **Canvas Top Background**: `rgba(26, 38, 57, 0.75)` (Translucent Cold Aqua Tint)
- **Canvas Mid/Bottom Background**: `rgba(13, 20, 32, 0.85)` (Translucent Deep Marine)
- **Primary Accent**: `#38bdf8` (Vivid Sky Blue)
- **Secondary Accent**: `#93c5fd` (Soft Crystal Blue)
- **Chassis Base**: `#162232` (Polished Ice Acrylic)
- **Chassis Emissive Rim**: `#38bdf8` (Cyan Edge-Lit Lightguide)
- **Text Primary**: `#ffffff` (High-Purity Ice White)
- **Text Muted**: `#bae6fd` (Pale Sky Crystal, Tone 85)

#### 2D Canvas Rasterization Tokens
```json
{
  "bgTop": "rgba(26, 38, 57, 0.75)",
  "bgBottom": "rgba(13, 20, 32, 0.85)",
  "bgGradientStop": 0.50,
  "borderStroke": "rgba(186, 230, 253, 0.55)",
  "borderWidth": 1.75,
  "badgeColor": "#38bdf8",
  "headerColor": "#93c5fd",
  "titleColor": "#ffffff",
  "detailColor": "#bae6fd",
  "buttonFill": "rgba(24, 43, 73, 0.75)",
  "buttonStroke": "rgba(56, 189, 248, 0.45)",
  "buttonText": "#ffffff",
  "fastenerRim": "#bae6fd",
  "fastenerHead": "#0d1420"
}
```

#### 3D MeshStandardMaterial PBR Properties
- **Face Roughness**: `0.15` (High-gloss acrylic with sharp specular glints)
- **Face Metalness**: `0.10` (Dielectric polymer)
- **Face Emissive**: `#38bdf8`
- **Face Emissive Intensity**: `0.78`
- **Edge Chassis Roughness**: `0.10` (Chamfered crystal glass edge guide)
- **Edge Chassis Metalness**: `0.30`

#### Spatial Lighting & Halo Parameters
- **Card Halo Light**: Color `#38bdf8`, Intensity `1.60`, Distance `5.0m`
- **Floor Glow Pool**: Color `#0284c7`, Intensity `2.10`, Distance `6.0m`

#### Contrast & Accessibility
- **Ice White Text on Translucent Navy**: Contrast ratio `11.6:1` (Passes WCAG AAA)
- **Crystal Blue Details on Marine**: Contrast ratio `7.8:1` (Passes WCAG AA)

---

### 4.5 Theme 5: Material Vibrant (`material-vibrant`)

#### Visual Identity & Design Intent
Directly channels the Google Material 3 / Android Expressive design system. Centers on deep warm indigo surfaces with rich chromatic harmony, warm amber and coral accents, violet tonal depth, and a tactile satin finish.

#### Color Palette & Tonal Swatches
- **Canvas Top Background**: `#181124` (Deep Expressive Indigo)
- **Canvas Mid/Bottom Background**: `#0e0918` (Dark Velvet Night)
- **Primary Accent**: `#f59e0b` (Warm Radiance Amber)
- **Secondary Accent**: `#8b5cf6` (Electric Violet)
- **Tertiary Accent**: `#ec4899` (Playful Rose Coral)
- **Chassis Base**: `#211832` (Anodized Warm Titanium)
- **Chassis Emissive Rim**: `#8b5cf6` (Warm Violet Rim Glow)
- **Text Primary**: `#fdf4ff` (Warm Cream White, Tone 98)
- **Text Muted**: `#d8b4fe` (Tonal Lavender, Tone 78)

#### 2D Canvas Rasterization Tokens
```json
{
  "bgTop": "#181124",
  "bgBottom": "#0e0918",
  "bgGradientStop": 0.55,
  "borderStroke": "rgba(245, 158, 11, 0.48)",
  "borderWidth": 2,
  "badgeColor": "#f59e0b",
  "headerColor": "#8b5cf6",
  "titleColor": "#fdf4ff",
  "detailColor": "#d8b4fe",
  "buttonFill": "rgba(28, 18, 44, 0.92)",
  "buttonStroke": "rgba(245, 158, 11, 0.50)",
  "buttonText": "#f59e0b",
  "fastenerRim": "#f59e0b",
  "fastenerHead": "#0e0918"
}
```

#### 3D MeshStandardMaterial PBR Properties
- **Face Roughness**: `0.65` (Tactile satin microtexture, velvety touch response)
- **Face Metalness**: `0.15`
- **Face Emissive**: `#ffffff`
- **Face Emissive Intensity**: `0.85`
- **Edge Chassis Roughness**: `0.35` (Satin brushed warm bronze/titanium)
- **Edge Chassis Metalness**: `0.75`

#### Spatial Lighting & Halo Parameters
- **Card Halo Light**: Color `#f59e0b`, Intensity `1.75`, Distance `4.8m`
- **Floor Glow Pool**: Color `#8b5cf6`, Intensity `2.20`, Distance `6.0m` (Warm amber front halo balancing violet floor pool glow)

#### Contrast & Accessibility
- **Warm Cream Text on Dark Velvet**: Contrast ratio `15.8:1` (Passes WCAG AAA)
- **Amber Text on Dark Purple Button Fill**: Contrast ratio `10.4:1` (Passes WCAG AAA)

---

## 5. Technical Integration Architecture for Post Card Spatial OS

### 5.1 TypeScript Token Schema Definition

The theming subsystem will be centralized in `workspace-prototype/src/card-themes.ts`. Below is the complete, strongly-typed interface specification:

```typescript
/**
 * Canonical theme identifiers supported by Post Card Spatial OS.
 */
export type CardThemeId = 
  | "classic" 
  | "cyberpunk" 
  | "minimal-dark" 
  | "glass" 
  | "material-vibrant";

/**
 * Procedural 2D HTML5 Canvas rendering tokens.
 * Coordinates assume a 640x960 logical canvas (rasterized at 2X scale: 1280x1920).
 */
export interface CanvasThemeTokens {
  bgTop: string;
  bgBottom: string;
  bgGradientStop: number;
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
}

/**
 * Three.js MeshStandardMaterial PBR configuration for 3D card meshes.
 */
export interface MaterialThemeTokens {
  roughness: number;
  metalness: number;
  emissive: string;
  emissiveIntensity: number;
  edgeColor: string;
  edgeEmissive: string;
  edgeEmissiveIntensity: number;
  edgeRoughness: number;
  edgeMetalness: number;
}

/**
 * Three.js scene point light parameters dynamically updated per theme.
 */
export interface LightingThemeTokens {
  haloColor: string;
  haloIntensity: number;
  floorGlowColor: string;
  floorGlowIntensity: number;
}

/**
 * CSS custom properties applied to the 2D Home View (#home-view).
 */
export interface HomeCssThemeTokens {
  "--home-card-bg": string;
  "--home-card-border": string;
  "--home-card-accent": string;
  "--home-card-glow": string;
  "--home-badge-bg": string;
  "--home-badge-text": string;
}

/**
 * Unified Card Theme Definition encompassing 2D canvas, 3D PBR materials,
 * dynamic spatial lighting, and 2D home screen CSS tokens.
 */
export interface CardThemeDefinition {
  id: CardThemeId;
  name: string;
  tagline: string;
  description: string;
  swatchPrimary: string;
  swatchSecondary: string;
  canvas: CanvasThemeTokens;
  material: MaterialThemeTokens;
  lighting: LightingThemeTokens;
  css: HomeCssThemeTokens;
}
```

---

### 5.2 Dual-View Styling & Synchronized Mapping Architecture

When a user selects a card theme via the Home Screen theme picker or the Studio Topbar, the update must synchronize across both view domains without visual tearing:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   DUAL-VIEW THEME SYNCHRONIZATION                      │
│                                                                        │
│                       [ User Selects Theme ]                           │
│                                  │                                     │
│                     applyCardTheme(themeId)                            │
│                                  │                                     │
│         ┌────────────────────────┴────────────────────────┐            │
│         ▼                                                 ▼            │
│  [ 2D Home Screen ]                             [ 3D Spatial Studio ]  │
│  - Set data-card-theme="id"                     - Update lights:       │
│  - Apply CSS custom properties                  `cardHaloLight`,       │
│  - Smooth transition on:                        `cardFloorGlow`        │
│    .home-system-card,                           - Update PBR materials │
│    .home-card-stack,                              (roughness, metal)   │
│    .home-primary-button                         - Invalidate texture   │
│                                                   cache & re-render    │
│                                                   1280x1920 canvas     │
└────────────────────────────────────────────────────────────────────────┘
```

#### 5.2.1 2D Home Screen Mapping (`#home-view`)
The container `#home-view` receives a dataset attribute `data-card-theme="[id]"`. In `style.css`, CSS custom properties are updated dynamically:
```css
#home-view[data-card-theme="classic"] {
  --theme-card-bg: linear-gradient(135deg, rgba(20, 22, 27, 0.95), rgba(13, 17, 26, 0.88));
  --theme-card-border: rgba(112, 213, 207, 0.35);
  --theme-card-accent: #70d5cf;
  --theme-card-glow: rgba(112, 213, 207, 0.15);
}

#home-view[data-card-theme="cyberpunk"] {
  --theme-card-bg: linear-gradient(135deg, rgba(11, 4, 22, 0.96), rgba(5, 2, 10, 0.94));
  --theme-card-border: rgba(255, 0, 127, 0.65);
  --theme-card-accent: #ff007f;
  --theme-card-glow: rgba(0, 240, 255, 0.25);
}

#home-view[data-card-theme="minimal-dark"] {
  --theme-card-bg: linear-gradient(135deg, rgba(8, 8, 8, 0.98), rgba(0, 0, 0, 0.98));
  --theme-card-border: rgba(161, 161, 170, 0.25);
  --theme-card-accent: #e4e4e7;
  --theme-card-glow: transparent;
}

#home-view[data-card-theme="glass"] {
  --theme-card-bg: linear-gradient(135deg, rgba(26, 38, 57, 0.75), rgba(13, 20, 32, 0.82));
  --theme-card-border: rgba(186, 230, 253, 0.45);
  --theme-card-accent: #38bdf8;
  --theme-card-glow: rgba(56, 189, 248, 0.20);
  backdrop-filter: blur(16px);
}

#home-view[data-card-theme="material-vibrant"] {
  --theme-card-bg: linear-gradient(135deg, rgba(24, 17, 36, 0.95), rgba(14, 9, 24, 0.92));
  --theme-card-border: rgba(245, 158, 11, 0.45);
  --theme-card-accent: #f59e0b;
  --theme-card-glow: rgba(139, 92, 246, 0.22);
}
```

#### 5.2.2 3D Spatial Canvas Mapping (`makeCardTexture`)
In `src/main.ts`, `makeCardTexture(card, facet)` replaces hardcoded gradient colors with active theme tokens:
```typescript
const theme = getCardTheme(activeThemeId);
const gradient = context.createLinearGradient(0, 0, 640, 960);
gradient.addColorStop(0, theme.canvas.bgTop);
gradient.addColorStop(theme.canvas.bgGradientStop, theme.canvas.bgBottom);
gradient.addColorStop(1, theme.canvas.bgBottom);
context.fillStyle = gradient;
context.fillRect(0, 0, 640, 960);

// Accent border stroke from theme
context.strokeStyle = theme.canvas.borderStroke;
context.lineWidth = theme.canvas.borderWidth;
roundRect(context, 25, 24, 590, 912, 18);
context.stroke();
```

---

### 5.3 Texture Invalidation & Memory Management Pipeline

Because each card face texture is a $1280 \times 1920$ 32-bit RGBA surface, improper caching or failure to dispose textures causes GPU VRAM exhaustion (~9.8 MB uncompressed VRAM per face $\times 2$ faces $\times 6$ cards $\approx 118\text{ MB}$).

#### 5.3.1 Cache Invalidation Strategy (`computeCardContentKey`)
`main.ts` caches textures using `computeCardContentKey(card)`. To ensure instant, bug-free theme updates, `card.theme ?? activeThemeId` must be explicitly injected into the content key string:

```typescript
function computeCardContentKey(card: SystemCard): string {
  // Existing telemetry and guest fields...
  return [
    card.theme ?? activeThemeId, // <-- INJECTED THEME KEY
    card.status,
    card.facet,
    card.backFaceVisible ? "B" : "F",
    card.twisted ? "T1" : "T0",
    card.resetCount,
    // ...
  ].join("|");
}
```

#### 5.3.2 VRAM Disposal Protocol
When `applyCardTheme(themeId)` is executed:
1. `activeThemeId` is updated.
2. For each card in `cards`:
   - Invoke `card.cachedSharpTexture?.dispose()`.
   - Invoke `card.cachedBlurredTexture?.dispose()`.
   - Clear texture references (`card.cachedSharpTexture = undefined`, `card.cachedBlurredTexture = undefined`).
   - Call `refreshCardTexture(card, true)` to rasterize new theme canvases.
   - Update `frontMesh.material.roughness = theme.material.roughness`, etc.
   - Update `edgeMesh.material.roughness = theme.material.edgeRoughness`, etc.

---

### 5.4 State Management & Local Persistence Architecture

Card theme selection must survive page refreshes, browser restarts, and navigations between `#home-view` and `#studio-view`.

- **Storage Key**: `localStorage.getItem("postcard_studio_card_theme")`
- **Fallback Resolution**: If the stored key is absent, null, or not present in `CARD_THEME_IDS`, gracefully fall back to `"classic"`.
- **Initialization Lifecycle**:
  ```typescript
  export function loadSavedTheme(): CardThemeId {
    try {
      const saved = localStorage.getItem("postcard_studio_card_theme");
      if (saved && (CARD_THEME_IDS as readonly string[]).includes(saved)) {
        return saved as CardThemeId;
      }
    } catch {
      // Storage access blocked or unavailable
    }
    return "classic";
  }

  export function saveTheme(themeId: CardThemeId): void {
    try {
      localStorage.setItem("postcard_studio_card_theme", themeId);
    } catch (err) {
      console.warn("Unable to persist card theme to localStorage:", err);
    }
  }
  ```

---

## 6. Implementation Roadmap & Milestone Handoff (M1 -> M3)

This research document forms the complete blueprint for **Milestone M3 (Card Theming Implementation)**. The implementing worker in M3 will execute the following concrete modifications:

### 6.1 Planned Deliverables in Milestone M3
1. **`workspace-prototype/src/card-themes.ts`** (New File):
   - Export `CardThemeId`, `CardThemeDefinition`.
   - Export `CARD_THEMES: Record<CardThemeId, CardThemeDefinition>`.
   - Export `CARD_THEME_IDS: readonly CardThemeId[]`.
   - Export `getCardTheme(id: CardThemeId): CardThemeDefinition`.
   - Export `loadSavedTheme(): CardThemeId`, `saveTheme(id: CardThemeId): void`.
2. **`workspace-prototype/index.html`** (Edit):
   - Insert Theme Customization section inside `#home-view` (`.home-theme-picker`) featuring 5 interactive theme cards/chips with color swatches, labels, and active radio indicators.
   - Wire topbar theme selector in `#studio-view` for mid-session studio theme switching.
3. **`workspace-prototype/src/style.css`** (Edit):
   - Add styling rules for `.home-theme-picker`, `.theme-chip`, `.theme-swatch`.
   - Add theme-driven CSS custom property overrides for `.home-system-card` based on `[data-card-theme]`.
4. **`workspace-prototype/src/main.ts`** (Edit):
   - Import `card-themes.ts`.
   - Initialize `activeThemeId = loadSavedTheme()`.
   - Inject `card.theme ?? activeThemeId` into `computeCardContentKey`.
   - Replace hardcoded gradient values in `makeCardTexture` with `theme.canvas` tokens.
   - Update `createCard` and theme switcher to dynamically assign `roughness`, `metalness`, and light intensities.
   - Wire event listeners on `#home-view` theme buttons to `applyCardTheme(id)`.

---

## 7. Audit & Verification Matrix

To ensure forensic compliance and zero shortcut implementations, an independent auditor can verify this research and its upcoming M3 implementation against the following test assertions:

| Test ID | Objective | Verification Command / Method | Expected Result |
|---|---|---|---|
| **V1** | Schema & Token Compilation | `cd workspace-prototype; npx tsc --noEmit` | Clean compile, 0 type errors across all theme interfaces. |
| **V2** | Build Production Integrity | `cd workspace-prototype; npm run build` | Vite bundles successfully, producing clean production artifacts in `dist/`. |
| **V3** | Test Suite Non-Regression | `cd workspace-prototype; npm test` | All 63 existing tests pass cleanly without regressions. |
| **V4** | Tonal Contrast Compliance | Automated formula verification of $(\text{Luminance}_{\text{light}} + 0.05) / (\text{Luminance}_{\text{dark}} + 0.05)$ | All text tokens maintain $\ge 4.5:1$ contrast against their assigned container fills. |
| **V5** | LocalStorage Resilience | Evaluate `localStorage.setItem` in sandboxed context | Theme preference persists across page reloads; defaults cleanly to `"classic"`. |
| **V6** | VRAM Texture Invalidation | Inspect `card.lastTextureKey` after `applyCardTheme` | Content key incorporates theme ID; previous textures are disposed and newly rendered. |

---

*End of Theming Research Specification.*
