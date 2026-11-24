# BRIEFING — 08 assets and config

## Mission

Own the surface people judge in three seconds: assets, config, packaging, and the
6,823-line stylesheet that currently hides the entire design system.

## Start

**Today.** No dependencies.

## Owns

- `public/` (logo, textures, icons)
- `src/style.css` -> `src/styles/` (one file per component; 02 imports)
- `.env.example`, config defaults, `vite.config.mjs`
- README screenshots and demo capture

## First three tasks

1. Split `style.css` into component stylesheets. Mechanical, no visual change:
   verify by screenshot diff before/after.
2. A single `assets/design-tokens.css` holding the palette (`#07090E`, `#0D111A`,
   `#14161B`, `#1E2736`, `#262A33`, `#FFB81C`, `#F4F5F7`, `#8A909E`) so the
   gold-reserved-for-active rule lives in one place.
3. Capture the demo: a 60-90 second screen recording of one Linux card booting,
   a plane sent, and the plane read on the second card. Put it at the top of the
   README. This is worth more than any paragraph in the repo.

## Rules

- Gold `#FFB81C` stays reserved for active/primary/critical. Never decoration.
- Every asset has a reason in the commit message; no mystery binaries.
- `.env` is never committed; `.env.example` is always current.

## Definition of done

- `style.css` gone, components in place, zero visual regression.
- README has a working GIF and a "what actually runs" table.
- Build output checked in `dist/` only when someone asks for a release.

## Do not touch

`guest-api.mjs`, `kernel/`, `tests/`, `handoff/contracts/`.

## Branch

`section-08-assets`
