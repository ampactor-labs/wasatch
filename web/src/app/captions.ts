// What the listener reads: every heard event as a trail sign, with a receipt
// saying where it came from. The first time a family sounds, its caption says
// what the family is; after that, captions are short.

import type { BarEvent, FeatureEvent, Heard, VantageEvent } from "../engine/host.ts";
import type { Receipt } from "../data/feeds.ts";
import { changedNote, keyName, type Key } from "./music.ts";
import type { Schedule } from "./schedule.ts";

export interface Caption {
  text: string;
  /** Said once, the first time this family sounds. */
  intro?: string;
  /** Where it came from; "here" is the listener's own choice of vantage. */
  receipt: Receipt | "here";
  /** When the source observed it (UTC ms), for "live 5:42 PM". */
  observed?: number;
  /** When it's heard, performance.now(). */
  at: number;
  family: Family;
}

export type Family =
  | "trax"
  | "frontrunner"
  | "skibus"
  | "bike"
  | "quake"
  | "theme"
  | "lake"
  | "ground"
  | "wind"
  | "snow"
  | "sky"
  | "harmony"
  | "vantage"
  | "air"
  | "river"
  | "buses"
  | "late"
  | "alert"
  | "plane"
  | "service"
  | "storm"
  | "grid"
  | "due"
  | "road"
  | "traction"
  | "plows";

/** The engine's feature kinds (engine/src/compose.rs FeatureKind), in order. */
const FEATURE_FAMILY: Family[] = [
  "trax",
  "frontrunner",
  "skibus",
  "bike",
  "quake",
  "theme",
  "lake",
  "ground",
  "wind",
  "snow",
  "sky",
  "harmony",
  "air",
  "river",
  "buses",
  "late",
  "alert",
  "plane",
  "service",
  "storm",
  "grid",
  "due",
  "road",
  "traction",
  "plows",
];

const INTROS: Partial<Record<Family, string>> = {
  trax: "That bell was TRAX: every train leaving a station rings one, on its line's chord tone.",
  frontrunner: "That horn was FrontRunner at Salt Lake Central, in the rhythm of a grade crossing.",
  skibus: "Those drums are the ski buses, echoing up the canyon they climb.",
  bike: "That marimba was GREENbike: a bike checked out or docked.",
  quake: "That deep bell was an earthquake in Utah's catalog.",
  theme: "The Wasatch theme: thirteen summits, Ben Lomond to Mount Nebo, as a melody.",
  lake: "The low drone is the Great Salt Lake. Until it's healthy, phrases don't always come home.",
  ground: "The ground voice is the city's seismometers, moved up onto the chord.",
  wind: "The harp is the wind on the ridges.",
  snow: "The sparkle is snow falling in the mountains.",
  harmony: "Every few minutes the harmony moves one note, and this line says why.",
  vantage: "Where you listen changes the mix, never the music: what's near is close, bright and dry, what's far is quiet, dark and echoing. Friends listening elsewhere are still in the same bar.",
  air: "The air is the lid: haze dulls the pad and the skyline, and an inversion puts a low ceiling on the reverb.",
  river: "The bass is the Jordan River: long notes when it runs low, a walking line when it runs high.",
  buses: "The hats and shakers are the buses: how often they stop sets how busy the groove is.",
  late: "When the trains run late, the drums lay back behind the beat with them.",
  alert: "A weather alert builds tension and drum fills until it's lifted.",
  plane: "That swell of brass and strings was a plane, climbing out of SLC or coming in to land, sounding from where it is in the sky. Airlines are named; private aircraft never are.",
  service: "That fill was a new UTA service alert. One on the trains holds the harmony's tension up while it stands.",
  storm: "A storm's on its way: the snow forecast at Alta holds the harmony in suspense, darkens the pad and pins the bass to home, until the snow starts falling.",
  grid: "The whole mix swells a little when the valley draws more power than usual for the hour, and eases off when it draws less.",
  due: "When FrontRunner's due into Salt Lake Central, the phrase it arrives in turns for home: its dominant, then home with the horn.",
  road: "A crash or a closure on the valley's highways hangs the harmony and holds the tension up until the road clears; avalanche control up a canyon is a boom in its echo.",
  traction: "Traction law up a canyon: a low brass pedal there, breathing a phrase at a time.",
  plows: "Snowplows out in a storm: brushes in the drums, more of them the more plows.",
};

/** Formatting in Mountain time, whatever the listener's zone. */
const TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "long" });
const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" });

export function mountainTime(ms: number): string {
  return TIME.format(ms);
}
export function mountainDay(ms: number): string {
  return DAY.format(ms);
}
export function mountainDate(ms: number): string {
  return DATE.format(ms);
}
export function mountainHour(ms: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(ms);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

export function receiptText(c: Pick<Caption, "receipt" | "observed">): string {
  if (c.receipt === "scheduled") return "scheduled";
  if (c.receipt === "here") return "you are here";
  return c.observed ? `${c.receipt} ${mountainTime(c.observed)}` : c.receipt;
}

/** "on time", "2 min late", "1 min early". */
export function lateness(s: number): string {
  if (Math.abs(s) < 60) return "on time";
  const m = Math.round(Math.abs(s) / 60);
  return `${m} min ${s > 0 ? "late" : "early"}`;
}

const fmt1 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Where the piece's live readings are, for captions that quote them. */
export interface ValleyNow {
  lake?: { ft: number; observed: number; receipt: Receipt };
  sky?: { description: string; observed: number; receipt: Receipt };
  wind?: { gustMs: number; observed: number; receipt: Receipt };
  snow?: { newIn: number; observed: number; receipt: Receipt };
  quakes: { originMs: number; mag: number; place: string }[];
  bikeStation(i: number): string;
  /** The loudest station, and its level against a busy day there (0–1). */
  ground?: { station: string; level: number; receipt: Receipt; observed: number };
  river?: { cfs: number; position: number; gauges?: { name: string; cfs: number }[]; observed: number; receipt: Receipt };
  air?: { pm25: number; inversionC: number; observed: number; receipt: Receipt };
  alerts?: { names: string[]; observed: number; receipt: Receipt };
  /** Buses out now, counted live, when the conductor has the fleet. */
  busesOut?: { count: number; observed: number };
  /** A plane a window carried, by its time: [ms, lat, lon, 0 departing / 1
   * landing, size, ft, an airline's, its name]. */
  plane?(ms: number): [number, number, number, number, number, number, number, string] | undefined;
  /** A new service alert a window carried, by its time: [ms, kind, severe,
   * routes, headline]. */
  serviceAlert?(ms: number): [number, number, number, string, string] | undefined;
  grid?: { mw: number; usual: number; energy: number; observed: number; receipt: Receipt };
  /** Something on the roads a window carried, by its time: [ms, kind, road,
   * lat, lon, roadway, words]. */
  road?(ms: number): [number, number, number, number, number, string, string] | undefined;
  keyed?: { measured: { wind: boolean; air: boolean }; airnow: { aqi: number; category: string } | null; udot: { state: { plows: number } } | null } | null;
}

const CANYONS = ["the valley", "Little Cottonwood", "Big Cottonwood"];

const SKI_ROUTE: Record<string, string> = {
  "972": "up Big Cottonwood to Solitude and Brighton",
  "994": "up Little Cottonwood to Snowbird and Alta",
  CS1: "up Little Cottonwood to Snowbird and Alta",
  CS2: "up Little Cottonwood to Snowbird and Alta",
  CS3: "up Big Cottonwood to Solitude and Brighton",
};

const REASON: Record<number, (to: Key) => string> = {
  0: (to) => `A new day starts at home: ${keyName(to)}`,
  1: (to) => `The valley's moving faster than a moment ago → ${keyName(to)}`,
  2: (to) => `The valley's slowing down → ${keyName(to)}`,
  3: (to) => `The sky brightened → ${keyName(to)}`,
  4: (to) => `The sky darkened → ${keyName(to)}`,
  5: (to) => `Nothing's pushing, so the harmony heads home → ${keyName(to)}`,
  6: (to) => `Nothing's pushing, so the harmony visits next door → ${keyName(to)}`,
  7: (to) => `Night: the harmony heads home → ${keyName(to)}`,
  8: (to) => `Night drift → ${keyName(to)}`,
};

/** Why the tempo isn't the daypart's (engine/src/plan.rs, Reason 9 and 10). */
const TEMPO_REASON: Record<number, (bpm: number) => string> = {
  9: (bpm) => `the buses and trains are moving quickly, so the tempo's up at ${bpm}`,
  10: (bpm) => `the buses and trains are crawling, so the tempo's held back at ${bpm}`,
};

/** The caption for a section's first bar: why the harmony moved. In A Day
 * in Twelve Minutes, prefixed with the moment of the day. */
export function harmonyCaption(bar: Heard<BarEvent>): Caption {
  const to = { c: bar.c, r: bar.r };
  const from = { c: bar.pc, r: bar.pr };
  const why = bar.why >= 0 ? bar.why : bar.home;
  let text = (REASON[why] ?? ((k: Key) => `Now in ${keyName(k)}`))(to);
  if (bar.why >= 0 && bar.home >= 0 && bar.home !== bar.why) {
    // Both moved: the notes, then home.
    text = `${(REASON[bar.why] ?? REASON[1]!)(to).split(" → ")[0]}, and ${(REASON[bar.home] ?? REASON[3]!)(to).toLowerCase()}`;
  }
  // The one note that changed, old to new.
  const swap = changedNote(from, to);
  if (swap) text += ` (${swap[1]} becomes ${swap[0]})`;
  const tempo = TEMPO_REASON[bar.tempo ?? -1];
  if (tempo && bar.day === 0) text += `; ${tempo(Math.round(bar.bpm))}`;
  if (bar.day > 0) return { text: `${mountainTime(bar.day)} · ${text.charAt(0).toLowerCase()}${text.slice(1)}`, receipt: "scheduled", at: bar.at, family: "harmony" };
  return { text, receipt: "scheduled", at: bar.at, family: "harmony", intro: INTROS.harmony };
}

/** Feature values that mark A Day in Twelve Minutes' moments (engine/src/twelve.rs). */
export const MOMENT = { FIRST_TRAIN: 1, LAST_TRAIN: 2, SUNRISE: 3, SUNSET: 4, FIRST_SKI: 5, CLOCK: 6 } as const;

export function featureCaption(f: Heard<FeatureEvent>, schedule: Schedule, valley: ValleyNow, key: Key, inDay = false): Caption | null {
  const family = FEATURE_FAMILY[f.k];
  if (!family || family === "harmony") return null;
  const base = { at: f.at, family, intro: inDay ? undefined : INTROS[family] };
  if (inDay) {
    const when = mountainTime(f.ev);
    const v = Math.round(f.v);
    if (family === "trax" && v === MOMENT.FIRST_TRAIN) {
      return { ...base, text: `${when} · the morning's first train: ${schedule.routeName(f.route)} from ${schedule.stopName(f.stop)}`, receipt: "scheduled" };
    }
    if (family === "trax" && v === MOMENT.LAST_TRAIN) {
      return { ...base, text: `${when} · the night's last train: ${schedule.routeName(f.route)} from ${schedule.stopName(f.stop)}`, receipt: "scheduled" };
    }
    if (family === "sky" && v === MOMENT.SUNRISE) return { ...base, text: `${when} · the sun clears the Wasatch`, receipt: "scheduled" };
    if (family === "sky" && v === MOMENT.SUNSET) return { ...base, text: `${when} · the sun drops behind the Oquirrhs`, receipt: "scheduled" };
    if (family === "skibus" && v === MOMENT.FIRST_SKI) {
      const r = schedule.network.routes[f.route];
      return { ...base, text: `${when} · the first ski bus ${SKI_ROUTE[r?.short ?? ""] ?? "up the canyon"}`, receipt: "scheduled" };
    }
    if (family === "quake") return { ...base, text: `${when} · M${f.v.toFixed(1)} earthquake`, receipt: "live", observed: f.ev };
    if (family === "theme") return { ...base, text: `${when} · first light, and the Wasatch theme in ${keyName(key)}`, receipt: "scheduled" };
    return null;
  }
  switch (family) {
    case "trax": {
      const route = schedule.routeName(f.route);
      const stop = schedule.stopName(f.stop);
      if (f.obs) return { ...base, text: `${route} left ${stop}${Math.abs(f.late) < 60 ? " on time" : `, ${lateness(f.late)}`}`, receipt: "live", observed: f.ev };
      return { ...base, text: `${route} leaving ${stop} at ${mountainTime(f.ev)}`, receipt: "scheduled" };
    }
    case "frontrunner":
      if (f.obs) return { ...base, text: `FrontRunner pulled into Salt Lake Central${Math.abs(f.late) < 60 ? " on time" : `, ${lateness(f.late)}`}`, receipt: "live", observed: f.ev };
      return { ...base, text: `FrontRunner due at Salt Lake Central at ${mountainTime(f.ev)}`, receipt: "scheduled" };
    case "skibus": {
      const r = schedule.network.routes[f.route];
      const where = SKI_ROUTE[r?.short ?? ""] ?? "up the canyon";
      return { ...base, text: `Ski bus ${r?.short ?? ""} heading ${where}`.replace("  ", " "), receipt: "scheduled" };
    }
    case "bike":
      return {
        ...base,
        text: `A GREENbike ${f.v < 0 ? "checked out" : "returned"} at ${valley.bikeStation(f.stop)}`,
        receipt: "live",
        observed: f.ev,
      };
    case "quake": {
      const q = valley.quakes.find((x) => Math.abs(x.originMs - f.ev) < 1000);
      const where = q ? ` · ${q.place}` : "";
      return { ...base, text: `M${f.v.toFixed(1)} earthquake${where}`, receipt: "live", observed: f.ev };
    }
    case "theme":
      return { ...base, text: `The Wasatch theme in ${keyName(key)}`, receipt: "scheduled" };
    case "lake": {
      const lake = valley.lake;
      if (!lake) return null;
      const below = 4198 - lake.ft;
      const text = below > 0 ? `Great Salt Lake ${fmt1(lake.ft)} ft · ${fmt1(below)} ft below healthy` : `Great Salt Lake ${fmt1(lake.ft)} ft · healthy, so phrases come home`;
      return { ...base, text, receipt: lake.receipt, observed: lake.observed };
    }
    case "ground": {
      const g = valley.ground;
      if (!g) return skyCaption(base, valley, key);
      return {
        ...base,
        text: `The city's rumble under ${g.station}: ${Math.round(g.level * 100)}% of a busy day there`,
        receipt: g.receipt,
        observed: g.observed,
      };
    }
    case "wind": {
      const mph = Math.round(f.v * 2.237);
      const where = valley.keyed?.measured.wind ? "measured up the canyons" : "on the ridges";
      return { ...base, text: `Gusts to ${mph} mph ${where}, so the harp sounds higher`, receipt: valley.wind?.receipt ?? "live", observed: valley.wind?.observed };
    }
    case "snow":
      return { ...base, text: `Snow falling in the Cottonwoods: the sparkle`, receipt: valley.snow?.receipt ?? "live", observed: valley.snow?.observed };
    case "sky":
      return skyCaption(base, valley, key);
    case "air": {
      const air = valley.air;
      if (!air || !Number.isFinite(air.pm25)) return null;
      const measured = valley.keyed?.measured.air && valley.keyed.airnow;
      if (measured && air.inversionC < 4) {
        return { ...base, text: `AQI ${measured.aqi}, ${measured.category.toLowerCase()}, measured at the valley's monitors: ${air.pm25 >= 12 ? "haze on the pad" : "every ridge in the skyline"}`, receipt: air.receipt, observed: air.observed };
      }
      const pm = Math.round(air.pm25);
      const inversion = air.inversionC >= 4;
      const text = inversion
        ? `Inversion: ${fmt1(air.inversionC)} °C warmer aloft, PM2.5 ${pm}, a lid on the reverb`
        : pm >= 35.5
          ? `Unhealthy air, PM2.5 ${pm}: the skyline's a silhouette`
          : pm >= 12
            ? `Hazy, PM2.5 ${pm}: haze on the pad`
            : `Clean air, PM2.5 ${pm}: every ridge in the skyline`;
      return { ...base, text, receipt: air.receipt, observed: air.observed };
    }
    case "river": {
      const r = valley.river;
      if (!r) return null;
      const pct = Math.round(r.position * 100);
      const how = r.position >= 0.75 ? "running high, so the bass walks" : r.position <= 0.25 ? "running low, so the bass holds long notes" : "about usual for the date";
      const gauges = r.gauges ?? [];
      const flows = gauges.length > 1 ? list(gauges.map((g) => `${g.name} ${Math.round(g.cfs)} cfs`)) : `Jordan River ${Math.round(r.cfs)} cfs`;
      return { ...base, text: `${flows}, ${ordinal(pct)} percentile${gauges.length > 1 ? " together" : ""}: ${how}`, receipt: r.receipt, observed: r.observed };
    }
    case "buses": {
      const perMinute = Math.round(f.v);
      const out = valley.busesOut;
      return out
        ? { ...base, text: `${out.count.toLocaleString("en-US")} buses out, making ${perMinute} stops a minute: the hats and shakers`, receipt: "live", observed: out.observed }
        : { ...base, text: `Buses making ${perMinute} stops a minute: the hats and shakers`, receipt: "scheduled" };
    }
    case "late": {
      const min = Math.round(f.v / 60);
      const ms = Math.round(Math.min(30, f.v / 6));
      return { ...base, text: `Trains running ${min} min late on average: the drums lay back ${ms} ms`, receipt: "live" };
    }
    case "alert": {
      const a = valley.alerts;
      if (!a?.names.length) return null;
      return { ...base, text: `${a.names[0]} for the valley: tension, and fills in the drums`, receipt: a.receipt, observed: a.observed };
    }
    case "plane": {
      const row = valley.plane?.(f.ev);
      const ft = Math.round(f.v / 100) * 100;
      const arriving = f.route === 1;
      const name = row?.[7] || "A plane";
      const text = arriving ? `${name} coming in to land at SLC, down through ${ft.toLocaleString("en-US")} ft` : `${name} taking off from SLC, climbing through ${ft.toLocaleString("en-US")} ft`;
      return { ...base, text, receipt: "live", observed: f.ev };
    }
    case "service": {
      const row = valley.serviceAlert?.(f.ev);
      if (!row) return { ...base, text: "A new UTA service alert: a fill in the drums", receipt: "live", observed: f.ev };
      const [, kind, , routes, headline] = row;
      const bus = kind === 0 || kind === 3;
      const named = routes ? (bus ? ` for route${routes.includes(",") ? "s" : ""} ${routes}` : ` on ${routes}`) : "";
      return { ...base, text: `UTA alert${named}: ${headline}`, receipt: "live", observed: f.ev };
    }
    case "storm": {
      const inches = Math.round(f.v / 25.4);
      return { ...base, text: `${inches} in of snow forecast at Alta in the next day: the harmony holds in suspense until it falls`, receipt: "live" };
    }
    case "grid": {
      const g = valley.grid;
      if (!g) return null;
      const pct = Math.round((g.energy - 1) * 100);
      const how = pct >= 2 ? `${pct}% above usual for the hour, so the mix swells` : pct <= -2 ? `${-pct}% below usual for the hour, so the mix eases off` : "about usual for the hour";
      return { ...base, text: `The grid's drawing ${g.mw.toLocaleString("en-US")} MW, ${how}`, receipt: g.receipt, observed: g.observed };
    }
    case "road": {
      const row = valley.road?.(f.ev);
      const where = row?.[5] ? row[5] : CANYONS[f.stop] ?? "the valley";
      const words = row?.[6] ? `: ${row[6]}` : "";
      if (f.route === 2) return { ...base, text: `Avalanche control up ${CANYONS[f.stop] ?? "the canyon"}: a boom in its echo`, receipt: "live", observed: f.ev };
      if (f.route === 1) return { ...base, text: `Cleared on ${where}, and the harmony comes home`, receipt: "live", observed: f.ev };
      return { ...base, text: `Trouble on ${where}${words}`, receipt: "live", observed: f.ev };
    }
    case "traction": {
      const v = Math.round(f.v);
      const up = v === 3 ? "Little and Big Cottonwood" : v === 2 ? "Big Cottonwood" : "Little Cottonwood";
      return { ...base, text: `Traction law up ${up}: a low brass pedal from the canyon`, receipt: "live" };
    }
    case "plows": {
      const n = Math.round(f.v);
      return { ...base, text: `${n} snowplows out in the valley while it snows: brushes in the drums`, receipt: "live" };
    }
    case "due": {
      const min = Math.max(1, Math.round(f.v));
      return { ...base, text: `FrontRunner due at Salt Lake Central in ${min} min: the phrase it pulls in on turns for home`, receipt: "live" };
    }
  }
  return null;
}

/** 1st, 2nd, 3rd, 4th… */
function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

function skyCaption(base: { at: number; intro?: string }, valley: ValleyNow, key: Key): Caption | null {
  const sky = valley.sky;
  if (!sky || !sky.description) return null;
  // The sky picks how bright the mode is: Lydian and major bright, minor dark.
  const lean = key.r <= 1 ? "so the mode is bright" : key.r >= 3 ? "so the mode leans dark" : "so the mode sits in between";
  return { ...base, family: "sky", text: `${sky.description} over the valley, ${lean}: ${keyName(key)}`, receipt: sky.receipt, observed: sky.observed };
}

export { fmt1 };

/** The places, as the engine has them (engine/src/audio/space.rs). */
export const PLACES: Record<number, { lat: number; lon: number; face: number; name: string }> = {
  1: { lat: 40.7647, lon: -111.891, face: 90, name: "The Gallivan Center, downtown" },
  2: { lat: 40.5714, lon: -111.7027, face: 75, name: "Tanners Flat, up Little Cottonwood" },
  3: { lat: 40.7651, lon: -112.1745, face: 90, name: "Saltair, on the lake" },
};

/** The families in a vantage event's order, as a listener would name them. */
const NEAR_NAMES = ["the mountains", "the city's groove", "the lake", "the river", "the wind", "the snow"];
/** Which to name first: what a listener notices most. */
const PROMINENCE = ["the trains", "the city's groove", "the mountains", "the lake", "the wind", "the river", "the snow"];

function list(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
}

/** What a move sounds like: "From Saltair on the lake's shore: the lake's
 * drone up close; the city's groove and the trains far off." */
export function vantageCaption(e: Heard<VantageEvent>): Caption {
  const place = PLACES[e.v];
  const base = { receipt: "here" as const, at: e.at, family: "vantage" as const, intro: INTROS.vantage };
  if (!place) return { ...base, text: "The whole valley, as a map: west on your left, east on your right" };
  const heard = [...NEAR_NAMES.map((name, i) => ({ name, g: e.near[i] ?? 1 })), { name: "the trains", g: e.rail }].sort(
    (a, b) => PROMINENCE.indexOf(a.name) - PROMINENCE.indexOf(b.name),
  );
  const near = heard.filter((h) => h.g >= 0.8).slice(0, 2);
  const far = heard.filter((h) => h.g <= 0.45).slice(0, 2);
  const parts = [near.length ? `${list(near.map((h) => h.name))} up close` : "", far.length ? `${list(far.map((h) => h.name))} far off` : ""].filter(Boolean);
  return { ...base, text: `${place.name}${parts.length ? `: ${parts.join("; ")}` : ""}` };
}
