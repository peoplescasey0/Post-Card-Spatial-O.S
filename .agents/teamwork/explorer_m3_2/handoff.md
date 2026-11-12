# Investigation Report: Home Screen Card Theming Customization Controls & CSS Styling

**Agent**: Explorer 2 (`explorer_m3_2`)  
**Milestone**: M3: Card Theming Customization Implementation  
**Target Codebase**: `workspace-prototype/index.html`, `workspace-prototype/src/style.css`  
**Working Directory**: `g:\micro-host`  
**State Folder**: `g:\micro-host\.agents\teamwork\explorer_m3_2\`  

---

## 1. Observation

### 1.1 Home Screen DOM Structure in `workspace-prototype/index.html`
Direct inspection of `workspace-prototype/index.html` (lines 17–150) reveals the following layout hierarchy for `#home-view`:
```html
17:  <main class="home-view" id="home-view" hidden>
18:    <header class="home-header">
19:      <a class="home-brand" href="#" aria-label="Post Card OS home">...</a>
23:      <div class="home-session">...</div>
29:    </header>
31:    <div class="home-content">
32:      <section class="home-hero" aria-labelledby="home-title">
33:        <div class="home-intro">...</div>
48:        <aside class="home-hero-visual" aria-label="Spatial Studio preview">...</aside>
73:      </section>
75:      <section class="home-systems" aria-labelledby="systems-title">
76:        <div class="home-section-heading">
77:          <div>
78:            <p class="home-eyebrow"><span>02</span> / YOUR SYSTEMS</p>
79:            <h2 id="systems-title">Choose a Post Card</h2>
80:          </div>
81:          <p class="home-section-note">SELECT A CARD TO OPEN IT IN THE STUDIO</p>
82:        </div>
83:
84:        <div class="home-system-grid">
85:          <button class="home-system-card" type="button" data-open-studio data-card-id="android">...</button>
98:          <button class="home-system-card" type="button" data-open-studio data-card-id="windows">...</button>
111:         <button class="home-system-card home-system-card-featured" type="button" data-open-studio data-card-id="linux">...</button>
124:         <button class="home-system-card" type="button" data-open-studio data-card-id="macos">...</button>
137:         <button class="home-system-card" type="button" data-open-studio data-card-id="kali-red">...</button>
149:       </div>
150:     </section>
```

Key structural observations:
1. `.home-header` (lines 18–29) has a fixed minimum height of `72px`, containing only `.home-brand` (left) and `.home-session` ("LOCAL SESSION / PROTOTYPE 0.1", right).
2. `.home-systems` (lines 75–150) contains `.home-section-heading` (lines 76–82) and `.home-system-grid` (lines 84–149).
3. The 5 system cards (`android`, `windows`, `linux`, `macos`, `kali-red`) are rendered as `<button class="home-system-card" ...>` elements in a 3-column grid (2-column on $\le 900\text{px}$, 1-column on $\le 640\text{px}$).

### 1.2 Card Styling and CSS Rules in `workspace-prototype/src/style.css`
Direct inspection of `workspace-prototype/src/style.css` (lines 2704–3250 and 3300–3450) reveals:
1. **Card Container** (lines 3062–3080):
   ```css
   .home-system-card {
     position: relative;
     display: flex;
     min-width: 0;
     min-height: 154px;
     flex-direction: column;
     align-items: stretch;
     padding: 13px 15px 12px;
     overflow: hidden;
     border: 1px solid rgba(138, 144, 158, 0.22);
     border-radius: 2px;
     background:
       linear-gradient(135deg, rgba(255, 255, 255, 0.025), transparent 55%),
       rgba(13, 17, 26, 0.88);
     color: var(--studio-text-main);
     cursor: pointer;
     text-align: left;
     transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
   }
   ```
2. **Corner Geometric Notch Accent** (lines 3082–3091):
   ```css
   .home-system-card::after {
     position: absolute;
     top: -1px;
     right: -1px;
     width: 25px;
     height: 25px;
     border-top: 1px solid rgba(138, 144, 158, 0.28);
     border-right: 1px solid rgba(138, 144, 158, 0.28);
     content: "";
   }
   ```
3. **Hover and Focus State** (lines 3093–3097 and 2877–2882):
   ```css
   .home-system-card:hover {
     transform: translateY(-2px);
     border-color: rgba(195, 200, 209, 0.48);
     background-color: #14161b;
   }
   .home-primary-button:focus-visible,
   .home-system-card:focus-visible,
   .home-brand:focus-visible {
     outline: 2px solid var(--studio-amber);
     outline-offset: 4px;
   }
   ```
4. **Child Elements within `.home-system-card`**:
   - `.home-system-mark` (lines 3121–3130): OS logo/glyph badge (`28x28px`).
   - `.home-system-code` (lines 3160–3163): Monospace label (e.g. `PC / 01`).
   - `.home-system-open` (lines 3212–3221): Arrow icon `↗` that transitions color and translates on hover.
5. **No Existing Theme Controls or Variables**:
   A regex search across `style.css` for `theme-chip`, `theme-picker`, and `card-theme` yielded zero occurrences. Currently, card borders and backgrounds are statically hardcoded with gray/slate tones.

### 1.3 Baseline Suite Status
1. `npm test` in `workspace-prototype`: Executed 63 tests across 0 suites — 63 passed, 0 failed (exit code 0).
2. `npx tsc --noEmit` in `workspace-prototype`: Exited cleanly with 0 type errors (exit code 0).

---

## 2. Logic Chain

### 2.1 Placement Evaluation for Card Theming Controls

Three candidate placements were evaluated for the card theme customization controls on `#home-view`:

| Placement Candidate | Pros | Cons | Verdict |
|---|---|---|---|
| **Option A: Inside `.home-header`** (line 28) | Stays visible during page scroll. | Constrained width (72px height, shared with brand and session metadata); causes severe wrapping/clutter below 1000px; spatially detached from the cards being customized. | **Rejected** |
| **Option B: Inside `.home-systems` directly above `.home-system-grid`** (between lines 82 and 84) | Immediate contextual proximity to `.home-system-card` elements; immediate visual feedback when switching themes; full 1240px container width; graceful responsive wrapping or horizontal scrolling. | Scrolls with content (not sticky), but user customizes themes while looking directly at the cards. | **RECOMMENDED PRIMARY** |
| **Option C: Inline inside `.home-section-heading`** (right side, replacing or next to `.home-section-note`) | Compact; sits adjacent to "Choose a Post Card". | 5 theme chips require ~550px width, causing tight collisions with heading on 900px–1100px screens; lacks a dedicated background dock. | **Secondary alternative** |

**Conclusion on Placement**: Placing a dedicated `.home-theme-bar` directly inside `.home-systems` between `.home-section-heading` (line 82) and `.home-system-grid` (line 84) is ergonomically and architecturally superior. The user looks at the cards while clicking theme chips, experiencing instantaneous, localized visual transformation.

### 2.2 Semantic HTML Structure & Accessibility
To follow Android home screen customization conventions and accessibility standards:
1. **Container**: `<div class="home-theme-bar">` wrapping metadata and controls.
2. **Accessible Role**: `<div class="home-theme-picker" data-theme-picker role="radiogroup" aria-label="Card Theme">`.
3. **Buttons / Chips**: 5 interactive buttons `<button class="theme-chip" type="button" role="radio" aria-checked="..." data-theme-id="...">`:
   - `classic`: Classic Studio
   - `cyberpunk`: Cyberpunk Neon
   - `minimal-dark`: Minimal Dark
   - `glass`: Glass / Frosted
   - `material-vibrant`: Material Vibrant
4. **Color Swatch**: `<span class="theme-swatch theme-swatch-<id>" aria-hidden="true"></span>` rendering a dual-color gradient token circle.
5. **Active State**: The active chip has `.is-active` and `aria-checked="true"`; inactive chips have `aria-checked="false"`.

### 2.3 CSS Custom Property Binding Architecture
To achieve high-performance, non-breaking theme switching:
1. Applying a data attribute to the container `#home-view[data-card-theme="<themeId>"]` allows pure CSS variable cascade.
2. The CSS variables drive `.home-system-card` and its pseudo-elements:
   - `--card-theme-bg`: Linear gradient for the card face.
   - `--card-theme-bg-hover`: Hover state surface color.
   - `--card-theme-border`: Default border stroke.
   - `--card-theme-border-hover`: Highlighted border stroke on hover.
   - `--card-theme-corner`: Corner geometric notch accent (`::after`).
   - `--card-theme-accent`: Accent highlight color for codes, arrows, and badges.
   - `--card-theme-glow`: Box-shadow colored glow on hover.
   - `--card-theme-mark-bg` & `--card-theme-mark-border`: System mark container tinting.
3. For the `glass` theme, `#home-view[data-card-theme="glass"] .home-system-card` additionally receives `backdrop-filter: blur(14px);` to deliver authentic frosted acrylic translucency.
4. If `#home-view` has no `data-card-theme` attribute (or before JS initializes), default fallback variables on `:root` ensure the cards render in the default "classic" styling without any visual breakage.

---

## 3. Recommended Implementation Plan for the Worker

### 3.1 Exact HTML Markup for `workspace-prototype/index.html`

**Target Location**: Insert between line 82 (`</div>` closing `.home-section-heading`) and line 84 (`<div class="home-system-grid">`).

```html
          <!-- Card Theme Customization Controls -->
          <div class="home-theme-bar" aria-label="Card Theme Customization">
            <div class="home-theme-meta">
              <span class="home-theme-badge">THEME</span>
              <span class="home-theme-desc">Card Style Preset:</span>
            </div>
            <div class="home-theme-picker" data-theme-picker role="radiogroup" aria-label="Card Theme">
              <button class="theme-chip is-active" type="button" role="radio" aria-checked="true" data-theme-id="classic" title="Classic Studio: Tactile Slate Cardstock &amp; Cyan Precision Border">
                <span class="theme-swatch theme-swatch-classic" aria-hidden="true"></span>
                <span class="theme-chip-label">Classic Studio</span>
              </button>
              <button class="theme-chip" type="button" role="radio" aria-checked="false" data-theme-id="cyberpunk" title="Cyberpunk Neon: Obsidian High-Gloss &amp; Dual Magenta/Cyan Glow">
                <span class="theme-swatch theme-swatch-cyberpunk" aria-hidden="true"></span>
                <span class="theme-chip-label">Cyberpunk Neon</span>
              </button>
              <button class="theme-chip" type="button" role="radio" aria-checked="false" data-theme-id="minimal-dark" title="Minimal Dark: Pure AMOLED Zero-Reflectance &amp; Micro-Thin Zinc">
                <span class="theme-swatch theme-swatch-minimal-dark" aria-hidden="true"></span>
                <span class="theme-chip-label">Minimal Dark</span>
              </button>
              <button class="theme-chip" type="button" role="radio" aria-checked="false" data-theme-id="glass" title="Glass / Frosted: Translucent Ice-Blue Acrylic &amp; Crystal Specular">
                <span class="theme-swatch theme-swatch-glass" aria-hidden="true"></span>
                <span class="theme-chip-label">Glass</span>
              </button>
              <button class="theme-chip" type="button" role="radio" aria-checked="false" data-theme-id="material-vibrant" title="Material Vibrant: Android Expressive Indigo &amp; Warm Amber/Violet">
                <span class="theme-swatch theme-swatch-material-vibrant" aria-hidden="true"></span>
                <span class="theme-chip-label">Material Vibrant</span>
              </button>
            </div>
          </div>
```

### 3.2 Exact CSS Additions for `workspace-prototype/src/style.css`

**Target Location**: Insert into `workspace-prototype/src/style.css` immediately after `.home-system-card:hover .home-system-open` (around line 3222). Also update `.home-system-card` rules to consume the variables.

```css
/* --- Home Screen Card Theming Custom Properties ----------------------- */
:root {
  --card-theme-bg: linear-gradient(135deg, rgba(20, 22, 27, 0.95), rgba(13, 17, 26, 0.90));
  --card-theme-bg-hover: #19212d;
  --card-theme-border: rgba(112, 213, 207, 0.32);
  --card-theme-border-hover: rgba(112, 213, 207, 0.65);
  --card-theme-corner: rgba(112, 213, 207, 0.48);
  --card-theme-accent: #70d5cf;
  --card-theme-glow: 0 8px 28px rgba(112, 213, 207, 0.14);
  --card-theme-mark-bg: rgba(112, 213, 207, 0.08);
  --card-theme-mark-border: rgba(112, 213, 207, 0.28);
}

#home-view[data-card-theme="classic"] {
  --card-theme-bg: linear-gradient(135deg, rgba(20, 22, 27, 0.95), rgba(13, 17, 26, 0.90));
  --card-theme-bg-hover: #19212d;
  --card-theme-border: rgba(112, 213, 207, 0.32);
  --card-theme-border-hover: rgba(112, 213, 207, 0.65);
  --card-theme-corner: rgba(112, 213, 207, 0.48);
  --card-theme-accent: #70d5cf;
  --card-theme-glow: 0 8px 28px rgba(112, 213, 207, 0.14);
  --card-theme-mark-bg: rgba(112, 213, 207, 0.08);
  --card-theme-mark-border: rgba(112, 213, 207, 0.28);
}

#home-view[data-card-theme="cyberpunk"] {
  --card-theme-bg: linear-gradient(135deg, rgba(16, 6, 28, 0.96), rgba(6, 2, 14, 0.96));
  --card-theme-bg-hover: #1a0a2c;
  --card-theme-border: rgba(255, 0, 127, 0.55);
  --card-theme-border-hover: rgba(0, 240, 255, 0.85);
  --card-theme-corner: rgba(0, 240, 255, 0.70);
  --card-theme-accent: #ff007f;
  --card-theme-glow: 0 8px 32px rgba(255, 0, 127, 0.28), 0 0 14px rgba(0, 240, 255, 0.20);
  --card-theme-mark-bg: rgba(255, 0, 127, 0.12);
  --card-theme-mark-border: rgba(255, 0, 127, 0.40);
}

#home-view[data-card-theme="minimal-dark"] {
  --card-theme-bg: linear-gradient(135deg, rgba(10, 10, 10, 0.98), rgba(0, 0, 0, 0.99));
  --card-theme-bg-hover: #121214;
  --card-theme-border: rgba(82, 82, 91, 0.35);
  --card-theme-border-hover: rgba(161, 161, 170, 0.60);
  --card-theme-corner: rgba(113, 113, 122, 0.45);
  --card-theme-accent: #e4e4e7;
  --card-theme-glow: 0 8px 24px rgba(0, 0, 0, 0.70);
  --card-theme-mark-bg: rgba(255, 255, 255, 0.04);
  --card-theme-mark-border: rgba(82, 82, 91, 0.30);
}

#home-view[data-card-theme="glass"] {
  --card-theme-bg: linear-gradient(135deg, rgba(26, 38, 57, 0.72), rgba(13, 20, 32, 0.80));
  --card-theme-bg-hover: rgba(35, 52, 78, 0.85);
  --card-theme-border: rgba(186, 230, 253, 0.42);
  --card-theme-border-hover: rgba(56, 189, 248, 0.75);
  --card-theme-corner: rgba(56, 189, 248, 0.65);
  --card-theme-accent: #38bdf8;
  --card-theme-glow: 0 8px 32px rgba(56, 189, 248, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.12);
  --card-theme-mark-bg: rgba(56, 189, 248, 0.10);
  --card-theme-mark-border: rgba(56, 189, 248, 0.35);
}

#home-view[data-card-theme="material-vibrant"] {
  --card-theme-bg: linear-gradient(135deg, rgba(26, 18, 38, 0.95), rgba(14, 9, 24, 0.92));
  --card-theme-bg-hover: #261938;
  --card-theme-border: rgba(245, 158, 11, 0.42);
  --card-theme-border-hover: rgba(139, 92, 246, 0.75);
  --card-theme-corner: rgba(245, 158, 11, 0.60);
  --card-theme-accent: #f59e0b;
  --card-theme-glow: 0 8px 30px rgba(245, 158, 11, 0.18), 0 0 16px rgba(139, 92, 246, 0.16);
  --card-theme-mark-bg: rgba(245, 158, 11, 0.10);
  --card-theme-mark-border: rgba(245, 158, 11, 0.32);
}

/* Bind Variables to .home-system-card */
.home-system-card {
  border-color: var(--card-theme-border, rgba(138, 144, 158, 0.22));
  background: var(--card-theme-bg, linear-gradient(135deg, rgba(255, 255, 255, 0.025), transparent 55%), rgba(13, 17, 26, 0.88));
  transition: border-color 200ms ease, background 200ms ease, box-shadow 200ms ease, transform 150ms ease;
}

#home-view[data-card-theme="glass"] .home-system-card {
  backdrop-filter: blur(14px);
}

.home-system-card::after {
  border-top-color: var(--card-theme-corner, rgba(138, 144, 158, 0.28));
  border-right-color: var(--card-theme-corner, rgba(138, 144, 158, 0.28));
  transition: border-color 200ms ease;
}

.home-system-card:hover {
  border-color: var(--card-theme-border-hover, rgba(195, 200, 209, 0.48));
  background: var(--card-theme-bg-hover, #14161b);
  box-shadow: var(--card-theme-glow, none);
}

.home-system-card:hover .home-system-open {
  color: var(--card-theme-accent, var(--studio-text-main));
}

/* --- Theme Customization Toolbar Styling ------------------------------ */
.home-theme-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 10px 14px;
  padding: 8px 14px;
  border: 1px solid rgba(138, 144, 158, 0.16);
  border-radius: 4px;
  background: rgba(13, 17, 26, 0.65);
  backdrop-filter: blur(8px);
}

.home-theme-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}

.home-theme-badge {
  display: inline-block;
  padding: 2px 6px;
  border: 1px solid var(--card-theme-accent, rgba(112, 213, 207, 0.35));
  border-radius: 2px;
  color: var(--card-theme-accent, #70d5cf);
  font: 600 8px "DM Mono", monospace;
  letter-spacing: 1.1px;
  transition: border-color 200ms ease, color 200ms ease;
}

.home-theme-desc {
  color: var(--studio-text-muted);
  font-size: 11px;
  letter-spacing: 0.2px;
}

.home-theme-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.theme-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(138, 144, 158, 0.22);
  border-radius: 3px;
  background: rgba(20, 22, 27, 0.70);
  color: var(--studio-text-muted);
  cursor: pointer;
  font: 500 11px "Space Grotesk", sans-serif;
  letter-spacing: 0.1px;
  transition: all 160ms cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
}

.theme-chip:hover {
  transform: translateY(-1px);
  border-color: rgba(195, 200, 209, 0.48);
  background: rgba(30, 36, 48, 0.90);
  color: var(--studio-text-main);
}

.theme-chip:active {
  transform: translateY(0);
}

.theme-chip:focus-visible {
  outline: 2px solid var(--card-theme-accent, var(--studio-amber));
  outline-offset: 2px;
}

.theme-chip.is-active,
.theme-chip[aria-checked="true"] {
  border-color: var(--card-theme-accent, #70d5cf);
  background: rgba(25, 32, 45, 0.98);
  color: var(--studio-text-main);
  box-shadow: 0 0 14px rgba(112, 213, 207, 0.25);
  font-weight: 600;
}

/* Dual-Color Swatches */
.theme-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  flex-shrink: 0;
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.theme-chip.is-active .theme-swatch {
  transform: scale(1.15);
  box-shadow: 0 0 8px currentColor;
}

.theme-swatch-classic {
  background: linear-gradient(135deg, #70d5cf 50%, #14161b 50%);
  color: #70d5cf;
}

.theme-swatch-cyberpunk {
  background: linear-gradient(135deg, #ff007f 50%, #00f0ff 50%);
  color: #ff007f;
}

.theme-swatch-minimal-dark {
  background: linear-gradient(135deg, #e4e4e7 50%, #050505 50%);
  color: #e4e4e7;
}

.theme-swatch-glass {
  background: linear-gradient(135deg, #38bdf8 50%, rgba(26, 38, 57, 0.9) 50%);
  color: #38bdf8;
}

.theme-swatch-material-vibrant {
  background: linear-gradient(135deg, #f59e0b 50%, #8b5cf6 50%);
  color: #f59e0b;
}

/* Responsive Overrides */
@media (max-width: 900px) {
  .home-theme-bar {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    margin: 0 2px 14px;
    padding: 10px 12px;
  }

  .home-theme-picker {
    width: 100%;
    justify-content: flex-start;
    overflow-x: auto;
    padding-bottom: 4px;
  }
}

@media (max-width: 640px) {
  .home-theme-desc {
    display: none;
  }

  .theme-chip {
    min-height: 28px;
    padding: 0 9px;
    font-size: 10px;
  }

  .theme-swatch {
    width: 10px;
    height: 10px;
  }
}
```

### 3.3 DOM Contract with `workspace-prototype/src/main.ts`

The Worker can wire the home screen theme picker to `applyCardTheme` using clean event delegation:

```typescript
// In workspace-prototype/src/main.ts
function setupHomeThemePicker(): void {
  const picker = document.querySelector<HTMLElement>('[data-theme-picker]');
  if (!picker) return;

  picker.addEventListener('click', (event) => {
    const chip = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-theme-id]');
    if (!chip) return;

    const themeId = chip.dataset.themeId as CardThemeId;
    if (themeId) {
      applyCardTheme(themeId);
    }
  });
}

export function updateHomeThemeUi(activeThemeId: CardThemeId): void {
  const homeView = document.getElementById('home-view');
  if (homeView) {
    homeView.setAttribute('data-card-theme', activeThemeId);
  }

  const chips = document.querySelectorAll<HTMLButtonElement>('[data-theme-picker] [data-theme-id]');
  chips.forEach((chip) => {
    const isActive = chip.dataset.themeId === activeThemeId;
    chip.classList.toggle('is-active', isActive);
    chip.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}
```

---

## 4. Caveats

1. **Read-Only Scope**: In strict adherence to the Teamwork Explorer archetype, zero source files (`index.html`, `style.css`, `main.ts`) were modified. All snippets and rules are provided for the Milestone M3 Worker.
2. **Hero Preview Stack Integration**: While `.home-system-card` is the primary target for card theming, the optional enhancement of `.home-stack-card-front` inside `.home-hero-visual` can also consume `--card-theme-border` and `--card-theme-accent` if desired.
3. **M2 Dependency Coordination**: Milestone M2 wires `#home-view` card navigation (`data-open-studio`, `data-card-id`). The `.theme-chip` buttons use `type="button"` and do not have `data-open-studio`, completely eliminating any accidental navigation or event listener collision.

---

## 5. Conclusion

1. **Placement**: The optimal location for the theme picker controls is within `.home-systems`, positioned directly between `.home-section-heading` and `.home-system-grid`. This ensures contextual proximity to the cards, maximum horizontal space, and instant visual feedback.
2. **Markup**: An accessible `<div class="home-theme-picker" data-theme-picker role="radiogroup">` containing 5 `<button class="theme-chip" role="radio">` items with dual-color swatches (`.theme-swatch`) provides complete screen-reader and tactile fidelity.
3. **Styling**: Cascading CSS custom properties (`--card-theme-*`) keyed to `#home-view[data-card-theme="..."]` provide seamless, hardware-accelerated transitions across backgrounds, borders, corner accents, hover glows, and glass backdrop filters without DOM thrashing.

---

## 6. Verification Method

To verify these recommendations independently:

1. **Verify Baseline Non-Regression**:
   ```powershell
   cd g:\micro-host\workspace-prototype
   npm test
   npx tsc --noEmit
   npm run build
   ```
2. **Post-Implementation Verification (by Worker)**:
   - Inspect `#home-view`: Verify `.home-theme-bar` renders above `.home-system-grid` with all 5 chips.
   - Click each chip (`classic`, `cyberpunk`, `minimal-dark`, `glass`, `material-vibrant`):
     - Confirm `#home-view` updates `data-card-theme="<id>"`.
     - Confirm `.theme-chip.is-active` moves to the clicked chip and updates `aria-checked="true"`.
     - Confirm `.home-system-card` elements visibly change borders, backgrounds, corner brackets, and hover glows.
     - Confirm `glass` triggers `backdrop-filter: blur(14px)`.
   - Run responsive test at viewport widths `1240px`, `900px`, and `400px` to verify clean flex wrapping and chip scaling.
