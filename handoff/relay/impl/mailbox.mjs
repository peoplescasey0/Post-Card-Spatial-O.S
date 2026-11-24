// Paper plane mailbox — reference implementation.
//
// The same shape as relay/002_mailbox.sql, running on SQLite so it works with no
// account, no network, and no install. Swapping to Postgres changes the adapter,
// not the protocol.
//
// Invariants this file is responsible for:
//   1. A pull claims atomically. Two clients never get the same row.
//   2. An expired lease makes a row eligible again. A dead client strands nothing.
//   3. ACK is idempotent, and must come AFTER the local write is durable.
//   4. Ordering is a monotonic sequence, never a timestamp.
//   5. A plane is keyed by plane id, so deleting a card cannot destroy it.

import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const now = () => Date.now();

const SCHEMA = `
create table if not exists planes (
  seq             integer primary key autoincrement,
  id              text    not null unique,
  from_card       text    not null,
  to_card         text    not null,
  bytes           integer not null,
  sha256          text    not null,
  object_path     text    not null,
  name            text,
  content_type    text,
  state           text    not null default 'held'
                  check (state in ('staged','held','leased','released','failed','expired','purged')),
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  lease_expires_at integer,
  created_at      integer not null,
  hold_expires_at  integer not null,
  released_at      integer,
  failed_reason   text
);

create index if not exists planes_mailbox on planes (to_card, state, seq);

create table if not exists receipts (
  plane_id         text primary key references planes (id) on delete cascade,
  received_at      integer not null,
  recipient_key_id text not null,
  signature        text not null,
  disposition      text not null check (disposition in ('taken','discarded'))
);

create table if not exists tokens (
  plane_id     text not null references planes (id) on delete cascade,
  token_sha256 text not null unique,
  method       text not null,
  expires_at   integer not null,
  consumed_at  integer
);
`;

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/**
 * A blob store that stands in for Supabase Storage. Same verbs, different drawer.
 * `dir` is the "cloud"; nothing here is the sender's own disk.
 */
export function createBlobStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    put(planeId, buf) {
      const rel = path.join(planeId.slice(0, 2), `${planeId}.bin`);
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      const tmp = `${abs}.part`;
      const fd = fs.openSync(tmp, "w");
      try {
        fs.writeSync(fd, buf);
        fs.fsyncSync(fd);          // durable before it is addressable
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, abs);      // atomic publish: no half-plane ever visible
      return rel;
    },
    get(objectPath) {
      return fs.readFileSync(path.join(dir, objectPath));
    },
    has(objectPath) {
      return fs.existsSync(path.join(dir, objectPath));
    },
    remove(objectPath) {
      const abs = path.join(dir, objectPath);
      if (fs.existsSync(abs)) fs.rmSync(abs);
    },
  };
}

export function createMailbox({ dbPath = ":memory:", blobs, clock = now } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec("pragma journal_mode = wal;");
  db.exec("pragma foreign_keys = on;");
  db.exec(SCHEMA);

  // Additive columns for databases created before they existed.
  for (const [col, type] of [["name", "text"], ["content_type", "text"]]) {
    try {
      db.exec(`alter table planes add column ${col} ${type}`);
    } catch {
      /* already present */
    }
  }

  const selectById = db.prepare("select * from planes where id = ?");
  const selectReceipt = db.prepare("select * from receipts where plane_id = ?");

  function row(planeId) {
    return selectById.get(planeId) ?? null;
  }

  /** Sender side. Bytes land in the blob store, the row becomes fetchable. */
  function send({ id = randomUUID(), from, to, bytes, sha256: digest, ttlSec = 72 * 3600, payload, name, contentType }) {
    if (!from || !to) throw new Error("from and to are required");
    if (!payload) throw new Error("payload is required");
    const digestOf = sha256(payload);
    if (digest && digest !== digestOf) throw new Error("sha256 does not match payload");

    const t = clock();
    const objectPath = blobs.put(id, payload);

    db.prepare(
      `insert into planes (id, from_card, to_card, bytes, sha256, object_path,
                           name, content_type, state, created_at, hold_expires_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, 'held', ?, ?)`,
    ).run(id, from, to, payload.length, digestOf, objectPath, name ?? null, contentType ?? null, t, t + ttlSec * 1000);

    return row(id);
  }

  /**
   * Claim up to `limit` rows for one recipient. One statement, so the claim is
   * atomic: no two callers can win the same row.
   */
  function pull({ to, limit = 20, leaseSec = 300 }) {
    if (limit < 1 || limit > 100) throw new Error("limit must be 1..100");
    if (leaseSec < 30 || leaseSec > 3600) throw new Error("leaseSec must be 30..3600");
    const t = clock();
    const expired = t;
    const claimed = db
      .prepare(
        `update planes
            set state = 'leased',
                lease_expires_at = ?,
                attempts = attempts + 1
          where id in (
                select id from planes
                 where to_card = ?
                   and (state = 'held'
                        or (state = 'leased' and lease_expires_at < ?))
                 order by seq
                 limit ?
          )
      returning *`,
      )
      .all(t + leaseSec * 1000, to, expired, limit);
    return claimed;
  }

  /** Read-only history sync, delivered rows included. */
  function since({ to, cursor = 0, limit = 100 }) {
    return db
      .prepare(
        `select * from planes
          where to_card = ? and seq > ?
          order by seq
          limit ?`,
      )
      .all(to, cursor, Math.min(Math.max(limit, 1), 500));
  }

  /**
   * Confirm delivery. Idempotent: returns false if it was already released.
   * Caller must have written and fsynced locally first — this function cannot
   * check that, and no retry repairs a violation.
   */
  function ack({ planeId, recipientKeyId, signature, disposition = "taken" }) {
    if (!["taken", "discarded"].includes(disposition)) throw new Error("bad disposition");
    if (!recipientKeyId) throw new Error("recipientKeyId is required");
    if (!signature) throw new Error("signature is required");
    if (!row(planeId)) return false;

    db.prepare(
      `insert into receipts (plane_id, received_at, recipient_key_id, signature, disposition)
       values (?, ?, ?, ?, ?)
       on conflict (plane_id) do nothing`,
    ).run(planeId, clock(), recipientKeyId, signature, disposition);

    const res = db
      .prepare(
        `update planes
            set state = 'released', released_at = ?, lease_expires_at = null
          where id = ? and state in ('held', 'leased')`,
      )
      .run(clock(), planeId);

    return Number(res.changes) > 0;
  }

  /** Hand a plane back. After max_attempts it goes to failed, not back to pending. */
  function nack({ planeId, reason = "unspecified" }) {
    const r = row(planeId);
    if (!r) return "missing";
    if (r.attempts >= r.max_attempts) {
      db.prepare(
        `update planes set state = 'failed', failed_reason = ?, lease_expires_at = null
          where id = ?`,
      ).run(reason, planeId);
      return "failed";
    }
    db.prepare(
      `update planes set state = 'held', failed_reason = ?, lease_expires_at = null
        where id = ?`,
    ).run(reason, planeId);
    return "requeued";
  }

  /** Fetch + verify + return bytes. A mismatch is a nack, never a silent pass. */
  function fetch(planeId) {
    const r = row(planeId);
    if (!r) throw new Error("no such plane");
    const buf = blobs.get(r.object_path);
    const actual = sha256(buf);
    if (actual !== r.sha256) {
      nack({ planeId, reason: "checksum_mismatch" });
      throw new Error(`checksum mismatch for ${planeId}`);
    }
    return buf;
  }

  function markExpired() {
    const t = clock();
    return db
      .prepare(
        `update planes set state = 'expired'
          where state in ('held','leased') and hold_expires_at < ?
      returning id`,
      )
      .all(t);
  }

  /** Bytes off disk, row kept. History is not the same thing as storage. */
  function purge() {
    const rows = db.prepare(`select id, object_path from planes where state = 'expired'`).all();
    for (const r of rows) {
      blobs.remove(r.object_path);
      db.prepare(`update planes set state = 'purged' where id = ?`).run(r.id);
    }
    return rows.map((r) => r.id);
  }

  function stats() {
    const byState = {};
    for (const r of db.prepare(`select state, count(*) n from planes group by state`).all()) {
      byState[r.state] = r.n;
    }
    return { byState, receipts: db.prepare(`select count(*) n from receipts`).get().n };
  }

  function receipt(planeId) {
    return selectReceipt.get(planeId) ?? null;
  }

  /** the sender deleting their own card. Must not touch the mailbox. */
  function deleteCard(cardId) {
    const before = db.prepare(`select count(*) n from planes where from_card = ? or to_card = ?`).get(cardId).n;
    db.prepare(`delete from tokens where plane_id in (select id from planes where to_card = ?)`).run(cardId);
    return { planesKept: before };
  }

  return { db, send, pull, since, ack, nack, fetch, markExpired, purge, stats, receipt, deleteCard, row };
}
