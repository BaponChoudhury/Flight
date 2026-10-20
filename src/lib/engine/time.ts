// Timezone maths. Everything is stored and compared as UTC; local times are
// only produced for display or for provider inputs that are expressed locally.

const MIN = 60_000;

function partsIn(instantMs: number, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(new Date(instantMs))) {
    if (type !== "literal") p[type] = Number(value);
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `tz` from UTC at the given instant, in minutes (BST = +60, IST = +330). */
export function tzOffsetMins(instantMs: number, tz: string): number {
  const p = partsIn(instantMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / MIN);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;
const HAS_OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/;

/** Convert a wall-clock time in `tz` ("2026-11-12T09:30[:00]") to a UTC ISO string. */
export function localToUtc(local: string, tz: string): string {
  const m = LOCAL_RE.exec(local);
  if (!m) throw new Error(`Unrecognised local time: ${local}`);
  const [, y, mo, d, h, mi, s] = m;
  const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  // Two passes handle instants either side of a DST change.
  let guess = naive - tzOffsetMins(naive, tz) * MIN;
  guess = naive - tzOffsetMins(guess, tz) * MIN;
  return new Date(guess).toISOString();
}

/** Parse a provider timestamp that may or may not carry an offset. */
export function parseInstant(value: string, fallbackTz?: string | null): string {
  if (HAS_OFFSET_RE.test(value.trim())) return new Date(value).toISOString();
  if (fallbackTz) return localToUtc(value, fallbackTz);
  // No offset and no timezone: the field is documented as UTC.
  return new Date(value.trim() + "Z").toISOString();
}

export function minutesBetween(fromUtc: string, toUtc: string): number {
  return Math.round((Date.parse(toUtc) - Date.parse(fromUtc)) / MIN);
}

export function addMinutes(utc: string, mins: number): string {
  return new Date(Date.parse(utc) + mins * MIN).toISOString();
}

/** Local calendar date (YYYY-MM-DD) of an instant in `tz`. */
export function localDate(utc: string, tz: string): string {
  const p = partsIn(Date.parse(utc), tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Local hour (0–23) of an instant in `tz`. */
export function localHour(utc: string, tz: string): number {
  return partsIn(Date.parse(utc), tz).hour;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function formatLocalTime(utc: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(utc),
  );
}

export function formatLocalDay(utc: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(
    new Date(utc),
  );
}

export function formatDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.abs(mins % 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** True when the interval [fromUtc, toUtc] includes local midnight in `tz`. */
export function crossesLocalMidnight(fromUtc: string, toUtc: string, tz: string): boolean {
  return localDate(fromUtc, tz) !== localDate(toUtc, tz);
}
