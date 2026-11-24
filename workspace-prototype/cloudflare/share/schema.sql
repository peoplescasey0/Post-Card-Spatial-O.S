-- D1 schema for the pooled share host.
--
-- There is no token column, on purpose. `token_sha256` is the primary key, so a
-- dump of this table is a list of link ids that cannot be turned back into URLs.
-- The R2 key is `s/<token_sha256>` for the same reason: object names show up in
-- dashboards, logs and support tickets.

create table if not exists share_link (
  token_sha256      text    primary key,
  file_name         text    not null,
  from_card         text    not null,
  bytes             integer not null,
  sha256            text    not null,
  content_type      text    not null,
  created_at        integer not null,
  expires_at        integer not null,
  downloads         integer not null default 0,
  max_downloads     integer not null default 0,
  revoked_at        integer,
  last_download_at  integer
);

-- The hourly sweep and every read both hit one of these.
create index if not exists share_link_expires on share_link (expires_at);
create index if not exists share_link_live
  on share_link (expires_at)
  where revoked_at is null;
