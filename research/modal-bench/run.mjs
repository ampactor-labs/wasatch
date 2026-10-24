import { readFileSync } from 'node:fs';
const sr = 48000, seconds = 4, blocks = Math.ceil(sr * seconds / 128);
for (const file of process.argv.slice(2)) {
  const { instance } = await WebAssembly.instantiate(readFileSync(file), {});
  const { init, process: proc } = instance.exports;
  for (const modes of [50 * 48, 24 * 48]) {
    init(modes); proc(200); // warm-up
    const t0 = performance.now(); const chk = proc(blocks); const ms = performance.now() - t0;
    const nsPerModeSample = (ms * 1e6) / (modes * blocks * 128);
    console.log(`${file.split('/').pop()} modes=${modes} realtime-load=${(ms / (seconds * 1000) * 100).toFixed(1)}% of one core  ns/mode-sample=${nsPerModeSample.toFixed(3)} chk=${chk.toFixed(3)}`);
  }
}
