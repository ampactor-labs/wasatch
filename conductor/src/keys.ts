// Check the keyed sources against their live APIs with the keys this
// process has, and say what each one reads: the fields it found and what
// the music would make of them. It never prints a key.
//
//   npm run keys:check
//
// With the keys on Railway, run it with the service's variables:
//
//   railway run --service wasatch --environment production -- npm run keys:check

import { AirNowSource } from "./airnow.ts";
import { fetchGrid } from "./outlook.ts";
import { Uac, DANGER } from "./uac.ts";
import { Udot, canyonWind, heard, parseEvents, plowsOut, traction } from "./udot.ts";

const fields = (body: unknown) => {
  const first = Array.isArray(body) ? body[0] : body;
  return first && typeof first === "object" ? Object.keys(first).join(", ") : String(first);
};
const n = (body: unknown) => (Array.isArray(body) ? body.length : "not a list");

async function check(name: string, key: string | undefined, run: () => Promise<string[]>): Promise<boolean> {
  if (!key) {
    console.log(`${name}: no key set, off`);
    return true;
  }
  try {
    console.log(`${name}: ok\n  ${(await run()).join("\n  ")}`);
    return true;
  } catch (err) {
    console.log(`${name}: FAILED ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

const results = [
  await check("UDOT", process.env.UDOT_KEY, async () => {
    const u = new Udot();
    const now = Date.now();
    const events = await u.get("event");
    const parsed = parseEvents(events);
    const out = [`event: ${n(events)} rows, ${parsed.length} placed; fields: ${fields(events)}`];
    const valley = parsed.flatMap((e) => {
      const h = heard(e);
      return h ? [`${h.kind} (${["valley", "Little Cottonwood", "Big Cottonwood"][h.road]}): ${e.roadway}: ${e.words}`] : [];
    });
    out.push(`  heard: ${valley.length ? valley.slice(0, 6).join(" | ") : "nothing on the valley's highways now"}`);
    for (const [what, read] of [
      ["roadconditions", (b: unknown) => `traction law up Little / Big Cottonwood: ${traction(b).join(" / ")}`],
      ["servicevehicles", (b: unknown) => `plows out in the valley: ${plowsOut(b, now)}`],
      ["weatherstations", (b: unknown) => {
        const w = canyonWind(b);
        return w ? `canyon wind ${w.ms.toFixed(1)} m/s, gusts ${w.gustMs.toFixed(1)}, from ${w.stations.join(", ")}` : "no canyon stations matched";
      }],
    ] as const) {
      try {
        const body = await u.get(what);
        out.push(`${what}: ${n(body)} rows; fields: ${fields(body)}`, `  ${read(body)}`);
      } catch (err) {
        out.push(`${what}: FAILED ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return out;
  }),
  await check("AirNow", process.env.AIRNOW_KEY, async () => {
    const a = new AirNowSource();
    const r = await a.poll();
    return [r ? `PM2.5 AQI ${r.aqi} (${r.category}) at ${r.area}: ${r.pm25} µg/m³, observed ${new Date(r.hour).toISOString()}` : "no PM2.5 among the observations"];
  }),
  await check("Utah Avalanche Center", process.env.UAC_TOKEN, async () => {
    const u = new Uac();
    const r = await u.poll();
    return [r ? `danger ${DANGER[r.danger]} (rose ${r.rose.join(",")}), issued ${r.issued}: ${r.bottomLine.slice(0, 160)}` : "answered, but no overall_danger_rose in it"];
  }),
  await check("EIA", process.env.EIA_KEY ?? "DEMO_KEY", async () => {
    const g = await fetchGrid();
    return [g ? `PacifiCorp East ${g.mw} MW at ${new Date(g.hour).toISOString()}, usual ${g.usual}: ${g.energy}${process.env.EIA_KEY ? "" : " (the shared demo key)"}` : "no rows"];
  }),
];
process.exit(results.every(Boolean) ? 0 : 1);
