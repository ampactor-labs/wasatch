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
import { fetchGrid, fetchMix } from "./outlook.ts";
import { probeSiri } from "./siri.ts";
import { Uac, DANGER } from "./uac.ts";
import { Udot, canyonWind, heard, parseEvents, parseRoadForecast, parseSigns, plowsOut, traction } from "./udot.ts";

const fields = (body: unknown) => {
  const first = Array.isArray(body) ? body[0] : body;
  return first && typeof first === "object" ? Object.keys(first).join(", ") : String(first);
};
const n = (body: unknown) => (Array.isArray(body) ? body.length : "not a list");
const at = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) + "Z" : "?");
const num = (v: number, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : "–");

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
    for (const [what, version, read] of [
      ["roadconditions", "v3", (b: unknown) => `traction law up Little / Big Cottonwood: ${traction(b).join(" / ")}`],
      ["servicevehicles", "v2", (b: unknown) => `plows out in the valley: ${plowsOut(b, now)}`],
      ["weatherstations", "v2", (b: unknown) => {
        const w = canyonWind(b, now);
        return w ? `canyon wind ${w.ms.toFixed(1)} m/s, gusts ${w.gustMs.toFixed(1)}, from ${w.stations.join(", ")}` : "no canyon stations matched";
      }],
      ["messagesigns", "v2", (b: unknown) => {
        const signs = parseSigns(b);
        return signs.length ? `minutes on the valley's signs: ${signs.slice(0, 8).map((t) => `${t.roadway} to ${t.to} ${t.minutes}`).join(", ")}${signs.length > 8 ? ` +${signs.length - 8}` : ""}` : "no valley sign shows minutes now";
      }],
      ["futuredrivingconditions", "v2", (b: unknown) => {
        const f = parseRoadForecast(b);
        return f.length ? `canyon roads ahead: ${f.map((x) => `${x.roadway} ${x.condition} (${x.reason}, ${x.timeframe})`).join("; ")}` : "no canyon road in the forecast";
      }],
    ] as const) {
      try {
        const body = await u.get(what, version);
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
    if (!r) return ["answered, but no monitors or reporting area in range"];
    const out = [
      `${r.area}: AQI ${r.aqi} ${r.category.toLowerCase()}, ${r.pollutant} leads, observed ${at(r.hour)} (${r.pollutants.map((p) => `${p.parameter} ${p.aqi}`).join(", ")})`,
      `${r.sites.length} monitors in the box; ${r.monitors} reported PM2.5 for ${at(r.hour)}: the valley's median ${num(r.pm25)} µg/m³`,
    ];
    for (const s of r.sites) {
      const parts = [`PM2.5 ${num(s.pm25)}`, Number.isFinite(s.pm10) ? `PM10 ${num(s.pm10, 0)}` : "", Number.isFinite(s.o3) ? `ozone ${num(s.o3, 0)} ppb` : "", Number.isFinite(s.no2) ? `NO2 ${num(s.no2)}` : ""].filter(Boolean);
      out.push(`  ${s.name} (${s.id}) ${at(s.hour)}: ${parts.join(" · ")}`);
    }
    out.push(`downtown hears ${r.downtown ? `${r.downtown.name}: ${num(r.downtown.pm25)} µg/m³` : "nothing yet"}; the lake hears ${r.lake ? `${r.lake.name}: ${num(r.lake.pm25)} µg/m³` : "nothing yet"}`);
    if (r.forecast) out.push(`forecast issued ${r.forecast.issued}: ${r.forecast.days.map((d) => `${d.date} ${d.parameter} ${d.category}${Number.isFinite(d.aqi) ? ` (${d.aqi})` : ""}${d.actionDay ? " ACTION DAY" : ""}`).join(", ")}${r.forecast.days.find((d) => d.discussion)?.discussion ? `\n  "${r.forecast.days.find((d) => d.discussion)!.discussion.slice(0, 160)}"` : ""}`);
    else out.push("no forecast read");
    return out;
  }),
  await check("UTA (SIRI)", process.env.UTA_TOKEN, async () => {
    const probes = await probeSiri(process.env.UTA_TOKEN!);
    const lines = probes.map((p) => `${p.url}: ${p.status ?? "no answer"} ${p.type}${p.siri ? ` SIRI ${p.note}` : p.note ? ` · ${p.note}` : ""}`);
    if (!probes.some((p) => p.siri)) throw new Error(`nothing answered as SIRI (set UTA_SIRI to the host UTA names)\n  ${lines.join("\n  ")}`);
    return lines;
  }),
  await check("Utah Avalanche Center", process.env.UAC_TOKEN, async () => {
    const u = new Uac();
    const r = await u.poll();
    return [r ? `danger ${DANGER[r.danger]} (rose ${r.rose.join(",")}), issued ${r.issued}: ${r.bottomLine.slice(0, 160)}` : "answered, but no overall_danger_rose in it"];
  }),
  await check("EIA", process.env.EIA_KEY ?? "DEMO_KEY", async () => {
    const g = await fetchGrid();
    if (!g) return ["no rows"];
    const out = [`PacifiCorp East ${g.mw} MW at ${new Date(g.hour).toISOString()}, usual ${g.usual}: ${g.energy}${process.env.EIA_KEY ? "" : " (the shared demo key)"}`];
    out.push(g.forecast ? `day-ahead forecast for that hour ${g.forecast.mw} MW (demand ${g.forecast.ratio} of it)` : "no day-ahead forecast for that hour");
    out.push(g.peak ? `forecast peak ${g.peak.mw} MW at ${new Date(g.peak.hour).toISOString()}` : "no forecast ahead");
    const m = await fetchMix();
    if (m) {
      const shares = Object.entries(m.share)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
        .join(", ");
      out.push(`made from, in the day to ${new Date(m.hour).toISOString()}: ${shares} (${m.dayMwh.toLocaleString("en-US")} MWh)`);
    } else out.push("no generation by source");
    return out;
  }),
];
process.exit(results.every(Boolean) ? 0 : 1);
