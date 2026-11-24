# HANDOFF KIT — 8 sections, 4 teams up front

Created 2026-11-17. Everything here is additive; no existing file was modified.

## Ground truth checked before writing this

- `node --test` in `workspace-prototype`: **285 tests, 285 pass, 0 fail, 27s**.
- `guest-api.mjs` exposes **34 real endpoints** under `/api/guest/*` plus `/telemetry` (WebSocket).
- `src/main.ts` is **8,451 lines**; `src/style.css` is **6,823 lines**.
- The eight `0x_*` folders under `workspace-prototype/` contain **one README each** (28 KB total). They are briefings, not code.
- No `.github/` exists, so nothing runs the tests but a human on this machine.
- Local git tree and `github.com/peoplescasey0/G-III` are **not the same state** (local has history the public repo does not; 01-08 folders are untracked).

## Topology

Use the pattern already in `.agents/teamwork/`, one chain per section:

```
                top orchestrator  (holds contracts/, merges, owns CI)
                        |
   +---------+---------+---------+---------+
   |         |         |         |         |
 02 UI     04 guests  05 planes  07 QA    08 assets      <- wave 1
   |         |         |         |         |
 explorer -> worker -> reviewer -> challenger -> auditor   <- same chain per section
```

Each section gets one folder in `.agents/teamwork/<section_name>/` with
`BRIEFING.md`, `DISPATCH.md`, `progress.md` — same four files you already use.
The briefs in `handoff/teams/` are written to be copied in as `BRIEFING.md`.

## Who starts when

| Section | Start | Blocker | First task |
|---|---|---|---|
| 05 planes | **today** | none | Implement `contracts/plane.v1.json` as `src/planes/` |
| 04 guests | **today** | none | Freeze `contracts/guest-lifecycle.v1.md` against `guest-api.mjs` |
| 07 QA | **today** | none | CI green on a clean runner (`.github/workflows/ci.yml` already written) |
| 08 assets | **today** | none | Split `style.css` (6,823 lines) per component |
| 03 kernel | today, low priority | none | Nothing blocks it; nothing depends on it either |
| 02 spatial UI | **+1 day** | `main.ts` extraction | Own `src/room/` + `src/cards/` after extraction |
| 06 billing | wave 2 (+2 weeks) | a stranger must be able to run it | Don't start early |

Realistic review capacity for one person: **3-4 concurrent teams**. Eight at once
means eight diffs nobody reads, and quality leaks exactly where nobody reads.

## Rules that make the split work

1. **Contracts are frozen and versioned.** Change = bump the file, note it in `contracts/CHANGELOG.md`, tell the top orchestrator. No silent edits.
2. **One section owns one directory.** No team edits another section's files. Shared edits go through the orchestrator.
3. **CI is the gate, not an opinion.** `npm test` + `npm run build` must be green on the branch before merge.
4. **Extraction before parallelism** for 02. See `EXTRACTION_MAP.md`.
5. **Every brief lists what NOT to touch.** That list is the cheapest merge-conflict insurance you can buy.

## Files in this kit

- `00_START_HERE.md` — this file
- `contracts/` — four frozen interfaces + rules
- `relay/` — plane relay schema (staged holds, hashed tokens, receipts) + deploy and limit notes
- `teams/` — one briefing per section, ready to copy into `.agents/teamwork/`
- `EXTRACTION_MAP.md` — `main.ts` -> modules, by line range
- `../.github/workflows/ci.yml` — the CI that makes all of this verifiable

## Changed after the first pass

- **2026-11-18** — `plane` is draft **1.2.0**: tenders can name a `hold`, so a plane
  outlives the card that sent it. Schema in `relay/`. 05 owns it; 04 supplies the
  fetch-from-hold endpoint. Not applied to any project yet.
