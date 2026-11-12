# Forensic Auditor Task Assignment

## Identity & Context
- Role: `teamwork_auditor`
- State Folder: `G:\micro-host\.agents\teamwork\auditor_engine_2\`
- Working Directory: `G:\micro-host`

## Mandatory Reading
1. `G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md`
2. `G:\micro-host\PROJECT.md`
3. `G:\micro-host\.agents\teamwork\sub_orch_engine\SCOPE.md`
4. `G:\micro-host\.agents\teamwork\worker_engine_2\handoff.md`
5. `G:\micro-host\workspace-prototype\src\card-themes.ts`

## Audit Mission
Perform strict integrity forensics on `workspace-prototype/src/card-themes.ts`:
1. **Facade & Dummy Detection**: Verify authentic mathematical algorithms for all transformations (`srgbToLinear`, `linearToSrgb`, `rgbToXyz`, `xyzToLab`, `labToLch`, `lchToLab`, `labToXyz`, `xyzToRgb`, `getTone`, `generateThemeFromSeed`). No mock or canned data.
2. **Dependency Integrity**: Confirm zero unauthorized packages added to `package.json`. Zero external dependencies.
3. **Cheating & Test Circumvention**: Check that no test-specific shortcuts exist.
4. **Verdict**: If clean, output `CLEAN`. If violations detected, output `INTEGRITY VIOLATION`.

Write your report to `G:\micro-host\.agents\teamwork\auditor_engine_2\handoff.md` with an explicit verdict (`CLEAN` or `INTEGRITY VIOLATION`) and send a completion message back.


## 2026-11-11T20:12:46Z
You are the Forensic Integrity Auditor for Milestone 1: Android Theming Engine.

Read your task assignment at:
G:\micro-host\.agents\teamwork\auditor_engine_2\DISPATCH.md

State Folder: G:\micro-host\.agents\teamwork\auditor_engine_2\
Working Directory: G:\micro-host

Read ORIGINAL_REQUEST.md, PROJECT.md, SCOPE.md, worker_engine_2/handoff.md, and workspace-prototype/src/card-themes.ts.
Perform exhaustive integrity forensics: verify genuine mathematical implementations, ensure zero dummy facades, verify zero unauthorized dependencies in package.json, verify zero hardcoding or test tampering, and test dynamic generation across arbitrary seeds.
Write your handoff report to G:\micro-host\.agents\teamwork\auditor_engine_2\handoff.md with an explicit verdict (CLEAN or INTEGRITY VIOLATION), and send a completion message back.
