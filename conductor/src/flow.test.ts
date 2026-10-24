import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Flow, bucket, flowOf, movingMedian } from "./flow.ts";
import { Slots } from "./slots.ts";
import { gridFrom, snowAhead, validSpan } from "./outlook.ts";

const HOUR = 3_600_000;

test("the usual is a weekday's, a Saturday's or a Sunday's hour, in Utah", () => {
  // Fri Oct 23 2026, 23:30 MDT = Sat 05:30 UTC.
  assert.equal(bucket(Date.parse("2026-10-24T05:30:00Z")), "weekday-23");
  assert.equal(bucket(Date.parse("2026-10-24T14:00:00Z")), "sat-8");
  assert.equal(bucket(Date.parse("2026-10-25T14:00:00Z")), "sun-8");
});

test("flow: pace against the usual, and lateness", () => {
  assert.equal(movingMedian([0, 0, 0.2, 5, 6, 7]), null, "too few moving");
  assert.equal(movingMedian([0, 0, ...Array.from({ length: 11 }, (_, i) => 4 + i)]), 9);
  assert.equal(flowOf(8, 8, 30), 0.65 * 0 + 0.35 * 0.125);
  assert.equal(flowOf(8, null, 300), -1, "without a usual, lateness alone");
  assert.ok(flowOf(6.5, 8, 200) < -0.8, "a slow, late hour");
  assert.ok(flowOf(6.4, 8, 45) < -0.6, "a slow one");
  assert.ok(flowOf(9.5, 8, 0) > 0.7, "a quick one");
});

test("an hour's flow is given for the slot after it, once its samples are in", () => {
  const dir = mkdtempSync(join(tmpdir(), "wasatch-flow-"));
  const path = join(dir, "usual.json");
  // Tuesdays at 8 AM, after the clocks went back (a usual is by local hour).
  const h0 = Date.parse("2026-11-03T15:00:00Z");
  const speeds = (v: number) => Array.from({ length: 40 }, (_, i) => (i < 10 ? 0 : v));
  // Three Tuesdays learn the usual; the fourth is slow.
  let flow = new Flow(path);
  for (let week = 0; week < 4; week++) {
    if (week === 2) flow = new Flow(path); // and it survives a restart
    const h = h0 + week * 7 * 24 * HOUR;
    for (let s = 0; s < 240; s++) assert.equal(flow.sample(speeds(week < 3 ? 8 : 6.4), 45, h + s * 15_000), null);
    const out = flow.sample(speeds(8), 45, h + HOUR);
    assert.equal(out?.slot, h + HOUR);
    if (week < 3) assert.equal(out?.flow, Math.round(flowOf(8, null, 45) * 100) / 100);
    else assert.equal(out?.flow, Math.round(flowOf(6.4, 8, 45) * 100) / 100);
    // The next hour starts over; a gap of hours closes nothing.
    flow.sample([], 0, h + 5 * HOUR);
  }
  writeFileSync(path, "{torn");
  assert.doesNotThrow(() => new Flow(path));
});

test("a slot is frozen once and survives a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "wasatch-slots-"));
  const path = join(dir, "slots.json");
  const h = Date.parse("2026-10-27T15:00:00Z");
  const now = h + 60_000;
  const slots = new Slots(path);
  assert.ok(slots.freeze(h, "flow", -0.4321, now));
  assert.ok(!slots.freeze(h, "flow", 0.9, now), "never revised");
  assert.ok(slots.freeze(h, "stormMm", 180, now));
  assert.ok(!slots.freeze(h + 1, "flow", 0, now), "not an hour");
  const again = new Slots(path);
  assert.deepEqual(again.get(h), { flow: -0.43, stormMm: 180 });
  const sky = { at: h, cloud: 0, precipMm: 0, snowCm: 0, tempC: 5, windMs: 2, gustMs: 3, pm25: 5, inversionC: 0, alert: 0, ridgeMs: 4, ridgeGustMs: 6, mtnSnowCm: 0 };
  assert.deepEqual(again.apply([sky, { ...sky, at: h + HOUR }]), [{ ...sky, flow: -0.43, stormMm: 180 }, { ...sky, at: h + HOUR }]);
  assert.deepEqual(Object.keys(again.since(h)), [String(h)]);
});

test("the snow forecast at Alta: each period's share inside the next day", () => {
  assert.deepEqual(validSpan("2026-10-24T18:00:00+00:00/PT6H"), [Date.parse("2026-10-24T18:00:00Z"), Date.parse("2026-10-25T00:00:00Z")]);
  assert.deepEqual(validSpan("2026-10-24T12:00:00+00:00/P1DT6H")?.map((t) => t - Date.parse("2026-10-24T12:00:00Z")), [0, 30 * HOUR]);
  const from = Date.parse("2026-10-24T21:00:00Z");
  const values = [
    { validTime: "2026-10-24T18:00:00+00:00/PT6H", value: 60 }, // half inside
    { validTime: "2026-10-25T00:00:00+00:00/PT12H", value: 100 },
    { validTime: "2026-10-25T18:00:00+00:00/PT6H", value: 40 }, // half inside
    { validTime: "2026-10-26T00:00:00+00:00/PT6H", value: 500 }, // after
    { validTime: "2026-10-25T12:00:00+00:00/PT6H", value: null },
  ];
  assert.equal(snowAhead(values, from), 30 + 100 + 20);
});

test("the grid: the latest hour against the same hour the week before", () => {
  const rows = [{ period: "2026-10-24T22", value: "6600" }];
  for (let d = 1; d <= 7; d++) rows.push({ period: new Date(Date.parse("2026-10-24T22:00:00Z") - d * 24 * HOUR).toISOString().slice(0, 13), value: String(5900 + d * 20) });
  rows.push({ period: "2026-10-24T21", value: "6700" });
  const g = gridFrom(rows)!;
  assert.equal(g.mw, 6600);
  assert.equal(g.usual, 5980);
  assert.equal(g.energy, Math.round((6600 / 5980) * 1000) / 1000);
  assert.equal(gridFrom(rows.slice(0, 2)), null, "too few days to know the usual");
});
