// The page's side of the engine: build the AudioWorklet before the tap,
// decode the piano in a worker, keep the audio clock tied to UTC, and deliver
// the engine's events to the screen at the moment they're heard.

import DecodeWorker from "./decode-worker.ts?worker";
import workletUrl from "./worklet.ts?worker&url";
import { utcAt } from "./clock.ts";
import { EngineHandle, Kind, PIANO_FIRST, PIANO_SAMPLES, PIANO_SECONDS, encodeSample, encodeU32 } from "./protocol.ts";

/** A tiny module that uses one SIMD instruction: validates only where SIMD works. */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

export interface BarEvent {
  t: "bar";
  chain: number;
  sec: number;
  kind: number;
  bar: number;
  bars: number;
  bpm: number;
  start: number;
  c: number;
  r: number;
  pc: number;
  pr: number;
  nc: number;
  nr: number;
  why: number;
  home: number;
  chord: string;
  act: number;
  bright: number;
  tension: number;
  haze: number;
  inv: number;
  /** Why the tempo isn't the daypart's: 9 the valley's moving quickly, 10
   * it's crawling; −1 it is. */
  tempo?: number;
  /** The fleet's flow it was planned from, −1…1. */
  flow?: number;
  /** How dark a storm on its way has made the pad, 0–1. */
  dark?: number;
  /** The temperature's warmth on the master, −1 (cold) to 1 (heat). */
  warm?: number;
  /** The grid's swell on the master, dB. */
  grid?: number;
  /** In A Day in Twelve Minutes, the moment of the day the bar stands for (UTC ms); 0 live. */
  day: number;
}
export interface FeatureEvent {
  t: "feat";
  k: number;
  route: number;
  stop: number;
  ev: number;
  /** Seconds behind schedule, when realtime saw it. */
  late: number;
  /** 1 when realtime saw it happen, 0 when it's the schedule. */
  obs: number;
  v: number;
}
export interface PulseEvent {
  t: "pulse";
  i: number;
  lat: number;
  lon: number;
  m: number;
  /** How loud it is from where you're listening, 0–1 (1 on the map). */
  g?: number;
  /** The note's variant: a bell's line, a plane landing (bit 8), the drums
   * up a canyon (1) or at avalanche control (4). Newer engines only. */
  v?: number;
}
/** A note the map will show, as soon as it's composed: `in` ms after `at`. */
export interface SoonEvent {
  t: "soon";
  i: number;
  lat: number;
  lon: number;
  m: number;
  g: number;
  v: number;
  in: number;
}
/** A voice with no one place sounding: the bass (14), the harp (13), a
 * snow grain (4). */
export interface VoiceEvent {
  t: "voice";
  i: number;
  m: number;
}
/** The listener moved: where to, and how near each family is from there. */
export interface VantageEvent {
  t: "vantage";
  v: number;
  lat: number | null;
  lon: number | null;
  face: number | null;
  /** Each family's level from here (0–1): the mountains, the city, the
   * lake, the rivers, the ridges, the snow, the air. */
  near: number[];
  /** How near the rail stations are (0–1). */
  rail: number;
}
export interface ThemeEvent {
  t: "theme";
  s: number;
  m: number;
}
/** A note the listener played along with. */
export interface PlayEvent {
  t: "play";
  m: number;
}
/** A note of the listener's run, as a solo. */
export interface SoloEvent {
  t: "solo";
  m: number;
}
/** A Day in Twelve Minutes was asked for: whether the day is in the schedule. */
export interface DayEvent {
  t: "day";
  date: number;
  ok: boolean;
  anchor?: number;
  /** How much faster than the day it plays: 120, or 125 the night the
   * clocks fall back. */
  speed?: number;
}
export type EngineEvent = (BarEvent | FeatureEvent | PulseEvent | SoonEvent | VoiceEvent | ThemeEvent | PlayEvent | SoloEvent | DayEvent | VantageEvent) & { f: number };
export type Heard<E> = E & { /** performance.now() when it's heard */ at: number };

type Listener = (e: Heard<EngineEvent>) => void;

/** What ?debug shows: how hard the engine works and whether audio drops. */
export interface DebugStats {
  /** The engine's share of the audio thread's time, 0–1, over the last second. */
  load: number;
  /** The slowest render quantum in that second, and how long one lasts, ms. */
  worstMs: number;
  quantumMs: number;
  /** Quanta that took longer to render than they last, since debugging began. */
  late: number;
  /** Whether the worklet's timer is fine-grained (performance) or the ms Date. */
  fine: boolean;
  /** Times the audio clock stalled against the wall clock, and for how long. */
  dropouts: number;
  droppedMs: number;
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
  state: string;
  /** The loudest sample sent to the speakers in the last half second, dBFS,
   * and the gain after the engine: silence here is silence in the page. */
  peakDb: number;
  gain: number;
}

export class Host {
  readonly ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  /** After the engine, before the speakers: ducked while tuning to the room. */
  private outGain: GainNode | null = null;
  private module: WebAssembly.Module | null = null;
  private analysis: EngineHandle | null = null;
  private firstContextFrame = -1;
  private listeners: Listener[] = [];
  private keepalive: HTMLAudioElement | null = null;
  private clockTimer: number | undefined;
  private decoder = new TextDecoder();
  /** Rewind: ms added to UTC before it reaches the engine. */
  timeShift = 0;
  /** The listener's nudge, ms (positive plays later). */
  nudge = 0;
  private samplesLoaded = new Set<string>();
  private onSample: ((loaded: number, total: number) => void) | null = null;
  readonly simd: boolean;
  private debugStats: DebugStats | null = null;
  private debugTimer: number | undefined;

  private constructor(ctx: AudioContext, simd: boolean) {
    this.ctx = ctx;
    this.simd = simd;
  }

  /** Build everything that can be built before the tap. */
  static async create(base: string): Promise<Host> {
    const simd = WebAssembly.validate(SIMD_PROBE);
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const host = new Host(ctx, simd);
    const url = `${base}engine/${simd ? "wasatch-simd.wasm" : "wasatch.wasm"}`;
    const compile = WebAssembly.compileStreaming
      ? WebAssembly.compileStreaming(fetch(url)).catch(async () => WebAssembly.compile(await (await fetch(url)).arrayBuffer()))
      : fetch(url).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b));
    const [module] = await Promise.all([compile, ctx.audioWorklet.addModule(workletUrl)]);
    host.module = module;
    const node = new AudioWorkletNode(ctx, "wasatch", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    host.node = node;
    // Some browsers can't clone a module into a worklet: send the bytes. Some
    // say so here; others only on the audio thread, which then asks.
    let sentBytes = false;
    const sendBytes = async () => {
      if (sentBytes) return;
      sentBytes = true;
      const bytes = await (await fetch(url)).arrayBuffer();
      node.port.postMessage({ type: "module", bytes }, [bytes]);
    };
    node.port.onmessage = (e) => {
      if ((e.data as { type?: string }).type === "need-bytes") void sendBytes().catch((err) => console.error(err));
      else host.receive(e.data);
    };
    try {
      node.port.postMessage({ type: "module", module });
    } catch {
      await sendBytes();
    }
    host.outGain = ctx.createGain();
    node.connect(host.outGain);
    host.outGain.connect(ctx.destination);
    return host;
  }

  /** Bring this phone's own output down to `level` (or back to 1) over `ms`. */
  duck(level: number, ms = 120): void {
    const g = this.outGain?.gain;
    if (!g) return;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(level, now, ms / 3000);
  }

  /** Record `seconds` of `ref` (default: what the engine plays) and the
   * microphone, sample-aligned. */
  capture(mic: MediaStream, seconds: number, ref?: AudioNode): Promise<{ ref: Float32Array; mic: Float32Array }> {
    const frames = Math.round(seconds * this.ctx.sampleRate);
    const cap = new AudioWorkletNode(this.ctx, "wasatch-capture", {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { frames },
    });
    const source = ref ?? this.node;
    source?.connect(cap, 0, 0);
    const micNode = this.ctx.createMediaStreamSource(mic);
    micNode.connect(cap, 0, 1);
    // An output that's never written is silence; connecting it keeps the
    // node pulled by the graph.
    cap.connect(this.ctx.destination);
    return new Promise((resolve) => {
      cap.port.onmessage = (e: MessageEvent<{ ref: Float32Array; mic: Float32Array }>) => {
        source?.disconnect(cap);
        micNode.disconnect();
        cap.disconnect();
        resolve(e.data);
      };
    });
  }

  /** The engine's analysis functions, in an instance of their own on this thread. */
  async analysisEngine(): Promise<EngineHandle> {
    if (!this.analysis && this.module) this.analysis = await EngineHandle.fromModule(this.module);
    if (!this.analysis) throw new Error("the engine isn't loaded");
    return this.analysis;
  }

  /** Decode the piano in a worker: the welcome's notes first. */
  loadPiano(base: string, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    this.onSample = onProgress ?? null;
    const first = PIANO_SAMPLES.filter(([n]) => PIANO_FIRST.includes(n));
    const rest = PIANO_SAMPLES.filter(([n]) => !PIANO_FIRST.includes(n));
    return new Promise((resolve) => {
      const worker = new DecodeWorker();
      worker.onmessage = (e) => {
        const d = e.data as { done?: boolean; name?: string; midi?: number; rate?: number; pcm?: Int16Array; error?: string };
        if (d.done) {
          worker.terminate();
          resolve();
          return;
        }
        if (d.pcm && d.midi !== undefined && d.rate !== undefined && d.name) {
          this.post(Kind.SAMPLE, encodeSample(d.midi, d.rate, d.pcm));
          this.samplesLoaded.add(d.name);
          this.onSample?.(this.samplesLoaded.size, PIANO_SAMPLES.length);
        }
      };
      worker.postMessage({ module: this.module, base: `${base}samples/piano/`, files: [...first, ...rest], seconds: PIANO_SECONDS });
    });
  }

  /** `true` once the welcome's notes are decoded. */
  pianoReady(): boolean {
    return PIANO_FIRST.every((n) => this.samplesLoaded.has(n));
  }

  post(kind: number, bytes: Uint8Array): void {
    this.node?.port.postMessage({ type: "post", kind, bytes }, [bytes.buffer]);
  }

  /** Hear the engine's events as they sound; returns a way to stop. */
  onEvent(cb: Listener): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  /** The tap: resume audio (as "playback" on iOS, so the Silent switch and the
   * lock screen don't stop it), start the engine, and keep a media element
   * playing for lock-screen controls. (The page itself pauses when it's
   * left, the screen going off included: main.ts.) */
  async start(keepaliveUrl: string): Promise<void> {
    // All of this runs synchronously inside the tap, before any await.
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = "playback";
      } catch {
        // Older Safari: no Audio Session API.
      }
    }
    if (!this.keepalive) {
      const a = new Audio(keepaliveUrl);
      a.loop = true;
      a.volume = 1;
      this.keepalive = a;
    }
    this.keepalive.play().catch(() => {});
    const resumed = this.ctx.resume();
    this.sendClock();
    this.post(Kind.START, new Uint8Array(0));
    clearInterval(this.clockTimer);
    this.clockTimer = window.setInterval(() => this.sendClock(), 1000);
    await resumed;
    this.sendClock();
  }

  stop(): void {
    this.post(Kind.STOP, new Uint8Array(0));
    this.keepalive?.pause();
  }

  /** An analyser on the engine's output, for the mappings view. */
  analyser(fftSize = 2048): AnalyserNode | null {
    if (!this.node) return null;
    const a = this.ctx.createAnalyser();
    a.fftSize = fftSize;
    a.smoothingTimeConstant = 0;
    this.node.connect(a);
    return a;
  }

  /** The engine's output node, for recording a clip. */
  output(): AudioNode | null {
    return this.node;
  }

  async suspend(): Promise<void> {
    await this.ctx.suspend();
    this.keepalive?.pause();
  }

  async resume(): Promise<void> {
    await this.ctx.resume();
    this.keepalive?.play().catch(() => {});
  }

  /** Start measuring for ?debug; returns the live numbers. */
  debug(): DebugStats {
    if (this.debugStats) return this.debugStats;
    const latency = this.ctx as AudioContext & { outputLatency?: number };
    const s: DebugStats = {
      load: 0,
      worstMs: 0,
      quantumMs: (128 / this.ctx.sampleRate) * 1000,
      late: 0,
      fine: true,
      dropouts: 0,
      droppedMs: 0,
      sampleRate: this.ctx.sampleRate,
      baseLatencyMs: (this.ctx.baseLatency || 0) * 1000,
      outputLatencyMs: (latency.outputLatency || 0) * 1000,
      state: this.ctx.state,
      peakDb: -Infinity,
      gain: 1,
    };
    this.debugStats = s;
    this.node?.port.postMessage({ type: "debug", on: true });
    // A dropout: the audio clock falling behind the wall clock. Each half
    // second, the context should have advanced as far as performance.now().
    let last: { c: number; p: number } | null = null;
    const meter = this.ctx.createAnalyser();
    meter.fftSize = 32768;
    this.outGain?.connect(meter);
    const buf = new Float32Array(meter.fftSize);
    this.debugTimer = window.setInterval(() => {
      s.state = this.ctx.state;
      meter.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const x of buf) peak = Math.max(peak, Math.abs(x));
      s.peakDb = 20 * Math.log10(peak);
      s.gain = this.outGain?.gain.value ?? 1;
      s.outputLatencyMs = (latency.outputLatency || 0) * 1000;
      const ts = this.ctx.getOutputTimestamp?.();
      if (this.ctx.state !== "running" || !ts?.contextTime || !ts.performanceTime) {
        last = null;
        return;
      }
      if (last) {
        const lost = ts.performanceTime - last.p - (ts.contextTime - last.c) * 1000;
        if (lost > 12) {
          s.dropouts++;
          s.droppedMs += lost;
        }
      }
      last = { c: ts.contextTime, p: ts.performanceTime };
    }, 500);
    return s;
  }

  setVantage(code: number): void {
    this.post(Kind.VANTAGE, encodeU32(code));
  }

  /** The performance.now() time a context time is heard. */
  private perfAtContextTime(contextTime: number): number {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime && ts.performanceTime) {
      return ts.performanceTime + (contextTime - ts.contextTime) * 1000;
    }
    const latency = (this.ctx.baseLatency || 0) + ((this.ctx as AudioContext & { outputLatency?: number }).outputLatency || 0);
    return performance.now() + (contextTime - this.ctx.currentTime + latency) * 1000;
  }

  /** Tell the engine which context frame is heard at which UTC time. */
  private sendClock(): void {
    if (!this.node) return;
    const ts = this.ctx.getOutputTimestamp?.();
    let contextTime: number;
    let perf: number;
    if (ts && ts.contextTime && ts.performanceTime) {
      contextTime = ts.contextTime;
      perf = ts.performanceTime;
    } else {
      const latency = (this.ctx.baseLatency || 0) + ((this.ctx as AudioContext & { outputLatency?: number }).outputLatency || 0);
      contextTime = this.ctx.currentTime;
      perf = performance.now() + latency * 1000;
    }
    const utc = utcAt(perf) + this.timeShift - this.nudge;
    this.node.port.postMessage({ type: "clock", contextFrame: contextTime * this.ctx.sampleRate, utcMs: utc });
  }

  /** Rewind or return: move the engine's sense of now. */
  setTimeShift(ms: number): void {
    this.timeShift = ms;
    this.sendClock();
  }

  setNudge(ms: number): void {
    this.nudge = ms;
    this.sendClock();
  }

  private receive(msg: { type: string; [k: string]: unknown }): void {
    if (msg.type === "started") {
      this.firstContextFrame = msg.contextFrame as number;
      this.sendClock();
      return;
    }
    if (msg.type === "error") {
      console.error("engine:", msg.message);
      return;
    }
    if (msg.type === "load" && this.debugStats) {
      const s = this.debugStats;
      const frames = msg.frames as number;
      s.load = (msg.busyMs as number) / ((frames / this.ctx.sampleRate) * 1000);
      s.worstMs = msg.worstMs as number;
      s.late += msg.late as number;
      s.fine = msg.fine as boolean;
      return;
    }
    if (msg.type !== "events" || this.firstContextFrame < 0) return;
    const text = this.decoder.decode(msg.bytes as Uint8Array);
    const sr = this.ctx.sampleRate;
    for (const line of text.split("\n")) {
      if (!line) continue;
      let e: EngineEvent;
      try {
        e = JSON.parse(line) as EngineEvent;
      } catch {
        continue;
      }
      const at = this.perfAtContextTime((this.firstContextFrame + e.f) / sr);
      const heard = { ...e, at } as Heard<EngineEvent>;
      const delay = at - performance.now();
      if (delay > 4) window.setTimeout(() => this.emit(heard), delay);
      else this.emit(heard);
    }
  }

  private emit(e: Heard<EngineEvent>): void {
    for (const l of this.listeners) l(e);
  }
}
