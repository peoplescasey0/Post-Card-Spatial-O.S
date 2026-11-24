# BRIEFING — 03 rust kernel backend

## Mission

Own the bare-metal story: paging, heap, ELF loader, VFS bridge, framebuffer HUD.
This section is real engineering, but it is deliberately **off the critical path**.

## Start

**Today**, lowest priority. Nothing depends on you, so nothing should ever wait
on you. If the project is under time pressure, this is the lane that pauses.

## Owns

- `kernel/` (22 `#![no_std]` modules)
- `src-rust/` in `workspace-prototype` (`heap.rs`, `elf_loader.rs`, `vfs_storage.rs`,
  `native_hud.rs`, `framebuffer.rs`)
- `user/`, `secure/` where they touch kernel contracts

## First three tasks

1. Get `cargo check` green on a clean machine (CI job exists, currently
   non-blocking). Flip `continue-on-error` to false the day it passes.
2. Keep `tests/native-hud-telemetry.test.mjs` honest: it asserts source text, so
   it will pass on broken code. Add at least one test that asserts behavior.
3. Separate what runs from what is described. Nothing in the boot log should claim
   hardware that isn't present.

## Guardrails

- Don't gate any other section on kernel work. Ever.
- Don't let the aviation names leak into the other sections' vocabularies.
- Claims discipline: no README line may assert a capability the CI cannot
  demonstrate. `0 bytes outbound` is true because there's no network stack;
  say it that way.

## Definition of done

- Kernel builds and boots in QEMU on CI, headless, with a self-test count printed.
- `src-rust/` modules stay importable by the frontend tests.

## Do not touch

`guest-api.mjs`, `stripe-api.mjs`, `src/main.ts`, `handoff/contracts/`.

## Branch

`section-03-kernel`
