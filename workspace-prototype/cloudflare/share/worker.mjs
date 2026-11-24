// The share host that is not your laptop.
//
// Same front door as the studio's local share mode, but the bytes and the record
// live on Cloudflare: R2 for the object, D1 for the row. Once a publish returns,
// the sender's machine can sleep, close, or catch fire.
//
// Three properties worth stating because they are decisions, not accidents:
//
//   1. This Worker never receives a live token. Publishing is addressed by
//      sha256(token); GET /s/<token> hashes it on the way in. D1 and the R2 key
//      space therefore contain no credential, so a dump of either is not a set of
//      working links.
//   2. Publishing requires PUBLISH_SECRET. Reading requires the token. There is
//      no anonymous write path, so the host cannot be used as free file storage
//      by anyone who finds the hostname.
//   3. Integrity is checked by exact byte count on every upload. Full SHA-256
//      verification is available but OFF by default: a free Worker has ~10 ms of
//      CPU per request, and hashing 90 MB in JavaScript is several seconds of it.
//      Set HASH_MODE=verify (paid plan) or HASH_LIMIT=<bytes> to turn it on.

import { hashingStream, createSha256 } from "./sha256.mjs";
import { renderSharePage, shareMetaChips, sharePreview } from "../../share-page.mjs";

const MIN_TTL_SEC = 60;
const MAX_TTL_SEC = 72 * 3600;
const MAX_BYTES = 95 * 1024 * 1024;
const MIN_SECRET_LEN = 16;

const PAGE_RE = /^\/s\/([A-Za-z0-9_-]{1,128})$/;
const FILE_RE = /^\/s\/([A-Za-z0-9_-]{1,128})\/file$/;
const PUBLISH_RE = /^\/api\/share\/([0-9a-f]{64})$/;
const REVOKE_RE = /^\/api\/share\/([0-9a-f]{64})\/revoke$/;

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const noStore = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
};

/** Constant-time compare over equal-length UTF-8. A length mismatch is not secret. */
function secretMatches(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string" || expected.length < MIN_SECRET_LEN) {
    return false;
  }
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function digestOf(token) {
  const bytes = new TextEncoder().encode(String(token));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeHeader(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

/** A name that is safe to echo in a header and to show on the page. */
function cleanFileName(value) {
  const name = String(value ?? "").trim();
  if (!name || name.length > 200) return "";
  if (/[/\\\u0000-\u001f\u007f]/.test(name)) return "";
  if (name.startsWith(".")) return "";
  return name;
}

const contentDisposition = (name) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

const rowToRecord = (row) => ({
  tokenSha256: row.token_sha256,
  fileName: row.file_name,
  fromCardId: row.from_card,
  bytes: row.bytes,
  sha256: row.sha256,
  contentType: row.content_type,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  downloads: row.downloads,
  maxDownloads: row.max_downloads,
  revokedAt: row.revoked_at,
});

async function lookup(env, digest, now) {
  const row = await env.DB.prepare("select * from share_link where token_sha256 = ?1")
    .bind(digest)
    .first();
  if (!row) return { error: "unknown" };
  if (row.revoked_at) return { error: "revoked" };
  if (row.expires_at <= now) return { error: "expired" };
  if (row.max_downloads > 0 && row.downloads >= row.max_downloads) return { error: "used_up" };
  return { record: rowToRecord(row) };
}

function errorPage(error) {
  return new Response(
    renderSharePage({ title: "", meta: "", preview: "", fileUrl: "#", error, note: "" }),
    {
      status: ["expired", "gone", "used_up"].includes(error) ? 410 : 404,
      headers: { "content-type": "text/html; charset=utf-8", ...noStore },
    },
  );
}

/**
 * Resolve a Range header against a known size. Mirrors the studio's behaviour so
 * a link behaves the same whether it is served from this machine or from R2,
 * including suffix ranges and 416 with `bytes *\/size`.
 */
function parseRange(header, size) {
  if (!header) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return { kind: "invalid" };
  let start = match[1] === "" ? null : Number(match[1]);
  let end = match[2] === "" ? null : Number(match[2]);
  if (start === null && end === null) return { kind: "invalid" };
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null) {
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: "invalid" };
  if (start > end || start >= size) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}

async function serveFile(request, env, ctx, token, record) {
  const key = `s/${record.tokenSha256}`;
  const head = await env.BUCKET.head(key);
  if (!head) {
    // The row says the link is live; R2 says the bytes are not there. 410 is the
    // honest code: the link was real and the file is gone.
    return request.method === "HEAD"
      ? new Response(null, { status: 410, headers: noStore })
      : new Response("gone", { status: 410, headers: { "content-type": "text/plain; charset=utf-8", ...noStore } });
  }

  const total = head.size;
  const etag = `"${record.sha256}"`;
  const headers = {
    "content-type": record.contentType || "application/octet-stream",
    "content-disposition": contentDisposition(record.fileName),
    "accept-ranges": "bytes",
    etag,
    ...noStore,
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store" } });
  }

  const range = parseRange(request.headers.get("range"), total);
  if (range.kind === "invalid" || range.kind === "unsatisfiable") {
    return new Response("range not satisfiable", {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${total}`, "content-length": "0" },
    });
  }

  if (request.method === "HEAD") {
    const length = range.kind === "partial" ? range.end - range.start + 1 : total;
    const extra =
      range.kind === "partial" ? { "content-range": `bytes ${range.start}-${range.end}/${total}` } : {};
    return new Response(null, {
      status: range.kind === "partial" ? 206 : 200,
      headers: { ...headers, ...extra, "content-length": String(length) },
    });
  }

  const object =
    range.kind === "partial"
      ? await env.BUCKET.get(key, { range: { offset: range.start, length: range.end - range.start + 1 } })
      : await env.BUCKET.get(key);
  if (!object) {
    return new Response("gone", { status: 410, headers: { "content-type": "text/plain; charset=utf-8", ...noStore } });
  }

  const isPreview = new URL(request.url).searchParams.has("preview");
  if (!isPreview) {
    ctx.waitUntil(
      env.DB.prepare(
        "update share_link set downloads = downloads + 1, last_download_at = ?1 where token_sha256 = ?2",
      )
        .bind(Date.now(), record.tokenSha256)
        .run()
        .catch(() => undefined),
    );
  }

  // The response has to carry a length the platform cannot quietly drop. A plain
  // `object.body` can arrive without one, and then a truncated transfer ends as a
  // clean 200. FixedLengthStream makes a short object an error the client sees.
  const length = range.kind === "partial" ? range.end - range.start + 1 : total;
  const fixed = new FixedLengthStream(length);
  object.body.pipeTo(fixed.writable).catch(() => undefined);

  if (range.kind === "partial") {
    return new Response(fixed.readable, {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(length),
        "content-range": `bytes ${range.start}-${range.end}/${total}`,
      },
    });
  }
  return new Response(fixed.readable, { status: 200, headers: { ...headers, "content-length": String(length) } });
}

async function publish(request, env, digest) {
  if (!secretMatches(request.headers.get("x-publish-secret"), env.PUBLISH_SECRET)) {
    return json({ error: "unauthorised" }, 401);
  }

  const fileName = cleanFileName(decodeHeader(request.headers.get("x-file-name")));
  if (!fileName) return json({ error: "x-file-name must be a plain file name." }, 400);

  const fromCard = (decodeHeader(request.headers.get("x-from-card")) || "unknown").slice(0, 64);
  const ttl = Number(request.headers.get("x-ttl") ?? "0");
  const maxDownloads = Number(request.headers.get("x-max-downloads") ?? "0");
  const declared = Number(request.headers.get("x-size") ?? "0");
  const claimedHash = request.headers.get("x-sha256");
  const contentType = (request.headers.get("content-type") || "application/octet-stream").slice(0, 120);
  const now = Date.now();

  // The deadline is computed here, from a duration the client chose. Accepting an
  // absolute date from the client would let its clock decide how long a link
  // lives, and a 60s link sent across a slow link would arrive already expired.
  if (!Number.isInteger(ttl) || ttl < MIN_TTL_SEC || ttl > MAX_TTL_SEC) {
    return json({ error: `x-ttl must be an integer between ${MIN_TTL_SEC} and ${MAX_TTL_SEC} seconds.` }, 400);
  }
  const expiresAt = now + ttl * 1000;
  if (!Number.isInteger(maxDownloads) || maxDownloads < 0 || maxDownloads > 10_000) {
    return json({ error: "x-max-downloads must be an integer between 0 and 10000." }, 400);
  }
  if (!Number.isInteger(declared) || declared <= 0) {
    // The Workers runtime does not expose `content-length`, so the client states
    // the size and the host compares it with what R2 actually stored.
    return json({ error: "x-size is required; a streamed upload needs a known size." }, 400);
  }
  if (declared > MAX_BYTES) {
    return json({ error: `That is ${declared} bytes; this host takes up to ${MAX_BYTES}.` }, 413);
  }

  const verifyLimit = Number(env.HASH_LIMIT ?? "0");
  const verify = env.HASH_MODE === "verify" || (verifyLimit > 0 && declared <= verifyLimit);
  const hasher = verify ? createSha256() : null;

  if (!request.body) {
    return json({ error: "empty body" }, 400);
  }

  // R2 will not store a stream of unknown length, and `pipeThrough` erases the
  // length it arrived with. FixedLengthStream restores it -- and doubles as the
  // byte-count check: a body that is short or long of x-size breaks the stream
  // instead of producing a quietly truncated file.
  let body = request.body;
  if (hasher) body = body.pipeThrough(hashingStream(hasher));

  const key = `s/${digest}`;
  const fixed = new FixedLengthStream(declared);
  const pumping = body.pipeTo(fixed.writable).then(
    () => null,
    (error) => error,
  );

  let object;
  try {
    object = await env.BUCKET.put(key, fixed.readable, {
      httpMetadata: { contentType },
      customMetadata: { from: fromCard, name: fileName },
    });
  } catch (error) {
    await pumping;
    await env.BUCKET.delete(key).catch(() => undefined);
    return json({ error: `Upload failed: ${String(error?.message ?? error).slice(0, 200)}` }, 400);
  }

  const pumpError = await pumping;
  if (pumpError) {
    await env.BUCKET.delete(key);
    return json({ error: `The body did not match x-size (${declared}): ${String(pumpError?.message ?? pumpError).slice(0, 120)}` }, 400);
  }

  if (!object || object.size !== declared) {
    await env.BUCKET.delete(key);
    return json({ error: `Stored ${object?.size ?? 0} bytes but ${declared} were announced.` }, 400);
  }

  const verifiedHash = hasher ? hasher.finish() : "";
  if (verify && claimedHash && claimedHash !== verifiedHash) {
    await env.BUCKET.delete(key);
    return json({ error: "The bytes that arrived do not match the hash that was sent." }, 400);
  }

  const sha256 = verify ? verifiedHash : cleanHash(claimedHash);
  if (!sha256) {
    await env.BUCKET.delete(key);
    return json({ error: "x-sha256 is required when the host is not hashing." }, 400);
  }

  try {
    await env.DB.prepare(
      `insert into share_link
         (token_sha256, file_name, from_card, bytes, sha256, content_type, created_at, expires_at, downloads, max_downloads)
       values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)`,
    )
      .bind(digest, fileName, fromCard, declared, sha256, contentType, now, expiresAt, maxDownloads)
      .run();
  } catch (error) {
    // No row means no link, so the object must not outlive the failure.
    await env.BUCKET.delete(key);
    return json({ error: `Could not record the link: ${String(error?.message ?? error).slice(0, 200)}` }, 500);
  }

  return json({ ok: true, bytes: declared, sha256, verified: verify, expiresAt }, 201);
}

const cleanHash = (value) => (/^[0-9a-f]{64}$/i.test(String(value ?? "")) ? String(value).toLowerCase() : "");

async function revoke(request, env, digest) {
  if (!secretMatches(request.headers.get("x-publish-secret"), env.PUBLISH_SECRET)) {
    return json({ error: "unauthorised" }, 401);
  }
  const result = await env.DB.prepare(
    "update share_link set revoked_at = ?1 where token_sha256 = ?2 and revoked_at is null",
  )
    .bind(Date.now(), digest)
    .run();
  const changed = result?.meta?.changes ?? 0;
  if (changed > 0) await env.BUCKET.delete(`s/${digest}`);
  return json({ revoked: changed > 0 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const page = PAGE_RE.exec(path);
    const file = FILE_RE.exec(path);
    const publishMatch = PUBLISH_RE.exec(path);
    const revokeMatch = REVOKE_RE.exec(path);

    try {
      if (path === "/healthz") {
        const row = await env.DB.prepare(
          "select count(*) as live from share_link where revoked_at is null and expires_at > ?1",
        )
          .bind(Date.now())
          .first();
        return json({ ok: true, live: row?.live ?? 0, now: Date.now() });
      }

      if (publishMatch) {
        if (method !== "PUT") return json({ error: "method not allowed" }, 405);
        return await publish(request, env, publishMatch[1]);
      }

      if (revokeMatch) {
        if (method !== "POST") return json({ error: "method not allowed" }, 405);
        return await revoke(request, env, revokeMatch[1]);
      }

      if (page || file) {
        if (method !== "GET" && method !== "HEAD") {
          return new Response("Not found\n", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8", ...noStore },
          });
        }
        const token = (page ?? file)[1];
        const digest = await digestOf(token);
        const found = await lookup(env, digest, Date.now());
        if (found.error) {
          if (file) {
            return new Response(found.error, {
              status: ["expired", "gone", "used_up"].includes(found.error) ? 410 : 404,
              headers: { "content-type": "text/plain; charset=utf-8", ...noStore },
            });
          }
          return errorPage(found.error);
        }
        if (file) return await serveFile(request, env, ctx, token, found.record);

        return new Response(
          renderSharePage({
            title: found.record.fileName,
            meta: shareMetaChips(found.record, Date.now()),
            preview: sharePreview(found.record, token),
            fileUrl: `/s/${encodeURIComponent(token)}/file`,
            token,
            host: url.host,
          }),
          { status: 200, headers: { "content-type": "text/html; charset=utf-8", ...noStore } },
        );
      }

      // Everything else is a 404, not a directory, not an index, not the API.
      return new Response("Not found\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", ...noStore },
      });
    } catch (error) {
      return json({ error: "internal", detail: String(error?.message ?? error).slice(0, 200) }, 500);
    }
  },

  /**
   * Hourly sweep. Expiry is enforced on read, so this is about disk and money,
   * not correctness: the bytes have to leave R2 or the free tier fills with
   * links nobody can open.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const now = Date.now();
        for (let pass = 0; pass < 20; pass += 1) {
          const { results } = await env.DB.prepare(
            "select token_sha256 from share_link where expires_at <= ?1 or revoked_at is not null limit 1000",
          )
            .bind(now)
            .all();
          if (!results?.length) break;
          const keys = results.map((row) => `s/${row.token_sha256}`);
          await env.BUCKET.delete(keys);
          const marks = results.map(() => "?").join(",");
          await env.DB.prepare(`delete from share_link where token_sha256 in (${marks})`)
            .bind(...results.map((row) => row.token_sha256))
            .run();
          if (results.length < 1000) break;
        }
      })().catch(() => undefined),
    );
  },
};
