// Static airport reference data for the From/To pickers and timezones.
// Coordinates are airport (or city-centre for LON) positions, used only to
// rank "nearest airports" by straight-line distance.

export interface UkAirport {
  code: string;
  name: string;
  lat: number;
  lon: number;
  /** Suggested automatically when near the user. Others can still be added by hand. */
  suggest: boolean;
}

/** LON is Ignav's all-London city code (one call covers LHR, LGW, STN…). */
export const LONDON = "LON";

export const UK_AIRPORTS: UkAirport[] = [
  { code: "LON", name: "London (all airports)", lat: 51.5074, lon: -0.1278, suggest: true },
  { code: "MAN", name: "Manchester", lat: 53.3537, lon: -2.275, suggest: true },
  { code: "BHX", name: "Birmingham", lat: 52.4539, lon: -1.748, suggest: true },
  { code: "EDI", name: "Edinburgh", lat: 55.95, lon: -3.3725, suggest: true },
  { code: "GLA", name: "Glasgow", lat: 55.8719, lon: -4.4331, suggest: true },
  { code: "NCL", name: "Newcastle", lat: 55.0375, lon: -1.6917, suggest: true },
  { code: "BRS", name: "Bristol", lat: 51.3827, lon: -2.7191, suggest: true },
  { code: "LBA", name: "Leeds Bradford", lat: 53.8659, lon: -1.6606, suggest: true },
  { code: "ABZ", name: "Aberdeen", lat: 57.2019, lon: -2.1978, suggest: true },
  { code: "BFS", name: "Belfast International", lat: 54.6575, lon: -6.2158, suggest: true },
  { code: "CWL", name: "Cardiff", lat: 51.3967, lon: -3.3433, suggest: true },
  { code: "LHR", name: "London Heathrow", lat: 51.47, lon: -0.4543, suggest: false },
  { code: "LGW", name: "London Gatwick", lat: 51.1537, lon: -0.1821, suggest: false },
  { code: "STN", name: "London Stansted", lat: 51.886, lon: 0.2389, suggest: false },
  { code: "LTN", name: "London Luton", lat: 51.8747, lon: -0.3683, suggest: false },
  { code: "EMA", name: "East Midlands", lat: 52.8311, lon: -1.3281, suggest: false },
  { code: "LPL", name: "Liverpool", lat: 53.3336, lon: -2.8497, suggest: false },
  { code: "EXT", name: "Exeter", lat: 50.7344, lon: -3.4139, suggest: false },
  { code: "SOU", name: "Southampton", lat: 50.9503, lon: -1.3568, suggest: false },
  { code: "NWI", name: "Norwich", lat: 52.6758, lon: 1.2828, suggest: false },
  { code: "INV", name: "Inverness", lat: 57.5425, lon: -4.0475, suggest: false },
];

export interface IndiaAirport {
  code: string;
  city: string;
}

export const INDIA_AIRPORTS: IndiaAirport[] = [
  { code: "GAU", city: "Guwahati" }, { code: "IXB", city: "Bagdogra (Siliguri)" }, { code: "DIB", city: "Dibrugarh" },
  { code: "IMF", city: "Imphal" }, { code: "IXA", city: "Agartala" }, { code: "JRH", city: "Jorhat" },
  { code: "IXS", city: "Silchar" }, { code: "AJL", city: "Aizawl" }, { code: "DMU", city: "Dimapur" },
  { code: "SHL", city: "Shillong" }, { code: "IXI", city: "Lilabari (North Lakhimpur)" }, { code: "TEZ", city: "Tezpur" },
  { code: "HGI", city: "Itanagar" }, { code: "DEL", city: "Delhi" }, { code: "BOM", city: "Mumbai" },
  { code: "BLR", city: "Bengaluru" }, { code: "MAA", city: "Chennai" }, { code: "CCU", city: "Kolkata" },
  { code: "HYD", city: "Hyderabad" }, { code: "AMD", city: "Ahmedabad" }, { code: "COK", city: "Kochi" },
  { code: "PNQ", city: "Pune" }, { code: "GOI", city: "Goa (Dabolim)" }, { code: "GOX", city: "Goa (Mopa)" },
  { code: "TRV", city: "Thiruvananthapuram" }, { code: "CCJ", city: "Kozhikode" }, { code: "CNN", city: "Kannur" },
  { code: "IXE", city: "Mangaluru" }, { code: "IXM", city: "Madurai" }, { code: "TRZ", city: "Tiruchirappalli" },
  { code: "CJB", city: "Coimbatore" }, { code: "VTZ", city: "Visakhapatnam" }, { code: "VGA", city: "Vijayawada" },
  { code: "TIR", city: "Tirupati" }, { code: "BBI", city: "Bhubaneswar" }, { code: "PAT", city: "Patna" },
  { code: "GAY", city: "Gaya" }, { code: "DBR", city: "Darbhanga" }, { code: "IXR", city: "Ranchi" },
  { code: "LKO", city: "Lucknow" }, { code: "VNS", city: "Varanasi" }, { code: "AYJ", city: "Ayodhya" },
  { code: "GOP", city: "Gorakhpur" }, { code: "IXD", city: "Prayagraj" }, { code: "JAI", city: "Jaipur" },
  { code: "UDR", city: "Udaipur" }, { code: "JDH", city: "Jodhpur" }, { code: "IDR", city: "Indore" },
  { code: "BHO", city: "Bhopal" }, { code: "NAG", city: "Nagpur" }, { code: "RPR", city: "Raipur" },
  { code: "IXC", city: "Chandigarh" }, { code: "ATQ", city: "Amritsar" }, { code: "IXJ", city: "Jammu" },
  { code: "SXR", city: "Srinagar" }, { code: "IXL", city: "Leh" }, { code: "DED", city: "Dehradun" },
  { code: "STV", city: "Surat" }, { code: "BDQ", city: "Vadodara" }, { code: "RAJ", city: "Rajkot" },
  { code: "BHJ", city: "Bhuj" }, { code: "IXU", city: "Aurangabad" }, { code: "HBX", city: "Hubballi" },
  { code: "IXG", city: "Belagavi" }, { code: "MYQ", city: "Mysuru" }, { code: "IXZ", city: "Port Blair" },
  { code: "GWL", city: "Gwalior" }, { code: "JLR", city: "Jabalpur" }, { code: "DGH", city: "Deoghar" },
];

const UK_CODES = new Set(UK_AIRPORTS.map((a) => a.code));
const INDIA_CODES = new Set(INDIA_AIRPORTS.map((a) => a.code));

/** Timezone for airports we know about without asking the provider. */
export function knownTz(code: string): string | null {
  if (UK_CODES.has(code)) return "Europe/London";
  if (INDIA_CODES.has(code)) return "Asia/Kolkata";
  return null;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export interface NearbyAirport {
  code: string;
  name: string;
  km: number;
}

/**
 * The nearest `count` suggested regional airports (within `maxKm`), plus
 * London, which has by far the most flights to India.
 */
export function nearestUkAirports(lat: number, lon: number, count = 2, maxKm = 250): NearbyAirport[] {
  const withKm = UK_AIRPORTS.filter((a) => a.suggest).map((a) => ({ code: a.code, name: a.name, km: Math.round(haversineKm(lat, lon, a.lat, a.lon)) }));
  const regional = withKm.filter((a) => a.code !== LONDON && a.km <= maxKm).sort((a, b) => a.km - b.km).slice(0, count);
  const london = withKm.find((a) => a.code === LONDON)!;
  return [...regional, london];
}

/** "Guwahati (GAU)", "gau" or "Guwahati" → "GAU". Null if we can't tell. */
export function parseIndiaDestination(input: string): string | null {
  const t = input.trim();
  const inParens = /\(([A-Za-z]{3})\)\s*$/.exec(t);
  if (inParens) return inParens[1].toUpperCase();
  if (/^[A-Za-z]{3}$/.test(t)) return t.toUpperCase();
  const byCity = INDIA_AIRPORTS.find((a) => a.city.toLowerCase() === t.toLowerCase() || a.city.toLowerCase().startsWith(`${t.toLowerCase()} (`));
  return byCity?.code ?? null;
}

export function indiaLabel(code: string): string {
  const a = INDIA_AIRPORTS.find((x) => x.code === code);
  return a ? `${a.city} (${a.code})` : code;
}
