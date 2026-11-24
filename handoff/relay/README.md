# Plane relay

The third machine. A held plane survives the card that sent it, because the
bytes sit with a provider instead of on a card.

**Not the licensing project.** The repo at `G:\micro-host\supabase\` is linked to
`sjhirouqolzoourlvdmw` ("Post Cards") — that one runs `licenses`, `stripe_events`
and the three Edge Functions. This relay belongs to a **different** project,
`qjxahilkpljapyfwfhsc`. Do not `supabase link` it over the top: `db push` would
then try to apply licensing migrations to the new project and relay migrations to
the licensing one.

## Status: it does not work yet

| Claim | True? |
|---|---|
| Contract is valid JSON | yes, parsed |
| SQL parses as Postgres | yes, 47/47 statements across both files against libpg_query (grammar only) |
| SQL is semantically correct | **no** — never run against a live server |
| Protocol works end to end | **yes, locally** — `impl/`, 11 tests + demo, SQLite |
| Works over Supabase | **no** — no credentials, no adapter, nothing deployed |
| A stranger can receive a plane | **no** — the receiver needs the app, or a share link that does not exist yet |

Run `001` then `002`, in that order. `002` alters tables `001` creates.

Do not describe this to anyone as working. It is a specification with a
reference schema attached.

## Files

| File | What it is |
|---|---|
| `001_plane_holds.sql` | Tables, hashed tokens, receipts, expiry marker, private bucket |
| `002_mailbox.sql` | Store-and-forward: sequence cursor, visibility leases, pull / ack / nack, retention |
| `impl/` | **Runnable reference**: mailbox + blob store on SQLite, 11 tests, end-to-end demo |
| `MAILBOX.md` | The protocol: state machine, five calls, failure cases |
| `README.md` | This. Deploy, limits, routing |

## Try it now — no account, no network

```powershell
cd G:\micro-host\handoff\relay\impl
node --test      # 11 tests: claim atomicity, lease recovery, ACK idempotency, card deletion
node demo.mjs    # sender posts 3 planes, card deleted, receiver still gets all of it
```

`impl/mailbox.mjs` uses `node:sqlite` (built into Node 24) so there is nothing to
install. The protocol is identical to `002_mailbox.sql`; only the adapter differs,
which is what makes the swap to Supabase a substitution rather than a rewrite.

The demo prints `local=yes` for every delivered plane on purpose: it writes and
fsyncs before ACKing, then shows a rejected second ACK. If a run ever prints
`local=no` next to `released`, the ordering rule was broken.

## Applying it

**Option A — SQL editor (fastest, no CLI).**

1. Open the `qjxahilkpljapyfwfhsc` project's SQL editor.
2. Paste `001_plane_holds.sql` in full and run.
3. Enable `pg_cron` under Database > Extensions if you want the automatic marker,
   then run the commented `cron.schedule` block.

**Option B — CLI, dedicated directory.**

```powershell
cd G:\micro-host\handoff\relay
npx supabase init            # creates relay/supabase/config.toml, own project_id
npx supabase link --project-ref qjxahilkpljapyfwfhsc
# move 001_plane_holds.sql to supabase/migrations/<timestamp>_plane_holds.sql
npx supabase db push
```

The `init` matters. It gives this directory its own linkage so the two projects
never share migration history.

## What the relay needs at runtime

| Piece | Where | Why |
|---|---|---|
| Service role key | studio server only | Never in the browser, never in a card, never in a plane |
| `bucket: plane-holds` | private | Public bucket = every held plane readable by path guess |
| Client traffic | proxied by `start-studio.mjs` | Keeps the service key server-side; also where quota checks belong |

The client should never talk to Supabase directly. It talks to the studio server,
which talks to Supabase. That is one extra hop and it is the difference between a
service key in a `.env` and a service key in a DevTools panel.

## Free-plan limits, as measured from the docs (2026-11-18)

| Limit | Free | Pro |
|---|---|---|
| Max file size | 50 MiB | up to 500 GB (global setting) |
| Storage included | 1 GB | 100 GB, then $0.0213/GB-month |
| Project pausing | **paused after ~7 days of low activity** | never paused |

Consequences, stated plainly:

- **Tenders are free.** A few hundred bytes per row. 100k planes is nothing.
- **"Bigger than email" is 2×, not 10×.** Gmail is 25 MB. Free tier is 50 MB.
- **Guest planes do not fit.** A 12 GiB cold guest exceeds the file cap by ~245×,
  and the whole free bucket by 12×.
- **A paused project is a dead relay.** Holds aren't lost — restorable for a year —
  but a 3am fetch fails. If holds must be reliable, that is Pro, which also lifts
  the file cap. One upgrade fixes both.

Storage math for the paid case: a held 12 GiB guest is ~12 GB × $0.0213 ≈ **$0.26/month**
while it waits. Cheap enough to be a real feature; not cheap enough to hold forever
by default, which is what the TTL is for.

## Routing rule

| Situation | Use | Why |
|---|---|---|
| Both cards on this machine | `clone` or host hold | Zero bytes move, zero egress, milliseconds |
| Receiver elsewhere, or sender wants to close the laptop | relay | Only path that survives the sender going away |
| Guest, same machine | host hold | 12 GiB never leaves the disk |
| Guest, remote | relay, Pro, last | 12 GB upload and 12 GB egress for a demo |

Do not default to the relay for same-machine planes. It is slower, costs egress,
and solves a problem that does not exist locally.

## The token, and the one thing not to do

**Do not use a Supabase signed URL as the plane token.** Per the docs, individual
signed URLs cannot be revoked — only the project's whole signing key can be
rotated. That breaks single-use, breaks "burn it even when the hash check fails",
and makes a 72h shelf life decorative.

Correct shape, in two steps:

1. **Plane token** — opaque random value, hashed in `plane_tokens`, 72h max, one
   time, bound to plane + recipient key + method. Killed with a single `update`.
2. **Transport URL** — minted only after step 1 validates, with a **60–300 second**
   life. It carries no authority on its own; by the time anyone could copy it, it
   is dead.

The shelf life belongs to the token. The signed URL is a 60-second door handle.

## Sweeping

`mark_expired_holds()` marks rows. It does **not** free disk, because deleting a
row from `storage.objects` orphans the file and you keep paying for it. The
janitor purges through the Storage API, then sets `state = 'purged'`.

Two honest janitors, pick one:

- Edge Function on `pg_cron` / scheduled invocation — survives the app being closed.
- Interval timer in `start-studio.mjs` — simpler, dies with the studio process.

Nothing in the UI is allowed to be the expiry mechanism.

## What is not built yet

- **No key wrap in code.** The contract now carries `keyWrap` (X25519 → HKDF → AES-256
  key wrap) so the relay can hold ciphertext it cannot read. Nothing implements it.
  Until it does, any plane stored in the relay is readable by whoever holds the
  service key, and must not be described as encrypted to the receiver.
- No relay client. `plane-client.html` is still localStorage-mock. The store-and-forward
  loop in `MAILBOX.md` is a specification; nothing implements `mailbox_pull` on the
  PC side yet.
- No janitor code, either variant. `mark_expired_holds()` marks; nothing purges, so
  disk fills until the 1 GB cap and uploads start failing with a quota error instead
  of a clean refusal.
- No chunk/resume upload path against TUS. Supabase takes 6 MiB chunks and gives an
  upload URL good for 24h, which matches the contract's chunk fields — but the
  sender does not use them yet, and a transfer resumed after 24h starts over.
- Card deletion still destroys planes. `guest-api.mjs` filters `paper-planes.json` by
  `fromCardId`/`toCardId` and removes `data/paper-planes/<card-id>/`. Until that is
  fixed, a host hold is not safe either — it has to live outside that tree.
- Migration has not been applied to `qjxahilkpljapyfwfhsc`. No credentials were used
  and the project was not written to.
