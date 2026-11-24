import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createShareLinks } from "../share-links.mjs";

async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postcard-share-"));
  const dataDirectory = path.join(dir, "data");
  const spool = path.join(dataDirectory, "paper-planes");
  fs.mkdirSync(path.join(spool, "linux"), { recursive: true });

  let now = 1_700_000_000_000;
  const clock = () => now;
  const links = createShareLinks({ dataDirectory, paperPlanesDropDir: spool, clock });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (await links.handle(req, res, url)) return;
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(error?.message ?? error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    dir, spool, links, base,
    advance: (ms) => { now += ms; },
    put(name, content) {
      fs.writeFileSync(path.join(spool, "linux", name), content);
    },
    async issue(fileName, extra = {}) {
      return links.issue({ cardId: "linux", fileName, fromCardId: "windows", origin: base, ...extra });
    },
    async close() {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds it briefly */ }
    },
  };
}

const tokenOf = (url) => new URL(url).pathname.split("/").pop();

test("a link renders a page and serves the bytes", async () => {
  const h = await harness();
  try {
    h.put("note.txt", "hello from the spool\n");
    const link = await h.issue("note.txt");
    assert.equal(link.fileName, "note.txt");
    assert.match(link.url, /^http:\/\/127\.0\.0\.1:\d+\/s\/[A-Za-z0-9_-]{40,}$/);

    const token = tokenOf(link.url);
    const page = await fetch(`${h.base}/s/${token}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /note\.txt/);
    assert.match(html, /Download/);
    assert.match(html, /Open in Post Card/);
    assert.match(html, /from windows/);

    const file = await fetch(`${h.base}/s/${token}/file`);
    assert.equal(file.status, 200);
    assert.equal(await file.text(), "hello from the spool\n");
    assert.equal(file.headers.get("accept-ranges"), "bytes");
    assert.match(file.headers.get("content-disposition"), /attachment; filename="note\.txt"/);
  } finally { await h.close(); }
});

test("the spool file is read in place, never copied", async () => {
  const h = await harness();
  try {
    h.put("live.txt", "before\n");
    const token = tokenOf((await h.issue("live.txt")).url);
    assert.equal(await (await fetch(`${h.base}/s/${token}/file`)).text(), "before\n");

    h.put("live.txt", "after, same file\n");
    assert.equal(await (await fetch(`${h.base}/s/${token}/file`)).text(), "after, same file\n");
    assert.equal(fs.existsSync(path.join(h.spool, "linux", "live.txt")), true);
  } finally { await h.close(); }
});

test("Range requests return 206 and the right slice", async () => {
  const h = await harness();
  try {
    h.put("blob.bin", "0123456789ABCDEF");
    const token = tokenOf((await h.issue("blob.bin")).url);

    const mid = await fetch(`${h.base}/s/${token}/file`, { headers: { range: "bytes=2-5" } });
    assert.equal(mid.status, 206);
    assert.equal(await mid.text(), "2345");
    assert.equal(mid.headers.get("content-range"), "bytes 2-5/16");

    const tail = await fetch(`${h.base}/s/${token}/file`, { headers: { range: "bytes=-4" } });
    assert.equal(tail.status, 206);
    assert.equal(await tail.text(), "CDEF");

    const past = await fetch(`${h.base}/s/${token}/file`, { headers: { range: "bytes=99-200" } });
    assert.equal(past.status, 416);
    assert.equal(past.headers.get("content-range"), "bytes */16");

    const nonsense = await fetch(`${h.base}/s/${token}/file`, { headers: { range: "pages=1-2" } });
    assert.equal(nonsense.status, 416);
  } finally { await h.close(); }
});

test("ETag short-circuits a repeat download", async () => {
  const h = await harness();
  try {
    h.put("cache.txt", "cacheable");
    const token = tokenOf((await h.issue("cache.txt")).url);
    const first = await fetch(`${h.base}/s/${token}/file`);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    await first.text();
    const second = await fetch(`${h.base}/s/${token}/file`, { headers: { "if-none-match": etag } });
    assert.equal(second.status, 304);
  } finally { await h.close(); }
});

test("an expired link is refused server-side, page and bytes alike", async () => {
  const h = await harness();
  try {
    h.put("tick.txt", "tick tock");
    const token = tokenOf((await h.issue("tick.txt", { ttlSec: 60 })).url);
    assert.equal((await fetch(`${h.base}/s/${token}/file`)).status, 200);

    h.advance(61_000);
    assert.equal((await fetch(`${h.base}/s/${token}/file`)).status, 410);
    const page = await fetch(`${h.base}/s/${token}`);
    assert.equal(page.status, 410);
    assert.match(await page.text(), /expired/i);
  } finally { await h.close(); }
});

test("an unknown token is 404, a revoked one is 404", async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(`${h.base}/s/not-a-real-token`)).status, 404);

    h.put("pull.txt", "pull me");
    const link = await h.issue("pull.txt");
    const token = tokenOf(link.url);
    assert.equal((await fetch(`${h.base}/s/${token}`)).status, 200);
    assert.deepEqual(await h.links.revoke(token), { revoked: true });
    assert.equal((await fetch(`${h.base}/s/${token}`)).status, 404);
    assert.equal((await fetch(`${h.base}/s/${token}/file`)).status, 404);
  } finally { await h.close(); }
});

test("downloads are counted, and a capped link stops at the limit", async () => {
  const h = await harness();
  try {
    h.put("counted.txt", "counted");
    const token = tokenOf((await h.issue("counted.txt", { maxDownloads: 2 })).url);

    assert.equal((await fetch(`${h.base}/s/${token}/file`)).status, 200);
    assert.equal((await fetch(`${h.base}/s/${token}/file`)).status, 200);
    assert.equal((await fetch(`${h.base}/s/${token}/file`)).status, 410, "limit reached");
  } finally { await h.close(); }
});

test("a preview read does not burn a download", async () => {
  const h = await harness();
  try {
    h.put("preview.txt", "line one\nline two\n");
    const token = tokenOf((await h.issue("preview.txt", { maxDownloads: 1 })).url);

    const preview = await fetch(`${h.base}/s/${token}/file?preview=1`, { headers: { range: "bytes=0-800" } });
    assert.equal(preview.status, 206);
    await preview.text();

    assert.equal((await fetch(`${h.base}/s/${token}/file`)).status, 200, "the one real download still works");
  } finally { await h.close(); }
});

test("a link cannot be pointed outside the card spool", async () => {
  const h = await harness();
  try {
    fs.writeFileSync(path.join(h.dir, "secret.txt"), "do not share");
    h.put("note.txt", "shareable");
    await assert.rejects(h.issue("../secret.txt"), /plain file name/);
    await assert.rejects(h.issue("missing.txt"), /not in this card's spool/);
    await assert.rejects(
      h.links.issue({ cardId: "linux", fileName: "note.txt", origin: "javascript:alert(1)" }),
      /origin must be an http/,
    );
  } finally { await h.close(); }
});

test("TTL is bounded by the 72h ceiling and a 60s floor", async () => {
  const h = await harness();
  try {
    h.put("ttl.txt", "x");
    await assert.rejects(h.issue("ttl.txt", { ttlSec: 59 }), /ttlSec must be/);
    await assert.rejects(h.issue("ttl.txt", { ttlSec: 72 * 3600 + 1 }), /ttlSec must be/);

    const link = await h.issue("ttl.txt", { ttlSec: 48 * 3600 });
    assert.equal(link.expiresAt, 1_700_000_000_000 + 48 * 3600 * 1000);
  } finally { await h.close(); }
});

test("deleting the spool file leaves a dead link, not a silent 404", async () => {
  const h = await harness();
  try {
    h.put("moved.txt", "bytes here");
    const token = tokenOf((await h.issue("moved.txt")).url);
    fs.rmSync(path.join(h.spool, "linux", "moved.txt"));

    const file = await fetch(`${h.base}/s/${token}/file`);
    assert.equal(file.status, 410);
    const page = await fetch(`${h.base}/s/${token}`);
    assert.equal(page.status, 410);
    assert.match(await page.text(), /nothing left/i);
  } finally { await h.close(); }
});

test("the stored record keeps a hash of the token, never the token", async () => {
  const h = await harness();
  try {
    h.put("hash.txt", "hash me");
    const link = await h.issue("hash.txt");
    const raw = fs.readFileSync(path.join(h.dir, "data", "share-links.json"), "utf8");
    assert.ok(!raw.includes(link.token), "the token must not be recoverable from disk");
    assert.match(raw, /"tokenSha256"/);
  } finally { await h.close(); }
});
