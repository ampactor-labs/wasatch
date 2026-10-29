import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Flow, bucket, flowOf, movingMedian } from "./flow.ts";
import { Slots } from "./slots.ts";
import { gridFrom, mixFrom, snowAhead, validSpan } from "./outlook.ts";

const HOUR = 3_600_000;

test("the usual is a weekday's, a Saturday's or a Sunday's hour, in Utah", () => {
  // Fri Oct 23 2026, 23:30 MDT = Sat 05:30 UTC.
  assert.equal(bucket(Date.parse("2026-10-24T05:30:00Z")), "weekday-23");
  assert.equal(bucket(Date.parse("2026-10-24T14:00:00Z")), "sat-8");
  assert.equal(bucket(Date.parse("2026-10-25T14:00:00Z")), "sun-8");
});

test("flow: the signs' pace shares the pace with the fleet's", () => {
  // Fleet as usual, signs crawling: half the pace term.
  assert.ok(Math.abs(flowOf(9, 9, 0, 0, -1) - (0.65 * -0.5 + 0.35 * 0.25)) < 1e-9);
  // No fleet usual yet: the signs alone carry the pace.
  assert.ok(Math.abs(flowOf(9, null, 0, 0, 1) - (0.65 * 1 + 0.35 * 0.25)) < 1e-9);
  // Neither: as before.
  assert.equal(flowOf(9, null, 0, 0, null), flowOf(9, null, 0));
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

test("an hour's busyness: buses out against the usual for the hour", () => {
  const h0 = Date.parse("2026-11-03T15:00:00Z"); // Tuesdays, 8 AM
  const speeds = Array.from({ length: 40 }, () => 8);
  const flow = new Flow(null);
  const busy: (number | null)[] = [];
  for (let week = 0; week < 4; week++) {
    const h = h0 + week * 7 * 24 * HOUR;
    for (let s = 0; s < 240; s++) flow.sample(speeds, 45, h + s * 15_000, 0, undefined, week < 3 ? 300 : 240);
    busy.push(flow.sample(speeds, 45, h + HOUR)?.busy ?? null);
    flow.sample([], 0, h + 5 * HOUR);
  }
  // Unknown until the hour has been seen three times; then a holiday's
  // fewer buses read as quieter than usual.
  assert.deepEqual(busy, [null, null, null, 0.8]);
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

test("the grid: demand against its day-ahead forecast, and the peak ahead", () => {
  const latest = Date.parse("2026-10-28T19:00:00Z");
  const period = (ms: number) => new Date(ms).toISOString().slice(0, 13);
  const rows: { period: string; value: string; type?: string }[] = [{ period: period(latest), value: "6226", type: "D" }];
  for (let d = 1; d <= 7; d++) rows.push({ period: period(latest - d * 24 * HOUR), value: "6164", type: "D" });
  for (let h = -2; h <= 12; h++) rows.push({ period: period(latest + h * HOUR), value: String(5988 + (h === 7 ? 300 : h * 10)), type: "DF" });
  const g = gridFrom(rows)!;
  assert.equal(g.mw, 6226);
  assert.equal(g.hour, latest);
  assert.deepEqual(g.forecast, { mw: 5988, ratio: 1.04 });
  assert.deepEqual(g.peak, { hour: latest + 7 * HOUR, mw: 6288 });
  const noForecast = gridFrom(rows.filter((r) => r.type === "D"))!;
  assert.equal(noForecast.forecast, null);
  assert.equal(noForecast.peak, null);
});

test("the grid's mix: the latest hour with its sources, and the day's shares", () => {
  const rows: { period: string; fueltype: string; value: string }[] = [];
  const t = Date.parse("2026-10-28T05:00:00Z");
  const period = (ms: number) => new Date(ms).toISOString().slice(0, 13);
  for (let h = 0; h < 30; h++) {
    const at = period(t - h * HOUR);
    rows.push({ period: at, fueltype: "COL", value: "3000" }, { period: at, fueltype: "NG", value: "1000" }, { period: at, fueltype: "WND", value: "500" }, { period: at, fueltype: "SUN", value: h % 2 ? "500" : "-1" }, { period: at, fueltype: "OTH", value: "100" });
  }
  // A later hour reported with one source only isn't the latest.
  rows.push({ period: period(t + HOUR), fueltype: "COL", value: "3100" });
  const m = mixFrom(rows)!;
  assert.equal(m.hour, t);
  assert.deepEqual(m.mw, { coal: 3000, gas: 1000, wind: 500, solar: -1, other: 100 });
  // 24 hours: coal 72,000, gas 24,000, wind 12,000, solar 12 × 500, other 2,400.
  assert.equal(m.dayMwh, 72_000 + 24_000 + 12_000 + 6_000 + 2_400);
  assert.equal(m.share.coal, Math.round((72_000 / m.dayMwh) * 1000) / 1000);
  assert.equal(m.share.solar, Math.round((6_000 / m.dayMwh) * 1000) / 1000);
  assert.equal(mixFrom([]), null);
});
