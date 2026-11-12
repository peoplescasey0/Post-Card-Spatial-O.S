## 2026-11-11T18:00:45Z
You are Explorer 2 for Milestone M2 (Card Interaction and Floor Collision Polish).
Role: Home View Navigation Researcher
Working directory: g:\micro-host
State folder: g:\micro-host\.agents\teamwork\explorer_m2_2\

MANDATORY FIRST STEP: Read:
1. g:\micro-host\.agents\teamwork\ORIGINAL_REQUEST.md
2. g:\micro-host\PROJECT.md
3. g:\micro-host\.agents\teamwork\sub_orch_interaction\SCOPE.md
4. g:\micro-host\.agents\teamwork\explorer_survey_1\handoff.md
5. g:\micro-host\.agents\teamwork\explorer_survey_2\handoff.md

Your Task:
Investigate and produce a detailed technical implementation blueprint for Home View Navigation and CSS in `workspace-prototype/src/style.css` and `workspace-prototype/src/main.ts`:
1. Inspect `workspace-prototype/src/style.css`:
   - Check lines 2704-2707 (`#home-view[hidden], #studio-view[hidden] { display: none !important; }`).
   - Check lines 3516-3519 (`#home-view { display: none !important; }`).
   - Determine exact CSS edit needed to allow `#home-view` to display when not hidden.
2. Inspect `workspace-prototype/index.html`:
   - Identify all `#home-view` buttons: primary CTA (`.home-primary-button[data-open-studio]`), 5 system cards (`.home-system-card[data-open-studio][data-card-id]`).
   - Check studio view for return-to-home trigger (e.g. topbar brand logo or home button).
3. Design the view router functions in `workspace-prototype/src/main.ts`:
   - `showStudio(cardId?: string): void`
   - `showHome(): void`
   - Wire event listeners for `[data-open-studio]` and return navigation.
   - Wire `window.location.hash` synchronization (`#home`, `#studio`, `#room`) and `hashchange` handler.
   - When `cardId` is passed, map it to the active card in studio (e.g. `selectCard` / `focusCard`).
4. Ensure element querying and assertions in `main.ts` handle `#home-view` cleanly without breaking existing DOM assertions.
5. Provide exact TypeScript and CSS code snippets and replacement instructions for the Worker.

DO NOT write or modify source code files. Write your complete analysis and recommendations to:
`g:\micro-host\.agents\teamwork\explorer_m2_2\handoff.md`
Then send a message back to the orchestrator with your findings.
