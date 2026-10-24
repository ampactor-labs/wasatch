import { describe, expect, test } from "vitest";
import { alertLevel, atHourStart, obsSlot, season } from "./feeds.ts";

const at = (iso: string) => Date.parse(iso);

describe("the plan's sky slots", () => {
  test("slot H takes the report made in the quarter hour before H:00", () => {
    expect(obsSlot(at("2026-10-24T01:54:00Z"))).toBe(at("2026-10-24T02:00:00Z"));
    expect(obsSlot(at("2026-10-24T01:45:00Z"))).toBe(at("2026-10-24T02:00:00Z"));
    expect(obsSlot(at("2026-10-24T01:59:59Z"))).toBe(at("2026-10-24T02:00:00Z"));
  });

  test("reports later in the hour never touch a slot already in use", () => {
    expect(obsSlot(at("2026-10-24T02:00:00Z"))).toBeNull();
    expect(obsSlot(at("2026-10-24T02:12:00Z"))).toBeNull();
    expect(obsSlot(at("2026-10-24T01:44:59Z"))).toBeNull();
  });

  test("alerts push by how serious they are", () => {
    expect(alertLevel("Winter Storm Warning")).toBe(1);
    expect(alertLevel("High Wind Warning")).toBe(1);
    expect(alertLevel("Winter Weather Advisory")).toBe(0.5);
    expect(alertLevel("Air Quality Alert")).toBe(0.3);
    expect(alertLevel("Red Flag Warning")).toBe(0.2);
  });
});

describe("readings as of the top of the hour", () => {
  const pts = [
    { t: at("2026-10-24T01:30:00Z"), v: 1 },
    { t: at("2026-10-24T01:45:00Z"), v: 2 },
    { t: at("2026-10-24T02:00:00Z"), v: 3 },
    { t: at("2026-10-24T02:15:00Z"), v: 4 },
  ];
  test("the last point at or before the hour", () => {
    expect(atHourStart(pts, at("2026-10-24T02:40:00Z"))).toEqual(pts[2]);
    expect(atHourStart(pts, at("2026-10-24T01:59:00Z"))).toBeNull();
    expect(atHourStart(pts, at("2026-10-24T03:10:00Z"))).toEqual(pts[3]);
  });
  test("missing values are skipped", () => {
    expect(atHourStart([{ t: at("2026-10-24T01:00:00Z"), v: Number.NaN }], at("2026-10-24T02:00:00Z"))).toBeNull();
  });
});

describe("the season", () => {
  test("ski season is winter; summer isn't", () => {
    expect(season(at("2027-01-15T12:00:00Z"))).toBe(1);
    expect(season(at("2027-07-04T12:00:00Z"))).toBe(0);
    expect(season(at("2026-11-26T12:00:00Z"))).toBe(1);
  });
  test("it ramps in and out", () => {
    const fall = season(at("2026-11-15T12:00:00Z"));
    const spring = season(at("2027-04-12T12:00:00Z"));
    expect(fall).toBeGreaterThan(0);
    expect(fall).toBeLessThan(1);
    expect(spring).toBeGreaterThan(0);
    expect(spring).toBeLessThan(1);
  });
});
