import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Feed } from "./gtfsrt.ts";
import { Transit } from "./transit.ts";

const T0 = Date.parse("2026-10-23T06:00:00Z");
const at = (s: number) => T0 + s * 1000;

/** A schedule with two trips: T1 (tracked by the feed) and T2 (never). */
function schedule(): string {
  const dir = mkdtempSync(join(tmpdir(), "wasatch-transit-"));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ days: { "2026-10-23": "k" }, t0: { "2026-10-23": T0 } }));
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
