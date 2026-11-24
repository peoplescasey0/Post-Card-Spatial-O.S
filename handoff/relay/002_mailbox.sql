-- Post Card OS — store-and-forward mailbox over the plane relay.
-- Contract: handoff/contracts/plane.v1.json (draft 1.2.0), see x-store-and-forward
-- Applies after 001_plane_holds.sql.
--
-- Model: the database is the mailbox. A PC is a client that pulls, writes locally,
-- fsyncs, and only then ACKs. Nothing is deleted on delivery.
--
-- The one rule that keeps this correct: ACK AFTER the local write is durable, never
-- before. ACK-then-crash loses the message forever. Write-then-ACK at worst delivers
-- it twice, and the receiver dedupes on plane id.

-- ---------------------------------------------------------------------------
-- Ordering cursor. A bigserial, not a timestamp: timestamps collide, jump on clock
-- changes, and cannot order two rows written in the same millisecond.
-- ---------------------------------------------------------------------------
create sequence if not exists public.plane_holds_seq;

alter table public.plane_holds
  add column if not exists seq bigint not null default nextval('public.plane_holds_seq'),
  add column if not exists attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 5,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists failed_reason text;

alter sequence public.plane_holds_seq owned by public.plane_holds.seq;

-- Widen the state machine. 'held' is the pending state; 'leased' means a client
-- has claimed it and is fetching. 'released' is delivered-and-ACKed.
alter table public.plane_holds drop constraint if exists plane_holds_state_check;
alter table public.plane_holds
  add constraint plane_holds_state_check check (
    state in ('staged', 'held', 'leased', 'released', 'failed', 'expired', 'purged')
  );

comment on column public.plane_holds.state is
  'staged = upload in flight. held = pending, fetchable. leased = claimed by a client, lease running. released = receiver ACKed; bytes may still be retained for history. failed = retries exhausted. expired = past deadline. purged = bytes gone.';

create index if not exists plane_holds_mailbox_idx
  on public.plane_holds (to_card, state, seq);

create index if not exists plane_holds_cursor_idx
  on public.plane_holds (to_card, seq);

-- ---------------------------------------------------------------------------
-- Pull. Atomically claims up to p_limit rows for one recipient and starts their
-- lease. SKIP LOCKED means two clients pulling at the same time cannot claim the
-- same row — no double fetch, no need for the client to coordinate.
--
-- An expired lease makes a row eligible again, so a client that dies mid-fetch
-- does not strand the message. That is the whole recovery mechanism.
-- ---------------------------------------------------------------------------
create or replace function public.mailbox_pull(
  p_to_card text,
  p_limit integer default 20,
  p_lease_seconds integer default 300
)
returns setof public.plane_holds
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'p_lease_seconds must be between 30 and 3600';
  end if;

  return query
  with claimed as (
    select c.id
      from public.plane_holds c
     where c.to_card = p_to_card
       and (
         c.state = 'held'
         or (c.state = 'leased' and c.lease_expires_at < now())
       )
     order by c.seq
     limit p_limit
     for update skip locked
  )
  update public.plane_holds h
     set state = 'leased',
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         attempts = h.attempts + 1
   where h.id in (select id from claimed)
  returning h.*;
end;
$$;

comment on function public.mailbox_pull(text, integer, integer) is
  'Claims up to p_limit pending rows for one recipient with a visibility lease. Expired leases become eligible again, which is how a crashed client recovers.';

-- ---------------------------------------------------------------------------
-- History sync. Everything after a cursor, delivered included, so a fresh install
-- can rebuild its local view. Read-only: no leasing, no state change.
-- ---------------------------------------------------------------------------
create or replace function public.mailbox_since(
  p_to_card text,
  p_cursor bigint default 0,
  p_limit integer default 100
)
returns setof public.plane_holds
language sql
security definer
set search_path = public
as $$
  select *
    from public.plane_holds
   where to_card = p_to_card
     and seq > p_cursor
   order by seq
   limit least(greatest(p_limit, 1), 500);
$$;

-- ---------------------------------------------------------------------------
-- ACK. Idempotent: ACKing twice returns false the second time and changes nothing.
-- Records the receiver's signature as the receipt, then releases the row.
-- ---------------------------------------------------------------------------
create or replace function public.mailbox_ack(
  p_plane_id uuid,
  p_recipient_key_id text,
  p_signature text,
  p_disposition text default 'taken'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer;
begin
  if p_disposition not in ('taken', 'discarded') then
    raise exception 'disposition must be taken or discarded';
  end if;

  insert into public.plane_receipts (plane_id, recipient_key_id, signature, disposition)
  values (p_plane_id, p_recipient_key_id, p_signature, p_disposition)
  on conflict (plane_id) do nothing;

  update public.plane_holds
     set state = 'released',
         released_at = now(),
         lease_expires_at = null
   where id = p_plane_id
     and state in ('held', 'leased');

  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

comment on function public.mailbox_ack(uuid, text, text, text) is
  'Confirms delivery. Must be called only after the receiver has written locally and fsynced. Idempotent.';

-- ---------------------------------------------------------------------------
-- NACK. Give the row back without burning it, unless retries are exhausted.
-- ---------------------------------------------------------------------------
create or replace function public.mailbox_nack(
  p_plane_id uuid,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.plane_holds;
begin
  select * into h from public.plane_holds where id = p_plane_id for update;
  if not found then
    return 'missing';
  end if;

  if h.attempts >= h.max_attempts then
    update public.plane_holds
       set state = 'failed', failed_reason = p_reason, lease_expires_at = null
     where id = p_plane_id;
    return 'failed';
  end if;

  update public.plane_holds
     set state = 'held', failed_reason = p_reason, lease_expires_at = null
   where id = p_plane_id;
  return 'requeued';
end;
$$;

revoke all on function public.mailbox_pull(text, integer, integer) from anon, authenticated;
revoke all on function public.mailbox_since(text, bigint, integer) from anon, authenticated;
revoke all on function public.mailbox_ack(uuid, text, text, text) from anon, authenticated;
revoke all on function public.mailbox_nack(uuid, text) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention. Delivered rows keep their metadata (history stays readable) but the
-- cargo bytes get purged after a window. On the free plan, 1 GB of storage is the
-- real constraint, so "never delete" is a wish, not a policy.
-- ---------------------------------------------------------------------------
create or replace function public.mark_purgeable_holds(p_keep_days integer default 7)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  update public.plane_holds
     set state = 'expired'
   where state = 'released'
     and released_at < now() - make_interval(days => greatest(p_keep_days, 0))
  returning id;
$$;

revoke all on function public.mark_purgeable_holds(integer) from anon, authenticated;
