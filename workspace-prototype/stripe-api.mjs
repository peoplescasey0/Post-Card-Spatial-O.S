import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/**
 * Stripe billing endpoints for the Post Card Editions dialog.
 *
 *   GET  /api/stripe/config            -> which tiers can be purchased (no secrets)
 *   POST /api/stripe/checkout-session  -> Stripe Checkout URL (live) or a preview session
 *   POST /api/stripe/webhook           -> signature-verified Stripe events
 *
 * Secrets are read from the environment at request time and are never returned
 * to the browser. The browser can only ask for a tier + interval; price IDs are
 * always resolved on the server from STRIPE_PRICE_* variables.
 */

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const MAX_BODY_BYTES = 256 * 1024;
const SIGNATURE_TOLERANCE_SECONDS = 300;
const PAID_TIERS = ["pro", "enterprise"];

let activeTier = "community";

class StripeApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function isLoopback(address) {
  if (!address) return false;
  if (address.startsWith("::ffff:")) address = address.slice(7);
  if (isIP(address) === 4) return address.startsWith("127.");
  return address === "::1";
}

async function readRawBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new StripeApiError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new StripeApiError(400, "Request body must be valid JSON.");
  }
}

function secretKey() {
  return process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || "";
}

function priceFor(tier, interval) {
  const suffix = interval === "year" ? "ANNUAL" : "MONTHLY";
  const name = tier.toUpperCase();
  return (
    process.env[`STRIPE_PRICE_${name}_${suffix}`] ||
    (interval === "year" ? "" : process.env[`STRIPE_PRICE_${name}`]) ||
    ""
  );
}

function publicConfig() {
  const live = Boolean(secretKey()) || Boolean(licenseApiBase());
  const prices = {};
  for (const tier of PAID_TIERS) {
    prices[tier] = { month: Boolean(priceFor(tier, "month")), year: Boolean(priceFor(tier, "year")) };
  }
  return {
    ok: true,
    isLive: live,
    activeTier,
    prices,
    tiers: {
      community: true,
      pro: live && (prices.pro.month || prices.pro.year),
      enterprise: live && (prices.enterprise.month || prices.enterprise.year),
    },
  };
}

function requestOrigin(request) {
  const host = request.headers.host;
  if (!host || !/^[a-zA-Z0-9.\-:\[\]]+$/.test(host)) return "http://localhost:5173";
  return `http://${host}`;
}

async function createLiveSession({ tier, interval, quantity, origin }) {
  const price = priceFor(tier, interval);
  if (!price) return null;
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", price);
  form.set("line_items[0][quantity]", String(quantity));
  form.set("success_url", `${origin}/?checkout=success`);
  form.set("cancel_url", `${origin}/?checkout=cancelled`);
  form.set("metadata[tier]", tier);
  form.set("metadata[product]", "post-card-spatial-os");
  form.set("subscription_data[metadata][tier]", tier);
  const result = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey()}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const data = await result.json().catch(() => ({}));
  if (!result.ok) {
    throw new StripeApiError(502, `Stripe rejected the checkout request (${result.status}).`);
  }
  return { sessionId: data.id, url: data.url };
}

// Hosted licensing backend (Supabase Edge Functions). Customers' copies of the app
// talk to this instead of Stripe, so no Stripe secret ever ships to a customer.
// Set POSTCARD_LICENSE_API="" to disable (offline / tests).
const DEFAULT_LICENSE_API = "https://sjhirouqolzoourlvdmw.supabase.co/functions/v1";

function licenseApiBase() {
  const configured = process.env.POSTCARD_LICENSE_API;
  const base = configured === undefined ? DEFAULT_LICENSE_API : configured;
  return /^https:\/\/[A-Za-z0-9.-]+(\/[A-Za-z0-9._\/-]*)?$/.test(base) ? base.replace(/\/+$/, "") : "";
}

async function callLicenseApi(name, payload) {
  const base = licenseApiBase();
  if (!base) throw new StripeApiError(503, "The licensing service is not configured.");
  let result;
  try {
    result = await fetch(`${base}/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new StripeApiError(502, "Could not reach the licensing service. Check your internet connection.");
  }
  const data = await result.json().catch(() => ({}));
  return { status: result.status, data };
}

async function handleLicense(request, response) {
  if (!isLoopback(request.socket.remoteAddress)) {
    throw new StripeApiError(403, "License checks can only be made from this computer.");
  }
  if (!request.headers["content-type"]?.includes("application/json")) {
    throw new StripeApiError(415, "Expected an application/json request.");
  }
  const body = parseJson(await readRawBody(request));
  const payload = {};
  if (typeof body?.sessionId === "string") payload.sessionId = body.sessionId.slice(0, 256);
  else if (typeof body?.licenseKey === "string") payload.licenseKey = body.licenseKey.slice(0, 128);
  else throw new StripeApiError(400, "Provide sessionId or licenseKey.");
  const { status, data } = await callLicenseApi("license-check", payload);
  sendJson(response, status, data);
}

async function handleCheckout(request, response) {
  if (!isLoopback(request.socket.remoteAddress)) {
    throw new StripeApiError(403, "Checkout can only be started from this computer.");
  }
  if (!request.headers["content-type"]?.includes("application/json")) {
    throw new StripeApiError(415, "Expected an application/json request.");
  }
  const body = parseJson(await readRawBody(request));
  const tier = typeof body?.tier === "string" ? body.tier.toLowerCase() : "";
  const interval = body?.interval === "year" ? "year" : "month";
  const quantity = Number.isInteger(body?.quantity) ? Math.min(100, Math.max(1, body.quantity)) : 1;

  if (licenseApiBase() && PAID_TIERS.includes(tier)) {
    const { status, data } = await callLicenseApi("stripe-checkout", {
      tier,
      interval,
      quantity,
      returnUrl: requestOrigin(request),
    });
    if (status !== 200 || !data?.ok) {
      throw new StripeApiError(502, data?.error ?? "Checkout is unavailable right now.");
    }
    sendJson(response, 200, data);
    return;
  }

  if (secretKey() && PAID_TIERS.includes(tier)) {
    const live = await createLiveSession({ tier, interval, quantity, origin: requestOrigin(request) });
    if (live) {
      sendJson(response, 200, {
        ok: true,
        mode: "live",
        tier,
        interval,
        sessionId: live.sessionId,
        checkoutUrl: live.url,
        url: live.url,
      });
      return;
    }
  }

  const sessionId = `sim_test_${randomBytes(8).toString("hex")}`;
  sendJson(response, 200, {
    ok: true,
    mode: "simulated",
    tier,
    interval,
    sessionId,
    checkoutUrl: `/?checkout=simulated&session=${sessionId}`,
  });
}

function verifySignature(rawBody, header, secret) {
  if (typeof header !== "string") return false;
  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest();
  const signatures = header
    .split(",")
    .filter((part) => part.trim().startsWith("v1="))
    .map((part) => part.trim().slice(3));
  return signatures.some((candidate) => {
    const buffer = Buffer.from(candidate, "hex");
    return buffer.length === expected.length && timingSafeEqual(buffer, expected);
  });
}

async function handleWebhook(request, response) {
  const rawBody = await readRawBody(request);
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (webhookSecret) {
    if (!verifySignature(rawBody, request.headers["stripe-signature"], webhookSecret)) {
      throw new StripeApiError(400, "Invalid Stripe signature.");
    }
  } else if (secretKey()) {
    // A live key without a signing secret would let anyone forge upgrades.
    throw new StripeApiError(400, "STRIPE_WEBHOOK_SECRET must be set when a live Stripe key is configured.");
  }

  const event = parseJson(rawBody);
  const type = typeof event?.type === "string" ? event.type : "";
  let handled = false;

  if (type === "checkout.session.completed") {
    const tier = String(event?.data?.object?.metadata?.tier ?? "").toLowerCase();
    if (PAID_TIERS.includes(tier)) {
      activeTier = tier;
      handled = true;
    }
  } else if (type === "customer.subscription.deleted") {
    activeTier = "community";
    handled = true;
  }

  sendJson(response, 200, { received: true, type, handled, activeTier });
}

/** Returns true when the request was a Stripe route and has been answered. */
export async function handleStripeRequest(request, response) {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/api/stripe/")) return false;
  try {
    if (request.method === "GET" && url.pathname === "/api/stripe/config") {
      sendJson(response, 200, publicConfig());
    } else if (request.method === "POST" && url.pathname === "/api/stripe/checkout-session") {
      await handleCheckout(request, response);
    } else if (request.method === "POST" && url.pathname === "/api/stripe/license") {
      await handleLicense(request, response);
    } else if (request.method === "POST" && url.pathname === "/api/stripe/webhook") {
      await handleWebhook(request, response);
    } else {
      sendJson(response, 404, { error: "Unknown Stripe API endpoint." });
    }
  } catch (error) {
    const status = error instanceof StripeApiError ? error.status : 500;
    sendJson(response, status, {
      error: error instanceof StripeApiError ? error.message : "Unexpected billing error.",
    });
  }
  return true;
}

