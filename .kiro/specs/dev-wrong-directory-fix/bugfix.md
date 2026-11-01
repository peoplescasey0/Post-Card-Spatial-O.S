# Bugfix Requirements Document

## Introduction

This document defines requirements for fixing a bug where `npm run dev` (and the related `build`, `preview`, and `test` scripts) fail when executed from the parent directory `G:\micro-host` instead of the project root `g:\micro-host\micro-host`. Because the parent directory has no `package.json`, npm aborts with an `ENOENT` error before anything starts, so the Post Card Spatial OS dev server (the "cards" UI) never boots. The user mistook this npm failure for a VM/boot failure.

### Confirmed directory layout

- `G:\micro-host` — parent of the project root. Contains `micro-host`, `temp-build`, and config folders. **Has no `package.json`**, which is the direct cause of the `ENOENT` error.
- `g:\micro-host\micro-host` — the Kiro workspace root and project root. Contains a delegator `package.json` whose scripts forward to `workspace-prototype` (for example, `"dev": "npm --prefix workspace-prototype run dev"`).
- `g:\micro-host\micro-host\workspace-prototype` — the Vite app for the Post Card Spatial OS frontend (`index.html`, `vite.config.mjs`, `src/`). Its `package.json` runs `"dev": "vite"`.

### Intended delegation chain

After the fix, running an npm script from `G:\micro-host` follows this chain:

`G:\micro-host\package.json` (new parent delegator) -> delegates to `micro-host` -> delegates to `workspace-prototype` -> runs `vite`.

### Out-of-workspace constraint

The file to be created (`G:\micro-host\package.json`) lives at `G:\micro-host`, which is **outside the Kiro workspace root** (`g:\micro-host\micro-host`). The user has **explicitly approved** placing a `package.json` at `G:\micro-host`. This deviation is intentional and required for the fix; it must be flagged during implementation so the reviewer is aware the new file sits outside the workspace tree.

### Design constraints (carried into requirements)

- The fix must be purely additive: a new minimal parent delegator at `G:\micro-host\package.json` that mirrors the existing delegator style in `g:\micro-host\micro-host\package.json`.
- No new tooling, monorepo managers (nx/turbo/lerna), build systems, or dependencies may be introduced.
- Existing behavior when running from the correct folder (`g:\micro-host\micro-host`) must be preserved unchanged.
- npm cannot run any precheck script before a `package.json` exists, so the parent delegator file itself is the primary lever; no error-reporting system that npm cannot trigger should be built.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `npm run dev` is executed with the current working directory set to `G:\micro-host` (the parent of the project root, which contains no `package.json`) THEN the system fails with `npm error code ENOENT` ("no such file or directory, open 'G:\micro-host\package.json'") and the Post Card Spatial OS dev server never starts.

1.2 WHEN `npm run build`, `npm run preview`, or `npm run test` is executed from `G:\micro-host` THEN the system fails with the same `ENOENT` error and the corresponding task never runs.

1.3 WHEN the `ENOENT` failure occurs THEN the system provides no actionable guidance pointing the user to the correct project folder, which leads the user to misdiagnose the npm failure as a VM/boot failure.

### Expected Behavior (Correct)

2.1 WHEN `npm run dev` is executed from `G:\micro-host` THEN the system SHALL start the Post Card Spatial OS Vite dev server by delegating down through `micro-host` to `workspace-prototype`, without requiring the user to change directory.

2.2 WHEN `npm run build`, `npm run preview`, or `npm run test` is executed from `G:\micro-host` THEN the system SHALL delegate down to `micro-host` and execute the corresponding task in `workspace-prototype` without error.

2.3 WHEN the new parent delegator at `G:\micro-host\package.json` invokes a script THEN the system SHALL use the same `npm --prefix` delegation pattern already used by `g:\micro-host\micro-host\package.json`, introducing no new tooling, dependencies, or build systems.

2.4 WHEN `npm run dev` (or build/preview/test) is executed from `G:\micro-host` THEN the full delegation chain SHALL be `G:\micro-host\package.json` -> `micro-host` -> `workspace-prototype` -> `vite` (or the relevant script), and SHALL succeed without manual `cd`.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `npm run dev` (or build/preview/test) is executed from `g:\micro-host\micro-host` (the correct project root) THEN the system SHALL CONTINUE TO delegate to `workspace-prototype` and behave exactly as before the fix.

3.2 WHEN `npm run dev` is executed from `g:\micro-host\micro-host\workspace-prototype` THEN the system SHALL CONTINUE TO run the Vite dev server directly with no change.

3.3 WHEN the existing delegator `package.json` at `g:\micro-host\micro-host\package.json` is invoked THEN the system SHALL CONTINUE TO forward to `workspace-prototype` unchanged; the fix is purely additive (a new parent delegator) and does not modify any existing `package.json`.

3.4 WHEN the user runs scripts from any directory other than `G:\micro-host` and `g:\micro-host\micro-host` (for example, a folder with no `package.json` and no delegator, or the `workspace-prototype` folder directly) THEN the system SHALL CONTINUE TO behave as it does today, with no new tooling or error-reporting system introduced.
