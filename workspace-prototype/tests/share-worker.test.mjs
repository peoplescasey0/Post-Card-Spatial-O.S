// The hosted share surface, exercised against a real Workers runtime.
//
// Miniflare gives us workerd + R2 + D1 locally, so these are not mocks: the
// Worker is compiled, the bucket stores bytes, D1 answers the queries. What is
// NOT proven here is Cloudflare's own edge -- that needs a deploy.

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, "..", "cloudflare", "share", "worker.mjs");
const schemaPath = path.join(here, "..", "cloudflare", "share", "schema.sql");

const SECRET = "test-publish-secret-0123456789";
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

let mf;
let db;
let bucket;

before(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: workerPath,
    modulesRoot: path.join(here, ".."),
    compatibilityDate: "2026-01-01",
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
    bindings: { PUBLISH_SECRET: SECRET, HASH_MODE: "verify", HASH_LIMIT: "0" },
  });
  db = await mf.getD1Database("DB");
  // D1's exec splits on newlines, so a multi-line CREATE TABLE is "incomplete
  // input". Strip comments and run one statement at a time instead.
  const statements = (await readFile(schemaPath, "utf8"))
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();
  bucket = await mf.getR2Bucket("BUCKET");
});

after(async () => {
  await mf?.dispose();
});

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Publish as the desktop app does: token stays here, only its digest travels. */
async function publish({
  body,
  fileName = "plane.txt",
  from = "victoria",
  ttlSec = 3600,
  maxDownloads = 0,
  secret = SECRET,
  claimedHash,
  contentType = "text/plain; charset=utf-8",
} = {}) {
  const token = b64url(randomBytes(32));
  const digest = sha256(Buffer.from(token));
  const payload = body ?? Buffer.from("hello from a paper plane\n");

  const res = await mf.dispatchFetch(`http://share.test/api/share/${digest}`, {
    method: "PUT",
    headers: {
      "x-publish-secret": secret,
      "x-file-name": encodeURIComponent(fileName),
      "x-from-card": encodeURIComponent(from),
      "x-ttl": String(ttlSec),
      "x-max-downloads": String(maxDownloads),
      "x-sha256": claimedHash ?? sha256(payload),
      "x-size": String(payload.length),
      "content-type": contentType,
    },
    body: payload,
  });

  return { token, digest, payload, res, json: await res.clone().json().catch(() => ({})) };
}

const get = (pathname, init) => mf.dispatchFetch(`http://share.test${pathname}`, init);

describe("publishing", () => {
  test("a publish stores the bytes and returns a verified hash", async () => {
    const { res, json, payload } = await publish();
    assert.equal(res.status, 201);
    assert.equal(json.sha256, sha256(payload));
    assert.equal(json.verified, true);
    assert.equal(json.bytes, payload.length);
  });

  test("publishing without the secret is refused", async () => {
    const { res } = await publish({ secret: "nope" });
    assert.equal(res.status, 401);
  });

  test("the token never reaches the host: D1 and R2 hold only its digest", async () => {
    const { token, digest } = await publish();
    const row = await db.prepare("select * from share_link where token_sha256 = ?1").bind(digest).first();
    assert.ok(row, "row exists");
    assert.equal(JSON.stringify(row).includes(token), false, "no live token in the row");

    const listed = await bucket.list();
    assert.ok(listed.objects.some((o) => o.key === `s/${digest}`), "object keyed by digest");
    assert.equal(listed.objects.some((o) => o.key.includes(token)), false);
  });

  test("a file name that is a path is refused", async () => {
    for (const bad of ["../secret.txt", "a/b.txt", ".hidden", "a\\b.txt", ""]) {
      const { res } = await publish({ fileName: bad });
      assert.equal(res.status, 400, `refused: ${JSON.stringify(bad)}`);
    }
  });

  test("ttl is bounded on the host, not merely on the client", async () => {
    const tooLong = await publish({ ttlSec: 73 * 3600 });
    assert.equal(tooLong.res.status, 400);
    const tooShort = await publish({ ttlSec: 5 });
    assert.equal(tooShort.res.status, 400);
  });

  test("a hash that does not match the arriving bytes is refused and leaves nothing behind", async () => {
    const { res, digest } = await publish({ claimedHash: "0".repeat(64) });
    assert.equal(res.status, 400);
    assert.equal(await bucket.head(`s/${digest}`), null, "no orphan object");
    const row = await db.prepare("select 1 from share_link where token_sha256 = ?1").bind(digest).first();
    assert.equal(row, null, "no orphan row");
  });

  test("an oversized declared upload is refused before it is stored", async () => {
    const res = await mf.dispatchFetch(`http://share.test/api/share/${"a".repeat(64)}`, {
      method: "PUT",
      headers: {
        "x-publish-secret": SECRET,
        "x-file-name": "big.iso",
        "x-ttl": "60",
        "x-sha256": "b".repeat(64),
        "x-size": String(200 * 1024 * 1024),
        "content-type": "application/octet-stream",
      },
      body: Buffer.from("x"),
    });
    assert.equal(res.status, 413);
  });
});

describe("reading", () => {
  test("the page names the file, the sender, the time left and the hash", async () => {
    const { token, payload } = await publish({ fileName: "notes.md", from: "casey", ttlSec: 7200 });
    const res = await get(`/s/${token}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");

    const html = await res.text();
    assert.ok(html.includes("notes.md"), "file name");
    assert.ok(html.includes("from casey"), "sender");
    assert.ok(html.includes(sha256(payload).slice(0, 16)), "hash chip");
    assert.match(html, /1h \d+m left/);
  });

  test("Open in Post Card carries the token, not the file name", async () => {
    const { token } = await publish({ fileName: "plane.txt" });
    const html = await (await get(`/s/${token}`)).text();
    assert.ok(html.includes(`postcard://plane?t=${token}`), "deep link carries the capability");
    assert.equal(html.includes("postcard://plane/plane.txt"), false, "old dead link is gone");
  });

  test("the bytes arrive whole, as an attachment, with a stable etag", async () => {
    const payload = randomBytes(4096);
    const { token, digest } = await publish({ body: payload, fileName: "blob.bin", contentType: "application/octet-stream" });
    const res = await get(`/s/${token}/file`);

    assert.equal(res.status, 200);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), payload);
    assert.match(res.headers.get("content-disposition"), /attachment; filename="blob\.bin"/);
    assert.equal(res.headers.get("etag"), `"${sha256(payload)}"`);
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(res.headers.get("content-length"), String(payload.length));
    assert.ok(digest);
  });

  test("a range request returns exactly that slice", async () => {
    const payload = Buffer.from("0123456789abcdefghij");
    const { token } = await publish({ body: payload });

    const first = await get(`/s/${token}/file`, { headers: { range: "bytes=0-9" } });
    assert.equal(first.status, 206);
    assert.equal(await first.text(), "0123456789");
    assert.equal(first.headers.get("content-range"), "bytes 0-9/20");
    assert.equal(first.headers.get("content-length"), "10");

    const middle = await get(`/s/${token}/file`, { headers: { range: "bytes=5-14" } });
    assert.equal(await middle.text(), "56789abcde");

    const suffix = await get(`/s/${token}/file`, { headers: { range: "bytes=-4" } });
    assert.equal(suffix.status, 206);
    assert.equal(await suffix.text(), "ghij");
    assert.equal(suffix.headers.get("content-range"), "bytes 16-19/20");

    const open = await get(`/s/${token}/file`, { headers: { range: "bytes=10-" } });
    assert.equal(await open.text(), "abcdefghij");
  });

  test("an impossible range is 416 with the total size in content-range", async () => {
    const { token } = await publish({ body: Buffer.from("short") });
    const res = await get(`/s/${token}/file`, { headers: { range: "bytes=99-120" } });
    assert.equal(res.status, 416);
    assert.equal(res.headers.get("content-range"), "bytes */5");
  });

  test("a matching etag short-circuits to 304", async () => {
    const payload = Buffer.from("cached");
    const { token } = await publish({ body: payload });
    const res = await get(`/s/${token}/file`, { headers: { "if-none-match": `"${sha256(payload)}"` } });
    assert.equal(res.status, 304);
    assert.equal(await res.text(), "");
  });

  test("HEAD reports the size without the body", async () => {
    const payload = randomBytes(1200);
    const { token } = await publish({ body: payload, fileName: "big.bin", contentType: "application/octet-stream" });
    const res = await get(`/s/${token}/file`, { method: "HEAD" });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-length"), "1200");
    assert.equal(await res.text(), "");

    const ranged = await get(`/s/${token}/file`, { method: "HEAD", headers: { range: "bytes=0-99" } });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-length"), "100");
  });

  test("an unknown token, a bad path and a write to a link all 404", async () => {
    assert.equal((await get("/s/not-a-real-token")).status, 404);
    assert.equal((await get("/s/not-a-real-token/file")).status, 404);
    assert.equal((await get("/s/")).status, 404);
    assert.equal((await get("/")).status, 404);
    assert.equal((await get("/api/guest/status")).status, 404);
    const { token } = await publish();
    assert.equal((await get(`/s/${token}`, { method: "POST", body: "x" })).status, 404);
  });
});

describe("lifecycle", () => {
  test("downloads are counted, and a capped link stops", async () => {
    const { token, digest } = await publish({ maxDownloads: 2 });
    await get(`/s/${token}/file`);
    await get(`/s/${token}/file`);
    const row = await db.prepare("select downloads from share_link where token_sha256 = ?1").bind(digest).first();
    assert.equal(row.downloads, 2);

    const third = await get(`/s/${token}/file`);
    assert.equal(third.status, 410);
    const page = await get(`/s/${token}`);
    assert.equal(page.status, 410);
    assert.match(await page.text(), /download limit/);
  });

  test("a preview read does not burn a download", async () => {
    const { token } = await publish({ body: Buffer.from("preview me"), maxDownloads: 1 });
    const preview = await get(`/s/${token}/file?preview=1`, { headers: { range: "bytes=0-20" } });
    assert.equal(preview.status, 206);
    const real = await get(`/s/${token}/file`);
    assert.equal(real.status, 200, "the single allowed download was still available");
  });

  test("an expired link is refused for the page and the bytes", async () => {
    const { token, digest } = await publish();
    await db.prepare("update share_link set expires_at = ?1 where token_sha256 = ?2").bind(Date.now() - 1000, digest).run();
    const page = await get(`/s/${token}`);
    assert.equal(page.status, 410);
    assert.match(await page.text(), /This link expired/);
    assert.equal((await get(`/s/${token}/file`)).status, 410);
  });

  test("revoking pulls the bytes and refuses the link", async () => {
    const { token, digest } = await publish();
    const revoke = await mf.dispatchFetch(`http://share.test/api/share/${digest}/revoke`, {
      method: "POST",
      headers: { "x-publish-secret": SECRET },
    });
    assert.equal(revoke.status, 200);
    assert.deepEqual(await revoke.json(), { revoked: true });
    assert.equal(await bucket.head(`s/${digest}`), null, "bytes are gone, not just hidden");
    assert.equal((await get(`/s/${token}`)).status, 404);
    assert.equal((await get(`/s/${token}/file`)).status, 404);

    const again = await mf.dispatchFetch(`http://share.test/api/share/${digest}/revoke`, {
      method: "POST",
      headers: { "x-publish-secret": SECRET },
    });
    assert.deepEqual(await again.json(), { revoked: false });
  });

  test("a revoked link cannot be read even if the row is later un-revoked", async () => {
    // Belt and braces: the object is deleted at revoke time, so clearing the flag
    // by hand still does not resurrect the file.
    const { token, digest } = await publish();
    await mf.dispatchFetch(`http://share.test/api/share/${digest}/revoke`, {
      method: "POST",
      headers: { "x-publish-secret": SECRET },
    });
    await db.prepare("update share_link set revoked_at = null where token_sha256 = ?1").bind(digest).run();
    const res = await get(`/s/${token}/file`);
    assert.equal(res.status, 410);
    assert.equal(await res.text(), "gone");
  });

  test("the hourly sweep removes expired rows and their bytes", async () => {
    const { digest } = await publish();
    await db.prepare("update share_link set expires_at = ?1 where token_sha256 = ?2").bind(Date.now() - 1000, digest).run();

    await mf.dispatchScheduled?.({ cron: "17 * * * *" });
    // Miniflare exposes the scheduled handler through dispatchScheduled; if the
    // runtime shape differs, run it directly instead of skipping the check.
    if (!mf.dispatchScheduled) {
      const { default: worker } = await import("file:///" + workerPath.replace(/\\/g, "/"));
      const waited = [];
      await worker.scheduled({ cron: "test" }, { DB: db, BUCKET: bucket }, { waitUntil: (p) => waited.push(p) });
      await Promise.all(waited);
    }

    const row = await db.prepare("select 1 from share_link where token_sha256 = ?1").bind(digest).first();
    assert.equal(row, null, "row swept");
    assert.equal(await bucket.head(`s/${digest}`), null, "object swept");
  });

  test("healthz counts live links without leaking anything else", async () => {
    const res = await get("/healthz");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.live, "number");
    assert.deepEqual(Object.keys(body).sort(), ["live", "now", "ok"]);
  });
});


