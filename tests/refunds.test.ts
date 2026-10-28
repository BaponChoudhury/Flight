import { describe, expect, it } from "vitest";
import { apdBandB, estimateRefund, sellerOf, type RefundInput } from "@/lib/refunds";

const base: RefundInput = {
  scenario: "i_cancel", ticket: "non_refundable", pricePaidGbp: 1200, adults: 2, children: 1, infants: 1,
  cabin: "economy", ukDepartureDate: "2026-12-12", sellerId: "airline",
};

describe("refund calculator", () => {
  it("uses the GOV.UK Band B APD rate for the flight date and cabin", () => {
    expect(apdBandB("2026-12-12", "economy")).toBe(102);
    expect(apdBandB("2026-12-12", "premium")).toBe(244);
    expect(apdBandB("2027-04-01", "economy")).toBe(105.33);
    expect(apdBandB("2027-06-01", "premium")).toBe(251.95);
  });

  it("gives back APD on a non-refundable ticket, none for children in economy or lap infants", () => {
    const e = estimateRefund(base);
    expect(e.lines[0]).toMatchObject({ gbp: 204 }); // 2 adults × £102
    expect(e.total).toBe(204);
    expect(estimateRefund({ ...base, cabin: "premium" }).total).toBe(732); // 3 × £244 (children pay in premium cabins)
    expect(estimateRefund({ ...base, otherTaxesGbp: 150 }).total).toBe(354);
    expect(estimateRefund({ ...base, ukDepartureDate: null }).total).toBe(0);
    // An agent's per-passenger fee only for passengers getting money back (the child gets no APD).
    expect(estimateRefund({ ...base, sellerId: "etraveli" }).total).toBe(204 - 2 * 36);
  });

  it("refundable ticket: price minus the fare's fee and the agent's published fee", () => {
    const e = estimateRefund({ ...base, ticket: "refundable", refundFeeGbp: 150, sellerId: "etraveli" });
    expect(e.total).toBe(1200 - 150 - 36 * 3);
    const unknownAgent = estimateRefund({ ...base, ticket: "refundable", refundFeeGbp: 150, sellerId: "kiwi" });
    expect(unknownAgent.total).toBe(1050);
    expect(unknownAgent.unknowns.join(" ")).toMatch(/Kiwi/);
  });

  it("airline cancels: full refund, plus £520 compensation each with under 14 days' notice", () => {
    const e = estimateRefund({ ...base, scenario: "airline_cancelled", noticeDays: 3 });
    expect(e.total).toBe(1200);
    expect(e.extras[0].gbp).toBe(520 * 3);
    expect(estimateRefund({ ...base, scenario: "airline_cancelled", noticeDays: 20 }).extras).toEqual([]);
    expect(estimateRefund({ ...base, scenario: "airline_cancelled", ukRulesApply: false }).extras).toEqual([]);
  });

  it("recognises booking agents by name", () => {
    expect(sellerOf("Mytrip")?.id).toBe("etraveli");
    expect(sellerOf("Gotogate UK")?.id).toBe("etraveli");
    expect(sellerOf("Kiwi.com")?.id).toBe("kiwi");
    expect(sellerOf("Opodo")?.id).toBe("edreams");
    expect(sellerOf("Trip.com")?.id).toBe("other");
    expect(sellerOf(null)).toBeNull();
  });
});

import { compassionateRange, policyFor, POLICIES } from "@/lib/compassionate";

describe("compassionate refunds", () => {
  it("has a sourced policy for each major airline on these routes", () => {
    for (const code of ["BA", "VS", "EK", "QR", "EY", "TK", "AI", "UL", "PK", "GF", "SV", "6E"]) expect(policyFor(code)?.sources.length).toBeGreaterThan(0);
    expect(new Set(POLICIES.map((p) => p.code)).size).toBe(POLICIES.length);
  });

  it("ranges from what you'd get anyway up to the full price, depending on the airline's rule", () => {
    expect(compassionateRange(policyFor("EY")!, "family_died", 900, 102, null)).toMatchObject({ outcome: "full", min: 900, max: 900 });
    expect(compassionateRange(policyFor("BA")!, "family_died", 900, 102, null)).toMatchObject({ outcome: "discretionary", min: 102, max: 900 });
    expect(compassionateRange(policyFor("GF")!, "family_died", 900, 102, null)).toMatchObject({ outcome: "validity", min: 102, max: 102 });
    expect(compassionateRange(policyFor("EK")!, "illness", 900, 102, 600)).toMatchObject({ outcome: "none", min: 600, max: 600 });
    // Virgin waives only its admin fee for illness: a non-refundable fare stays at taxes back.
    expect(compassionateRange(policyFor("VS")!, "illness", 900, 102, null)).toMatchObject({ outcome: "fees_waived", min: 102, max: 102 });
    expect(compassionateRange(policyFor("VS")!, "illness", 900, 102, 750)).toMatchObject({ max: 900 });
  });
});
