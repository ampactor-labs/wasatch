// The conductor's players: with a conductor deployed (conductor/), every
// phone reads the valley from it instead of from the feeds directly, so all
// of them hear exactly the same inputs: the same sealed windows of trains
// (realtime, with lateness), bikes, quakes and the ground; the same sky from
// KSLC's METARs; the same clock.

import type { Host } from "../engine/host.ts";
import { Kind, encodeAlerts, encodePlanes, encodeRail, type Fleet } from "../engine/protocol.ts";
import type { AlertRow, Grid, PlaneDot, PlaneRow, ServiceAlerts, Valley } from "../app/valley.ts";
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
  // Added since: an older window has none of these.
  planes?: PlaneRow[];
  alerts?: AlertRow[];
  alertsActive?: [number, number, number, number];
  due?: number;
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
  /** Departures heard live lately: when, and how late (s). */
  private lates: { at: number; s: number }[] = [];
  /** Called once if nothing has come from the conductor for three minutes. */
  onLost: (() => void) | null = null;
  private lastHeard = performance.now();
  private lost = false;

  constructor(url: string, host: Host, valley: Valley) {
    this.url = url.replace(/\/$/, "");
    this.host = host;
    this.valley = valley;
  }

  private async get<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(`${this.url}${path}`, { cache: path === "/time" ? "no-store" : "default", signal: AbortSignal.timeout(10_000) });
      // Any answer, even "not sealed yet", means it's there.
      this.lastHeard = performance.now();
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }

  private checkLost(): void {
    if (this.lost || performance.now() - this.lastHeard < 3 * 60_000) return;
    this.lost = true;
    this.onLost?.();
  }

  /** The sky, the slow values and the fleet, before the first bar. */
  async prime(): Promise<void> {
    await Promise.all([this.sky(), this.slow(), this.vehicles(), this.planes(), this.alerts()]);
  }

  start(): void {
    const every = (ms: number, f: () => Promise<void>) => {
      void f();
      this.timers.push(window.setInterval(() => void f(), ms));
    };
    every(5_000, async () => {
      await this.windows();
      this.checkLost();
    });
    every(5 * 60_000, () => this.sky());
    every(15 * 60_000, () => this.slow());
    every(10_000, () => this.vehicles());
    every(30_000, () => this.planes());
    every(5 * 60_000, () => this.alerts());
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private async sky(): Promise<void> {
    const sky = await this.get<{ value: SkyNow; observed: number }>("/sky.json");
    if (sky) this.valley.conductorSky({ value: sky.value, observed: sky.observed, receipt: "live" });
  }

  /** UTA's fleet now, while the listener is in the present. */
  private async vehicles(): Promise<void> {
    if (this.valley.shift) return;
    const fleet = await this.get<Fleet>("/vehicles.json");
    if (fleet) this.valley.conductorFleet(fleet);
  }

  private async slow(): Promise<void> {
    const s = await this.get<{ lake: Reading<Lake> | null; river: Reading<River> | null; snow: Reading<Snow> | null; grid?: Reading<Grid> | null }>("/slow.json");
    if (s) this.valley.conductorSlow(s.lake, s.river, s.snow, s.grid ?? null);
  }

  /** The planes in the air near SLC, for the map, while in the present. */
  private async planes(): Promise<void> {
    if (this.valley.shift) return;
    const p = await this.get<{ t: number; planes: PlaneDot[] }>("/planes.json");
    if (p) this.valley.conductorPlanes(p);
  }

  private async alerts(): Promise<void> {
    const a = await this.get<ServiceAlerts>("/alerts.json");
    if (a) this.valley.conductorAlerts(a);
  }

  /** Every sealed window from just before the listening time to now. */
  private async windows(): Promise<void> {
    const now = utcNow() + this.valley.shift;
    const listening = now - DELAY_MS;
    // Back far enough for every bar's look back: whether a plane sounds
    // depends on the planes up to about a minute before it.
    const first = Math.floor((listening - 90_000) / WINDOW_MS) * WINDOW_MS;
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
    for (const r of w.rail) if (r[5] === 1) this.lates.push({ at: r[0], s: (r[0] - r[1]) / 1000 });
    const cutoff = Math.max(...this.lates.map((l) => l.at)) - 15 * 60_000;
    this.lates = this.lates.filter((l) => l.at >= cutoff);
    this.host.post(Kind.RAIL, encodeRail(w.start, w.end, w.rail, w.due ?? 0));
    // Every window, even an empty one: a window posted again replaces itself.
    const planes = w.planes ?? [];
    const alerts = w.alerts ?? [];
    this.host.post(
      Kind.PLANES,
      encodePlanes(
        w.start,
        w.end,
        planes.map(([ms, lat, lon, kind, size, altFt, airline]) => ({ ms, lat, lon, altFt, arrival: kind === 1, size, airline: airline === 1 })),
      ),
    );
    this.host.post(
      Kind.ALERTS,
      encodeAlerts(
        w.start,
        w.end,
        w.alertsActive ?? [0, 0, 0, 0],
        alerts.map(([ms, kind, severe]) => ({ ms, kind, severe: severe === 1 })),
      ),
    );
    this.valley.conductorEvents(planes, alerts, w.due ?? 0);
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

  /** How late the trains heard live in the last quarter hour ran: the
   * median, seconds, and how many; null with fewer than three. */
  lateness(): { medianS: number; n: number } | null {
    if (this.lates.length < 3) return null;
    const s = this.lates.map((l) => l.s).sort((a, b) => a - b);
    return { medianS: s[Math.floor(s.length / 2)]!, n: s.length };
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
