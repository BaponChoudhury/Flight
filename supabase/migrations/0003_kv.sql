-- Small key/value store for cached reference data (e.g. the world airport index).
create table if not exists kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table kv enable row level security;
