# Share Links — the front door

A share link is how someone who does **not** have Post Card receives a plane.

It is not a transfer service and it is not a copy. The file stays in one place —
the recipient card's spool directory on the machine that already holds it — and the
link is a permission slip to read those exact bytes. One copy exists; the link
expires.

```
POST /api/guest/paper-plane/share   -> { url, token, expiresAt, bytes, sha256, fileName }
POST /api/guest/paper-plane/revoke  -> { revoked: true }
GET  /s/:token                      -> the page (preview, size, sender, time left, two buttons)
GET  /s/:token/file                 -> the bytes; Range, ETag, Content-Disposition
```

## Why it is built this way

| Decision | Reason |
|---|---|
| Token is 32 random bytes, stored as `sha256` only | The database is never a credential. A dump of `share-links.json` yields no working link. |
| Not one-time | A one-time link punishes anyone whose download failed once. The TTL is what bounds exposure. One-time belongs to guest-fetch transfer tokens. |
| TTL is 60s–72h, default 48h, ceiling 72h | Same ceiling as a plane hold, so a link can never outlive the plane it points at. Override with `POSTCARD_SHARE_MAX_TTL`. |
| Reads the spool in place | An attachment is copied into every mailbox; that is why email has a 25 MB cap. A link has no such ceiling because the bytes are not duplicated. |
| Served before the loopback gate | A front door reachable only from inside the house is not a front door. |
| Preview is throttled to `Range: bytes=0-800` and does not count as a download | The page renders the postcard; the counter tracks actual retrievals. |
| `maxDownloads` (0 = TTL only) | For links that must not spread. Default is TTL-only, because re-sending is worse than one extra download. |
| Revocable per link | Supabase signed URLs cannot be revoked individually. Owning the token check is what makes revocation real. |

## The two buttons

The page carries **Download** and **Open in Post Card** (`postcard://plane/<name>`).

That is the whole strategy. Download is the safe default for a stranger; open-in-room
is the upgrade for someone willing. Both work with zero account. The link is the
on-ramp to the room, not a separate product.

## Reaching it from outside this machine

A quick tunnel makes the link real on a phone in about a minute, with no account:

```powershell
node start-studio.mjs                     # :5173, the studio and the share routes
node share-gateway.mjs                    # :8791, forwards GET /s/* only
cloudflared tunnel --url http://127.0.0.1:8791 --no-autoupdate
```

**Never point the tunnel at `:5173`.** The studio decides "is this request local?"
from the socket's remote address, and a tunnel connects from `127.0.0.1`, so a
tunnel to the studio publishes every `/api/guest` route: boot a VM, delete a card,
read status. `share-gateway.mjs` forwards only `GET`/`HEAD /s/<token>` and
`/s/<token>/file`; everything else is a 404. Verified against the live tunnel:
page `200`, ranged fetch `206` with a correct `content-range`, `/api/guest/status`
`404`, `/` `404`, bad token `404`.

Issue the link with `origin` set to the tunnel hostname, or the returned URL will
point at loopback:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:5173/api/guest/paper-plane/share -Method Post `
  -ContentType 'application/json' `
  -Body (@{ cardId='demo-room'; fileName='plane-123.txt'; origin='https://<tunnel-host>' } | ConvertTo-Json)
```

A quick tunnel is a demo, not a deployment: the hostname changes on every start,
it dies when the machine sleeps, and there is no SLA. It also does not lift the
512 KB spool cap.

## Hosted mode — the link outlives the laptop

`cloudflare/share/` is a Worker that owns both the record and the bytes, so the
sender's machine stops being part of the path. Set two values and the same
`POST /api/guest/paper-plane/share` uploads instead of serving from disk:

```
SHARE_REMOTE_URL=https://postcard-share.<account>.workers.dev
SHARE_REMOTE_SECRET=<the Worker's PUBLISH_SECRET>
```

| | Local mode | Hosted mode |
|---|---|---|
| Bytes live in | `data/paper-planes/<cardId>/` | R2, keyed `s/<sha256(token)>` |
| Link dies when | the laptop sleeps, the spool file moves | the TTL runs out |
| Cap per link | 512 KB (spool drop limit) | 95 MB (free Workers request body) |
| Token on the server | digest only | digest only — the token never leaves the app |
| Needs credentials | no | yes, a Worker + R2 + D1 |

Unset `SHARE_REMOTE_URL` and it falls back to local links: no credentials, no
network, same page. A half-configured host (URL without a secret) is ignored with
a warning rather than producing links that die with the laptop.

Two things the host fixes that the tunnel could not:

- **The deadline moved to the host.** Publishing sends `x-ttl` seconds, not an
  absolute timestamp. A client clock running fast or slow can no longer shorten
  or extend a link, and a 60 s link cannot arrive already expired.
- **The hash is verified when the host asks for it.** `HASH_MODE=verify` streams a
  SHA-256 as the bytes flow in and refuses a mismatch. It is off by default because
  a free Worker has ~10 ms of CPU and hashing 90 MB in JavaScript is seconds; the
  default check is exact byte count via `FixedLengthStream`.

## The two buttons, updated

The page carries **Download** and **Open in Post Card**
(`postcard://plane?t=<token>&host=<host>`).

The old form was `postcard://plane/<fileName>`, which handed the room a string it
could not redeem — a file name is not a capability, the token is. No protocol
handler is registered in the frontend yet, so the button still may land nowhere;
the page now says so after 1.2 s ("No Post Card app on this machine? Use
Download") instead of leaving a dead control. The remaining half is a handler in
the app that reads `t` and `host` — the link side is now carrying the right data.

## What it deliberately does not do

- **No upload endpoint of its own.** Files enter through `POST /api/guest/file-drop`
  (the heavy paper airplane), so there is one path into the spool and one set of
  validation rules.
- **No directory listing.** `fileName` must be a plain basename that resolves inside
  `paper-planes/<cardId>/`; `realpath` is compared back to the card directory, so
  `../` and symlink escapes fail closed.
- **No store-and-forward mailbox yet.** Local mode runs on one machine's disk. The
  relay contract (`paper-planes/handoff/relay`) is what turns this into a mailbox
  that survives the sender's machine being off; the token rules there are the same
  ones implemented here. Hosted mode solves the *link's* half of that problem — the
  bytes and the record are off the sender's machine — but not the mailbox half:
  there is still no per-recipient inbox, no ACK, no retry.

## Limits

- Spool drop is capped at 512 KB per file (`contentBase64` ≤ 750,000 chars).
  Larger files need the cloud relay — that is a limit of the local prototype, not
  of the link format.
- `data/share-links.json` keeps at most 256 records, pruning expired, never-downloaded
  links first.
- A deleted spool file turns the link into `410 gone`, not `404`. The distinction
  matters: `410` means *the link was real and the bytes moved*, which is what a
  sender needs to know.
