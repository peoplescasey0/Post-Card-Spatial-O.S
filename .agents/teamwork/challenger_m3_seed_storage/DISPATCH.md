## 2026-11-11T21:18:19Z

You are Challenger 1 (Seed Input & Storage Challenger) for Milestone 3: Theme Selection Controls and State Persistence.

Working directory: G:\micro-host\workspace-prototype
State folder: G:\micro-host\.agents\teamwork\challenger_m3_seed_storage\

You MUST read:
1. G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. G:\micro-host\PROJECT.md
3. G:\micro-host\.agents\teamwork\sub_orch_controls\SCOPE.md
4. G:\micro-host\.agents\teamwork\worker_m3_controls\handoff.md

Mission:
Write and execute an empirical, adversarial test suite to stress-test seed color handling and storage persistence in Post Card OS:
1. Seed Input Sanitization & Palette Generation:
   - Test diverse valid seeds (3-digit `#fff`, 6-digit `#1a73e8`, uppercase/lowercase `#00C853` vs `#00c853`).
   - Test boundary/extreme hex values (`#000000`, `#ffffff`, saturated primaries `#ff0000`, `#00ff00`, `#0000ff`).
   - Test invalid/malformed inputs (`#xyz`, `not-a-color`, `""`, null/undefined) to ensure graceful fallback without uncaught exceptions.
2. Storage Persistence & Rehydration:
   - Test localStorage roundtrip for canonical presets, Android presets, and `seed:#HEX`.
   - Test corrupted or unexpected localStorage values and verify safe fallback to default ("classic").
   - Test simulated cold boot hydration (`applyCardTheme(loadPersistedTheme())`).
3. Execution:
   - Create and run an adversarial test file (e.g. `tests/m3_challenger_seed_storage.test.mjs`) using `node --test`.
   - Run `npx tsc --noEmit` and full `npm test`.
4. Report:
   - Write your handoff report to `G:\micro-host\.agents\teamwork\challenger_m3_seed_storage\handoff.md`.
   - Explicitly declare your verdict: **APPROVE** or **REQUEST_CHANGES** with exact test results.
