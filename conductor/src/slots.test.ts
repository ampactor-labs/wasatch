import assert from "node:assert/strict";
import { test } from "node:test";
import { freezeAhead, Slots } from "./slots.ts";
import type { SkyHour } from "../../web/src/engine/protocol.ts";

const HOUR = 3_600_000;
const hour = (at: number): SkyHour => ({ at, cloud: 0, precipMm: 0, snowCm: 0, tempC: 10, windMs: 2, gustMs: 3, pm25: 5, inversionC: 0, alert: 0, ridgeMs: 4, ridgeGustMs: 6, mtnSnowCm: 0 });

test("frozen hours: set once, applied to the sky, measured where set", () => {
  const s = new Slots(null);
  const at = Date.parse("2026-10-28T21:00:00Z");
  assert.equal(s.freeze(at, "pm25", 2.74, at), true);
  assert.equal(s.freeze(at, "pm25", 9, at), false, "never revised");
  assert.equal(s.freeze(at, "pm25Downtown", 11.1, at), true);
  assert.equal(s.freeze(at, "pm25Lake", Number.NaN, at), false);
  assert.equal(s.freeze(at + 60_000, "pm25Lake", 2, at), false, "not an hour");
  const [h, next] = s.apply([hour(at), hour(at + HOUR)]);
  assert.equal(h!.pm25, 2.74);
  assert.equal(h!.pm25Downtown, 11.1);
  assert.equal(h!.pm25Lake, undefined);
  assert.equal(next!.pm25, 5, "the model's where nothing is frozen");
  assert.equal(s.measured(at, "pm25"), true);
  assert.equal(s.measured(at, "pm25Downtown"), true);
  assert.equal(s.measured(at, "pm25Lake"), false);
  assert.deepEqual(s.since(at), { [at]: { pm25: 2.74, pm25Downtown: 11.1 } });
});

test("the next hour's alerts, models and slow values freeze in this hour's last quarter", () => {
  const top = Date.parse("2026-10-29T20:00:00Z");
  const next = { ...hour(top + HOUR), alert: 0.6, mtnSnowCm: 1.2, inversionC: 4.5, ridgeMs: 9, ridgeGustMs: 14 };
  const slow = { lakeFt: 4189.83, lakeDevFt: 0.04, river: Number.NaN, snowpack: 1.1, newSnowIn: 3, powder: 0.7, energy: 0.95 };
  const s = new Slots(null);
  assert.equal(freezeAhead(s, top + 40 * 60_000, next, slow), false, "too early: still revisable");
  assert.equal(freezeAhead(s, top + 56 * 60_000, next, slow), false, "too late: a phone might not have it in time");
  assert.equal(freezeAhead(s, top + 47 * 60_000, next, slow), true);
  const v = s.get(top + HOUR)!;
  assert.deepEqual(
    { alert: v.alert, mtn: v.mtnSnowCm, inv: v.inversionC, ridge: v.ridgeGustMs, lake: v.lakeFt, river: v.river, newSnow: v.newSnowIn },
    { alert: 0.6, mtn: 1.2, inv: 4.5, ridge: 14, lake: 4189.83, river: undefined, newSnow: 3 },
  );
  // Never revised: an alert that's gone by the next look stays for the hour.
  assert.equal(freezeAhead(s, top + 50 * 60_000, { ...next, alert: 0 }, slow), false);
  assert.equal(s.apply([next])[0]!.alert, 0.6);
  // The model's wind isn't a measurement.
  assert.equal(s.measured(top + HOUR, "ridgeGustMs"), false);
});

test("wind measured up the canyons wins over the model's", () => {
  const top = Date.parse("2026-10-29T20:00:00Z");
  const s = new Slots(null);
  s.freeze(top + HOUR, "ridgeMs", 5, top + 35 * 60_000);
  s.freeze(top + HOUR, "ridgeGustMs", 8, top + 35 * 60_000);
  freezeAhead(s, top + 46 * 60_000, { ...hour(top + HOUR), ridgeMs: 12, ridgeGustMs: 20 }, {});
  assert.equal(s.get(top + HOUR)!.ridgeGustMs, 8);
  assert.equal(s.measured(top + HOUR, "ridgeGustMs"), true);
  assert.equal(s.apply([hour(top + HOUR)])[0]!.ridgeGustMs, 8);
});

test("the inversion measured at Snowbird wins over the model's, and says so", () => {
  const top = Date.parse("2026-12-10T15:00:00Z");
  const s = new Slots(null);
  freezeAhead(s, top + 46 * 60_000, { ...hour(top + HOUR), inversionC: 1.5 }, { inversionC: 6.2 });
  assert.equal(s.get(top + HOUR)!.inversionC, 6.2);
  assert.equal(s.measured(top + HOUR, "inversionC"), true);
  const t = new Slots(null);
  freezeAhead(t, top + 46 * 60_000, { ...hour(top + HOUR), inversionC: 1.5 }, {});
  assert.equal(t.get(top + HOUR)!.inversionC, 1.5);
  assert.equal(t.measured(top + HOUR, "inversionC"), false);
});

