// Build the engine to WebAssembly twice: with SIMD (Safari 16.4+, every
// current Chrome and Firefox) and without, for the engines that can't load a
// SIMD module. The page probes and picks one. Output: web/public/engine/.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const engine = join(root, "engine");
const out = join(root, "web", "public", "engine");
mkdirSync(out, { recursive: true });

const builds = [
  { name: "wasatch-simd.wasm", flags: "-C target-feature=+simd128,+bulk-memory,+nontrapping-fptoint", dir: "simd" },
  { name: "wasatch.wasm", flags: "-C target-feature=+bulk-memory,+nontrapping-fptoint", dir: "scalar" },
];
for (const b of builds) {
  const target = join(engine, "target", `wasm-${b.dir}`);
  execFileSync(
    "cargo",
    ["build", "--release", "--lib", "--target", "wasm32-unknown-unknown", "--target-dir", target],
    { cwd: engine, stdio: "inherit", env: { ...process.env, RUSTFLAGS: b.flags } },
  );
  const built = join(target, "wasm32-unknown-unknown", "release", "wasatch_engine.wasm");
  copyFileSync(built, join(out, b.name));
  console.log(`${b.name}: ${(statSync(built).size / 1024).toFixed(0)} KB`);
}
