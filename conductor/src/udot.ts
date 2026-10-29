// UDOT's traffic API (UDOT_KEY): what's happening on the valley's roads and
// in its canyons. Off until the key is set.
//
//   event                    crashes and closures on the valley's highways:
//                            one standing holds the harmony's tension up,
//                            and it resolves when the road clears;
//                            avalanche control in Little or Big Cottonwood
//                            is a distant boom in the canyon's echo
//   roadconditions (v3)      traction law up a canyon: a low brass pedal there
//   servicevehicles          snowplows out in a storm: brushes in the drums
//   weatherstations          the wind measured up the canyons, in place of
//                            the forecast's, for the harp
//   messagesigns             the minutes the overhead signs show to downtown,
//                            the airport and the valley's ends, against their
//                            usual: part of the fleet's flow
//   futuredrivingconditions  UDOT's forecast for the canyon roads, shown on
//                            the board (a forecast only colors)
//
// https://udottraffic.utah.gov/developers/doc (fields as documented there,
// Oct 2026): ten calls a minute are allowed; this makes about two and a half.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { bucket } from "./flow.ts";

const BASE = "https://www.udottraffic.utah.gov/api";
const UA = { "User-Agent": "wasatch-symphony conductor (github.com/ampactor-labs/wasatch)" };
const HOUR = 3_600_000;

/** The valley, for which incidents and plows count. */
export const VALLEY = { south: 40.42, north: 40.95, west: -112.15, east: -111.62 };
const inValley = (lat: number, lon: number) => lat >= VALLEY.south && lat <= VALLEY.north && lon >= VALLEY.west && lon <= VALLEY.east;
/** The signs whose minutes the valley feels: the valley's, and Parleys
 * Canyon's on the way in. */
const SIGNS = { ...VALLEY, east: -111.5 };
const inSignsBox = (lat: number, lon: number) => lat >= SIGNS.south && lat <= SIGNS.north && lon >= SIGNS.west && lon <= SIGNS.east;

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
/** UDOT's times are Unix seconds; be ready for milliseconds or a date. */
const when = (v: unknown): number => {
  const n = Number(v);
  if (Number.isFinite(n) && n > 1e12) return n;
  if (Number.isFinite(n) && n > 1e9) return n * 1000;
  return Date.parse(String(v ?? ""));
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

/** A description's first line: UDOT's run on with the project's history
 * after a "---". */
const firstLine = (description: string) =>
  description
    .split(/\n|-{3,}/)[0]!
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);

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
        words: firstLine(str(e, "Description")),
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
    const at = when(field(v, "LastUpdated"));
    return inValley(lat, lon) && Number.isFinite(at) && now - at < 10 * 60_000;
  }).length;
}

/** The weather stations up the canyons and on the ridges whose wind the
 * harp hears. */
const RIDGE_STATIONS = /alta|snowbird|cottonwood|brighton|solitude|guardsman|parleys summit|kessler/i;

/** The wind measured up the canyons: the mean of the stations' averages and
 * the strongest gust, m/s; null with none reporting. A station that hasn't
 * reported in two hours is left out. */
export function canyonWind(body: unknown, now = Date.now()): { ms: number; gustMs: number; stations: string[] } | null {
  if (!Array.isArray(body)) return null;
  const mph = 0.44704;
  // A station whose time can't be read is stale when others' can be; if
  // none can (a format change), the feed itself is taken as current.
  const timed = (body as Json[]).some((s) => Number.isFinite(when(field(s, "LastUpdated"))));
  const read = (body as Json[]).flatMap((s) => {
    const name = str(s, "StationName", "Name");
    const avg = num(s, "WindSpeedAvg", "WindSpeed");
    const gust = num(s, "WindSpeedGust", "WindGust");
    const at = when(field(s, "LastUpdated"));
    const fresh = Number.isFinite(at) ? now - at < 2 * HOUR : !timed;
    return RIDGE_STATIONS.test(name) && Number.isFinite(avg) && fresh ? [{ name, avg, gust: Number.isFinite(gust) ? gust : avg }] : [];
  });
  if (!read.length) return null;
  return {
    ms: (read.reduce((a, s) => a + s.avg, 0) / read.length) * mph,
    gustMs: Math.max(...read.map((s) => s.gust)) * mph,
    stations: read.map((s) => s.name),
  };
}

// --- The signs' minutes ------------------------------------------------------

/** The minutes an overhead sign shows to each place, from its rotating
 * messages: a phase that opens "MINUTES TO" (or "TRAVEL TIME TO", "MIN
 * TO"), then a line a place and its minutes. */
export function travelTimes(messages: unknown): { to: string; minutes: number }[] {
  const out: { to: string; minutes: number }[] = [];
  const list = Array.isArray(messages) ? messages : typeof messages === "string" ? [messages] : [];
  for (const m of list) {
    for (const phase of String(m).split(/<\/?MSG>/i)) {
      const lines = phase
        .split(/<BR\s*\/?>/i)
        .map((l) => l.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const head = lines.findIndex((l) => /^(MINUTES|MINS?|TRAVEL TIMES?|TIME)\s+TO\b/i.test(l));
      if (head < 0) continue;
      for (const l of lines.slice(head + 1)) {
        const m2 = /^(.*?\S)\s+(\d{1,3})\s*(?:MINS?|MINUTES)?$/i.exec(l);
        if (m2) out.push({ to: m2[1]!, minutes: Number(m2[2]) });
      }
    }
  }
  return out;
}

/** A sign's minutes to a place, now. */
export interface SignTime {
  /** `${sign id}|${place}`: one thing learned. */
  key: string;
  name: string;
  roadway: string;
  to: string;
  minutes: number;
  lat: number;
  lon: number;
}

/** The valley's highway signs that show minutes, and what they show. */
export function parseSigns(body: unknown): SignTime[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((s: Json) => {
    const id = str(s, "Id", "ID");
    const lat = num(s, "Latitude");
    const lon = num(s, "Longitude");
    const roadway = str(s, "Roadway", "RoadwayName");
    if (!id || !inSignsBox(lat, lon) || !HIGHWAY.test(roadway)) return [];
    return travelTimes(field(s, "Messages")).map((t) => ({ key: `${id}|${t.to}`, name: str(s, "Name"), roadway, to: t.to, minutes: t.minutes, lat, lon }));
  });
}

interface Usual {
  min: number;
  n: number;
}

/** How fast the usual learns. */
const ALPHA = 0.3;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The signs' minutes against their usual for the hour, learned sign by
 * sign and place by place as the conductor runs (`DATA_DIR/signs.json`),
 * the way the fleet's speed is. An hour's reading is the median of the
 * signs' paces, −1 (twice the usual minutes or worse) to 1; it joins the
 * fleet's speed in the flow. */
export class Signs {
  private readonly path: string | null;
  private usual: Record<string, Record<string, Usual>> = {};
  /** This hour's samples by key, and which hour they're for. */
  private hour = -1;
  private samples = new Map<string, number[]>();
  latest: SignTime[] = [];
  stats = { signs: 0, places: 0, pace: null as number | null };

  constructor(path: string | null) {
    this.path = path;
    if (!path || !existsSync(path)) return;
    try {
      this.usual = JSON.parse(readFileSync(path, "utf8")) as Record<string, Record<string, Usual>>;
    } catch {
      // Unreadable: learn it again.
    }
  }

  /** The usual minutes for `key` in the bucket of `ms`, once it's been seen
   * three times. */
  usualFor(key: string, ms: number): number | null {
    const u = this.usual[key]?.[bucket(ms)];
    return u && u.n >= 3 ? Math.round(u.min * 10) / 10 : null;
  }

  /** A read of the signs at `now`. */
  sample(times: SignTime[], now: number): void {
    const hour = Math.floor(now / HOUR) * HOUR;
    if (hour !== this.hour) {
      this.hour = hour;
      this.samples = new Map();
    }
    for (const t of times) this.samples.set(t.key, [...(this.samples.get(t.key) ?? []), t.minutes]);
    this.latest = times;
    this.stats.signs = new Set(times.map((t) => t.name)).size;
    this.stats.places = times.length;
  }

  /** Close the hour starting at `hour`: its pace against the usual (null
   * until enough is known), learning the hour as the new usual. */
  close(hour: number): number | null {
    if (hour !== this.hour || !this.samples.size) return null;
    const paces: number[] = [];
    for (const [key, minutes] of this.samples) {
      const m = median(minutes);
      const u = this.usualFor(key, hour);
      if (u !== null && u > 0) paces.push(clamp((u / m - 1) / 0.12, -1, 1));
      const b = bucket(hour);
      const was = this.usual[key]?.[b];
      (this.usual[key] ??= {})[b] = was ? { min: was.min + ALPHA * (m - was.min), n: was.n + 1 } : { min: m, n: 1 };
    }
    this.samples = new Map();
    this.save();
    const pace = paces.length ? Math.round(median(paces) * 100) / 100 : null;
    this.stats.pace = pace;
    return pace;
  }

  /** What the signs show now, with the usual, for the page. */
  summary(now = Date.now()): { name: string; roadway: string; to: string; minutes: number; usual: number | null }[] {
    return this.latest.map((t) => ({ name: t.name, roadway: t.roadway, to: t.to, minutes: t.minutes, usual: this.usualFor(t.key, now) }));
  }

  private save(): void {
    if (!this.path) return;
    try {
      writeFileSync(`${this.path}.tmp`, JSON.stringify(this.usual));
      renameSync(`${this.path}.tmp`, this.path);
    } catch {
      // Kept in memory.
    }
  }
}

// --- The roads' forecast -----------------------------------------------------

export interface RoadForecast {
  roadway: string;
  timeframe: string;
  condition: string;
  reason: string;
}

/** UDOT's forecast for the canyon roads and Parleys: the first timeframe
 * of each (futuredrivingconditions). Shown; a forecast only colors. */
export function parseRoadForecast(body: unknown): RoadForecast[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((r: Json) => {
    const roadway = str(r, "Roadway", "RoadwayName");
    if (!(canyonOf(roadway) || /parley|I-?80\b/i.test(roadway))) return [];
    const info = field(r, "ForecastInfo");
    const first = Array.isArray(info) ? (info[0] as Json | undefined) : undefined;
    if (!first) return [];
    return [{ roadway, timeframe: str(first, "Timeframe"), condition: str(first, "Condition"), reason: str(first, "ConditionReason") }];
  });
}

export class Udot {
  private readonly key: string | null;
  private events = new Map<string, { kind: "incident" | "avalanche"; road: 0 | 1 | 2; ev: UdotEvent }>();
  private seeded = false;
  state: RoadState = { traction: [0, 0], plows: 0, closures: 0 };
  wind: ReturnType<typeof canyonWind> = null;
  forecast: RoadForecast[] = [];
  readonly signs: Signs;
  status: "missing" | "set" | "ok" | "error" = "missing";
  lastError: string | null = null;

  /** `signsPath`: where the signs' usual minutes are kept across restarts. */
  constructor(key = process.env.UDOT_KEY || null, signsPath: string | null = null) {
    this.key = key;
    this.signs = new Signs(signsPath);
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
    this.state.traction = traction(await this.get("roadconditions", "v3"));
  }

  async pollPlows(now: number): Promise<void> {
    this.state.plows = plowsOut(await this.get("servicevehicles"), now);
  }

  async pollWind(now = Date.now()): Promise<void> {
    this.wind = canyonWind(await this.get("weatherstations"), now);
  }

  /** The signs' minutes, into this hour's samples. */
  async pollSigns(now: number): Promise<void> {
    this.signs.sample(parseSigns(await this.get("messagesigns")), now);
  }

  async pollForecast(): Promise<void> {
    this.forecast = parseRoadForecast(await this.get("futuredrivingconditions"));
  }

  /** What's standing, for /health and the page. */
  summary(now = Date.now()): {
    incidents: { road: string; words: string }[];
    state: RoadState;
    wind: ReturnType<typeof canyonWind>;
    signs: ReturnType<Signs["summary"]>;
    forecast: RoadForecast[];
  } {
    return {
      incidents: [...this.events.values()].map((e) => ({ road: e.ev.roadway, words: e.ev.words })).slice(0, 20),
      state: this.state,
      wind: this.wind,
      signs: this.signs.summary(now),
      forecast: this.forecast,
    };
  }
}
