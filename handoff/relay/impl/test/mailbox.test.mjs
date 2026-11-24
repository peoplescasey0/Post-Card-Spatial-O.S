import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMailbox, createBlobStore, sha256 } from "../mailbox.mjs";

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plane-mailbox-"));
  const blobs = createBlobStore(path.join(dir, "cloud"));
  let t = 1_700_000_000_000;
  const clock = () => t;
  const mb = createMailbox({ dbPath: path.join(dir, "mailbox.sqlite"), blobs, clock });
  return {
    mb, blobs, dir,
    advance: (ms) => { t += ms; },
  };
}

const plane = (mb, over = {}) =>
  mb.send({ from: "card-sender", to: "card-recv", payload: Buffer.from("hello mailbox"), ...over });

test("a plane lands, is pulled, fetched, and released on ACK", () => {
  const { mb } = fresh();
  const row = plane(mb);
  assert.equal(row.state, "held");

  const claimed = mb.pull({ to: "card-recv" });
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].state, "leased");
  assert.equal(claimed[0].attempts, 1);

  const bytes = mb.fetch(row.id);
  assert.equal(bytes.toString(), "hello mailbox");

  assert.equal(mb.ack({ planeId: row.id, recipientKeyId: "key-1", signature: "sig" }), true);
  assert.equal(mb.row(row.id).state, "released");
  assert.equal(mb.receipt(row.id).disposition, "taken");
});

test("ACK is idempotent", () => {
  const { mb } = fresh();
  const row = plane(mb);
  mb.pull({ to: "card-recv" });
  assert.equal(mb.ack({ planeId: row.id, recipientKeyId: "k", signature: "s" }), true);
  assert.equal(mb.ack({ planeId: row.id, recipientKeyId: "k", signature: "s" }), false);
  assert.equal(mb.stats().receipts, 1);
});

test("a dead client strands nothing: the lease expires and the row returns", () => {
  const { mb, advance } = fresh();
  const row = plane(mb);

  const first = mb.pull({ to: "card-recv", leaseSec: 30 });
  assert.equal(first.length, 1);

  // still leased, so a second pull gets nothing
  assert.equal(mb.pull({ to: "card-recv" }).length, 0);

  advance(31_000);
  const second = mb.pull({ to: "card-recv" });
  assert.equal(second.length, 1, "expired lease must make the row eligible again");
  assert.equal(second[0].id, row.id);
  assert.equal(second[0].attempts, 2);
});

test("two clients never win the same row", () => {
  const { mb } = fresh();
  for (let i = 0; i < 10; i++) plane(mb);
  const a = mb.pull({ to: "card-recv", limit: 5 });
  const b = mb.pull({ to: "card-recv", limit: 5 });
  const ids = new Set([...a, ...b].map((r) => r.id));
  assert.equal(a.length, 5);
  assert.equal(b.length, 5);
  assert.equal(ids.size, 10, "claims must be disjoint");
});

test("a mailbox is not readable by another recipient", () => {
  const { mb } = fresh();
  plane(mb);
  assert.equal(mb.pull({ to: "card-someone-else" }).length, 0);
  assert.equal(mb.since({ to: "card-someone-else" }).length, 0);
});

test("deleting the sender's card does not destroy undelivered mail", () => {
  const { mb } = fresh();
  const row = plane(mb);
  const result = mb.deleteCard("card-sender");
  assert.equal(result.planesKept, 1);
  assert.equal(mb.row(row.id).state, "held");
  assert.equal(mb.pull({ to: "card-recv" }).length, 1);
});

test("a corrupt payload is nacked, not silently accepted", () => {
  const { mb, blobs } = fresh();
  const row = plane(mb);
  fs.writeFileSync(path.join(blobs.dir, row.object_path), "tampered");

  assert.throws(() => mb.fetch(row.id), /checksum mismatch/);
  assert.equal(mb.row(row.id).state, "held", "back to pending, not delivered");
});

test("retries give up instead of looping forever", () => {
  const { mb } = fresh();
  const row = plane(mb);
  for (let i = 0; i < 5; i++) {
    mb.pull({ to: "card-recv" });
    mb.nack({ planeId: row.id, reason: "disk_full" });
  }
  assert.equal(mb.row(row.id).state, "failed");
  assert.equal(mb.pull({ to: "card-recv" }).length, 0);
});

test("history includes delivered planes, in sequence order", () => {
  const { mb } = fresh();
  const a = plane(mb);
  mb.pull({ to: "card-recv" });
  mb.ack({ planeId: a.id, recipientKeyId: "k", signature: "s" });
  const b = plane(mb);

  const history = mb.since({ to: "card-recv" });
  assert.deepEqual(history.map((r) => r.id), [a.id, b.id]);
  assert.ok(history[0].seq < history[1].seq);
});

test("expiry purges bytes and keeps the record", () => {
  const { mb, blobs, advance } = fresh();
  const row = plane(mb, { ttlSec: 60 });
  advance(61_000);

  assert.equal(mb.markExpired().length, 1);
  assert.equal(mb.row(row.id).state, "expired");
  assert.equal(blobs.has(row.object_path), true, "still on disk before purge");

  assert.deepEqual(mb.purge(), [row.id]);
  assert.equal(blobs.has(row.object_path), false);
  assert.equal(mb.row(row.id).state, "purged", "row survives so history stays readable");
});

test("the stored hash is of the transported bytes", () => {
  const { mb } = fresh();
  const payload = Buffer.from("some bytes");
  const row = plane(mb, { payload });
  assert.equal(row.sha256, sha256(payload));
});
