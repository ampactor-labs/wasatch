// Two slow readings only the conductor takes: the snow forecast at Alta
// (NWS's grid), which colors the music while a storm is on its way, and the
// demand on PacifiCorp East's grid (EIA), which swells the whole mix a
// little when the valley draws more power than usual for the hour.

const HOUR = 3_600_000;
const UA = { "User-Agent": "wasatch-symphony conductor (github.com/ampactor-labs/wasatch)", Accept: "application/geo+json" };

/** NWS's grid square over Alta (SLC office). */
export const ALTA_GRID = "https://api.weather.gov/gridpoints/SLC/108,167";

interface GridValue {
  validTime: string;
  value: number | null;
}

/** "2026-10-24T18:00:00+00:00/PT6H" → [start, end) in UTC ms. */
export function validSpan(validTime: string): [number, number] | null {
  const [start, dur] = validTime.split("/");
  const t = Date.parse(start ?? "");
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(dur ?? "");
  if (!Number.isFinite(t) || !m) return null;
  const ms = (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * HOUR + Number(m[3] ?? 0) * 60_000;
  return ms > 0 ? [t, t + ms] : null;
}

/** Snow forecast over [from, from + 24 h), mm, from the grid's periods
 * (each counted for the share of it inside). */
export function snowAhead(values: GridValue[], from: number): number {
  const to = from + 24 * HOUR;
  let mm = 0;
  for (const v of values) {
    const span = validSpan(v.validTime);
    if (!span || v.value === null || !(v.value > 0)) continue;
    const overlap = Math.min(span[1], to) - Math.max(span[0], from);
    if (overlap > 0) mm += (v.value * overlap) / (span[1] - span[0]);
  }
  return Math.round(mm);
}

/** The snow forecast at Alta for the next day, mm; null if it can't be read. */
export async function fetchAltaSnow(now = Date.now()): Promise<number | null> {
  const res = await fetch(ALTA_GRID, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`NWS grid ${res.status}`);
  const j = (await res.json()) as { properties?: { snowfallAmount?: { values?: GridValue[] } } };
  const values = j.properties?.snowfallAmount?.values;
  return values ? snowAhead(values, now) : null;
}

export interface Grid {
  /** Demand in the latest hour reported, MW. */
  mw: number;
  /** The same hour's mean over the week before, MW. */
  usual: number;
  /** One against the other. */
  energy: number;
  /** The hour, UTC ms. */
  hour: number;
}

/** EIA's hourly rows ("2026-10-24T22", "5993"): the latest hour against
 * the same hour on the days before it. */
export function gridFrom(rows: { period: string; value: string | number }[]): Grid | null {
  const byHour = new Map<number, number>();
  for (const r of rows) {
    const t = Date.parse(`${r.period}:00:00Z`);
    const v = Number(r.value);
    if (Number.isFinite(t) && Number.isFinite(v) && v > 0) byHour.set(t, v);
  }
  const latest = Math.max(...byHour.keys());
  const mw = byHour.get(latest);
  if (mw === undefined) return null;
  const before: number[] = [];
  for (let d = 1; d <= 7; d++) {
    const v = byHour.get(latest - d * 24 * HOUR);
    if (v !== undefined) before.push(v);
  }
  if (before.length < 3) return null;
  const usual = before.reduce((a, b) => a + b, 0) / before.length;
  return { mw, usual: Math.round(usual), energy: Math.round((mw / usual) * 1000) / 1000, hour: latest };
}

/** PacifiCorp East's demand now against the usual (EIA_KEY, or EIA's
 * shared demo key until one is set). */
export async function fetchGrid(key = process.env.EIA_KEY || "DEMO_KEY"): Promise<Grid | null> {
  const q = new URLSearchParams({
    api_key: key,
    frequency: "hourly",
    "data[0]": "value",
    "facets[respondent][]": "PACE",
    "facets[type][]": "D",
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
    length: "200",
  });
  const res = await fetch(`https://api.eia.gov/v2/electricity/rto/region-data/data/?${q}`, { headers: { "User-Agent": UA["User-Agent"] }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`EIA ${res.status}`);
  const j = (await res.json()) as { response?: { data?: { period: string; value: string }[] } };
  return gridFrom(j.response?.data ?? []);
}
