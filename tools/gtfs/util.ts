// Helpers for the GTFS compiler: times, calendar dates in America/Denver,
// service resolution and polyline simplification.

export const TIMEZONE = "America/Denver";

/** "H:MM:SS" (hours may exceed 23, UTA pads with a space) to seconds; NaN if empty. */
export function parseTime(s: string | undefined): number {
  if (s === undefined) return NaN;
  const t = s.trim();
  if (t === "") return NaN;
  const a = t.indexOf(":");
  const b = t.indexOf(":", a + 1);
  if (a < 0 || b < 0) return NaN;
  const h = Number(t.slice(0, a));
  const m = Number(t.slice(a + 1, b));
  const sec = Number(t.slice(b + 1));
  if (!Number.isFinite(h) || !Number.isFinite(m) || !Number.isFinite(sec)) return NaN;
  return h * 3600 + m * 60 + sec;
}

/** "20261023" to "2026-10-23". */
export function gtfsDateToIso(d: string): string {
  const t = d.trim();
  return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
}

/** "2026-10-23" to "20261023". */
export function isoToGtfsDate(d: string): string {
  return d.replaceAll("-", "");
}

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The calendar date in America/Denver at an instant, as "YYYY-MM-DD". */
export function denverDate(epochMs: number): string {
  return dateFmt.format(new Date(epochMs));
}

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y ?? 0, m ?? 1, d ?? 1];
}

/** Adds whole days to an ISO calendar date. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = ymd(iso);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for an ISO calendar date. */
export function weekday(iso: string): number {
  const [y, m, d] = ymd(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The wall-clock time in America/Denver at an instant, read as if it were UTC. */
function wallAsUtc(epochMs: number): number {
  const p: Record<string, number> = {};
  for (const part of partsFmt.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return Date.UTC(p.year ?? 0, (p.month ?? 1) - 1, p.day ?? 1, p.hour ?? 0, p.minute ?? 0, p.second ?? 0);
}

/**
 * The instant GTFS times on a service day count from: local noon minus twelve
 * hours (the GTFS reference time). It equals local midnight except on the two
 * days a year the clocks change.
 */
export function serviceDayT0(iso: string): number {
  const [y, m, d] = ymd(iso);
  const wallNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  let instant = wallNoon;
  for (let k = 0; k < 3; k++) instant += wallNoon - wallAsUtc(instant);
  return instant - 12 * 3_600_000;
}

export interface CalendarRow {
  serviceId: string;
  days: boolean[]; // index 0 = Sunday
  start: string; // ISO
  end: string; // ISO
}

export interface CalendarException {
  serviceId: string;
  date: string; // ISO
  type: 1 | 2;
}

/** The service ids running on a date: calendar.txt, then calendar_dates.txt adds and removes. */
export function activeServices(iso: string, calendar: CalendarRow[], exceptions: CalendarException[]): string[] {
  const on = new Set<string>();
  const wd = weekday(iso);
  for (const c of calendar) {
    if (c.start <= iso && iso <= c.end && c.days[wd]) on.add(c.serviceId);
  }
  for (const e of exceptions) {
    if (e.date !== iso) continue;
    if (e.type === 1) on.add(e.serviceId);
    else on.delete(e.serviceId);
  }
  return [...on].sort();
}

/** Douglas–Peucker simplification of [lat, lon] points with a tolerance in meters. */
export function simplify(points: [number, number][], toleranceM: number): [number, number][] {
  if (points.length <= 2) return points.slice();
  const lat0 = (points[0]![0] * Math.PI) / 180;
  const kx = 111_320 * Math.cos(lat0);
  const ky = 110_540;
  const xy = points.map(([lat, lon]) => [lon * kx, lat * ky] as const);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = toleranceM * toleranceM;
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = xy[a]!;
    const [bx, by] = xy[b]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD2 = tol2;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i]!;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d2 = ex * ex + ey * ey;
      if (d2 > worstD2) {
        worstD2 = d2;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Great-circle distance in meters (haversine). */
export function distanceM(a: [number, number], b: [number, number]): number {
  const r = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad;
  const dLon = (b[1] - a[1]) * toRad;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * UTA writes some names in capitals ("RIVER TRAIL STATION", "TO DRAPER") and
 * the rest in title case; capitals-only names become title case so the same
 * place or headsign reads the same everywhere.
 */
export function tidyName(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!/[A-Z]/.test(t) || /[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (_, pre: string, c: string) => pre + c.toUpperCase());
}

/** Rounds a coordinate to 5 decimals (about a meter). */
export function round5(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}
