// The archive: a build with --previous keeps the network's indices and
// carries every earlier date forward with its day file. Run after the
// compiler has cached UTA's feed (tools/gtfs/.cache/GTFS.zip).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT = fileURLToPath(new URL("../../web/public/schedule/", import.meta.url));
const ZIP = join(HERE, ".cache", "GTFS.zip");

interface Network {
  routes: { id: string; name: string }[];
  stops: { id: string; ids: string[]; name: string; lat: number; lon: number }[];
  shapes: { r: number; d: number; pts: [number, number][] }[];
  headsigns: string[];
}

test("--previous keeps indices, keeps dropped routes, and carries old dates", () => {
  const prev = mkdtempSync(join(tmpdir(), "wasatch-prev-"));
  const out = mkdtempSync(join(tmpdir(), "wasatch-out-"));
  mkdirSync(out, { recursive: true });
  const current = JSON.parse(readFileSync(join(OUT, "network.json"), "utf8")) as Network;
  const manifest = JSON.parse(readFileSync(join(OUT, "manifest.json"), "utf8")) as { days: Record<string, string>; t0: Record<string, number> };

  // A previous build whose stations came in the opposite order, with a line
  // UTA has since dropped, and a January date in its archive.
  const reversed = [...current.stops].reverse();
  const ghost = { id: "ghost-1", short: "799", name: "Gondola Line", type: 0, kind: "trax", color: "#123456", text: "#FFFFFF" };
  const prevNet = {
    ...current,
    routes: [...current.routes, ghost],
    stops: reversed,
    shapes: [...current.shapes, { r: current.routes.length, d: 0, pts: [[40.6, -111.7], [40.59, -111.65]] }],
  };
  writeFileSync(join(prev, "network.json"), JSON.stringify(prevNet));
  const someKey = Object.values(manifest.days)[0]!;
  copyFileSync(join(OUT, `day-${someKey}.json`), join(prev, "day-0000000abc.json"));
  writeFileSync(
    join(prev, "manifest.json"),
    JSON.stringify({ days: { "2026-01-14": "0000000abc" }, t0: { "2026-01-14": Date.parse("2026-01-14T07:00:00Z") }, sky: { "2026-01-14": "sky-2026-01-14.json" } }),
  );

  execFileSync("node", [join(HERE, "compile.ts"), "--zip", ZIP, "--out", out, "--previous", prev], { stdio: "pipe" });
  const net = JSON.parse(readFileSync(join(out, "network.json"), "utf8")) as Network;
  const man = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as { days: Record<string, string>; t0: Record<string, number>; sky: Record<string, string> };

  // Every previous station is where it was.
  reversed.forEach((st, k) => assert.equal(net.stops[k]!.name, st.name, `station ${k}`));
  // The dropped line keeps its index and its shape.
  const g = net.routes.findIndex((r) => r.id === "ghost-1");
  assert.equal(g, current.routes.length);
  assert.ok(net.shapes.some((s) => s.r === g));
  // The January date came along with its file.
  assert.equal(man.days["2026-01-14"], "0000000abc");
  assert.equal(man.t0["2026-01-14"], Date.parse("2026-01-14T07:00:00Z"));
  assert.ok(readdirSync(out).includes("day-0000000abc.json"));
  // Skies are the sky tool's to carry.
  assert.deepEqual(man.sky, {});
  // Every date since the feed took effect is there, kept or rebuilt, and the
  // rebuilt ones say so.
  const src = (man as unknown as { source: { feedStart: string } }).source;
  const rebuilt = (man as unknown as { rebuilt: string[] }).rebuilt;
  const first = Object.keys(man.days).filter((d) => d !== "2026-01-14").sort()[0]!;
  assert.equal(first, src.feedStart);
  assert.ok(rebuilt.includes(src.feedStart));
  assert.ok(!rebuilt.includes("2026-01-14"));
  for (let d = Date.parse(`${src.feedStart}T12:00:00Z`); d < Date.parse(`${Object.keys(man.days).sort().at(-1)}T12:00:00Z`); d += 86_400_000) {
    assert.ok(new Date(d).toISOString().slice(0, 10) in man.days, new Date(d).toISOString().slice(0, 10));
  }
  // New days are keyed by the feed and the services, so they differ from the
  // old service-only keys.
  for (const [date, key] of Object.entries(man.days)) {
    if (date !== "2026-01-14") assert.ok(readdirSync(out).includes(`day-${key}.json`), date);
  }
});
