// Compiles UTA's GTFS into the score the browser engine plays.
//
//   node tools/gtfs/compile.ts [--zip <path|url>] [--out web/public/schedule] [--days 9]
//                              [--previous <dir|url>]
//
// With --previous (the deployed schedule, e.g. https://ampactor.dev/wasatch/
// schedule), the network stays append-only, so stations, routes and
// headsigns keep their indices from build to build, and every past date the
// previous build had stays in the manifest with its day file: the archive
// that Rewind and A Day in Twelve Minutes reach back into. Day files are
// keyed by the feed and the services together, so a new feed that reuses a
// service id never overwrites an archived day.
//
// Writes manifest.json, network.json and one day-<key>.json per distinct set
// of running services, for every date from yesterday through --days ahead in
// America/Denver. Earlier dates since the feed took effect that no build
// kept are rebuilt from it, since it was the published timetable then, and
// listed in the manifest's `rebuilt`. Times are seconds since the service day's GTFS reference
// time (local noon minus 12 h; manifest.t0 gives it per date) and may exceed
// 86,400.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";
import { readCsv } from "./csv.ts";
import {
  activeServices,
  addDays,
  denverDate,
  distanceM,
  gtfsDateToIso,
  parseTime,
  round5,
  serviceDayT0,
  simplify,
  TIMEZONE,
  tidyName,
  type CalendarException,
  type CalendarRow,
} from "./util.ts";

const FEED_URL = "https://gtfsfeed.rideuta.com/GTFS.zip";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const CACHE = join(HERE, ".cache", "GTFS.zip");
const MINUTES = 1800; // 30 hours of service day
const WEST_EAST_LON = -111.89;
const SIMPLIFY_M = 8;
const STATION_MERGE_M = 400;
const NEEDED = [
  "routes.txt",
  "trips.txt",
  "stop_times.txt",
  "stops.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "shapes.txt",
  "feed_info.txt",
];

type Kind = "trax" | "sline" | "frontrunner" | "ski";

interface Args {
  zip: string | null;
  out: string;
  days: number;
  previous: string | null;
}

/** How long the archive keeps a past date. */
const ARCHIVE_DAYS = 400;

interface PreviousNetwork {
  routes: { id: string; short: string; name: string; type: number; kind: string; color: string; text: string }[];
  stops: { id: string; ids: string[]; name: string; lat: number; lon: number }[];
  shapes: { r: number; d: number; pts: [number, number][] }[];
  headsigns: string[];
}

interface PreviousManifest {
  days: Record<string, string>;
  t0: Record<string, number>;
  sky?: Record<string, string>;
  rebuilt?: string[];
}

/** Read a file of the previous build, from a directory or a URL. */
async function previousFile(src: string, name: string): Promise<string | null> {
  try {
    if (/^https?:/.test(src)) {
      const res = await fetch(`${src.replace(/\/$/, "")}/${name}`, { cache: "no-store" });
      return res.ok ? await res.text() : null;
    }
    const path = join(src, name);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = { zip: null, out: join(REPO, "web/public/schedule"), days: 9, previous: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === "--zip" && v !== undefined) {
      args.zip = v;
      i++;
    } else if (a === "--out" && v !== undefined) {
      args.out = isAbsolute(v) ? v : resolve(process.cwd(), v);
      i++;
    } else if (a === "--days" && v !== undefined) {
      args.days = Math.max(0, Math.floor(Number(v)));
      i++;
    } else if (a === "--previous" && v !== undefined) {
      args.previous = v;
      i++;
    } else {
      throw new Error(`unknown argument ${a}`);
    }
  }
  return args;
}

async function loadZip(zip: string | null): Promise<{ bytes: Uint8Array; url: string }> {
  if (zip !== null && !/^https?:/i.test(zip)) {
    return { bytes: new Uint8Array(readFileSync(zip)), url: resolve(zip) };
  }
  const url = zip ?? FEED_URL;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "wasatch-symphony (github.com/ampactor-labs/wasatch)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, bytes);
    return { bytes, url };
  } catch (err) {
    if (existsSync(CACHE)) {
      console.warn(`download failed (${String(err)}); using the cached feed at ${CACHE}`);
      return { bytes: new Uint8Array(readFileSync(CACHE)), url };
    }
    throw err;
  }
}

function color(hex: string | undefined, fallback: string): string {
  const h = (hex ?? "").trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toUpperCase()}` : fallback;
}

const FALLBACK_COLORS: [RegExp, string][] = [
  [/red/i, "#BE2036"],
  [/blue/i, "#004A97"],
  [/green/i, "#2EB566"],
  [/s-?line|streetcar/i, "#77777A"],
  [/frontrunner/i, "#C227B9"],
];

const SKI_WORDS = /\b(snowbird|alta|solitude|brighton)\b/i;

/** Growable Int32 column. */
class Column {
  data = new Int32Array(1 << 19);
  length = 0;
  push(v: number) {
    if (this.length === this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeJson(path: string, value: unknown): number {
  const text = JSON.stringify(value);
  writeFileSync(path, text);
  return text.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = performance.now();
  const { bytes, url } = await loadZip(args.zip);
  const feedSha = sha256(bytes);
  // The previous build, if any: its network seeds this one, its past dates carry over.
  const prevNetworkText = args.previous ? await previousFile(args.previous, "network.json") : null;
  const prevManifestText = args.previous ? await previousFile(args.previous, "manifest.json") : null;
  const prevNetwork = prevNetworkText ? (JSON.parse(prevNetworkText) as PreviousNetwork) : null;
  const prevManifest = prevManifestText ? (JSON.parse(prevManifestText) as PreviousManifest) : null;
  // One without the other means the previous build answered only in part:
  // building on that could drop archived days for good, so don't.
  if (args.previous && !prevNetwork !== !prevManifest) {
    throw new Error(`the previous build at ${args.previous} answered in part; not building on it`);
  }
  if (args.previous) console.log(`previous build: ${prevNetwork ? `${prevNetwork.stops.length} stations` : "none"}, ${prevManifest ? Object.keys(prevManifest.days).length : 0} dates`);
  const files = unzipSync(bytes, { filter: (f) => NEEDED.includes(f.name) });
  const decoder = new TextDecoder("utf-8");
  const text = (name: string): string => {
    const f = files[name];
    if (f === undefined) throw new Error(`${name} is missing from the feed`);
    return decoder.decode(f);
  };
  const optionalText = (name: string): string => (files[name] ? text(name) : "");

  // --- routes ---------------------------------------------------------------
  interface Route {
    id: string;
    short: string;
    name: string;
    type: number;
    color: string;
    text: string;
  }
  const routes: Route[] = [];
  const routeIndex = new Map<string, number>();
  {
    readCsv(text("routes.txt"), (f, h) => {
      const get = (c: string) => (f[h.col(c)] ?? "").trim();
      routeIndex.set(get("route_id"), routes.length);
      const short = get("route_short_name");
      const name = get("route_long_name");
      const label = `${short} ${name}`;
      const fallback = FALLBACK_COLORS.find(([re]) => re.test(label))?.[1] ?? "#1B1F3B";
      routes.push({
        id: get("route_id"),
        short,
        name,
        type: Number(get("route_type")),
        color: color(get("route_color"), fallback),
        text: color(get("route_text_color"), "#FFFFFF"),
      });
    });
  }

  // --- trips ----------------------------------------------------------------
  const tripIndex = new Map<string, number>();
  const tripRoute: number[] = [];
  const tripIds: string[] = [];
  const tripService: number[] = [];
  const tripDir: number[] = [];
  const tripHeadsign: string[] = [];
  const tripShape: string[] = [];
  const serviceIndex = new Map<string, number>();
  const serviceIds: string[] = [];
  {
    readCsv(text("trips.txt"), (f, h) => {
      const get = (c: string) => (f[h.col(c)] ?? "").trim();
      const route = routeIndex.get(get("route_id"));
      if (route === undefined) return;
      const sid = get("service_id");
      let s = serviceIndex.get(sid);
      if (s === undefined) {
        s = serviceIds.length;
        serviceIds.push(sid);
        serviceIndex.set(sid, s);
      }
      tripIndex.set(get("trip_id"), tripRoute.length);
      tripIds.push(get("trip_id"));
      tripRoute.push(route);
      tripService.push(s);
      tripDir.push(Number(get("direction_id") || 0));
      tripHeadsign.push(tidyName(get("trip_headsign")));
      tripShape.push(get("shape_id"));
    });
  }

  // --- classify routes --------------------------------------------------------
  const kindOf = new Map<number, Kind>();
  routes.forEach((r, i) => {
    const label = `${r.short} ${r.name}`;
    if (r.type === 2) kindOf.set(i, "frontrunner");
    else if (r.type === 0) kindOf.set(i, /s-?line|streetcar/i.test(label) || r.short === "720" ? "sline" : "trax");
    else if (r.type === 3 && (r.short === "994" || r.short === "972" || SKI_WORDS.test(r.name))) kindOf.set(i, "ski");
  });
  for (let t = 0; t < tripRoute.length; t++) {
    const r = tripRoute[t]!;
    if (!kindOf.has(r) && routes[r]!.type === 3 && SKI_WORDS.test(tripHeadsign[t]!)) kindOf.set(r, "ski");
  }
  const isRail = (r: number) => {
    const k = kindOf.get(r);
    return k === "trax" || k === "sline" || k === "frontrunner";
  };
  const isSki = (r: number) => kindOf.get(r) === "ski";

  // --- stops ----------------------------------------------------------------
  const stopIndex = new Map<string, number>();
  const stopIds: string[] = [];
  const stopName: string[] = [];
  const stopLat: number[] = [];
  const stopLon: number[] = [];
  const stopParent: string[] = [];
  {
    readCsv(text("stops.txt"), (f, h) => {
      const get = (c: string) => (f[h.col(c)] ?? "").trim();
      stopIndex.set(get("stop_id"), stopIds.length);
      stopIds.push(get("stop_id"));
      stopName.push(tidyName(get("stop_name")));
      stopLat.push(Number(get("stop_lat")));
      stopLon.push(Number(get("stop_lon")));
      stopParent.push(get("parent_station"));
    });
  }

  // --- calendars ------------------------------------------------------------
  const calendar: CalendarRow[] = [];
  {
    readCsv(optionalText("calendar.txt"), (f, h) => {
      const get = (c: string) => (f[h.col(c)] ?? "").trim();
      const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map(
        (d) => get(d) === "1",
      );
      calendar.push({
        serviceId: get("service_id"),
        days,
        start: gtfsDateToIso(get("start_date")),
        end: gtfsDateToIso(get("end_date")),
      });
    });
  }
  const exceptions: CalendarException[] = [];
  {
    readCsv(optionalText("calendar_dates.txt"), (f, h) => {
      const get = (c: string) => (f[h.col(c)] ?? "").trim();
      const type = Number(get("exception_type"));
      if (type !== 1 && type !== 2) return;
      exceptions.push({ serviceId: get("service_id"), date: gtfsDateToIso(get("date")), type });
    });
  }
  let feedStart = "";
  let feedEnd = "";
  {
    readCsv(optionalText("feed_info.txt"), (f, h) => {
      const get = (c: string) => (f[h.col(c)] ?? "").trim();
      if (get("feed_start_date")) feedStart = gtfsDateToIso(get("feed_start_date"));
      if (get("feed_end_date")) feedEnd = gtfsDateToIso(get("feed_end_date"));
    });
  }

  // --- stop_times, into columns ---------------------------------------------
  const stTrip = new Column();
  const stSeq = new Column();
  const stSec = new Column();
  const stStop = new Column();
  let skippedTimes = 0;
  let skippedRelief = 0;
  {
    readCsv(text("stop_times.txt"), (f, h) => {
      const trip = tripIndex.get((f[h.col("trip_id")] ?? "").trim());
      if (trip === undefined) return;
      const stop = stopIndex.get((f[h.col("stop_id")] ?? "").trim());
      if (stop === undefined) return;
      // Operator relief points (no pickup and no drop-off) aren't stops a
      // rider sees; UTA lists three of them in trips.
      if ((f[h.col("pickup_type")] ?? "").trim() === "1" && (f[h.col("drop_off_type")] ?? "").trim() === "1") {
        skippedRelief++;
        return;
      }
      let sec = parseTime(f[h.col("departure_time")]);
      if (Number.isNaN(sec)) sec = parseTime(f[h.col("arrival_time")]);
      if (Number.isNaN(sec)) {
        skippedTimes++; // untimed intermediate stops: rare in UTA's feed
        return;
      }
      stTrip.push(trip);
      stSeq.push(Number((f[h.col("stop_sequence")] ?? "0").trim()));
      stSec.push(sec);
      stStop.push(stop);
    });
  }
  // Group by trip (counting sort), then order each trip by stop_sequence.
  const tripCount = tripRoute.length;
  const tripStart = new Int32Array(tripCount + 1);
  for (let i = 0; i < stTrip.length; i++) tripStart[stTrip.data[i]! + 1]!++;
  for (let t = 0; t < tripCount; t++) tripStart[t + 1]! += tripStart[t]!;
  const order = new Int32Array(stTrip.length);
  {
    const fill = tripStart.slice(0, tripCount);
    for (let i = 0; i < stTrip.length; i++) order[fill[stTrip.data[i]!]!++] = i;
  }
  const tripStops = (t: number): { seq: number; stop: number; sec: number }[] => {
    const rows: { seq: number; stop: number; sec: number }[] = [];
    for (let k = tripStart[t]!; k < tripStart[t + 1]!; k++) {
      const i = order[k]!;
      rows.push({ seq: stSeq.data[i]!, stop: stStop.data[i]!, sec: stSec.data[i]! });
    }
    rows.sort((a, b) => a.seq - b.seq);
    return rows;
  };

  // --- network: routes, stations, shapes, headsigns -------------------------
  const kindRank: Record<Kind, number> = { trax: 0, sline: 1, frontrunner: 2, ski: 3 };
  const liveRoutes = [...kindOf.entries()]
    .sort((a, b) => kindRank[a[1]] - kindRank[b[1]] || routes[a[0]]!.short.localeCompare(routes[b[0]]!.short))
    .map(([i, kind]) => ({ i, kind }));
  // Append-only: a route keeps the index it had; one the feed dropped stays
  // as it was, so archived days still name it.
  type OutRoute = { i: number; kind: Kind } | { ghost: PreviousNetwork["routes"][number] };
  const outRoutes: OutRoute[] = (prevNetwork?.routes ?? []).map((pr) => {
    const live = liveRoutes.find((r) => routes[r.i]!.id === pr.id);
    return live ?? { ghost: pr };
  });
  for (const r of liveRoutes) if (!outRoutes.some((o) => "i" in o && o.i === r.i)) outRoutes.push(r);
  const outRouteIndex = new Map<number, number>();
  outRoutes.forEach((r, k) => {
    if ("i" in r) outRouteIndex.set(r.i, k);
  });

  // Stations: every stop a rail trip uses, plus the ski buses' first stops.
  // UTA's platforms have no parent_station, so same-named stops within 400 m
  // merge into one station (one per direction and line become one).
  interface Station {
    id: string;
    ids: string[];
    name: string;
    lat: number;
    lon: number;
    key: string;
  }
  const stations: Station[] = [];
  const stationOf = new Map<number, number>();
  const normalize = (name: string) =>
    name
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\s*station$/, "")
      .trim();
  // Append-only: the previous build's stations keep their indices.
  for (const st of prevNetwork?.stops ?? []) {
    stations.push({ id: st.id, ids: [...st.ids], name: st.name, lat: st.lat, lon: st.lon, key: normalize(st.name) });
  }
  const addStation = (stop: number): number => {
    const known = stationOf.get(stop);
    if (known !== undefined) return known;
    let s = stop;
    const parent = stopParent[stop];
    if (parent) {
      const p = stopIndex.get(parent);
      if (p !== undefined) s = p;
    }
    const key = normalize(stopName[s]!);
    const here: [number, number] = [stopLat[s]!, stopLon[s]!];
    let found = stations.findIndex(
      (st) => st.key === key && distanceM([st.lat, st.lon], here) < STATION_MERGE_M,
    );
    if (found === -1) {
      found = stations.length;
      stations.push({ id: stopIds[s]!, ids: [], name: stopName[s]!, lat: here[0], lon: here[1], key });
    }
    const st = stations[found]!;
    if (!st.ids.includes(stopIds[stop]!)) st.ids.push(stopIds[stop]!);
    stationOf.set(stop, found);
    return found;
  };

  const headsigns: string[] = [...(prevNetwork?.headsigns ?? [])];
  const headsignIndex = new Map<string, number>(headsigns.map((h, k) => [h, k]));
  const headsignOf = (t: number): number => {
    const h = tripHeadsign[t]!;
    let k = headsignIndex.get(h);
    if (k === undefined) {
      k = headsigns.length;
      headsigns.push(h);
      headsignIndex.set(h, k);
    }
    return k;
  };

  // Pre-register stations for every rail trip in the feed and the ski first
  // stops, so station indices are the same in every day file.
  const shapeCandidates = new Map<string, Set<string>>(); // "route|dir" -> shape ids
  for (let t = 0; t < tripCount; t++) {
    const r = tripRoute[t]!;
    if (isRail(r)) {
      for (const row of tripStops(t)) addStation(row.stop);
      headsignOf(t);
      const key = `${r}|${tripDir[t]}`;
      if (tripShape[t]) {
        let set = shapeCandidates.get(key);
        if (!set) shapeCandidates.set(key, (set = new Set()));
        set.add(tripShape[t]!);
      }
    } else if (isSki(r)) {
      const rows = tripStops(t);
      if (rows.length > 0) addStation(rows[0]!.stop);
      headsignOf(t);
    }
  }

  // Shapes: only the ones rail trips use.
  const wantedShapes = new Set<string>();
  for (const set of shapeCandidates.values()) for (const s of set) wantedShapes.add(s);
  const shapePts = new Map<string, { seq: number; lat: number; lon: number }[]>();
  {
    readCsv(text("shapes.txt"), (f, h) => {
      const id = (f[h.col("shape_id")] ?? "").trim();
      if (!wantedShapes.has(id)) return;
      let pts = shapePts.get(id);
      if (!pts) shapePts.set(id, (pts = []));
      pts.push({
        seq: Number((f[h.col("shape_pt_sequence")] ?? "0").trim()),
        lat: Number((f[h.col("shape_pt_lat")] ?? "").trim()),
        lon: Number((f[h.col("shape_pt_lon")] ?? "").trim()),
      });
    });
  }
  const shapeLength = (pts: [number, number][]) => {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += distanceM(pts[i - 1]!, pts[i]!);
    return len;
  };
  const outShapes: { r: number; d: number; pts: [number, number][] }[] = [];
  for (const [key, set] of [...shapeCandidates.entries()].sort()) {
    const [r, d] = key.split("|").map(Number) as [number, number];
    let best: [number, number][] = [];
    let bestLen = -1;
    for (const id of set) {
      const raw = shapePts.get(id);
      if (!raw) continue;
      raw.sort((a, b) => a.seq - b.seq);
      const pts = raw.map((p) => [p.lat, p.lon] as [number, number]);
      const len = shapeLength(pts);
      if (len > bestLen) {
        bestLen = len;
        best = pts;
      }
    }
    if (best.length === 0) continue;
    const simplified = simplify(best, SIMPLIFY_M).map(([lat, lon]) => [round5(lat), round5(lon)] as [number, number]);
    outShapes.push({ r: outRouteIndex.get(r)!, d, pts: simplified });
  }
  // A route the feed dropped keeps its previous shapes.
  outRoutes.forEach((r, k) => {
    if ("ghost" in r) for (const sh of prevNetwork?.shapes ?? []) if (sh.r === k) outShapes.push(sh);
  });
  outShapes.sort((a, b) => a.r - b.r || a.d - b.d);

  // --- dates and their service sets -----------------------------------------
  const today = denverDate(Date.now());
  const dates: string[] = [];
  for (let k = -1; k <= args.days; k++) dates.push(addDays(today, k));
  // The archive, filled in: every date since this feed took effect (within
  // the archive's reach) that no earlier build kept, rebuilt from this feed.
  const reach = addDays(today, -ARCHIVE_DAYS);
  const rebuilt: string[] = [];
  if (feedStart) {
    for (let d = feedStart > reach ? feedStart : reach; d < dates[0]!; d = addDays(d, 1)) {
      if (!prevManifest || !(d in prevManifest.days)) rebuilt.push(d);
    }
  }
  const dayKey = new Map<string, string>();
  const keyServices = new Map<string, string[]>();
  for (const date of [...rebuilt, ...dates]) {
    const services = activeServices(date, calendar, exceptions);
    const key = sha256(`${feedSha}:${services.join(",")}`).slice(0, 10);
    dayKey.set(date, key);
    keyServices.set(key, services);
  }

  // --- day files --------------------------------------------------------------
  mkdirSync(args.out, { recursive: true });
  const written: { file: string; bytes: number }[] = [];
  const dayStats: Record<string, { rail: number; bus: number; ski: number; trips: number; railTrips: number }> = {};
  for (const [key, services] of keyServices) {
    const running = new Set(services.map((s) => serviceIndex.get(s)).filter((s) => s !== undefined));
    const rail: { r: number; d: number; h: number; s: number[]; t: number[] }[] = [];
    // For the conductor: each rail trip's GTFS id and stop sequences, to
    // match UTA's realtime to it (rt-<key>.json, aligned with rail).
    const railIds = new Map<object, { id: string; q: number[] }>();
    const ski: { r: number; t: number; h: number }[] = [];
    const perMinute = new Array<number>(MINUTES).fill(0);
    const west = new Array<number>(MINUTES).fill(0);
    const east = new Array<number>(MINUTES).fill(0);
    // Vehicles in service each minute: every trip from its first stop to its last.
    const active = new Array<number>(MINUTES).fill(0);
    const inService = (first: number, last: number) => {
      const a = Math.min(MINUTES - 1, Math.max(0, Math.floor(first / 60)));
      const b = Math.min(MINUTES - 1, Math.max(0, Math.floor(last / 60)));
      for (let m = a; m <= b; m++) active[m]!++;
    };
    let railEvents = 0;
    let busEvents = 0;
    let skiEvents = 0;
    let trips = 0;
    for (let t = 0; t < tripCount; t++) {
      if (!running.has(tripService[t]!)) continue;
      const r = tripRoute[t]!;
      trips++;
      if (isRail(r)) {
        const rows = tripStops(t);
        if (rows.length === 0) continue;
        rail.push({
          r: outRouteIndex.get(r)!,
          d: tripDir[t]!,
          h: headsignOf(t),
          s: rows.map((row) => addStation(row.stop)),
          t: rows.map((row) => row.sec),
        });
        railIds.set(rail.at(-1)!, { id: tripIds[t]!, q: rows.map((row) => row.seq) });
        inService(rows[0]!.sec, rows.at(-1)!.sec);
        railEvents += rows.length;
      } else if (isSki(r)) {
        const rows = tripStops(t);
        if (rows.length === 0) continue;
        ski.push({ r: outRouteIndex.get(r)!, t: rows[0]!.sec, h: headsignOf(t) });
        inService(rows[0]!.sec, rows.at(-1)!.sec);
        skiEvents += rows.length;
      } else if (routes[r]!.type === 3) {
        let first = Infinity;
        let last = -Infinity;
        for (let k = tripStart[t]!; k < tripStart[t + 1]!; k++) {
          const i = order[k]!;
          first = Math.min(first, stSec.data[i]!);
          last = Math.max(last, stSec.data[i]!);
          const minute = Math.min(MINUTES - 1, Math.max(0, Math.floor(stSec.data[i]! / 60)));
          perMinute[minute]!++;
          if (stopLon[stStop.data[i]!]! < WEST_EAST_LON) west[minute]!++;
          else east[minute]!++;
          busEvents++;
        }
        if (first <= last) inService(first, last);
      }
    }
    rail.sort((a, b) => a.t[0]! - b.t[0]! || a.r - b.r);
    ski.sort((a, b) => a.t - b.t);
    const day = {
      version: 1,
      key,
      serviceIds: services,
      rail,
      ski,
      bus: { perMinute, west, east },
      active,
      counts: {
        railStopEvents: railEvents,
        busStopEvents: busEvents,
        skiStopEvents: skiEvents,
        trips,
        railTrips: rail.length,
      },
    };
    const file = `day-${key}.json`;
    written.push({ file, bytes: writeJson(join(args.out, file), day) });
    const rt = { version: 1, key, ids: rail.map((tr) => railIds.get(tr)!.id), seqs: rail.map((tr) => railIds.get(tr)!.q) };
    written.push({ file: `rt-${key}.json`, bytes: writeJson(join(args.out, `rt-${key}.json`), rt) });
    dayStats[key] = { rail: railEvents, bus: busEvents, ski: skiEvents, trips, railTrips: rail.length };
  }

  // --- network and manifest ---------------------------------------------------
  const network = {
    version: 1,
    routes: outRoutes.map((o) => {
      if ("ghost" in o) return o.ghost;
      const r = routes[o.i]!;
      return { id: r.id, short: r.short, name: r.name, type: r.type, kind: o.kind, color: r.color, text: r.text };
    }),
    stops: stations.map((s) => ({ id: s.id, ids: s.ids, name: s.name, lat: round5(s.lat), lon: round5(s.lon) })),
    shapes: outShapes,
    headsigns,
  };
  written.push({ file: "network.json", bytes: writeJson(join(args.out, "network.json"), network) });

  const days: Record<string, string> = {};
  const t0s: Record<string, number> = {};
  // The archive: every earlier date the previous build had, up to a limit,
  // with its day file brought along.
  const oldest = addDays(today, -ARCHIVE_DAYS);
  let archived = 0;
  for (const [date, key] of Object.entries(prevManifest?.days ?? {})) {
    if (date >= dates[0]! || date < oldest) continue;
    const file = `day-${key}.json`;
    if (!existsSync(join(args.out, file))) {
      const body = args.previous ? await previousFile(args.previous, file) : null;
      // A day the archive has but can't hand over: fail rather than deploy
      // a manifest without it, which the next build would take as final.
      if (!body) throw new Error(`couldn't carry ${date} forward: ${file} didn't download`);
      writeFileSync(join(args.out, file), body);
    }
    days[date] = key;
    t0s[date] = prevManifest?.t0[date] ?? serviceDayT0(date);
    written.push({ file, bytes: statSync(join(args.out, file)).size });
    archived++;
  }
  for (const date of [...rebuilt, ...dates]) {
    days[date] = dayKey.get(date)!;
    t0s[date] = serviceDayT0(date);
  }
  // Which dates were rebuilt from a later feed rather than kept as they were
  // published: said, not hidden.
  const wasRebuilt = [...(prevManifest?.rebuilt ?? []).filter((d) => d in days && !dates.includes(d)), ...rebuilt].sort();
  const manifest = {
    version: 1,
    generated: new Date().toISOString(),
    timezone: TIMEZONE,
    source: { url, sha256: feedSha, bytes: bytes.length, feedStart, feedEnd },
    days: Object.fromEntries(Object.entries(days).sort()),
    t0: Object.fromEntries(Object.entries(t0s).sort()),
    rebuilt: wasRebuilt,
    // Sealed skies are added by tools/archive/sky.ts, which carries its own.
    sky: {},
  };
  written.push({ file: "manifest.json", bytes: writeJson(join(args.out, "manifest.json"), manifest) });

  // Remove day files no date refers to any more.
  const keep = new Set([...written.map((w) => w.file), ...Object.values(days).map((k) => `day-${k}.json`)]);
  for (const f of readdirSync(args.out)) {
    if (/^(day|rt)-[0-9a-f]+\.json$/.test(f) && !keep.has(f)) unlinkSync(join(args.out, f));
  }
  if (args.previous) console.log(`archive: ${archived} earlier dates carried over`);
  if (rebuilt.length) console.log(`archive: ${rebuilt.length} earlier dates rebuilt from this feed (${rebuilt[0]} to ${rebuilt.at(-1)})`);

  // --- summary ------------------------------------------------------------------
  const ms = Math.round(performance.now() - t0);
  console.log(`UTA GTFS ${feedStart}..${feedEnd} (${(bytes.length / 1e6).toFixed(1)} MB) compiled in ${ms} ms`);
  console.log(
    `routes: ${network.routes.map((r) => `${r.short} ${r.name} [${r.kind} ${r.color}]`).join(", ")}`,
  );
  console.log(`stations: ${stations.length}, shapes: ${outShapes.length}, headsigns: ${headsigns.length}`);
  if (skippedTimes > 0) console.log(`skipped ${skippedTimes} untimed stop_times`);
  if (skippedRelief > 0) console.log(`skipped ${skippedRelief} operator-relief stop_times (no pickup, no drop-off)`);
  for (const date of dates) {
    const key = dayKey.get(date)!;
    const s = dayStats[key]!;
    const wd = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    console.log(
      `${date} ${wd} ${key}: rail ${s.rail} (${s.railTrips} trips), bus ${s.bus}, ski ${s.ski}, total ${s.rail + s.bus + s.ski}`,
    );
  }
  for (const w of written) {
    const size = statSync(join(args.out, w.file)).size;
    console.log(`  ${w.file} ${(size / 1024).toFixed(1)} KB`);
  }
}

await main();
