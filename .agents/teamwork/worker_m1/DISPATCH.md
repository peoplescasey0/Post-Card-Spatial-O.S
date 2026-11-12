## 2026-11-11T18:00:46Z
You are the Worker for Milestone M1: Theming Research Documentation.

MANDATORY FIRST STEPS:
1. Read g:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. Read g:\micro-host\PROJECT.md
3. Read g:\micro-host\.agents\teamwork\sub_orch_theming\SCOPE.md
4. Read survey handoffs:
   - g:\micro-host\.agents\teamwork\explorer_survey_1\handoff.md
   - g:\micro-host\.agents\teamwork\explorer_survey_3\handoff.md

State folder: g:\micro-host\.agents\teamwork\worker_m1\
Working directory: g:\micro-host

Your Mission:
Document a comprehensive, authoritative research summary on common card theming patterns suitable for spatial cards in the spatial computing environment in g:\micro-host\THEMING_RESEARCH.md.

Scope & Content Requirements:
1. Common Theming Paradigms & Android Home Screen Customization:
   - Exploration of Android home screen customization options (launcher icon packs, widget color palettes, system-wide wallpaper color extraction, Material You / Material 3 dynamic color, tonal palettes, luminance-guided contrast ratios).
   - Comparison of mobile 2D flat customization vs 3D spatial computing environments.
2. Spatial Computing UI Tokens & 3D Materials:
   - Spatial UI tokens: glassmorphism, depth-based elevation, specular highlights, glowing halos, ambient lighting integration, PBR metallic/roughness properties, canvas texture rasterization (e.g. 1280x1920 2x canvas).
   - Card anatomy in spatial view: edge chassis, fasteners, status LED, front/back face canvas, tactile printed buttons.
3. 5 Detailed Theme Profiles (to be implemented in Milestone M3):
   - Classic Studio (slate cardstock #14161b -> #0d111a, cyan precision border #70d5cf, matte finish roughness 0.85, metalness 0.05).
   - Cyberpunk Neon (midnight obsidian #0b0416 -> #05020a, neon magenta #ff007f and cyan #00f0ff dual stroke, high emissive intensity 0.95, glossy chassis roughness 0.25, metalness 0.70).
   - Minimal Dark (pure AMOLED black #050505 -> #000000, micro-thin zinc border #27272a, silver typography, anti-reflective matte roughness 0.96, metalness 0.0).
   - Glass / Frosted (translucent ice-blue acrylic rgba(26, 38, 57, 0.75) -> rgba(13, 20, 32, 0.85), crystal specular, polished acrylic roughness 0.15, metalness 0.10, cyan halo).
   - Material Vibrant (Android Expressive indigo surface #181124 -> #0e0918, warm amber #f59e0b / coral / violet #8b5cf6 accents, satin tactile finish roughness 0.65, metalness 0.15).
4. Technical Integration Architecture for Post Card Spatial OS:
   - Specification of the TypeScript token schema (`CardThemeDefinition`, `CardThemeId`).
   - Dual-view styling mapping: 2D CSS custom properties on `#home-view` (.home-system-card) and 3D Three.js textures in `makeCardTexture`.
   - Texture cache invalidation strategy (`computeCardContentKey`).
   - Local persistence mechanism (`localStorage` key: `postcard_studio_card_theme`).

File Write Ownership:
- g:\micro-host\THEMING_RESEARCH.md
- Your state folder metadata: g:\micro-host\.agents\teamwork\worker_m1\
