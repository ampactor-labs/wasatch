import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { PLACES, featureCaption, vantageCaption, type ValleyNow } from "./captions.ts";
import type { Schedule } from "./schedule.ts";

describe("where you listen from", () => {
  const at = { at: 0, f: 0, t: "vantage" as const, face: 90 };

  test("names what's near and far there, most noticeable first", () => {
    const downtown = vantageCaption({ ...at, v: 1, lat: 40.76, lon: -111.89, near: [0.86, 1, 0.43, 1, 0.48, 0.27, 0.6], rail: 1 });
    expect(downtown.text).toBe("The Gallivan Center, downtown: the trains and the city's groove up close; the lake and the snow far off");
    expect(downtown.receipt).toBe("here");
    const lake = vantageCaption({ ...at, v: 3, lat: 40.77, lon: -112.17, near: [0.39, 0.56, 1, 0.47, 0.26, 0.25, 1.3], rail: 0.2 });
    expect(lake.text).toBe("Saltair, on the lake: the lake up close; the trains and the mountains far off");
  });

  test("the map has no one place", () => {
    const map = vantageCaption({ ...at, v: 0, lat: null, lon: null, face: null, near: [1, 1, 1, 1, 1, 1, 1], rail: 1 });
    expect(map.text).toMatch(/as a map/);
  });

  test("the places match the engine's", () => {
    const rust = readFileSync(new URL("../../../engine/src/audio/space.rs", import.meta.url), "utf8");
    for (const [code, name] of [
      [1, "Downtown"],
      [2, "Canyons"],
      [3, "Lake"],
    ] as const) {
      const m = new RegExp(`Vantage::${name} => Some\\(\\(([-\\d.]+), ([-\\d.]+), ([\\d.]+)\\)\\)`).exec(rust);
      expect(m, name).not.toBeNull();
      expect([Number(m![1]), Number(m![2]), Number(m![3])]).toEqual([PLACES[code]!.lat, PLACES[code]!.lon, PLACES[code]!.face]);
    }
  });
});

describe("the feed reads like sentences and covers the whole valley", () => {
  const schedule = { routeName: () => "Blue Line", stopName: () => "Gallivan Plaza", network: { routes: [] } } as unknown as Schedule;
  const valley: ValleyNow = {
    quakes: [],
    bikeStation: () => "200 S & Main",
    air: { pm25: 38, inversionC: 6.2, observed: 0, receipt: "live" },
    river: { cfs: 160, position: 0.82, observed: 0, receipt: "live" },
    alerts: { names: ["Winter Storm Warning"], observed: 0, receipt: "live" },
    busesOut: { count: 203, observed: 0 },
    ground: { station: "Brigham Young Park", level: 0.41, observed: 0, receipt: "live" },
  };
  const key = { c: 0, r: 1 };
  const card = (k: number, extra: Partial<Parameters<typeof featureCaption>[0]> = {}) =>
    featureCaption({ t: "feat", at: 0, k, route: 0, stop: 0, ev: 0, late: 0, obs: 0, v: 0, ...extra }, schedule, valley, key)?.text;

  test("trains, bikes and the ground", () => {
    expect(card(0, { obs: 1, late: 180 })).toBe("Blue Line left Gallivan Plaza, 3 min late");
    expect(card(0, { obs: 1, late: 20 })).toBe("Blue Line left Gallivan Plaza on time");
    expect(card(3, { v: -1 })).toBe("A GREENbike checked out at 200 S & Main");
    expect(card(7)).toBe("The city's rumble under Brigham Young Park: 41% of a busy day there");
  });

  test("the air, the river, the buses, lateness and alerts", () => {
    expect(card(12)).toBe("Inversion: 6.2 °C warmer aloft, PM2.5 38, a lid on the reverb");
    expect(card(13)).toBe("Jordan River 160 cfs, 82nd percentile: running high, so the bass walks");
    expect(card(14, { v: 171.6 })).toBe("203 buses out, making 172 stops a minute: the hats and shakers");
    expect(card(15, { v: 150 })).toBe("Trains running 3 min late on average: the drums lay back 25 ms");
    expect(card(16, { v: 0.8 })).toBe("Winter Storm Warning for the valley: tension, and fills in the drums");
  });
});
