import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { createGuestApi } from "../guest-api.mjs";

let server;
let baseUrl;

// Never call the hosted licensing service from tests.
process.env.POSTCARD_LICENSE_API = "";

before(async () => {
  server = createServer(createGuestApi());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("GET /api/stripe/config returns catalog configuration and tier status", async () => {
  const response = await fetch(`${baseUrl}/api/stripe/config`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(typeof data.isLive, "boolean");
  assert.equal(typeof data.prices, "object");
  assert.equal(data.tiers.community, true);
  assert.equal(typeof data.tiers.pro, "boolean");
  assert.equal(typeof data.tiers.enterprise, "boolean");
});

test("POST /api/stripe/checkout-session creates live or simulated checkout session for pro monthly", async () => {
  const response = await fetch(`${baseUrl}/api/stripe/checkout-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier: "pro", interval: "month" }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.tier, "pro");
  assert.ok(data.sessionId, "Session ID should be generated");
  assert.ok(data.checkoutUrl || data.url, "Checkout URL should be generated");
  assert.ok(data.mode === "live" || data.mode === "simulated");
});

test("POST /api/stripe/checkout-session creates live or simulated checkout session for enterprise annual", async () => {
  const response = await fetch(`${baseUrl}/api/stripe/checkout-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier: "enterprise", interval: "year", quantity: 2 }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.tier, "enterprise");
  assert.ok(data.sessionId);
  assert.ok(data.checkoutUrl || data.url);
});

test("POST /api/stripe/checkout-session falls back to simulated mode when requested with custom tier", async () => {
  const response = await fetch(`${baseUrl}/api/stripe/checkout-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tier: "custom_demo", priceId: "nonexistent" }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "simulated");
  assert.match(data.sessionId, /^sim_test_/);
});

test("POST /api/stripe/webhook parses checkout.session.completed event and returns active tier", async () => {
  const mockPayload = {
    id: "evt_test_12345",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_mock",
        customer: "cus_mock_999",
        metadata: {
          tier: "enterprise",
          product: "post-card-spatial-os",
        },
      },
    },
  };

  const response = await fetch(`${baseUrl}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mockPayload),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.received, true);
  assert.equal(data.type, "checkout.session.completed");
  assert.equal(data.handled, true);
  assert.equal(data.activeTier, "enterprise");
});

test("POST /api/stripe/webhook handles customer.subscription.deleted event by resetting to community", async () => {
  const mockPayload = {
    id: "evt_test_deleted",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_mock_cancelled",
      },
    },
  };

  const response = await fetch(`${baseUrl}/api/stripe/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mockPayload),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.received, true);
  assert.equal(data.type, "customer.subscription.deleted");
  assert.equal(data.handled, true);
  assert.equal(data.activeTier, "community");
});
