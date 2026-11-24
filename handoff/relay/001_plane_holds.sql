-- Post Card OS — plane relay: held cargo, capability tokens, receipts.
-- Contract: handoff/contracts/plane.v1.json (draft 1.2.0)
-- Target project: qjxahilkpljapyfwfhsc  (NOT the licensing project sjhirouqolzoourlvdmw)
--
-- Access model: service-role only, same shape as public.licenses. RLS is on with
-- no policies, so anon/authenticated can read and write nothing. The local studio
-- server (start-studio.mjs) holds the service key and proxies; the browser client
-- never sees it.
--
-- Bytes live in Storage, not here. This file is only the index, the tokens, and
-- the receipts — a few hundred bytes per plane.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- A hold is a staged cargo that outlives the card that sent it.
-- ---------------------------------------------------------------------------
create table public.plane_holds (
  id uuid primary key,                          -- the plane id from the tender
  tender jsonb not null,                        -- the whole ~2 KB tender, verbatim
  from_card text not null,                      -- routing only, never identity
  to_card text not null,                        -- routing only, never identity
  sender_key_id text not null,

  quota_class text not null default 'payload'
    check (quota_class in ('note', 'payload', 'guest')),

  bytes bigint not null check (bytes >= 0),
  chunks integer not null check (chunks >= 1),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  cipher text not null default 'aes-256-gcm',

  -- Supabase Storage coordinates. Path is opaque: {plane_id}/{random}.
  bucket text not null default 'plane-holds',
  object_path text not null,
  upload_complete boolean not null default false,

  state text not null default 'staged'
    check (state in ('staged', 'held', 'released', 'expired', 'purged')),

  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  hold_expires_at timestamptz not null,         -- created_at + ttlSec, max 72h
  released_at timestamptz,
  purged_at timestamptz,

  -- A hold may never outlive the tender that produced it. Enforced by trigger
  -- below, not a CHECK: the ceiling is measured from tender.createdAt, not from
  -- this row's created_at, so a plane staged late cannot buy extra time.
  -- Released/expired rows must say when.
  constraint released_has_time check (state <> 'released' or released_at is not null),
  constraint purged_has_time check (state <> 'purged' or purged_at is not null)
);

-- Ceiling is tender.createdAt + 72h, NOT created_at + 72h. A plane staged 68h
-- after it was sent would otherwise pass a naive check and sit for 140h.
create or replace function public.plane_holds_check_tender()
returns trigger
language plpgsql
as $$
declare
  tender_created timestamptz;
begin
  tender_created := (new.tender->>'createdAt')::timestamptz;
  if tender_created is null then
    raise exception 'tender.createdAt is required';
  end if;
  if new.hold_expires_at > tender_created + interval '72 hours' then
    raise exception 'hold_expires_at (%) exceeds tender.createdAt + 72h (%)',
      new.hold_expires_at, tender_created + interval '72 hours';
  end if;
  if new.hold_expires_at <= tender_created then
    raise exception 'hold_expires_at (%) is not after tender.createdAt (%)',
      new.hold_expires_at, tender_created;
  end if;
  return new;
end;
$$;

create trigger plane_holds_within_tender
  before insert or update of hold_expires_at, tender on public.plane_holds
  for each row execute function public.plane_holds_check_tender();

comment on function public.plane_holds_check_tender() is
  'A hold can never outlive its tender. Measured from tender.createdAt so late staging cannot extend the lease.';

comment on table public.plane_holds is
  'Staged plane cargo. Keyed by plane id, NOT card id, so deleting a card never destroys a held plane. Bytes live in Storage at object_path.';

comment on column public.plane_holds.bytes is
  'Logical size of the payload. Storage also charges for encryption overhead and any non-sparse allocation; do not treat this as the billed size.';

create index plane_holds_to_card_idx on public.plane_holds (to_card, state);
create index plane_holds_expiry_idx on public.plane_holds (hold_expires_at)
  where state in ('staged', 'held');

-- ---------------------------------------------------------------------------
-- Tokens. The raw value is NEVER stored: only its sha256. A leaked table dump
-- therefore cannot be replayed against the relay.
-- ---------------------------------------------------------------------------
create table public.plane_tokens (
  id uuid primary key default gen_random_uuid(),
  plane_id uuid not null references public.plane_holds (id) on delete cascade,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),

  -- Capability binding: a token is worthless if any of these change.
  method text not null check (method in ('clone', 'push', 'guest-fetch', 'pull-http', 'swarm')),
  recipient_key_id text not null,

  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,                      -- burned on first open, pass or fail
  burned_reason text,

  constraint token_max_72h check (expires_at <= issued_at + interval '72 hours')
);

comment on table public.plane_tokens is
  'One-time capability tokens, stored hashed. Consumed on first open even when the hash check fails, so a failed check is not a free retry oracle.';

comment on column public.plane_tokens.consumed_at is
  'Set on first use. A consumed token never validates again, regardless of outcome.';

create index plane_tokens_plane_idx on public.plane_tokens (plane_id);

-- Rotation: a long transfer asks for a fresh token; the old one is burned first.
-- Enforced by the relay, not by a unique index, because a plane may legitimately
-- have several issued-then-burned tokens over a slow transfer.

-- ---------------------------------------------------------------------------
-- Receipts. Signed by the receiver. The only proof a sender ever gets.
-- ---------------------------------------------------------------------------
create table public.plane_receipts (
  plane_id uuid primary key references public.plane_holds (id) on delete cascade,
  received_at timestamptz not null default now(),
  recipient_key_id text not null,
  signature text not null,
  disposition text not null default 'taken'
    check (disposition in ('taken', 'discarded')),
  note text
);

comment on table public.plane_receipts is
  'Receiver-signed proof of what happened to the cargo. Absence of a row means only "landed", never "read".';

-- ---------------------------------------------------------------------------
-- Expiry sweep.
--
-- Traps this avoids:
--   1. Deleting a row in storage.objects does NOT delete the object. The file
--      is orphaned and still billed. Purging must call the Storage API with the
--      service key, then delete the row here.
--   2. Marking expired in the UI is not expiry.
--
-- So this function only *marks*. A janitor (Edge Function on a schedule, or the
-- studio server's own interval timer) claims the marked rows, purges the objects
-- through the API, then sets state='purged'.
-- ---------------------------------------------------------------------------
create or replace function public.mark_expired_holds()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  update public.plane_holds
     set state = 'expired'
   where state in ('staged', 'held')
     and hold_expires_at < now()
  returning id;
$$;

comment on function public.mark_expired_holds() is
  'Marks passed-deadline holds as expired and returns their ids. Does not delete Storage objects; the janitor does that via the Storage API.';

revoke all on function public.mark_expired_holds() from anon, authenticated;

-- Optional: run the marker every 15 minutes. pg_cron must be enabled on the
-- project first (Database > Extensions). Skip this block if it is not.
--
-- select cron.schedule('mark-expired-holds', '*/15 * * * *',
--   $$select public.mark_expired_holds()$$);

-- ---------------------------------------------------------------------------
-- Lockdown.
-- ---------------------------------------------------------------------------
alter table public.plane_holds enable row level security;
alter table public.plane_tokens enable row level security;
alter table public.plane_receipts enable row level security;

revoke all on table public.plane_holds from anon, authenticated;
revoke all on table public.plane_tokens from anon, authenticated;
revoke all on table public.plane_receipts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage bucket. Private. Never public: a public bucket would make every
-- held plane world-readable by anyone who can guess a path.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values (
  'plane-holds',
  'plane-holds',
  false,
  52428800                                   -- 50 MiB: the Free-plan ceiling.
)
on conflict (id) do nothing;

comment on column storage.buckets.file_size_limit is
  'Free plan cannot exceed 50 MiB per file (global limit is also 50 MiB). Raise both on Pro; global limit goes to 500 GB.';

-- No storage.objects policies on purpose. All access is service-role, via the
-- relay. If a direct-from-client path is ever added, it needs its own policies
-- keyed to the recipient AND a bucket_id restriction — see the storage docs on
-- allow_only_operation(), which is what stops bucket listing.
