// What the listener reads: every heard event as a trail sign, with a receipt
// saying where it came from. The first time a family sounds, its caption says
// what the family is; after that, captions are short.

import type { BarEvent, FeatureEvent, Heard } from "../engine/host.ts";
import type { Receipt } from "../data/feeds.ts";
import { changedNote, keyName, type Key } from "./music.ts";
import type { Schedule } from "./schedule.ts";

export interface Caption {
  text: string;
  /** Said once, the first time this family sounds. */
  intro?: string;
  receipt: Receipt;
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
  | "harmony";

const FEATURE_FAMILY: Family[] = ["trax", "frontrunner", "skibus", "bike", "quake", "theme", "lake", "ground", "wind", "snow", "sky", "harmony"];

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
  return c.observed ? `${c.receipt} ${mountainTime(c.observed)}` : c.receipt;
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
  ground?: { station: string; receipt: Receipt; observed: number };
}

const SKI_ROUTE: Record<string, string> = {
  "972": "up Big Cottonwood to Solitude and Brighton",
  "994": "up Little Cottonwood to Snowbird and Alta",
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
  const swap = changedNote(from, to);
  if (swap) text += ` (${swap[0]} for ${swap[1]})`;
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
      return { ...base, text: `${route} · ${schedule.stopName(f.stop)} · departing ${mountainTime(f.ev)}`, receipt: "scheduled" };
    }
    case "frontrunner":
      return { ...base, text: `FrontRunner at Salt Lake Central · ${mountainTime(f.ev)}`, receipt: "scheduled" };
    case "skibus": {
      const r = schedule.network.routes[f.route];
      const where = SKI_ROUTE[r?.short ?? ""] ?? "up the canyon";
      return { ...base, text: `Ski bus ${r?.short ?? ""} ${where}`.replace("  ", " "), receipt: "scheduled" };
    }
    case "bike":
      return {
        ...base,
        text: `GREENbike · a bike ${f.v < 0 ? "out" : "back"} at ${valley.bikeStation(f.stop)}`,
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
      return { ...base, text: `The ground at ${g.station}`, receipt: g.receipt, observed: g.observed };
    }
    case "wind": {
      const mph = Math.round(f.v * 2.237);
      return { ...base, text: `Gusts to ${mph} mph on the ridges`, receipt: valley.wind?.receipt ?? "live", observed: valley.wind?.observed };
    }
    case "snow":
      return { ...base, text: `Snow falling in the Cottonwoods`, receipt: valley.snow?.receipt ?? "live", observed: valley.snow?.observed };
    case "sky":
      return skyCaption(base, valley, key);
  }
  return null;
}

function skyCaption(base: { at: number; intro?: string }, valley: ValleyNow, key: Key): Caption | null {
  const sky = valley.sky;
  if (!sky || !sky.description) return null;
  return { ...base, family: "sky", text: `${sky.description} over the valley · ${keyName(key)}`, receipt: sky.receipt, observed: sky.observed };
}

export { fmt1 };
