import { describe, expect, test } from "vitest";
import { parseGpx, soloFromRun, type TrackPoint } from "./run.ts";

/** A run down Snowbird's face: zig-zags every 120 m, 500 m of drop in 8 minutes. */
function skiRun(zigs = 12): TrackPoint[] {
  const pts: TrackPoint[] = [];
  const t0 = Date.parse("2026-12-20T17:00:00Z");
  let lat = 40.565;
  let lon = -111.657;
  const n = zigs * 20;
  for (let i = 0; i <= n; i++) {
    const dir = Math.floor(i / 20) % 2 === 0 ? 1 : -1;
    lat -= 0.00004; // downhill, north to south
    lon += dir * 0.00005; // across the fall line and back
    pts.push({ lat, lon, ele: 3000 - (500 * i) / n, t: t0 + (480_000 * i) / n });
  }
  return pts;
}

describe("a run becomes a solo", () => {
  test("every turn is a note, and the notes come down the mountain", () => {
    const { run, notes } = soloFromRun(skiRun());
    expect(run.turns).toBeGreaterThanOrEqual(10);
    expect(run.turns).toBeLessThanOrEqual(13);
    expect(run.dropM).toBeCloseTo(500, -1);
    expect(notes.length).toBeGreaterThan(run.turns);
    expect(notes[0]!.degree).toBeGreaterThan(notes.at(-1)!.degree);
    expect(notes[0]!.degree).toBe(11);
  });

  test("a turn lasts about two beats", () => {
    const { notes } = soloFromRun(skiRun());
    const span = notes.at(-1)!.beat - notes[0]!.beat;
    expect(span / (notes.length - 1)).toBeGreaterThan(1.2);
    expect(span / (notes.length - 1)).toBeLessThan(3);
  });

  test("it fits in 32 bars, on eighth notes, legato", () => {
    const { notes } = soloFromRun(skiRun(40));
    for (let k = 0; k < notes.length; k++) {
      const n = notes[k]!;
      expect(n.beat * 2).toBe(Math.round(n.beat * 2));
      expect(n.beat).toBeLessThanOrEqual(160);
      expect(n.vel).toBeGreaterThanOrEqual(0.3);
      expect(n.vel).toBeLessThanOrEqual(0.95);
      if (k > 0) expect(n.beat).toBeGreaterThan(notes[k - 1]!.beat);
      const next = notes[k + 1];
      if (next) expect(n.beats).toBe(Math.min(2, Math.max(0.5, next.beat - n.beat)));
    }
  });

  test("a track with no times still plays, by distance", () => {
    const pts = skiRun().map((p) => ({ ...p, t: Number.NaN }));
    const { run, notes } = soloFromRun(pts);
    expect(Number.isNaN(run.durationS)).toBe(true);
    expect(notes.length).toBeGreaterThan(5);
  });

  test("too short is an error, not noise", () => {
    expect(() => soloFromRun(skiRun().slice(0, 2))).toThrow();
  });
});

describe("GPX", () => {
  test("track points with elevation and time, namespaces and all", () => {
    const xml = `<?xml version="1.0"?>
      <gpx version="1.1" creator="Slopes" xmlns="http://www.topografix.com/GPX/1/1">
        <trk><name>Regulator Johnson &amp; back</name><trkseg>
          <trkpt lat="40.5650" lon="-111.6570"><ele>3000.5</ele><time>2026-12-20T17:00:00Z</time></trkpt>
          <trkpt lon='-111.6571' lat='40.5649'><ele>2999</ele><time>2026-12-20T17:00:02Z</time><extensions><gpxtpx:speed>9</gpxtpx:speed></extensions></trkpt>
          <trkpt lat="40.5648" lon="-111.6572"/>
        </trkseg></trk></gpx>`;
    const { name, points } = parseGpx(xml);
    expect(name).toBe("Regulator Johnson & back");
    expect(points).toHaveLength(3);
    expect(points[0]).toEqual({ lat: 40.565, lon: -111.657, ele: 3000.5, t: Date.parse("2026-12-20T17:00:00Z") });
    expect(points[1]!.lon).toBe(-111.6571);
    expect(Number.isNaN(points[2]!.ele)).toBe(true);
  });

  test("not GPX", () => {
    expect(() => parseGpx("<kml></kml>")).toThrow("isn't GPX");
  });
});
