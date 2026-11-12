# Task Assignment: Worker Engine 2 — Seed Descriptor Parsing Fix & Verification

## Identity & Context
- Role: `teamwork_worker`
- State Folder: `G:\micro-host\.agents\teamwork\worker_engine_2\`
- Working Directory: `G:\micro-host`
- Exclusively Owned File: `G:\micro-host\workspace-prototype\src\card-themes.ts`

## Mandatory Reading
1. `G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md`
2. `G:\micro-host\PROJECT.md`
3. `G:\micro-host\.agents\teamwork\sub_orch_engine\SCOPE.md`
4. `G:\micro-host\.agents\teamwork\reviewer_engine_1\handoff.md`
5. `G:\micro-host\.agents\teamwork\challenger_engine_2\handoff.md`
6. `G:\micro-host\workspace-prototype\src\card-themes.ts`

## MANDATORY INTEGRITY WARNING
> DO NOT CHEAT. All implementations must be genuine. DO NOT
> hardcode test results, create dummy/facade implementations, or
> circumvent the intended task. A teamwork_auditor will independently
> verify your work. Integrity violations WILL be detected and your
> work WILL be rejected.

## Objective & Task
Reviewer 1 and Challenger 2 identified a specific functional defect in `workspace-prototype/src/card-themes.ts`:

In `isValidCardThemeId` (line 1003) and `getCardTheme` (line 1022):
```typescript
if (id.startsWith("seed:")) {
  const seedPart = id.slice(5).trim();
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(seedPart);
}
```
Because of `#?`, strings without `#` like `"seed:bad"` are matched as valid hex (since `b`, `a`, `d` are valid hex characters), preventing safe fallback to `"classic"` and failing test `Tier 2.23: Boundary B5.3` in `tests/android-theming-integration.test.mjs`.

### Fix:
1. Update `isValidCardThemeId`:
   ```typescript
   if (id.startsWith("seed:")) {
     const seedPart = id.slice(5).trim();
     return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(seedPart);
   }
   ```
2. Update `getCardTheme`:
   ```typescript
   if (id.startsWith("seed:")) {
     const seedPart = id.slice(5).trim();
     if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(seedPart)) {
       return generateThemeFromSeed(seedPart, { id: id as CardThemeId });
     }
   }
   ```
3. Run `npx tsc --noEmit` inside `workspace-prototype/` (must exit 0).
4. Run `npm test` inside `workspace-prototype/` (all 188 tests across all suites, including the 11 baseline suites and `android-theming-integration.test.mjs`, must pass with 0 failures).

Write your handoff report to `G:\micro-host\.agents\teamwork\worker_engine_2\handoff.md` and send a completion message back.


## 2026-11-11T20:05:47Z
You are Worker Engine 2 for Milestone 1: Android Theming Engine.

Read your task assignment at:
G:\micro-host\.agents\teamwork\worker_engine_2\DISPATCH.md

State Folder: G:\micro-host\.agents\teamwork\worker_engine_2\
Working Directory: G:\micro-host

Read ORIGINAL_REQUEST.md, PROJECT.md, SCOPE.md, reviewer_engine_1/handoff.md, and workspace-prototype/src/card-themes.ts.
Fix the seed descriptor parsing regex in lines 1003 & 1022 of card-themes.ts so `seed:bad` correctly falls back to classic.
Run `npx tsc --noEmit` and `npm test` inside `workspace-prototype/`. Verify all 188 tests pass.
Write your handoff report to G:\micro-host\.agents\teamwork\worker_engine_2\handoff.md and send a completion message back.
