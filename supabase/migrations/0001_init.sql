-- UK → India flight finder: Phase 1 schema.
-- Run in Supabase: Dashboard → SQL Editor → paste this file → Run. Then run 0002_seed.sql.
-- The app talks to these tables server-side only, with the service-role key.

-- ---------- Config tables (editable at /admin) ----------

create table if not exists airports (
  iata text primary key,
  name text not null,
  city text not null,
  tz text not null,
  role text not null check (role in ('uk_origin', 'india_hub', 'destination')),
  enabled boolean not null default true
);

create table if not exists ground_access (
  origin_area text not null,
  airport text not null,
  mode text not null default 'train',
  cost_gbp numeric(8, 2) not null,
  per_person boolean not null default true,
  duration_mins integer not null,
  notes text not null default '',
  primary key (origin_area, airport, mode)
);

create table if not exists bag_fees (
  airline_code text not null,
  route_type text not null check (route_type in ('international', 'domestic')),
  bag_kg integer not null,
  fee_gbp numeric(8, 2) not null,
  notes text not null default '',
  primary key (airline_code, route_type, bag_kg)
);

create table if not exists airline_bag_defaults (
  airline_code text not null,
  route_type text not null check (route_type in ('international', 'domestic')),
  included_pieces integer,
  included_kg integer,
  excess_per_kg_gbp numeric(8, 2),
  notes text not null default '',
  primary key (airline_code, route_type)
);

create table if not exists airline_terminals (
  airport text not null,
  airline_code text not null,
  route_type text not null check (route_type in ('international', 'domestic')),
  terminal text not null,
  primary key (airport, airline_code, route_type)
);

create table if not exists terminal_rules (
  airport text not null,
  from_terminal text not null,
  to_terminal text not null,
  extra_mins integer not null default 45,
  primary key (airport, from_terminal, to_terminal)
);

create table if not exists hub_routes (
  hub text not null,
  dest text not null,
  has_service boolean not null,
  last_checked_at timestamptz not null default now(),
  primary key (hub, dest)
);

create table if not exists settings (
  key text primary key,
  value jsonb not null
);

-- ---------- Cache & usage ----------

create table if not exists fare_cache (
  cache_key text primary key,          -- sha256(provider | endpoint | request body)
  provider text not null,
  endpoint text not null,
  request jsonb not null,
  raw_response jsonb not null,         -- kept raw so mapping fixes never need a re-fetch
  fetched_at timestamptz not null,
  expires_at timestamptz not null
);
create index if not exists fare_cache_expires_idx on fare_cache (expires_at);

create table if not exists searches (
  id uuid primary key,
  user_id uuid,                        -- null until Phase 2 auth
  params jsonb not null,
  paid_calls integer not null,
  cache_hits integer not null,
  failed_calls integer not null,
  result_count integer not null,
  duration_ms integer not null,
  created_at timestamptz not null default now()
);

create table if not exists api_calls (
  id bigint generated always as identity primary key,
  search_id uuid references searches (id) on delete cascade,
  provider text not null,
  endpoint text not null,
  label text,
  cache_hit boolean not null,
  ok boolean not null,
  http_status integer,
  latency_ms integer,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists api_calls_created_idx on api_calls (created_at);

-- Lock everything down: no access with the public anon key. The server uses the
-- service-role key, which bypasses RLS.
alter table airports enable row level security;
alter table ground_access enable row level security;
alter table bag_fees enable row level security;
alter table airline_bag_defaults enable row level security;
alter table airline_terminals enable row level security;
alter table terminal_rules enable row level security;
alter table hub_routes enable row level security;
alter table settings enable row level security;
alter table fare_cache enable row level security;
alter table searches enable row level security;
alter table api_calls enable row level security;
