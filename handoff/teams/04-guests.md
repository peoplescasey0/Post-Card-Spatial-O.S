# BRIEFING — 04 guest orchestration

## Mission

Own the guest lifecycle: QEMU, WSL2, overlays, snapshots, TPM/UEFI state, and the
`/api/guest/*` surface that everything else calls. Be the section that never
loses a user's disk.

## Start

**Today.** Nothing blocks you; the API already exists and has tests.

## Owns

- `workspace-prototype/guest-api.mjs` (34 endpoints)
- `src/guests/` (after extraction; until then the guest clusters in `main.ts`)
- `data/` layout: `master-images/`, `overlays/`, `windows/`, `android/`

## Reads, never writes

- `handoff/contracts/plane.v1.json` — planes move guest data
- `handoff/contracts/telemetry.v1.json` — you emit it

## First three tasks

1. **Freeze `handoff/contracts/guest-lifecycle.v1.md`**: fill in real request and
   response bodies from the handler code, error shapes, and which endpoints are
   idempotent. Add `GET /api/guest/contract` returning the version.
2. **Mailbox client loop.** Delivery is store-and-forward (`handoff/relay/MAILBOX.md`).
   You own the PC side: on start and on reconnect, `mailbox_since` to resync history,
   then `mailbox_pull` in a loop, fetch bytes, verify `sha256`, **write and fsync**,
   then `mailbox_ack`. ACK comes last, always. A crash between write and ACK must
   produce a duplicate, never a loss. Dedupe locally on plane id.
3. Kill double-boot: starting an already-running guest must return a defined
   error, not a second QEMU process.
4. Document the recovery path for `error` state, including the TCG-Windows case
   where the installer ignores ACPI shutdown.

## The bug in your file, before anything is built on it

Card deletion filters `paper-planes.json` by `fromCardId`/`toCardId` and removes
`data/paper-planes/<card-id>/`. Delete the sender's card and undelivered planes are
destroyed — the receiver's unread mail, gone because someone else tidied up. A
mailbox must be keyed by plane id and live outside that tree. Fix this first; every
delivery guarantee in the contract depends on it.

## Hard constraints

- 4 concurrent guests max, 8 GiB guest RAM max. Enforce in code, not in the UI.
- VNC/QMP on loopback only, per-guest ports from 5700/4444.
- TPM state and `VARS.fd` are guest identity. Never delete to reclaim space.
- Deleting an overlay destroys the card's private data; permanent delete stays
  behind explicit confirmation.

## Definition of done

- Contract frozen and versioned; 02 can code against it without reading your source.
- Every endpoint has a test in `tests/guest-api.test.mjs` (22.5 KB today, floor).
- No test leaves a stray QEMU process or a port open.

## Do not touch

`src/main.ts` UI clusters, `src/style.css`, `index.html`, `kernel/`, `handoff/contracts/plane.v1.json`.

## Branch

`section-04-guests`
