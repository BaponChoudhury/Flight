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
| `ADMIN_PASSWORD` | Admin | Unlocks hidden-market fare requests and config edits on `/admin`. Admin data stays locked without it. |
| `APP_PASSWORD` | Optional | Password-protects the whole app (any username). Recommended when deployed, since there are no accounts yet. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Phase 3 | Not used yet. |

### Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/migrations/0001_init.sql`, then `supabase/migrations/0002_seed.sql`.
3. From **Project Settings → API**, copy the Project URL into `SUPABASE_URL` and the `service_role` key into `SUPABASE_SERVICE_ROLE_KEY`.

All tables have row-level security enabled with no policies, so the public anon key can't read them. The server uses the service-role key.

## Search form

- **From**, in two tabs:
  - **From the UK:** any UK town or postcode. `/api/locate` looks it up with [postcodes.io](https://postcodes.io), which is free and needs no key. It then suggests the 2 nearest regional airports within 250km, plus **London (all airports)**. The list is in `src/lib/config/places.ts`. You can untick airports or add others. If the lookup fails, you pick airports by hand.
  - **Any airport:** search the worldwide OurAirports list and pick up to 5 departure airports, shown as removable tags. A typed 3-letter city code plus Enter (e.g. `PAR`, `NYC`) searches all that city's airports. Departure, "leave home" and "home" times use each airport's own timezone. Prices stay in GBP (UK market), and the train/coach/cab panel's Google Maps links start from the user's current location.
  - `LON` is sent to Ignav as one origin and returns flights from LHR, LGW, STN, LTN and so on in a single call.
  - The server needs network access to `api.postcodes.io`.
- **To:** any Indian airport, found as you type through `/api/airports`. It uses the free [OurAirports](https://github.com/davidmegginson/ourairports-data) list: about 4,000 airports with scheduled flights worldwide, 116 of them in India. The server downloads it, keeps a compact copy in Supabase (`kv` table, `0003_kv.sql`) and refreshes it every 30 days. Typing never calls Ignav, so it costs nothing. You can also type a 3-letter code.
- **Trip:** one-way or return. "Coming back on" is the day you leave the destination.
- **Passengers:** adults, children (2–11) and infants (under 2, on a lap; at most one per adult). Infants go to Ignav as `infants_on_lap`. They don't count towards train fares or checked bags.
- **Bags:** checked bags per person. No weight is asked. Domestic allowances below a standard 23kg bag get an "Excess baggage risk" badge, but no cost is added.
- **Change time:** hours allowed for switching from the international to the domestic flight on separate tickets (default 3).

## How a search works

1. **UK origins:** the airports picked on the form (up to 5).
2. **Stage 1** (in parallel):
   - **A. Through tickets:** UK airport → destination, protected connections only (`allow_self_transfer: false`).
     Self-transfer itineraries are allowed in this same call (no extra cost). Ignav's ready-made separate-ticket combinations are split where they enter India. They have to meet the same buffer rules there, and also at every change of airline earlier in the trip. They're shown as split tickets whose second flight is "included" in the first price.
   - **B. International legs:** UK airport → each Indian hub that isn't known to lack flights to the destination (`hub_routes`).
3. **Prune:**
   - Drop international legs costing more than `prune_factor` (1.5) × the cheapest through ticket.
   - Keep the cheapest `max_intl_per_group` (12) plus the 3 shortest and the 3 earliest-arriving per UK airport/hub pair. This costs no extra calls, because domestic searches are per hub and date.
4. **Stage 2:**
   - Search hub → destination (up to 1 stop, `domestic_max_stops`) only for hubs with surviving legs.
   - Only on the dates the connection window can reach: the arrival date and the day after.
   - Hubs with no flights are recorded in `hub_routes` and skipped for 30 days.
5. **Combine** each international leg with each domestic leg where:
   - buffer ≥ the "time to change from international to domestic flight" on the form (default 3h, 1–12h allowed), plus a terminal change if any (DEL T3→T1 and BOM T2→T1 add 45m);
   - buffer ≤ 14h, or ≤ 24h with "Allow an overnight stop", which adds a hotel estimate.
6. **Cost** = ground + all fares (bag-inclusive, from Ignav) + hotel. **Time** = leave home → final arrival. Leaving home is set by your airport arrival buffer (`uk_airport_arrival_mins`, default 3h) plus the ground travel time.
7. **Ranking** shows the cheapest and fastest options, plus the top 10 by "best value" (a price-vs-time slider). Options with an unknown bag price rank lower.

### Calls and caching

- Every Ignav response is cached in `fare_cache` for 2 hours (`cache_ttl_mins`). The cache key is a hash of the provider, endpoint and request.
- The cache is checked before every call. Each search reports paid calls, cache hits and failures, and stores them in `searches` and `api_calls`.
- **Worst case for a ±0 day search with nothing cached: 52 calls.** That's 4 through + 32 international (4 × 8 hubs) + 16 domestic (8 hubs × 2 days). After the first search, hubs with no service are skipped, and repeat searches within 2 hours cost 0 calls.
- ±1 day flexibility triples the date searches.
- Booking links are fetched only when you tap "Get booking links" (also cached).
- **Real test (Stafford → GAU, 10 Dec 2026, 2 adults):** 53 calls on the first search, then 0 on a repeat; about 45s when nothing was cached, mostly waiting on Ignav (1–6s per call).

> Dev note: some sandboxes route traffic through a proxy that Node's `fetch` ignores. If Supabase or Ignav calls fail with `fetch failed`, start the server with `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21). Vercel doesn't need this.

### Ignav data notes

The client is generated from `spec/ignav-openapi.json`. To regenerate: `npm run gen:ignav`.

- **Baggage:** Ignav returns a **number** of checked bags per itinerary, with no weight. Weight allowances (e.g. 15kg on Indian domestic flights) come from `airline_bag_defaults`; they drive the "Excess baggage risk" badge and an excess estimate.
- **Terminals:** Ignav doesn't return terminals. They come from `airline_terminals` and `terminal_rules`.
- **Currency:** prices are requested with `market: "GB"`. Any non-GBP price is converted with `fx_to_gbp` in settings and marked as converted.
- **Price per party or per person:** prices cover the whole party (confirmed: DEL→GAU is £67 for 1 adult and £133 for 2). The `price_is_party_total` setting controls this.
- **Through tickets:** with `allow_self_transfer: false`, Ignav returned nothing for UK → GAU. With it set to `true`, the same call also returned protected itineraries (e.g. KLM + IndiGo via AMS and BOM). So the through search uses `true` and tells the two kinds apart with `requires_self_transfer`.
- **Domestic coverage is incomplete:** e.g. Ignav has no direct CCU → GAU flights and few IndiGo flights. That's why domestic searches allow 1 stop by default.
- **Bags:** when you need checked bags, every search sends `min_checked_bags`. Ignav then returns only fares that **include** those bags, so the prices are bag-inclusive. We never add our own bag fees. Any fare where Ignav doesn't confirm the bags is marked "bag price unknown" and ranked lower. Without the filter, Indian domestic fares had no bag data and most international fares were hand-luggage-only. One exception: with the filter, Ignav also dropped protected through tickets it has no bag data for (e.g. IndiGo/KLM via AMS–BOM). So through tickets are searched twice, with and without the filter (+1 call per UK airport). Those found only without it show "bag price unknown".
- **Unconfirmed prices:** a fare with `price.status = "unverified"` gets a "Price not confirmed" badge.

## Return trips

- **International:** Ignav's return fares (`/api/fares/round-trip`) for UK ⇄ hub and UK ⇄ destination, one price for both directions. The return goes back to the same UK airport, or to any London airport when searching `LON`. These calls cost the same as one-way searches.
- **Domestic:** hub → destination on the way out (as before), and destination → hub on the return date, one extra call per hub.
- **Connection on the way home:** the domestic flight must land at least the change time (plus any terminal change) before the international flight leaves. It also has to be within the 14h maximum.
- **Costs:** ground travel counted both ways. The return fare shows on the outbound flight, and the international flight home is "included".
- **Time:** total = door-to-door out + door-to-door back. The way back adds `uk_arrival_exit_mins` (60) to get through the UK airport.
- **Typical call count:** 3 UK origins → 3 + 24 + ≤16 + ≤8 ≈ 50 calls. Real test: 49 calls, 270 options.

## Getting to the airport (train, coach or cab)

There's no free API for live UK train or coach prices, or for taxi quotes (Trainline and FlixBus offer APIs only to commercial partners). So you look them up and enter them:

- After a search, the **"Getting to the airport"** panel has three options for each UK airport:
  - **train**: fare per person and journey time;
  - **coach**: fare per person and journey time;
  - **cab**: price for the whole car and journey time.
- Each option has **check-price links**:
  - **Google Maps** (train/coach times, often with fares; and drive time for a cab) opens with your town and the airport filled in, using the [documented Maps URL format](https://developers.google.com/maps/documentation/urls/guide).
  - **National Rail**, **National Express** and **FlixBus** open their journey search page. They don't publish a link format, so nothing is pre-filled.
- Times can be typed as `80`, `1:20`, `2h10` or `1.5` (hours).
- **Use** picks the cheapest option for your group, or forces train, coach or cab. For example, choose cab for a very early flight when no trains are running.
- Totals, door-to-door times and the ranking update straight away, with no new Ignav calls. Each route card shows the alternative and the price difference.
- Your entries are saved in your browser, per home area. The first time, they're filled in from the `ground_access` defaults in Admin.

## Lower prices from other markets (hidden from users)

Ignav's `market` setting changes which sellers appear for the same flights, and sometimes their prices. For example, London → Delhi on EgyptAir was £723 from the only UK seller, and ≈ £612 from India-market sellers on the same day.

- **When it runs:** when someone taps **Get booking links**, the server fetches the UK links as usual. In parallel (+1 Ignav call) it looks up the same flights in the **destination country's market** (the origin's on the way home).
- **Conversion:** foreign prices are converted at the **mid-market rate minus `fx_margin_pct` (0.4%)**, rounded up to the penny. Rates come from open.er-api.com (free, mid-market, daily) and are cached for 6 hours. **If live rates can't be fetched, no foreign price is offered.**
- **When a price is offered:** only if it beats the cheapest UK price by at least `hidden_market_min_saving_gbp` (£5). The UK search price is used when UK links carry no price.
- **What the customer sees:** only "Lower price found: £X" and a **Request this fare** form (name, email, phone). The seller, market, local price and link are stored server-side in `fare_quotes` (valid for `quote_ttl_mins`, 30 min) and are never sent to the browser.
- **Admin:** requests appear under **Fare requests to book** on `/admin`, with the hidden details. Admin data needs **`ADMIN_PASSWORD`** (sent as `x-admin-key`), and is locked if that isn't set. Customers share `APP_PASSWORD`, so it can't protect admin data.
- **Setup:** run `supabase/migrations/0004_fare_quotes.sql` and set `ADMIN_PASSWORD`.
- **No payment is taken in this flow.** Your team confirms with the customer first. Taking money before a ticket is issued is regulated in the UK (ATOL), and airlines may restrict tickets bought through another country's market. Check both before scaling this up.

## Known limitations / later

**Origins outside the UK.** The **Any airport** tab lets users fly from anywhere. Still UK-specific:
- The town lookup in the **From the UK** tab, which uses postcodes.io (UK only).
- Prices are in GBP from the UK market.
- The rail and coach "check price" links are for UK operators.

## Admin

`/admin` edits every config table (ground travel, airports, bag weight allowances, terminals, hub routes) and the search settings. Seed values marked "placeholder" are estimates and should be checked.

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
