import type { BookingLink, CallLogEntry, NormalisedItinerary, ProviderId, Settings } from "@/lib/types";

export interface SearchFilters {
  adults: number;
  children: number;
  maxStops?: number | null;
  allowSelfTransfer: boolean;
  /** Hours (0–23) in the departure airport's local time, and arrival hours in the arrival airport's local time. */
  timeRange?: {
    earliestDepartHour?: number | null;
    latestDepartHour?: number | null;
    earliestArriveHour?: number | null;
    latestArriveHour?: number | null;
  } | null;
}

export interface ProviderCall {
  provider: ProviderId;
  endpoint: string;
  /** Request body; also the cache identity, so it must be deterministic. */
  body: unknown;
  label: string;
  /** Searches that legitimately return no results are cached too. */
  fetcher: () => Promise<unknown>;
}

export interface CallResult {
  raw: unknown;
  fetchedAt: string;
  fromCache: boolean;
}

/** Everything a provider needs from the current search: cached, counted calls plus settings. */
export interface CallContext {
  settings: Settings;
  call(req: ProviderCall): Promise<CallResult>;
  readonly log: CallLogEntry[];
}

export interface FlightProvider {
  id: ProviderId;
  searchOneWay(
    origin: string,
    dest: string,
    date: string,
    filters: SearchFilters,
    ctx: CallContext,
  ): Promise<NormalisedItinerary[]>;
  getBookingLinks(providerRef: string, filters: SearchFilters, ctx: CallContext): Promise<BookingLink[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
