# Spatial Workspace Prototype (`workspace-prototype`) — Directory Rules

## Stack & Structure
- **Frontend (`src/main.ts`, `src/style.css`, `index.html`)**: TypeScript, Three.js (`^0.180.0`), Vite (`^7.1.12`), and `@novnc/novnc` (`^1.7.0`).
- **Guest Manager (`guest-api.mjs`, `monitor-qemu.mjs`)**: Node.js ESM service integrated into the Vite dev/preview server via middleware (`vite.config.mjs`).
- **Tests (`tests/guest-api.test.mjs`)**: Native Node test runner (`node --test`).

## UI, 3D Rendering & Accessibility Rules
- **3D Card Geometry & Backface Rendering**: Preserve dual-sided card materials and backface visibility when modifying card meshes or flip animations so settings faces and front faces both render cleanly without z-fighting.
- **Reduced Motion**: Respect `prefers-reduced-motion` media queries for card movement, camera transitions, flip animations, and paper-plane delivery animations.
- **Performance Caps**: Keep pixel ratio and render resolution bounded so the Three.js studio stays responsive while live noVNC guest displays are active.

## Guest Lifecycle Rules (`guest-api.mjs`)
- **Resource Limits**: Enforce the active guest cap (maximum 4 concurrent guests and 8 GiB total guest RAM).
- **Linux Guests**: Must use copy-on-write QCOW2 overlays (`data/overlays/<card-id>.qcow2`) backed by `data/master-images/debian-golden.qcow2` once finalized. Never boot a finalized golden image directly in read-write mode.
- **Windows 11 Guests**: Execute through WSL 2 (`wsl.exe`) with `qemu-system-x86_64`, `swtpm`, and OVMF Secure Boot templates. Keep per-card TPM state and UEFI variables isolated per card.
- **Testing**: Always run `npm test` and `npm run build` from `workspace-prototype` (or root) after modifying TypeScript or `.mjs` files.

