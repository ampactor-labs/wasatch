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
//
// What the models say of an hour and the storm alerts issued for it (the
// alert level steers the plan's tension), and the slow values (the lake,
// the rivers, the snow, the grid), are frozen in the hour before's last
// quarter: a phone that fetched them at another moment, or joined after an
// alert expired, still plans the hour from the same ones, and the archive
// seals what was played.

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
  /** The issued alerts' level and the models' values for the hour. */
  alert?: number;
  mtnSnowCm?: number;
  inversionC?: number;
  /** 1 when the ridge wind was frozen from the model, not measured. */
  ridgeModel?: number;
  /** 1 when the inversion was measured (Snowbird against the airport), not
   * the model's. */
  inversionMeasured?: number;
  /** The slow values as they stood. */
  lakeFt?: number;
  lakeDevFt?: number;
  river?: number;
  snowpack?: number;
  newSnowIn?: number;
  powder?: number;
  energy?: number;
  /** Buses out against the usual for the hour (the conductor's, observed). */
  busy?: number;
}

/** What's laid over the sky's hours as served (everything but the markers). */
const FIELDS = [
  "flow",
  "stormMm",
  "ridgeMs",
  "ridgeGustMs",
  "pm25",
  "pm25Downtown",
  "pm25Lake",
  "alert",
  "mtnSnowCm",
  "inversionC",
  "lakeFt",
  "lakeDevFt",
  "river",
  "snowpack",
  "newSnowIn",
  "powder",
  "energy",
  "busy",
] as const;

/** The fields that stand for a measurement, for the receipts. */
export type Measured = "ridgeGustMs" | "pm25" | "pm25Downtown" | "pm25Lake" | "inversionC";

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
    const slot = this.slots.get(at);
    if (!slot || slot[field] === undefined) return false;
    if (field === "inversionC") return slot.inversionMeasured === 1;
    return !(field === "ridgeGustMs" && slot.ridgeModel);
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

/** The slow values as they stand, for `freezeAhead`. */
export interface SlowNow {
  lakeFt?: number;
  lakeDevFt?: number;
  river?: number;
  snowpack?: number;
  newSnowIn?: number;
  powder?: number;
  energy?: number;
  /** Warmer aloft, °C, measured: Snowbird's station (9,170 ft) against
   * the airport, where both are fresh. Wins over the model's. */
  inversionC?: number;
}

const SLOW_FIELDS = ["lakeFt", "lakeDevFt", "river", "snowpack", "newSnowIn", "powder", "energy"] as const;

/** In an hour's last quarter (45 to 54 minutes in: a phone refreshes its
 * sky every five minutes and must have the next hour's before it plays, 90 s
 * after it starts), freeze for the next hour what the models and the issued
 * alerts say of it, and the slow values as they stand. Wind measured up the
 * canyons, frozen from the half hour, wins over the model's. Returns whether
 * anything was frozen. */
export function freezeAhead(slots: Slots, now: number, next: SkyHour | undefined, slow: SlowNow): boolean {
  const hour = Math.floor(now / HOUR) * HOUR;
  const into = now - hour;
  if (into < 45 * 60_000 || into >= 54 * 60_000) return false;
  const at = hour + HOUR;
  let changed = false;
  const put = (field: keyof SlotValues, v: number | undefined) => {
    if (v !== undefined && slots.freeze(at, field, v, now)) changed = true;
  };
  if (slow.inversionC !== undefined && Number.isFinite(slow.inversionC) && slots.get(at)?.inversionC === undefined) {
    put("inversionC", slow.inversionC);
    put("inversionMeasured", 1);
  }
  if (next?.at === at) {
    put("alert", next.alert);
    put("mtnSnowCm", next.mtnSnowCm);
    put("inversionC", next.inversionC);
    if (slots.get(at)?.ridgeGustMs === undefined && Number.isFinite(next.ridgeGustMs) && Number.isFinite(next.ridgeMs)) {
      put("ridgeMs", next.ridgeMs);
      put("ridgeGustMs", next.ridgeGustMs);
      put("ridgeModel", 1);
    }
  }
  for (const k of SLOW_FIELDS) put(k, slow[k]);
  return changed;
}
