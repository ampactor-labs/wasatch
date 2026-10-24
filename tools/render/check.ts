// Listen to the piece the way CI can: render a few minutes at several times
// of day with the same WebAssembly the phones run, and hold it to the
// quality rules (DESIGN.md, Quality).
//
//   node tools/render/check.ts [YYYY-MM-DD] [--seconds 90]
//
// Fails if any rendering is too loud or too quiet, peaks above the ceiling,
// goes silent, produces a NaN, or differs between two runs.
import { render, type RenderResult } from "./render.ts";

const SR = 48_000;

/** One biquad in direct form I, in doubles. */
function biquad(x: Float32Array, b: [number, number, number], a: [number, number]): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i]!;
    const o = b[0] * v + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = v;
    y2 = y1;
    y1 = o;
    y[i] = o;
  }
  return y;
}

/** ITU-R BS.1770-4 integrated loudness at 48 kHz, LUFS. */
export function loudness(left: Float32Array, right: Float32Array): number {
  // The K-weighting filters' published 48 kHz coefficients.
  const shelfB: [number, number, number] = [1.53512485958697, -2.69169618940638, 1.19839281085285];
  const shelfA: [number, number] = [-1.69065929318241, 0.73248077421585];
  const hpB: [number, number, number] = [1.0, -2.0, 1.0];
  const hpA: [number, number] = [-1.99004745483398, 0.99007225036621];
  const k = (x: Float32Array) => {
    const s = biquad(x, shelfB, shelfA);
    return biquad(Float32Array.from(s), hpB, hpA);
  };
  const kl = k(left);
  const kr = k(right);
  const block = Math.round(0.4 * SR);
  const hop = Math.round(0.1 * SR);
  const powers: number[] = [];
  for (let s = 0; s + block <= kl.length; s += hop) {
    let sum = 0;
    for (let i = s; i < s + block; i++) sum += kl[i]! * kl[i]! + kr[i]! * kr[i]!;
    powers.push(sum / block);
  }
  const lufs = (p: number) => -0.691 + 10 * Math.log10(p);
  const abs = powers.filter((p) => lufs(p) > -70);
  if (abs.length === 0) return -Infinity;
  const mean = abs.reduce((a, b) => a + b, 0) / abs.length;
  const rel = abs.filter((p) => lufs(p) > lufs(mean) - 10);
  return lufs(rel.reduce((a, b) => a + b, 0) / rel.length);
}

/** True peak by 4× oversampling with a windowed-sinc interpolator, dBTP. */
export function truePeak(x: Float32Array): number {
  const taps = 12; // per phase
  const phases = 4;
  const h: number[][] = [];
  for (let p = 0; p < phases; p++) {
    const row: number[] = [];
    for (let t = -taps / 2 + 1; t <= taps / 2; t++) {
      const u = t - p / phases;
      const sinc = u === 0 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
      const w = 0.42 + 0.5 * Math.cos((Math.PI * u) / (taps / 2)) + 0.08 * Math.cos((2 * Math.PI * u) / (taps / 2));
      row.push(sinc * w);
    }
    h.push(row);
  }
  let peak = 0;
  for (let i = taps; i < x.length - taps; i++) {
    for (let p = 0; p < phases; p++) {
      const row = h[p]!;
      let acc = 0;
      for (let t = 0; t < row.length; t++) acc += row[t]! * x[i + t - taps / 2 + 1]!;
      peak = Math.max(peak, Math.abs(acc));
    }
  }
  return 20 * Math.log10(Math.max(peak, 1e-12));
}

/** The longest run quieter than −60 dBFS (a 50 ms window), seconds. */
export function longestSilence(left: Float32Array, right: Float32Array): number {
  const win = Math.round(0.05 * SR);
  const quiet = 10 ** (-60 / 20);
  let run = 0;
  let longest = 0;
  for (let s = 0; s + win <= left.length; s += win) {
    let peak = 0;
    for (let i = s; i < s + win; i++) peak = Math.max(peak, Math.abs(left[i]!), Math.abs(right[i]!));
    run = peak < quiet ? run + win : 0;
    longest = Math.max(longest, run);
  }
  return longest / SR;
}

function finite(x: Float32Array): boolean {
  for (const v of x) if (!Number.isFinite(v)) return false;
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const i = args.indexOf("--seconds");
  const seconds = i >= 0 ? Number(args[i + 1]) : 90;
  const { readFileSync } = await import("node:fs");
  const manifest = JSON.parse(readFileSync(new URL("../../web/public/schedule/manifest.json", import.meta.url), "utf8")) as { days: Record<string, string> };
  // Default: the second compiled date (today), so the day before is loaded too.
  const day = date ?? Object.keys(manifest.days).sort()[1]!;
  const times = ["03:10", "06:45", "12:20", "17:40", "22:30"];
  const failures: string[] = [];
  const settle = 12; // the welcome and the fade-in
  for (const time of times) {
    const r: RenderResult = await render(day, time, seconds);
    const from = settle * SR;
    const l = r.left.subarray(from);
    const rr = r.right.subarray(from);
    const lufs = loudness(l, rr);
    const tp = Math.max(truePeak(l), truePeak(rr));
    const silence = longestSilence(l, rr);
    const ok = finite(r.left) && finite(r.right);
    const again = await render(day, time, Math.min(seconds, 30));
    const same = again.hash === (await render(day, time, Math.min(seconds, 30))).hash;
    const features = r.events.filter((e) => e.includes('"t":"feat"')).length;
    console.log(
      `${day} ${time}: ${lufs.toFixed(1)} LUFS, ${tp.toFixed(2)} dBTP, longest quiet ${silence.toFixed(2)} s, ${features} captions, ${(r.seconds / r.elapsed).toFixed(1)}x realtime`,
    );
    if (!ok) failures.push(`${time}: NaN or infinity in the output`);
    if (!(lufs > -21 && lufs < -12)) failures.push(`${time}: loudness ${lufs.toFixed(1)} LUFS is outside −21…−12`);
    if (tp > -0.5) failures.push(`${time}: true peak ${tp.toFixed(2)} dBTP is above −0.5`);
    if (silence > 2.5) failures.push(`${time}: ${silence.toFixed(2)} s of near-silence`);
    if (!same) failures.push(`${time}: two identical renders differ`);
    if (features < Math.floor((seconds - settle) / 40)) failures.push(`${time}: only ${features} captions in ${seconds} s`);
  }
  if (failures.length) {
    console.error(`FAIL\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log("ok");
}
