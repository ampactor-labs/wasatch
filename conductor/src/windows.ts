// Event windows: 30 seconds of the valley each, sealed a minute after they
// open and immutable from then on. A phone computes the URL it needs from
// its clock and never asks for "latest", so no cache or replica can hand two
// phones different versions (DESIGN.md, Determinism and sync).

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const WINDOW_MS = 30_000;
/** A window opens at `start` and is sealed at `start + SEAL_MS`. */
export const SEAL_MS = 60_000;
const KEEP_MS = 3 * 3_600_000;

/** [actual ms, scheduled ms, route, dir, stop, observed 0/1] */
export type RailRow = [number, number, number, number, number, number];
/** [ms, lat, lon, delta, station] */
export type BikeRow = [number, number, number, number, number];
/** [ms, origin ms, magnitude, lat, lon, id, place] */
export type QuakeRow = [number, number, number, number, number, string, string];

export interface GroundBand {
  band: number;
  lat: number;
  lon: number;
  /** 0–1, against a busy day at the station. */
  level: number;
  /** The first sample's time; the rest follow every 100 ms. */
  t0: number;
  /** Interleaved I and Q. */
  iq: number[];
}

export interface WindowBody {
  v: 1;
  start: number;
  end: number;
  rail: RailRow[];
  bikes: BikeRow[];
  quakes: QuakeRow[];
  ground: GroundBand[];
}

interface Open {
  body: WindowBody;
  /** Ground samples by band, keyed by time, so a late duplicate can't double up. */
  ground: Map<number, Map<number, [number, number]>>;
  groundMeta: Map<number, { lat: number; lon: number; level: number }>;
}

export class Windows {
  private open = new Map<number, Open>();
  private sealed = new Map<number, string>();
  /** Where sealed windows are kept across restarts; null to keep them in
   * memory only, from the start or once the disk fails. */
  private dir: string | null;
  /** Called on each window just before it seals: the last chance to add. */
  onSeal: ((w: WindowBody) => void) | null = null;
  /** Called once if the disk stops working; the windows carry on in memory. */
  onDiskError: ((err: unknown) => void) | null = null;

  constructor(dir: string | null = null, now = Date.now()) {
    this.dir = dir;
    this.disk(() => {
      if (!dir) return;
      mkdirSync(dir, { recursive: true });
      for (const f of readdirSync(dir)) {
        const m = /^(\d+)\.json$/.exec(f);
        if (!m) continue;
        const start = Number(m[1]);
        if (now - start > KEEP_MS) continue;
        // A window is written whole or not at all; anything that doesn't
        // read back is left out rather than served.
        try {
          const text = readFileSync(join(dir, f), "utf8");
          if ((JSON.parse(text) as WindowBody).start === start) this.sealed.set(start, text);
        } catch {
          // Unreadable: skip it.
        }
      }
    });
  }

  /** Run a disk operation; on failure, carry on without the disk. */
  private disk(op: () => void): void {
    if (!this.dir) return;
    try {
      op();
    } catch (err) {
      this.dir = null;
      this.onDiskError?.(err);
    }
  }

  /** Whether sealed windows are being kept on disk. */
  get persistent(): boolean {
    return this.dir !== null;
  }

  static startOf(ms: number): number {
    return Math.floor(ms / WINDOW_MS) * WINDOW_MS;
  }

  /** The earliest window still open at `now`. */
  static firstOpen(now: number): number {
    return Windows.startOf(now - SEAL_MS) + WINDOW_MS;
  }

  private get(start: number): Open {
    let w = this.open.get(start);
    if (!w) {
      w = {
        body: { v: 1, start, end: start + WINDOW_MS, rail: [], bikes: [], quakes: [], ground: [] },
        ground: new Map(),
        groundMeta: new Map(),
      };
      this.open.set(start, w);
    }
    return w;
  }

  /** The window an event at `ms` belongs to, or the first one still open
   * when that one has sealed (the event keeps its own time for captions). */
  private home(ms: number, now: number): Open {
    return this.get(Math.max(Windows.startOf(ms), Windows.firstOpen(now)));
  }

  addRail(row: RailRow, now: number): void {
    const w = Windows.startOf(row[0]);
    // A departure belongs to the window it happened in; once that window has
    // sealed it's too late to ring, so it's dropped rather than misplaced.
    if (w < Windows.firstOpen(now)) return;
    this.get(w).body.rail.push(row);
  }

  addBike(row: BikeRow, now: number): void {
    const w = this.home(row[0], now);
    w.body.bikes.push([Math.max(row[0], w.body.start), row[1], row[2], row[3], row[4]]);
  }

  addQuake(row: QuakeRow, now: number): void {
    const w = this.home(row[0], now);
    w.body.quakes.push([Math.max(row[0], w.body.start), ...row.slice(1)] as QuakeRow);
  }

  addGround(band: number, meta: { lat: number; lon: number; level: number }, t: number, i: number, q: number, now: number): void {
    const start = Windows.startOf(t);
    if (start < Windows.firstOpen(now)) return;
    const w = this.get(start);
    let samples = w.ground.get(band);
    if (!samples) {
      samples = new Map();
      w.ground.set(band, samples);
    }
    samples.set(t, [i, q]);
    w.groundMeta.set(band, meta);
  }

  /** Seal every window whose time has come. Returns how many sealed. */
  seal(now: number): number {
    let n = 0;
    for (const [start, w] of [...this.open.entries()].sort((a, b) => a[0] - b[0])) {
      if (start + SEAL_MS > now) continue;
      this.onSeal?.(w.body);
      for (const [band, samples] of [...w.ground.entries()].sort((a, b) => a[0] - b[0])) {
        const times = [...samples.keys()].sort((a, b) => a - b);
        if (!times.length) continue;
        const meta = w.groundMeta.get(band)!;
        const iq: number[] = [];
        // Contiguous on the 100 ms grid; a gap is silence.
        for (let t = times[0]!; t <= times.at(-1)!; t += 100) {
          const s = samples.get(t) ?? [0, 0];
          iq.push(Number(s[0].toFixed(5)), Number(s[1].toFixed(5)));
        }
        w.body.ground.push({ band, lat: meta.lat, lon: meta.lon, level: Number(meta.level.toFixed(3)), t0: times[0]!, iq });
      }
      w.body.rail.sort((a, b) => a[0] - b[0]);
      w.body.bikes.sort((a, b) => a[0] - b[0]);
      w.body.quakes.sort((a, b) => a[0] - b[0]);
      const text = JSON.stringify(w.body);
      this.sealed.set(start, text);
      this.open.delete(start);
      // Written beside, then renamed: a window on disk is whole or absent.
      this.disk(() => {
        const file = join(this.dir!, `${start}.json`);
        writeFileSync(`${file}.tmp`, text);
        renameSync(`${file}.tmp`, file);
      });
      n++;
    }
    // Keep three hours.
    for (const start of this.sealed.keys()) {
      if (now - start > KEEP_MS) {
        this.sealed.delete(start);
        this.disk(() => {
          const file = join(this.dir!, `${start}.json`);
          if (existsSync(file)) unlinkSync(file);
        });
      }
    }
    return n;
  }

  get sealedCount(): number {
    return this.sealed.size;
  }

  /** A sealed window's JSON, or null if it isn't sealed (yet, or any more). */
  body(start: number): string | null {
    return this.sealed.get(start) ?? null;
  }

  latestSealed(): number | null {
    let best: number | null = null;
    for (const s of this.sealed.keys()) if (best === null || s > best) best = s;
    return best;
  }
}
