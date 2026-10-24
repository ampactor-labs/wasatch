import { describe, expect, test } from "vitest";
import { Schedule, tidyStation, type Day, type Manifest } from "./schedule.ts";
import type { NetworkFile } from "../engine/protocol.ts";

// A two-station line, due south, with one train a day.
const network: NetworkFile = {
  routes: [{ id: "1", short: "701", name: "Blue Line", type: 0, kind: "trax", color: "#004A97", text: "#FFFFFF" }],
  stops: [
    { id: "a", name: "North Station", lat: 40.8, lon: -111.9 },
    { id: "b", name: "South Station", lat: 40.7, lon: -111.9 },
  ],
  shapes: [{ r: 0, d: 0, pts: [[40.8, -111.9], [40.75, -111.9], [40.7, -111.9]] }],
  headsigns: ["To South"],
};
const t0 = Date.parse("2026-10-23T06:00:00Z");
const manifest: Manifest = { version: 1, generated: "", timezone: "America/Denver", days: { "2026-10-23": "k" }, t0: { "2026-10-23": t0 } };
const day: Day = {
  key: "k",
  rail: [{ r: 0, d: 0, h: 0, s: [0, 1], t: [36_000, 36_600] }],
  ski: [],
  bus: { perMinute: new Array(1800).fill(5), west: new Array(1800).fill(2), east: new Array(1800).fill(3) },
  active: new Array(1800).fill(0).map((_, m) => (m >= 600 && m <= 610 ? 7 : 0)),
  counts: { railStopEvents: 2, busStopEvents: 9000, skiStopEvents: 0, trips: 1, railTrips: 1 },
};

async function loaded(): Promise<Schedule> {
  const s = new Schedule();
  const files: Record<string, unknown> = { "schedule/manifest.json": manifest, "schedule/network.json": network, "schedule/day-k.json": day };
  globalThis.fetch = (async (url: string) => ({ json: async () => files[url] })) as unknown as typeof fetch;
  await s.load("");
  await s.day("2026-10-23");
  return s;
}

describe("the schedule", () => {
  test("a train dwells, then runs along its track", async () => {
    const s = await loaded();
    expect(s.trainsAt(t0 + 35_000_000)).toEqual([]);
    const dwelling = s.trainsAt(t0 + 36_005_000);
    expect(dwelling).toHaveLength(1);
    expect(dwelling[0]!.dwelling).toBe(true);
    expect(dwelling[0]!.lat).toBeCloseTo(40.8, 4);
    // Halfway through the running time (after the 20 s dwell) it's halfway down.
    const mid = s.trainsAt(t0 + (36_000 + 20 + 290) * 1000)[0]!;
    expect(mid.lat).toBeCloseTo(40.75, 3);
    expect(mid.lon).toBeCloseTo(-111.9, 6);
    expect(s.trainsAt(t0 + 36_601_000)).toEqual([]);
  });

  test("vehicles and bus rate by the minute", async () => {
    const s = await loaded();
    expect(s.vehiclesAt(t0 + 605 * 60_000)).toBe(7);
    expect(s.vehiclesAt(t0 + 700 * 60_000)).toBe(0);
    expect(s.busRate(t0 + 100 * 60_000)).toBe(5);
  });

  test("dates around a time and the span", async () => {
    const s = await loaded();
    expect(s.datesAround(t0 + 12 * 3_600_000)).toEqual(["2026-10-23"]);
    expect(s.span()[0]).toBe(t0);
  });

  test("station names lose their suffix", () => {
    expect(tidyStation("Salt Lake Central Station")).toBe("Salt Lake Central");
    expect(tidyStation("Ballpark")).toBe("Ballpark");
  });
});
