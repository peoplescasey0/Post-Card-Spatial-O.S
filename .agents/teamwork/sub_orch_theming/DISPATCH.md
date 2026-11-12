## 2026-11-11T17:59:00Z
You are the Sub-Orchestrator for the Card Theming Track (Milestones M1 & M3).

MANDATORY FIRST STEP: Read:
1. g:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. g:\micro-host\PROJECT.md
3. g:\micro-host\.agents\teamwork\explorer_survey_1\handoff.md
4. g:\micro-host\.agents\teamwork\explorer_survey_3\handoff.md

Working directory: g:\micro-host
State folder: g:\micro-host\.agents\teamwork\sub_orch_theming\
Parent conversation ID: 0f5b6df3-bb7b-4ab0-a937-218f6a6fac15

Scope of Ownership:
- Milestone M1: Theming Research Documentation
  - Document a comprehensive research summary on common card theming patterns (such as Android home screen customization options, Material You / Material 3 dynamic color, spatial UI tokens, dark/light/neon/glass aesthetics) suitable for spatial cards in `g:\micro-host\THEMING_RESEARCH.md`.
- Milestone M3: Home Screen Card Theming Customization Implementation
  - Create `workspace-prototype/src/card-themes.ts` implementing a structured theme engine with 5 distinct presets: Classic Studio, Cyberpunk Neon, Minimal Dark, Glass/Frosted, and Material Vibrant.
  - Implement home screen card customization controls in `workspace-prototype/index.html` allowing users to change card themes.
  - Ensure selected card themes apply visibly to cards on the home screen (both CSS styling on `.home-system-card` and 3D Three.js card textures via `makeCardTexture` / `computeCardContentKey` cache invalidation).
  - Persist theme selection in `localStorage` under `postcard_studio_card_theme`.

File Write Ownership:
- `THEMING_RESEARCH.md`
- `workspace-prototype/src/card-themes.ts`
- Theme selector markup in `workspace-prototype/index.html`
- Coordinate with `src/main.ts` theme application hooks cleanly.

Execution Instructions:
Follow the Project pattern iteration loop:
1. Initialize SCOPE.md in your state folder.
2. For M1: Dispatch a Worker to write `THEMING_RESEARCH.md`.
3. For M3: Dispatch Explorer -> Worker -> Reviewers -> Challengers -> Forensic Auditor -> Gate.
   MANDATORY INTEGRITY WARNING to include verbatim in Worker dispatches:
   "DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected."
4. Ensure Worker runs `npm test` and `npm run build` inside `workspace-prototype`.
5. Write your soft/hard handoff report in `g:\micro-host\.agents\teamwork\sub_orch_theming\handoff.md` and send a message back to parent when complete.
