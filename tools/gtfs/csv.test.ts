import assert from "node:assert/strict";
import { test } from "node:test";
import { readCsv } from "./csv.ts";
import { activeServices, parseTime, serviceDayT0, simplify, tidyName } from "./util.ts";

const rows = (text: string) => {
  const out: string[][] = [];
  const header = readCsv(text, (f) => out.push(f));
  return { header: header.names, out };
};

test("reads plain rows, a BOM and CRLF endings", () => {
  const { header, out } = rows("﻿a,b,c\r\n1,2,3\r\n4,5,6\r\n");
  assert.deepEqual(header, ["a", "b", "c"]);
  assert.deepEqual(out, [
    ["1", "2", "3"],
    ["4", "5", "6"],
  ]);
});

test("reads quoted fields with commas, escaped quotes and newlines", () => {
  const { out } = rows('id,name\n1,"Main St, Downtown"\n2,"He said ""hi"""\n3,"two\nlines"\n4,plain\n');
  assert.deepEqual(out, [
    ["1", "Main St, Downtown"],
    ["2", 'He said "hi"'],
    ["3", "two\nlines"],
    ["4", "plain"],
  ]);
});

test("skips blank lines, keeps empty fields, handles no final newline", () => {
  const { out } = rows("a,b\n\n1,\n,2");
  assert.deepEqual(out, [
    ["1", ""],
    ["", "2"],
  ]);
});

test("looks up columns by name", () => {
  const h = readCsv("trip_id, stop_id\nx,y\n", () => {});
  assert.equal(h.col("stop_id"), 1);
  assert.equal(h.col("missing"), -1);
});

test("parses GTFS times, padded and past midnight", () => {
  assert.equal(parseTime(" 4:15:00"), 4 * 3600 + 15 * 60);
  assert.equal(parseTime("25:01:02"), 25 * 3600 + 62);
  assert.ok(Number.isNaN(parseTime("")));
});

test("resolves services from calendar and exceptions", () => {
  const calendar = [
    { serviceId: "wk", days: [false, true, true, true, true, true, false], start: "2026-08-16", end: "2026-12-05" },
  ];
  const exceptions = [
    { serviceId: "extra", date: "2026-10-23", type: 1 as const },
    { serviceId: "wk", date: "2026-11-26", type: 2 as const },
  ];
  assert.deepEqual(activeServices("2026-10-23", calendar, exceptions), ["extra", "wk"]);
  assert.deepEqual(activeServices("2026-10-25", calendar, exceptions), []);
  assert.deepEqual(activeServices("2026-11-26", calendar, exceptions), []);
});

test("service days start at local midnight, and at 01:00 MDT when the clocks fall back", () => {
  assert.equal(new Date(serviceDayT0("2026-10-23")).toISOString(), "2026-10-23T06:00:00.000Z");
  assert.equal(new Date(serviceDayT0("2026-11-01")).toISOString(), "2026-11-01T07:00:00.000Z");
  assert.equal(new Date(serviceDayT0("2026-12-01")).toISOString(), "2026-12-01T07:00:00.000Z");
});

test("simplifies a straight line to its ends and keeps a corner", () => {
  const line: [number, number][] = [
    [40.76, -111.9],
    [40.765, -111.9],
    [40.77, -111.9],
  ];
  assert.equal(simplify(line, 8).length, 2);
  const corner: [number, number][] = [
    [40.76, -111.9],
    [40.77, -111.9],
    [40.77, -111.88],
  ];
  assert.equal(simplify(corner, 8).length, 3);
});

test("title-cases names written in capitals only", () => {
  assert.equal(tidyName("RIVER TRAIL STATION"), "River Trail Station");
  assert.equal(tidyName("TO DRAPER"), "To Draper");
  assert.equal(tidyName("FrontRunner"), "FrontRunner");
});
