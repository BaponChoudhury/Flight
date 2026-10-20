import { describe, expect, it } from "vitest";
import { domesticDatesNeeded, hubsToSearch, pruneInternational } from "@/lib/engine/prune";
import { itin } from "./helpers";

const mk = (dest: string, gbp: number, hours = 9, origin = "LHR") =>
  itin({ origin, dest, departUtc: "2026-12-10T20:00:00Z", arriveUtc: new Date(Date.parse("2026-12-10T20:00:00Z") + hours * 3600000).toISOString(), gbp });

describe("pruning", () => {
  it("drops international legs over 1.5× the cheapest through ticket", () => {
    const r = pruneInternational([mk("DEL", 400), mk("DEL", 749), mk("DEL", 751), mk("BOM", 900)], { cheapestThroughGbp: 500, factor: 1.5, maxPerGroup: 10 });
    expect(r.kept.map((i) => i.price.totalGbp).sort()).toEqual([400, 749]);
    expect(r.droppedTooExpensive).toBe(2);
  });

  it("keeps everything (up to the cap) when there is no through ticket to compare with", () => {
    const r = pruneInternational([mk("DEL", 400), mk("DEL", 2000)], { cheapestThroughGbp: null, factor: 1.5, maxPerGroup: 10 });
    expect(r.kept).toHaveLength(2);
  });

  it("caps each origin/hub group to the cheapest N plus the 3 shortest and 3 earliest arrivals", () => {
    const at = (gbp: number, depart: string, hours: number) =>
      itin({ origin: "LHR", dest: "DEL", departUtc: depart, arriveUtc: new Date(Date.parse(depart) + hours * 3600000).toISOString(), gbp });
    const list = [
      at(100, "2026-12-10T10:00:00Z", 14), // cheap
      at(110, "2026-12-10T10:00:00Z", 14), // cheap
      at(500, "2026-12-10T12:00:00Z", 8.5), // short
      at(510, "2026-12-10T13:00:00Z", 8.6), // short
      at(520, "2026-12-10T14:00:00Z", 8.7), // short
      at(530, "2026-12-10T22:00:00Z", 8.8), // dropped: not cheap, short or early
      at(900, "2026-12-10T04:00:00Z", 11), // earliest arrival
    ];
    const r = pruneInternational(list, { cheapestThroughGbp: null, factor: 1.5, maxPerGroup: 2 });
    expect(r.kept.map((i) => i.price.totalGbp).sort((a, b) => a - b)).toEqual([100, 110, 500, 510, 520, 900]);
    expect(r.droppedByCap).toBe(1);
  });

  it("only searches domestic dates the connection window can reach", () => {
    // Lands 11:00 IST: window 14:30 → 01:00 next day (14h) → both dates.
    expect(domesticDatesNeeded(["2026-12-11T05:30:00Z"], "Asia/Kolkata", 210, 840)).toEqual(["2026-12-11", "2026-12-12"]);
    // Lands 05:30 IST: window 09:00 → 19:30 same day → one date only.
    expect(domesticDatesNeeded(["2026-12-11T00:00:00Z"], "Asia/Kolkata", 210, 840)).toEqual(["2026-12-11"]);
    // Lands 22:30 IST: earliest connection is next day.
    expect(domesticDatesNeeded(["2026-12-11T17:00:00Z"], "Asia/Kolkata", 210, 840)).toEqual(["2026-12-12"]);
  });

  it("skips hubs known not to serve the destination until the recheck period passes", () => {
    const now = Date.parse("2026-10-20T00:00:00Z");
    const routes = [
      { hub: "COK", dest: "GAU", has_service: false, last_checked_at: "2026-10-10T00:00:00Z" },
      { hub: "AMD", dest: "GAU", has_service: false, last_checked_at: "2026-08-01T00:00:00Z" },
      { hub: "DEL", dest: "GAU", has_service: true, last_checked_at: "2026-10-10T00:00:00Z" },
    ];
    expect(hubsToSearch(["DEL", "COK", "AMD", "BOM"], "GAU", routes, 30, now)).toEqual(["DEL", "AMD", "BOM"]);
    expect(hubsToSearch(["DEL", "CCU"], "CCU", [], 30, now)).toEqual(["DEL"]);
  });
});

describe("returned option set", () => {
  it("keeps the cheapest, the fastest and every price/time trade-off", async () => {
    const { selectForReturn } = await import("@/lib/engine/search");
    const o = (total: number, totalMins: number) => ({ costs: { total }, totalMins });
    const cheapSlow = Array.from({ length: 5 }, (_, i) => o(500 + i, 3000 + i));
    const middle = o(900, 1800); // dominated by nothing
    const dominated = o(950, 1900); // worse than `middle` on both
    const fastDear = o(2000, 1200);
    const kept = selectForReturn([...cheapSlow, middle, dominated, fastDear], 2);
    expect(kept).toContain(cheapSlow[0]);
    expect(kept).toContain(middle);
    expect(kept).toContain(fastDear);
    expect(kept).not.toContain(dominated);
    expect(kept).not.toContain(cheapSlow[4]);
  });
});
