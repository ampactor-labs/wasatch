import { readFileSync } from 'node:fs';
const sr = 48000, seconds = 4, blocks = Math.ceil(sr * seconds / 128);
const { instance } = await WebAssembly.instantiate(readFileSync(process.argv[2]), {});
const { init, process_simd } = instance.exports;
for (const modes of [50 * 48, 24 * 48]) {
  init(modes); process_simd(200);
  const t0 = performance.now(); const chk = process_simd(blocks); const ms = performance.now() - t0;
  console.log(`explicit f32x4 modes=${modes} realtime-load=${(ms / (seconds * 1000) * 100).toFixed(1)}% of one core chk=${chk.toFixed(3)}`);
}
