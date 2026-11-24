// Paper plane mailbox — end-to-end demo.
//
// Two separate stores, one mailbox, no network:
//   ./run/cloud  <- the mailbox side (stands in for Postgres + Storage)
//   ./run/pc     <- the receiving PC's own disk
//
// What it proves, in order:
//   1. The sender writes once and is then gone.
//   2. Deleting the sender's card does not destroy undelivered mail.
//   3. The receiver converges later, without the sender being alive.
//   4. A client that dies mid-fetch strands nothing; the lease expires and it retries.
//   5. ACK is idempotent, and history survives.

import fs from "node:fs";
import path from "node:path";
import { createMailbox, createBlobStore, sha256 } from "./mailbox.mjs";

const run = path.join(import.meta.dirname, "run");
fs.rmSync(run, { recursive: true, force: true });
fs.mkdirSync(path.join(run, "pc"), { recursive: true });

let t = Date.now();
const clock = () => t;
const advance = (ms) => { t += ms; };

const blobs = createBlobStore(path.join(run, "cloud"));
const mailbox = createMailbox({ dbPath: path.join(run, "mailbox.sqlite"), blobs, clock });

const line = (s = "") => console.log(s);
const step = (n, s) => console.log(`\n[${n}] ${s}`);

line("=".repeat(66));
line(" paper plane mailbox - store and forward, no shared clock");
line("=".repeat(66));

// ---------------------------------------------------------------------------
step(1, "Sender posts three planes, then disappears");

const payments = Buffer.from(
  JSON.stringify({ note: "Q4 invoices", rows: Array.from({ length: 3 }, (_, i) => ({ id: i })) }),
);
const sent = [
  mailbox.send({ from: "card-A", to: "card-B", payload: payments }),
  mailbox.send({ from: "card-A", to: "card-B", payload: Buffer.from("build log\n".repeat(400)) }),
  mailbox.send({ from: "card-A", to: "card-B", payload: Buffer.alloc(1024 * 256, 7) }),
];

for (const p of sent) {
  console.log(`    sent ${p.id.slice(0, 8)}  ${String(p.bytes).padStart(7)} B  state=${p.state}`);
}
console.log("    sender is now gone. nothing is running on card-A.");

// ---------------------------------------------------------------------------
step(2, "Someone deletes the sender's card");

const deleted = mailbox.deleteCard("card-A");
console.log(`    card-A deleted. undelivered planes still present: ${deleted.planesKept}`);

// ---------------------------------------------------------------------------
step(3, "Receiver comes online later and pulls");

const batch = mailbox.pull({ to: "card-B", leaseSec: 300 });
console.log(`    claimed ${batch.length} planes (attempts now ${batch[0].attempts})`);

for (const p of batch) {
  const bytes = mailbox.fetch(p.id);                 // verify sha256 against the row
  const dest = path.join(run, "pc", `${p.id}.plane`);
  fs.writeFileSync(dest, bytes);
  const fd = fs.openSync(dest, "r+");
  fs.fsyncSync(fd);                                  // durable BEFORE ack
  fs.closeSync(fd);
  const ok = mailbox.ack({ planeId: p.id, recipientKeyId: "key-B", signature: "sig-B" });
  console.log(`    wrote ${p.id.slice(0, 8)}  ${String(bytes.length).padStart(7)} B  ack=${ok}`);
}

// ---------------------------------------------------------------------------
step(4, "A later plane meets a client that dies mid-fetch");

const later = mailbox.send({ from: "card-C", to: "card-B", payload: Buffer.from("a straggler") });
const doomed = mailbox.pull({ to: "card-B", leaseSec: 30 });
console.log(`    claimed ${doomed.length} (a client about to crash)`);
console.log("    ...crashed. no ACK, no cleanup, nothing left running.");
advance(31_000);
const rescued = mailbox.pull({ to: "card-B", leaseSec: 300 });
console.log(`    31s later: lease expired, reclaimed ${rescued.length}, attempts=${rescued[0].attempts}`);

// ---------------------------------------------------------------------------
step(5, "ACK after the write, and ACK twice by accident");

const first = rescued[0];
const recovered = mailbox.fetch(first.id);
const recoveredPath = path.join(run, "pc", `${first.id}.plane`);
fs.writeFileSync(recoveredPath, recovered);
const rfd = fs.openSync(recoveredPath, "r+");
fs.fsyncSync(rfd);                                   // durable first, then ACK
fs.closeSync(rfd);
const acked = mailbox.ack({ planeId: first.id, recipientKeyId: "key-B", signature: "sig-B" });
const again = mailbox.ack({ planeId: first.id, recipientKeyId: "key-B", signature: "sig-B" });
console.log(`    first ACK  -> ${acked}`);
console.log(`    second ACK -> ${again}   (idempotent: no duplicate receipt)`);
console.log(`    recovered plane: ${later.id.slice(0, 8)}`);

// ---------------------------------------------------------------------------
step(6, "What actually survived");

const history = mailbox.since({ to: "card-B" });
for (const h of history) {
  const onDisk = fs.existsSync(path.join(run, "pc", `${h.id}.plane`));
  console.log(`    seq=${String(h.seq).padStart(2)}  ${h.state.padEnd(9)} local=${onDisk ? "yes" : "no "}  ${h.bytes} B`);
}
console.log(`    stats: ${JSON.stringify(mailbox.stats())}`);
console.log(`    cloud store: ${path.join(run, "cloud")}`);
console.log(`    pc store:    ${path.join(run, "pc")}`);

line("");
line("=".repeat(66));
line(" sender gone -> card deleted -> bytes still arrived, and were verified.");
line("=".repeat(66));
