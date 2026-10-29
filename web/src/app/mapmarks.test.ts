import { describe, expect, test } from "vitest";
import { mapProjection } from "../art/index.ts";
import type { NetworkFile } from "../engine/protocol.ts";
import { PLACES } from "./captions.ts";
import { frameFor, soundColor, soundName } from "./mapmarks.ts";

const network = {
  stops: [
    { id: "a", name: "Courthouse Station", lat: 40.7596, lon: -111.8915 },
    { id: "b", name: "Murray Central", lat: 40.6595, lon: -111.8925 },
  ],
} as unknown as NetworkFile;

describe("what a sound on the map says", () => {
  test("a bell names its note, its line and the station it rang at", () => {
    expect(soundName({ i: 1, m: 76, lat: 40.7597, lon: -111.8914, v: 0 }, network, (s) => s.replace(/ Station$/, ""))).toBe("E · Blue Line · Courthouse");
    expect(soundName({ i: 1, m: 79, lat: 40.66, lon: -111.89, v: 1 }, network)).toBe("G · Red Line · Murray Central");
    // An older engine sends no line.
    expect(soundName({ i: 1, m: 79, lat: 40.66, lon: -111.89 }, null)).toBe("G · TRAX");
  });

  test("planes, horns, bikes and the canyons' drums", () => {
    expect(soundName({ i: 15, m: 58, lat: 40.8, lon: -112, v: 8 }, null)).toBe("B♭ · a plane landing");
    expect(soundName({ i: 15, m: 58, lat: 40.8, lon: -112, v: 0 }, null)).toBe("B♭ · a plane taking off");
    expect(soundName({ i: 2, m: 61, lat: 40.76, lon: -111.91, v: 0 }, null)).toBe("C♯ · FrontRunner's horn");
    expect(soundName({ i: 3, m: 72, lat: 40.76, lon: -111.89 }, null)).toBe("C · a GREENbike");
    expect(soundName({ i: 11, m: 45, lat: 40.575, lon: -111.75, v: 1 }, null)).toBe("Drums · a ski bus up Little Cottonwood");
    expect(soundName({ i: 11, m: 45, lat: 40.575, lon: -111.75, v: 4 }, null)).toBe("Drums · avalanche control");
    expect(soundColor(7)).toBe(soundColor(11));
  });
});

describe("what the map frames", () => {
  const inside = (b: { n: number; s: number; w: number; e: number }, lat: number, lon: number) => lat < b.n && lat > b.s && lon > b.w && lon < b.e;

  test("everywhere, the valley floor, from Bountiful to Draper and Saltair to Alta", () => {
    for (const [w, h] of [[760, 540], [370, 330], [390, 700]] as const) {
      const b = frameFor(null, w, h);
      for (const [lat, lon] of [[40.89, -111.88], [40.52, -111.86], [40.765, -112.17], [40.588, -111.638]] as const) {
        expect(inside(b, lat, lon), `${w}×${h} ${lat},${lon}`).toBe(true);
      }
    }
  });

  test("from a place, its near ring whole and the frame leaning toward the valley", () => {
    for (const code of [1, 2, 3]) {
      const place = PLACES[code]!;
      const b = frameFor(place, 760, 540);
      const km = (deg: number) => deg * 110.57;
      expect(km(b.n - place.lat)).toBeGreaterThan(5);
      expect(km(place.lat - b.s)).toBeGreaterThan(5);
      expect(inside(b, place.lat, place.lon)).toBe(true);
      // Closer than everywhere.
      expect(b.n - b.s).toBeLessThan(frameFor(null, 760, 540).n - frameFor(null, 760, 540).s);
    }
  });

  test("on a phone, the valley floor clears the dial over the map's corner", () => {
    const [w, h, inset] = [370, 330, 120];
    const b = frameFor(null, w, h, inset);
    const p = mapProjection(b, w, h);
    // Saltair and the airport sit right of the dial.
    for (const [lat, lon] of [[40.765, -112.17], [40.788, -111.978]] as const) {
      const [x] = p.project(lat, lon);
      expect(x).toBeGreaterThan(inset);
    }
    const [ex] = p.project(40.588, -111.638);
    expect(ex).toBeLessThan(w);
  });
});
