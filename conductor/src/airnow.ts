// AirNow (AIRNOW_KEY): the air as the valley's monitors measure it, in place
// of the model's: PM2.5 at each monitor (the haze, by vantage: downtown
// listens through Hawthorne, the lake through the station at Saltair), the
// reporting area's AQI for the Air card, and the day's forecast with its
// action days (shown, never played: a forecast only colors). Off until the
// key is set.
//
// AirNow retired its first web services on Sept 30, 2026. Three of the new
// ones are read (docs.airnowapi.org/webservices; the docs need an account):
//
//   /aq/data/                            hourly observations by monitoring
//                                        site in a bounding box, raw
//                                        concentrations included
//   /aq/observation/current/ziplatlong/  the reporting area's NowCast AQI,
//                                        by pollutant
//   /aq/forecast/current/                the area's forecast, by day
//
// A key is allowed about 500 requests an hour; this makes about thirteen.
// AirNow can take a while to answer the site query, so each request has a
// long timeout and one more try: a poll that fails in an hour's second half
// would leave the next hour on the model.
//
// AirNow's data exchange guidelines: the observations are preliminary and
// are shown as such, credited to the Utah Department of Environmental
// Quality and the EPA AirNow program, and passed on as received (µg/m³ and
// ppb, the NowCast AQI and its category); only the music is derived.

const UA = { "User-Agent": "wasatch-symphony conductor (github.com/ampactor-labs/wasatch)" };
const HOUR = 3_600_000;
const BASE = "https://www.airnowapi.org";
/** The valley's monitors: Bountiful to Herriman, Saltair to the foothills. */
export const BBOX = "-112.25,40.45,-111.75,40.92";
/** Where the reporting area is looked up. */
const SLC = { latitude: "40.76", longitude: "-111.89" };

/** The monitors each vantage listens through, in order of preference (by
 * AQS code): downtown, Hawthorne (the valley's reference monitor, 3 km from
 * the Gallivan Center), then Utah Technical Center and Rose Park; the lake,
 * the Beach station on the shore by Saltair, then Magna and Lake Park. No
 * monitor stands in Little Cottonwood: Tanners Flat hears the valley's. */
export const DOWNTOWN_SITES = ["490353006", "840490353015", "490353010", "840490353018"];
export const LAKE_SITES = ["490352004", "840490351007", "840490353014"];

/** A monitor's latest hour, as reported. */
export interface Site {
  /** AirNow's full AQS code. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** The hour observed, UTC ms (its start). */
  hour: number;
  /** Raw hourly concentrations: µg/m³ for the particulates, ppb for the
   * gases (CO in ppm). NaN where the site doesn't measure one. */
  pm25: number;
  pm10: number;
  o3: number;
  no2: number;
  co: number;
  so2: number;
  /** PM2.5's NowCast AQI at the site (NaN without). */
  aqi: number;
}

/** The reporting area now: each pollutant's NowCast AQI, and the highest. */
export interface AreaNow {
  area: string;
  /** The hour observed, UTC ms. */
  hour: number;
  aqi: number;
  category: string;
  /** The pollutant that sets the AQI. */
  pollutant: string;
  pollutants: { parameter: string; aqi: number; category: string }[];
}

export interface ForecastDay {
  /** YYYY-MM-DD, local. */
  date: string;
  parameter: string;
  /** NaN when only a category was forecast. */
  aqi: number;
  category: string;
  categoryNumber: number;
  actionDay: boolean;
  discussion: string;
}

export interface Forecast {
  issued: string;
  area: string;
  days: ForecastDay[];
}

/** Everything read, for /roads.json, the board and the lowdown. */
export interface AirNow {
  aqi: number;
  category: string;
  pollutant: string;
  area: string;
  /** The reporting area's hour, UTC ms. */
  hour: number;
  /** PM2.5 for the valley, µg/m³: the median of the monitors' raw hourly
   * readings in the latest hour. */
  pm25: number;
  /** How many monitors that median stands on. */
  monitors: number;
  sites: Site[];
  /** The monitor each vantage hears (null while it hasn't reported). */
  downtown: Site | null;
  lake: Site | null;
  pollutants: AreaNow["pollutants"];
  forecast: Forecast | null;
  /** AirNow's data are not yet verified: they're shown as preliminary. */
  preliminary: true;
}

const ZONES: Record<string, number> = { MST: -7, MDT: -6, PST: -8, PDT: -7 };

/** A reading AirNow marks missing (−999) or that isn't a number. */
const known = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > -900;

/** "2026-10-28", "14:00", "MDT" → UTC ms. */
export function localHour(date: unknown, hour: unknown, zone: unknown): number {
  const day = Date.parse(`${String(date ?? "").trim()}T00:00:00Z`);
  const h = typeof hour === "number" ? hour : Number.parseInt(String(hour ?? ""), 10);
  const offset = ZONES[String(zone ?? "").trim().toUpperCase()] ?? -7;
  return Number.isFinite(day) && Number.isFinite(h) ? day + (h - offset) * HOUR : Number.NaN;
}

const pretty = (parameter: string): string => (parameter.toUpperCase() === "OZONE" || parameter.toUpperCase() === "O3" ? "ozone" : parameter);

interface CurrentRow {
  dateObserved?: string;
  hourObserved?: string | number;
  localTimeZone?: string;
  reportingAreaName?: string;
  parameterName?: string;
  nowcastAQI?: number;
  aqiCategoryName?: string;
}

/** The reporting area's current observations (/aq/observation/current/ziplatlong/). */
export function parseCurrent(body: unknown): AreaNow | null {
  const rows = (Array.isArray(body) ? body : []) as CurrentRow[];
  const good = rows.filter((r) => known(r.nowcastAQI) && r.parameterName);
  if (!good.length) return null;
  const pollutants = good.map((r) => ({ parameter: pretty(r.parameterName!), aqi: r.nowcastAQI!, category: r.aqiCategoryName ?? "" }));
  const top = pollutants.reduce((a, b) => (b.aqi > a.aqi ? b : a));
  const first = good[0]!;
  return {
    area: first.reportingAreaName ?? "",
    hour: localHour(first.dateObserved, first.hourObserved, first.localTimeZone),
    aqi: top.aqi,
    category: top.category,
    pollutant: top.parameter,
    pollutants,
  };
}

interface DataRow {
  Latitude?: number;
  Longitude?: number;
  UTC?: string;
  Parameter?: string;
  Unit?: string;
  Value?: number;
  RawConcentration?: number;
  AQI?: number;
  Category?: number;
  SiteName?: string;
  AgencyName?: string;
  FullAQSCode?: string;
  IntlAQSCode?: string;
}

/** The raw hourly concentration if it was reported, else the NowCast value. */
const concentration = (r: DataRow): number => (known(r.RawConcentration) ? r.RawConcentration : known(r.Value) ? r.Value : Number.NaN);

const utcMs = (r: DataRow): number => Date.parse(`${(r.UTC ?? "").trim()}:00Z`);

/** Each monitor's latest hour (the latest with PM2.5, else the latest at
 * all) from the bounding-box observations (/aq/data/). */
export function parseSites(body: unknown): Site[] {
  const rows = (Array.isArray(body) ? body : []) as DataRow[];
  const bySite = new Map<string, DataRow[]>();
  for (const r of rows) {
    const id = r.FullAQSCode || r.IntlAQSCode;
    if (!id || !Number.isFinite(utcMs(r))) continue;
    bySite.set(id, [...(bySite.get(id) ?? []), r]);
  }
  const out: Site[] = [];
  for (const [id, list] of bySite) {
    const hours = [...new Set(list.map(utcMs))].sort((a, b) => b - a);
    const withPm = hours.find((h) => list.some((r) => utcMs(r) === h && r.Parameter === "PM2.5" && Number.isFinite(concentration(r))));
    const hour = withPm ?? hours[0]!;
    const at = list.filter((r) => utcMs(r) === hour);
    const read = (parameter: string): number => {
      const r = at.find((x) => x.Parameter === parameter);
      return r ? concentration(r) : Number.NaN;
    };
    const pm = at.find((x) => x.Parameter === "PM2.5");
    const first = at[0]!;
    out.push({
      id,
      name: (first.SiteName ?? id).trim(),
      lat: known(first.Latitude) ? first.Latitude : Number.NaN,
      lon: known(first.Longitude) ? first.Longitude : Number.NaN,
      hour,
      pm25: read("PM2.5"),
      pm10: read("PM10"),
      o3: read("OZONE"),
      no2: read("NO2"),
      co: read("CO"),
      so2: read("SO2"),
      aqi: pm && known(pm.AQI) ? pm.AQI : Number.NaN,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The newest hour any monitor reported PM2.5 for. */
export function latestHour(sites: Site[]): number {
  const hours = sites.filter((s) => Number.isFinite(s.pm25)).map((s) => s.hour);
  return hours.length ? Math.max(...hours) : Number.NaN;
}

/** The first of `prefer` that reported PM2.5 for the latest hour (or the
 * one before it). */
export function pickSite(sites: Site[], prefer: string[]): Site | null {
  const latest = latestHour(sites);
  for (const id of prefer) {
    const s = sites.find((x) => x.id === id);
    if (s && Number.isFinite(s.pm25) && s.hour >= latest - HOUR) return s;
  }
  return null;
}

/** The valley's PM2.5: the median of the monitors reporting for the latest
 * hour, µg/m³ (an instrument's negative drift counts as clean air), and
 * how many stand behind it. */
export function valleyPm25(sites: Site[]): { pm25: number; monitors: number } {
  const latest = latestHour(sites);
  const values = sites
    .filter((s) => Number.isFinite(s.pm25) && s.hour === latest)
    .map((s) => Math.max(0, s.pm25))
    .sort((a, b) => a - b);
  if (!values.length) return { pm25: Number.NaN, monitors: 0 };
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
  return { pm25: Math.round(median * 10) / 10, monitors: values.length };
}

interface ForecastRow {
  dateIssue?: string;
  dateValid?: string;
  reportingArea?: string;
  parameterName?: string;
  aqi?: number;
  categoryNumber?: number;
  categoryName?: string;
  actionDay?: boolean | string;
  discussion?: string;
}

/** The area's forecast by day (/aq/forecast/current/). */
export function parseForecast(body: unknown): Forecast | null {
  const rows = (Array.isArray(body) ? body : []) as ForecastRow[];
  const days = rows
    .filter((r) => r.dateValid && r.parameterName)
    .map((r) => ({
      date: r.dateValid!.trim(),
      parameter: pretty(r.parameterName!),
      aqi: known(r.aqi) && r.aqi >= 0 ? r.aqi : Number.NaN,
      category: r.categoryName ?? "",
      categoryNumber: known(r.categoryNumber) ? r.categoryNumber : 0,
      actionDay: r.actionDay === true || String(r.actionDay).toLowerCase() === "true",
      discussion: String(r.discussion ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.parameter.localeCompare(b.parameter));
  if (!days.length) return null;
  const issued = rows.map((r) => r.dateIssue ?? "").sort().at(-1) ?? "";
  return { issued, area: rows.find((r) => r.reportingArea)?.reportingArea ?? "", days };
}

const hourStamp = (ms: number) => new Date(ms).toISOString().slice(0, 13);

export class AirNowSource {
  private readonly key: string | null;
  latest: AirNow | null = null;
  status: "missing" | "set" | "ok" | "error" = "missing";
  lastError: string | null = null;
  private forecast: Forecast | null = null;
  private forecastAt = 0;

  constructor(key = process.env.AIRNOW_KEY || null) {
    this.key = key;
    if (key) this.status = "set";
  }

  get on(): boolean {
    return this.key !== null;
  }

  /** One request, tried twice if the network or AirNow's slowness fails
   * it. AirNow answers some failures as 200 with a `WebServiceError`
   * envelope; that's an error here too. */
  async get(path: string, params: Record<string, string>): Promise<unknown> {
    if (!this.key) throw new Error("AIRNOW_KEY isn't set");
    const q = new URLSearchParams({ format: "application/json", ...params, API_KEY: this.key });
    let res: Response | null = null;
    for (let attempt = 0; res === null; attempt++) {
      try {
        res = await fetch(`${BASE}${path}?${q}`, { headers: UA, signal: AbortSignal.timeout(45_000) });
      } catch (err) {
        if (attempt >= 1) throw err;
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
    if (!res.ok) throw new Error(`AirNow ${res.status}`);
    const body = (await res.json()) as unknown;
    const err = (body as { WebServiceError?: { Message?: string }[] } | null)?.WebServiceError;
    if (Array.isArray(err)) throw new Error(`AirNow: ${err.map((e) => e.Message).join("; ") || "web service error"}`);
    return body;
  }

  /** Read the monitors and the reporting area (and the forecast, once an
   * hour) and assemble the latest. */
  async poll(now = Date.now()): Promise<AirNow | null> {
    try {
      const [sitesBody, currentBody] = await Promise.all([
        this.get("/aq/data/", {
          startDate: hourStamp(now - 2 * HOUR),
          endDate: hourStamp(now),
          parameters: "PM25,OZONE,PM10,NO2,CO,SO2",
          BBOX,
          dataType: "B",
          verbose: "1",
          monitorType: "0",
          includerawconcentrations: "1",
        }),
        this.get("/aq/observation/current/ziplatlong/", { ...SLC, distance: "25" }),
      ]);
      if (now - this.forecastAt >= HOUR) {
        // The forecast is only shown, so a failure here keeps the rest.
        try {
          this.forecast = parseForecast(await this.get("/aq/forecast/current/", { ...SLC, distance: "25" }));
          this.forecastAt = now;
        } catch (err) {
          this.lastError = err instanceof Error ? err.message : String(err);
        }
      }
      const sites = parseSites(sitesBody);
      const area = parseCurrent(currentBody);
      const valley = valleyPm25(sites);
      if (!area && !valley.monitors) {
        this.status = "ok";
        this.latest = null;
        return null;
      }
      this.status = "ok";
      this.latest = {
        aqi: area?.aqi ?? Number.NaN,
        category: area?.category ?? "",
        pollutant: area?.pollutant ?? "",
        area: area?.area ?? "",
        hour: area?.hour ?? latestHour(sites),
        pm25: valley.pm25,
        monitors: valley.monitors,
        sites,
        downtown: pickSite(sites, DOWNTOWN_SITES),
        lake: pickSite(sites, LAKE_SITES),
        pollutants: area?.pollutants ?? [],
        forecast: this.forecast,
        preliminary: true,
      };
      return this.latest;
    } catch (err) {
      this.status = "error";
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }
}
