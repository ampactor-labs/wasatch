import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { PLACES, vantageCaption } from "./captions.ts";

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
