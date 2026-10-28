// Values frozen hour by hour: worked out once for an hour and never revised,
// so every phone plans the same day from them, whenever it joined, and the
// sky archive can seal them as they were (DESIGN.md, Determinism and sync).
//
// The fleet's flow is the conductor's own observation; the snow forecast at
// Alta is a forecast, frozen so that what it colors is the same everywhere.
// With UDOT's and AirNow's keys, the wind measured up the canyons and the
// PM2.5 measured at the valley's monitors take the models' place: each read
// in an hour's second half and frozen for the hour after, so every phone has
// it before that hour plays. The air comes three ways: the valley's (the
// monitors' median), downtown's (Hawthorne) and the lake's (the station at
// Saltair), so each vantage hears the haze where it stands.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { SkyHour } from "../../web/src/engine/protocol.ts";

export interface SlotValues {
  flow?: number;
  stormMm?: number;
  /** Measured, in place of the models'. */
  ridgeMs?: number;
  ridgeGustMs?: number;
  pm25?: number;
  pm25Downtown?: number;
  pm25Lake?: number;
}

const FIELDS = ["flow", "stormMm", "ridgeMs", "ridgeGustMs", "pm25", "pm25Downtown", "pm25Lake"] as const;

/** The fields that stand for a measurement, for the receipts. */
export type Measured = "ridgeGustMs" | "pm25" | "pm25Downtown" | "pm25Lake";

const HOUR = 3_600_000;
const KEEP_MS = 14 * 86_400_000;

export class Slots {
  private slots = new Map<number, SlotValues>();
  private readonly path: string | null;

  /** `path`: where they're kept across restarts (a restart that lost them
   * would revise the day). */
  constructor(path: string | null) {
    this.path = path;
    if (!path || !existsSync(path)) return;
    try {
      const saved = JSON.parse(readFileSync(path, "utf8")) as Record<string, SlotValues>;
      for (const [at, v] of Object.entries(saved)) this.slots.set(Number(at), v);
    } catch {
      // Unreadable: start over rather than serve something half-read.
    }
  }

  /** Freeze `field` for the hour starting at `at`, unless it already is.
   * Returns whether it was set now. */
  freeze(at: number, field: keyof SlotValues, value: number, now = Date.now()): boolean {
    if (!Number.isFinite(value) || at % HOUR !== 0) return false;
    const slot = this.slots.get(at) ?? {};
    if (slot[field] !== undefined) return false;
    slot[field] = Math.round(value * 100) / 100;
    this.slots.set(at, slot);
    for (const t of this.slots.keys()) if (now - t > KEEP_MS) this.slots.delete(t);
    this.save();
    return true;
  }

  get(at: number): SlotValues | undefined {
    return this.slots.get(at);
  }

  /** The sky's hours with their frozen values. */
  apply(hours: SkyHour[]): SkyHour[] {
    return hours.map((h) => {
      const v = this.slots.get(h.at);
      if (!v) return h;
      const out = { ...h };
      for (const k of FIELDS) if (v[k] !== undefined) out[k] = v[k];
      return out;
    });
  }

  /** Whether the hour at `at` has a measured `field`, for the receipts. */
  measured(at: number, field: Measured): boolean {
    return this.slots.get(at)?.[field] !== undefined;
  }

  /** Every frozen hour from `from` on, for the archive. */
  since(from: number): Record<string, SlotValues> {
    return Object.fromEntries([...this.slots].filter(([at]) => at >= from).sort((a, b) => a[0] - b[0]));
  }

  private save(): void {
    if (!this.path) return;
    try {
      writeFileSync(`${this.path}.tmp`, JSON.stringify(this.since(0)));
      renameSync(`${this.path}.tmp`, this.path);
    } catch {
      // Kept in memory; the next save tries again.
    }
  }
}
