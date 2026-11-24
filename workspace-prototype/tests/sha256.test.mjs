import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";

import { createSha256, hashingStream } from "../cloudflare/share/sha256.mjs";

const nodeHash = (buf) => createHash("sha256").update(buf).digest("hex");

function hashInChunks(buf, sizes) {
  const hasher = createSha256();
  let offset = 0;
  let index = 0;
  while (offset < buf.length) {
    const size = sizes[index % sizes.length];
    hasher.write(buf.subarray(offset, offset + size));
    offset += size;
    index += 1;
  }
  return hasher.finish();
}

test("empty input matches node:crypto", () => {
  const hasher = createSha256();
  assert.equal(hasher.finish(), nodeHash(Buffer.alloc(0)));
});

test("padding boundaries match node:crypto", () => {
  // 55/56 is where the length fields stop fitting; 63/64 is the block edge.
  for (const size of [0, 1, 2, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
    const buf = randomBytes(size);
    assert.equal(hashInChunks(buf, [size || 1]), nodeHash(buf), `size ${size} in one write`);
    assert.equal(hashInChunks(buf, [1]), nodeHash(buf), `size ${size} byte at a time`);
    assert.equal(hashInChunks(buf, [7, 64, 3]), nodeHash(buf), `size ${size} in mixed chunks`);
  }
});

test("a large buffer hashed in uneven chunks matches node:crypto", () => {
  const buf = randomBytes(1024 * 1024 + 17);
  assert.equal(hashInChunks(buf, [65536, 1, 4095]), nodeHash(buf));
});

test("the transform stream hashes what passes through without changing it", async () => {
  const buf = randomBytes(300_000);
  const hasher = createSha256();
  const chunks = [buf.subarray(0, 100_000), buf.subarray(100_000, 100_007), buf.subarray(100_007)];
  const source = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  const out = source.pipeThrough(hashingStream(hasher));
  const received = new Uint8Array(await new Response(out).arrayBuffer());
  assert.equal(hasher.finish(), nodeHash(buf));
  assert.deepEqual(Buffer.from(received), buf);
});

test("finishing twice is refused rather than returning a wrong hash", () => {
  const hasher = createSha256();
  hasher.write(randomBytes(10));
  hasher.finish();
  assert.throws(() => hasher.finish(), /already finished/);
});
