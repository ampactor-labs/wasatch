import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SeenQuakes } from "./quakes.ts";

const MIN = 60_000;

test("a quake listed late still plays, once, and a restart doesn't replay it", () => {
  const path = join(mkdtempSync(join(tmpdir(), "wasatch-quakes-")), "quakes.json");
  const now = Date.parse("2026-10-29T20:00:00Z");
  const first = new SeenQuakes(path);
  // A first start learns the catalog and plays only what's due now.
  const fresh = first.fresh([{ id: "old", ms: now - 3 * 60 * MIN }, { id: "now", ms: now - 2 * MIN }], now);
  assert.deepEqual(fresh.map((q) => q.id), ["now"]);
  // A quake catalogued 40 minutes late plays when it appears.
  assert.deepEqual(first.fresh([{ id: "late", ms: now - 40 * MIN }], now).map((q) => q.id), ["late"]);
  assert.deepEqual(first.fresh([{ id: "late", ms: now - 40 * MIN }], now), [], "once");
  // Too late is too late.
  assert.deepEqual(first.fresh([{ id: "ancient", ms: now - 7 * 60 * MIN }], now), []);
  // A restart remembers.
  const again = new SeenQuakes(path);
  assert.deepEqual(again.fresh([{ id: "late", ms: now - 40 * MIN }, { id: "new", ms: now - 30 * MIN }], now + MIN).map((q) => q.id), ["new"]);
});
