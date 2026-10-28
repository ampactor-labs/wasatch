// Seal each finished service day's sky into schedule/sky-<date>.json, by
// the same slot rules the phones use (web/src/data/feeds.ts), and carry
// forward the skies the deployed site already has. Run after the schedule
// compiler, which carries the manifest's list of them.
//
//   node tools/archive/sky.ts [--out web/public/schedule] [--previous <dir|url>]
//
// NWS keeps about a week of observations, so a day is sealed from the first
// build after it ends, and rewritten while it's still inside that week (to
// fill any report that was late the first time). An older day that has no
// sky (one the schedule's archive rebuilt, or one no build could reach) is
// sealed from KSLC's METARs in the Iowa Environmental Mesonet's archive
// and the models' last 92 days.
//
// What only the conductor knows of an hour (the fleet's flow, the snow
// forecast it froze, and with its keys the wind measured up the canyons and
// the PM2.5 at the monitors: the valley's, downtown's and the lake's) comes
// from its /slots.json, exactly as served;
// a day sealed while the conductor can't be reached goes without, and the
// phones take those from the live sky instead.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSkyModels, fetchSkyRaw, obsFromMetar, skyFrom, type Metar } from "../../web/src/data/feeds.ts";
import { fetchIemMetars } from "./iem.ts";
import type { SkyHour } from "../../web/src/engine/protocol.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HOUR = 3_600_000;
/** A service day's sky: from 4 hours before its start (the plan looks back
 * three) to 30 hours after. */
const BEFORE = 4 * HOUR;
const AFTER = 30 * HOUR;
const RESEAL_DAYS = 6;

interface Manifest {
  days: Record<string, string>;
  t0: Record<string, number>;
  sky?: Record<string, string>;
}

export interface SkyFile {
  version: 1;
  date: string;
  /** When it was sealed. */
  sealed: string;
  /** Where its observations came from: "awc" or "nws" in its week, "iem" after. */
  from?: "awc" | "nws" | "iem";
  hours: SkyHour[];
}

/** The hours that belong to a service day starting at `t0`. */
export function dayHours(hours: SkyHour[], t0: number): SkyHour[] {
  return hours.filter((h) => h.at >= t0 - BEFORE && h.at < t0 + AFTER);
}

async function previousFile(src: string, name: string): Promise<string | null> {
  try {
    if (/^https?:/.test(src)) {
      const res = await fetch(`${src.replace(/\/$/, "")}/${name}`, { cache: "no-store" });
      return res.ok ? await res.text() : null;
    }
    const path = join(src, name);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

/** The conductor's frozen hours since `from`, by hour; empty if it can't be
 * reached. */
async function conductorSlots(from: number): Promise<Map<number, Partial<Pick<SkyHour, "flow" | "stormMm" | "ridgeMs" | "ridgeGustMs" | "pm25" | "pm25Downtown" | "pm25Lake">>>> {
  try {
    const config = JSON.parse(readFileSync(join(REPO, "web/public/config.json"), "utf8")) as { conductor?: string | null };
    if (!config.conductor) return new Map();
    const res = await fetch(`${config.conductor.replace(/\/$/, "")}/slots.json?from=${from}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return new Map();
    const body = (await res.json()) as Record<string, { flow?: number; stormMm?: number; ridgeMs?: number; ridgeGustMs?: number; pm25?: number; pm25Downtown?: number; pm25Lake?: number }>;
    return new Map(Object.entries(body).map(([at, v]) => [Number(at), v]));
  } catch {
    return new Map();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const out = resolve(flag("--out") ?? join(REPO, "web/public/schedule"));
  const previous = flag("--previous") ?? null;
  const manifestPath = join(out, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
  // Start from what this build already has and what the previous one sealed.
  const prevText = previous ? await previousFile(previous, "manifest.json") : null;
  const prevSky = prevText ? ((JSON.parse(prevText) as Manifest).sky ?? {}) : {};
  const sky: Record<string, string> = { ...prevSky, ...(manifest.sky ?? {}) };
  const now = Date.now();

  // Carry forward what the deployed site sealed before.
  let carried = 0;
  for (const [date, file] of Object.entries(sky)) {
    if (!(date in manifest.days)) {
      delete sky[date];
      continue;
    }
    if (existsSync(join(out, file))) continue;
    const body = previous ? await previousFile(previous, file) : null;
    // The archive's sky didn't download: fail, rather than deploy a manifest
    // without it, which the next build would take as final.
    if (!body) throw new Error(`couldn't carry ${date}'s sky forward: ${file} didn't download`);
    writeFileSync(join(out, file), body);
    carried++;
  }

  // KSLC's METARs, hourly and complete (NWS's own feed has gaps); the data
  // API keeps about two weeks, and CI can read it where a browser can't.
  const metars = await fetch("https://aviationweather.gov/api/data/metar?ids=KSLC&format=json&hours=168", {
    headers: { "User-Agent": "wasatch-symphony (github.com/ampactor-labs/wasatch)" },
  })
    .then((res) => (res.ok ? (res.json() as Promise<Metar[]>) : []))
    .catch(() => [] as Metar[]);
  console.log(`METARs: ${metars.length}`);
  const frozen = await conductorSlots(now - (RESEAL_DAYS + 2) * 86_400_000);
  console.log(`the conductor's frozen hours: ${frozen.size}`);

  // Seal the days that have ended and are still inside the observations' week.
  let sealed = 0;
  for (const [date, t0] of Object.entries(manifest.t0)) {
    const ended = t0 + AFTER <= now;
    const recent = now - (t0 + AFTER) < RESEAL_DAYS * 86_400_000;
    if (!ended || !recent) continue;
    // KSLC reports every five minutes: a day's 34 hours are about 400 reports.
    // A day that can't be read today is sealed by a later build in the week.
    const raw = await fetchSkyRaw(t0 - BEFORE, t0 + AFTER, 7).catch((err: unknown) => {
      console.warn(`sky ${date}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    if (!raw) continue;
    // Prefer the METARs where they cover the day.
    const reports = metars.map(obsFromMetar).filter((o) => o.t >= t0 - BEFORE && o.t < t0 + AFTER);
    const awc = reports.length >= 24;
    if (awc) raw.obs = reports.sort((a, b) => b.t - a.t);
    if (seal(date, t0, raw, awc ? "awc" : "nws")) sealed++;
  }

  // The older days without a sky, from the archives.
  const missing = Object.entries(manifest.t0)
    .filter(([date, t0]) => !(date in sky) && t0 + AFTER <= now)
    .sort((a, b) => a[1] - b[1]);
  let backfilled = 0;
  if (missing.length) {
    const from = missing[0]![1] - BEFORE;
    const to = missing.at(-1)![1] + AFTER;
    const [iem, models] = await Promise.all([
      fetchIemMetars(from, to).catch((err: unknown) => {
        console.warn(`IEM: ${err instanceof Error ? err.message : String(err)}`);
        return [] as Metar[];
      }),
      fetchSkyModels((now - from) / 86_400_000 + 1),
    ]);
    console.log(`backfill: ${missing.length} days without a sky, ${iem.length} archived METARs`);
    const obs = iem.map(obsFromMetar).sort((a, b) => b.t - a.t);
    for (const [date, t0] of missing) {
      const raw = { obs: obs.filter((o) => o.t >= t0 - BEFORE && o.t < t0 + AFTER), latest: null, alerts: { features: [] }, ...models };
      if (seal(date, t0, raw, "iem")) backfilled++;
    }
  }

  /** Seal a day's sky if most of its hours were observed. */
  function seal(date: string, t0: number, raw: Parameters<typeof skyFrom>[0], from: SkyFile["from"]): boolean {
    const { value } = skyFrom(raw, t0 + AFTER);
    const hours = dayHours(value.hours, t0).map((h) => ({ ...h, ...frozen.get(h.at) }));
    const observed = hours.filter((h) => Number.isFinite(h.cloud)).length;
    if (observed < 20) return false;
    const file = `sky-${date}.json`;
    const body: SkyFile = { version: 1, date, sealed: new Date(now).toISOString(), from, hours };
    writeFileSync(join(out, file), JSON.stringify(body));
    sky[date] = file;
    return true;
  }

  manifest.sky = Object.fromEntries(Object.entries(sky).sort());
  writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log(`sky archive: ${sealed} days sealed, ${backfilled} from the archives, ${carried} carried over, ${Object.keys(sky).length} in all`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
