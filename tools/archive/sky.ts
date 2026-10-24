// Seal each finished service day's sky into schedule/sky-<date>.json, by
// the same slot rules the phones use (web/src/data/feeds.ts), and carry
// forward the skies the deployed site already has. Run after the schedule
// compiler, which carries the manifest's list of them.
//
//   node tools/archive/sky.ts [--out web/public/schedule] [--previous <dir|url>]
//
// NWS keeps about a week of observations, so a day is sealed from the first
// build after it ends, and rewritten while it's still inside that week (to
// fill any report that was late the first time).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSkyRaw, obsFromMetar, skyFrom, type Metar } from "../../web/src/data/feeds.ts";
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
    if (reports.length >= 24) raw.obs = reports.sort((a, b) => b.t - a.t);
    const { value } = skyFrom(raw, t0 + AFTER);
    const hours = dayHours(value.hours, t0);
    const observed = hours.filter((h) => Number.isFinite(h.cloud)).length;
    // A day is worth keeping when most of its hours were observed.
    if (observed < 20) continue;
    const file = `sky-${date}.json`;
    const body: SkyFile = { version: 1, date, sealed: new Date(now).toISOString(), hours };
    writeFileSync(join(out, file), JSON.stringify(body));
    sky[date] = file;
    sealed++;
  }

  manifest.sky = Object.fromEntries(Object.entries(sky).sort());
  writeFileSync(manifestPath, JSON.stringify(manifest));
  console.log(`sky archive: ${sealed} days sealed, ${carried} carried over, ${Object.keys(sky).length} in all`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
