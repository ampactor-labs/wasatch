// How the buses and trains are moving against the usual for the hour: the
// fleet's speed (the median of the vehicles moving) against what it usually
// is then, and the trains' lateness. An hour's flow nudges the tempo after
// it a few BPM: a valley stuck in traffic slows the music, a clear one lifts
// it.
//
// The usual is learned as the conductor runs, for each hour of a weekday, a
// Saturday and a Sunday; until an hour has been seen three times, its flow
// is the lateness alone. With UDOT's key the minutes on the overhead signs,
// against their own usual (udot.ts), share the pace with the fleet.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const HOUR = 3_600_000;
/** A vehicle slower than this is stopped (at a stop, a light, a layover). */
export const MOVING_MS = 0.5;
/** Too few out (the small hours) says nothing about traffic. */
const MIN_MOVING = 10;
const MIN_SAMPLES = 15;
/** How fast the usual learns. */
const ALPHA = 0.3;

interface Usual {
  speed: number;
  n: number;
}

const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", hour: "numeric", hourCycle: "h23" });

/** Which usual an hour is compared with: "weekday-8", "sat-8", "sun-8". */
export function bucket(ms: number): string {
  const parts = Object.fromEntries(local.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const day = parts.weekday === "Sat" ? "sat" : parts.weekday === "Sun" ? "sun" : "weekday";
  return `${day}-${Number(parts.hour)}`;
}

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
export function flowOf(speed: number, usual: number | null, lateS: number, incidents = 0, signs: number | null = null): number {
  const late = clamp(-(lateS - 60) / 240, -1, 0.25);
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
  private usual: Record<string, Usual> = {};
  private readonly path: string | null;
  stats = { hour: null as number | null, speedMs: null as number | null, usualMs: null as number | null, flow: null as number | null };

  constructor(path: string | null) {
    this.path = path;
    if (!path || !existsSync(path)) return;
    try {
      this.usual = JSON.parse(readFileSync(path, "utf8")) as Record<string, Usual>;
    } catch {
      // Unreadable: learn it again.
    }
  }

  /** A look at the fleet at `now`: its vehicles' speeds (m/s), the trains'
   * median lateness (s), and the incidents standing on the highways. When
   * it's the first of a new hour, the hour before closes: returns its flow,
   * for the slot starting now. `signs` is asked then for the hour's pace on
   * the overhead signs (null without UDOT's key or a usual yet). */
  sample(speeds: number[], lateS: number, now: number, incidents = 0, signs?: (hour: number) => number | null): { slot: number; flow: number } | null {
    const hour = Math.floor(now / HOUR) * HOUR;
    let closed: { slot: number; flow: number } | null = null;
    if (hour !== this.hour) {
      if (this.hour >= 0 && hour - this.hour === HOUR) closed = this.close(hour, signs?.(this.hour) ?? null);
      this.hour = hour;
      this.speeds = [];
      this.lates = [];
      this.incidents = [];
    }
    const m = movingMedian(speeds);
    if (m !== null) {
      this.speeds.push(m);
      this.lates.push(lateS);
      this.incidents.push(incidents);
    }
    return closed;
  }

  private close(slot: number, signs: number | null): { slot: number; flow: number } | null {
    if (this.speeds.length < MIN_SAMPLES) return null;
    const speed = median(this.speeds);
    const late = median(this.lates);
    const incidents = median(this.incidents);
    const key = bucket(this.hour);
    const u = this.usual[key];
    const flow = Math.round(flowOf(speed, u && u.n >= 3 ? u.speed : null, late, incidents, signs) * 100) / 100;
    this.usual[key] = u ? { speed: u.speed + ALPHA * (speed - u.speed), n: u.n + 1 } : { speed, n: 1 };
    this.save();
    this.stats = { hour: this.hour, speedMs: Math.round(speed * 100) / 100, usualMs: u ? Math.round(u.speed * 100) / 100 : null, flow };
    return { slot, flow };
  }

  private save(): void {
    if (!this.path) return;
    try {
      writeFileSync(`${this.path}.tmp`, JSON.stringify(this.usual));
      renameSync(`${this.path}.tmp`, this.path);
    } catch {
      // Kept in memory.
    }
  }
}
