import { adminClient, json } from "../_shared/common.ts";

// Lets the Post Card app (a) claim the license key for a finished checkout and
// (b) verify a stored license key. It never returns the buyer's email.
//   POST { sessionId: "cs_..." }     -> { ok, licenseKey, tier, active, ... } | 202 pending
//   POST { licenseKey: "pcos-..." }  -> { ok, tier, active, status, validUntil }

const GRACE_MS = 3 * 24 * 60 * 60 * 1000; // keep working through brief payment retries
const LIVE_STATUSES = ["active", "trialing", "past_due"];

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const db = adminClient();
  const columns = "license_key,tier,status,current_period_end";

  let query;
  let isClaim = false;
  if (typeof body.sessionId === "string") {
    if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(body.sessionId)) {
      return json({ error: "Invalid session id." }, 400);
    }
    isClaim = true;
    query = db.from("licenses").select(columns).eq("checkout_session_id", body.sessionId);
  } else if (typeof body.licenseKey === "string") {
    if (!/^pcos-[a-f0-9]{32}$/.test(body.licenseKey)) {
      return json({ ok: false, error: "Unknown license." }, 404);
    }
    query = db.from("licenses").select(columns).eq("license_key", body.licenseKey);
  } else {
    return json({ error: "Provide sessionId or licenseKey." }, 400);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("license lookup failed", error.message);
    return json({ error: "Temporary error." }, 500);
  }
  if (!data) {
    // The webhook can land a moment after the buyer returns; the app should retry.
    return isClaim ? json({ ok: true, pending: true }, 202) : json({ ok: false, error: "Unknown license." }, 404);
  }

  const validUntil = data.current_period_end as string | null;
  const active = LIVE_STATUSES.includes(data.status as string) &&
    (!validUntil || Date.now() < new Date(validUntil).getTime() + GRACE_MS);

  return json({
    ok: true,
    ...(isClaim ? { licenseKey: data.license_key } : {}),
    tier: data.tier,
    status: data.status,
    active,
    validUntil,
  });
});

