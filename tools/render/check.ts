// Listen to the piece the way CI can: render a few minutes at several times
// of day with the same WebAssembly the phones run, and hold it to the
// quality rules (DESIGN.md, Quality).
//
//   node tools/render/check.ts [YYYY-MM-DD] [--seconds 90]
//
// Fails if any rendering is too loud or too quiet, peaks above the ceiling,
// goes silent, produces a NaN, or differs between two runs; then listens to
// the evening from each vantage (each must sound like its place, and none
// may jump in loudness on a phone's speaker); then plays the day before as
// A Day in Twelve Minutes and holds that to the same rules.
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

/** A one-pole low-pass (or the high-pass left over), in place of a filter bank. */
function onePole(x: Float32Array, fc: number, high = false): Float32Array {
  const a = Math.exp((-2 * Math.PI * fc) / SR);
  const y = new Float32Array(x.length);
  let z = 0;
  for (let i = 0; i < x.length; i++) {
    z += (x[i]! - z) * (1 - a);
    y[i] = high ? x[i]! - z : z;
  }
  return y;
}

const energy = (x: Float32Array) => x.reduce((s, v) => s + v * v, 0);
const dB = (r: number) => 10 * Math.log10(Math.max(r, 1e-20));

/** What a listener would notice of a mix: its highs (above about 4 kHz),
 * its width, and its level through a phone's speaker (about 500 Hz–6 kHz,
 * one speaker), each in dB. */
export function picture(left: Float32Array, right: Float32Array): { highs: number; width: number; phone: number } {
  const mid = left.map((l, i) => (l + right[i]!) / 2);
  const side = left.map((l, i) => (l - right[i]!) / 2);
  const all = energy(mid);
  const highs = energy(onePole(onePole(mid, 4000, true), 4000, true));
  const phone = onePole(onePole(onePole(onePole(mid, 500, true), 500, true), 6000), 6000);
  return { highs: dB(highs / all), width: dB(energy(side) / all), phone: dB(energy(phone) / mid.length) };
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
    if (!(lufs > -17.5 && lufs < -14.5)) failures.push(`${time}: loudness ${lufs.toFixed(1)} LUFS is outside −17.5…−14.5`);
    if (tp > -0.5) failures.push(`${time}: true peak ${tp.toFixed(2)} dBTP is above −0.5`);
    if (silence > 2.5) failures.push(`${time}: ${silence.toFixed(2)} s of near-silence`);
    if (!same) failures.push(`${time}: two identical renders differ`);
    if (features < Math.floor((seconds - settle) / 40)) failures.push(`${time}: only ${features} captions in ${seconds} s`);
  }
  // The vantages: the same evening from each place.
  const places = ["everywhere", "downtown", "the canyons", "the lake"];
  const heard: { lufs: number; tp: number; highs: number; width: number; phone: number; hash: string; apart: number }[] = [];
  let map: RenderResult | null = null;
  for (const [v, place] of places.entries()) {
    const r = await render(day, "17:40", 60, { vantage: v });
    const l = r.left.subarray(settle * SR);
    const rr = r.right.subarray(settle * SR);
    map ??= r;
    // How far this mix is from the map's: the energy of the difference.
    const ml = map.left.subarray(settle * SR);
    const apart = v === 0 ? -Infinity : dB(energy(l.map((x, i) => x - ml[i]!)) / energy(ml));
    const h = { lufs: loudness(l, rr), tp: Math.max(truePeak(l), truePeak(rr)), ...picture(l, rr), hash: r.hash, apart };
    heard.push(h);
    console.log(
      `from ${place}: ${h.lufs.toFixed(1)} LUFS, ${h.tp.toFixed(2)} dBTP, highs ${h.highs.toFixed(1)} dB, width ${h.width.toFixed(1)} dB, on a phone ${h.phone.toFixed(1)} dB${v ? `, ${h.apart.toFixed(1)} dB from the map's mix` : ""}`,
    );
    // The rider levels what a phone plays, so a vantage with less bass (the
    // canyon, the city's kick far off) reads lower on a full-range meter by
    // design; the phone's level is held below. Full range only has to be sane.
    if (!(h.lufs > -20 && h.lufs < -13)) failures.push(`from ${place}: loudness ${h.lufs.toFixed(1)} LUFS is outside −20…−13`);
    if (h.tp > -0.5) failures.push(`from ${place}: true peak ${h.tp.toFixed(2)} dBTP`);
  }
  const [everywhere, downtown, canyons, lake] = heard as [(typeof heard)[0], (typeof heard)[0], (typeof heard)[0], (typeof heard)[0]];
  if (new Set(heard.map((h) => h.hash)).size !== 4) failures.push("vantages: two of them render the same");
  for (const [i, h] of heard.entries()) {
    if (i > 0 && h.apart < -8) failures.push(`from ${places[i]}: only ${h.apart.toFixed(1)} dB from the map's mix`);
    if (Math.abs(h.phone - everywhere.phone) > 4) failures.push(`from ${places[i]}: ${(h.phone - everywhere.phone).toFixed(1)} dB on a phone against the map`);
  }
  if (lake.highs > everywhere.highs - 4) failures.push(`from the lake: highs ${lake.highs.toFixed(1)} dB, not darker than the map's ${everywhere.highs.toFixed(1)}`);
  if (canyons.width < everywhere.width + 1.5) failures.push(`from the canyons: width ${canyons.width.toFixed(1)} dB, no wider than the map's ${everywhere.width.toFixed(1)}`);
  void downtown;

  // A Day in Twelve Minutes: the day before, start to finish, then live.
  const days = Object.keys(manifest.days).sort();
  const yesterday = days[days.indexOf(day) - 1] ?? day;
  const r = await render(day, "17:40", 740, { twelve: { date: yesterday, after: 5 } });
  const SRATE = 48_000;
  const parsed = r.events.map((e) => JSON.parse(e) as { t: string; day?: number; v?: number; k?: number });
  const dayBars = parsed.filter((e) => e.t === "bar" && (e.day ?? 0) > 0).length;
  const backLive = parsed.findIndex((e, i) => e.t === "bar" && e.day === 0 && parsed.slice(0, i).some((x) => x.t === "bar" && (x.day ?? 0) > 0)) >= 0;
  const moments = new Set(parsed.filter((e) => e.t === "feat" && e.v !== undefined && e.v >= 1 && e.v <= 5 && e.k !== 11).map((e) => Math.round(e.v!)));
  const minutes: number[] = [];
  for (let m = 0; m < 12; m++) {
    const a = Math.round((8 + m * 60) * SRATE);
    const b = a + 60 * SRATE;
    minutes.push(loudness(r.left.subarray(a, b), r.right.subarray(a, b)));
  }
  const tp = Math.max(truePeak(r.left), truePeak(r.right));
  const quiet = longestSilence(r.left.subarray(8 * SRATE), r.right.subarray(8 * SRATE));
  console.log(
    `${yesterday} in twelve minutes: ${dayBars} bars, ${Math.min(...minutes).toFixed(1)} to ${Math.max(...minutes).toFixed(1)} LUFS a minute, ${tp.toFixed(2)} dBTP, longest quiet ${quiet.toFixed(2)} s, moments ${[...moments].sort().join(",")}`,
  );
  if (dayBars < 295) failures.push(`twelve: only ${dayBars} bars of the day`);
  if (!backLive) failures.push("twelve: never came back to live");
  if (minutes.some((l) => !(l > -17.5 && l < -14.5))) failures.push(`twelve: a minute outside −17.5…−14.5 LUFS (${minutes.map((l) => l.toFixed(1)).join(" ")})`);
  if (tp > -0.5) failures.push(`twelve: true peak ${tp.toFixed(2)} dBTP`);
  if (quiet > 2.5) failures.push(`twelve: ${quiet.toFixed(2)} s of near-silence`);
  for (const [m, name] of [[2, "the night's last train"], [3, "sunrise"], [4, "sunset"]] as const) {
    if (!moments.has(m)) failures.push(`twelve: no caption for ${name}`);
  }

  if (failures.length) {
    console.error(`FAIL\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log("ok");
}
