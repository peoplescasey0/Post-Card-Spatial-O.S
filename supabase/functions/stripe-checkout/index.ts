import Stripe from "npm:stripe@23.1.0";
import { isPaidTier, json } from "../_shared/common.ts";

// Creates a Stripe Checkout session. The Stripe secret key lives only here, so
// customers' copies of the app never need it. Clients can only choose a tier,
// a billing interval and a quantity; price IDs are resolved server-side.

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);

function safeReturnBase(candidate: unknown): string {
  const fallback = Deno.env.get("CHECKOUT_RETURN_URL") ?? "http://localhost:5173/";
  if (typeof candidate !== "string") return fallback;
  try {
    const url = new URL(candidate);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol === "http:" && local) return `${url.origin}/`;
  } catch { /* fall through */ }
  return fallback;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const tier = typeof body.tier === "string" ? body.tier.toLowerCase() : "";
  if (!isPaidTier(tier)) return json({ error: "Unknown tier." }, 400);
  const interval = body.interval === "year" ? "year" : "month";
  const quantity = Number.isInteger(body.quantity)
    ? Math.min(100, Math.max(1, body.quantity as number))
    : 1;

  const priceKey = `STRIPE_PRICE_${tier.toUpperCase()}_${interval === "year" ? "ANNUAL" : "MONTHLY"}`;
  const price = Deno.env.get(priceKey);
  if (!price) return json({ error: "That plan is not available yet." }, 400);

  const base = safeReturnBase(body.returnUrl);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price, quantity }],
      // {CHECKOUT_SESSION_ID} is a Stripe template token and must stay unencoded.
      success_url: `${base}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}?checkout=cancelled`,
      allow_promotion_codes: true,
      metadata: { tier, product: "post-card-spatial-os" },
      subscription_data: { metadata: { tier, product: "post-card-spatial-os" } },
    });
    return json({
      ok: true,
      mode: "live",
      tier,
      interval,
      sessionId: session.id,
      checkoutUrl: session.url,
      url: session.url,
    });
  } catch (error) {
    console.error("checkout.sessions.create failed", error instanceof Error ? error.message : error);
    return json({ error: "Stripe could not start checkout." }, 502);
  }
});

