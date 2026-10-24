// The conductor's players: with a conductor deployed (conductor/), every
// phone reads the valley from it instead of from the feeds directly, so all
// of them hear exactly the same inputs: the same sealed windows of trains
// (realtime, with lateness), bikes, quakes and the ground; the same sky from
// KSLC's METARs; the same clock.

import type { Host } from "../engine/host.ts";
import { Kind, encodeRail } from "../engine/protocol.ts";
import type { Valley } from "../app/valley.ts";
import { DELAY_MS, STATIONS, type Baseband, type GroundFeed } from "./ground.ts";
import type { Lake, Quake, Reading, River, SkyNow, Snow } from "./feeds.ts";
import { utcNow } from "../engine/clock.ts";

const WINDOW_MS = 30_000;
const SEAL_MS = 60_000;

interface WindowBody {
  start: number;
  end: number;
  rail: [number, number, number, number, number, number][];
  bikes: [number, number, number, number, number][];
  quakes: [number, number, number, number, number, string, string][];
  ground: { band: number; lat: number; lon: number; level: number; t0: number; iq: number[] }[];
}

export class Conductor implements GroundFeed {
  readonly url: string;
  private readonly host: Host;
  private readonly valley: Valley;
  private fetched = new Set<number>();
  private bands: Baseband[][] = STATIONS.map(() => []);
  private levels = STATIONS.map(() => 0);
  private lastGround = STATIONS.map(() => 0);
  private timers: number[] = [];
  /** Windows read, and the latest one's start: for the mappings view. */
  stats = { windows: 0, latest: 0, observed: 0, scheduled: 0 };

  constructor(url: string, host: Host, valley: Valley) {
    this.url = url.replace(/\/$/, "");
    this.host = host;
    this.valley = valley;
  }

  private async get<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.url}${path}`, { cache: path === "/time" ? "no-store" : "default" });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }

  /** The sky and the slow values, before the first bar. */
  async prime(): Promise<void> {
    await Promise.all([this.sky(), this.slow()]);
  }

  start(): void {
    const every = (ms: number, f: () => Promise<void>) => {
      void f();
      this.timers.push(window.setInterval(() => void f(), ms));
    };
    every(5_000, () => this.windows());
    every(5 * 60_000, () => this.sky());
    every(15 * 60_000, () => this.slow());
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private async sky(): Promise<void> {
    const sky = await this.get<{ value: SkyNow; observed: number }>("/sky.json");
    if (sky) this.valley.conductorSky({ value: sky.value, observed: sky.observed, receipt: "live" });
  }

  private async slow(): Promise<void> {
    const s = await this.get<{ lake: Reading<Lake> | null; river: Reading<River> | null; snow: Reading<Snow> | null }>("/slow.json");
    if (s) this.valley.conductorSlow(s.lake, s.river, s.snow);
  }

  /** Every sealed window from just before the listening time to now. */
  private async windows(): Promise<void> {
    const now = utcNow() + this.valley.shift;
    const listening = now - DELAY_MS;
    const first = Math.floor((listening - 45_000) / WINDOW_MS) * WINDOW_MS;
    const last = Math.floor((now - SEAL_MS) / WINDOW_MS) * WINDOW_MS;
    for (let start = first; start <= last; start += WINDOW_MS) {
      if (this.fetched.has(start)) continue;
      const w = await this.get<WindowBody>(`/w/${start}.json`);
      if (!w) continue;
      this.fetched.add(start);
      this.apply(w);
    }
    for (const s of this.fetched) if (s < first - 10 * WINDOW_MS) this.fetched.delete(s);
  }

  private apply(w: WindowBody): void {
    this.stats.windows++;
    this.stats.latest = Math.max(this.stats.latest, w.start);
    this.stats.observed += w.rail.filter((r) => r[5] === 1).length;
    this.stats.scheduled += w.rail.filter((r) => r[5] === 0).length;
    this.host.post(Kind.RAIL, encodeRail(w.start, w.end, w.rail));
    if (w.bikes.length) {
      this.valley.conductorBikes(w.bikes.map(([ms, lat, lon, delta, station]) => ({ ms, lat, lon, delta, station })));
    }
    if (w.quakes.length) {
      this.valley.conductorQuakes(w.quakes.map(([ms, originMs, mag, lat, lon, id, place]): Quake => ({ ms, originMs, mag, lat, lon, id, place })));
    }
    for (const g of w.ground) {
      const queue = this.bands[g.band];
      if (!queue) continue;
      for (let k = 0; k * 2 < g.iq.length; k++) queue.push({ t: g.t0 + k * 100, i: g.iq[2 * k]!, q: g.iq[2 * k + 1]! });
      queue.sort((a, b) => a.t - b.t);
      this.levels[g.band] = g.level;
      this.lastGround[g.band] = g.t0 + (g.iq.length / 2) * 100;
    }
  }

  // --- The ground, from the windows ------------------------------------------

  take(band: number, upTo: number): Baseband[] {
    const q = this.bands[band];
    if (!q) return [];
    let n = 0;
    while (n < q.length && q[n]!.t <= upTo) n++;
    return q.splice(0, n);
  }

  level(band: number): number {
    return this.levels[band] ?? 0;
  }

  freshAt(band: number, l: number): boolean {
    const last = this.lastGround[band] ?? 0;
    return last > l - 60_000;
  }
}
