// UK place or postcode → coordinates via postcodes.io (free, no key).

const POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;
const OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;

interface Located {
  name: string;
  lat: number;
  lon: number;
}

async function get(url: string): Promise<{ status: number; result?: unknown }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 86_400 } });
  return (await res.json()) as { status: number; result?: unknown };
}

export async function locate(q: string): Promise<Located | null> {
  const base = "https://api.postcodes.io";
  if (POSTCODE_RE.test(q)) {
    const r = await get(`${base}/postcodes/${encodeURIComponent(q.replace(/\s+/g, ""))}`);
    const p = r.result as { latitude: number | null; longitude: number | null; admin_district: string | null; postcode: string } | undefined;
    if (r.status === 200 && p?.latitude != null && p.longitude != null) return { name: p.postcode, lat: p.latitude, lon: p.longitude };
  }
  if (OUTCODE_RE.test(q)) {
    const r = await get(`${base}/outcodes/${encodeURIComponent(q)}`);
    const p = r.result as { latitude: number | null; longitude: number | null; outcode: string } | undefined;
    if (r.status === 200 && p?.latitude != null && p.longitude != null) return { name: p.outcode, lat: p.latitude, lon: p.longitude };
  }
  const r = await get(`${base}/places?q=${encodeURIComponent(q)}&limit=10`);
  const places = (r.result as { name_1: string; latitude: number; longitude: number; local_type: string; county_unitary: string | null }[] | null) ?? [];
  if (!places.length) return null;
  // Prefer a settlement whose name matches what was typed.
  const wanted = q.trim().toLowerCase();
  const settlement = /city|town|village|hamlet|suburban/i;
  const best =
    places.find((p) => p.name_1.toLowerCase() === wanted && settlement.test(p.local_type)) ??
    places.find((p) => settlement.test(p.local_type)) ??
    places[0];
  return { name: best.county_unitary ? `${best.name_1}, ${best.county_unitary}` : best.name_1, lat: best.latitude, lon: best.longitude };
}

