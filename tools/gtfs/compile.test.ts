// Checks the compiled schedule against facts measured on UTA's feed on
// Oct 23, 2026, with room for normal feed churn. Run the compiler first:
//
//   node tools/gtfs/compile.ts && node --test tools/gtfs/compile.test.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { weekday } from "./util.ts";

const OUT = fileURLToPath(new URL("../../web/public/schedule/", import.meta.url));

interface Manifest {
  version: number;
  timezone: string;
  source: { sha256: string; bytes: number; feedStart: string; feedEnd: string };
  days: Record<string, string>;
  t0: Record<string, number>;
}
interface RailTrip {
  r: number;
  d: number;
  h: number;
  s: number[];
  t: number[];
}
interface Day {
  version: number;
  key: string;
  serviceIds: string[];
  rail: RailTrip[];
  ski: { r: number; t: number; h: number }[];
  bus: { perMinute: number[]; west: number[]; east: number[] };
  active: number[];
  counts: { railStopEvents: number; busStopEvents: number; skiStopEvents: number; trips: number };
}
interface Network {
  routes: { id: string; short: string; name: string; kind: string; color: string }[];
  stops: { id: string; ids: string[]; name: string; lat: number; lon: number }[];
  shapes: { r: number; d: number; pts: [number, number][] }[];
  headsigns: string[];
}

const read = <T>(file: string): T => JSON.parse(readFileSync(join(OUT, file), "utf8")) as T;

if (!existsSync(join(OUT, "manifest.json"))) {
  throw new Error(`no schedule in ${OUT}; run node tools/gtfs/compile.ts first`);
}
const manifest = read<Manifest>("manifest.json");
const network = read<Network>("network.json");
const dayFor = (date: string) => read<Day>(`day-${manifest.days[date]}.json`);
const weekdayDates = Object.keys(manifest.days).filter((d) => weekday(d) >= 1 && weekday(d) <= 4);

test("the manifest covers yesterday through nine days ahead", () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.timezone, "America/Denver");
  assert.ok(Object.keys(manifest.days).length >= 10);
  assert.match(manifest.source.sha256, /^[0-9a-f]{64}$/);
  for (const [date, key] of Object.entries(manifest.days)) {
    assert.ok(existsSync(join(OUT, `day-${key}.json`)), `day file for ${date}`);
    assert.equal(typeof manifest.t0[date], "number", `t0 for ${date}`);
  }
});

test("service days count from local noon minus 12 hours", () => {
  for (const [date, t0] of Object.entries(manifest.t0)) {
    const noon = new Date(t0 + 12 * 3_600_000).toLocaleString("en-US", {
      timeZone: "America/Denver",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    });
    assert.equal(noon, "12:00", `${date}: t0 + 12 h is local noon`);
  }
});

test("a weekday has about 243,304 stop events", () => {
  assert.ok(weekdayDates.length > 0, "a Monday–Thursday in range");
  for (const date of weekdayDates) {
    const c = dayFor(date).counts;
    const total = c.railStopEvents + c.busStopEvents + c.skiStopEvents;
    assert.ok(Math.abs(total - 243_304) / 243_304 < 0.15, `${date}: ${total} stop events`);
  }
});

test("rail runs 450–900 stop events an hour from 06:00 to 22:00", () => {
  const day = dayFor(weekdayDates[0]!);
  const perHour = new Array<number>(30).fill(0);
  for (const trip of day.rail) for (const t of trip.t) perHour[Math.floor(t / 3600)]!++;
  const hours = perHour.slice(6, 22);
  const inRange = hours.filter((n) => n >= 450 && n <= 900).length;
  assert.ok(inRange >= Math.ceil(hours.length * 0.8), `per hour: ${hours.join(", ")}`);
});

test("buses run 150–300 stop events a minute through the day", () => {
  const day = dayFor(weekdayDates[0]!);
  const peak = day.bus.perMinute.slice(6 * 60, 18 * 60).sort((a, b) => a - b);
  const median = peak[Math.floor(peak.length / 2)]!;
  assert.ok(median >= 150 && median <= 300, `median ${median}`);
  assert.equal(day.bus.perMinute.length, 1800);
  for (let m = 0; m < 1800; m++) {
    assert.equal(day.bus.west[m]! + day.bus.east[m]!, day.bus.perMinute[m]!, `minute ${m} splits west/east`);
  }
});

test("a few hundred vehicles are in service through the day, none at 3 AM", () => {
  const day = dayFor(weekdayDates[0]!);
  assert.equal(day.active.length, 1800);
  assert.equal(day.active[3 * 60], 0);
  for (const hour of [8, 12, 17]) {
    const n = day.active[hour * 60]!;
    assert.ok(n >= 150 && n <= 500, `${hour}:00 has ${n}`);
  }
  // Every train covering a minute is counted in it.
  const m = 17 * 60;
  const trains = day.rail.filter((t) => t.t[0]! <= m * 60 + 59 && t.t.at(-1)! >= m * 60).length;
  assert.ok(day.active[m]! >= trains, `${day.active[m]} vehicles, ${trains} trains`);
});

test("every line exists, with a shape", () => {
  const lines: [string, RegExp][] = [
    ["trax", /red/i],
    ["trax", /blue/i],
    ["trax", /green/i],
    ["sline", /s-?line/i],
    ["frontrunner", /frontrunner/i],
  ];
  for (const [kind, re] of lines) {
    const r = network.routes.findIndex((x) => x.kind === kind && re.test(x.name));
    assert.ok(r >= 0, `${re} as ${kind}`);
    assert.match(network.routes[r]!.color, /^#[0-9A-F]{6}$/);
    const shapes = network.shapes.filter((s) => s.r === r);
    assert.ok(shapes.length > 0 && shapes.every((s) => s.pts.length >= 2), `${re} has a shape`);
  }
});

test("FrontRunner runs through Salt Lake Central", () => {
  const fr = network.routes.findIndex((x) => x.kind === "frontrunner");
  const slc = network.stops.findIndex((s) => /salt lake central/i.test(s.name));
  assert.ok(slc >= 0, "a Salt Lake Central stop");
  const day = dayFor(weekdayDates[0]!);
  const trips = day.rail.filter((t) => t.r === fr);
  assert.ok(trips.length > 0, "FrontRunner trips on a weekday");
  assert.ok(trips.filter((t) => t.s.includes(slc)).length >= trips.length * 0.9);
});

test("trips are well formed and their times never go backwards", () => {
  for (const key of new Set(Object.values(manifest.days))) {
    const day = read<Day>(`day-${key}.json`);
    for (const trip of day.rail) {
      assert.equal(trip.s.length, trip.t.length);
      assert.ok(trip.s.every((s) => s >= 0 && s < network.stops.length));
      assert.ok(trip.r >= 0 && trip.r < network.routes.length);
      assert.ok(trip.h >= 0 && trip.h < network.headsigns.length);
      for (let i = 1; i < trip.t.length; i++) assert.ok(trip.t[i]! >= trip.t[i - 1]!, `trip at ${trip.t[0]}`);
    }
    for (const ski of day.ski) assert.equal(network.routes[ski.r]!.kind, "ski");
  }
});

test("day files stay compact", () => {
  for (const f of readdirSync(OUT)) {
    if (!f.startsWith("day-")) continue;
    const kb = statSync(join(OUT, f)).size / 1024;
    assert.ok(kb < 500, `${f} is ${kb.toFixed(1)} KB`);
  }
});
