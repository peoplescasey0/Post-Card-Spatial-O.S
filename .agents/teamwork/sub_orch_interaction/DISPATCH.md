## 2026-11-11T17:59:08Z
You are the Sub-Orchestrator for the Card Interaction and Floor Collision Track (Milestone M2).

MANDATORY FIRST STEP: Read:
1. g:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. g:\micro-host\PROJECT.md
3. g:\micro-host\.agents\teamwork\explorer_survey_1\handoff.md
4. g:\micro-host\.agents\teamwork\explorer_survey_2\handoff.md

Working directory: g:\micro-host
State folder: g:\micro-host\.agents\teamwork\sub_orch_interaction\
Parent conversation ID: 0f5b6df3-bb7b-4ab0-a937-218f6a6fac15

Scope of Ownership:
- Milestone M2: Card Interaction and Floor Collision Polish
  - Prevent cards from being moved through the floor during direct manipulation by enforcing floor boundary constraints.
    - Implement `getFloorHeightAt(x, z)` (accounting for dais at Y=+0.085 and obsidian floor at Y=-0.12).
    - Implement `clampCardAboveFloor(card)` ensuring card bottom vertices never drop below floor plane.
    - Enforce clamp in `onPointerMove`, `resolveCardCollisions`, `onPointerUp`, and `animate`.
  - Ensure all interactive buttons across the cards and home screen interface work reliably.
    - Fix `workspace-prototype/src/style.css` (remove `#home-view { display: none !important; }`).
    - Wire `#home-view` buttons (`[data-open-studio]`, `[data-card-id]`) in `workspace-prototype/src/main.ts` with two-way navigation (`showStudio` and `showHome`).
    - Fix optional chaining bug in `src/main.ts` line 3362 (`status?.preparedCardIds?.includes(...)`).
    - Audit and verify all 8 printed on-card buttons (`guest`, `stop`, `zoom`, `settings`, `clone`, `savepoint`, `performance`, `bin`) execute without runtime errors.

File Write Ownership:
- `workspace-prototype/src/main.ts` (collision, navigation, button fixes)
- `workspace-prototype/src/style.css` (view display rules)

Execution Instructions:
Follow the Project pattern iteration loop:
1. Initialize SCOPE.md in your state folder.
2. Dispatch Explorer -> Worker -> Reviewers -> Challengers -> Forensic Auditor -> Gate.
   MANDATORY INTEGRITY WARNING to include verbatim in Worker dispatches:
   "DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected."
3. Ensure Worker runs `npm test` and `npm run build` inside `workspace-prototype`.
4. Write your soft/hard handoff report in `g:\micro-host\.agents\teamwork\sub_orch_interaction\handoff.md` and send a message back to parent when complete.
