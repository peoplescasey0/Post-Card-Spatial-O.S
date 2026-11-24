import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createShareGateway } from "../share-gateway.mjs";

// An upstream that answers every request, so a proxy bug shows up as a wrong
// answer rather than a connection error.
async function harness() {
  const seen = [];
  const upstream = createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="plane.txt"',
      etag: 'W/"abc"',
    });
    res.end("bytes");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");

  const gateway = createShareGateway({
    upstream: `http://127.0.0.1:${upstream.address().port}`,
  });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  const base = `http://127.0.0.1:${gateway.address().port}`;

  return {
    seen,
    base,
    async close() {
      gateway.closeAllConnections?.();
      upstream.closeAllConnections?.();
      gateway.close();
      upstream.close();
      await Promise.all([once(gateway, "close"), once(upstream, "close")]);
    },
  };
}

test("forwards the share page and the bytes", async () => {
  const h = await harness();
  try {
    const page = await fetch(`${h.base}/s/abc123`);
    assert.equal(page.status, 200);

    const file = await fetch(`${h.base}/s/abc123/file`, { headers: { range: "bytes=0-3" } });
    assert.equal(file.status, 200);
    assert.equal(file.headers.get("etag"), 'W/"abc"');
    assert.equal(file.headers.get("content-disposition"), 'attachment; filename="plane.txt"');
    assert.equal(await file.text(), "bytes");
  } finally {
    await h.close();
  }
});

test("keeps every other route inside the house", async () => {
  const h = await harness();
  try {
    const blocked = [
      "/",
      "/index.html",
      "/api/guest/status",
      "/api/guest/paper-plane/inbox",
      "/api/guest/paper-plane/share",
      "/s/",
      "/s/abc123/",
      "/s/abc123/file/../share",
      "/s/abc123/extra",
    ];
    for (const path of blocked) {
      const response = await fetch(h.base + path);
      assert.equal(response.status, 404, `${path} should not reach the studio`);
      await response.text();
    }
    // A write through the share surface must not be forwarded either.
    const post = await fetch(`${h.base}/s/abc123/file`, { method: "POST", body: "x" });
    assert.equal(post.status, 404);
    await post.text();

    // One real share GET, to prove the studio is reachable at all and that the
    // blocked requests above added nothing to its inbox.
    await (await fetch(`${h.base}/s/abc123`)).text();
    assert.deepEqual(
      h.seen.map((entry) => `${entry.method} ${entry.url}`),
      ["GET /s/abc123"],
      "only share GETs may reach the studio",
    );
  } finally {
    await h.close();
  }
});

test("presents itself as https and drops the visitor identity", async () => {
  const h = await harness();
  try {
    await fetch(`${h.base}/s/abc123`, {
      headers: { "x-forwarded-for": "203.0.113.9", cookie: "session=secret" },
    });
    const hit = h.seen.at(-1);
    assert.equal(hit.headers["x-forwarded-proto"], "https");
    assert.equal(hit.headers["x-forwarded-for"], undefined);
    assert.equal(hit.headers.cookie, undefined);
  } finally {
    await h.close();
  }
});

test("a dead studio is a 502, not a hang", async () => {
  const gateway = createShareGateway({ upstream: "http://127.0.0.1:9" });
  gateway.listen(0, "127.0.0.1");
  await once(gateway, "listening");
  try {
    const response = await fetch(`http://127.0.0.1:${gateway.address().port}/s/abc123`);
    assert.equal(response.status, 502);
    await response.text();
  } finally {
    gateway.closeAllConnections?.();
    gateway.close();
    await once(gateway, "close");
  }
});
