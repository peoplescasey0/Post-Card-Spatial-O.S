import Stripe from "npm:stripe@23.1.0";
import { adminClient, isPaidTier, json } from "../_shared/common.ts";

// Stripe -> Supabase webhook. Public URL (JWT verification off) but every request
// must carry a valid Stripe signature. Events are applied exactly once.

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const KNOWN_STATUSES = ["active", "trialing", "past_due", "canceled", "unpaid", "incomplete"];

function mapStatus(status: string): string {
  if (KNOWN_STATUSES.includes(status)) return status;
  if (status === "incomplete_expired") return "canceled";
  if (status === "paused") return "past_due";
  return "unpaid";
}

// Newer Stripe API versions keep the period end on the subscription item.
function periodEnd(subscription: Stripe.Subscription): string | null {
  // deno-lint-ignore no-explicit-any
  const seconds = subscription.items?.data?.[0]?.current_period_end ?? (subscription as any).current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing Stripe signature." }, 400);

  // Raw text is required: re-serialised JSON would break the signature.
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!,
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    console.error("signature verification failed", error instanceof Error ? error.message : error);
    return json({ error: "Invalid Stripe signature." }, 400);
  }

  const db = adminClient();

  // Idempotency: first writer wins; retries of the same event are acknowledged.
  const marker = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (marker.error) {
    if (marker.error.code === "23505") return json({ received: true, duplicate: true });
    console.error("could not record event", marker.error.message);
    return json({ error: "Temporary error." }, 500);
  }

  let handled = false;
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const tier = session.metadata?.tier;
      const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
      if (session.mode === "subscription" && isPaidTier(tier) && paid) {
        const subscriptionId = idOf(session.subscription as string | { id: string } | null);
        let validUntil: string | null = null;
        if (subscriptionId) {
          validUntil = periodEnd(await stripe.subscriptions.retrieve(subscriptionId));
        }
        const { error } = await db.from("licenses").upsert({
          checkout_session_id: session.id,
          tier,
          status: "active",
          email: session.customer_details?.email ?? session.customer_email ?? null,
          stripe_customer_id: idOf(session.customer as string | { id: string } | null),
          stripe_subscription_id: subscriptionId,
          current_period_end: validUntil,
          updated_at: new Date().toISOString(),
        }, { onConflict: "checkout_session_id" });
        if (error) throw error;
        handled = true;
      }
    } else if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object as Stripe.Subscription;
      const { error } = await db.from("licenses").update({
        status: event.type === "customer.subscription.deleted" ? "canceled" : mapStatus(subscription.status),
        current_period_end: periodEnd(subscription),
        updated_at: new Date().toISOString(),
      }).eq("stripe_subscription_id", subscription.id);
      if (error) throw error;
      handled = true;
    }
  } catch (error) {
    console.error("event handling failed", event.type, error instanceof Error ? error.message : error);
    // Release the idempotency marker so Stripe's retry can reprocess this event.
    await db.from("stripe_events").delete().eq("id", event.id);
    return json({ error: "Temporary error." }, 500);
  }

  return json({ received: true, type: event.type, handled });
});

