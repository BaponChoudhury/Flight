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

  it("caps each origin/hub group to the cheapest N plus the 2 fastest", () => {
    const list = [mk("DEL", 100, 12), mk("DEL", 110, 12), mk("DEL", 120, 12), mk("DEL", 500, 8), mk("DEL", 510, 8.5), mk("DEL", 520, 13)];
    const r = pruneInternational(list, { cheapestThroughGbp: null, factor: 1.5, maxPerGroup: 2 });
    expect(r.kept.map((i) => i.price.totalGbp).sort((a, b) => a - b)).toEqual([100, 110, 500, 510]);
    expect(r.droppedByCap).toBe(2);
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
