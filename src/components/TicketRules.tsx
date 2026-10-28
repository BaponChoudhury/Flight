"use client";

import type { FlightLeg, RouteOption, SearchRequest } from "@/lib/types";
import { apdBandB, sellerOf, UK261_LONG_HAUL_GBP } from "@/lib/refunds";
import { card, Icon } from "./ui";

const gbp = (n: number) => `£${n.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

type Mark = "yes" | "no" | "unknown";
const MARK: Record<Mark, { icon: "check" | "x" | "info"; cls: string }> = {
  yes: { icon: "check", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  no: { icon: "x", cls: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" },
  unknown: { icon: "info", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" },
};

function Row({ mark, title, children }: { mark: Mark; title: string; children: React.ReactNode }) {
  const m = MARK[mark];
  return (
    <li className="flex gap-2.5">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${m.cls}`}>
        <Icon name={m.icon} className="h-3 w-3" strokeWidth={3} />
      </span>
      <div className="min-w-0">
        <p className="font-semibold">{title}</p>
        <p className="text-slate-600 dark:text-slate-400">{children}</p>
      </div>
    </li>
  );
}

/** Calculator link with this ticket's details filled in. */
function calcHref(leg: FlightLeg, req: SearchRequest, ukDate: string | null): string {
  const it = leg.itinerary;
  const t = it.fareTerms;
  const q = new URLSearchParams({
    price: String(Math.round(it.price.totalGbp)),
    ticket: t?.refundable === true ? "refundable" : t?.refundable === false ? "non_refundable" : "unknown",
    adults: String(req.adults),
    children: String(req.children),
    infants: String(req.infants ?? 0),
    seller: sellerOf(it.seller)?.id ?? "other",
  });
  if (t?.refundFeeGbp != null) q.set("fee", String(Math.round(t.refundFeeGbp)));
  if (ukDate) q.set("date", ukDate);
  return `/refund-calculator?${q}`;
}

/**
 * Refund, change and cancellation rules for each ticket in a trip, in plain words. Rules come
 * from the seller (Aviasales fares); Ignav doesn't share them, so those say "not stated".
 */
export function TicketRules({ o, req, tz }: { o: RouteOption; req: SearchRequest; tz: Record<string, string> }) {
  const tickets = [...o.legs, ...(o.back?.legs ?? [])].filter((l) => !l.bundled);
  const isUk = (code: string) => tz[code] === "Europe/London";
  return (
    <div className={`${card} h-fit p-4`}>
      <h3 className="flex items-center gap-2 text-sm font-bold">
        <Icon name="shield" className="h-4 w-4 text-brand-600" /> Ticket rules
      </h3>
      <div className="mt-3 space-y-4 text-sm">
        {tickets.map((leg, n) => {
          const it = leg.itinerary;
          const t = it.fareTerms;
          const seller = sellerOf(it.seller);
          const ukSeg = it.segments.find((s) => isUk(s.origin));
          const ukDate = ukSeg ? ukSeg.departUtc.slice(0, 10) : null;
          const intoUk = it.segments.some((s) => isUk(s.dest));
          const refund: Mark = t?.refundable === true ? "yes" : t?.refundable === false ? "no" : "unknown";
          const change: Mark = t?.changeable === true ? "yes" : t?.changeable === false ? "no" : "unknown";
          return (
            <div key={`${it.providerRef}-${n}`} className="space-y-2.5">
              {tickets.length > 1 && (
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Ticket {n + 1}: {it.origin} → {it.dest}
                </p>
              )}
              <ul className="space-y-2.5">
                <Row mark={refund} title="Refund before departure">
                  {refund === "yes"
                    ? t?.refundFeeGbp
                      ? `Yes, minus a fee of about ${gbp(t.refundFeeGbp)}.`
                      : "Yes. The fee isn't stated; check the fare rules."
                    : refund === "no"
                      ? "Non-refundable, but unused taxes still come back (below)."
                      : `${it.provider === "ignav" ? "This source doesn't share fare rules." : "The seller doesn't say."} Check the fare rules before paying.`}
                </Row>
                <Row mark={change} title="Date change">
                  {change === "yes" ? "Allowed. Expect the airline's change fee plus any fare difference." : change === "no" ? "Not allowed on this fare." : "Not stated. Check before paying."}
                </Row>
                <Row mark={ukDate ? "yes" : "unknown"} title="If you cancel or miss it">
                  {ukDate
                    ? `You can claim back UK Air Passenger Duty (${gbp(apdBandB(ukDate, "economy"))} per adult in economy) and other unused airport taxes, even on a non-refundable ticket.`
                    : "Unused airport taxes are usually refundable; ask the seller."}
                </Row>
                <Row mark={ukDate || intoUk ? "yes" : "unknown"} title="If the airline cancels">
                  {ukDate
                    ? `Full refund or a new flight, and up to ${gbp(UK261_LONG_HAUL_GBP)} compensation each with under 14 days' notice (UK rules).`
                    : intoUk
                      ? `UK rules (refund, up to ${gbp(UK261_LONG_HAUL_GBP)} compensation) apply only on a UK or EU airline; otherwise the airline's own policy.`
                      : "The airline's own policy applies; UK rules don't cover this flight."}
                </Row>
                {seller && seller.id !== "airline" && (
                  <Row mark="unknown" title={`Booking agent: ${it.seller}`}>
                    {seller.note}
                  </Row>
                )}
              </ul>
              <a href={calcHref(leg, req, ukDate)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline dark:text-brand-300">
                Work out what you&apos;d get back <Icon name="arrowRight" className="h-3 w-3" strokeWidth={2.4} />
              </a>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-slate-500">Rules come from the seller and can change. The fare rules shown when you pay are what count.</p>
    </div>
  );
}
