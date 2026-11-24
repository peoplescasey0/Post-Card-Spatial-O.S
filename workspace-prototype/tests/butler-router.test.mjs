import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { BUTLER_ROUTER_ACTIONS, BUTLER_ROUTER_TOPICS, createGuestApi } from "../guest-api.mjs";

async function loadButler() {
  const source = await readFile(new URL("../src/butler.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(js)}`);
}

async function withApp(fn) {
  const server = createServer(createGuestApi());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

/** Sets env vars for fn, then restores the previous values (undefined deletes). */
async function withEnv(vars, fn) {
  const previous = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Runs fn with a fake Ollama listening on POSTCARD_OLLAMA_URL. */
async function withOllama(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await withEnv(
      {
        POSTCARD_OLLAMA_URL: `http://127.0.0.1:${server.address().port}`,
        POSTCARD_OLLAMA_MODEL: "qwen3.5:0.8b",
      },
      fn,
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function postInterpret(baseUrl, body) {
  return fetch(`${baseUrl}/api/butler/interpret`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("butler router stays off until a model is configured", async () => {
  await withEnv({ POSTCARD_OLLAMA_MODEL: undefined }, () =>
    withApp(async (baseUrl) => {
      const response = await postInterpret(baseUrl, { prompt: "zoom in" });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { enabled: false, reason: "router-off" });
    }),
  );
});

test("butler router asks Ollama for schema-constrained JSON and returns the routing", async () => {
  let capturedRequest;
  const handler = (request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      capturedRequest = body;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        message: {
          role: "assistant",
          content: JSON.stringify({ action: "zoom", topic: "zoom", confidence: 0.92 }),
        },
      }));
    });
  };

  await withOllama(handler, () =>
    withApp(async (baseUrl) => {
      const response = await postInterpret(baseUrl, {
        prompt: "make the card fill the screen",
        context: { room: "Pixel Studio", zoomed: false },
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.enabled, true);
      assert.equal(payload.ok, true);
      assert.deepEqual(payload.reply, { action: "zoom", topic: "zoom", confidence: 0.92 });

      const sent = JSON.parse(capturedRequest);
      assert.equal(sent.model, "qwen3.5:0.8b");
      assert.equal(sent.stream, false);
      assert.equal(sent.options.temperature, 0);
      assert.equal(sent.format.type, "object");
      assert.deepEqual(sent.format.required, ["action", "topic", "confidence"]);
      assert.ok(sent.format.properties.action.enum.includes("new-instance"));
      assert.ok(sent.format.properties.topic.enum.includes("savepoints"));
      assert.match(sent.messages[0].content, /Reply with JSON only/);
      assert.match(sent.messages[1].content, /State: room Pixel Studio/);
      assert.match(sent.messages[1].content, /Request: make the card fill the screen/);
    }),
  );
});

test("butler router reports a malformed model reply instead of guessing", async () => {
  const handler = (request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: { role: "assistant", content: "not json at all" } }));
  };

  await withOllama(handler, () =>
    withApp(async (baseUrl) => {
      const payload = await (await postInterpret(baseUrl, { prompt: "hi" })).json();
      assert.equal(payload.enabled, true);
      assert.equal(payload.ok, false);
      assert.equal(payload.reason, "invalid-json");
    }),
  );
});

test("butler router reports Ollama failures so the client can fall back", async () => {
  const handler = (request, response) => {
    request.resume();
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "model not found" }));
  };

  await withOllama(handler, () =>
    withApp(async (baseUrl) => {
      const payload = await (await postInterpret(baseUrl, { prompt: "hi" })).json();
      assert.deepEqual(
        { enabled: payload.enabled, ok: payload.ok, reason: payload.reason },
        { enabled: true, ok: false, reason: "ollama-500" },
      );
    }),
  );
});

test("butler router reports an unreachable Ollama", async () => {
  const dead = createServer();
  await new Promise((resolve) => dead.listen(0, "127.0.0.1", resolve));
  const deadUrl = `http://127.0.0.1:${dead.address().port}`;
  await new Promise((resolve) => dead.close(resolve));

  await withEnv(
    { POSTCARD_OLLAMA_URL: deadUrl, POSTCARD_OLLAMA_MODEL: "qwen3.5:0.8b" },
    () =>
      withApp(async (baseUrl) => {
        const payload = await (await postInterpret(baseUrl, { prompt: "hi" })).json();
        assert.equal(payload.enabled, true);
        assert.equal(payload.ok, false);
        assert.equal(payload.reason, "unreachable");
      }),
  );
});

const base = { idleSeconds: 0, guestRunning: false, serviceUnavailable: false, displayOpen: false };

test("client routing sends state and trusts only a valid reply", async () => {
  const { requestButlerRouting } = await loadButler();
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, init };
    return {
      ok: true,
      json: async () => ({
        enabled: true,
        ok: true,
        reply: { action: "next-room", topic: "rooms", confidence: 0.8 },
      }),
    };
  };

  const result = await requestButlerRouting(
    "change the room",
    { ...base, cardName: "Fedora · Workstation", facetLabel: "03 · SECURITY", roomName: "Pixel Studio" },
    { fetchImpl },
  );

  assert.deepEqual(result, { action: "next-room", topic: "rooms" });
  assert.equal(sent.url, "/api/butler/interpret");
  const body = JSON.parse(sent.init.body);
  assert.equal(body.prompt, "change the room");
  assert.equal(body.context.room, "Pixel Studio");
  assert.equal(body.context.facet, "03 · SECURITY");
});

test("client routing falls back on off, failed, thrown, and invalid replies", async () => {
  const { requestButlerRouting } = await loadButler();
  const off = async () => ({ ok: true, json: async () => ({ enabled: false, reason: "router-off" }) });
  assert.equal(await requestButlerRouting("hi", base, { fetchImpl: off }), undefined);

  const failed = async () => ({ ok: false, json: async () => ({}) });
  assert.equal(await requestButlerRouting("hi", base, { fetchImpl: failed }), undefined);

  const thrown = async () => { throw new Error("offline"); };
  assert.equal(await requestButlerRouting("hi", base, { fetchImpl: thrown }), undefined);

  const invented = async () => ({
    ok: true,
    json: async () => ({ enabled: true, ok: true, reply: { action: "nope", topic: "none", confidence: 1 } }),
  });
  assert.equal(await requestButlerRouting("hi", base, { fetchImpl: invented }), undefined);
});

test("the router contract matches the butler's actions and topics", async () => {
  const { BUTLER_ACTION_IDS, BUTLER_TOPIC_IDS } = await loadButler();
  assert.deepEqual([...BUTLER_ROUTER_ACTIONS], [...BUTLER_ACTION_IDS]);
  assert.deepEqual([...BUTLER_ROUTER_TOPICS], [...BUTLER_TOPIC_IDS]);
});

test("model replies are only trusted when they name a real action or topic", async () => {
  const { interpretButlerRouterReply } = await loadButler();

  assert.deepEqual(
    interpretButlerRouterReply({ action: "zoom", topic: "zoom", confidence: 0.9 }),
    { action: "zoom", topic: "zoom" },
  );
  assert.equal(
    interpretButlerRouterReply({ action: "zoom", topic: "none", confidence: 0.9 })?.topic,
    undefined,
  );
  assert.deepEqual(
    interpretButlerRouterReply({ action: "none", topic: "savepoints", confidence: 0.8 }),
    { action: undefined, topic: "savepoints" },
  );
  assert.equal(
    interpretButlerRouterReply({ action: "self-destruct", topic: "none", confidence: 0.99 }),
    undefined,
  );
  assert.equal(
    interpretButlerRouterReply({ action: "zoom", topic: "zoom", confidence: 0.1 }),
    undefined,
  );
  assert.equal(interpretButlerRouterReply(null), undefined);
  assert.equal(interpretButlerRouterReply("zoom"), undefined);
});
