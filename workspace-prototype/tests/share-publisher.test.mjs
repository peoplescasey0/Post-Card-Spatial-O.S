// The desktop app's side of a hosted share, against a live Worker over real HTTP.
//
// Miniflare's startServer puts the Worker on a port, so the publisher uploads a
// genuine Node stream over a genuine socket: the same path a laptop takes to
// Cloudflare, minus the edge.

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import { createSharePublisher } from "../share-publisher.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const SECRET = "test-publish-secret-0123456789";

let mf;
let baseUrl;
let db;
let workdir;

before(async () => {
  mf = new Miniflare({
    modules: true,
    scriptPath: path.join(root, "cloudflare", "share", "worker.mjs"),
    modulesRoot: root,
    compatibilityDate: "2026-01-01",
    d1Databases: ["DB"],
    r2Buckets: ["BUCKET"],
    bindings: { PUBLISH_SECRET: SECRET, HASH_MODE: "verify", HASH_LIMIT: "0" },
  });
  try {
    db = await mf.getD1Database("DB");
    const statements = (await readFile(path.join(root, "cloudflare", "share", "schema.sql"), "utf8"))
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await db.prepare(statement).run();
  } catch (error) {
    // A failed setup must not leave workerd running, or the test process hangs
    // instead of reporting the failure.
    await mf.dispose();
    throw error;
  }

  baseUrl = "http://share.test";
  workdir = await mkdtemp(path.join(tmpdir(), "postcard-publish-"));
});

after(async () => {
  await rm(workdir, { recursive: true, force: true });
  await mf?.dispose();
});

/** Drop a file into the shape the studio uses: paper-planes/<cardId>/<name>. */
async function spool(cardId, name, bytes) {
  const dir = path.join(workdir, "data", "paper-planes", cardId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
  return path.join(dir, name);
}

const publisher = (overrides = {}) =>
  createSharePublisher({
    baseUrl,
    secret: SECRET,
    paperPlanesDropDir: path.join(workdir, "data", "paper-planes"),
    fetchImpl: (url, init) => mf.dispatchFetch(url, init),
    ...overrides,
  });

describe("publishing a plane to the host", () => {
  test("the link is live on the host and readable by a stranger", async () => {
    const bytes = Buffer.from("a plane with a note attached\n");
    await spool("room-1", "note.txt", bytes);

    const issued = await publisher().issue({
      cardId: "room-1",
      fileName: "note.txt",
      fromCardId: "victoria",
      ttlSec: 3600,
    });

    assert.match(issued.url, /^http:\/\/.+\/s\/[A-Za-z0-9_-]+$/);
    assert.equal(issued.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(issued.sha256Verified, true, "the host hashed what it stored");
    assert.equal(issued.bytes, bytes.length);

    const page = await mf.dispatchFetch(issued.url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes("note.txt"));
    assert.ok(html.includes("from victoria"));

    const file = await mf.dispatchFetch(`${issued.url}/file`);
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
  });

  test("a multi-megabyte file survives the trip intact", async () => {
    const bytes = randomBytes(5 * 1024 * 1024 + 3);
    await spool("room-2", "big.bin", bytes);

    const issued = await publisher().issue({ cardId: "room-2", fileName: "big.bin", ttlSec: 600 });
    assert.equal(issued.sha256Verified, true);

    const res = await mf.dispatchFetch(`${issued.url}/file`, { headers: { range: "bytes=0-1023" } });
    assert.equal(res.status, 206);
    const head = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(head, bytes.subarray(0, 1024));

    const whole = Buffer.from(await (await mf.dispatchFetch(`${issued.url}/file`)).arrayBuffer());
    assert.equal(whole.length, bytes.length);
    assert.equal(createHash("sha256").update(whole).digest("hex"), issued.sha256);
  });

  test("the sender's token is never stored on the host", async () => {
    await spool("room-3", "secret.txt", Buffer.from("x"));
    const issued = await publisher().issue({ cardId: "room-3", fileName: "secret.txt", ttlSec: 600 });

    const { results } = await db.prepare("select * from share_link").all();
    assert.equal(JSON.stringify(results).includes(issued.token), false);
    assert.equal(JSON.stringify(results).includes(issued.url), false);
  });

  test("a file outside the card's spool is refused before anything is uploaded", async () => {
    await spool("room-4", "ok.txt", Buffer.from("ok"));
    const outside = path.join(workdir, "outside.txt");
    await writeFile(outside, "not yours");

    await assert.rejects(publisher().issue({ cardId: "room-4", fileName: "../outside.txt" }), /plain file name/);
    await assert.rejects(publisher().issue({ cardId: "room-4", fileName: "missing.txt" }), /not in this card's spool/);
  });

  test("a file over the host's limit is refused locally, naming the size", async () => {
    await spool("room-5", "large.bin", randomBytes(2048));
    await assert.rejects(
      publisher({ maxBytes: 1024 }).issue({ cardId: "room-5", fileName: "large.bin", ttlSec: 600 }),
      /2048 bytes; this host takes up to 1024/,
    );
  });

  test("a wrong secret fails loudly instead of producing a dead link", async () => {
    await spool("room-6", "note.txt", Buffer.from("hi"));
    await assert.rejects(
      publisher({ secret: "wrong-secret-0000000000" }).issue({ cardId: "room-6", fileName: "note.txt", ttlSec: 600 }),
      /Host refused the upload/,
    );
  });

  test("revoking through the app kills the hosted link", async () => {
    await spool("room-7", "note.txt", Buffer.from("bye"));
    const issued = await publisher().issue({ cardId: "room-7", fileName: "note.txt", ttlSec: 600 });

    const result = await publisher().revoke(issued.token);
    assert.deepEqual(result, { revoked: true });
    assert.equal((await mf.dispatchFetch(issued.url)).status, 404);
    assert.equal((await mf.dispatchFetch(`${issued.url}/file`)).status, 404);
  });

  test("ttl and download caps are rejected client-side before an upload", async () => {
    await spool("room-8", "note.txt", Buffer.from("hi"));
    await assert.rejects(publisher().issue({ cardId: "room-8", fileName: "note.txt", ttlSec: 5 }), /between 60 and 259200/);
    await assert.rejects(
      publisher().issue({ cardId: "room-8", fileName: "note.txt", ttlSec: 60, maxDownloads: 99_999 }),
      /between 0 and 10000/,
    );
  });

  test("a configuration without a real secret is refused at boot", () => {
    assert.throws(() => createSharePublisher({ baseUrl, secret: "short", paperPlanesDropDir: workdir }), /at least 16/);
    assert.throws(() => createSharePublisher({ baseUrl: "not-a-url", secret: SECRET, paperPlanesDropDir: workdir }), /http\(s\) origin/);
  });
});

