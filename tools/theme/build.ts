// The crest and the theme, generated from the measured profile.
//
//   node tools/theme/build.ts           write web/src/art/crest-data.ts
//   node tools/theme/build.ts --check   fail if it, or the engine's theme,
//                                       disagrees with the profile
//
// research/skyline/crest_profile.json is the Wasatch crest as the highest
// ground at each 0.01° of latitude (USGS 3DEP, Oct 23, 2026). Its summits are
// the theme's notes, each scaled onto ten steps by its sampled height
// (DESIGN.md, The theme).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROFILE = join(root, "research", "skyline", "crest_profile.json");
const OUT = join(root, "web", "src", "art", "crest-data.ts");
const ENGINE_THEME = join(root, "engine", "src", "theme.rs");
const FT_PER_M = 3.28084;

/** The nearest GNIS summit to each profile summit (all within 1.1 km), north to south. */
export const NAMES = [
  "Ben Lomond",
  "Allen Peak",
  "Thurston Peak",
  "Bountiful Peak",
  "Grandview Peak",
  "Twin Peaks",
  "Box Elder Peak",
  "Mount Timpanogos",
  "Provo Peak",
  "Spanish Fork Peak",
  "Santaquin Peak",
  "Bald Mountain",
  "Mount Nebo",
];

interface Profile {
  profile_m: number[];
  lat: number[];
  lon: number[];
  /** Interior summits: [index, lat, lon, elevation m, prominence m]. */
  summits: [number, number, number, number, number][];
}

export interface Theme {
  elevFt: number[];
  lat: number[];
  lon: number[];
  summits: { i: number; name: string; step: number }[];
}

export function theme(profile: Profile = JSON.parse(readFileSync(PROFILE, "utf8")) as Profile): Theme {
  const elevFt = profile.profile_m.map((m) => Math.round(m * FT_PER_M));
  const lat = profile.lat.map((v) => Number(v.toFixed(3)));
  const lon = profile.lon.map((v) => Number(v.toFixed(4)));
  // The two ends of the range are summits too: Ben Lomond and Mount Nebo.
  const idx = [0, ...profile.summits.map((s) => s[0]), elevFt.length - 1];
  if (idx.length !== NAMES.length) throw new Error(`${idx.length} summits, ${NAMES.length} names`);
  const heights = idx.map((i) => elevFt[i]!);
  const lo = Math.min(...heights);
  const hi = Math.max(...heights);
  const summits = idx.map((i, k) => ({ i, name: NAMES[k]!, step: Math.round((9 * (heights[k]! - lo)) / (hi - lo)) }));
  return { elevFt, lat, lon, summits };
}

function rows(values: number[], perLine: number): string {
  const lines: string[] = [];
  for (let i = 0; i < values.length; i += perLine) lines.push(`  ${values.slice(i, i + perLine).join(", ")},`);
  return lines.join("\n");
}

export function source(t: Theme): string {
  return `// Generated from research/skyline/crest_profile.json (USGS 3DEP, Oct 23, 2026):
// the Wasatch crest as the highest ground at each 0.01 degree of latitude,
// Ben Lomond (north) to Mount Nebo (south). Do not edit by hand.

export const CREST_ELEV_FT: readonly number[] = [
${rows(t.elevFt, 16)}
];

export const CREST_LAT: readonly number[] = [
${rows(t.lat, 12)}
];

export const CREST_LON: readonly number[] = [
${rows(t.lon, 10)}
];

/** The 13 theme summits: profile index, GNIS name, scale step (DESIGN.md, The theme). */
export const THEME_SUMMITS: readonly { i: number; name: string; step: number }[] = [
${t.summits.map((s) => `  { i: ${s.i}, name: "${s.name}", step: ${s.step} },`).join("\n")}
];
`;
}

/** Everything that disagrees with the profile: the art's data, the engine's theme. */
export function problems(t: Theme = theme()): string[] {
  const out: string[] = [];
  if (readFileSync(OUT, "utf8") !== source(t)) out.push("web/src/art/crest-data.ts is stale: run node tools/theme/build.ts");
  const rs = readFileSync(ENGINE_THEME, "utf8");
  const names = [...(rs.match(/pub const SUMMITS: \[&str; 13\] = \[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const steps = (rs.match(/pub const STEPS: \[i32; 13\] = \[([^\]]*)\]/)?.[1] ?? "").split(",").map((s) => Number(s.trim()));
  if (names.join("|") !== t.summits.map((s) => s.name).join("|")) out.push(`engine/src/theme.rs SUMMITS ${names.join(", ")} differ`);
  if (steps.join(",") !== t.summits.map((s) => s.step).join(",")) out.push(`engine/src/theme.rs STEPS ${steps.join(",")} differ from ${t.summits.map((s) => s.step).join(",")}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--check")) {
    const p = problems();
    for (const x of p) console.error(x);
    process.exit(p.length ? 1 : 0);
  }
  const t = theme();
  writeFileSync(OUT, source(t));
  console.log(`wrote ${OUT}: ${t.elevFt.length} samples, steps ${t.summits.map((s) => s.step).join(" ")}`);
}
