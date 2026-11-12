# Original User Request

## Initial Request — 2026-11-11T19:06:48Z

Complete the theming system for Post Card OS to bring card and interface theming as close to Android theming as possible for production use, incorporating both dynamic seed-color palette generation and preset Android theme palettes across 2D home-screen cards and 3D spatial cards.

Integrity mode: development

## Requirements

### R1. Android Theming Engine
Implement an Android-style theming engine for Post Card OS supporting preset Android Material theme palettes and dynamic tonal palette generation from seed colors.

### R2. Surface Integration across 2D and 3D Views
Apply the theme palettes consistently across both 2D home-screen cards and 3D spatial studio cards, updating card surfaces, accents, text, and container styling.

### R3. Theme Selection Controls and State Persistence
Provide interface controls to select preset Android themes or generate themes from seed colors, and ensure the active theme persists across navigation between the 2D home view and the 3D spatial studio view.

## Acceptance Criteria

### Theming Engine
- [ ] Preset Android-style theme palettes are available and selectable within the application.
- [ ] Dynamic color palettes are generated from seed colors, producing coordinated tonal color roles for card backgrounds, borders/accents, and foreground elements.

### Surface Integration & Controls
- [ ] Selecting or generating a theme visibly updates all 2D home-screen cards.
- [ ] Selecting or generating a theme visibly updates 3D spatial cards in the studio view.
- [ ] The selected theme remains active when switching between the 2D home view and the 3D spatial studio view.

### Verification
- [ ] Automated tests in the workspace verify theme palette generation, theme application to card components, and view persistence.
- [ ] Existing workspace automated test suites pass without regressions.
