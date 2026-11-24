# Post Card share host

The link a stranger clicks, on a machine that is not yours.

This Worker replaces the laptop-tethered tunnel. Bytes go to R2, the record goes
to D1, and the front door is served from Cloudflare's edge. Once `POST
/api/guest/paper-plane/share` returns, the sender can close the lid, lose Wi-Fi,
or reboot — the link keeps working until its TTL runs out.

```
desktop app                         cloudflare
-----------                         ----------
spool file  --PUT /api/share/<sha256(token)>-->  R2  s/<sha256(token)>
                                                     D1  share_link
stranger    --GET /s/<token>------------------->  page
            --GET /s/<token>/file (Range)------->  bytes
```

## Why it is shaped this way

| Decision | Reason |
|---|---|
| Publishing is addressed by `sha256(token)` | The host never holds a live token. A dump of D1 or the R2 key list is a list of dead ends, not working links. |
| `PUT` needs `PUBLISH_SECRET`, `GET` needs the token | No anonymous write path, so the host cannot be turned into free file storage by whoever finds the hostname. |
| The Worker serves the page itself | A link that redirects to a bucket URL is a file dump. The page is the product: who sent it, how big, how long, both buttons. |
| `x-ttl` seconds, not an absolute expiry | The client's clock must not decide the deadline. A 60 s link sent over a slow link arrived already expired when the client chose the timestamp. |
| Size is verified after the store | `FixedLengthStream` breaks if the body is short or long of `x-size`, and `object.size` is compared again. |
| Full SHA-256 is opt-in | A free Worker gets ~10 ms of CPU; hashing 90 MB in JS is seconds. `HASH_MODE=size` checks the byte count, `HASH_MODE=verify` streams a hash. |
| Hourly sweep | Expiry is enforced on read, so the cron is about disk and money, not correctness. |

## Limits, stated plainly

- **95 MB per link.** The free Workers plan caps a request body at 100 MB. This
  is a ceiling of the free path, not of the format; a paid plan or a presigned
  direct-to-R2 upload lifts it.
- **72 h maximum TTL**, 60 s minimum, matching a plane hold.
- **R2 free tier**: 10 GB stored, zero egress fees. D1 free tier: 5 GB, 5 M row
  reads/day. A 10 MB link downloaded 1,000 times costs nothing on egress, which
  is why R2 and not S3.
- **Integrity on the free plan is a byte count**, not a hash. The page prints the
  sender's SHA-256 so a receiver can check it with `sha256sum`; that is the
  guarantee a download page has always offered.
- **The 10 ms CPU budget, measured rather than assumed.** This hasher runs at
  ~79 MiB/s in V8 on a desktop, so a free-tier request can afford roughly 700 KB
  of hashing before anything else is counted. `HASH_LIMIT` defaults to 0 (off);
  256 KB is a sane setting if you want small files verified with ~3x headroom.
  `HASH_MODE=verify` on a paid plan has no such problem.

## Provision (one command each, in order)

```powershell
cd G:\micro-host\workspace-prototype\cloudflare\share

npx wrangler r2 bucket create postcard-planes
npx wrangler d1 create postcard-share          # copy database_id into wrangler.toml
npx wrangler d1 execute postcard-share --remote --file schema.sql
npx wrangler secret put PUBLISH_SECRET         # any long random string; keep it
npx wrangler deploy
```

`wrangler deploy` prints the hostname. Then point the studio at it:

```powershell
# the app's .env
SHARE_REMOTE_URL=https://postcard-share.<account>.workers.dev
SHARE_REMOTE_SECRET=<the same PUBLISH_SECRET>
```

Restart the studio. `POST /api/guest/paper-plane/share` now uploads instead of
reading from disk, and returns `{ url, token, sha256, sha256Verified, hosted: true }`.
Unset `SHARE_REMOTE_URL` and it falls back to local links — no credentials, no
network, same page.

## Verify a deploy

```powershell
Invoke-RestMethod https://<host>/healthz
# ok, live link count, and the host's clock
```

Then publish one plane and open the URL with Wi-Fi off on the *sending* machine.
That is the whole claim: the sender being offline must not matter.

## What this does not do

- No accounts, no listing, no "my files" — a link is a capability, not a library.
- No upload without the secret, so this is not a public drop box.
- No resumable uploads and no multipart: one PUT, up to the request-body limit.
- Revoking deletes the object immediately and marks the row, so a revoked link is
  `404` at the page and `410 gone` at the bytes even if the row is edited back.
