// The valley's open feeds, read straight from the browser.
//
// Every feed here is CORS-open and keyless (tested Oct 23, 2026; DESIGN.md
// Appendix A). Each fetcher caches its last good answer, so a feed that's down
// plays on its last value and the receipt says "cached". What steers the day's
// plan (cloud, rain or snow, gusts, storm alerts) comes only from sources that
// never revise the past, NWS observations and alerts, so every phone plans the
// same day; revisable model data only colors bars.

import type { BikeEvent, QuakeEvent, SkyHour } from "../engine/protocol.ts";

export type Receipt = "live" | "cached" | "scheduled";

export interface Reading<T> {
  value: T;
  /** When the source observed it, UTC ms. */
  observed: number;
  receipt: Receipt;
}

const HOUR = 3_600_000;
const NWS_HEADERS = { Accept: "application/geo+json" };

function cacheKey(name: string): string {
  return `wasatch:${name}`;
}

function store<T>(name: string, r: Reading<T>): void {
  try {
    localStorage.setItem(cacheKey(name), JSON.stringify(r));
  } catch {
    // Private mode or full storage: fine, just no cache.
  }
}

function recall<T>(name: string): Reading<T> | null {
  try {
    const raw = localStorage.getItem(cacheKey(name));
    if (!raw) return null;
    const r = JSON.parse(raw) as Reading<T>;
    return { ...r, receipt: "cached" };
  } catch {
    return null;
  }
}

/** Fetch with a timeout; fall back to the cache on any failure. */
async function cached<T>(name: string, load: () => Promise<{ value: T; observed: number }>): Promise<Reading<T> | null> {
  try {
    const { value, observed } = await load();
    const r: Reading<T> = { value, observed, receipt: "live" };
    store(name, r);
    return r;
  } catch (err) {
    console.warn(`${name}:`, err);
    return recall<T>(name);
  }
}

async function json<T>(url: string, init?: RequestInit, timeoutMs = 12_000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** The last finite point at or before the start of the current hour. */
export function atHourStart(pts: { t: number; v: number }[], now = Date.now()): { t: number; v: number } | null {
  const top = Math.floor(now / HOUR) * HOUR;
  let best: { t: number; v: number } | null = null;
  for (const p of pts) {
    if (Number.isFinite(p.v) && p.t <= top && (!best || p.t > best.t)) best = p;
  }
  return best;
}

// --- The lake and the rivers (USGS Water Data APIs) ------------------------

const USGS = "https://api.waterdata.usgs.gov/ogcapi/v1/collections";

interface UsgsFeature {
  properties: { time: string; value: string };
}

export interface Lake {
  ft: number;
  /** Latest level against the last day's mean: the slosh. */
  devFt: number;
}

export function fetchLake(): Promise<Reading<Lake> | null> {
  return cached("lake", async () => {
    const series = await json<{ features: UsgsFeature[] }>(
      `${USGS}/continuous/items?f=json&monitoring_location_id=USGS-10010000&parameter_code=62614&time=P1D&limit=200`,
    );
    const pts = series.features
      .map((f) => ({ t: Date.parse(f.properties.time), v: Number(f.properties.value) }))
      .filter((p) => Number.isFinite(p.v))
      .sort((a, b) => a.t - b.t);
    const last = pts.at(-1);
    if (!last) throw new Error("no lake data");
    const mean = pts.reduce((s, p) => s + p.v, 0) / pts.length;
    return { value: { ft: last.v, devFt: last.v - mean }, observed: last.t };
  });
}

export interface River {
  cfs: number;
  /** Where today's flow sits in the day-of-year percentiles, 0–1. */
  position: number;
}

export function fetchRiver(): Promise<Reading<River> | null> {
  return cached("river", async () => {
    const [series, normals] = await Promise.all([
      json<{ features: UsgsFeature[] }>(
        `${USGS}/continuous/items?f=json&monitoring_location_id=USGS-10171000&parameter_code=00060&time=PT6H&limit=100`,
      ),
      json<{
        features: { properties: { data: { values: { time_of_year: string; values: string[]; percentiles: string[] }[] }[] } }[];
      }>(
        "https://api.waterdata.usgs.gov/statistics/v0/observationNormals?monitoring_location_id=USGS-10171000&parameter_code=00060&normal_type=DOY&computation_type=percentile",
        undefined,
        20_000,
      ).catch(() => null),
    ]);
    // The reading as of the top of the hour, so every phone composes from
    // the same value whenever it last fetched.
    const f = atHourStart(series.features.map((x) => ({ t: Date.parse(x.properties.time), v: Number(x.properties.value) })));
    if (!f) throw new Error("no river data");
    const cfs = f.v;
    let position = 0.5;
    const doy = new Date().toISOString().slice(5, 10);
    const row = normals?.features[0]?.properties.data[0]?.values.find((v) => v.time_of_year === doy);
    if (row) {
      const vals = row.values.map(Number);
      const pcts = row.percentiles.map((p) => Number(p) / 100);
      position = pcts[0] ?? 0.05;
      for (let i = 0; i < vals.length - 1; i++) {
        const lo = vals[i] ?? 0;
        const hi = vals[i + 1] ?? lo;
        if (cfs >= lo && cfs <= hi) {
          const t = hi > lo ? (cfs - lo) / (hi - lo) : 0;
          position = (pcts[i] ?? 0) + t * ((pcts[i + 1] ?? 0) - (pcts[i] ?? 0));
        }
      }
      if (cfs > (vals.at(-1) ?? Infinity)) position = 0.97;
    }
    return { value: { cfs, position }, observed: f.t };
  });
}

// --- Snow (NRCS SNOTEL) --------------------------------------------------

export interface Snow {
  /** Overnight new snow at Snowbird, inches. */
  newIn: number;
  /** Snowpack water against the median for the date (1 = median). */
  ratio: number;
  /** New-snow lightness, 0 heavy – 1 light powder. */
  powder: number;
  /** Water in the new snow, percent (NaN when there's none). */
  densityPct: number;
}

/** SNOTEL reports in Pacific Standard Time, UTC−8, whatever the station. */
function awdbTime(s: string): number {
  return Date.parse(`${s.replace(" ", "T")}:00-08:00`);
}

function awdbDate(ms: number): string {
  const d = new Date(ms - 8 * HOUR);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export function fetchSnow(): Promise<Reading<Snow> | null> {
  return cached("snow", async () => {
    const now = Date.now();
    const base = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/data?stationTriplets=766:UT:SNTL";
    type Series = { stationElement: { elementCode: string }; values: { date: string; value: number; median?: number }[] }[];
    const [hourly, daily] = await Promise.all([
      json<{ data: Series }[]>(
        `${base}&elements=WTEQ,SNWD&duration=HOURLY&beginDate=${encodeURIComponent(awdbDate(now - 30 * HOUR))}&endDate=${encodeURIComponent(awdbDate(now))}`,
      ),
      json<{ data: Series }[]>(
        `${base}&elements=WTEQ&duration=DAILY&beginDate=${awdbDate(now - 3 * 86_400_000).slice(0, 10)}&endDate=${awdbDate(now).slice(0, 10)}&centralTendencyType=MEDIAN`,
      ).catch(() => null),
    ]);
    const el = (code: string) => hourly[0]?.data.find((d) => d.stationElement.elementCode === code)?.values ?? [];
    const depth = el("SNWD").filter((v) => Number.isFinite(v.value)).map((v) => ({ t: awdbTime(v.date), v: v.value }));
    const swe = el("WTEQ").filter((v) => Number.isFinite(v.value)).map((v) => ({ t: awdbTime(v.date), v: v.value }));
    const latest = atHourStart(depth);
    // Overnight: from the lowest depth in the 18 hours before the latest
    // reading to the latest.
    const window = depth.filter((d) => latest && d.t >= latest.t - 18 * HOUR && d.t <= latest.t);
    const low = window.reduce((m, d) => (d.v < m.v ? d : m), window[0] ?? { t: 0, v: 0 });
    const newIn = latest ? Math.max(0, latest.v - low.v) : 0;
    let densityPct = Number.NaN;
    if (newIn >= 2) {
      const sweAt = (t: number) => swe.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best), swe[0] ?? { t, v: 0 }).v;
      const dSwe = latest ? sweAt(latest.t) - sweAt(low.t) : 0;
      if (dSwe > 0) densityPct = (100 * dSwe) / newIn;
    }
    const powder = Number.isFinite(densityPct) ? Math.min(1, Math.max(0, (12 - densityPct) / 8)) : 0.5;
    const today = daily?.[0]?.data[0]?.values.at(-1);
    const ratio = today && today.median && today.median > 0.5 ? today.value / today.median : 1;
    return { value: { newIn, ratio, powder, densityPct }, observed: latest?.t ?? now };
  });
}

// --- The sky (NWS observations and alerts, Open-Meteo) ----------------------

const CLOUD: Record<string, number> = { SKC: 0, CLR: 0, FEW: 0.2, SCT: 0.45, BKN: 0.75, OVC: 1, VV: 1 };

interface NwsObs {
  properties: {
    timestamp: string;
    cloudLayers: { amount: string }[] | null;
    presentWeather: { intensity?: string | null; weather?: string; rawString?: string }[] | null;
    temperature: { value: number | null };
    windSpeed: { value: number | null };
    windGust: { value: number | null };
    precipitationLastHour?: { value: number | null };
    textDescription: string;
  };
}

interface NwsAlert {
  properties: { event: string; sent: string; onset: string | null; effective: string; expires: string; ends: string | null };
}

export interface SkyNow {
  description: string;
  tempC: number;
  /** PM2.5 now, µg/m³ (model). */
  pm25: number;
  /** Warming aloft now, °C (model). */
  inversionC: number;
  /** Ridge gusts now, m/s (model). */
  ridgeGustMs: number;
  /** Mountain snowfall this hour, cm (model). */
  mtnSnowCm: number;
  alerts: string[];
  hours: SkyHour[];
}

const SLOT_WINDOW_MS = 15 * 60_000;

/**
 * The hour slot an observation fills. Slot H takes a report made in the
 * quarter hour before H:00, the one nearest :54 (KSLC's routine hourly
 * report; the station also reports every five minutes). The plan first
 * reads slot H at H:20, so by then every phone has fetched the same report;
 * anything later in the hour never changes a slot already in use.
 */
export function obsSlot(obsMs: number): number | null {
  const next = Math.ceil(obsMs / HOUR) * HOUR;
  return next - obsMs <= SLOT_WINDOW_MS && next !== obsMs ? next : null;
}

/** How hard an alert pushes, 0–1. */
export function alertLevel(event: string): number {
  const ev = event.toLowerCase();
  if (/warning/.test(ev) && /winter|storm|blizzard|wind|avalanche|flood/.test(ev)) return 1;
  if (/advisory|watch/.test(ev) && !/air quality/.test(ev)) return 0.5;
  if (/air quality/.test(ev)) return 0.3;
  return 0.2;
}

/** One surface report, from either source, in the plan's terms. */
export interface Obs {
  /** UTC ms. */
  t: number;
  /** Cloud cover 0–1 (NaN when not reported). */
  cloud: number;
  /** Rain and snow falling, 0 none, 0.3 light, 1, 2.5 heavy. */
  rain: number;
  snow: number;
  tempC: number | null;
  windMs: number | null;
  gustMs: number | null;
  /** Measured precipitation in the last hour, mm. */
  precipMm: number | null;
  text: string;
}

function intensity(s: string): number {
  return s.startsWith("+") || /heavy/.test(s) ? 2.5 : s.startsWith("-") || /light/.test(s) ? 0.3 : 1;
}

/** A report from api.weather.gov (every five minutes, with gaps). */
export function obsFromNws(f: NwsObs): Obs {
  const p = f.properties;
  const layers = p.cloudLayers;
  let rain = 0;
  let snow = 0;
  for (const w of p.presentWeather ?? []) {
    const what = `${w.weather ?? ""} ${w.rawString ?? ""}`.toLowerCase();
    const k = w.intensity === "heavy" ? 2.5 : w.intensity === "light" ? 0.3 : 1;
    if (/snow|\bsn\b|\bsg\b/.test(what)) snow = Math.max(snow, k);
    else if (/rain|drizzle|\bra\b|\bdz\b|shower|thunder/.test(what)) rain = Math.max(rain, k);
  }
  const wind = p.windSpeed.value !== null ? p.windSpeed.value / 3.6 : null;
  return {
    t: Date.parse(p.timestamp),
    cloud: layers === null ? Number.NaN : layers.length ? Math.max(...layers.map((l) => CLOUD[l.amount] ?? 0.5)) : 0,
    rain,
    snow,
    tempC: p.temperature.value,
    windMs: wind,
    gustMs: p.windGust.value !== null ? p.windGust.value / 3.6 : wind,
    precipMm: p.precipitationLastHour?.value ?? null,
    text: p.textDescription,
  };
}

/** A METAR from aviationweather.gov's data API (hourly, complete, but not
 * readable from a browser; the archive uses it). */
export interface Metar {
  obsTime: number;
  clouds: { cover: string; base: number | null }[] | null;
  wxString: string | null;
  temp: number | null;
  wspd: number | null;
  wgst: number | null;
  precip: number | null;
  rawOb: string;
}

export function obsFromMetar(m: Metar): Obs {
  let rain = 0;
  let snow = 0;
  for (const w of (m.wxString ?? "").split(/\s+/).filter(Boolean)) {
    const k = intensity(w);
    if (/SN|SG|PL/.test(w)) snow = Math.max(snow, k);
    else if (/RA|DZ|SH|TS/.test(w)) rain = Math.max(rain, k);
  }
  const clouds = m.clouds ?? [];
  const kt = 0.514444;
  return {
    t: m.obsTime * 1000,
    cloud: clouds.length ? Math.max(...clouds.map((c) => CLOUD[c.cover] ?? 0.5)) : 0,
    rain,
    snow,
    tempC: m.temp,
    windMs: m.wspd !== null ? m.wspd * kt : null,
    gustMs: m.wgst !== null ? m.wgst * kt : m.wspd !== null ? m.wspd * kt : null,
    precipMm: m.precip !== null ? m.precip * 25.4 : null,
    text: m.rawOb,
  };
}

/** Everything the sky is built from. */
export interface SkyRaw {
  /** Surface reports, newest first. */
  obs: Obs[];
  /** The latest report's words ("Partly Cloudy"), when the source has them. */
  latest: { text: string; tempC: number | null; t: number } | null;
  alerts: { features: NwsAlert[] };
  slc: { hourly: Record<string, number[]> } | null;
  alta: { hourly: Record<string, number[]> } | null;
  air: { hourly: Record<string, number[]> } | null;
}

/**
 * Download the sky's sources: every KSLC report from `from` (UTC ms) to `to`
 * (now by default), and `pastDays` of model history (Open-Meteo allows 92).
 * The span must be the same on every phone: the day's plan builds on every
 * hour since its 5 AM anchor.
 */
export async function fetchSkyRaw(from: number, to?: number, pastDays = 3): Promise<SkyRaw> {
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
  const span = `start=${iso(from)}${to ? `&end=${iso(to)}` : ""}`;
  const [obs, alerts, slc, alta, air] = await Promise.all([
    json<{ features: NwsObs[] }>(`https://api.weather.gov/stations/KSLC/observations?${span}&limit=500`, { headers: NWS_HEADERS }, 20_000),
    json<{ features: NwsAlert[] }>("https://api.weather.gov/alerts/active?point=40.7608,-111.891", { headers: NWS_HEADERS }).catch(
      () => ({ features: [] as NwsAlert[] }),
    ),
    json<{ hourly: Record<string, number[]> }>(
      `https://api.open-meteo.com/v1/forecast?latitude=40.76&longitude=-111.89&hourly=temperature_2m,temperature_850hPa,temperature_800hPa,temperature_750hPa,temperature_700hPa&past_days=${pastDays}&forecast_days=2&timeformat=unixtime`,
    ).catch(() => null),
    json<{ hourly: Record<string, number[]> }>(
      `https://api.open-meteo.com/v1/forecast?latitude=40.588&longitude=-111.638&hourly=wind_speed_10m,wind_gusts_10m,snowfall&past_days=${pastDays}&forecast_days=2&timeformat=unixtime&wind_speed_unit=ms`,
    ).catch(() => null),
    json<{ hourly: Record<string, number[]> }>(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=40.76&longitude=-111.89&hourly=pm2_5&past_days=${Math.min(pastDays, 92)}&forecast_days=1&timeformat=unixtime`,
    ).catch(() => null),
  ]);
  const reports = obs.features.map(obsFromNws).sort((a, b) => b.t - a.t);
  const first = reports[0];
  return { obs: reports, latest: first ? { text: first.text, tempC: first.tempC, t: first.t } : null, alerts, slc, alta, air };
}

/** The sky's hours from its sources, by the slot rules above: the same on
 * every phone, and the same in the archive. */
export function skyFrom(raw: SkyRaw, now = Date.now()): { value: SkyNow; observed: number } {
  const { alerts, slc, alta, air } = raw;
  const byHour = new Map<number, SkyHour>();
  const get = (h: number): SkyHour => {
    let r = byHour.get(h);
    if (!r) {
      r = {
        at: h,
        cloud: Number.NaN,
        precipMm: 0,
        snowCm: 0,
        tempC: 10,
        windMs: 3,
        gustMs: 5,
        pm25: 5,
        inversionC: 0,
        alert: 0,
        ridgeMs: 4,
        ridgeGustMs: 6,
        mtnSnowCm: 0,
      };
      byHour.set(h, r);
    }
    return r;
  };
  const series = (src: { hourly: Record<string, number[]> } | null, key: string, apply: (r: SkyHour, v: number) => void) => {
    const t = src?.hourly.time ?? [];
    const v = src?.hourly[key] ?? [];
    t.forEach((sec, i) => {
      const x = v[i];
      if (x !== undefined && x !== null && Number.isFinite(x)) apply(get(Math.floor((sec * 1000) / HOUR) * HOUR), x);
    });
  };

  // What steers the plan: observations, one per slot.
  const chosen = new Map<number, number>();
  for (const o of raw.obs) {
    const slot = obsSlot(o.t);
    const routine = slot === null ? 0 : slot - 6 * 60_000;
    const held = slot === null ? undefined : chosen.get(slot);
    if (slot === null || (held !== undefined && Math.abs(held - routine) <= Math.abs(o.t - routine))) continue;
    chosen.set(slot, o.t);
    const r = get(slot);
    r.cloud = o.cloud;
    r.precipMm = o.precipMm !== null && o.precipMm > 0 ? o.precipMm : o.rain;
    r.snowCm = o.snow;
    if (o.tempC !== null) r.tempC = o.tempC;
    r.windMs = o.windMs ?? 3;
    r.gustMs = o.gustMs ?? r.windMs;
  }
  // Issued alerts count from the hour after they're sent, for the same reason.
  const active: string[] = [];
  for (const a of alerts.features) {
    const p = a.properties;
    active.push(p.event);
    const level = alertLevel(p.event);
    const from = Math.max(Math.ceil(Date.parse(p.sent) / HOUR), Math.floor(Date.parse(p.onset ?? p.effective) / HOUR)) * HOUR;
    const to = Date.parse(p.ends ?? p.expires);
    for (let h = from; h <= to && h < from + 72 * HOUR; h += HOUR) {
      const r = get(h);
      r.alert = Math.max(r.alert, level);
    }
  }
  // What only colors bars: models.
  series(alta, "wind_speed_10m", (r, v) => (r.ridgeMs = v));
  series(alta, "wind_gusts_10m", (r, v) => (r.ridgeGustMs = v));
  series(alta, "snowfall", (r, v) => (r.mtnSnowCm = v));
  series(air, "pm2_5", (r, v) => (r.pm25 = v));
  if (slc) {
    (slc.hourly.time ?? []).forEach((sec, i) => {
      const t2 = slc.hourly.temperature_2m?.[i];
      if (t2 === undefined || t2 === null) return;
      let inv = 0;
      for (const lvl of ["850", "800", "750", "700"]) {
        const tl = slc.hourly[`temperature_${lvl}hPa`]?.[i];
        if (tl !== undefined && tl !== null && Number.isFinite(tl)) inv = Math.max(inv, tl - t2);
      }
      get(Math.floor((sec * 1000) / HOUR) * HOUR).inversionC = inv;
    });
  }
  const latest = raw.latest;
  const nowHour = byHour.get(Math.floor(now / HOUR) * HOUR);
  const hours = [...byHour.values()].sort((a, b) => a.at - b.at);
  return {
    value: {
      description: latest?.text ?? "",
      tempC: latest?.tempC ?? Number.NaN,
      pm25: nowHour?.pm25 ?? Number.NaN,
      inversionC: nowHour?.inversionC ?? 0,
      ridgeGustMs: nowHour?.ridgeGustMs ?? Number.NaN,
      mtnSnowCm: nowHour?.mtnSnowCm ?? 0,
      alerts: active,
      hours,
    },
    observed: latest?.t ?? now,
  };
}

/** The sky from `from` (UTC ms) to now. */
export function fetchSky(from: number): Promise<Reading<SkyNow> | null> {
  return cached("sky", async () => skyFrom(await fetchSkyRaw(from)));
}

// --- Earthquakes (USGS) -----------------------------------------------------

export interface Quake extends QuakeEvent {
  id: string;
  place: string;
}

/** Quakes sound five minutes after their origin, about when the catalog
 * knows them. */
export const QUAKE_LAG_MS = 5 * 60_000;

export function fetchQuakes(): Promise<Reading<Quake[]> | null> {
  return cached("quakes", async () => {
    const start = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 19);
    const d = await json<{
      features: { id: string; properties: { mag: number; place: string; time: number }; geometry: { coordinates: [number, number, number] } }[];
    }>(
      `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${start}&minlatitude=36.9&maxlatitude=42.1&minlongitude=-114.1&maxlongitude=-109&minmagnitude=1&orderby=time-asc`,
    );
    const quakes = d.features.map((f) => ({
      id: f.id,
      place: f.properties.place,
      mag: f.properties.mag,
      originMs: f.properties.time,
      ms: f.properties.time + QUAKE_LAG_MS,
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
    }));
    return { value: quakes, observed: Date.now() };
  });
}

// --- GREENbike (GBFS) --------------------------------------------------------

const GBFS = "https://gbfs.bcycle.com/bcycle_greenbikeslc";
/** BCycle's feed can take twenty seconds to answer. */
const GBFS_TIMEOUT_MS = 35_000;

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export async function fetchStations(): Promise<Station[]> {
  const d = await json<{ data: { stations: { station_id: string; name: string; lat: number; lon: number }[] } }>(
    `${GBFS}/station_information.json`,
    undefined,
    GBFS_TIMEOUT_MS,
  );
  return d.data.stations.map((s) => ({ id: s.station_id, name: s.name, lat: s.lat, lon: s.lon }));
}

/** Watches station status and turns net dock changes into events. A change
 * of more than two bikes at once is a rebalancing truck, not riders. */
export class BikeWatch {
  private last = new Map<string, number>();
  private lastUpdated = 0;
  private stations: Station[] = [];
  readonly events: (BikeEvent & { name: string })[] = [];

  async init(): Promise<void> {
    this.stations = await fetchStations();
  }

  stationName(i: number): string {
    return this.stations[i]?.name ?? "a GREENbike dock";
  }

  async poll(): Promise<boolean> {
    const d = await json<{ last_updated: number; data: { stations: { station_id: string; num_bikes_available: number }[] } }>(
      `${GBFS}/station_status.json`,
      undefined,
      GBFS_TIMEOUT_MS,
    );
    const updated = d.last_updated * 1000;
    if (updated <= this.lastUpdated) return false;
    const first = this.last.size === 0;
    const fresh: (BikeEvent & { name: string })[] = [];
    for (const s of d.data.stations) {
      const prev = this.last.get(s.station_id);
      this.last.set(s.station_id, s.num_bikes_available);
      if (first || prev === undefined) continue;
      const delta = s.num_bikes_available - prev;
      if (delta === 0 || Math.abs(delta) > 2) continue;
      const idx = this.stations.findIndex((x) => x.id === s.station_id);
      const st = this.stations[idx];
      if (!st) continue;
      // Spread each change across the minute before the snapshot, by a hash
      // of the station, the same on every phone.
      let h = 0;
      for (const c of s.station_id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      for (let k = 0; k < Math.abs(delta); k++) {
        fresh.push({ ms: updated - 60_000 + ((h + k * 7919) % 60_000), lat: st.lat, lon: st.lon, delta: Math.sign(delta), station: idx, name: st.name });
      }
    }
    this.lastUpdated = updated;
    const cutoff = Date.now() - 10 * 60_000;
    this.events.push(...fresh);
    this.events.sort((a, b) => a.ms - b.ms);
    while (this.events.length && (this.events[0]?.ms ?? 0) < cutoff) this.events.shift();
    return fresh.length > 0;
  }
}

// --- The season ------------------------------------------------------------

/** Winter, 0–1: the resorts' season, mid-November to mid-April, with ramps. */
export function season(ms: number): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const day = (m: number, dd: number) => Date.UTC(y, m, dd);
  const t = ms;
  const ramp = (a: number, b: number) => Math.min(1, Math.max(0, (t - a) / (b - a)));
  if (t < day(4, 15)) return 1 - ramp(day(3, 10), day(4, 20));
  return ramp(day(10, 5), day(10, 25));
}
