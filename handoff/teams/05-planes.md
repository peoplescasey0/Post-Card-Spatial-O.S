# BRIEFING — 05 paper plane protocol

## Mission

Turn the 71-line local file writer into a real transfer protocol: versioned,
encrypted, signed, capability-scoped, with receipts. This is the product's
headline feature and the thing the whole thesis rests on.

## Start

**Today.** The contract draft exists; the code is small; nothing blocks you.

## Owns

- `src/planes/` (after extraction; today `src/card-actions.ts`, `src/card-buttons.ts`,
  and the plane clusters in `main.ts`)
- `handoff/contracts/plane.v1.json` — you are the owner
- `handoff/relay/` — the relay schema and deploy notes (you own the shape; 04 runs it)
- `data/paper-planes/` layout

## Reads, never writes

`handoff/contracts/card-manifest.v1.json` (card identity), `guest-lifecycle.v1.md`
(the `paper-plane*` endpoints are yours to call, not to change).

## First tasks

1. Implement `contracts/plane.v1.json` (draft 1.2.0) as a standalone module with
   tests: `tender`, `chooseOffer`, `encode`, `decode`, `sign`, `verify`, `open`,
   `receipt`, `rotateToken`, `purge`, `stage`, `release`. Pure functions, no DOM.
2. **Tender/cargo split first.** The small tender (manifest + offers) goes out and
   the receiver picks the drop method: `clone` (same host, 0 bytes), `push`,
   `guest-fetch`, `pull-http`, `swarm`. A 12 GiB guest must never need a 12 GiB
   host spool.
3. **Token shelf life: 72h default, 48h floor, never longer than the tender.** One
   time, bound to plane + recipient key + method, consumed on first open even if
   the hash check fails. Long transfers rotate to a fresh token and burn the old one.
   Store the token hashed. Expiry is enforced server-side and purges the bytes, not
   just the index row.
4. **Never make the token a provider signed URL.** Validate the token, then mint a
   short-lived transport URL (60–300s). Signed URLs cannot be revoked individually,
   so a token-shaped signed URL cannot be one-time, cannot be burned on a failed
   hash, and cannot honour a 72h shelf life.
5. **Hold first, then offers.** A tender may name a `hold` — where cargo waits so
   the sender can close the card or the laptop. Keyed by **plane id**, never card
   id. Reference schema: `handoff/relay/`. `senderAvailableUntil` is dead; use
   `hold.holdExpiresAt`.
6. **Fix the key design before writing any crypto.** The old doc derived the
   symmetric key from card ID + session key. Card IDs are public; that is not key
   material. Use Ed25519 identity keys and X25519 ECDH, HKDF-expand to AES-256-GCM.
7. Capability enforcement at receive time: a plane without `drop_file` cannot drop
   a file, even if the UI offers the button.
8. **Raise one bug with 04 before building on it:** card deletion in
   `guest-api.mjs` filters `paper-planes.json` by `fromCardId`/`toCardId` and removes
   `data/paper-planes/<card-id>/`. Delete the sender's card and the plane is
   destroyed even if the receiver never took it. Fine for an inbox, fatal for a
   hold. Holds must live outside that tree.

## Honesty rule

v1 is **same-host** delivery. The UI must say so. "Send paper planes instead of
email" is the vision, not v1. Do not write copy that implies peer-to-peer across
machines until a relay exists and a stranger can receive without the OS.

A relay now exists in draft (`handoff/relay/`), and it changes the limits rather
than removing them: on the free tier, 50 MiB per file and 1 GB total, project
pauses after ~7 days idle. Tenders and email-sized files fit. A guest does not —
not by a tuning margin, by 245×. Say so in the UI.

## Definition of done

- Round-trip tests: tampered ciphertext fails, wrong recipient fails, expired TTL fails,
  revoked capability fails, replayed nonce fails.
- No plaintext payload ever hits disk.
- Contract version asserted on decode.

## Do not touch

`guest-api.mjs` endpoint handlers (ask 04), `src/main.ts` UI clusters, `kernel/`.

## Branch

`section-05-planes`
