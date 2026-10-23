-- Hidden foreign-market quotes and customer fare requests.
-- Quotes hold the seller, market and local price; only the GBP price is ever sent to users.

create table if not exists fare_quotes (
  id text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  market text not null,
  provider_name text not null,
  booking_url text not null,
  fare_name text,
  local_amount numeric(14, 2) not null,
  local_currency text not null,
  mid_rate numeric(14, 6) not null,
  applied_rate numeric(14, 6) not null,
  price_gbp numeric(10, 2) not null,
  uk_price_gbp numeric(10, 2),
  passengers jsonb not null,
  itinerary jsonb not null
);
create index if not exists fare_quotes_expires_idx on fare_quotes (expires_at);

create table if not exists fare_requests (
  id text primary key,
  quote_id text not null references fare_quotes (id),
  created_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'contacted', 'booked', 'cancelled')),
  contact jsonb not null,
  notes text
);

alter table fare_quotes enable row level security;
alter table fare_requests enable row level security;
