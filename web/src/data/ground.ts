// The ground: four of the University of Utah's seismometers downtown, live
// from EarthScope's ringserver over DataLink, each moved onto a chord tone.
//
// One station per octave band, low to high: the Capitol, the Avenues,
// Brigham Young Park and the I-15 bridge array (where the freeway's 16–32 Hz
// lives). Each band is mixed down to complex baseband, smoothed to about a
// hertz and decimated to 10 samples a second on a grid of absolute time, so
// every phone computes the same samples from the same packets. The page feeds
// them to the engine as the listening time reaches them; the engine's
// up-converters put them on the chord.

import type { Host } from "../engine/host.ts";
import { Kind } from "../engine/protocol.ts";
import { decodeRecord } from "./mseed.ts";
import type { GroundState } from "../app/valley.ts";

export interface Station {
  code: string;
  name: string;
  lat: number;
  lon: number;
  /** The octave band this station sings: lo–2·lo Hz. */
  lo: number;
  /**
   * The band's RMS in counts on a busy day, where its level reads 0.45.
   * Measured on a Friday at 9:40 PM (Oct 23, 2026: CAP2 1.9, AVE 5.0,
   * BYP 25, SHED 344), set half again higher for the day; nights about four
   * times quieter than days then read near 0.15.
   */
  ref: number;
}

export const STATIONS: Station[] = [
  { code: "CAP2", name: "the Capitol", lat: 40.7796, lon: -111.889, lo: 2, ref: 3 },
  { code: "AVE", name: "the Avenues", lat: 40.7744, lon: -111.8628, lo: 4, ref: 7.5 },
  { code: "BYP", name: "Brigham Young Park", lat: 40.7711, lon: -111.8872, lo: 8, ref: 38 },
  { code: "SHED", name: "the I-15 bridge array", lat: 40.722, lon: -111.9062, lo: 16, ref: 510 },
];

const URL = "wss://rtserve.earthscope.org/datalink";
const BASEBAND_MS = 100;
const DELAY_MS = 90_000;

/** A second-order section (RBJ cookbook), direct form I, in doubles. */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;
  constructor(b0: number, b1: number, b2: number, a1: number, a2: number) {
    this.b0 = b0;
    this.b1 = b1;
    this.b2 = b2;
    this.a1 = a1;
    this.a2 = a2;
  }
  static lowpass(fc: number, fs: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * fc) / fs;
    const alpha = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, (-2 * c) / a0, (1 - alpha) / a0);
  }
  static highpass(fc: number, fs: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * fc) / fs;
    const alpha = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - alpha) / a0);
  }
  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** One station's band: band-pass, mix down by the band's center, smooth,
 * decimate onto the 100 ms grid. */
export class BandDdc {
  private hp: Biquad[];
  private lp: Biquad[];
  private si: Biquad[];
  private sq: Biquad[];
  private readonly fc: number;
  private next = -1;
  private rms = 0;
  /** The sensor's offset, tracked slowly and removed before the filters. */
  private dc = Number.NaN;
  /** Samples left before the filters have settled. */
  private warm: number;
  /** Slow AGC: the baseband's running power. */
  private power = 0;
  private emitted = 0;
  readonly out: { t: number; i: number; q: number }[] = [];
  readonly lo: number;
  private readonly fs: number;

  constructor(lo: number, fs: number) {
    this.lo = lo;
    this.fs = fs;
    this.warm = Math.round(fs * 10);
    const hi = Math.min(lo * 2, fs * 0.45);
    // A center with a whole number of cycles in 1000 s, so the mixing phase,
    // computed from absolute time modulo 1000 s, never jumps.
    this.fc = Math.round(Math.sqrt(lo * hi) * 1000) / 1000;
    this.hp = [Biquad.highpass(lo, fs), Biquad.highpass(lo, fs)];
    this.lp = [Biquad.lowpass(hi, fs), Biquad.lowpass(hi, fs)];
    this.si = [Biquad.lowpass(1.2, fs), Biquad.lowpass(1.2, fs)];
    this.sq = [Biquad.lowpass(1.2, fs), Biquad.lowpass(1.2, fs)];
  }

  /** Band RMS over the last minute or so, in counts. */
  level(): number {
    return Math.sqrt(this.rms);
  }

  /** Push one sample taken at UTC `t` ms. */
  push(t: number, x: number): void {
    if (Number.isNaN(this.dc)) this.dc = x;
    this.dc += (x - this.dc) / (20 * this.fs);
    let y = x - this.dc;
    for (const f of this.hp) y = f.process(y);
    for (const f of this.lp) y = f.process(y);
    if (this.warm > 0) {
      // Let the filters settle before anything is measured or emitted.
      this.warm--;
      for (const f of this.si) f.process(0);
      for (const f of this.sq) f.process(0);
      return;
    }
    const k = this.rms === 0 ? 1 : 1 / (60 * this.fs);
    this.rms += (y * y - this.rms) * k;
    // Mix down: the phase comes from absolute time, the same on every phone.
    const ph = 2 * Math.PI * this.fc * ((t / 1000) % 1000);
    let i = y * Math.cos(ph);
    let q = -y * Math.sin(ph);
    for (const f of this.si) i = f.process(i);
    for (const f of this.sq) q = f.process(q);
    if (this.next < 0) this.next = Math.ceil(t / BASEBAND_MS) * BASEBAND_MS;
    if (t >= this.next) {
      const p = i * i + q * q;
      // Fast for the first half minute, then slow (25 s).
      this.power += (p - this.power) * (this.emitted++ < 300 ? 0.05 : 0.004);
      const g = this.power > 0 ? 1 / Math.sqrt(this.power) : 0;
      // A local quake blooms every band at once; keep it from jumping out.
      const mag = Math.sqrt(p) * g;
      const soft = mag > 0 ? Math.tanh(mag / 2.5) * 2.5 / mag : 0;
      this.out.push({ t: this.next, i: i * g * soft * 0.5, q: q * g * soft * 0.5 });
      this.next += BASEBAND_MS;
    }
  }
}

/** One station's sample stream, stitched across records. */
class StationStream {
  private expect = -1;
  ddc: BandDdc | null = null;
  lastData = 0;

  readonly station: Station;

  constructor(station: Station) {
    this.station = station;
  }

  add(start: number, rate: number, samples: Int32Array): void {
    if (!this.ddc) this.ddc = new BandDdc(this.station.lo, rate);
    const dt = 1000 / rate;
    let first = 0;
    if (this.expect > 0) {
      const gap = start - this.expect;
      if (gap < -dt / 2) {
        // Overlap: skip what we have.
        first = Math.ceil(-gap / dt);
      } else if (gap > dt / 2) {
        // A gap: fill with the last value's absence (zeros), at most 10 s.
        const fill = Math.min(Math.round(gap / dt), rate * 10);
        for (let k = 0; k < fill; k++) this.ddc.push(this.expect + k * dt, 0);
      }
    }
    for (let k = first; k < samples.length; k++) this.ddc.push(start + k * dt, samples[k]!);
    this.expect = start + samples.length * dt;
    this.lastData = this.expect;
  }
}

export class Ground {
  private ws: WebSocket | null = null;
  private streams = new Map<string, StationStream>();
  private pushed = new Map<string, number>();
  private timer = 0;
  private retry = 0;
  private stopped = false;
  private readonly enc = new TextEncoder();
  private readonly dec = new TextDecoder();
  /** Rewind offset, ms; the ground only plays live. */
  shift = 0;

  private readonly host: Host;
  private readonly onState: (g: GroundState | null) => void;
  private readonly nowUtc: () => number;

  constructor(host: Host, onState: (g: GroundState | null) => void, nowUtc: () => number = () => Date.now()) {
    this.host = host;
    this.onState = onState;
    this.nowUtc = nowUtc;
    for (const s of STATIONS) this.streams.set(s.code, new StationStream(s));
  }

  private send(header: string, data?: string): void {
    const h = this.enc.encode(header);
    const d = data ? this.enc.encode(data) : new Uint8Array(0);
    const buf = new Uint8Array(3 + h.length + d.length);
    buf[0] = 68; // "D"
    buf[1] = 76; // "L"
    buf[2] = h.length;
    buf.set(h, 3);
    buf.set(d, 3 + h.length);
    this.ws?.send(buf);
  }

  connect(): Promise<void> {
    this.stopped = false;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(URL, ["DataLink1.0"]);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      let state: "id" | "match" | "position" | "streaming" = "id";
      const pattern = `^FDSN:UU_(${STATIONS.map((s) => s.code).join("|")})_[0-9]*_[EH]_[NH]_Z/MSEED$`;
      ws.onopen = () => this.send("ID wasatch-symphony:web:0:browser");
      ws.onerror = () => reject(new Error("the seismometers' server refused us"));
      ws.onclose = () => {
        this.ws = null;
        if (!this.stopped) {
          // Back off and try again; five connections per address, shared.
          this.retry = Math.min(this.retry + 1, 6);
          window.setTimeout(() => void this.connect().catch(() => {}), 2000 * 2 ** this.retry);
        }
      };
      ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        const b = new Uint8Array(e.data);
        if (b[0] !== 68 || b[1] !== 76) return;
        const hl = b[2]!;
        const header = this.dec.decode(b.subarray(3, 3 + hl));
        if (header.startsWith("PACKET")) {
          this.retry = 0;
          const rec = decodeRecord(b.subarray(3 + hl));
          if (!rec) return;
          this.streams.get(rec.station)?.add(rec.start, rec.rate, rec.samples);
          return;
        }
        // ID, then MATCH our stations, then rewind to just before the
        // listening time so the ground sounds at once, then STREAM.
        if (state === "id" && header.startsWith("ID")) {
          state = "match";
          this.send(`MATCH ${this.enc.encode(pattern).length}`, pattern);
        } else if (state === "match" && (header.startsWith("OK") || header.startsWith("ERROR"))) {
          if (header.startsWith("ERROR")) {
            reject(new Error(header));
            ws.close();
            return;
          }
          state = "position";
          const from = Math.round((this.nowUtc() + this.shift - DELAY_MS - 15_000) * 1000);
          this.send(`POSITION AFTER ${from}`);
        } else if (state === "position") {
          // Whether or not the ring still holds that far back, stream.
          state = "streaming";
          this.send("STREAM");
          resolve();
        }
      };
      clearInterval(this.timer);
      this.timer = window.setInterval(() => this.feed(), 250);
    });
  }

  /** Hand the engine every baseband sample the listening time has reached. */
  private feed(): void {
    const listening = this.nowUtc() + this.shift - DELAY_MS;
    let loudest: { s: Station; rel: number } | null = null;
    const levels: [number, number, number, number] = [0, 0, 0, 0];
    let live = false;
    STATIONS.forEach((s, band) => {
      const st = this.streams.get(s.code);
      const ddc = st?.ddc;
      if (!st || !ddc) return;
      const fresh = this.shift === 0 && listening - st.lastData < 60_000 && st.lastData - listening < 120_000;
      // Drop what the listener has passed; keep what's coming.
      while (ddc.out.length && ddc.out[0]!.t < listening - 1000) ddc.out.shift();
      const due: [number, number][] = [];
      let last = this.pushed.get(s.code) ?? 0;
      while (ddc.out.length && ddc.out[0]!.t <= listening + 500) {
        const p = ddc.out.shift()!;
        if (p.t <= last) continue;
        due.push([p.i, p.q]);
        last = p.t;
      }
      this.pushed.set(s.code, last);
      if (fresh) {
        live = true;
        const db = 20 * Math.log10(Math.max(1e-6, ddc.level() / s.ref));
        levels[band] = Math.max(0, Math.min(1, 0.45 + db / 40));
        const rel = levels[band];
        if (!loudest || rel > loudest.rel) loudest = { s, rel };
      }
      if (due.length && fresh) this.host.post(Kind.GROUND, encodeGroundPlaced(band, s.lat, s.lon, due));
    });
    const top = loudest as { s: Station; rel: number } | null;
    this.onState(live && top ? { station: top.s.name, levels, observed: listening } : null);
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.ws?.close();
    this.onState(null);
  }
}

/** GROUND: band, the station's position, then baseband pairs. */
export function encodeGroundPlaced(band: number, lat: number, lon: number, iq: [number, number][]): Uint8Array {
  const buf = new ArrayBuffer(16 + iq.length * 8);
  const v = new DataView(buf);
  v.setUint32(0, band, true);
  v.setFloat32(4, lat, true);
  v.setFloat32(8, lon, true);
  v.setUint32(12, iq.length, true);
  iq.forEach(([i, q], k) => {
    v.setFloat32(16 + k * 8, i, true);
    v.setFloat32(20 + k * 8, q, true);
  });
  return new Uint8Array(buf);
}
