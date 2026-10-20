import type { NormalisedItinerary } from "@/lib/types";

let n = 0;
export function itin(p: {
  origin: string;
  dest: string;
  departUtc: string;
  arriveUtc: string;
  gbp: number;
  carrier?: string;
  checked?: number | null;
  verified?: boolean;
}): NormalisedItinerary {
  const durationMins = Math.round((Date.parse(p.arriveUtc) - Date.parse(p.departUtc)) / 60000);
  const carrier = p.carrier ?? "XX";
  return {
    provider: "ignav",
    providerRef: `ref-${++n}`,
    origin: p.origin,
    dest: p.dest,
    departUtc: p.departUtc,
    arriveUtc: p.arriveUtc,
    durationMins,
    carrier,
    carrierName: null,
    segments: [
      {
        carrier,
        carrierName: null,
        flightNumber: "1",
        origin: p.origin,
        dest: p.dest,
        departUtc: p.departUtc,
        arriveUtc: p.arriveUtc,
        departTz: null,
        arriveTz: null,
        durationMins,
        aircraft: null,
      },
    ],
    price: { amount: p.gbp, currency: "GBP", totalGbp: p.gbp, verified: p.verified ?? true, fxApprox: false },
    baggage: { checkedPieces: p.checked === undefined ? 1 : p.checked, carryOnPieces: 1 },
    selfTransfer: false,
    observedAt: "2026-10-20T09:00:00.000Z",
    fetchedAt: "2026-10-20T09:00:00.000Z",
    fromCache: false,
  };
}
