// How the buses and trains are moving against the usual for the hour: the
// fleet's speed (the median of the vehicles moving) against what it usually
// is then, and the trains' lateness. An hour's flow nudges the tempo after
// it a few BPM: a valley stuck in traffic slows the music, a clear one lifts
// it.
//
// The same hour's busyness: how many buses are out against the usual for
// the hour (holidays, cancellations and added service move it; the
// timetable alone wouldn't), which sets how full the groove's hats are.
//
// The usual is learned as the conductor runs, for each hour of a weekday, a
// Saturday and a Sunday; until an hour has been seen three times, its flow
// is the lateness alone. With UDOT's key the minutes on the overhead signs,
// against their own usual (udot.ts), share the pace with the fleet.

import { bucket, isException, localDate, seed, Usuals } from "./usual.ts";

export { bucket };

const HOUR = 3_600_000;
/** A vehicle slower than this is stopped (at a stop, a light, a layover). */
export const MOVING_MS = 0.5;
/** Too few out (the small hours) says nothing about traffic. */
const MIN_MOVING = 10;
const MIN_SAMPLES = 15;
/** The trains' median lateness on an ordinary hour, before the conductor
 * has learned the hour's own (live medians ran 108–193 s by line, Nov 2026). */
export const USUAL_LATE_S = 120;
/** Fewer buses than this usually out (the small hours) says nothing. */
const MIN_USUAL_BUSES = 20;

/** The median of the vehicles moving, m/s; null with too few moving. */
export function movingMedian(speeds: number[]): number | null {
  const moving = speeds.filter((s) => Number.isFinite(s) && s > MOVING_MS).sort((a, b) => a - b);
  return moving.length >= MIN_MOVING ? moving[Math.floor(moving.length / 2)]! : null;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** An hour's flow, −1 (crawling) to 1 (quick), from its speed against the
 * usual (null while there's no usual yet), the trains' median lateness, and
 * (with UDOT's key) the crashes and closures standing on the highways and
 * the minutes on the overhead signs against their usual (`signs`, −1…1,
 * null without): the fleet's pace and the signs' share the pace. */
export function flowOf(speed: number, usual: number | null, lateS: number, incidents = 0, signs: number | null = null, usualLateS: number | null = null): number {
  // Lateness against what's usual for the hour (UTA's trains run about two
  // minutes behind on an ordinary day), not against the timetable.
  const late = clamp(-(lateS - (usualLateS ?? USUAL_LATE_S)) / 240, -1, 0.25);
  const blocked = 0.1 * Math.min(3, incidents);
  const paces: number[] = [];
  if (usual !== null) paces.push(clamp((speed / usual - 1) / 0.12, -1, 1));
  if (signs !== null && Number.isFinite(signs)) paces.push(clamp(signs, -1, 1));
  if (!paces.length) return clamp(late - blocked, -1, 1);
  const pace = paces.reduce((a, b) => a + b, 0) / paces.length;
  return clamp(0.65 * pace + 0.35 * late - blocked, -1, 1);
}

export class Flow {
  private hour = -1;
  private speeds: number[] = [];
  private lates: number[] = [];
  private incidents: number[] = [];
  private buses: number[] = [];
  private readonly usual: Usuals;
  /** The schedule's service set per date, to spot holidays (set by the
   * server from the manifest). */
  days: Record<string, string> = {};
  stats = { hour: null as number | null, speedMs: null as number | null, usualMs: null as number | null, flow: null as number | null, busy: null as number | null };

  constructor(path: string | null) {
    // Older files kept a running average per bucket: { speed, n, buses, nb }.
    this.usual = new Usuals(path, (old) => {
      const out: Record<string, Record<string, number[]>> = { speed: {}, buses: {} };
      for (const [b, u] of Object.entries(old as Record<string, { speed?: number; n?: number; buses?: number; nb?: number }>)) {
        const sp = seed(u.speed, u.n);
        const bu = seed(u.buses, u.nb);
        if (sp) out.speed![b] = sp;
        if (bu) out.buses![b] = bu;
      }
      return out;
    });
  }

  /** A look at the fleet at `now`: its vehicles' speeds (m/s), the trains'
   * median lateness (s), and the incidents standing on the highways. When
   * it's the first of a new hour, the hour before closes: returns its flow,
   * for the slot starting now. `signs` is asked then for the hour's pace on
   * the overhead signs (null without UDOT's key or a usual yet). */
  sample(
    speeds: number[],
    lateS: number,
    now: number,
    incidents = 0,
    signs?: (hour: number) => number | null,
    buses: number | null = null,
  ): { slot: number; flow: number; busy: number | null } | null {
    const hour = Math.floor(now / HOUR) * HOUR;
    let closed: { slot: number; flow: number; busy: number | null } | null = null;
    if (hour !== this.hour) {
      if (this.hour >= 0 && hour - this.hour === HOUR) closed = this.close(hour, signs?.(this.hour) ?? null);
      this.hour = hour;
      this.speeds = [];
      this.lates = [];
      this.incidents = [];
      this.buses = [];
    }
    const m = movingMedian(speeds);
    if (m !== null) {
      this.speeds.push(m);
      this.lates.push(lateS);
      this.incidents.push(incidents);
    }
    if (buses !== null && Number.isFinite(buses)) this.buses.push(buses);
    return closed;
  }

  private close(slot: number, signs: number | null): { slot: number; flow: number; busy: number | null } | null {
    if (this.speeds.length < MIN_SAMPLES) return null;
    const speed = median(this.speeds);
    const late = median(this.lates);
    const incidents = median(this.incidents);
    const b = bucket(this.hour);
    const usualSpeed = this.usual.get("speed", b);
    const flow = Math.round(flowOf(speed, usualSpeed, late, incidents, signs, this.usual.get("late", b)) * 100) / 100;
    // Buses out against the usual for the hour, once it's been seen three times.
    const buses = this.buses.length >= MIN_SAMPLES ? median(this.buses) : null;
    const usualBuses = this.usual.get("buses", b);
    const busy = buses !== null && usualBuses !== null && usualBuses >= MIN_USUAL_BUSES ? Math.round((buses / usualBuses) * 100) / 100 : null;
    // A holiday is heard against the usual (thin) but doesn't teach it.
    const exception = isException(localDate(this.hour), this.days);
    this.usual.learn("speed", b, speed, exception);
    this.usual.learn("late", b, late, exception);
    if (buses !== null) this.usual.learn("buses", b, buses, exception);
    this.usual.save();
    this.stats = { hour: this.hour, speedMs: Math.round(speed * 100) / 100, usualMs: usualSpeed === null ? null : Math.round(usualSpeed * 100) / 100, flow, busy };
    return { slot, flow, busy };
  }
}
