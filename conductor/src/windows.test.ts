import assert from "node:assert/strict";
import { test } from "node:test";
import { SEAL_MS, WINDOW_MS, Windows, type WindowBody } from "./windows.ts";

const W = 1_792_819_050_000; // a window start

test("a window seals a minute after it opens, and then never changes", () => {
  const w = new Windows();
  w.addRail([W + 5_000, W + 1_000, 1, 0, 11, 1], W + 20_000);
  w.addBike([W + 12_000, 40.76, -111.89, -1, 3], W + 20_000);
  assert.equal(w.seal(W + SEAL_MS - 1), 0);
  assert.equal(w.body(W), null);
  assert.equal(w.seal(W + SEAL_MS), 1);
  const body = JSON.parse(w.body(W)!) as WindowBody;
  assert.equal(body.start, W);
  assert.equal(body.end, W + WINDOW_MS);
  assert.deepEqual(body.rail, [[W + 5_000, W + 1_000, 1, 0, 11, 1]]);
  assert.equal(body.bikes.length, 1);
  // Too late for a sealed window: a departure is dropped, a bike moves on.
  w.addRail([W + 6_000, W + 2_000, 1, 0, 12, 1], W + SEAL_MS + 5_000);
  w.addBike([W + 7_000, 40.76, -111.89, 1, 3], W + SEAL_MS + 5_000);
  w.seal(W + 3 * SEAL_MS);
  assert.deepEqual(JSON.parse(w.body(W)!).rail, body.rail);
  const next = JSON.parse(w.body(W + WINDOW_MS)!) as WindowBody;
  assert.equal(next.rail.length, 0);
  assert.equal(next.bikes[0]![0], W + WINDOW_MS);
});

test("the ground is packed on the 100 ms grid, gaps as silence", () => {
  const w = new Windows();
  const meta = { lat: 40.77, lon: -111.89, level: 0.4 };
  for (const t of [W, W + 100, W + 300]) w.addGround(2, meta, t, 0.5, -0.25, W + 1_000);
  w.seal(W + SEAL_MS);
  const g = (JSON.parse(w.body(W)!) as WindowBody).ground;
  assert.equal(g.length, 1);
  assert.equal(g[0]!.band, 2);
  assert.equal(g[0]!.t0, W);
  assert.deepEqual(g[0]!.iq, [0.5, -0.25, 0.5, -0.25, 0, 0, 0.5, -0.25]);
});

test("the seal hook gets the last word", () => {
  const w = new Windows();
  w.onSeal = (body) => body.rail.push([body.start + 1_000, body.start + 1_000, 0, 1, 20, 0]);
  w.addBike([W + 1_000, 40.7, -111.9, 1, 1], W + 2_000);
  w.seal(W + SEAL_MS);
  assert.deepEqual((JSON.parse(w.body(W)!) as WindowBody).rail, [[W + 1_000, W + 1_000, 0, 1, 20, 0]]);
});
