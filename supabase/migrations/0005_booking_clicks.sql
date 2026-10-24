-- Aviasales booking links handed to users, each tagged with its own Travelpayouts SubID.
-- Match a booking in Travelpayouts (Statistics → Aviasales → Bookings → SubID) to the trip here.

create table if not exists booking_clicks (
  sub_id text primary key,
  created_at timestamptz not null default now(),
  provider text not null,
  seller text,
  search_id text,
  origin text,
  dest text,
  depart_date text,
  return_date text,
  flights text,
  price_gbp numeric(10, 2),
  passengers jsonb not null
);
create index if not exists booking_clicks_created_idx on booking_clicks (created_at desc);

alter table booking_clicks enable row level security;
