-- Post Card OS licensing: one row per paid Stripe subscription.
-- Written only by Edge Functions using the service role; never exposed to clients.

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  -- Unguessable key handed to the buyer's app (122 bits of randomness).
  license_key text not null unique
    default ('pcos-' || replace(gen_random_uuid()::text, '-', '')),
  tier text not null check (tier in ('pro', 'enterprise')),
  status text not null default 'active'
    check (status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete')),
  email text,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  checkout_session_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.licenses is
  'Paid Post Card OS licenses. Service-role only: RLS on with no policies.';

create index licenses_stripe_customer_id_idx on public.licenses (stripe_customer_id);

-- Processed Stripe event ids, so retried webhooks are applied exactly once.
create table public.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

comment on table public.stripe_events is
  'Idempotency log for Stripe webhooks. Service-role only.';

-- Lock both tables down: RLS enabled with NO policies means anon/authenticated
-- can read or write nothing; the service role bypasses RLS.
alter table public.licenses enable row level security;
alter table public.stripe_events enable row level security;

revoke all on table public.licenses from anon, authenticated;
revoke all on table public.stripe_events from anon, authenticated;

