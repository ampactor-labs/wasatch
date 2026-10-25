// UDOT's traffic API (UDOT_KEY): what's happening on the valley's roads and
// in its canyons. Off until the key is set.
//
//   event           crashes and closures on the valley's highways: one
//                   standing holds the harmony's tension up, and it
//                   resolves when the road clears; avalanche control in
//                   Little or Big Cottonwood is a distant boom in the
//                   canyon's echo
//   roadconditions  traction law up a canyon: a low brass pedal there
//   servicevehicles snowplows out in a storm: brushes in the drums
//   weatherstations the wind measured up the canyons, in place of the
//                   forecast's, for the harp
//
// https://www.udottraffic.utah.gov/developers/doc. At most 10 calls a
// minute; this makes about two.

const BASE = "https://www.udottraffic.utah.gov/api";
const UA = { "User-Agent": "wasatch-symphony conductor (github.com/ampactor-labs/wasatch)" };

/** The valley, for which incidents and plows count. */
export const VALLEY = { south: 40.42, north: 40.95, west: -112.15, east: -111.62 };
const inValley = (lat: number, lon: number) => lat >= VALLEY.south && lat <= VALLEY.north && lon >= VALLEY.west && lon <= VALLEY.east;

/** A road row for the windows: [ms, kind (0 an incident, 1 cleared, 2
 * avalanche control), road (0 the valley, 1 Little Cottonwood, 2 Big
 * Cottonwood), lat, lon, roadway, words]. */
export type RoadRow = [number, number, number, number, number, string, string];

/** What stands on the roads as a window seals: traction law up Little and
 * Big Cottonwood (0/1 each), snowplows out in the valley, and major
 * incidents standing on its highways. */
export interface RoadState {
  traction: [number, number];
  plows: number;
  closures: number;
}

type Json = Record<string, unknown>;
/** A field by any of its spellings (UDOT's API isn't consistent in case). */
const field = (o: Json, ...names: string[]): unknown => {
  for (const n of names) {
    for (const k of Object.keys(o)) if (k.toLowerCase() === n.toLowerCase()) return o[k];
  }
  return undefined;
};
const str = (o: Json, ...names: string[]) => String(field(o, ...names) ?? "").trim();
const num = (o: Json, ...names: string[]) => {
  const v = Number(field(o, ...names));
  return Number.isFinite(v) ? v : Number.NaN;
};

/** Which canyon road a roadway name is: SR-210 Little Cottonwood, SR-190
 * Big Cottonwood. */
export function canyonOf(roadway: string): 0 | 1 | 2 {
  const r = roadway.toUpperCase().replace(/\s+/g, "");
  if (/(SR|UT)-?210\b|LITTLECOTTONWOOD/.test(r)) return 1;
  if (/(SR|UT)-?190\b|BIGCOTTONWOOD/.test(r)) return 2;
  return 0;
}

/** The highways whose incidents the valley feels. */
const HIGHWAY = /\b(I-?15|I-?80|I-?215|SR-?201|US-?89|BANGERTER|SR-?154|MOUNTAIN VIEW|SR-?85|LEGACY|SR-?67)\b/i;

export interface UdotEvent {
  id: string;
  type: string;
  full: boolean;
  lat: number;
  lon: number;
  roadway: string;
  words: string;
}

export function parseEvents(body: unknown): UdotEvent[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((e: Json) => {
    const id = str(e, "ID", "Id");
    const lat = num(e, "Latitude");
    const lon = num(e, "Longitude");
    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
    return [
      {
        id,
        type: str(e, "EventType"),
        full: field(e, "IsFullClosure") === true || /^true$/i.test(str(e, "IsFullClosure")),
        lat,
        lon,
        roadway: str(e, "RoadwayName"),
        words: str(e, "Description").replace(/\s+/g, " ").slice(0, 140),
      },
    ];
  });
}

/** An incident the music hears: a crash or a full closure on a valley
 * highway, or avalanche control up a canyon. Roadwork isn't news. */
export function heard(e: UdotEvent): { kind: "incident" | "avalanche"; road: 0 | 1 | 2 } | null {
  const canyon = canyonOf(e.roadway);
  if (canyon && /avalanche/i.test(`${e.words} ${e.type}`)) return { kind: "avalanche", road: canyon };
  if (!inValley(e.lat, e.lon)) return null;
  const crash = /accident|incident|crash/i.test(e.type);
  const closure = /closure/i.test(e.type) && e.full;
  if ((crash || closure) && (HIGHWAY.test(e.roadway) || canyon)) return { kind: "incident", road: canyon };
  return null;
}

/** Traction law (or chains) on a canyon road, from road conditions. */
export function traction(body: unknown): [number, number] {
  const out: [number, number] = [0, 0];
  if (!Array.isArray(body)) return out;
  for (const r of body as Json[]) {
    const canyon = canyonOf(str(r, "RoadwayName", "Name"));
    const restriction = `${str(r, "Restriction", "Restrictions")} ${str(r, "RoadCondition", "Condition")}`;
    if (canyon && /traction|chain|4x4|four.?wheel|awd/i.test(restriction) && !/^\s*none\b/i.test(restriction)) out[canyon - 1] = 1;
  }
  return out;
}

/** Snowplows reporting from the valley in the last ten minutes. */
export function plowsOut(body: unknown, now: number): number {
  if (!Array.isArray(body)) return 0;
  return (body as Json[]).filter((v) => {
    const lat = num(v, "Latitude");
    const lon = num(v, "Longitude");
    const seen = Number(field(v, "LastUpdated"));
    const at = seen > 1e12 ? seen : seen > 1e9 ? seen * 1000 : Date.parse(String(field(v, "LastUpdated") ?? ""));
    return inValley(lat, lon) && Number.isFinite(at) && now - at < 10 * 60_000;
  }).length;
}

/** The weather stations up the canyons and on the ridges whose wind the
 * harp hears. */
const RIDGE_STATIONS = /alta|snowbird|cottonwood|brighton|solitude|guardsman|parleys summit|kessler/i;

/** The wind measured up the canyons: the mean of the stations' averages and
 * the strongest gust, m/s; null with none reporting. */
export function canyonWind(body: unknown): { ms: number; gustMs: number; stations: string[] } | null {
  if (!Array.isArray(body)) return null;
  const mph = 0.44704;
  const read = (body as Json[]).flatMap((s) => {
    const name = str(s, "StationName", "Name");
    const avg = num(s, "WindSpeedAvg", "WindSpeed");
    const gust = num(s, "WindSpeedGust", "WindGust");
    return RIDGE_STATIONS.test(name) && Number.isFinite(avg) ? [{ name, avg, gust: Number.isFinite(gust) ? gust : avg }] : [];
  });
  if (!read.length) return null;
  return {
    ms: (read.reduce((a, s) => a + s.avg, 0) / read.length) * mph,
    gustMs: Math.max(...read.map((s) => s.gust)) * mph,
    stations: read.map((s) => s.name),
  };
}

export class Udot {
  private readonly key: string | null;
  private events = new Map<string, { kind: "incident" | "avalanche"; road: 0 | 1 | 2; ev: UdotEvent }>();
  private seeded = false;
  state: RoadState = { traction: [0, 0], plows: 0, closures: 0 };
  wind: ReturnType<typeof canyonWind> = null;
  status: "missing" | "set" | "ok" | "error" = "missing";
  lastError: string | null = null;

  constructor(key = process.env.UDOT_KEY || null) {
    this.key = key;
    if (key) this.status = "set";
  }

  get on(): boolean {
    return this.key !== null;
  }

  async get(what: string, version = "v2"): Promise<unknown> {
    if (!this.key) throw new Error("UDOT_KEY isn't set");
    const res = await fetch(`${BASE}/${version}/get/${what}?key=${encodeURIComponent(this.key)}&format=json`, { headers: UA, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      this.status = "error";
      this.lastError = `${what} ${res.status}`;
      throw new Error(`UDOT ${what} ${res.status}`);
    }
    this.status = "ok";
    return res.json();
  }

  /** Read the events at `now`: the incidents that opened and cleared since
   * the last read, as rows. The first read only learns what's there. */
  async pollEvents(now: number): Promise<RoadRow[]> {
    const current = new Map<string, { kind: "incident" | "avalanche"; road: 0 | 1 | 2; ev: UdotEvent }>();
    for (const ev of parseEvents(await this.get("event"))) {
      const h = heard(ev);
      if (h) current.set(ev.id, { ...h, ev });
    }
    const rows: RoadRow[] = [];
    if (this.seeded) {
      for (const [id, e] of current) {
        if (this.events.has(id)) continue;
        rows.push([now, e.kind === "avalanche" ? 2 : 0, e.road, e.ev.lat, e.ev.lon, e.ev.roadway, e.ev.words]);
      }
      for (const [id, e] of this.events) {
        if (!current.has(id) && e.kind === "incident") rows.push([now, 1, e.road, e.ev.lat, e.ev.lon, e.ev.roadway, e.ev.words]);
      }
    }
    this.seeded = true;
    this.events = current;
    this.state.closures = [...current.values()].filter((e) => e.kind === "incident").length;
    return rows;
  }

  async pollConditions(): Promise<void> {
    this.state.traction = traction(await this.get("roadconditions"));
  }

  async pollPlows(now: number): Promise<void> {
    this.state.plows = plowsOut(await this.get("servicevehicles"), now);
  }

  async pollWind(): Promise<void> {
    this.wind = canyonWind(await this.get("weatherstations"));
  }

  /** What's standing, for /health and the page. */
  summary(): { incidents: { road: string; words: string }[]; state: RoadState; wind: ReturnType<typeof canyonWind> } {
    return {
      incidents: [...this.events.values()].map((e) => ({ road: e.ev.roadway, words: e.ev.words })).slice(0, 20),
      state: this.state,
      wind: this.wind,
    };
  }
}
