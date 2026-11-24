import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMailbox, createBlobStore } from "../mailbox.mjs";
import { createShareServer } from "../share.mjs";
import { once } from "node:events";

async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plane-share-"));
  const blobs = createBlobStore(path.join(dir, "cloud"));
  let t = 1_700_000_000_000;
  const clock = () => t;
  const mailbox = createMailbox({ dbPath: path.join(dir, "mbox.sqlite"), blobs, clock });
  const share = createShareServer({ mailbox, blobs, clock, baseUrl: "http://test" });
  share.server.listen(0, "127.0.0.1");
  await once(share.server, "listening");
  const base = `http://127.0.0.1:${share.server.address().port}`;
  return {
    dir, blobs, mailbox, share, base,
    advance: (ms) => { t += ms; },
    async upload(body, headers = {}) {
      const res = await fetch(`${base}/api/planes`, {
        method: "POST",
        body,
        headers: { "x-plane-from": "card-A", "x-plane-to": "link", ...headers },
      });
      return { status: res.status, json: res.status === 201 ? await res.json() : null };
    },
    async close() {
      await new Promise((r) => share.server.close(r));
      try { mailbox.db.close(); } catch { /* already closed */ }
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds the wal briefly */ }
    },
  };
}

test("upload returns a link, and the link serves the bytes", async () => {
  const h = await harness();
  try {
    const { status, json } = await h.upload(Buffer.from("hello link\n"), { "x-plane-name": "note.txt" });
    assert.equal(status, 201);
    assert.match(json.url, /^http:\/\/test\/p\/[A-Za-z0-9_-]{40,}$/);

    const token = new URL(json.url).pathname.split("/").pop();

    const page = await fetch(`${h.base}/p/${token}`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /note\.txt/);
    assert.match(html, /Open in Post Card/);
    assert.match(html, /Download/);

    const file = await fetch(`${h.base}/p/${token}/file`);
    assert.equal(file.status, 200);
    assert.equal(await file.text(), "hello link\n");
    assert.equal(file.headers.get("accept-ranges"), "bytes");
  } finally { await h.close(); }
});

test("Range requests return 206 and the right slice", async () => {
  const h = await harness();
  try {
    const body = Buffer.from("0123456789ABCDEF");
    const { json } = await h.upload(body);
    const token = new URL(json.url).pathname.split("/").pop();

    const res = await fetch(`${h.base}/p/${token}/file`, { headers: { range: "bytes=2-5" } });
    assert.equal(res.status, 206);
    assert.equal(await res.text(), "2345");
    assert.equal(res.headers.get("content-range"), "bytes 2-5/16");

    const tail = await fetch(`${h.base}/p/${token}/file`, { headers: { range: "bytes=-4" } });
    assert.equal(tail.status, 206);
    assert.equal(await tail.text(), "CDEF");

    const bad = await fetch(`${h.base}/p/${token}/file`, { headers: { range: "bytes=99-200" } });
    assert.equal(bad.status, 416);
  } finally { await h.close(); }
});

test("ETag short-circuits a repeat download", async () => {
  const h = await harness();
  try {
    const { json } = await h.upload(Buffer.from("cacheable"));
    const token = new URL(json.url).pathname.split("/").pop();
    const first = await fetch(`${h.base}/p/${token}/file`);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    const second = await fetch(`${h.base}/p/${token}/file`, { headers: { "if-none-match": etag } });
    assert.equal(second.status, 304);
  } finally { await h.close(); }
});

test("an expired link is refused server-side, page and bytes alike", async () => {
  const h = await harness();
  try {
    const { json } = await h.upload(Buffer.from("tick tock"), { "x-plane-ttl": "60" });
    const token = new URL(json.url).pathname.split("/").pop();
    assert.equal((await fetch(`${h.base}/p/${token}/file`)).status, 200);

    h.advance(61_000);
    assert.equal((await fetch(`${h.base}/p/${token}/file`)).status, 410);
    const page = await fetch(`${h.base}/p/${token}`);
    assert.equal(page.status, 410);
    assert.match(await page.text(), /expired/i);
  } finally { await h.close(); }
});

test("an unknown token is 404 and a revoked one is 404", async () => {
  const h = await harness();
  try {
    assert.equal((await fetch(`${h.base}/p/not-a-real-token`)).status, 404);
    const { json } = await h.upload(Buffer.from("x"));
    const token = new URL(json.url).pathname.split("/").pop();
    h.mailbox.db.prepare(`update share_links set revoked_at = ?`).run(Date.now());
    assert.equal((await fetch(`${h.base}/p/${token}`)).status, 404);
  } finally { await h.close(); }
});

test("downloads are counted, and a max_downloads link stops at the limit", async () => {
  const h = await harness();
  try {
    const { json } = await h.upload(Buffer.from("counted"));
    const token = new URL(json.url).pathname.split("/").pop();
    await fetch(`${h.base}/p/${token}/file`);
    await fetch(`${h.base}/p/${token}/file`);
    const row = h.mailbox.db.prepare(`select downloads from share_links`).get();
    assert.equal(row.downloads, 2);

    h.mailbox.db.prepare(`update share_links set max_downloads = 3`).run();
    assert.equal((await fetch(`${h.base}/p/${token}/file`)).status, 200);
    assert.equal((await fetch(`${h.base}/p/${token}/file`)).status, 410, "limit reached");
  } finally { await h.close(); }
});

test("a text plane gets a preview, a binary one does not", async () => {
  const h = await harness();
  try {
    const text = await h.upload(Buffer.from("line one\nline two\n"), { "x-plane-name": "log.txt" });
    const token = new URL(text.json.url).pathname.split("/").pop();
    const html = await (await fetch(`${h.base}/p/${token}`)).text();
    assert.match(html, /<pre class="preview">line one/);

    const bin = await h.upload(Buffer.alloc(64, 0), { "x-plane-name": "disk.qcow2" });
    const btoken = new URL(bin.json.url).pathname.split("/").pop();
    const bhtml = await (await fetch(`${h.base}/p/${btoken}`)).text();
    assert.ok(!bhtml.includes("<pre class=\"preview\">"), "binary must not be dumped into the page");
  } finally { await h.close(); }
});
