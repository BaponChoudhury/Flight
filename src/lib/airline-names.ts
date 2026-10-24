// Display names for airlines common on UK ⇄ India routes. Providers often send only the
// IATA code, or the operating carrier's name on a codeshare, so the card can't rely on them.

const NAMES: Record<string, string> = {
  "2T": "Fly91", "6E": "IndiGo", "9I": "Alliance Air", AA: "American Airlines", AC: "Air Canada", AF: "Air France", AI: "Air India",
  AY: "Finnair", AZ: "ITA Airways", BA: "British Airways", BG: "Biman", BY: "TUI", CA: "Air China", CX: "Cathay Pacific", DL: "Delta",
  EI: "Aer Lingus", EK: "Emirates", ET: "Ethiopian", EY: "Etihad", FR: "Ryanair", FZ: "flydubai", G9: "Air Arabia", GF: "Gulf Air",
  I5: "AIX Connect", IB: "Iberia", IX: "Air India Express", J9: "Jazeera Airways", KL: "KLM", KU: "Kuwait Airways", LH: "Lufthansa",
  LO: "LOT", LS: "Jet2", LX: "SWISS", MH: "Malaysia Airlines", MS: "EgyptAir", MU: "China Eastern", OS: "Austrian", PC: "Pegasus",
  QP: "Akasa Air", QR: "Qatar Airways", RJ: "Royal Jordanian", S5: "Star Air", SG: "SpiceJet", SN: "Brussels Airlines", SQ: "Singapore Airlines",
  SV: "Saudia", TG: "Thai Airways", TK: "Turkish Airlines", TP: "TAP Air Portugal", U2: "easyJet", UA: "United", UK: "Vistara",
  UL: "SriLankan", VF: "AJet", VS: "Virgin Atlantic", W6: "Wizz Air", WY: "Oman Air", XY: "flynas",
};

/** "EY" → "Etihad"; unknown codes fall back to `fallback`, then the code itself. */
export function airlineName(code: string | null | undefined, fallback?: string | null): string {
  if (!code) return fallback ?? "Airline";
  return NAMES[code] ?? fallback ?? code;
}
