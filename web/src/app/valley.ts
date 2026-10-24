// The valley as the page knows it: every feed's last reading, polled on its
// own cadence, posted to the engine when it changes, and summarized for the
// status lines and captions.

import {
  BikeWatch,
  fetchLake,
  fetchQuakes,
  fetchRiver,
  fetchSky,
  fetchSnow,
  season,
  type Lake,
  type Quake,
  type Reading,
  type River,
  type SkyNow,
  type Snow,
} from "../data/feeds.ts";
import type { Host } from "../engine/host.ts";
import { Kind, encodeBikes, encodeDay, encodeNetwork, encodeQuakes, encodeSky, encodeSkyline, encodeSlow, type Fleet } from "../engine/protocol.ts";
import { utcNow } from "../engine/clock.ts";
import { STATIONS } from "../data/ground.ts";
import { CREST_ELEV_FT } from "../art/crest-data.ts";
import { mountainDay, mountainHour, mountainTime, type ValleyNow } from "./captions.ts";
import type { Schedule } from "./schedule.ts";
import type { Daypart } from "../art/sky.ts";
import { daypartAt } from "../art/sky.ts";

const MIN = 60_000;

/** "248 buses and 31 trains running", "1 bus running", "" for none. */
export function transitPhrase({ buses, trains }: { buses: number; trains: number }, verb: string): string {
  const count = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
  const parts = [buses ? count(buses, "bus", "buses") : "", trains ? count(trains, "train", "trains") : ""].filter(Boolean);
  return parts.length ? `${parts.join(" and ")} ${verb}` : "";
}

export const DAYPART_NAMES: Record<Daypart, string> = {
  nocturne: "Nocturne",
  "first-light": "First light",
  work: "Working day",
  rush: "Evening rush",
  "last-trains": "Last trains",
};

/** The daypart's name at `ms` in Mountain time: there's no working day or
 * evening rush on a Saturday or a Sunday. */
export function daypartName(ms: number): string {
  const daypart = daypartAt(mountainHour(ms));
  const weekend = /^(Sat|Sun)/.test(mountainDay(ms));
  if (weekend && daypart === "work") return "The day";
  if (weekend && daypart === "rush") return "Evening";
  return DAYPART_NAMES[daypart];
}

export interface GroundState {
  station: string;
  levels: [number, number, number, number];
  observed: number;
}

export class Valley {
  lake: Reading<Lake> | null = null;
  river: Reading<River> | null = null;
  snow: Reading<Snow> | null = null;
  sky: Reading<SkyNow> | null = null;
  quakes: Reading<Quake[]> | null = null;
  readonly bikes = new BikeWatch();
  private bikesReady = false;
  ground: GroundState | null = null;
  private timers: number[] = [];
  private postedDays = new Set<string>();
  /** Hours a sealed day covers: the live fetch never overrides them. */
  private sealed = new Set<number>();
  private listeners: (() => void)[] = [];
  /** Rewind offset, ms: the valley is read as of now + shift. */
  shift = 0;

  private readonly host: Host;
  private readonly schedule: Schedule;

  constructor(host: Host, schedule: Schedule) {
    this.host = host;
    this.schedule = schedule;
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private changed(): void {
    for (const l of this.listeners) l();
  }

  /** Everything the first bar needs, before the tap. With a conductor, it
   * supplies the feeds (`direct` false) and this only loads the schedule. */
  async prime(direct = true): Promise<void> {
    this.host.post(Kind.NETWORK, encodeNetwork(this.schedule.network));
    // The pad's waveform is the crest: the same numbers the skyline draws.
    this.host.post(Kind.SKYLINE, encodeSkyline([...CREST_ELEV_FT]));
    await Promise.all([
      this.loadDays(),
      this.bikes.init().then(() => (this.bikesReady = true)).catch(() => {}),
      ...(direct ? [this.refreshSky(), this.refreshSlow(), this.refreshQuakes()] : [this.refreshCatalog()]),
    ]);
  }

  /** The quake catalog, for the screen only. With a conductor the engine
   * hears quakes from its windows alone, the same on every phone, so
   * between quakes there'd be nothing to count. */
  catalog: Reading<Quake[]> | null = null;

  async refreshCatalog(): Promise<void> {
    const q = await fetchQuakes().catch(() => null);
    if (q) this.catalog = q;
  }

  /** Keep every feed fresh (the schedule only, with a conductor). */
  run(direct = true): void {
    this.timers.push(window.setInterval(() => void this.loadDays().catch(() => {}), 10 * MIN));
    if (direct) this.runFeeds();
    else this.timers.push(window.setInterval(() => void this.refreshCatalog(), 5 * MIN));
  }

  /** Read the feeds directly: from the start, or once a conductor goes quiet. */
  runFeeds(): void {
    const every = (ms: number, f: () => Promise<unknown>) => {
      this.timers.push(window.setInterval(() => void f().catch(() => {}), ms));
    };
    every(5 * MIN, () => this.refreshSky());
    every(15 * MIN, () => this.refreshSlow());
    every(2 * MIN, () => this.refreshQuakes());
    every(30_000, () => this.refreshBikes());
    void this.refreshBikes().catch(() => {});
  }

  // --- From the conductor --------------------------------------------------

  /** The sky as the conductor read it (from KSLC's METARs). */
  /** UTA's fleet as the conductor last saw it: each train where it is, and
   * how many trains and buses are out. */
  fleet: Fleet | null = null;

  conductorFleet(fleet: Fleet): void {
    this.fleet = fleet;
  }

  /** The live fleet, if it's fresh and the listener is in the present. */
  liveFleet(): Fleet | null {
    const f = this.fleet;
    return f && !this.shift && utcNow() - f.t < 90_000 ? f : null;
  }

  conductorSky(sky: Reading<SkyNow>): void {
    this.sky = sky;
    this.host.post(Kind.SKY, encodeSky(sky.value.hours.filter((h) => !this.sealed.has(h.at))));
    this.changed();
  }

  conductorSlow(lake: Reading<Lake> | null, river: Reading<River> | null, snow: Reading<Snow> | null): void {
    if (lake) this.lake = lake;
    if (river) this.river = river;
    if (snow) this.snow = snow;
    this.postSlow();
    this.changed();
  }

  /** Bike changes from a window: the last ten minutes go to the engine. */
  conductorBikes(events: { ms: number; lat: number; lon: number; delta: number; station: number }[]): void {
    for (const e of events) this.bikes.events.push({ ...e, name: this.bikes.stationName(e.station) });
    const cutoff = this.now() - 10 * MIN;
    this.bikes.events.sort((a, b) => a.ms - b.ms);
    while (this.bikes.events.length && (this.bikes.events[0]?.ms ?? 0) < cutoff) this.bikes.events.shift();
    this.host.post(Kind.BIKES, encodeBikes(this.bikes.events));
  }

  conductorQuakes(quakes: Quake[]): void {
    const known = new Map((this.quakes?.value ?? []).map((q) => [q.id, q]));
    for (const q of quakes) known.set(q.id, q);
    const all = [...known.values()].filter((q) => q.ms > this.now() - 2 * 86_400_000).sort((a, b) => a.ms - b.ms);
    this.quakes = { value: all, observed: Date.now(), receipt: "live" };
    this.host.post(Kind.QUAKES, encodeQuakes(all));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  now(): number {
    return Date.now() + this.shift;
  }

  /** Post the service days around now (or the rewound now). */
  async loadDays(dates = this.schedule.datesAround(this.now())): Promise<void> {
    for (const date of dates) {
      const d = await this.schedule.day(date);
      if (!d || this.postedDays.has(date)) continue;
      this.host.post(Kind.DAY, encodeDay(date, d.t0, d.day));
      this.postedDays.add(date);
      // A sealed sky is the same for everyone, so it outranks the live one.
      const hours = await this.schedule.sealedSky(date);
      if (hours?.length) {
        for (const h of hours) this.sealed.add(h.at);
        this.host.post(Kind.SKY, encodeSky(hours));
      }
    }
  }

  /** Where the sky must start: four hours before the 5 AM anchor of the
   * day being played, the same instant on every phone. */
  skyFrom(): number {
    const now = this.now();
    const anchors = Object.values(this.schedule.manifest.t0)
      .map((t0) => t0 + 5 * 3_600_000)
      .filter((a) => a <= now);
    const anchor = anchors.length ? Math.max(...anchors) : now - 24 * 3_600_000;
    return anchor - 4 * 3_600_000;
  }

  async refreshSky(): Promise<void> {
    const sky = await fetchSky(this.skyFrom());
    if (!sky) return;
    this.sky = sky;
    this.host.post(Kind.SKY, encodeSky(sky.value.hours.filter((h) => !this.sealed.has(h.at))));
    this.changed();
  }

  async refreshSlow(): Promise<void> {
    const [lake, river, snow] = await Promise.all([fetchLake(), fetchRiver(), fetchSnow()]);
    if (lake) this.lake = lake;
    if (river) this.river = river;
    if (snow) this.snow = snow;
    this.postSlow();
    this.changed();
  }

  postSlow(): void {
    this.host.post(
      Kind.SLOW,
      encodeSlow({
        lakeFt: this.lake?.value.ft ?? 4189.8,
        lakeDevFt: this.lake?.value.devFt ?? 0,
        river: this.river?.value.position ?? 0.5,
        snowpack: this.snow?.value.ratio ?? 1,
        newSnowIn: this.snow?.value.newIn ?? 0,
        powder: this.snow?.value.powder ?? 0.5,
        season: season(this.now()),
        ground: this.ground?.levels ?? [0, 0, 0, 0],
      }),
    );
  }

  async refreshQuakes(): Promise<void> {
    const q = await fetchQuakes();
    if (!q) return;
    this.quakes = q;
    this.host.post(Kind.QUAKES, encodeQuakes(q.value));
  }

  async refreshBikes(): Promise<void> {
    if (!this.bikesReady) {
      await this.bikes.init();
      this.bikesReady = true;
    }
    if (await this.bikes.poll()) this.host.post(Kind.BIKES, encodeBikes(this.bikes.events));
  }

  setGround(g: GroundState | null): void {
    this.ground = g;
    this.postSlow();
  }

  daypart(): Daypart {
    return daypartAt(mountainHour(this.now()));
  }

  /** "FRIDAY 5:42 PM · EVENING RUSH · 302 VEHICLES MOVING" */
  status1(): string {
    const t = this.now();
    const live = this.liveFleet();
    const moving = live
      ? transitPhrase(live.counts, "out") || "no buses or trains out"
      : transitPhrase(this.schedule.transitAt(t), "running") || "no buses or trains running";
    return `${mountainDay(t)} ${mountainTime(t)} · ${daypartName(t)} · ${moving}`;
  }

  /** "CLEAN AIR · NO NEW SNOW · LAKE 4,189.8 FT" */
  status2(): string {
    const parts: string[] = [];
    const sky = this.sky?.value;
    if (sky) {
      const pm = sky.pm25;
      const inv = sky.inversionC >= 4;
      if (Number.isFinite(pm)) {
        if (pm < 12) parts.push(inv ? "Inversion · clean air" : "Clean air");
        else if (pm < 35.5) parts.push(`${inv ? "Inversion" : "Hazy"} · PM2.5 ${Math.round(pm)}`);
        else parts.push(`Unhealthy air · PM2.5 ${Math.round(pm)}`);
      } else if (sky.description) {
        parts.push(sky.description);
      }
    }
    const snow = this.snow?.value;
    if (snow) parts.push(snow.newIn >= 1 ? `${Math.round(snow.newIn)} in overnight at Snowbird` : "No new snow");
    const lake = this.lake?.value;
    if (lake) parts.push(`Lake ${lake.ft.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ft`);
    return parts.join(" · ");
  }

  /** What the captions quote. */
  valleyNow(): ValleyNow {
    const sky = this.sky;
    return {
      lake: this.lake ? { ft: this.lake.value.ft, observed: this.lake.observed, receipt: this.lake.receipt } : undefined,
      sky: sky ? { description: sky.value.description, observed: sky.observed, receipt: sky.receipt } : undefined,
      wind: sky ? { gustMs: sky.value.ridgeGustMs, observed: sky.observed, receipt: sky.receipt } : undefined,
      snow: this.snow ? { newIn: this.snow.value.newIn, observed: this.snow.observed, receipt: this.snow.receipt } : undefined,
      quakes: this.quakes?.value ?? [],
      bikeStation: (i) => this.bikes.stationName(i),
      ground: this.ground ? this.loudestGround(this.ground) : undefined,
      river: this.river ? { ...this.river.value, observed: this.river.observed, receipt: this.river.receipt } : undefined,
      air: sky ? { pm25: sky.value.pm25, inversionC: sky.value.inversionC, observed: sky.observed, receipt: sky.receipt } : undefined,
      alerts: sky ? { names: sky.value.alerts, observed: sky.observed, receipt: sky.receipt } : undefined,
      busesOut: this.liveFleet() ? { count: this.liveFleet()!.counts.buses, observed: this.liveFleet()!.t } : undefined,
    };
  }

  /** The station whose band is loudest against its own busy day. */
  private loudestGround(g: GroundState): NonNullable<ValleyNow["ground"]> {
    let best = 0;
    g.levels.forEach((l, i) => {
      if (l > (g.levels[best] ?? 0)) best = i;
    });
    return { station: STATIONS[best]?.name ?? g.station, level: g.levels[best] ?? 0, receipt: "live", observed: g.observed };
  }
}
