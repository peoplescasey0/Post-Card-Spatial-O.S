# Contract change log

Every change to a frozen contract goes here, oldest first. Format:

```
YYYY-MM-DD | contract | version | changed by | what | who must update
```

---

2026-11-18 | plane | draft 1.2.0 | store-and-forward mailbox | Delivery model settled as store-and-forward: the database is a mailbox, a PC is a client that pulls, writes locally, fsyncs, then ACKs. `x-store-and-forward` added. `hold.state` gains `leased` (claimed, lease running) and `failed` (retries exhausted). Ordering is a server-side sequence, never a timestamp. Expired leases make a row eligible again, so a dead client strands nothing. Delivered rows keep metadata; only bytes purge. Implementation: `handoff/relay/002_mailbox.sql`.
Owners to update: 04 (mailbox pull/ack endpoints + client loop), 05 (state mapping), 02 (show pending / in-flight / delivered honestly; never show "read").

2026-11-18 | plane | draft 1.2.0 | hold (staged cargo that outlives the card) | A tender may now name a `hold`: where the cargo waits so the sender can close the card or the laptop. Additive only — `hold` is optional and v1.1 packets still decode. Also added: the plane token is never a provider signed URL (signed URLs cannot be revoked individually, so shelf life and burn-on-failure cannot be enforced through them); tokens are stored hashed; a hold is staging with a lease, not an inbox.
Owners to update: 05 (implement `hold`, `stage`, `release`, `purge`), 04 (guest-fetch pulls from the hold, not from the sender's card), 02 (show "this plane is held until X" instead of "dies if you close this card").

2026-11-18 | plane | draft 1.2.0 clarifications | gaps found while writing the schema | Four fixes, all additive: (1) `keyWrap` added — encrypted cargo had nowhere to carry its key, which would have left the relay able to read every plane it held; (2) `manifest.sha256` is now explicitly the hash of the transported (encrypted) bytes, with optional `plaintextSha256` for the receiver's own post-decrypt check; (3) the 48h token floor is documented as a preferred duration, not a guarantee — `expiresAt = min(issuedAt + 48h, tender.expiresAt)`, because a 1h tender cannot issue a 48h token; (4) the hold ceiling is measured from `tender.createdAt`, not from the row's `created_at`.
Owners to update: 05 (keyWrap + hash scope in encode/decode), 04 (relay stores ciphertext only).

2026-11-18 | plane | draft 1.2.0 layout | relay reference implementation | `handoff/relay/` — schema for `plane_holds`, `plane_tokens`, `plane_receipts`, a private `plane-holds` bucket, `mark_expired_holds()`, and a trigger holding the 72h ceiling to `tender.createdAt`. Not applied; no project was written to.
Note: target project `qjxahilkpljapyfwfhsc` is separate from the licensing project `sjhirouqolzoourlvdmw` that `G:\micro-host\supabase\` is linked to. Do not `db push` across them.

2026-11-17 | plane | draft 1.1.0 | tender/cargo split | A small tender carries the manifest and a list of offers; the receiver picks the drop method (clone / push / guest-fetch / pull-http / swarm). Cargo tokens are one-time, bound to plane + recipient key + method, 72h default with a 48h floor, never outliving the tender. Enforced server-side; expiry purges bytes.
Owners to update: 05 (implement), 04 (guest-fetch endpoint + token store), 02 (offer picker UI).

2026-11-17 | all four | draft 1.0.0 | setup pass | Initial drafts created.
- `card-manifest.v1.json` split out from `SystemCard` (view model, not persisted).
- `plane.v1.json` replaces card-ID-derived key material with Ed25519 + X25519.
- `telemetry.v1.json` records which fields are measured and which are static display.
- `guest-lifecycle.v1.md` is an endpoint inventory; bodies to be filled by 04.

Owners to confirm: 04 (card-manifest, guest-lifecycle), 05 (plane), 03+04 (telemetry).
