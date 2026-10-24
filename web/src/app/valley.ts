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
import { Kind, encodeBikes, encodeDay, encodeNetwork, encodeQuakes, encodeSky, encodeSkyline, encodeSlow } from "../engine/protocol.ts";
import { CREST_ELEV_FT } from "../art/crest-data.ts";
import { mountainDay, mountainHour, mountainTime, type ValleyNow } from "./captions.ts";
import type { Schedule } from "./schedule.ts";
import type { Daypart } from "../art/sky.ts";
import { daypartAt } from "../art/sky.ts";

const MIN = 60_000;

export const DAYPART_NAMES: Record<Daypart, string> = {
  nocturne: "Nocturne",
  "first-light": "First light",
  work: "Working day",
  rush: "Evening rush",
  "last-trains": "Last trains",
};

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

  /** Everything the first bar needs, before the tap. */
  async prime(): Promise<void> {
    this.host.post(Kind.NETWORK, encodeNetwork(this.schedule.network));
    // The pad's waveform is the crest: the same numbers the skyline draws.
    this.host.post(Kind.SKYLINE, encodeSkyline([...CREST_ELEV_FT]));
    await Promise.all([
      this.loadDays(),
      this.refreshSky(),
      this.refreshSlow(),
      this.refreshQuakes(),
      this.bikes.init().then(() => (this.bikesReady = true)).catch(() => {}),
    ]);
  }

  /** Keep every feed fresh. */
  run(): void {
    const every = (ms: number, f: () => Promise<unknown>) => {
      this.timers.push(window.setInterval(() => void f().catch(() => {}), ms));
    };
    every(5 * MIN, () => this.refreshSky());
    every(15 * MIN, () => this.refreshSlow());
    every(2 * MIN, () => this.refreshQuakes());
    every(30_000, () => this.refreshBikes());
    every(10 * MIN, () => this.loadDays());
    void this.refreshBikes().catch(() => {});
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  now(): number {
    return Date.now() + this.shift;
  }

  /** Post the service days around now (or the rewound now). */
  async loadDays(): Promise<void> {
    for (const date of this.schedule.datesAround(this.now())) {
      const d = await this.schedule.day(date);
      if (!d || this.postedDays.has(date)) continue;
      this.host.post(Kind.DAY, encodeDay(date, d.t0, d.day));
      this.postedDays.add(date);
    }
  }

  async refreshSky(): Promise<void> {
    const sky = await fetchSky();
    if (!sky) return;
    this.sky = sky;
    this.host.post(Kind.SKY, encodeSky(sky.value.hours));
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
    const vehicles = this.schedule.vehiclesAt(t);
    const moving = vehicles > 0 ? `${vehicles.toLocaleString("en-US")} vehicles moving` : "the trains are asleep";
    return `${mountainDay(t)} ${mountainTime(t)} · ${DAYPART_NAMES[this.daypart()]} · ${moving}`;
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
      ground: this.ground ? { station: this.ground.station, receipt: "live", observed: this.ground.observed } : undefined,
    };
  }
}
