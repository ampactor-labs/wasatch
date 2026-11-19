import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Flow } from "./flow.ts";
import { Signs } from "./udot.ts";
import { isException, KEEP, seed, Usuals } from "./usual.ts";

const HOUR = 3_600_000;

// UTA's Thanksgiving 2026: Thursday runs Sunday's service set, Friday
// Saturday's (calendar of service 303).
const DAYS: Record<string, string> = {
  "2026-11-16": "mon",
  "2026-11-17": "tth",
  "2026-11-18": "tth",
  "2026-11-19": "tth",
  "2026-11-20": "fri",
  "2026-11-21": "sat",
  "2026-11-22": "sun",
  "2026-11-23": "mon",
  "2026-11-24": "tth",
  "2026-11-25": "tth",
  "2026-11-26": "sun",
  "2026-11-27": "sat",
  "2026-11-28": "sat",
  "2026-11-29": "sun",
  "2026-11-30": "mon",
};

test("a holiday is a weekday on a weekend's schedule", () => {
  assert.equal(isException("2026-11-26", DAYS), true, "Thanksgiving runs Sunday's");
  assert.equal(isException("2026-11-27", DAYS), true, "the Friday after runs Saturday's");
  assert.equal(isException("2026-11-25", DAYS), false);
  assert.equal(isException("2026-11-20", DAYS), false, "a Friday's own set is no holiday");
  assert.equal(isException("2026-11-29", DAYS), false, "a Sunday never is");
  assert.equal(isException("2026-12-25", DAYS), false, "an unknown date isn't");
});

test("the usual is the median of the last few hours, and one odd hour barely moves it", () => {
  const u = new Usuals(null);
  u.learn("speed", "weekday-8", 8);
  u.learn("speed", "weekday-8", 8.2);
  assert.equal(u.get("speed", "weekday-8"), null, "not known until seen three times");
  u.learn("speed", "weekday-8", 7.9);
  assert.equal(u.get("speed", "weekday-8"), 8);
  u.learn("speed", "weekday-8", 2, false); // a crash on I-15
  assert.equal(u.get("speed", "weekday-8"), 8);
  for (let i = 0; i < 10; i++) u.learn("speed", "weekday-8", 9);
  assert.equal(u.seen("speed", "weekday-8"), KEEP, "only the last few are kept");
  assert.equal(u.get("speed", "weekday-8"), 9);
  u.learn("speed", "weekday-8", 1, true);
  assert.equal(u.get("speed", "weekday-8"), 9, "an exception day teaches nothing");
});

test("older running-average files keep what they knew", () => {
  assert.deepEqual(seed(8.5, 12), [8.5, 8.5, 8.5]);
  assert.deepEqual(seed(8.5, 1), [8.5]);
  assert.equal(seed(undefined, 3), null);
  const dir = mkdtempSync(join(tmpdir(), "wasatch-usual-"));
  const path = join(dir, "usual.json");
  writeFileSync(path, JSON.stringify({ "weekday-8": { speed: 8.9, n: 20, buses: 300, nb: 9 } }));
  const flow = new Flow(path);
  // The migrated usual is known at once: a day's first hour reads against it.
  const h = Date.parse("2026-11-17T15:00:00Z");
  const speeds = Array.from({ length: 40 }, () => 8.9);
  for (let s = 0; s < 240; s++) flow.sample(speeds, 120, h + s * 15_000, 0, undefined, 300);
  assert.equal(flow.sample(speeds, 120, h + HOUR)?.busy, 1);
  writeFileSync(path, JSON.stringify({ "I-15 NB|SLC": { "weekday-8": { min: 16, n: 4 } } }));
  assert.equal(new Signs(path).usualFor("I-15 NB|SLC", h), 16);
});

test("Thanksgiving sounds thin but doesn't max out the hats the week after", () => {
  const flow = new Flow(null);
  flow.days = DAYS;
  const speeds = Array.from({ length: 40 }, () => 8.5);
  // 8 AM MST is 15:00 UTC.
  const hourOn = (date: string) => Date.parse(`${date}T15:00:00Z`);
  const busyOn = (date: string, buses: number) => {
    const h = hourOn(date);
    for (let s = 0; s < 240; s++) flow.sample(speeds, 120, h + s * 15_000, 0, undefined, buses);
    const out = flow.sample(speeds, 120, h + HOUR);
    flow.sample([], 0, h + 5 * HOUR);
    return out?.busy ?? null;
  };
  for (const d of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24", "2026-11-25"]) busyOn(d, 300);
  assert.equal(busyOn("2026-11-26", 70), 0.23, "Thanksgiving's few buses read as a thin hour");
  assert.equal(busyOn("2026-11-27", 150), 0.5, "and so does the Friday after");
  assert.equal(busyOn("2026-11-30", 300), 1, "the Monday after is an ordinary Monday");
});
