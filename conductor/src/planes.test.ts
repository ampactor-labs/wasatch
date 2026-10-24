import assert from "node:assert/strict";
import { test } from "node:test";
import { KSLC, Planes, airlineName, movement, rangeBearing, sizeOf, type Aircraft } from "./planes.ts";

/** An aircraft `nm` from the field along `bearing`, flying `track`. */
function at(nm: number, bearing: number, over: Partial<Aircraft>): Aircraft {
  const lat = KSLC.lat + (nm / 60) * Math.cos((bearing * Math.PI) / 180);
  const lon = KSLC.lon + ((nm / 60) * Math.sin((bearing * Math.PI) / 180)) / Math.cos((KSLC.lat * Math.PI) / 180);
  return { hex: "a1b2c3", lat, lon, gs: 220, seen_pos: 1, ...over };
}

test("airline flights are named; private aircraft aren't", () => {
  assert.equal(airlineName("DAL1784 "), "Delta 1784");
  assert.equal(airlineName("SKW3315"), "SkyWest 3315");
  assert.equal(airlineName("SWA0042"), "Southwest 42");
  assert.equal(airlineName("N8397L"), null);
  assert.equal(airlineName("JUMP13"), null);
  assert.equal(airlineName(""), null);
  assert.equal(sizeOf("A5"), 5);
  assert.equal(sizeOf("A7"), 1, "a helicopter is light");
  assert.equal(sizeOf(undefined), 0);
});

test("ranges and bearings from the field", () => {
  const north = at(10, 0, {});
  const r = rangeBearing(KSLC.lat, KSLC.lon, north.lat!, north.lon!);
  assert.ok(Math.abs(r.nm - 10) < 0.05, `${r.nm}`);
  assert.ok(r.bearing < 0.5 || r.bearing > 359.5);
});

test("a departure climbs away from the field; an arrival comes down toward it", () => {
  assert.equal(movement(at(6, 0, { alt_baro: 7000, baro_rate: 2200, track: 350 })), 0);
  assert.equal(movement(at(12, 160, { alt_baro: 8000, baro_rate: -1100, track: 340 })), 1);
  // Overflying at cruise, climbing toward the field, or on the ground: nothing.
  assert.equal(movement(at(10, 90, { alt_baro: 35000, baro_rate: 0, track: 270 })), null);
  assert.equal(movement(at(15, 90, { alt_baro: 9000, baro_rate: 1500, track: 270 })), null);
  assert.equal(movement(at(0.5, 0, { alt_baro: "ground", gs: 12 })), null);
  // Descending but heading away: not landing here.
  assert.equal(movement(at(12, 160, { alt_baro: 8000, baro_rate: -800, track: 160 })), null);
});

test("movements go out one every 20 s, each plane once a leg, placed where it got to", () => {
  const p = new Planes();
  const t0 = 1_000_000_000_000;
  const dep = (hex: string) => at(6, 0, { hex, alt_baro: 7000, baro_rate: 2200, track: 0, gs: 240, flight: "DAL1784", category: "A3" });
  p.ingest([dep("a"), dep("b"), at(12, 160, { hex: "c", alt_baro: 8000, baro_rate: -1100, track: 340, flight: "N67FF", category: "A1" })], t0);
  assert.equal(p.stats.queued, 3);
  assert.equal(p.release(t0 + 30_000)?.[7], "Delta 1784");
  assert.equal(p.release(t0 + 40_000), null, "too soon");
  const second = p.release(t0 + 50_000)!;
  // 50 s at 240 kt north: 3.3 nm further, and higher.
  const r = rangeBearing(KSLC.lat, KSLC.lon, second[1], second[2]);
  assert.ok(Math.abs(r.nm - 9.3) < 0.2, `${r.nm}`);
  assert.ok(second[5] > 7000);
  const third = p.release(t0 + 70_000)!;
  assert.deepEqual([third[3], third[4], third[6], third[7]], [1, 1, 0, ""], "a private arrival, unnamed");
  // Heard again on the next look: the same leg, no second sound.
  p.ingest([dep("a")], t0 + 240_000);
  assert.equal(p.stats.queued, 0);
  // Left waiting four minutes, a movement is too old to place.
  p.ingest([dep("d")], t0 + 300_000);
  assert.equal(p.release(t0 + 300_000 + 5 * 60_000), null);
});
