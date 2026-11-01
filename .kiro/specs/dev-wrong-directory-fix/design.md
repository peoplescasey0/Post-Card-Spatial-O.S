# Dev Wrong Directory Fix Bugfix Design

## Overview

When `npm run dev` (or `build`/`preview`/`test`) is run from the parent directory `G:\micro-host` — which has no `package.json` — npm aborts with `ENOENT` before anything starts, so the Post Card Spatial OS dev server never boots. The user mistook this npm failure for a VM/boot failure.

The fix is purely additive: create a minimal parent "delegator" `package.json` at `G:\micro-host\package.json` that mirrors the existing delegator style in `g:\micro-host\micro-host\package.json` and forwards each script down one level using the same `npm --prefix` pattern. After the fix, running an npm script from `G:\micro-host` follows the chain `G:\micro-host\package.json` -> `micro-host` -> `workspace-prototype` -> `vite` (or the relevant script) with no manual `cd`. No existing file is modified, and no new tooling, dependencies, or build systems are introduced.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — executing one of the npm scripts (`dev`, `build`, `preview`, `test`) with the current working directory set to `G:\micro-host`, where no `package.json` exists. The unfixed function `F` fails with `ENOENT` for these inputs.
- **Property (P)**: The desired behavior for buggy inputs — the fixed function `F'` succeeds by delegating down through `micro-host` to `workspace-prototype`, starting the Vite dev server (or running the requested task) without requiring a directory change.
- **Preservation**: Existing behavior that must remain unchanged — running scripts from the correct project root `g:\micro-host\micro-host` or directly from `workspace-prototype` continues to work exactly as before, and directories with no delegator continue to fail with `ENOENT` by design (no error-reporting system is introduced).
- **Delegator**: A minimal `package.json` whose `scripts` entries forward to a subfolder using `npm --prefix <subfolder> run <script>`, introducing no dependencies of its own.
- **npm --prefix**: An npm flag that sets the directory npm operates in. The prefix path is resolved relative to the cwd where npm is invoked, so `npm --prefix micro-host run dev` run from `G:\micro-host` finds `G:\micro-host\micro-host\package.json`.
- **F / F'**: `F` is the original (unfixed) behavior — `ENOENT` when invoked from `G:\micro-host`. `F'` is the fixed behavior — successful delegation through the chain.

## Bug Details

### Bug Condition

The bug manifests when a user runs one of the npm scripts (`dev`, `build`, `preview`, `test`) while their current working directory is `G:\micro-host` — the parent of the project root, which contains no `package.json`. npm looks for a `package.json` in the cwd, finds none, and aborts with `ENOENT` ("no such file or directory, open 'G:\micro-host\package.json'") before any script body executes.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type CommandInvocation { command: String, cwd: Path }
  OUTPUT: boolean

  RETURN input.command IN ["npm run dev", "npm run build", "npm run preview", "npm run test"]
         AND input.cwd == "G:\\micro-host"
         AND NOT packageJsonExists(input.cwd)
         AND commandFailsWithENOENT(input.command, input.cwd)
END FUNCTION
```

### Examples

- **Dev from parent (bug)**: `npm run dev` with cwd `G:\micro-host` — unfixed behavior is `npm error code ENOENT` and the dev server never starts. Expected (fixed) behavior: the Vite dev server starts via `G:\micro-host\package.json` -> `micro-host` -> `workspace-prototype` -> `vite`.
- **Build from parent (bug)**: `npm run build` with cwd `G:\micro-host` — unfixed behavior is `ENOENT`. Expected (fixed) behavior: the `tsc --noEmit && vite build` task runs in `workspace-prototype`.
- **Test from parent (bug)**: `npm run test` with cwd `G:\micro-host` — unfixed behavior is `ENOENT`. Expected (fixed) behavior: `node --test` runs in `workspace-prototype`.
- **Edge case (not a bug)**: `npm run dev` with cwd `g:\micro-host\micro-host` already works today by delegating to `workspace-prototype`; this input is outside the bug condition and must remain unchanged.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Running `npm run dev`/`build`/`preview`/`test` from the correct project root `g:\micro-host\micro-host` must continue to delegate to `workspace-prototype` exactly as before (Requirements 3.1, 3.3).
- Running `npm run dev` directly from `g:\micro-host\micro-host\workspace-prototype` must continue to run the Vite dev server directly with no change (Requirement 3.2).
- The existing delegator `package.json` at `g:\micro-host\micro-host\package.json` is not modified by the fix; the fix is purely a new parent file (Requirement 3.3).
- Running scripts from any directory other than `G:\micro-host` and `g:\micro-host\micro-host` (for example a random folder with no `package.json` and no delegator) must continue to behave as it does today, with no new tooling or error-reporting system introduced (Requirement 3.4).

**Scope:**
All inputs that do NOT match the bug condition (i.e., cwd is not `G:\micro-host`, or the command is not one of the four npm scripts) must be completely unaffected by this fix. This includes invocations from the correct project root, from `workspace-prototype` directly, and from arbitrary folders that have no delegator (which intentionally keep failing with `ENOENT`).

**Note:** The actual expected correct behavior is defined in the Correctness Properties section (Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on the bug description, the sole root cause is:

1. **Missing delegator at the parent directory**: `G:\micro-host` has no `package.json`. npm resolves scripts relative to the cwd, so an invocation from `G:\micro-host` finds nothing to run and fails with `ENOENT`. There is no component misbehavior, no event-listener issue, and no DOM timing concern — the failure happens before any project code is reached.

The intended delegation chain already works from `g:\micro-host\micro-host` (which delegates to `workspace-prototype`), so the only missing link is the top-level parent delegator that bridges `G:\micro-host` -> `micro-host`.

## Correctness Properties

Property 1: Bug Condition - Parent Directory Delegation Succeeds

_For any_ input where the bug condition holds (a `dev`/`build`/`preview`/`test` npm script invoked from `G:\micro-host`, which currently has no `package.json`), the fixed system SHALL succeed by delegating down through `micro-host` to `workspace-prototype`, starting the Vite dev server for `dev` and running the corresponding task for `build`/`preview`/`test`, without requiring a manual directory change.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Existing Behavior Unchanged Outside the Bug Condition

_For any_ input where the bug condition does NOT hold (cwd is not `G:\micro-host`, or the command is not one of the four npm scripts), the fixed system SHALL produce exactly the same result as the original system, preserving existing delegation from `g:\micro-host\micro-host`, direct execution from `workspace-prototype`, and the unchanged `ENOENT` behavior for directories with no delegator (with no new error-reporting system introduced).

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, a single new file resolves the bug. No existing file is edited.

**File (new, OUTSIDE the Kiro workspace root — user-approved)**: `G:\micro-host\package.json`

**Exact contents:**
```json
{
  "name": "micro-host-parent-delegator",
  "private": true,
  "description": "Parent delegator for Post Card Spatial OS (delegates to micro-host)",
  "scripts": {
    "dev": "npm --prefix micro-host run dev",
    "build": "npm --prefix micro-host run build",
    "preview": "npm --prefix micro-host run preview",
    "test": "npm --prefix micro-host test"
  }
}
```

**Specific Changes / Rationale:**
1. **Mirror the existing delegator style**: The shape (name, private, description, four scripts) mirrors `g:\micro-host\micro-host\package.json`, which uses `npm --prefix workspace-prototype ...`. Here the target subfolder is `micro-host` instead of `workspace-prototype`, so each script forwards one level down.
2. **`npm --prefix` resolution**: `npm --prefix micro-host run dev` resolves the prefix path relative to the cwd where npm runs (`G:\micro-host`), so it correctly locates `G:\micro-host\micro-host\package.json`, which in turn delegates to `workspace-prototype`. This satisfies requirement 2.3 (same delegation pattern, no new tooling).
3. **`test` script omits `run`**: Mirroring the existing delegator exactly, `test` uses `npm --prefix micro-host test` (no `run`), matching `g:\micro-host\micro-host\package.json`'s `"test": "npm --prefix workspace-prototype test"`.
4. **No dependencies block**: The file has no `dependencies`/`devDependencies` — it is a pure delegator introducing no new packages or build systems (requirement 2.3).
5. **Purely additive**: The existing `g:\micro-host\micro-host\package.json` and `workspace-prototype\package.json` are untouched, so all current behavior is preserved (requirement 3.3).

**Out-of-workspace-file flag**: `G:\micro-host\package.json` sits outside the Kiro workspace root (`g:\micro-host\micro-host`). This is intentional and explicitly user-approved (documented in bugfix.md). Implementation must flag this so the reviewer is aware the new file lives outside the workspace tree. No other out-of-workspace writes are required.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface a counterexample that demonstrates the bug on unfixed code, then verify the fix works correctly and preserves existing behavior. Because this fix is a static config file (no application code), "tests" are command-line verification invocations rather than unit test suites.

### Exploratory Bug Condition Checking

**Goal**: Surface a counterexample that demonstrates the bug BEFORE implementing the fix. Confirm the root cause (missing `package.json` at `G:\micro-host`).

**Test Plan**: Run the affected npm scripts from `G:\micro-host` on the UNFIXED state and observe the `ENOENT` failure. Also confirm the directory currently has no `package.json`.

**Test Cases**:
1. **Parent dev (bug)**: `npm run dev` with cwd `G:\micro-host` (will fail with `ENOENT` on unfixed state).
2. **Parent build (bug)**: `npm run build` with cwd `G:\micro-host` (will fail with `ENOENT` on unfixed state).
3. **Parent test (bug)**: `npm run test` with cwd `G:\micro-host` (will fail with `ENOENT` on unfixed state).
4. **Confirm absence**: Verify no `package.json` exists at `G:\micro-host` before the fix.

**Expected Counterexamples**:
- `npm error code ENOENT` / "no such file or directory, open 'G:\micro-host\package.json'".
- Possible cause: no `package.json` at the cwd where npm is invoked.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed system produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := runScript_fixed(input)
  ASSERT expectedBehavior(result)
END FOR
```

**Verification approach (non-destructive, no long-running servers)**:
- After creating `G:\micro-host\package.json`, run `npm run` (no script name) with cwd `G:\micro-host` and confirm it lists `dev`, `build`, `preview`, `test` — proving npm now finds a `package.json` and parses the scripts.
- Run a dry/quick check of delegation without booting a long-running server: e.g., `npm --prefix micro-host run dev` is a long-running command and should NOT be started by the agent; instead recommend the user run `npm run dev` from `G:\micro-host` manually to confirm the Vite server boots. For a quick non-blocking check, `npm run build` (or a `--help` style check) can confirm the chain resolves, but build/test execution should be left to the user where long or side-effectful.

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed system produces the same result as the original system.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT runScript_original(input) = runScript_fixed(input)
END FOR
```

**Testing Approach**: Because the fix is purely additive (a new file only), preservation is largely structural: existing `package.json` files are byte-for-byte unchanged. Manual verification of representative non-buggy invocations confirms the chain is unaffected.

**Test Cases**:
1. **Correct root preserved**: Run `npm run dev` from `g:\micro-host\micro-host` and confirm it still delegates to `workspace-prototype` as before (Requirement 3.1, 3.3).
2. **Workspace-prototype direct preserved**: Run `npm run dev` from `g:\micro-host\micro-host\workspace-prototype` and confirm Vite still runs directly (Requirement 3.2).
3. **No-delegator dir unchanged**: Run `npm run dev` from a random folder with no `package.json` and confirm it still fails with `ENOENT`, with no new error-reporting system introduced (Requirement 3.4).
4. **Existing files unchanged**: Confirm `g:\micro-host\micro-host\package.json` and `workspace-prototype\package.json` are unmodified by the fix (Requirement 3.3).

### Unit Tests

- Not applicable for this fix: there is no application code or function to unit-test. The "unit" is the static `package.json` file, validated by npm parsing it and listing scripts.

### Property-Based Tests

- Generate arbitrary cwd values across the relevant directory set (`G:\micro-host`, `g:\micro-host\micro-host`, `g:\micro-host\micro-host\workspace-prototype`, and arbitrary empty dirs) and assert: invocations from `G:\micro-host` now succeed (bug condition inputs), while invocations from every other directory produce the same outcome as before the fix (preservation). This is expressed as a property over the (command, cwd) input domain.

### Integration Tests

- **Full chain from parent**: From `G:\micro-host`, run `npm run dev` (user-run, not agent-started) and confirm the Vite dev server boots — end-to-end validation of the `G:\micro-host` -> `micro-host` -> `workspace-prototype` -> `vite` chain.
- **Context switching**: Run `npm run build` from `G:\micro-host` and confirm the build task executes in `workspace-prototype` without manual `cd`.
- **No-regression from correct root**: Run `npm run dev` from `g:\micro-host\micro-host` after the fix and confirm identical behavior to before the fix.
