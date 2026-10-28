import assert from "node:assert/strict";
import { test } from "node:test";
import { Slots } from "./slots.ts";
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
