// The compiled schedule (tools/gtfs): which service days exist, the rail
// network's shapes, and where every scheduled train is at any moment.

import type { DayFile, NetworkFile, SkyHour } from "../engine/protocol.ts";

export interface Manifest {
  version: number;
  generated: string;
  timezone: string;
  days: Record<string, string>;
  t0: Record<string, number>;
  /** Service dates whose sky is sealed (tools/archive/sky.ts), and their files. */
  sky?: Record<string, string>;
}

export interface Day extends DayFile {
  active?: number[];
  counts: { railStopEvents: number; busStopEvents: number; skiStopEvents: number; trips: number; railTrips: number };
}

export interface LoadedDay {
  date: string;
  t0: number;
  day: Day;
}

/** A route's line on the map: one polyline per direction, with each
 * station's distance along it. */
interface Track {
  route: number;
  dir: number;
  pts: [number, number][];
  /** Cumulative distance along pts, in degrees-ish (scaled longitude). */
  cum: number[];
  /** Station index → distance along the track. */
  at: Map<number, number>;
}

const LON_SCALE = Math.cos((40.7 * Math.PI) / 180);

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], (a[1] - b[1]) * LON_SCALE);
}

/** Where along a polyline a point falls (its nearest point's distance). */
function along(pts: [number, number][], cum: number[], p: [number, number]): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const ax = a[1] * LON_SCALE;
    const bx = b[1] * LON_SCALE;
    const px = p[1] * LON_SCALE;
    const dx = bx - ax;
    const dy = b[0] - a[0];
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (p[0] - a[0]) * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx - px, a[0] + t * dy - p[0]);
    if (d < bestD) {
      bestD = d;
      best = (cum[i] ?? 0) + t * Math.sqrt(len2);
    }
  }
  return best;
}

function pointAt(track: Track, s: number): [number, number] {
  const { pts, cum } = track;
  if (s <= 0) return pts[0]!;
  for (let i = 0; i < pts.length - 1; i++) {
    const c1 = cum[i + 1]!;
    if (s <= c1) {
      const c0 = cum[i]!;
      const t = c1 > c0 ? (s - c0) / (c1 - c0) : 0;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    }
  }
  return pts.at(-1)!;
}

export interface Train {
  route: number;
  dir: number;
  lat: number;
  lon: number;
  /** Stopped at a station right now. */
  dwelling: boolean;
}

export class Schedule {
  manifest!: Manifest;
  network!: NetworkFile;
  private tracks = new Map<string, Track>();
  private days = new Map<string, LoadedDay>();
  private base = "";

  async load(base: string): Promise<void> {
    this.base = base;
    const [manifest, network] = await Promise.all([
      fetch(`${base}schedule/manifest.json`, { cache: "no-cache" }).then((r) => r.json() as Promise<Manifest>),
      fetch(`${base}schedule/network.json`).then((r) => r.json() as Promise<NetworkFile>),
    ]);
    this.manifest = manifest;
    this.network = network;
    for (const shape of network.shapes) {
      const pts = shape.pts;
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + dist(pts[i - 1]!, pts[i]!));
      this.tracks.set(`${shape.r}:${shape.d}`, { route: shape.r, dir: shape.d, pts, cum, at: new Map() });
    }
  }

  /** The service dates whose day covers `utcMs` or sits next to it. */
  datesAround(utcMs: number): string[] {
    return Object.entries(this.manifest.t0)
      .filter(([, t0]) => Math.abs(t0 + 15 * 3_600_000 - utcMs) < 40 * 3_600_000)
      .map(([d]) => d)
      .sort();
  }

  /** What A Day in Twelve Minutes needs for `date`: the day, and the next
   * one, whose first trains end the night. Every phone loads the same two. */
  twelveDates(date: string): string[] {
    const next = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    return [date, next].filter((d) => d in this.manifest.days);
  }

  /** The ski buses scheduled on the service day covering `utcMs`, by route
   * short name ("994": 2). */
  skiTrips(utcMs: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of this.days.values()) {
      if (utcMs < d.t0 || utcMs >= d.t0 + 24 * 3_600_000) continue;
      for (const s of d.day.ski) {
        const short = this.network.routes[s.r]?.short ?? "?";
        out[short] = (out[short] ?? 0) + 1;
      }
    }
    return out;
  }

  /** The earliest and latest instants the compiled schedule covers. */
  span(): [number, number] {
    const t0s = Object.values(this.manifest.t0);
    return [Math.min(...t0s), Math.max(...t0s) + 30 * 3_600_000];
  }

  has(date: string): boolean {
    return date in this.manifest.days;
  }

  async day(date: string): Promise<LoadedDay | null> {
    const cached = this.days.get(date);
    if (cached) return cached;
    const key = this.manifest.days[date];
    const t0 = this.manifest.t0[date];
    if (!key || t0 === undefined) return null;
    const day = (await fetch(`${this.base}schedule/day-${key}.json`).then((r) => r.json())) as Day;
    const loaded = { date, t0, day };
    this.days.set(date, loaded);
    // Station positions along each track, once the stations are known.
    for (const trip of day.rail) {
      const track = this.tracks.get(`${trip.r}:${trip.d}`);
      if (!track) continue;
      for (const s of trip.s) {
        if (track.at.has(s)) continue;
        const st = this.network.stops[s];
        if (st) track.at.set(s, along(track.pts, track.cum, [st.lat, st.lon]));
      }
    }
    return loaded;
  }

  /** A sealed day's sky, if the archive has it. */
  async sealedSky(date: string): Promise<SkyHour[] | null> {
    const file = this.manifest.sky?.[date];
    if (!file) return null;
    try {
      const body = (await fetch(`${this.base}schedule/${file}`).then((r) => r.json())) as { hours: (Omit<SkyHour, "cloud"> & { cloud: number | null })[] };
      return body.hours.map((h) => ({ ...h, cloud: h.cloud ?? Number.NaN }));
    } catch {
      return null;
    }
  }

  loadedDays(): LoadedDay[] {
    return [...this.days.values()];
  }

  /** The loaded day whose service covers `utcMs` most recently begun. */
  dayAt(utcMs: number): LoadedDay | null {
    let best: LoadedDay | null = null;
    for (const d of this.days.values()) {
      if (utcMs >= d.t0 && utcMs < d.t0 + 30 * 3_600_000 && (!best || d.t0 > best.t0)) best = d;
    }
    return best;
  }

  /** UTA's buses and trains in service at `utcMs`, by the schedule. Trains
   * are the rail trips (TRAX, the S-Line, FrontRunner) under way, counted
   * exactly; buses (ski buses among them) are every other trip in service. */
  transitAt(utcMs: number): { buses: number; trains: number } {
    let all = 0;
    let trains = 0;
    for (const d of this.days.values()) {
      const m = Math.floor((utcMs - d.t0) / 60_000);
      if (m >= 0 && m < (d.day.active?.length ?? 0)) all += d.day.active?.[m] ?? 0;
      const sec = (utcMs - d.t0) / 1000;
      for (const trip of d.day.rail) if (sec >= trip.t[0]! && sec <= trip.t.at(-1)!) trains++;
    }
    return { buses: Math.max(0, all - trains), trains };
  }

  /** Bus stop events per minute at `utcMs`. */
  busRate(utcMs: number): number {
    let n = 0;
    for (const d of this.days.values()) {
      const m = Math.floor((utcMs - d.t0) / 60_000);
      n += d.day.bus.perMinute[m] ?? 0;
    }
    return n;
  }

  /** Every scheduled train in service at `utcMs`, placed on its track. */
  trainsAt(utcMs: number): Train[] {
    const out: Train[] = [];
    for (const d of this.days.values()) {
      const sec = (utcMs - d.t0) / 1000;
      for (const trip of d.day.rail) {
        const first = trip.t[0]!;
        const last = trip.t.at(-1)!;
        if (sec < first || sec > last) continue;
        const track = this.tracks.get(`${trip.r}:${trip.d}`);
        let k = 0;
        while (k < trip.t.length - 1 && trip.t[k + 1]! <= sec) k++;
        const a = trip.s[k]!;
        const b = trip.s[Math.min(k + 1, trip.s.length - 1)]!;
        const ta = trip.t[k]!;
        const tb = trip.t[Math.min(k + 1, trip.t.length - 1)]!;
        // Trains dwell about 20 s, then run.
        const dwell = Math.min(20, (tb - ta) * 0.3);
        const f = tb > ta + dwell ? Math.max(0, Math.min(1, (sec - ta - dwell) / (tb - ta - dwell))) : 0;
        let lat: number;
        let lon: number;
        const sa = track?.at.get(a);
        const sb = track?.at.get(b);
        if (track && sa !== undefined && sb !== undefined) {
          [lat, lon] = pointAt(track, sa + f * (sb - sa));
        } else {
          const pa = this.network.stops[a];
          const pb = this.network.stops[b];
          if (!pa || !pb) continue;
          lat = pa.lat + f * (pb.lat - pa.lat);
          lon = pa.lon + f * (pb.lon - pa.lon);
        }
        out.push({ route: trip.r, dir: trip.d, lat, lon, dwelling: f === 0 });
      }
    }
    return out;
  }

  routeName(i: number): string {
    return this.network.routes[i]?.name ?? "a train";
  }

  stopName(i: number): string {
    return tidyStation(this.network.stops[i]?.name ?? "a station");
  }

  routeColor(i: number): string {
    return this.network.routes[i]?.color ?? "#1B1F3B";
  }
}

/** "Salt Lake Central Station" → "Salt Lake Central". */
export function tidyStation(name: string): string {
  return name.replace(/\s+(Station|Stn)$/i, "").trim();
}
