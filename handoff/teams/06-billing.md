# BRIEFING — 06 billing and web

## Mission

Own money and the public face: Stripe, licensing, the landing page. Ship nothing
that can charge someone for a product a stranger cannot run.

## Start

**Wave 2, roughly +2 weeks.** Do not start early. The blocker is not code, it's
that nobody outside this machine has used the thing yet.

## Owns

- `workspace-prototype/stripe-api.mjs`
- `src/monetization/` (after extraction)
- landing page, pricing copy, license keys

## First three tasks (when unblocked)

1. Decide what is actually being sold. Three tiers exist in code; a stranger can't
   tell what they'd get. Write the one-sentence difference between each.
2. Kill simulated-mode ambiguity: tests accept "live or simulated" checkout. In
   production, simulated mode must be impossible, and the config endpoint must
   say which mode you're in.
3. Receipt and restore paths, end to end, with a real test key.

## Guardrails

- Nothing may imply a hosted service exists if it does not.
- Pricing copy cannot promise multi-machine transfer while v1 planes are same-host.
- Don't touch the guest API for billing hooks; ask 04.

## Definition of done

- Stripe webhook signature verified; no trust of client-sent tier.
- `npm test` still green; billing tests don't require network.
- A written refund/cancel path.

## Do not touch

`guest-api.mjs`, `kernel/`, `src/main.ts`, `handoff/contracts/`.

## Branch

`section-06-billing`
