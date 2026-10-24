// miniSEED 2 records, as EarthScope's ringserver sends them: a 48-byte fixed
// header, blockette 1000, and Steim1 or Steim2 compressed samples.

export interface Record2 {
  network: string;
  station: string;
  location: string;
  channel: string;
  /** UTC ms of the first sample. */
  start: number;
  /** Samples per second. */
  rate: number;
  samples: Int32Array;
}

function text(b: Uint8Array, a: number, z: number): string {
  let s = "";
  for (let i = a; i < z; i++) s += String.fromCharCode(b[i] ?? 32);
  return s.trim();
}

/** Samples per second from the header's factor and multiplier (SEED 2.4). */
export function sampleRate(factor: number, mult: number): number {
  if (factor === 0) return 0;
  const f = factor > 0 ? factor : -1 / factor;
  const m = mult > 0 ? mult : mult < 0 ? -1 / mult : 1;
  return f * m;
}

/** Decode one record. Returns null for anything it can't read safely. */
export function decodeRecord(rec: Uint8Array): Record2 | null {
  if (rec.length < 64) return null;
  const v = new DataView(rec.buffer, rec.byteOffset, rec.byteLength);
  const year = v.getUint16(20, false);
  const doy = v.getUint16(22, false);
  if (year < 1900 || year > 2200 || doy < 1 || doy > 366) return null;
  const start =
    Date.UTC(year, 0, 1) +
    (doy - 1) * 86_400_000 +
    rec[24]! * 3_600_000 +
    rec[25]! * 60_000 +
    rec[26]! * 1000 +
    v.getUint16(28, false) / 10;
  const nsamp = v.getUint16(30, false);
  const rate = sampleRate(v.getInt16(32, false), v.getInt16(34, false));
  const activity = rec[36]!;
  const corr = v.getInt32(40, false);
  const dataOff = v.getUint16(44, false);
  let blk = v.getUint16(46, false);
  let encoding = -1;
  let little = false;
  let guard = 0;
  while (blk >= 48 && blk + 8 <= rec.length && guard++ < 8) {
    const type = v.getUint16(blk, false);
    if (type === 1000) {
      encoding = rec[blk + 4]!;
      little = rec[blk + 5] === 0;
      break;
    }
    blk = v.getUint16(blk + 2, false);
    if (blk === 0) break;
  }
  if (encoding !== 10 && encoding !== 11) return null;
  if (little || dataOff < 48 || dataOff >= rec.length || rate <= 0) return null;
  const samples = decodeSteim(rec.subarray(dataOff), nsamp, encoding === 11 ? 2 : 1);
  if (!samples) return null;
  // Bit 1 of the activity flags says the correction is already applied.
  const corrected = (activity & 0x02) !== 0 ? start : start + corr / 10;
  return {
    network: text(rec, 18, 20),
    station: text(rec, 8, 13),
    location: text(rec, 13, 15),
    channel: text(rec, 15, 18),
    start: corrected,
    rate,
    samples,
  };
}

const sx = (value: number, bits: number) => (value << (32 - bits)) >> (32 - bits);

/**
 * Steim1/Steim2 decompression (big-endian). Each 64-byte frame starts with a
 * word of sixteen 2-bit nibbles saying how the other fifteen words are packed;
 * the first frame's words 1 and 2 are the first and last sample. Returns null
 * if the record's own check (the last sample) fails.
 */
export function decodeSteim(data: Uint8Array, nsamp: number, level: 1 | 2): Int32Array | null {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const frames = Math.floor(data.length / 64);
  const diffs: number[] = [];
  let x0 = 0;
  let xn = 0;
  for (let f = 0; f < frames && diffs.length < nsamp + 1; f++) {
    const base = f * 64;
    const ctrl = v.getUint32(base, false);
    for (let w = 1; w < 16; w++) {
      const nib = (ctrl >>> (30 - 2 * w)) & 3;
      const word = v.getUint32(base + 4 * w, false);
      if (f === 0 && w === 1) {
        x0 = word | 0;
        continue;
      }
      if (f === 0 && w === 2) {
        xn = word | 0;
        continue;
      }
      if (nib === 0) continue;
      if (nib === 1) {
        for (let k = 0; k < 4; k++) diffs.push(sx((word >>> (24 - 8 * k)) & 0xff, 8));
        continue;
      }
      if (level === 1) {
        if (nib === 2) {
          diffs.push(sx((word >>> 16) & 0xffff, 16), sx(word & 0xffff, 16));
        } else {
          diffs.push(word | 0);
        }
        continue;
      }
      const dnib = word >>> 30;
      if (nib === 2) {
        if (dnib === 1) diffs.push(sx(word & 0x3fffffff, 30));
        else if (dnib === 2) for (let k = 0; k < 2; k++) diffs.push(sx((word >>> (15 - 15 * k)) & 0x7fff, 15));
        else if (dnib === 3) for (let k = 0; k < 3; k++) diffs.push(sx((word >>> (20 - 10 * k)) & 0x3ff, 10));
        else return null;
      } else {
        if (dnib === 0) for (let k = 0; k < 5; k++) diffs.push(sx((word >>> (24 - 6 * k)) & 0x3f, 6));
        else if (dnib === 1) for (let k = 0; k < 6; k++) diffs.push(sx((word >>> (25 - 5 * k)) & 0x1f, 5));
        else if (dnib === 2) for (let k = 0; k < 7; k++) diffs.push(sx((word >>> (24 - 4 * k)) & 0xf, 4));
        else return null;
      }
    }
  }
  if (diffs.length < nsamp || nsamp === 0) return null;
  const out = new Int32Array(nsamp);
  out[0] = x0;
  for (let i = 1; i < nsamp; i++) out[i] = (out[i - 1]! + diffs[i]!) | 0;
  return out[nsamp - 1] === xn ? out : null;
}
