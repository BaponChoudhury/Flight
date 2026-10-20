# UK → India split-ticket flight finder

Finds the cheapest and fastest realistic door-to-door routes from the UK to smaller Indian cities (e.g. Guwahati, GAU). It compares airline through-tickets with self-made split tickets (UK → Indian hub, then hub → destination), applying connection buffers, terminal changes, baggage-inclusive pricing and ground travel costs.

Stack: Next.js (App Router, TypeScript) · Tailwind · Supabase · Ignav flight API. Deploys to Vercel.

**Status: Phase 1** (core search engine, personal tool, no accounts).

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in values
npm run dev                  # http://localhost:3000
```

### Environment variables

| Variable | Needed for | Notes |
|---|---|---|
| `IGNAV_API_KEY` | Searches | Server-side only. Billed per successful request. |
| `SUPABASE_URL` | Persistent cache/config | Optional in Phase 1. Without it, an in-memory store is used (cache and admin edits reset on restart). |
| `SUPABASE_ANON_KEY` | Phase 2 auth | Not used yet. |
| `SUPABASE_SERVICE_ROLE_KEY` | Persistent cache/config | Server-side only. Never expose to the browser. |
| `APP_PASSWORD` | Optional | Password-protects the whole app (any username). Recommended when deployed, since there are no accounts yet. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Phase 3 | Not used yet. |

### Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_seed.sql`.
3. From **Project Settings → API**, copy the Project URL into `SUPABASE_URL` and the `service_role` key into `SUPABASE_SERVICE_ROLE_KEY`.

All tables have row-level security enabled with no policies, so the public anon key can't read them. The server uses the service-role key.

## How a search works

1. **UK origins** (BHX, MAN, LHR, LGW) that have a `ground_access` row for your home area.
2. **Stage 1** (in parallel):
   - **A. Through tickets:** UK airport → destination, protected connections only (`allow_self_transfer: false`).
   - **B. International legs:** UK airport → each Indian hub that isn't known to lack flights to the destination (`hub_routes`).
3. **Prune:**
   - Drop international legs costing more than `prune_factor` (1.5) × the cheapest through ticket.
   - Keep the cheapest `max_intl_per_group` plus the 2 fastest per UK airport/hub pair.
4. **Stage 2:**
   - Search hub → destination (direct by default) only for hubs with surviving legs.
   - Only on the dates the connection window can reach: the arrival date and the day after.
   - Hubs with no flights are recorded in `hub_routes` and skipped for 30 days.
5. **Combine** each international leg with each domestic leg where:
   - buffer ≥ minimum (3h 30m by default, 3–6h on the form), plus a terminal change if any (DEL T3→T1 and BOM T2→T1 add 45m);
   - buffer ≤ 14h, or ≤ 24h with "Allow an overnight stop", which adds a hotel estimate.
6. **Cost** = ground + all fares + bag fees + likely excess baggage + hotel. **Time** = leave home → final arrival. Leaving home is set by your airport arrival buffer (`uk_airport_arrival_mins`, default 3h) plus the ground travel time.
7. **Ranking** shows the cheapest and fastest options, plus the top 10 by "best value" (a price-vs-time slider). Options with an unknown bag price rank lower.

### Calls and caching

- Every Ignav response is cached in `fare_cache` for 2 hours (`cache_ttl_mins`). The cache key is a hash of the provider, endpoint and request.
- The cache is checked before every call. Each search reports paid calls, cache hits and failures, and stores them in `searches` and `api_calls`.
- **Worst case for a ±0 day search with nothing cached: 52 calls.** That's 4 through + 32 international (4 × 8 hubs) + 16 domestic (8 hubs × 2 days). After the first search, hubs with no service are skipped, and repeat searches within 2 hours cost 0 calls.
- ±1 day flexibility triples the date searches.
- Booking links are fetched only when you tap "Get booking links" (also cached).

### Ignav data notes

The client is generated from `spec/ignav-openapi.json`. To regenerate: `npm run gen:ignav`.

- **Baggage:** Ignav returns a **number** of checked bags per itinerary, with no weight. Weight allowances (e.g. 15kg on Indian domestic flights) come from `airline_bag_defaults`; they drive the "Excess baggage risk" badge and an excess estimate.
- **Terminals:** Ignav doesn't return terminals. They come from `airline_terminals` and `terminal_rules`.
- **Currency:** prices are requested with `market: "GB"`. Any non-GBP price is converted with `fx_to_gbp` in settings and marked as converted.
- **Price per party or per person:** `price_is_party_total` (default `true`) assumes the fare covers the whole party. **Check this against your first real search.**
- **Unconfirmed prices:** a fare with `price.status = "unverified"` gets a "Price not confirmed" badge.

## Admin

`/admin` edits every config table (ground travel, airports, bag fees, allowances, terminals, hub routes) and the search settings. Seed values marked "placeholder" are estimates and should be checked.

## Development

```bash
npm test          # unit tests: buffers, timezones, costs, pruning, end-to-end search with a fake Ignav
npm run typecheck
npm run lint
npm run gen:seed  # regenerate supabase/migrations/0002_seed.sql from src/lib/config/defaults.ts
```

Code map:
- `src/lib/providers/`: the `FlightProvider` interface and the Ignav adapter. Duffel will plug in here.
- `src/lib/engine/`:
  - `search.ts`: orchestration
  - `rules.ts`: buffers, bags, costs, scoring
  - `prune.ts`: pruning
  - `time.ts`: timezones
  - `calls.ts`: cache, counting and concurrency
- `src/lib/store/`: Supabase or in-memory persistence.
- `src/app/api/`: `search`, `booking-links`, `config` routes.
