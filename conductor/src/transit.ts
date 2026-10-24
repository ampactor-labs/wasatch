// TRAX and FrontRunner, live: which trains actually left which stations,
// and how late.
//
// UTA's trip updates predict a time for each stop still ahead of a trip and
// drop a stop once the train has passed it. So a stop's last prediction,
// when it drops out, is when the train left: observed minus scheduled is its
// lateness. Trains the feed doesn't track keep their schedule, marked so.

import type { Feed } from "./gtfsrt.ts";
import type { RailRow } from "./windows.ts";

interface DayFile {
  rail: { r: number; d: number; s: number[]; t: number[] }[];
}
interface RtIndex {
  ids: string[];
  seqs: number[][];
}
interface Manifest {
  days: Record<string, string>;
  t0: Record<string, number>;
}

interface TripRef {
  t0: number;
  trip: DayFile["rail"][number];
  seqs: number[];
}

interface Pending {
  ref: TripRef;
  k: number;
  /** Predicted departure, UTC ms. */
  pred: number;
  /** The feed timestamp it was last listed in. */
  seen: number;
  /** Whether that prediction was current (not already past). */
  fresh: boolean;
  /** When it was first listed. */
  since: number;
}

/** A prediction more than this far in the past is stale. */
const CURRENT_MS = 60_000;

/** How long after a trip was last in the feed it still counts as tracked. */
const TRACKED_MS = 15 * 60_000;

export class Transit {
  private readonly base: string;
  private trips = new Map<string, TripRef>();
  private byId = new Map<string, TripRef[]>();
  private loadedFor = "";
  private pending = new Map<string, Pending>();
  private tracked = new Map<TripRef, number>();
  private lastFeed = 0;
  /** Departures settled since the last call to `drain`. */
  private settled: RailRow[] = [];
  stats = { trips: 0, tracked: 0, settled: 0, medianLateS: 0 };
  private recentLate: number[] = [];

  /** `base`: where the compiled schedule lives (a URL or a directory). */
  constructor(base: string) {
    this.base = base.replace(/\/$/, "");
  }

  private async read<T>(name: string): Promise<T> {
    if (/^https?:/.test(this.base)) {
      const res = await fetch(`${this.base}/${name}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`${res.status} ${name}`);
      return (await res.json()) as T;
    }
    const { readFileSync } = await import("node:fs");
    return JSON.parse(readFileSync(`${this.base}/${name}`, "utf8")) as T;
  }

  /** Load the service days around `now` (again when the date turns). */
  async load(now: number): Promise<void> {
    const manifest = await this.read<Manifest>("manifest.json");
    const dates = Object.entries(manifest.t0)
      .filter(([, t0]) => now >= t0 - 3_600_000 && now < t0 + 31 * 3_600_000)
      .map(([d]) => d);
    const tag = dates.join(",");
    if (tag === this.loadedFor) return;
    const trips = new Map<string, TripRef>();
    for (const date of dates) {
      const key = manifest.days[date];
      const t0 = manifest.t0[date];
      if (!key || t0 === undefined) continue;
      const [day, rt] = await Promise.all([this.read<DayFile>(`day-${key}.json`), this.read<RtIndex>(`rt-${key}.json`)]);
      day.rail.forEach((trip, i) => {
        const id = rt.ids[i];
        const seqs = rt.seqs[i];
        if (id && seqs) trips.set(`${date}|${id}`, { t0, trip, seqs });
      });
    }
    this.trips = trips;
    this.byId = new Map();
    for (const [key, ref] of trips) {
      const id = key.slice(key.indexOf("|") + 1);
      this.byId.set(id, [...(this.byId.get(id) ?? []), ref]);
    }
    this.loadedFor = tag;
    this.stats.trips = trips.size;
  }

  private refFor(tripId: string, feedMs: number): TripRef | undefined {
    // A trip id can run on two service days; take the one running now.
    let best: TripRef | undefined;
    for (const ref of this.byId.get(tripId) ?? []) {
      const first = ref.t0 + ref.trip.t[0]! * 1000;
      const last = ref.t0 + ref.trip.t.at(-1)! * 1000;
      if (feedMs >= first - 3_600_000 && feedMs <= last + 3_600_000) best = ref;
    }
    return best;
  }

  /** Read a trip-update feed. */
  ingest(feed: Feed): void {
    const feedMs = feed.timestamp * 1000;
    if (feedMs <= this.lastFeed) return;
    this.lastFeed = feedMs;
    const listed = new Set<string>();
    /** Each trip's delay now, from its current predictions (median). */
    const delay = new Map<TripRef, number>();
    /** Each trip's last stop with a current prediction. */
    const freshUpTo = new Map<TripRef, number>();
    for (const tu of feed.trips) {
      const ref = this.refFor(tu.tripId, feedMs);
      if (!ref) continue;
      this.tracked.set(ref, feedMs);
      const current: number[] = [];
      for (const stu of tu.stops) {
        const k = ref.seqs.indexOf(stu.seq);
        const time = stu.departure || stu.arrival;
        if (k < 0 || !time || stu.skipped) continue;
        const pred = time * 1000;
        const key = `${tu.tripId}|${k}`;
        listed.add(key);
        // A prediction is current while it's not already in the past; the
        // feed keeps some passed stops listed with their old predictions.
        const fresh = pred >= feedMs - CURRENT_MS;
        if (fresh) {
          current.push(pred - (ref.t0 + ref.trip.t[k]! * 1000));
          freshUpTo.set(ref, Math.max(freshUpTo.get(ref) ?? -1, k));
        }
        const was = this.pending.get(key);
        this.pending.set(key, { ref, k, pred, seen: feedMs, fresh, since: was?.since ?? feedMs });
      }
      if (current.length) delay.set(ref, current.sort((a, b) => a - b)[Math.floor(current.length / 2)]!);
    }
    for (const [key, p] of this.pending) {
      const sched = p.ref.t0 + p.ref.trip.t[p.k]! * 1000;
      const dropped = !listed.has(key);
      // Still listed, stale, with a current stop after it: the train is past it.
      const passed = !dropped && !p.fresh && (freshUpTo.get(p.ref) ?? -1) > p.k;
      if (!dropped && !passed) {
        // Stuck in the feed for twenty minutes with nothing after it: give up.
        if (feedMs - p.since > 20 * 60_000) this.pending.delete(key);
        continue;
      }
      this.pending.delete(key);
      // Dropped while still far ahead: cancelled or detoured, not departed.
      if (dropped && p.pred > feedMs + 120_000) continue;
      // A current prediction says when it left. A stale one doesn't: then
      // it's the schedule plus the trip's delay now, or nothing.
      let actual: number;
      if (p.fresh) actual = Math.min(p.pred, feedMs);
      else {
        const d = delay.get(p.ref);
        if (d === undefined) continue;
        actual = Math.min(sched + d, feedMs);
      }
      this.settled.push([Math.round(actual), sched, p.ref.trip.r, p.ref.trip.d, p.ref.trip.s[p.k]!, 1]);
      this.stats.settled++;
      this.recentLate.push((actual - sched) / 1000);
      if (this.recentLate.length > 200) this.recentLate.shift();
    }
    for (const [ref, at] of this.tracked) if (feedMs - at > TRACKED_MS) this.tracked.delete(ref);
    this.stats.tracked = this.tracked.size;
    const sorted = [...this.recentLate].sort((a, b) => a - b);
    this.stats.medianLateS = sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]!) : 0;
  }

  /** The departures settled since the last call. */
  drain(): RailRow[] {
    return this.settled.splice(0);
  }

  /** The schedule's departures from `from` to `to` for trains realtime
   * isn't tracking: they still ring, marked as scheduled. */
  untracked(from: number, to: number): RailRow[] {
    const out: RailRow[] = [];
    for (const ref of this.trips.values()) {
      if (this.tracked.has(ref)) continue;
      const { trip, t0 } = ref;
      if (t0 + trip.t[0]! * 1000 > to || t0 + trip.t.at(-1)! * 1000 < from) continue;
      trip.t.forEach((sec, k) => {
        const ms = t0 + sec * 1000;
        if (ms >= from && ms < to) out.push([ms, ms, trip.r, trip.d, trip.s[k]!, 0]);
      });
    }
    return out;
  }
}
