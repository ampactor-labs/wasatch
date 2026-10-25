// AirNow (AIRNOW_KEY): the air measured at the valley's monitors, in place
// of the model's, for the haze and the Air card. Off until the key is set.
//
// AirNow's current observations give an AQI, not a concentration; PM2.5 is
// read back from it by EPA's breakpoints.
//
// https://docs.airnowapi.org/CurrentObservationsByLatLon/docs

const UA = { "User-Agent": "wasatch-symphony conductor (github.com/ampactor-labs/wasatch)" };

/** EPA's PM2.5 breakpoints (2024): [AQI low, AQI high, µg/m³ low, µg/m³ high]. */
const PM25: [number, number, number, number][] = [
  [0, 50, 0, 9],
  [51, 100, 9.1, 35.4],
  [101, 150, 35.5, 55.4],
  [151, 200, 55.5, 125.4],
  [201, 300, 125.5, 225.4],
  [301, 500, 225.5, 325.4],
];

/** The PM2.5 concentration an AQI stands for, µg/m³. */
export function pm25FromAqi(aqi: number): number {
  if (!Number.isFinite(aqi) || aqi < 0) return Number.NaN;
  for (const [aLo, aHi, cLo, cHi] of PM25) {
    if (aqi <= aHi) return Math.round((cLo + ((Math.max(aqi, aLo) - aLo) * (cHi - cLo)) / (aHi - aLo)) * 10) / 10;
  }
  return 325.4;
}

export interface AirNow {
  aqi: number;
  category: string;
  pm25: number;
  area: string;
  /** When it was observed, UTC ms (the top of its hour). */
  hour: number;
}

interface Observation {
  DateObserved?: string;
  HourObserved?: number;
  LocalTimeZone?: string;
  ReportingArea?: string;
  ParameterName?: string;
  AQI?: number;
  Category?: { Number?: number; Name?: string };
}

const ZONES: Record<string, number> = { MST: -7, MDT: -6 };

export function parseAirNow(body: unknown): AirNow | null {
  if (!Array.isArray(body)) return null;
  const pm = (body as Observation[]).find((o) => /pm2\.?5/i.test(o.ParameterName ?? "") && Number.isFinite(o.AQI));
  if (!pm) return null;
  const offset = ZONES[(pm.LocalTimeZone ?? "").trim().toUpperCase()] ?? -7;
  const day = Date.parse(`${(pm.DateObserved ?? "").trim()}T00:00:00Z`);
  const hour = Number.isFinite(day) ? day + ((pm.HourObserved ?? 0) - offset) * 3_600_000 : Number.NaN;
  return { aqi: pm.AQI!, category: pm.Category?.Name ?? "", pm25: pm25FromAqi(pm.AQI!), area: pm.ReportingArea ?? "", hour };
}

export class AirNowSource {
  private readonly key: string | null;
  latest: AirNow | null = null;
  status: "missing" | "set" | "ok" | "error" = "missing";
  lastError: string | null = null;

  constructor(key = process.env.AIRNOW_KEY || null) {
    this.key = key;
    if (key) this.status = "set";
  }

  get on(): boolean {
    return this.key !== null;
  }

  async poll(): Promise<AirNow | null> {
    if (!this.key) throw new Error("AIRNOW_KEY isn't set");
    const q = new URLSearchParams({ format: "application/json", latitude: "40.76", longitude: "-111.89", distance: "25", API_KEY: this.key });
    const res = await fetch(`https://www.airnowapi.org/aq/observation/latLong/current/?${q}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      this.status = "error";
      this.lastError = `${res.status}`;
      throw new Error(`AirNow ${res.status}`);
    }
    this.status = "ok";
    this.latest = parseAirNow(await res.json());
    return this.latest;
  }
}
