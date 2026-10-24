import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Feed } from "./gtfsrt.ts";
import { Transit } from "./transit.ts";

const T0 = Date.parse("2026-10-23T06:00:00Z");
const at = (s: number) => T0 + s * 1000;

/** A schedule with two trips: T1 (FrontRunner, tracked by the feed,
 * through Salt Lake Central at stop 12) and T2 (TRAX, never tracked). */
function schedule(): string {
  const dir = mkdtempSync(join(tmpdir(), "wasatch-transit-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ days: { "2026-10-23": "k" }, t0: { "2026-10-23": T0 } }));
  const stop = (i: number) => ({ id: `${i}`, name: i === 12 ? "Salt Lake Central Station" : `Stop ${i}`, lat: 40.7, lon: -111.9 });
  writeFileSync(
    join(dir, "network.json"),
    JSON.stringify({
      routes: [
        { id: "a", short: "701", name: "Blue Line", type: 0, kind: "trax", color: "", text: "" },
        { id: "b", short: "750", name: "FrontRunner", type: 2, kind: "frontrunner", color: "", text: "" },
      ],
      stops: Array.from({ length: 22 }, (_, i) => stop(i)),
      shapes: [],
      headsigns: [],
    }),
  );
  writeFileSync(
    join(dir, "day-k.json"),
    JSON.stringify({
      rail: [
        { r: 1, d: 0, s: [10, 11, 12, 13], t: [36_000, 36_120, 36_240, 36_360] },
        { r: 0, d: 1, s: [20, 21], t: [36_100, 36_200] },
      ],
    }),
  );
  writeFileSync(join(dir, "rt-k.json"), JSON.stringify({ ids: ["T1", "T2"], seqs: [[1, 2, 3, 4], [5, 6]] }));
  return dir;
}

function feed(s: number, stops: [number, number][]): Feed {
  return {
    timestamp: T0 / 1000 + s,
    vehicles: [],
    alerts: [],
    trips: [{ tripId: "T1", routeId: "", vehicleId: "", timestamp: 0, stops: stops.map(([seq, pred]) => ({ seq, stopId: "", arrival: 0, departure: T0 / 1000 + pred, skipped: false })) }],
  };
}

test("departures settle when their stop drops out, at the right time", async () => {
  const t = new Transit(schedule());
  await t.load(at(36_000));
  // Listening starts mid-trip: stop 1 already passed, nothing to say about it.
  t.ingest(feed(36_030, [[2, 36_150], [3, 36_270], [4, 36_390]]));
  assert.deepEqual(t.drain(), []);
  // Stop 2 drops out: it left at its last, current prediction, 30 s late.
  t.ingest(feed(36_160, [[3, 36_270], [4, 36_390]]));
  assert.deepEqual(t.drain(), [[at(36_150), at(36_120), 1, 0, 11, 1]]);
  // Stop 3 is still listed after its predicted time while the train is held:
  // nothing settles.
  t.ingest(feed(36_300, [[3, 36_290], [4, 36_420]]));
  assert.deepEqual(t.drain(), []);
});

test("a passed stop that lingers in the feed settles by the trip's delay, not when it vanishes", async () => {
  const t = new Transit(schedule());
  await t.load(at(36_000));
  t.ingest(feed(36_200, [[3, 36_270], [4, 36_390]]));
  // Long after: stop 3's prediction went stale while stop 4's is current
  // and says the trip runs 60 s late. The train is past stop 3, which left
  // at its schedule plus that delay.
  t.ingest(feed(36_400, [[3, 36_270], [4, 36_420]]));
  assert.deepEqual(t.drain(), [[at(36_300), at(36_240), 1, 0, 12, 1]]);
  // A stale stop that simply vanishes, with nothing current to go on, is
  // skipped rather than guessed.
  t.ingest(feed(36_500, [[4, 36_420]]));
  t.ingest(feed(36_520, []));
  assert.deepEqual(t.drain(), []);
});

test("a stop that drops out while far ahead was cancelled, not departed", async () => {
  const t = new Transit(schedule());
  await t.load(at(36_000));
  t.ingest(feed(36_030, [[2, 36_150], [3, 36_900]]));
  t.ingest(feed(36_040, [[2, 36_150]]));
  assert.deepEqual(t.drain(), []);
});

test("the next FrontRunner due at Central: its freshest prediction still ahead", async () => {
  const t = new Transit(schedule());
  await t.load(at(36_000));
  assert.equal(t.due(at(36_000)), 0);
  t.ingest(feed(36_030, [[2, 36_150], [3, 36_270], [4, 36_390]]));
  assert.equal(t.due(at(36_030)), at(36_270));
  // Later predictions revise it; once it's left, nothing is due.
  t.ingest(feed(36_200, [[3, 36_300], [4, 36_420]]));
  assert.equal(t.due(at(36_200)), at(36_300));
  t.ingest(feed(36_320, [[4, 36_420]]));
  assert.equal(t.due(at(36_320)), 0);
});

test("trains realtime doesn't track keep their schedule", async () => {
  const t = new Transit(schedule());
  await t.load(at(36_000));
  t.ingest(feed(36_030, [[2, 36_150]]));
  // T1 is tracked, so only T2's departures come from the schedule.
  assert.deepEqual(t.untracked(at(36_000), at(36_300)), [
    [at(36_100), at(36_100), 0, 1, 20, 0],
    [at(36_200), at(36_200), 0, 1, 21, 0],
  ]);
});

test("the fleet: trains where they are, one per trip, and buses counted", async () => {
  const t = new Transit(schedule());
  await t.load(at(36_000));
  const now = T0 / 1000 + 36_150;
  const v = (tripId: string, vehicleId: string, lat: number, age: number) => ({ tripId, routeId: "", vehicleId, lat, lon: -111.9, bearing: 0, speed: 10, timestamp: now - age });
  const fleet = t.fleet({
    timestamp: now,
    trips: [],
    alerts: [],
    vehicles: [
      // T1 runs as a two-car consist; the fresher car places it.
      v("T1", "car-a", 40.71, 40),
      v("T1", "car-b", 40.7123456, 5),
      v("T2", "car-c", 40.65, 10),
      // Two buses, one with two reports, and one gone quiet.
      v("B1", "bus-1", 40.6, 3),
      v("B1", "bus-1b", 40.6, 30),
      v("B2", "bus-2", 40.62, 8),
      v("B3", "bus-3", 40.63, 600),
    ],
  });
  assert.equal(fleet.t, now * 1000);
  assert.deepEqual(fleet.counts, { trains: 2, buses: 2 });
  assert.deepEqual(fleet.trains, [
    [0, 1, 40.65, -111.9, 10],
    [1, 0, 40.71235, -111.9, 5],
  ]);
  // Every bus out, once, where it is.
  assert.deepEqual(fleet.buses, [
    [40.6, -111.9],
    [40.62, -111.9],
  ]);
});
