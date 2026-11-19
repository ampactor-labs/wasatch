// What's usual for an hour: the median of the last few times that hour was
// seen (a weekday's 8 AM, a Saturday's, a Sunday's), learned as the
// conductor runs and kept on disk. The fleet's speed, its buses out and its
// lateness, and each sign's minutes all learn here alike.
//
// A median, not a running average: one odd hour (a crash on I-15, a
// cancelled run) barely moves it. And an exception day teaches it nothing:
// a weekday running Saturday's or Sunday's schedule (Thanksgiving, the
// Fourth) is compared with the usual, so it sounds thin, but the Monday
// after isn't measured against it.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** How many past hours the usual remembers per bucket. */
export const KEEP = 5;
/** How many it needs before it says anything. */
export const KNOWN = 3;

const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" });

function parts(ms: number): { day: "weekday" | "sat" | "sun"; hour: number; date: string } {
  const p = Object.fromEntries(local.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const day = p.weekday === "Sat" ? "sat" : p.weekday === "Sun" ? "sun" : "weekday";
  return { day, hour: Number(p.hour), date: `${p.year}-${p.month}-${p.day}` };
}

/** Which usual an hour is compared with: "weekday-8", "sat-8", "sun-8". */
export function bucket(ms: number): string {
  const { day, hour } = parts(ms);
  return `${day}-${hour}`;
}

/** The local date of `ms` in Utah, YYYY-MM-DD. */
export function localDate(ms: number): string {
  return parts(ms).date;
}

/** Whether `date` (YYYY-MM-DD) runs another kind of day's schedule: a
 * weekday whose service set is a Saturday's or Sunday's, or a Saturday
 * whose is a Sunday's. `days` maps dates to their service-set keys (the
 * compiled schedule's manifest). Unknown dates aren't exceptions. */
export function isException(date: string, days: Record<string, string>): boolean {
  const key = days[date];
  if (!key) return false;
  const kind = (d: string) => {
    const w = new Date(`${d}T12:00:00Z`).getUTCDay();
    return w === 0 ? "sun" : w === 6 ? "sat" : "weekday";
  };
  const mine = kind(date);
  if (mine === "sun") return false;
  for (const [d, k] of Object.entries(days)) {
    if (k !== key || d === date) continue;
    const other = kind(d);
    if (other === "sun" || (mine === "weekday" && other === "sat")) return true;
  }
  return false;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

/** Usuals by key and bucket, each the last `KEEP` values seen. */
export class Usuals {
  private readonly path: string | null;
  private data: Record<string, Record<string, number[]>> = {};

  /** `migrate` turns a file in an older format into this one (or null to
   * start over). */
  constructor(path: string | null, migrate?: (old: unknown) => Record<string, Record<string, number[]>> | null) {
    this.path = path;
    if (!path || !existsSync(path)) return;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      const v2 = raw as { v?: number; data?: Record<string, Record<string, number[]>> };
      if (v2 && v2.v === 2 && v2.data) this.data = v2.data;
      else this.data = migrate?.(raw) ?? {};
    } catch {
      // Unreadable: learn it again.
    }
  }

  /** The usual for `key` in `bucket`, once seen `KNOWN` times; else null. */
  get(key: string, bucket: string): number | null {
    const xs = this.data[key]?.[bucket];
    return xs && xs.length >= KNOWN ? median(xs) : null;
  }

  /** How many times `key` in `bucket` has been seen (up to `KEEP`). */
  seen(key: string, bucket: string): number {
    return this.data[key]?.[bucket]?.length ?? 0;
  }

  /** Learn `value` for `key` in `bucket`, unless `exception`. */
  learn(key: string, bucket: string, value: number, exception = false): void {
    if (exception || !Number.isFinite(value)) return;
    const b = (this.data[key] ??= {});
    b[bucket] = [...(b[bucket] ?? []), value].slice(-KEEP);
  }

  save(): void {
    if (!this.path) return;
    try {
      writeFileSync(`${this.path}.tmp`, JSON.stringify({ v: 2, data: this.data }));
      renameSync(`${this.path}.tmp`, this.path);
    } catch {
      // Kept in memory.
    }
  }
}

/** A value learned by a running average in the older files, as that many
 * (up to `KNOWN`) copies: what was known stays known. */
export function seed(value: number | undefined, n: number | undefined): number[] | null {
  if (value === undefined || !Number.isFinite(value) || !n) return null;
  return Array.from({ length: Math.min(n, KNOWN) }, () => value);
}
