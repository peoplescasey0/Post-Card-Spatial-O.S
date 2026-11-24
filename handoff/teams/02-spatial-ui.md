# BRIEFING — 02 spatial UI

## Mission

Own the spatial studio: scene, camera, carousel, card rendering, input, and the
visual language. Make the workspace feel like a precision instrument, not a demo.

## Start

**+1 day**, after `main.ts` extraction (see `handoff/EXTRACTION_MAP.md`). Nothing
else blocks you.

## Owns

- `src/room/` — scene, camera, orbit, carousel, render loop
- `src/input/` — pointer, wheel, keyboard, hit testing
- `src/cards/` — card model, layout, textures, painter
- `src/bin/` — paper bin, fold flight, restore, delete confirmation
- `src/ui/` — dialogs, toasts, theme picker, guided tour
- `index.html`, `src/style.css` (until 08 splits it)

## Reads, never writes

- `handoff/contracts/card-manifest.v1.json` — persisted card shape
- `handoff/contracts/guest-lifecycle.v1.md` — the only way to change guest state
- `handoff/contracts/telemetry.v1.json` — HUD data

## First three tasks

1. Finish the extraction: `main.ts` under 200 lines, 285 tests still green.
2. Make inactive-card privacy real in the render path: live framebuffer only on
   the selected card, everything else edge-on with the private-display indicator.
3. Reduced-motion audit: every animation has a documented instant fallback.

## Definition of done

- `node --test` green; `npm run build` green.
- No new direct `fetch("/api/guest/...")` calls — go through `src/guests/`.
- Design discipline holds: `#FFB81C` only for active/primary/critical states.

## Do not touch

`guest-api.mjs`, `stripe-api.mjs`, `src-rust/`, `kernel/`, `tests/` (07 owns tests),
`handoff/contracts/`.

## Branch

`section-02-ui`
