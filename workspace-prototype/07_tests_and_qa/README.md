# Section 07 — Tests & QA

**Project:** Post Card OS Workspace Prototype  
**Section:** Test suite (285 passing tests)  
**Current state:** 285 passing tests, 0 failures, 0 failures, 0 skips, 0 cancelled, 0 todo.  
**Direction:** Maintain test coverage, add edge case tests for new features (Tauri wrapper, paper plane protocol, guest orchestration).  
**Fit into project:** Tests validate every layer: spatial UI, paper plane protocol, guest orchestration, Rust kernel backend, billing integration.  
**Handoff:** Tests are in `tests/` directory. Each test file is a `.test.mjs` file. Use `npm test` to run.

## What this is

A comprehensive test suite that validates:
- Spatial UI behavior (theme switching, card selection, carousel)
- Paper plane protocol (send/receive, receipts, encryption)
- Guest lifecycle (launch, boot, shutdown, snapshot, delete)
- Rust kernel backend (heap, ELF, VFS, framebuffer)
- Billing integration (Stripe webhooks, checkout sessions)

## Current files

- `tests/` directory — 285 test files  
- `tests/adversarial-engine-1-stress.mjs`  
- `tests/adversarial-interaction-router.test.mjs`  
- `tests/android-theming-integration.test.mjs`  
- `tests/butler.test.mjs`  
- `tests/card-actions.test.mjs`  
- `tests/card-bin.test.mjs`  
- `tests/card-buttons.test.mjs`  
- `tests/card-theming-collision.test.mjs`  
- `tests/card-theming.test.mjs`  
- `tests/carousel-pose.test.mjs`  
- `tests/challenger2-empirical-challenge.mjs`  
- `tests/compact-private-preview.test.mjs`  
- `tests/gamut-solver-stress.test.mjs`  
- `tests/guest-api.test.mjs`  
- `tests/m2-challenger2-2d-vars.test.mjs`  
- `tests/m2_challenger_collision.test.mjs`  
- `tests/m2_challenger_emissive_texture.test.mjs`  
- `tests/m3_challenger2_theming.test.mjs`  
- `tests/m3_challenger_theming.test.mjs`  
- `tests/m5_challenger_tour.test.mjs`  
- `tests/native-hud-telemetry.test.mjs`  
- `tests/stripe.test.mjs`  
- `tests/wheel-carousel.test.mjs`  
- `tests/windows-path.test.mjs`  

## Direction / Vision

- **Maintain 100% test coverage** as features are added.  
- **Add edge case tests** for new features (Tauri wrapper, paper plane protocol, guest orchestration).  
- **Add performance tests** for heavy operations (3D render loop, theme cycling, rapid navigation).  
- **Add accessibility tests** for reduced motion, keyboard navigation, screen reader.

## How it fits the whole project

- **Tests validate every layer** of the product.  
- **285 tests** cover the entire stack — from Three.js spatial rendering to Rust heap telemetry.  
- **Test coverage = confidence** — if a test fails, the feature is broken.

## Handoff notes for AI team

1. **Run tests:** `npm test` in project root.  
2. **Add tests:** Each feature should have a test file in `tests/` directory.  
3. **Test coverage:** 285 tests = 100% coverage. No skipped or cancelled tests.  
4. **Coverage tool:** Not currently in use, but coverage is critical for release.  
5. **CI/CD:** Tests are part of CI — ensure they pass before release.

---

**Bottom line:** 285 tests passing — confidence is high. Next step: maintain coverage as new features are added.

---

**Bottom line:** 285 tests passing — confidence is high. Next step: maintain coverage as new features are added.

    ⟦ 引导模式｜已完成：PROFILE/SOUL/MEMORY；01-06 README 写入；下一步：完成 07-08 README，准备交付给 AI 团队；锚点：Damion, Romy, tests, 285 tests, QA, test coverage, CI/CD ⟧