import { describe, expect, test } from "vitest";
import { centralIndex, encodeClock, encodeDay, encodeNetwork, encodeSky, routeCode, type NetworkFile, type SkyHour } from "./protocol.ts";
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

  test("SKY is twelve floats an hour, NaN where unknown", () => {
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
    const b = encodeSky([h]);
    expect(b.length).toBe(4 + 8 + 12 * 4);
    const v = view(b);
    expect(v.getFloat64(4, true)).toBe(h.at);
    expect(Number.isNaN(v.getFloat32(12, true))).toBe(true);
    expect(v.getFloat32(12 + 11 * 4, true)).toBeCloseTo(0.2, 6);
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
