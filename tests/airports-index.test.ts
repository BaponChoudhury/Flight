import { describe, expect, it } from "vitest";
import { buildIndex, getAirportIndex, isInIndia, parseCsv, searchAirports } from "@/lib/airports-index";
import { createMemoryStore } from "@/lib/store";

const CSV = `"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code"
1,"VEGT","medium_airport","Lokpriya Gopinath Bordoloi International Airport",26.1061,91.5859,162,"AS","IN","IN-AS","Guwahati","yes","VEGT","GAU"
2,"VEBD","medium_airport","Bagdogra Airport",26.6812,88.3286,412,"AS","IN","IN-WB","Siliguri","yes","VEBD","IXB"
3,"VIDP","large_airport","Indira Gandhi International Airport",28.5665,77.1031,777,"AS","IN","IN-DL","New Delhi","yes","VIDP","DEL"
4,"XXXX","heliport","Some ""Quoted"", Heliport",1,1,0,"AS","IN","IN-DL","Delhi","yes",,"HHH"
5,"VA1","small_airport","Closed strip",1,1,0,"AS","IN","IN-DL","Delhi","no",,"CCC"
6,"EGLL","large_airport","London Heathrow Airport",51.47,-0.4543,83,"EU","GB","GB-ENG","London","yes","EGLL","LHR"
`;

describe("airport index", () => {
  it("parses quoted CSV fields", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
  });

  it("keeps only airports with scheduled service and an IATA code", () => {
    expect(buildIndex(CSV).map((a) => a.code)).toEqual(["GAU", "IXB", "DEL", "LHR"]);
  });

  it("searches by code, city and airport name, filtered by country", () => {
    const idx = buildIndex(CSV);
    expect(searchAirports(idx, "gau").map((a) => a.code)).toEqual(["GAU"]);
    expect(searchAirports(idx, "guw").map((a) => a.code)).toEqual(["GAU"]);
    expect(searchAirports(idx, "siliguri").map((a) => a.code)).toEqual(["IXB"]);
    expect(searchAirports(idx, "bagdogra").map((a) => a.code)).toEqual(["IXB"]);
    expect(searchAirports(idx, "delhi", { country: "IN" }).map((a) => a.code)).toEqual(["DEL"]);
    expect(searchAirports(idx, "london", { country: "IN" })).toEqual([]);
    expect(searchAirports(idx, "london").map((a) => a.code)).toEqual(["LHR"]);
    expect([isInIndia(idx, "GAU"), isInIndia(idx, "LHR"), isInIndia(idx, "PAR")]).toEqual([true, false, false]);
  });

  it("downloads once, then serves from the store", async () => {
    (globalThis as { __airportIndex?: unknown }).__airportIndex = undefined;
    const store = createMemoryStore();
    let downloads = 0;
    const big = CSV + Array.from({ length: 1200 }, (_, i) => `${i + 10},"X","small_airport","A${i}",0,0,0,"AS","IN","IN-X","Town${i}","yes",,"Q${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26) % 26)}"`).join("\n");
    const fetchCsv = async () => {
      downloads++;
      return big;
    };
    expect((await getAirportIndex(store, fetchCsv)).length).toBeGreaterThan(1000);
    (globalThis as { __airportIndex?: unknown }).__airportIndex = undefined; // simulate a new server instance
    await getAirportIndex(store, fetchCsv);
    expect(downloads).toBe(1);
  });
});
