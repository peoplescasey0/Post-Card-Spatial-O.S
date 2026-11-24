# Contracts

Four interfaces that let the sections work without reading each other's code.
They are the whole reason an 8-way split can survive contact with reality.

| File | Version | Owner | Consumers |
|---|---|---|---|
| `card-manifest.v1.json` | 1.0.0 | 04 guests | 02 UI, 05 planes, 07 QA |
| `plane.v1.json` | 1.2.0 | 05 planes | 02 UI, 04 guests, 07 QA |
| `telemetry.v1.json` | 1.0.0 | 03 kernel + 04 guests | 02 UI |
| `guest-lifecycle.v1.md` | 1.0.0 | 04 guests | 02 UI, 07 QA |

## Rules

1. **Frozen means frozen.** A consumer may code against any field in the current
   version and expect it to keep working for the life of that version.
2. **Additive only inside a version.** New optional fields are fine. Renaming,
   removing, or changing a type requires `v2`.
3. **Every payload carries its version.** Plane packets carry `v`. Telemetry
   packets carry `kernel_version`. Card manifests carry `schema`.
4. **Owner changes the file; consumers change their code.** If a consumer needs
   a field, it asks the owner, and the owner adds it here first.
5. **CI validates.** `07` owns the validation test. A contract that nothing
   validates is a comment, not a contract.

## Status of the current drafts

- `card-manifest` — **draft**. Written from `SystemCard` in `src/main.ts`, which
  is a *view model* (holds `THREE.Group`, materials, animation fields) and must
  not be persisted. 04 splits it into `PersistedCardRecord` (this schema) and
  `SystemCard` (in-memory).
- `plane` — **draft 1.2.0**. Section 05's doc proposed deriving the key from the card
  ID; that is unsafe because card IDs are public. This version replaces it with
  Ed25519 identity + X25519 key agreement. 1.2.0 adds an optional `hold`: staged
  cargo that outlives the card, keyed by plane id so deleting a card cannot destroy
  it. Reference schema in `handoff/relay/`.
- `telemetry` — **draft**. Fields taken from `buildTelemetryPacket()` in
  `guest-api.mjs` (line 928). Several fields there are static display strings,
  not measurements; the schema marks which is which under `provenance`.
- `guest-lifecycle` — **inventory**. Endpoint names are real and taken from
  `guest-api.mjs`; request/response bodies must be filled in by 04 from the
  implementation, not invented.
