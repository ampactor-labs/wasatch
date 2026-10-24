// KSLC's METARs from the Iowa Environmental Mesonet's ASOS archive, for the
// days older than the week NWS keeps and the two weeks the Aviation Weather
// Center keeps: the same reports, kept for decades.
//
// https://mesonet.agron.iastate.edu/request/download.phtml

import type { Metar } from "../../web/src/data/feeds.ts";

const COLUMNS = ["tmpf", "sknt", "gust", "skyc1", "skyc2", "skyc3", "skyc4", "skyl1", "skyl2", "skyl3", "skyl4", "wxcodes", "p01i", "metar"];

/** The archive's CSV (station,valid,…,metar; times UTC; "null" for missing,
 * "T" for a trace) as the Aviation Weather Center's METAR objects. */
export function metarsFromIem(csv: string): Metar[] {
  const lines = csv.split("\n").filter((l) => l.trim());
  const head = lines.shift()?.split(",") ?? [];
  const col = (name: string) => head.indexOf(name);
  const at = Object.fromEntries(["valid", ...COLUMNS].map((c) => [c, col(c)])) as Record<string, number>;
  if (Object.values(at).some((i) => i < 0)) throw new Error(`IEM: unexpected columns ${head.join(",")}`);
  const out: Metar[] = [];
  for (const line of lines) {
    // The report is the last column and the only one that could hold a comma.
    const f = line.split(",");
    const cell = (name: string) => {
      const i = at[name]!;
      const v = name === "metar" ? f.slice(i).join(",") : f[i];
      return v === undefined || v === "null" || v === "" ? null : v;
    };
    const num = (name: string) => {
      const v = cell(name);
      if (v === null) return null;
      if (v === "T") return 0.0001;
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
    };
    const valid = cell("valid");
    const raw = cell("metar");
    if (!valid || !raw) continue;
    const t = Date.parse(`${valid.replace(" ", "T")}:00Z`);
    if (!Number.isFinite(t)) continue;
    const clouds: Metar["clouds"] = [];
    for (let k = 1; k <= 4; k++) {
      const cover = cell(`skyc${k}`);
      if (!cover) continue;
      const base = num(`skyl${k}`);
      clouds.push({ cover: cover.trim(), base: base === null ? null : Math.round(base) });
    }
    const tmpf = num("tmpf");
    out.push({
      obsTime: t / 1000,
      clouds,
      wxString: cell("wxcodes"),
      temp: tmpf === null ? null : Math.round(((tmpf - 32) * 5) / 9 * 10) / 10,
      wspd: num("sknt"),
      wgst: num("gust"),
      precip: num("p01i"),
      rawOb: raw.trim(),
    });
  }
  return out;
}

/** Every routine and special report KSLC made from `from` to `to` (UTC ms). */
export async function fetchIemMetars(from: number, to: number): Promise<Metar[]> {
  const a = new Date(from);
  const b = new Date(to + 86_400_000);
  const q = new URLSearchParams({
    station: "SLC",
    tz: "Etc/UTC",
    format: "onlycomma",
    latlon: "no",
    missing: "null",
    trace: "T",
    year1: String(a.getUTCFullYear()),
    month1: String(a.getUTCMonth() + 1),
    day1: String(a.getUTCDate()),
    year2: String(b.getUTCFullYear()),
    month2: String(b.getUTCMonth() + 1),
    day2: String(b.getUTCDate()),
  });
  for (const c of COLUMNS) q.append("data", c);
  q.append("report_type", "3");
  q.append("report_type", "4");
  const res = await fetch(`https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${q}`, {
    headers: { "User-Agent": "wasatch-symphony (github.com/ampactor-labs/wasatch)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`IEM ${res.status}`);
  return metarsFromIem(await res.text()).filter((m) => m.obsTime * 1000 >= from && m.obsTime * 1000 < to);
}
