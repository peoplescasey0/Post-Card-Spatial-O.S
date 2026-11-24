# Post Card Spatial OS

A local workstation for controlled security labs and development environments. Run isolated guest systems, inspect their behavior, snapshot or reset work, and switch between environments in a spatial workspace. Use network testing features only on systems and networks you own or are authorized to assess.

## Documentation & User Manual
For comprehensive operating procedures, 3D navigation shortcuts, multi-OS hypervisor profiles, AI Butler orchestration, Freeplane mind mapping, and commercial editions, see the **[Official User Manual & Field Guide](USER_MANUAL.md)** or press `?` inside the running workspace.

## Layout
- `workspace-prototype/` - Vite + TypeScript + Three.js lab UI, noVNC display,
  and `guest-api.mjs`, the local QEMU/QMP/VNC service for managing guest environments.
- `supabase/` - Supabase project configuration.
- `scripts/stripe_sync.mjs` - Stripe catalog sync (reads keys from environment variables).

## Relationship to micro-host
The bare-metal kernel, user programs and security layer live in a separate repo:
https://github.com/peoplescasey0/micro-host

The first product focus is the workstation-hosted lab workflow: start a guest, perform authorized testing or development, save a checkpoint, and reset or clone the environment. The bare-metal micro-host remains a separate long-term direction rather than a dependency for the current workflow.

## Run
```powershell
cd workspace-prototype
npm install
npm run dev
```

Guest disk images and overlays live in `workspace-prototype/data/` and are
**not** tracked in git (they are many GB). Keep them backed up separately.

## Secrets
Never commit keys. Use environment variables (for example `STRIPE_SECRET_KEY`).

## License

Copyright (c) 2026 peoplescasey0. All rights reserved. See [LICENSE](LICENSE).
