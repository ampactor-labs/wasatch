// Render the piece offline with the same WebAssembly the phones run.
//
//   node tools/render/render.ts [YYYY-MM-DD] [HH:MM] [seconds] [out.wav] [--scalar] [--vantage 0-3]
//
// Loads the compiled schedule, the network, the skyline and the piano (decoded
// by the engine's own decoder), starts at that local Mountain time, renders,
// and prints the realtime factor and a hash of the audio: the same inputs must
// give the same hash on every run and every machine.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EngineHandle,
  Kind,
  PIANO_SAMPLES,
  PIANO_SECONDS,
  encodeClock,
  encodeDay,
  encodeNetwork,
  encodeSample,
  encodeSkyline,
  encodeSlow,
  encodeTwelve,
  encodeU32,
  type DayFile,
  type NetworkFile,
} from "../../web/src/engine/protocol.ts";
import { CREST_ELEV_FT } from "../../web/src/art/crest-data.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pub = join(root, "web", "public");
const DELAY_MS = 90_000;

export interface RenderResult {
  left: Float32Array;
  right: Float32Array;
  events: string[];
  seconds: number;
  elapsed: number;
  hash: string;
}

export async function render(
  date: string,
  time: string,
  seconds: number,
  opts: { scalar?: boolean; sampleRate?: number; twelve?: { date: string; after: number }; vantage?: number } = {},
): Promise<RenderResult> {
  const sr = opts.sampleRate ?? 48_000;
  const wasm = readFileSync(join(pub, "engine", opts.scalar ? "wasatch.wasm" : "wasatch-simd.wasm"));
  const module = await WebAssembly.compile(wasm);
  const engine = await EngineHandle.fromModule(module);
  engine.init(sr);

  const manifest = JSON.parse(readFileSync(join(pub, "schedule", "manifest.json"), "utf8")) as {
    days: Record<string, string>;
    t0: Record<string, number>;
  };
  const target = manifest.t0[date];
  if (target === undefined) throw new Error(`${date} is not in the compiled schedule`);
  const network = JSON.parse(readFileSync(join(pub, "schedule", "network.json"), "utf8")) as NetworkFile;
  engine.post(Kind.NETWORK, encodeNetwork(network));
  for (const [d, key] of Object.entries(manifest.days)) {
    const t0 = manifest.t0[d];
    // The days around the start, and the day to play in twelve minutes with
    // the next (whose first trains end its night), as the page loads them.
    const twelve = opts.twelve ? [opts.twelve.date, new Date(Date.parse(`${opts.twelve.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)] : [];
    if (t0 === undefined || (Math.abs(t0 - target) > 1.5 * 86_400_000 && !twelve.includes(d))) continue;
    const day = JSON.parse(readFileSync(join(pub, "schedule", `day-${key}.json`), "utf8")) as DayFile;
    engine.post(Kind.DAY, encodeDay(d, t0, day));
  }
  engine.post(Kind.SKYLINE, encodeSkyline([...CREST_ELEV_FT]));
  for (const [name, midi] of PIANO_SAMPLES) {
    const decoded = engine.decode(readFileSync(join(pub, "samples", "piano", `${name}.mp3`)), PIANO_SECONDS);
    if (!decoded) throw new Error(`could not decode ${name}`);
    engine.post(Kind.SAMPLE, encodeSample(midi, decoded.rate, decoded.pcm));
  }
  engine.post(
    Kind.SLOW,
    encodeSlow({ lakeFt: 4189.8, lakeDevFt: 0, river: 0.5, snowpack: 1, newSnowIn: 0, powder: 0.5, season: 0, ground: [0, 0, 0, 0] }),
  );
  const [h, m] = time.split(":").map(Number);
  engine.post(Kind.CLOCK, encodeClock(0, target + ((h ?? 0) * 60 + (m ?? 0)) * 60_000 + DELAY_MS));
  if (opts.vantage) engine.post(Kind.VANTAGE, encodeU32(opts.vantage));
  engine.post(Kind.START, new Uint8Array(0));

  const frames = Math.round(seconds * sr);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  const events: string[] = [];
  const decoder = new TextDecoder();
  const started = performance.now();
  const twelveAt = opts.twelve ? Math.round(opts.twelve.after * sr) : -1;
  for (let done = 0; done < frames; done += 128) {
    if (opts.twelve && done <= twelveAt && twelveAt < done + 128) engine.post(Kind.TWELVE, encodeTwelve(opts.twelve.date));
    const n = Math.min(128, frames - done);
    const [l, r] = engine.render(n);
    left.set(l, done);
    right.set(r, done);
    const out = engine.outbox();
    if (out.length) events.push(...decoder.decode(out).trim().split("\n"));
  }
  const elapsed = (performance.now() - started) / 1000;
  const hash = createHash("sha256").update(new Uint8Array(left.buffer)).update(new Uint8Array(right.buffer)).digest("hex").slice(0, 16);
  return { left, right, events, seconds, elapsed, hash };
}

export function wav(left: Float32Array, right: Float32Array, sr: number): Uint8Array {
  const n = left.length;
  const buf = new ArrayBuffer(44 + n * 4);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + n * 4, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, left[i] ?? 0)) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, right[i] ?? 0)) * 32767, true);
  }
  return new Uint8Array(buf);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Positional arguments, leaving out flags and the values of --twelve and --vantage.
  const argv = process.argv.slice(2);
  const args = argv.filter((a, i) => !a.startsWith("--") && !["--twelve", "--vantage"].includes(argv[i - 1] ?? ""));
  const scalar = process.argv.includes("--scalar");
  const [date = "2026-10-23", time = "17:40", secs = "60", out] = args;
  const t = process.argv.indexOf("--twelve");
  const twelve = t >= 0 ? { date: process.argv[t + 1] ?? date, after: 5 } : undefined;
  const vi = process.argv.indexOf("--vantage");
  const vantage = vi >= 0 ? Number(process.argv[vi + 1]) : 0;
  const r = await render(date, time, Number(secs), { scalar, vantage, ...(twelve ? { twelve } : {}) });
  const kinds: Record<string, number> = {};
  for (const e of r.events) {
    const t = (JSON.parse(e) as { t: string }).t;
    kinds[t] = (kinds[t] ?? 0) + 1;
  }
  console.log(`${date} ${time} for ${secs} s (${scalar ? "scalar" : "simd"}): ${(r.seconds / r.elapsed).toFixed(1)}x realtime, ${((100 * r.elapsed) / r.seconds).toFixed(1)}% of a core, hash ${r.hash}`);
  console.log("events", kinds);
  if (out) {
    writeFileSync(out, wav(r.left, r.right, 48_000));
    console.log("wrote", out);
  }
}
