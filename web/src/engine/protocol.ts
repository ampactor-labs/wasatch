// The engine's message protocol, shared by the AudioWorklet host, the decode
// worker and the Node tools. Messages are little-endian byte strings written
// into the engine's inbox; see engine/src/ffi.rs for the other side.

export const Kind = {
  DAY: 1,
  NETWORK: 2,
  SKY: 3,
  SLOW: 4,
  CLOCK: 5,
  VANTAGE: 6,
  BIKES: 7,
  QUAKES: 8,
  SAMPLE: 9,
  SKYLINE: 10,
  START: 11,
  STOP: 12,
  GROUND: 13,
  PLAY: 14,
  SOLO: 15,
  TWELVE: 16,
  RAIL: 17,
  PLANES: 18,
  ALERTS: 19,
  ROADS: 20,
} as const;
export type KindCode = (typeof Kind)[keyof typeof Kind];

/** A growable little-endian writer. */
class Writer {
  private buf = new ArrayBuffer(1024);
  private view = new DataView(this.buf);
  private p = 0;

  private room(n: number): void {
    if (this.p + n <= this.buf.byteLength) return;
    let size = this.buf.byteLength * 2;
    while (size < this.p + n) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.p));
    this.buf = next;
    this.view = new DataView(next);
  }
  u8(v: number): this {
    this.room(1);
    this.view.setUint8(this.p, v);
    this.p += 1;
    return this;
  }
  u16(v: number): this {
    this.room(2);
    this.view.setUint16(this.p, v, true);
    this.p += 2;
    return this;
  }
  i16(v: number): this {
    this.room(2);
    this.view.setInt16(this.p, v, true);
    this.p += 2;
    return this;
  }
  u32(v: number): this {
    this.room(4);
    this.view.setUint32(this.p, v >>> 0, true);
    this.p += 4;
    return this;
  }
  i32(v: number): this {
    this.room(4);
    this.view.setInt32(this.p, v | 0, true);
    this.p += 4;
    return this;
  }
  f32(v: number): this {
    this.room(4);
    this.view.setFloat32(this.p, v, true);
    this.p += 4;
    return this;
  }
  f64(v: number): this {
    this.room(8);
    this.view.setFloat64(this.p, v, true);
    this.p += 8;
    return this;
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.buf, 0, this.p).slice();
  }
}

/** One service day as compiled by tools/gtfs (see its README in compile.ts). */
export interface DayFile {
  key: string;
  active?: number[];
  rail: { r: number; d: number; h: number; s: number[]; t: number[] }[];
  ski: { r: number; t: number; h: number }[];
  bus: { perMinute: number[]; west: number[]; east: number[] };
}

export interface NetworkFile {
  routes: { id: string; short: string; name: string; type: number; kind: string; color: string; text: string }[];
  stops: { id: string; name: string; lat: number; lon: number }[];
  shapes: { r: number; d: number; pts: [number, number][] }[];
  headsigns: string[];
}

export function encodeDay(date: string, t0Ms: number, day: DayFile): Uint8Array {
  const w = new Writer();
  w.u32(Number(date.replaceAll("-", "")));
  w.f64(t0Ms);
  let n = 0;
  for (const trip of day.rail) n += trip.s.length;
  w.u32(n);
  for (const trip of day.rail) {
    for (let i = 0; i < trip.s.length; i++) {
      w.u32(trip.t[i] ?? 0);
      w.u32((trip.r & 0xff) | ((trip.d & 0xff) << 8) | ((trip.s[i] ?? 0) << 16));
    }
  }
  w.u32(day.ski.length);
  for (const s of day.ski) w.u32(s.t).u32(s.r);
  const bus = day.bus.perMinute;
  w.u32(bus.length);
  for (const v of bus) w.u16(Math.min(65535, v));
  for (let i = 0; i < bus.length; i++) w.u16(Math.min(65535, day.bus.west[i] ?? 0));
  return w.bytes();
}

/** Route kind codes: 0–2 TRAX Blue/Red/Green, 3 S-Line, 4 FrontRunner, 5 a
 * ski bus up Little Cottonwood, 6 one up Big Cottonwood. */
export function routeCode(route: NetworkFile["routes"][number]): number {
  if (route.kind === "trax") {
    if (/blue/i.test(route.name)) return 0;
    if (/red/i.test(route.name)) return 1;
    return 2;
  }
  if (route.kind === "sline") return 3;
  if (route.kind === "frontrunner") return 4;
  if (route.kind === "ski") return BIG_COTTONWOOD.test(`${route.short} ${route.name}`) ? 6 : 5;
  return 255;
}

/** Brighton and Solitude's buses: the 972 and Canyon Service 3 (UTA writes
 * "SOL BRIGHTN"). */
const BIG_COTTONWOOD = /\b972\b|\bCS3\b|bright|solitude|\bsol\b|big cottonwood/i;

export function centralIndex(network: NetworkFile): number {
  return network.stops.findIndex((s) => /salt lake central/i.test(s.name));
}

export function encodeNetwork(network: NetworkFile): Uint8Array {
  const w = new Writer();
  w.u32(network.routes.length);
  for (const r of network.routes) w.u8(routeCode(r));
  w.u32(network.stops.length);
  for (const s of network.stops) w.f32(s.lat).f32(s.lon);
  w.i32(centralIndex(network));
  return w.bytes();
}

export interface SkyHour {
  /** UTC ms at the start of the hour. */
  at: number;
  cloud: number;
  precipMm: number;
  snowCm: number;
  tempC: number;
  windMs: number;
  gustMs: number;
  pm25: number;
  inversionC: number;
  alert: number;
  ridgeMs: number;
  ridgeGustMs: number;
  mtnSnowCm: number;
  /** How the buses and trains are moving against the usual for the hour,
   * −1…1 (the conductor's; absent or NaN unknown). Observed. */
  flow?: number;
  /** The change in pressure over the three hours to this one, hPa. Observed. */
  pressureTend?: number;
  /** Snow forecast at Alta over the next day, mm, frozen for the hour by
   * the conductor. A forecast: it only colors bars. */
  stormMm?: number;
}

/** The fields added to an hour since the first twelve, in the order the
 * engine reads them. */
const SKY_MORE = ["flow", "pressureTend", "stormMm"] as const;

/** SKY: `u32 n`, n hours of `f64 at` and twelve floats, then `u32 k` and k
 * more floats an hour (an engine older than them reads only the rows). */
export function encodeSky(hours: SkyHour[]): Uint8Array {
  const w = new Writer();
  w.u32(hours.length);
  const f = (v: number | undefined) => w.f32(v !== undefined && Number.isFinite(v) ? v : Number.NaN);
  for (const h of hours) {
    w.f64(h.at);
    for (const v of [h.cloud, h.precipMm, h.snowCm, h.tempC, h.windMs, h.gustMs, h.pm25, h.inversionC, h.alert, h.ridgeMs, h.ridgeGustMs, h.mtnSnowCm]) f(v);
  }
  w.u32(SKY_MORE.length);
  for (const h of hours) for (const k of SKY_MORE) f(h[k]);
  return w.bytes();
}

export interface Slow {
  lakeFt: number;
  lakeDevFt: number;
  river: number;
  snowpack: number;
  newSnowIn: number;
  powder: number;
  season: number;
  ground: [number, number, number, number];
  /** Electricity demand on PacifiCorp East's grid against the usual for
   * the hour; 0 or absent unknown. */
  energy?: number;
}

export function encodeSlow(s: Slow): Uint8Array {
  const w = new Writer();
  for (const v of [s.lakeFt, s.lakeDevFt, s.river, s.snowpack, s.newSnowIn, s.powder, s.season, ...s.ground, s.energy ?? 0]) {
    w.f32(v);
  }
  return w.bytes();
}

export function encodeClock(frame: number, utcMs: number): Uint8Array {
  return new Writer().f64(frame).f64(utcMs).bytes();
}

export function encodeU32(v: number): Uint8Array {
  return new Writer().u32(v).bytes();
}

export interface BikeEvent {
  ms: number;
  lat: number;
  lon: number;
  delta: number;
  station: number;
}

export function encodeBikes(events: BikeEvent[]): Uint8Array {
  const w = new Writer();
  w.u32(events.length);
  for (const e of events) w.f64(e.ms).f32(e.lat).f32(e.lon).i32(e.delta).u32(e.station);
  return w.bytes();
}

export interface QuakeEvent {
  ms: number;
  originMs: number;
  mag: number;
  lat: number;
  lon: number;
}

export function encodeQuakes(events: QuakeEvent[]): Uint8Array {
  const w = new Writer();
  w.u32(events.length);
  for (const e of events) w.f64(e.ms).f64(e.originMs).f32(e.mag).f32(e.lat).f32(e.lon);
  return w.bytes();
}

export function encodeSample(midi: number, rate: number, pcm: Int16Array): Uint8Array {
  const w = new Writer();
  w.u32(midi).f32(rate).u32(pcm.length);
  for (const v of pcm) w.i16(v);
  return w.bytes();
}

export function encodeSkyline(elevFt: number[]): Uint8Array {
  const w = new Writer();
  w.u32(elevFt.length);
  for (const v of elevFt) w.f32(v);
  return w.bytes();
}

export function encodeGround(band: number, iq: [number, number][]): Uint8Array {
  const w = new Writer();
  w.u32(band).u32(iq.length);
  for (const [i, q] of iq) w.f32(i).f32(q);
  return w.bytes();
}

/** Play along: a ski's edge (−1…1), how hard, and whether it's steady. */
export function encodePlay(edge: number, vel: number, steady: boolean): Uint8Array {
  return new Writer().f32(edge).f32(vel).u32(steady ? 1 : 0).bytes();
}

export interface SoloNote {
  /** Onset, beats from the solo's start. */
  beat: number;
  /** Scale degree from the tonic near middle C. */
  degree: number;
  vel: number;
  /** Length, beats. */
  beats: number;
}

export function encodeSolo(notes: SoloNote[]): Uint8Array {
  const w = new Writer();
  w.u32(notes.length);
  for (const n of notes) w.f32(n.beat).i32(n.degree).f32(n.vel).f32(n.beats);
  return w.bytes();
}

/** A conductor's window of rail departures: [actual ms, scheduled ms,
 * route, dir, stop, observed 0/1] rows. */
/** RAIL: a conductor's window of departures, then when the next FrontRunner
 * was due to leave Salt Lake Central as it was sealed (0 unknown). */
export function encodeRail(from: number, to: number, rows: [number, number, number, number, number, number][], dueMs = 0): Uint8Array {
  const w = new Writer();
  w.f64(from).f64(to).u32(rows.length);
  for (const [ms, sched, route, dir, stop, observed] of rows) w.f64(ms).f64(sched).u8(route).u8(dir).u16(stop).u8(observed);
  w.f64(dueMs);
  return w.bytes();
}

/** A plane taking off or landing at SLC, as a window carries it. */
export interface PlaneEvent {
  ms: number;
  lat: number;
  lon: number;
  altFt: number;
  arrival: boolean;
  /** 1 (light) to 5 (heavy); 0 unknown. */
  size: number;
  airline: boolean;
}

export function encodePlanes(from: number, to: number, planes: PlaneEvent[]): Uint8Array {
  const w = new Writer();
  w.f64(from).f64(to).u32(planes.length);
  for (const p of planes) w.f64(p.ms).f32(p.lat).f32(p.lon).f32(p.altFt).u8(p.arrival ? 1 : 0).u8(p.size).u8(p.airline ? 1 : 0).u8(0);
  return w.bytes();
}

/** A new UTA service alert: what kind of route (0 buses, 1 TRAX and the
 * S-Line, 2 FrontRunner, 3 ski buses) and whether it suspends service. */
export interface AlertEvent {
  ms: number;
  kind: number;
  severe: boolean;
}

/** Something on the roads: 0 an incident on a valley highway, 1 one
 * cleared, 2 avalanche control; on 0 the valley, 1 Little Cottonwood, 2 Big. */
export interface RoadEvent {
  ms: number;
  kind: number;
  road: number;
  lat: number;
  lon: number;
}

/** What stood on the roads as a window sealed. */
export interface RoadState {
  traction: [number, number];
  plows: number;
  closures: number;
}

export function encodeRoads(from: number, to: number, state: RoadState, roads: RoadEvent[]): Uint8Array {
  const w = new Writer();
  w.f64(from).f64(to).u8(state.traction[0] ? 1 : 0).u8(state.traction[1] ? 1 : 0);
  w.u16(Math.min(65_535, state.plows)).u16(Math.min(65_535, state.closures)).u16(0).u32(roads.length);
  for (const r of roads) w.f64(r.ms).u8(r.kind).u8(r.road).u16(0).f32(r.lat).f32(r.lon);
  return w.bytes();
}

/** ALERTS: a window's new alerts, and how many of each kind were in effect
 * as it was sealed. */
export function encodeAlerts(from: number, to: number, active: [number, number, number, number], alerts: AlertEvent[]): Uint8Array {
  const w = new Writer();
  w.f64(from).f64(to);
  for (const n of active) w.u8(Math.min(255, Math.max(0, Math.round(n))));
  w.u32(alerts.length);
  for (const a of alerts) w.f64(a.ms).u8(a.kind).u8(a.severe ? 1 : 0).u16(0);
  return w.bytes();
}

/** A Day in Twelve Minutes for a date ("2026-10-23"), or null for live. */
export function encodeTwelve(date: string | null): Uint8Array {
  return new Writer().u32(date ? Number(date.replaceAll("-", "")) : 0).bytes();
}

const NO_EVENTS = new Uint8Array(0);

/** The engine's exports. */
interface Exports {
  memory: WebAssembly.Memory;
  wasatch_init(sr: number): void;
  wasatch_inbox(len: number): number;
  wasatch_post(kind: number, len: number): number;
  wasatch_render(frames: number): number;
  wasatch_outbox_len(): number;
  wasatch_outbox_ptr(): number;
  wasatch_decode(len: number, maxSeconds: number): number;
  wasatch_pcm_ptr(): number;
  wasatch_pcm_rate(): number;
  wasatch_delay(nX: number, nY: number, maxLag: number, beta: number): number;
  wasatch_delay_confidence(): number;
}

/** A thin handle on an engine instance. Views onto WebAssembly memory are
 * made fresh on every call, since memory growth detaches old ones. */
export class EngineHandle {
  private readonly x: Exports;

  constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as unknown as Exports;
  }

  static async fromModule(module: WebAssembly.Module): Promise<EngineHandle> {
    const instance = await WebAssembly.instantiate(module, {});
    return new EngineHandle(instance);
  }

  /** Synchronous instantiation, for worklets. */
  static fromModuleSync(module: WebAssembly.Module): EngineHandle {
    return new EngineHandle(new WebAssembly.Instance(module, {}));
  }

  init(sampleRate: number): void {
    this.x.wasatch_init(sampleRate);
  }

  post(kind: number, bytes: Uint8Array): number {
    const ptr = this.x.wasatch_inbox(bytes.length);
    new Uint8Array(this.x.memory.buffer, ptr, bytes.length).set(bytes);
    return this.x.wasatch_post(kind, bytes.length);
  }

  private views: { buffer: ArrayBuffer; ptr: number; frames: number; out: [Float32Array, Float32Array] } | null = null;

  /** Render `frames`; returns views onto left and right (valid until the next
   * call). On the audio thread this runs every few milliseconds, so the views
   * are made once and reused until memory grows: no garbage per quantum. */
  render(frames: number): [Float32Array, Float32Array] {
    const ptr = this.x.wasatch_render(frames);
    const buffer = this.x.memory.buffer;
    const v = this.views;
    if (v && v.buffer === buffer && v.ptr === ptr && v.frames === frames) return v.out;
    const all = new Float32Array(buffer, ptr, frames * 2);
    const out: [Float32Array, Float32Array] = [all.subarray(0, frames), all.subarray(frames)];
    this.views = { buffer, ptr, frames, out };
    return out;
  }

  /** The events since the last call, as UTF-8 JSON lines (a copy; the same
   * empty array when there are none, which is most quanta). */
  outbox(): Uint8Array {
    const n = this.x.wasatch_outbox_len();
    if (n === 0) return NO_EVENTS;
    return new Uint8Array(this.x.memory.buffer, this.x.wasatch_outbox_ptr(), n).slice();
  }

  /** How many samples `y` lags `x` (GCC-PHAT, sonido-analysis), and how far
   * the peak stands out. */
  delay(x: Float32Array, y: Float32Array, maxLag: number, beta = 0.5): { lag: number; confidence: number } {
    const bytes = (x.length + y.length) * 4;
    const ptr = this.x.wasatch_inbox(bytes);
    const view = new Float32Array(this.x.memory.buffer, ptr, x.length + y.length);
    view.set(x, 0);
    view.set(y, x.length);
    const lag = this.x.wasatch_delay(x.length, y.length, maxLag, beta);
    return { lag, confidence: this.x.wasatch_delay_confidence() };
  }

  /** Decode an MP3 with the engine's own decoder: mono 16-bit PCM. */
  decode(mp3: Uint8Array, maxSeconds: number): { rate: number; pcm: Int16Array } | null {
    const ptr = this.x.wasatch_inbox(mp3.length);
    new Uint8Array(this.x.memory.buffer, ptr, mp3.length).set(mp3);
    const frames = this.x.wasatch_decode(mp3.length, maxSeconds);
    if (frames === 0) return null;
    const pcm = new Int16Array(this.x.memory.buffer, this.x.wasatch_pcm_ptr(), frames).slice();
    return { rate: this.x.wasatch_pcm_rate(), pcm };
  }
}

/** Piano sample files and the notes they were recorded at. */
export const PIANO_SAMPLES: [string, number][] = [
  ["A2", 45], ["C3", 48], ["Ds3", 51], ["Fs3", 54], ["A3", 57], ["C4", 60], ["Ds4", 63], ["Fs4", 66],
  ["A4", 69], ["C5", 72], ["Ds5", 75], ["Fs5", 78], ["A5", 81], ["C6", 84], ["Ds6", 87], ["Fs6", 90],
  ["A6", 93], ["C7", 96],
];
/** The ones the welcome needs, loaded before the tap. */
export const PIANO_FIRST: string[] = ["C4", "Ds4", "Fs4", "A4", "C5", "Ds5", "Fs5"];
/** Seconds of each sample kept. */
export const PIANO_SECONDS = 7;

/** The conductor's /vehicles.json: UTA's fleet as last seen. */
export interface Fleet {
  /** The feed's time, UTC ms. */
  t: number;
  /** [route index, direction, lat, lon, seconds old], one per train. */
  trains: [number, number, number, number, number][];
  /** Trips out now, counted by trip (a three-car train is one). */
  counts: { trains: number; buses: number };
  /** Every bus out, [lat, lon]. */
  buses?: [number, number][];
}
