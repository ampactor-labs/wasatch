import { describe, expect, test } from "vitest";
import { centralIndex, encodeAlerts, encodeClock, encodeDay, encodeNetwork, encodePlanes, encodeQuakes, encodeRail, encodeSky, encodeSlow, routeCode, type NetworkFile, type SkyHour } from "./protocol.ts";
import { encodeGroundPlaced } from "../data/ground.ts";

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

describe("the engine's messages", () => {
  test("DAY packs each departure as route | dir << 8 | stop << 16", () => {
    const bytes = encodeDay("2026-10-23", 1792735200000, {
      key: "k",
      rail: [{ r: 1, d: 1, h: 0, s: [7, 9], t: [21_600, 21_720] }],
      ski: [{ r: 5, t: 25_260, h: 4 }],
      bus: { perMinute: [3, 4], west: [1, 2], east: [2, 2] },
    });
    const v = view(bytes);
    expect(v.getUint32(0, true)).toBe(20261023);
    expect(v.getFloat64(4, true)).toBe(1792735200000);
    expect(v.getUint32(12, true)).toBe(2);
    expect(v.getUint32(16, true)).toBe(21_600);
    expect(v.getUint32(20, true)).toBe(1 | (1 << 8) | (7 << 16));
    expect(v.getUint32(28, true)).toBe(1 | (1 << 8) | (9 << 16));
    expect(v.getUint32(32, true)).toBe(1);
    expect(v.getUint32(36, true)).toBe(25_260);
    expect(v.getUint32(40, true)).toBe(5);
    expect(v.getUint32(44, true)).toBe(2);
    expect([v.getUint16(48, true), v.getUint16(50, true), v.getUint16(52, true), v.getUint16(54, true)]).toEqual([3, 4, 1, 2]);
    expect(bytes.length).toBe(56);
  });

  test("NETWORK codes the lines the engine knows", () => {
    const net: NetworkFile = {
      routes: [
        { id: "1", short: "701", name: "Blue Line", type: 0, kind: "trax", color: "", text: "" },
        { id: "2", short: "703", name: "Red Line", type: 0, kind: "trax", color: "", text: "" },
        { id: "3", short: "704", name: "Green Line", type: 0, kind: "trax", color: "", text: "" },
        { id: "4", short: "720", name: "S-Line", type: 0, kind: "sline", color: "", text: "" },
        { id: "5", short: "750", name: "FrontRunner", type: 2, kind: "frontrunner", color: "", text: "" },
        { id: "6", short: "994", name: "Ski", type: 3, kind: "ski", color: "", text: "" },
      ],
      stops: [
        { id: "a", name: "Ballpark Station", lat: 40.75, lon: -111.9 },
        { id: "b", name: "Salt Lake Central Station", lat: 40.76, lon: -111.91 },
      ],
      shapes: [],
      headsigns: [],
    };
    expect(net.routes.map(routeCode)).toEqual([0, 1, 2, 3, 4, 5]);
    // Each ski bus up its own canyon: Big Cottonwood's are 6.
    const ski = (short: string, name: string) => routeCode({ id: short, short, name, type: 3, kind: "ski", color: "", text: "" });
    expect(ski("994", "90TH SO TRAX/SNWBRD/ALTA")).toBe(5);
    expect(ski("972", "BINGHM JNCT/SOL BRIGHTN")).toBe(6);
    expect(ski("CS1", "Canyon Service")).toBe(5);
    expect(ski("CS3", "Canyon Service")).toBe(6);
    expect(centralIndex(net)).toBe(1);
    const v = view(encodeNetwork(net));
    expect(v.getUint32(0, true)).toBe(6);
    expect([...new Uint8Array(v.buffer, v.byteOffset + 4, 6)]).toEqual([0, 1, 2, 3, 4, 5]);
    expect(v.getUint32(10, true)).toBe(2);
    expect(v.getInt32(10 + 4 + 16, true)).toBe(1);
  });

  test("SKY is twelve floats an hour, then the five added since, NaN where unknown", () => {
    const h: SkyHour = {
      at: 1792800000000,
      cloud: Number.NaN,
      precipMm: 0.5,
      snowCm: 0,
      tempC: 9,
      windMs: 2,
      gustMs: 3,
      pm25: 7,
      inversionC: 1.5,
      alert: 0,
      ridgeMs: 8,
      ridgeGustMs: 12,
      mtnSnowCm: 0.2,
    };
    const b = encodeSky([h, { ...h, at: h.at + 3_600_000, flow: -0.4, pressureTend: -2.5, stormMm: 180, pm25Downtown: 11.1, lakeFt: 4189.5, season: 0.75, busy: 0.8 }]);
    expect(b.length).toBe(4 + 2 * (8 + 12 * 4) + 4 + 2 * 14 * 4);
    const v = view(b);
    expect(v.getFloat64(4, true)).toBe(h.at);
    expect(Number.isNaN(v.getFloat32(12, true))).toBe(true);
    expect(v.getFloat32(12 + 11 * 4, true)).toBeCloseTo(0.2, 6);
    const tail = 4 + 2 * 56;
    expect(v.getUint32(tail, true)).toBe(14);
    // The first hour's are unknown; the second's follow in order (from
    // tail + 4 + 14 × 4), the lake's PM2.5 unknown, then the frozen slow
    // values, the season and the buses' busyness.
    expect(Number.isNaN(v.getFloat32(tail + 4, true))).toBe(true);
    expect([60, 64, 68, 72].map((o) => v.getFloat32(tail + o, true))).toEqual([Math.fround(-0.4), -2.5, 180, Math.fround(11.1)]);
    expect(Number.isNaN(v.getFloat32(tail + 76, true))).toBe(true);
    expect(v.getFloat32(tail + 80, true)).toBe(Math.fround(4189.5));
    expect(v.getFloat32(tail + 108, true)).toBe(0.75);
    expect(v.getFloat32(tail + 112, true)).toBe(Math.fround(0.8));
  });

  test("QUAKES carries each quake's depth after the rows", () => {
    const b = encodeQuakes([
      { ms: 1, originMs: 0, mag: 2.1, lat: 40.7, lon: -111.9, depthKm: 7.5 },
      { ms: 2, originMs: 1, mag: 1.4, lat: 40.6, lon: -111.8 },
    ]);
    expect(b.length).toBe(4 + 2 * 28 + 4 + 2 * 4);
    const v = view(b);
    const tail = 4 + 2 * 28;
    expect(v.getUint32(tail, true)).toBe(1);
    expect(v.getFloat32(tail + 4, true)).toBe(7.5);
    expect(Number.isNaN(v.getFloat32(tail + 8, true))).toBe(true);
  });

  test("SLOW and RAIL carry what was added at the end", () => {
    const slow = { lakeFt: 4190, lakeDevFt: 0, river: 0.5, snowpack: 1, newSnowIn: 0, powder: 0.5, season: 0, ground: [0, 0, 0, 0] as [number, number, number, number] };
    expect(encodeSlow(slow).length).toBe(12 * 4);
    expect(view(encodeSlow({ ...slow, energy: 1.1 })).getFloat32(11 * 4, true)).toBeCloseTo(1.1, 6);
    const rail = view(encodeRail(0, 30_000, [[1, 1, 4, 0, 21, 1]], 1792800120000));
    expect(rail.byteLength).toBe(20 + 21 + 8);
    expect(rail.getFloat64(41, true)).toBe(1792800120000);
  });

  test("PLANES and ALERTS rows", () => {
    const p = view(encodePlanes(0, 30_000, [{ ms: 5, lat: 40.8, lon: -111.97, altFt: 6300, arrival: true, size: 4, airline: true }]));
    expect(p.byteLength).toBe(20 + 24);
    expect(p.getFloat32(20 + 16, true)).toBe(6300);
    expect([p.getUint8(40), p.getUint8(41), p.getUint8(42)]).toEqual([1, 4, 1]);
    const a = view(encodeAlerts(0, 30_000, [126, 1, 0, 300], [{ ms: 9, kind: 2, severe: true }]));
    expect(a.byteLength).toBe(16 + 4 + 4 + 12);
    expect([a.getUint8(16), a.getUint8(17), a.getUint8(19)]).toEqual([126, 1, 255]);
    expect([a.getUint8(32), a.getUint8(33)]).toEqual([2, 1]);
  });

  test("CLOCK and GROUND layouts", () => {
    const c = view(encodeClock(48_000, 1792800000123));
    expect(c.getFloat64(0, true)).toBe(48_000);
    expect(c.getFloat64(8, true)).toBe(1792800000123);
    const g = view(encodeGroundPlaced(3, 40.722, -111.906, [[0.5, -0.25]]));
    expect(g.getUint32(0, true)).toBe(3);
    expect(g.getFloat32(4, true)).toBeCloseTo(40.722, 4);
    expect(g.getUint32(12, true)).toBe(1);
    expect(g.getFloat32(16, true)).toBe(0.5);
    expect(g.getFloat32(20, true)).toBe(-0.25);
  });
});
