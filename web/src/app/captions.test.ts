import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { PLACES, featureCaption, harmonyCaption, vantageCaption, type ValleyNow } from "./captions.ts";
import type { BarEvent, Heard } from "../engine/host.ts";
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
    plane: (ms) => (ms === 5 ? [5, 40.8, -111.9, 0, 3, 6300, 1, "Delta 1784"] : undefined),
    serviceAlert: (ms) =>
      ms === 7 ? [7, 0, 0, "126", "Pioneer Road Closure"] : ms === 8 ? [8, 1, 1, "Blue Line", "Single-tracking at Gallivan Plaza"] : undefined,
    grid: { mw: 6120, usual: 5885, energy: 1.04, observed: 0, receipt: "live" },
    road: (ms) => (ms === 11 ? [11, 0, 0, 40.76, -111.9, "I-15", "Crash on I-15 NB at 600 S"] : undefined),
  };
  const key = { c: 0, r: 1 };
  const card = (k: number, extra: Partial<Parameters<typeof featureCaption>[0]> = {}) =>
    featureCaption({ t: "feat", at: 0, k, route: 0, stop: 0, ev: 0, late: 0, obs: 0, v: 0, ...extra }, schedule, valley, key)?.text;

  test("trains, bikes and the ground", () => {
    expect(card(0, { obs: 1, late: 180 })).toBe("Blue Line left Gallivan Plaza, 3 min late");
    expect(card(0, { obs: 1, late: 20 })).toBe("Blue Line left Gallivan Plaza on time");
    expect(card(3, { v: -1 })).toBe("A GREENbike checked out at 200 S & Main, the upper octave");
    expect(card(7)).toBe("The city's rumble under Brigham Young Park: 41% of a busy day there");
  });

  test("the air, the river, the buses, lateness and alerts", () => {
    expect(card(12)).toBe("Inversion: 6.2 °C warmer aloft, PM2.5 38, a lid on the reverb");
    expect(card(13)).toBe("Jordan River 160 cfs, 82nd percentile: running high, so the bass walks");
    expect(card(14, { v: 171.6 })).toBe("203 buses out, making 172 stops a minute: the hats and shakers");
    expect(card(15, { v: 150 })).toBe("Trains running 3 min late on average: the drums lay back 25 ms");
    expect(card(16, { v: 0.8 })).toBe("Winter Storm Warning for the valley: tension, and fills in the drums");
  });

  test("planes, UTA's alerts, a storm coming, the grid and FrontRunner due", () => {
    expect(card(17, { ev: 5, v: 6312 })).toBe("Delta 1784 taking off from SLC, climbing through 6,300 ft");
    expect(card(17, { ev: 9, route: 1, v: 7480 })).toBe("A plane coming in to land at SLC, down through 7,500 ft");
    expect(card(18, { ev: 7 })).toBe("UTA alert for route 126: Pioneer Road Closure");
    expect(card(18, { ev: 8 })).toBe("UTA alert on Blue Line: Single-tracking at Gallivan Plaza");
    expect(card(19, { v: 280 })).toBe("11 in of snow forecast at Alta in the next day: the harmony holds in suspense until it falls");
    expect(card(20, { v: 1.04 })).toBe("The grid's drawing 6,120 MW, 4% above usual for the hour, so the mix swells");
    expect(card(21, { v: 3 })).toBe("FrontRunner due at Salt Lake Central in 3 min: the phrase it pulls in on turns for home");
  });

  test("the roads, with UDOT's key", () => {
    expect(card(22, { ev: 11 })).toBe("Trouble on I-15: Crash on I-15 NB at 600 S");
    expect(card(22, { ev: 11, route: 1 })).toBe("Cleared on I-15, and the harmony comes home");
    expect(card(22, { route: 2, stop: 1 })).toBe("Avalanche control up Little Cottonwood: a boom in its echo");
    expect(card(23, { v: 3 })).toBe("Traction law up Little and Big Cottonwood: a low brass pedal from the canyon");
    expect(card(24, { v: 41 })).toBe("41 snowplows out in the valley while it snows: brushes in the drums");
  });

  test("both rivers", () => {
    const rivers = { ...valley, river: { cfs: 160, position: 0.82, gauges: [{ name: "Jordan River", cfs: 160 }, { name: "Little Cottonwood Creek", cfs: 73.9 }], observed: 0, receipt: "live" as const } };
    const text = featureCaption({ t: "feat", at: 0, k: 13, route: 0, stop: 0, ev: 0, late: 0, obs: 0, v: 0 }, schedule, rivers, key)?.text;
    expect(text).toBe("Jordan River 160 cfs and Little Cottonwood Creek 74 cfs, 82nd percentile together: running high, so the bass walks");
  });
});

describe("the boundary card says why the tempo moved", () => {
  const bar = (tempo: number): Heard<BarEvent> =>
    ({ t: "bar", at: 0, f: 0, chain: 0, sec: 3, kind: 1, bar: 0, bars: 48, bpm: 92.4, start: 0, c: 0, r: 1, pc: 1, pr: 1, nc: 0, nr: 1, why: 2, home: -1, tempo, chord: "C", act: 0.5, bright: 0.5, tension: 0, haze: 0, inv: 0, day: 0 }) as Heard<BarEvent>;
  test("held back in traffic, up when it's clear, nothing when it's ordinary", () => {
    expect(harmonyCaption(bar(10)).text).toMatch(/; the buses and trains are crawling, so the tempo's held back at 92$/);
    expect(harmonyCaption(bar(9)).text).toMatch(/; the buses and trains are moving quickly, so the tempo's up at 92$/);
    expect(harmonyCaption(bar(-1)).text).not.toMatch(/tempo/);
  });
});
