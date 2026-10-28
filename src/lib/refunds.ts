// What a traveller can get back when a flight doesn't happen. Every figure here comes from a
// published source (listed in SOURCES and shown on the calculator page); where nobody publishes
// a number we say so instead of guessing.

/**
 * UK Air Passenger Duty, Band B (2,001–5,500 miles from London: India, Pakistan, Bangladesh and
 * Sri Lanka all fall here). Charged once per flight leaving the UK, only if you fly, so it's due
 * back when you don't. Reduced rate = the lowest class on the plane; standard = any other class.
 * Children under 16 in the lowest class and infants without their own seat pay none.
 */
const APD_BAND_B: { from: string; reduced: number; standard: number }[] = [
  { from: "2026-04-01", reduced: 102, standard: 244 },
  { from: "2027-04-01", reduced: 105.33, standard: 251.95 },
];

/** APD per passenger for a flight leaving the UK on `date` (yyyy-mm-dd). */
export function apdBandB(date: string, cabin: Cabin): number {
  const row = [...APD_BAND_B].reverse().find((r) => date >= r.from) ?? APD_BAND_B[0];
  return cabin === "economy" ? row.reduced : row.standard;
}

/** UK261 compensation for a flight over 3,500 km (every UK–South Asia flight), per passenger. */
export const UK261_LONG_HAUL_GBP = 520;

export type Cabin = "economy" | "premium";
export type Scenario = "i_cancel" | "missed" | "airline_cancelled";
export type TicketType = "refundable" | "non_refundable" | "unknown";

/** Who sold the ticket, and their own fee for handling a refund the traveller asks for. */
export interface Seller {
  id: string;
  name: string;
  /** Per passenger, GBP, for a cancellation the traveller asks for; null = not published. */
  cancelFeeGbp: number | null;
  /** Per passenger, GBP, for handling an airline's cancellation or schedule change; null = not published. */
  disruptionFeeGbp: number | null;
  note: string;
}

// US$45 / US$17 per passenger in Gotogate's and Mytrip's terms (same company), at about £0.79 per US$.
export const SELLERS: Seller[] = [
  { id: "airline", name: "The airline directly", cancelFeeGbp: 0, disruptionFeeGbp: 0, note: "No agent in between. The airline's own fare rules apply." },
  { id: "etraveli", name: "Mytrip / Gotogate / Flight Network", cancelFeeGbp: 36, disruptionFeeGbp: 13, note: "Their terms are reported to charge about US$45 per passenger for a cancellation you ask for, and about US$17 for handling an airline's change. Check the current figure in their terms." },
  { id: "kiwi", name: "Kiwi.com", cancelFeeGbp: null, disruptionFeeGbp: null, note: "Kiwi keeps its service fee on refunds and often refunds airline cancellations as Kiwi credit first. Ask for cash if you want it." },
  { id: "edreams", name: "eDreams / Opodo / GO Voyages", cancelFeeGbp: null, disruptionFeeGbp: null, note: "Committed (with Kiwi.com and Etraveli) to refund airline-cancelled flights within 14 days. Their fee for cancellations you ask for isn't published." },
  { id: "other", name: "Another travel agent", cancelFeeGbp: null, disruptionFeeGbp: null, note: "Most agents keep their booking fee and may charge to process a refund. Check their terms." },
];

/** Match an Aviasales seller name ("Mytrip", "Gotogate UK", "Kiwi.com") to our list. */
export function sellerOf(name: string | null | undefined): Seller | null {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/mytrip|gotogate|flight ?network|trip ?ninja|supersaver|travelstart/.test(n)) return SELLERS[1];
  if (n.includes("kiwi")) return SELLERS[2];
  if (/edreams|opodo|go ?voyages|travellink/.test(n)) return SELLERS[3];
  return SELLERS[4];
}

export interface RefundInput {
  scenario: Scenario;
  ticket: TicketType;
  pricePaidGbp: number; // whole booking
  /** Refund fee from the fare rules, whole booking (refundable tickets only). */
  refundFeeGbp?: number | null;
  /** "Taxes and charges" on the receipt other than APD, whole booking; fuel surcharges excluded. */
  otherTaxesGbp?: number | null;
  adults: number;
  children: number; // 2–15
  infants: number; // under 2, on a lap
  cabin: Cabin;
  /** Date of the first flight leaving the UK (APD is only charged on UK departures). */
  ukDepartureDate: string | null;
  sellerId: string;
  /** Airline-cancelled only: days' notice the airline gave. */
  noticeDays?: number | null;
  /** Airline-cancelled only: the flight left from the UK, or was on a UK/EU airline. */
  ukRulesApply?: boolean;
}

export interface RefundLine {
  label: string;
  gbp: number; // positive = money back, negative = deducted
  note?: string;
}

export interface RefundEstimate {
  lines: RefundLine[];
  total: number;
  /** Money not in the total but worth claiming (e.g. UK261 compensation). */
  extras: RefundLine[];
  /** Things we couldn't put a number on. */
  unknowns: string[];
  steps: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function estimateRefund(i: RefundInput): RefundEstimate {
  const seller = SELLERS.find((s) => s.id === i.sellerId) ?? SELLERS[4];
  const viaAgent = seller.id !== "airline";
  const pax = i.adults + i.children + i.infants;
  const lines: RefundLine[] = [];
  const extras: RefundLine[] = [];
  const unknowns: string[] = [];
  const steps: string[] = [];
  const contact = viaAgent ? seller.name.split(" / ")[0] : "the airline";

  // Charged per (paying) passenger whose refund the agent handles.
  const agentFee = (perPax: number | null, what: string, count = i.adults + i.children) => {
    if (!viaAgent || count === 0) return;
    if (perPax == null) unknowns.push(`${seller.name}'s fee for ${what} isn't published. ${seller.note}`);
    else if (perPax > 0) lines.push({ label: `${seller.name} service fee (${count} × £${perPax})`, gbp: -r2(perPax * count), note: seller.note });
  };

  if (i.scenario === "airline_cancelled") {
    lines.push({ label: "Full refund of the ticket", gbp: r2(i.pricePaidGbp), note: "UK and EU rules: if the airline cancels, you choose a full refund or a new flight. The airline must refund within 7 days." });
    agentFee(seller.disruptionFeeGbp, "handling an airline's cancellation");
    if (i.ukRulesApply !== false) {
      const notice = i.noticeDays ?? 0;
      if (notice < 14) {
        const each = UK261_LONG_HAUL_GBP;
        extras.push({
          label: `Compensation, up to £${each} per passenger`,
          gbp: each * (i.adults + i.children),
          note: "Owed when you're told less than 14 days before, unless the cause was extraordinary (e.g. bad weather). Halved if the replacement flight gets you there within 4 hours of the original. It's separate from the refund.",
        });
        steps.push("Claim compensation separately: our partner Compensair can handle it for you (their terms and fees apply).");
      } else unknowns.push("With 14 or more days' notice no compensation is due, but the refund still is.");
    } else unknowns.push("UK/EU rules cover flights leaving the UK on any airline, and flights into the UK on a UK or EU airline. Otherwise the airline's own policy applies.");
    steps.unshift(`Ask ${contact} for a refund to your card, not a voucher (you can refuse vouchers).`);
    if (viaAgent && seller.id === "edreams") steps.push("eDreams, Opodo, Kiwi.com and Etraveli (Mytrip, Gotogate) have committed to refund airline-cancelled flights within 14 days.");
    steps.push("If they won't pay, complain in writing, then escalate to the Civil Aviation Authority or the airline's ADR scheme.");
  } else if (i.ticket === "refundable") {
    const fee = i.refundFeeGbp ?? null;
    lines.push({ label: "Ticket price", gbp: r2(i.pricePaidGbp) });
    if (fee != null) lines.push({ label: "Airline refund fee (from the fare rules)", gbp: -r2(fee) });
    else unknowns.push("The refund fee wasn't stated: check the fare rules in your booking.");
    agentFee(seller.cancelFeeGbp, "processing a cancellation");
    steps.push(`Cancel through ${contact} before the flight leaves: a refundable ticket usually becomes non-refundable after departure (a no-show).`);
  } else {
    // Non-refundable (or unknown) ticket, cancelled by you or missed: the taxes you didn't use come back.
    const date = i.ukDepartureDate;
    const apdPax = date ? i.adults + (i.cabin === "economy" ? 0 : i.children) : 0;
    if (date) {
      const each = apdBandB(date, i.cabin);
      lines.push({
        label: `UK Air Passenger Duty (£${each} × ${apdPax})`,
        gbp: r2(each * apdPax),
        note: i.cabin === "economy" && i.children ? "Children under 16 in economy and lap infants pay no APD, so get none back." : "Only charged on flights leaving the UK.",
      });
    } else unknowns.push("No UK departure on this ticket, so there's no Air Passenger Duty to reclaim.");
    if (i.otherTaxesGbp) lines.push({ label: "Other unused airport taxes (from your receipt)", gbp: r2(i.otherTaxesGbp), note: "Airport and government charges for flights you didn't take. Fuel or carrier surcharges (YQ/YR) are usually kept." });
    else unknowns.push("Other airport taxes on your receipt (e.g. passenger service charges) are usually refundable too. Add them above for a fuller figure.");
    unknowns.push("Some airlines deduct a processing fee from tax refunds; how much varies by airline.");
    agentFee(seller.cancelFeeGbp, "processing a tax refund", i.otherTaxesGbp ? i.adults + i.children : apdPax);
    if (i.ticket === "unknown") unknowns.push("If your ticket turns out to be refundable, you could get much more back: check the fare rules.");
    steps.push(`Ask ${contact} specifically for "a refund of unused taxes, including Air Passenger Duty". It isn't automatic, and you may first be told the ticket is non-refundable.`);
    steps.push("Refunds go back to the card you paid with.");
    if (i.scenario === "missed") steps.push("Missed flights still qualify: APD is only due if you actually fly.");
  }

  const total = r2(Math.max(0, lines.reduce((s, l) => s + l.gbp, 0)));
  if (pax === 0) unknowns.push("Add at least one passenger.");
  return { lines, total, extras, unknowns, steps };
}

/** Where every figure comes from, shown on the calculator page. */
export const SOURCES: { label: string; url: string }[] = [
  { label: "GOV.UK: Air Passenger Duty rates (Band B, 2026–27 and 2027–28)", url: "https://www.gov.uk/guidance/rates-and-allowances-for-air-passenger-duty" },
  { label: "MoneySavingExpert: claim back APD on missed or cancelled flights", url: "https://www.moneysavingexpert.com/travel/missed-or-cancelled-a-flight-claim-air-passenger-duty-refund/" },
  { label: "UK261: refund within 7 days and compensation when an airline cancels", url: "https://www.airhelp.co.uk/ec261/flight-cancellation-refund/" },
  { label: "ECC Netherlands: eDreams, Etraveli and Kiwi.com refund cancelled flights within 14 days", url: "https://www.eccnederland.nl/en/news/edreams-etraveli-and-kiwicom-commit-refund-within-14-days-cancelled-flights" },
  { label: "Kiwi.com refund policy", url: "https://www.kiwi.com/en/pages/content/refunds" },
];
