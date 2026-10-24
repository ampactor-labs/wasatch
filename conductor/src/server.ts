// The conductor: one process that reads the valley for every phone, so every
// phone hears exactly the same inputs.
//
//   PORT=8080 node conductor/src/server.ts
//
// It holds the one connection EarthScope allows us to the seismometers,
// infers TRAX and FrontRunner departures from UTA's realtime (which a
// browser can't read), watches GREENbike and the quake catalog, and seals
// all of it into 30-second windows at immutable URLs. It also serves the
// sky (from KSLC's METARs, complete where the NWS feed has gaps), the slow
// values, and an uncached clock.
//
//   GET /time            {"t": UTC ms}, never cached
//   GET /w/<start>.json  a sealed window (start a multiple of 30 000 ms)
//   GET /sky.json        the sky's hours, by the phones' slot rules
//   GET /slow.json       the lake, the river, the snow
//   GET /vehicles.json   every train where it is, and how many trains and buses are out
//   GET /health          what it's doing
//
// Environment: PORT (8080), SCHEDULE (where the compiled schedule is served,
// https://ampactor.dev/wasatch/schedule), DATA_DIR (keep sealed windows on
// disk across restarts; optional).

import { chownSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { decodeFeed } from "./gtfsrt.ts";
import { Transit } from "./transit.ts";
import { WINDOW_MS, Windows } from "./windows.ts";
import { BikeWatch, fetchLake, fetchQuakes, fetchRiver, fetchSkyRaw, fetchSnow, obsFromMetar, skyFrom, type Metar } from "../../web/src/data/feeds.ts";
import { GroundSource, STATIONS } from "../../web/src/data/ground.ts";

const PORT = Number(process.env.PORT ?? 8080);
const SCHEDULE = process.env.SCHEDULE ?? "https://ampactor.dev/wasatch/schedule";
const UTA = "https://apps.rideuta.com/tms/gtfs";
const UA = { "User-Agent": "wasatch-symphony conductor (github.com/ampactor-labs/wasatch)" };
const started = Date.now();

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Started as root (a container whose volume is mounted root-owned), hand
 * the data directory to the `node` user and drop root for good, before
 * anything is read from the network. */
function dropRoot(dir: string | null): void {
  if (process.getuid?.() !== 0) return;
  const entry = readFileSync("/etc/passwd", "utf8")
    .split("\n")
    .map((l) => l.split(":"))
    .find((f) => f[0] === "node");
  if (!entry) {
    log("running as root: there's no node user to become");
    return;
  }
  const [uid, gid] = [Number(entry[2]), Number(entry[3])];
  if (dir) {
    try {
      mkdirSync(join(dir, "w"), { recursive: true });
      for (const d of [dir, join(dir, "w")]) chownSync(d, uid, gid);
      for (const f of readdirSync(join(dir, "w"))) chownSync(join(dir, "w", f), uid, gid);
    } catch (err) {
      log("data directory:", err instanceof Error ? err.message : err);
    }
  }
  process.setgroups?.([gid]);
  process.setgid?.(gid);
  process.setuid?.(uid);
}

dropRoot(process.env.DATA_DIR ?? null);
const windows = new Windows(process.env.DATA_DIR ? `${process.env.DATA_DIR}/w` : null);
windows.onDiskError = (err) => log("windows: the disk failed, keeping them in memory:", err instanceof Error ? err.message : err);
const transit = new Transit(SCHEDULE);
const bikes = new BikeWatch();
const ground = new GroundSource("wasatch-symphony:conductor:0:node");
const seenQuakes = new Set<string>();
let sky: string | null = null;
let slow: string | null = null;
let vehicles: string | null = null;
let fleetStats: { t: number; trains: number; buses: number } | null = null;
const errors: Record<string, string> = {};
const every = (ms: number, name: string, f: () => Promise<void>) => {
  const run = () =>
    f().then(
      () => delete errors[name],
      (err: unknown) => {
        errors[name] = err instanceof Error ? err.message : String(err);
        log(`${name}:`, errors[name]);
      },
    );
  void run();
  setInterval(run, ms);
};

// Untracked trains keep their schedule; each window gets theirs as it seals.
windows.onSeal = (w) => {
  for (const row of transit.untracked(w.start, w.end)) w.rail.push(row);
};

every(60 * 60_000, "schedule", () => transit.load(Date.now()));
every(10_000, "transit", async () => {
  const res = await fetch(`${UTA}/TripUpdate`, { headers: UA });
  if (!res.ok) throw new Error(`TripUpdate ${res.status}`);
  transit.ingest(decodeFeed(new Uint8Array(await res.arrayBuffer())));
  const now = Date.now();
  for (const row of transit.drain()) windows.addRail(row, now);
});
every(15_000, "vehicles", async () => {
  const res = await fetch(`${UTA}/Vehicle`, { headers: UA });
  if (!res.ok) throw new Error(`Vehicle ${res.status}`);
  const fleet = transit.fleet(decodeFeed(new Uint8Array(await res.arrayBuffer())));
  vehicles = JSON.stringify(fleet);
  fleetStats = { t: fleet.t, ...fleet.counts };
});
every(30_000, "bikes", async () => {
  if (!(await bikes.poll())) return;
  const now = Date.now();
  for (const e of bikes.events) {
    if (e.ms < now - 120_000) continue;
    windows.addBike([e.ms, e.lat, e.lon, e.delta, e.station], now);
  }
  bikes.events.length = 0;
});
every(60_000, "quakes", async () => {
  const q = await fetchQuakes();
  if (!q) return;
  const now = Date.now();
  for (const e of q.value) {
    if (seenQuakes.has(e.id) || e.ms < now - 10 * 60_000) continue;
    seenQuakes.add(e.id);
    windows.addQuake([e.ms, e.originMs, e.mag, e.lat, e.lon, e.id, e.place], now);
  }
});
every(5 * 60_000, "sky", async () => {
  // KSLC's METARs: complete and hourly, which the browser can't read.
  const res = await fetch("https://aviationweather.gov/api/data/metar?ids=KSLC&format=json&hours=36", { headers: UA });
  const metars = res.ok ? ((await res.json()) as Metar[]) : [];
  const raw = await fetchSkyRaw(Date.now() - 34 * 3_600_000);
  if (metars.length >= 12) raw.obs = metars.map(obsFromMetar).sort((a, b) => b.t - a.t);
  sky = JSON.stringify({ ...skyFrom(raw), source: metars.length >= 12 ? "metar" : "nws" });
});
every(15 * 60_000, "slow", async () => {
  const [lake, river, snow] = await Promise.all([fetchLake(), fetchRiver(), fetchSnow()]);
  slow = JSON.stringify({ lake, river, snow });
});
ground.connect(Date.now() - 120_000).catch((err) => log("ground:", err));
setInterval(() => {
  const now = Date.now();
  STATIONS.forEach((s, band) => {
    const meta = { lat: s.lat, lon: s.lon, level: ground.level(band) };
    for (const p of ground.take(band, now)) windows.addGround(band, meta, p.t, p.i, p.q, now);
  });
  windows.seal(now);
}, 1000);

function send(res: ServerResponse, status: number, body: string, cache: string, type = "application/json"): void {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": cache,
    "Access-Control-Allow-Origin": "*",
    "Timing-Allow-Origin": "*",
  });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://conductor");
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET", "Access-Control-Max-Age": "86400" });
    res.end();
    return;
  }
  if (url.pathname === "/time") return send(res, 200, JSON.stringify({ t: Date.now() }), "no-store");
  const w = /^\/w\/(\d+)\.json$/.exec(url.pathname);
  if (w) {
    const start = Number(w[1]);
    if (start % WINDOW_MS !== 0) return send(res, 400, '{"error":"not a window"}', "no-store");
    const body = windows.body(start);
    // Sealed windows never change; one not sealed yet is asked for again.
    return body ? send(res, 200, body, "public, max-age=31536000, immutable") : send(res, 404, '{"error":"not sealed"}', "no-store");
  }
  if (url.pathname === "/sky.json") return sky ? send(res, 200, sky, "public, max-age=60") : send(res, 503, '{"error":"warming up"}', "no-store");
  if (url.pathname === "/slow.json") return slow ? send(res, 200, slow, "public, max-age=300") : send(res, 503, '{"error":"warming up"}', "no-store");
  if (url.pathname === "/vehicles.json") return vehicles ? send(res, 200, vehicles, "public, max-age=5") : send(res, 503, '{"error":"warming up"}', "no-store");
  if (url.pathname === "/health") {
    const body = {
      ok: true,
      // The commit it was built from, when Railway built it from GitHub.
      commit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      up_s: Math.round((Date.now() - started) / 1000),
      windows: { sealed: windows.sealedCount, latest: windows.latestSealed(), kept: windows.persistent ? "on disk" : "in memory" },
      transit: transit.stats,
      fleet: fleetStats && { ...fleetStats, age_s: Math.round((Date.now() - fleetStats.t) / 1000) },
      ground: STATIONS.map((s, b) => ({ station: s.code, level: Number(ground.level(b).toFixed(2)), fresh: ground.freshAt(b, Date.now() - 30_000) })),
      errors,
    };
    return send(res, 200, JSON.stringify(body), "no-store");
  }
  if (url.pathname === "/") return send(res, 200, "Wasatch Symphony's conductor. https://ampactor.dev/wasatch/\n", "public, max-age=3600", "text/plain; charset=utf-8");
  send(res, 404, '{"error":"no such thing"}', "no-store");
});

await bikes.init().catch((err) => log("bikes:", err));
server.listen(PORT, () =>
  log(`conductor on :${PORT} as uid ${process.getuid?.() ?? "?"}, schedule from ${SCHEDULE}, windows ${windows.persistent ? `kept in ${process.env.DATA_DIR}` : "in memory"} (${windows.sealedCount} restored)`),
);

// A container's PID 1 must stop on its own when told to (sealed windows are
// already on disk, if DATA_DIR is set).
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    log(`${signal}: stopping`);
    ground.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
