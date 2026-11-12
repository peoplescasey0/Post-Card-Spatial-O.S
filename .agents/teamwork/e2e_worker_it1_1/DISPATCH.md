## 2026-11-11T19:40:22Z

You are the Worker for the E2E Testing Track of Post Card OS Android Theming System.

Your working directory is: G:\micro-host
Your state folder is: G:\micro-host\.agents\teamwork\e2e_worker_it1_1\

MANDATORY FIRST STEP:
Read the original user request at:
G:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Primary References & Explorer Findings:
- Scope: G:\micro-host\.agents\teamwork\sub_orch_e2e_testing\SCOPE.md
- Test Infra: G:\micro-host\TEST_INFRA.md
- Global Architecture: G:\micro-host\PROJECT.md
- Explorer 1 Report (Conventions & Baseline Fix): G:\micro-host\.agents\teamwork\e2e_explorer_it1_1\handoff.md
- Spec Miner 2 Report (4-Tier 71 Tests Specifications): G:\micro-host\.agents\teamwork\e2e_spec_miner_it1_2\handoff.md
- Explorer 3 Report (Headless Fixtures & Mocks): G:\micro-host\.agents\teamwork\e2e_explorer_it1_3\handoff.md

Write Ownership:
You have exclusive write ownership of:
1. `workspace-prototype/tests/android-theming-integration.test.mjs`
2. `G:\micro-host\PROJECT.md` (append Fedora remote workstation lines)
3. `G:\micro-host\TEST_INFRA.md` (append Fedora remote workstation lines)
4. `G:\micro-host\TEST_READY.md` (create upon complete passing verification)
DO NOT modify any other production source or test files.

Your Mission:
1. Restore 117/117 baseline tests passing:
   - In G:\micro-host\PROJECT.md, append under Architecture:
```markdown
## Remote Fedora Workstation Execution & Infrastructure
- Remote Fedora Workstation IP: `10.0.0.2` (casey@10.0.0.2 via SSH alias `fedora`).
- Toolchain: Node.js v26 and headless Firefox for visual validation and remote test execution.
```
   - In G:\micro-host\TEST_INFRA.md, append under Test Architecture:
```markdown
## Remote Fedora Workstation Execution Contract
- Remote test execution: `ssh fedora "node --test"` for parallel headless validation.
- Remote screenshot validation: `firefox --headless --screenshot` for offscreen UI rendering verification.
```
   Verify with `npm --prefix workspace-prototype test` that all 117 baseline tests pass with 0 failures.

2. Author the 4-tier automated test suite in:
   `workspace-prototype/tests/android-theming-integration.test.mjs`
   Implement exactly the 71 tests specified in Spec Miner 2's report (`e2e_spec_miner_it1_2/handoff.md`) and Explorer 1's report (`e2e_explorer_it1_1/handoff.md`):
   - Tier 1: Core Feature Invariants (30 tests: F1.1-F1.5, F2.1-F2.5, F3.1-F3.5, F4.1-F4.5, F5.1-F5.5, F6.1-F6.5)
   - Tier 2: Boundary & Corner Cases (30 tests: B1-B30 including Tone 0/100, low chroma monochrome C<8, gamut bisection, hex variants, malformed hex recovery, rapid view switching stress, corrupted storage recovery)
   - Tier 3: Cross-Feature Interactions (6 tests: X1-X6)
   - Tier 4: Real-World Scenarios (5 tests: S1-S5 including cold boot, navigation workflow, preset switching, WCAG AA contrast ratio >= 4.5:1 verification across 50 seed colors, storage corruption during navigation)
   Use zero-dependency test fixtures (`SyntheticElement`, `MockCanvasContext`, `MockLocalStorage`) and dynamic loading of `card-themes.ts` (using fallback to color engine reference functions if specific optional helper methods are still in progress).

3. Verify:
   - Run `npm test` inside `workspace-prototype/` (or `npm --prefix workspace-prototype test`).
   - Ensure all 117 baseline tests + all 71 new tests pass (total >= 188 tests, 0 failures, 0 regressions).
   - Run `npx tsc --noEmit` inside `workspace-prototype/` to ensure 0 type errors.

4. Publish `G:\micro-host\TEST_READY.md`:
   Create `TEST_READY.md` at repo root with the runner command and tier counts breakdown.

5. Deliver your handoff report to:
   `G:\micro-host\.agents\teamwork\e2e_worker_it1_1\handoff.md`
   Send a completion message back when done.
