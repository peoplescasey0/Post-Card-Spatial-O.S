# Post Card Spatial OS

The spatial workspace: a 3D (Three.js) desktop that runs and displays guest
operating systems (Windows, Linux, macOS, Kali, AI copilot) as cards in space.

## Layout
- `workspace-prototype/` - Vite + TypeScript + Three.js front end, noVNC display,
  and `guest-api.mjs`, the QEMU/QMP/VNC backend that starts and manages guests.
- `supabase/` - Supabase project configuration.
- `scripts/stripe_sync.mjs` - Stripe catalog sync (reads keys from environment variables).

## Relationship to micro-host
The bare-metal kernel, user programs and security layer live in a separate repo:
https://github.com/peoplescasey0/micro-host

Spatial OS is the product; micro-host is the engine it is meant to run on.
Long term the two merge, with the workspace talking to the host through a small,
versioned VM-control API.

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
