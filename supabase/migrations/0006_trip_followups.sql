-- Post-trip compensation follow-ups: travellers who opted in when booking get one email the
-- day after their trip. The email address is wiped once sent or unsubscribed.

create table if not exists trip_followups (
  id text primary key,
  created_at timestamptz not null default now(),
  email text,
  trip jsonb not null,
  send_after date not null,
  sent_at timestamptz,
  unsubscribed_at timestamptz,
  unsubscribe_token text not null unique,
  search_id text
);
create index if not exists trip_followups_due_idx on trip_followups (send_after) where sent_at is null and unsubscribed_at is null;

alter table trip_followups enable row level security;
