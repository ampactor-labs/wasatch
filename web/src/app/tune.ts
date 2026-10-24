// Tune to the room: line this phone up with the one playing next to it, for
// a phone on a Bluetooth speaker whose delay the browser doesn't report.
//
// Two measurements, each a GCC-PHAT cross-correlation (sonido-analysis, in
// the engine) of something this phone knows exactly against what its
// microphone hears:
//   1. a soft tick from its own speaker: its own round trip, output latency
//      plus input latency;
//   2. its own output ducked, four seconds of the room, against its own
//      render of the same bars: the other phone's timing, plus the trip to
//      this microphone, plus input latency.
// The difference is how far the other phone is from this one, heard from
// here, and the nudge slews to it. Nothing is recorded or sent; the
// microphone is released at the end. Not offered on iPhones, where opening
// the microphone drops Web Audio to call volume (DESIGN.md, Interaction).

import type { Host } from "../engine/host.ts";

export interface TuneResult {
  /** How much later this phone should play, ms. */
  shiftMs: number;
  /** Own round trip, ms. */
  ownMs: number;
  confidence: number;
}

export class TuneError extends Error {}

const MAX_LAG_S = 1.0;
/** Prominence a correlation's peak needs (peak over the RMS of the rest):
 * noise alone tops out near 5 across a second of lags; a reverberant room
 * with music measured near 49 (engine/src/ffi.rs tests). */
const TICK_CLEAR = 12;
const ROOM_CLEAR = 9;

/** A 3 ms windowed noise burst, quiet: the tick. */
function tick(ctx: AudioContext): AudioBuffer {
  const n = Math.round(0.003 * ctx.sampleRate);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 0x2468ace1;
  for (let i = 0; i < n; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const w = Math.sin((Math.PI * i) / n) ** 2;
    d[i] = (((seed >>> 0) / 4_294_967_296) * 2 - 1) * w * 0.3;
  }
  return buf;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function tuneToRoom(host: Host, status: (s: string) => void): Promise<TuneResult> {
  if (!navigator.mediaDevices?.getUserMedia) throw new TuneError("This browser can't use the microphone.");
  status("Asking for the microphone…");
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
  } catch {
    throw new TuneError("No microphone, so it can't listen. Use the nudge instead.");
  }
  const ctx = host.ctx;
  const sr = ctx.sampleRate;
  const engine = await host.analysisEngine();
  try {
    // 1. Our own round trip: duck the music, play the tick, hear it come back.
    status("Measuring this phone's own delay…");
    host.duck(0.02);
    await sleep(300);
    const src = ctx.createBufferSource();
    src.buffer = tick(ctx);
    src.connect(ctx.destination);
    const own = host.capture(mic, 1.6, src);
    src.start(ctx.currentTime + 0.25);
    const a = await own;
    const ownLag = engine.delay(a.ref, a.mic, Math.round(MAX_LAG_S * sr), 0.8);
    src.disconnect();
    if (ownLag.confidence < TICK_CLEAR || ownLag.lag < 0) throw new TuneError("It couldn't hear its own tick. Turn the volume up and try again.");

    // 2. The room: what the other phone plays, against what we would.
    status("Listening to the room for four seconds…");
    const room = await host.capture(mic, 4.0);
    const roomLag = engine.delay(room.ref, room.mic, Math.round(MAX_LAG_S * sr), 0.5);
    if (roomLag.confidence < ROOM_CLEAR) throw new TuneError("It couldn't make out another phone playing. Get closer, or use the nudge.");

    const shiftMs = ((roomLag.lag - ownLag.lag) / sr) * 1000;
    return { shiftMs, ownMs: (ownLag.lag / sr) * 1000, confidence: roomLag.confidence };
  } finally {
    host.duck(1);
    for (const t of mic.getTracks()) t.stop();
  }
}
