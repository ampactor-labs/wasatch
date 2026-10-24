import { describe, expect, test } from "vitest";
import { decodeRecord, decodeSteim, sampleRate } from "./mseed.ts";
import { RECORDS } from "./mseed.fixture.ts";

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

describe("miniSEED", () => {
  test.each(RECORDS)("decodes $network.$station.$location.$channel", (r) => {
    const rec = decodeRecord(bytes(r.b64));
    expect(rec).not.toBeNull();
    expect(rec!.network).toBe(r.network);
    expect(rec!.station).toBe(r.station);
    expect(rec!.location).toBe(r.location);
    expect(rec!.channel).toBe(r.channel);
    expect(rec!.start).toBe(r.start);
    expect(rec!.rate).toBe(r.rate);
    expect(rec!.samples.length).toBe(r.n);
    expect(rec!.samples[0]).toBe(r.first);
    expect(rec!.samples[r.n - 1]).toBe(r.last);
    expect(rec!.samples.reduce((a, x) => a + x, 0)).toBe(r.sum);
  });

  test("a damaged record fails its own check instead of decoding garbage", () => {
    const raw = bytes(RECORDS[0]!.b64);
    raw[64 + 4 * 5] = raw[64 + 4 * 5]! ^ 0x10;
    expect(decodeRecord(raw)).toBeNull();
  });

  test("short or nonsense input is rejected", () => {
    expect(decodeRecord(new Uint8Array(10))).toBeNull();
    expect(decodeRecord(new Uint8Array(512))).toBeNull();
  });

  test("Steim1 differences integrate from the first sample", () => {
    // One frame: control word, X0 = 100, Xn = 106, then four 8-bit differences.
    const frame = new DataView(new ArrayBuffer(64));
    frame.setUint32(0, (1 << (30 - 2 * 3)) >>> 0);
    frame.setInt32(4, 100);
    frame.setInt32(8, 106);
    frame.setUint32(12, (0 << 24) | (1 << 16) | (2 << 8) | 3);
    const out = decodeSteim(new Uint8Array(frame.buffer), 4, 1);
    expect(out && [...out]).toEqual([100, 101, 103, 106]);
  });

  test("sample rates from factor and multiplier", () => {
    expect(sampleRate(100, 1)).toBe(100);
    expect(sampleRate(-10, 1)).toBe(0.1);
    expect(sampleRate(20, -2)).toBe(10);
    expect(sampleRate(0, 1)).toBe(0);
  });
});
