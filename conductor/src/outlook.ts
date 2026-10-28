// Slow readings only the conductor takes: the snow forecast at Alta (NWS's
// grid), which colors the music while a storm is on its way, and
// PacifiCorp East's grid from EIA: the demand on it, which swells the whole
// mix a little when the valley draws more power than usual for the hour;
// its day-ahead forecast, and what the power was made from (shown on the
// board and in the lowdown; only the demand plays).

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
  /** The day-ahead forecast for that hour, MW, and the demand against it
   * (null when EIA hasn't one). A forecast: shown, never played. */
  forecast: { mw: number; ratio: number } | null;
  /** The forecast's peak over the day ahead: its hour (UTC ms) and MW. */
  peak: { hour: number; mw: number } | null;
}

/** What the power was made from. PacifiCorp East reports generation by
 * source as a daily batch, so this runs about a day behind the demand. */
export interface Mix {
  /** The latest hour reported, UTC ms. */
  hour: number;
  /** MW by source in that hour. */
  mw: Record<string, number>;
  /** Each source's share of the day to that hour (24 hours), 0–1. */
  share: Record<string, number>;
  /** The day's generation, MWh. */
  dayMwh: number;
}

interface Row {
  period: string;
  value: string | number;
  /** EIA's series: D demand, DF day-ahead demand forecast. Absent means D. */
  type?: string;
}

const periodMs = (period: string) => Date.parse(`${period}:00:00Z`);

/** EIA's hourly rows ("2026-10-24T22", "5993"): the latest hour's demand
 * against the same hour on the days before it, and against its forecast. */
export function gridFrom(rows: Row[]): Grid | null {
  const demand = new Map<number, number>();
  const forecast = new Map<number, number>();
  for (const r of rows) {
    const t = periodMs(r.period);
    const v = Number(r.value);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    if (r.type === "DF") forecast.set(t, v);
    else if ((r.type ?? "D") === "D" && v > 0) demand.set(t, v);
  }
  if (!demand.size) return null;
  const latest = Math.max(...demand.keys());
  const mw = demand.get(latest)!;
  const before: number[] = [];
  for (let d = 1; d <= 7; d++) {
    const v = demand.get(latest - d * 24 * HOUR);
    if (v !== undefined) before.push(v);
  }
  if (before.length < 3) return null;
  const usual = before.reduce((a, b) => a + b, 0) / before.length;
  const f = forecast.get(latest);
  let peak: Grid["peak"] = null;
  for (const [t, v] of forecast) {
    if (t > latest && t <= latest + 24 * HOUR && (!peak || v > peak.mw)) peak = { hour: t, mw: v };
  }
  return {
    mw,
    usual: Math.round(usual),
    energy: Math.round((mw / usual) * 1000) / 1000,
    hour: latest,
    forecast: f !== undefined && f > 0 ? { mw: f, ratio: Math.round((mw / f) * 1000) / 1000 } : null,
    peak,
  };
}

const EIA = "https://api.eia.gov/v2/electricity/rto";

async function eia(path: string, key: string, facets: [string, string][], length: number): Promise<unknown[]> {
  const q = new URLSearchParams({ api_key: key, frequency: "hourly", "data[0]": "value", "sort[0][column]": "period", "sort[0][direction]": "desc", length: String(length) });
  for (const [k, v] of facets) q.append(k, v);
  const res = await fetch(`${EIA}/${path}/data/?${q}`, { headers: { "User-Agent": UA["User-Agent"] }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`EIA ${res.status}`);
  const j = (await res.json()) as { response?: { data?: unknown[] } };
  return j.response?.data ?? [];
}

/** PacifiCorp East's demand now against the usual and its forecast
 * (EIA_KEY, or EIA's shared demo key until one is set). */
export async function fetchGrid(key = process.env.EIA_KEY || "DEMO_KEY"): Promise<Grid | null> {
  const rows = (await eia(
    "region-data",
    key,
    [
      ["facets[respondent][]", "PACE"],
      ["facets[type][]", "D"],
      ["facets[type][]", "DF"],
    ],
    // A week of demand and a day of forecast, hourly.
    500,
  )) as Row[];
  return gridFrom(rows);
}

/** EIA's energy-source codes, as the board says them. */
const SOURCES: Record<string, string> = {
  COL: "coal",
  NG: "gas",
  WND: "wind",
  SUN: "solar",
  WAT: "hydro",
  NUC: "nuclear",
  OIL: "oil",
  GEO: "geothermal",
  BAT: "batteries",
  PS: "pumped storage",
  OTH: "other",
};

/** EIA's hourly rows by energy source ("2026-10-28T05", "COL", "3477"):
 * the latest hour with most of its sources, and the day to it. */
export function mixFrom(rows: { period: string; fueltype: string; value: string | number }[]): Mix | null {
  const byHour = new Map<number, Record<string, number>>();
  for (const r of rows) {
    const t = periodMs(r.period);
    const v = Number(r.value);
    if (!Number.isFinite(t) || !Number.isFinite(v) || !r.fueltype) continue;
    const name = SOURCES[r.fueltype] ?? r.fueltype.toLowerCase();
    const hour = byHour.get(t) ?? {};
    hour[name] = v;
    byHour.set(t, hour);
  }
  const hours = [...byHour.keys()].sort((a, b) => b - a);
  const latest = hours.find((h) => Object.keys(byHour.get(h)!).length >= 3);
  if (latest === undefined) return null;
  const sum: Record<string, number> = {};
  let total = 0;
  for (const [t, mw] of byHour) {
    if (t <= latest - 24 * HOUR || t > latest) continue;
    for (const [name, v] of Object.entries(mw)) {
      const made = Math.max(0, v);
      sum[name] = (sum[name] ?? 0) + made;
      total += made;
    }
  }
  const share: Record<string, number> = {};
  if (total > 0) for (const [name, v] of Object.entries(sum)) share[name] = Math.round((v / total) * 1000) / 1000;
  return { hour: latest, mw: byHour.get(latest)!, share, dayMwh: Math.round(total) };
}

/** What PacifiCorp East's power was made from, by hour. */
export async function fetchMix(key = process.env.EIA_KEY || "DEMO_KEY"): Promise<Mix | null> {
  const rows = (await eia("fuel-type-data", key, [["facets[respondent][]", "PACE"]], 300)) as { period: string; fueltype: string; value: string | number }[];
  return mixFrom(rows);
}
