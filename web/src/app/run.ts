// Add your run: a GPX track from any tracker becomes a solo over the live
// valley. The vertical drop is the melodic descent, every turn is a note,
// speed is how hard it's played. The file is read here and never leaves the
// device.

import type { SoloNote } from "../engine/protocol.ts";

export interface TrackPoint {
  lat: number;
  lon: number;
  /** Meters. */
  ele: number;
  /** UTC ms, NaN when the file has no times. */
  t: number;
}

export interface Run {
  points: TrackPoint[];
  /** Total descent, meters. */
  dropM: number;
  /** Total distance, meters. */
  distanceM: number;
  /** Turns found. */
  turns: number;
  /** Seconds, or NaN. */
  durationS: number;
  name: string;
}

/** The points of every track (or route) in a GPX document. */
export function parseGpx(xml: string): { name: string; points: TrackPoint[] } {
  if (!/<gpx[\s>]/i.test(xml)) throw new Error("That file isn't GPX.");
  const points: TrackPoint[] = [];
  const pt = /<(trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  const attr = (attrs: string, name: string) => Number(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(attrs)?.[1]);
  const child = (body: string, name: string) => new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]*?)\\s*</(?:\\w+:)?${name}>`, "i").exec(body)?.[1];
  for (const m of xml.matchAll(pt)) {
    const attrs = m[2] ?? "";
    const body = m[3] ?? "";
    const lat = attr(attrs, "lat");
    const lon = attr(attrs, "lon");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ele = child(body, "ele");
    const time = child(body, "time");
    points.push({ lat, lon, ele: ele === undefined ? Number.NaN : Number(ele), t: time ? Date.parse(time) : Number.NaN });
  }
  const name = (/<name>\s*([^<]*?)\s*<\/name>/i.exec(xml)?.[1] ?? "").replace(/&amp;/g, "&");
  return { name, points };
}

const R = 6_371_000;
function dist(a: TrackPoint, b: TrackPoint): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearing(a: TrackPoint, b: TrackPoint): number {
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * 180) / Math.PI;
}
const turnOf = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/**
 * The solo: one note per turn (a change of heading past 25° over about
 * 15 m, counted once per bend), and one at least every 40 m of drop, pitched by elevation (the top
 * of the run highest), timed by the run's own clock squeezed to about two
 * beats a note (at most 32 bars), quantized to eighth notes.
 */
export function soloFromRun(points: TrackPoint[], name = ""): { run: Run; notes: SoloNote[] } {
  // Thin to points at least 5 m apart, so GPS jitter isn't a turn.
  const pts: TrackPoint[] = [];
  for (const p of points) {
    const last = pts.at(-1);
    if (!last || dist(last, p) >= 5) pts.push(p);
  }
  if (pts.length < 3) throw new Error("That track is too short to play.");
  const hasEle = pts.every((p) => Number.isFinite(p.ele));
  const hasTime = pts.every((p) => Number.isFinite(p.t)) && pts.at(-1)!.t > pts[0]!.t;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + dist(pts[i - 1]!, pts[i]!));
  const total = cum.at(-1)!;

  // Events: turns and steps of drop.
  const events: { i: number; strength: number }[] = [{ i: 0, strength: 1 }];
  let lastHeading = Number.NaN;
  let lastNoteEle = pts[0]!.ele;
  let dropM = 0;
  let turns = 0;
  // After a note, the rest of the same bend is absorbed for 30 m.
  let settleUntil = -Infinity;
  for (let i = 1; i < pts.length; i++) {
    const de = pts[i - 1]!.ele - pts[i]!.ele;
    if (hasEle && de > 0) dropM += de;
    // Heading over ~15 m.
    let j = i;
    while (j > 0 && cum[i]! - cum[j]! < 15) j--;
    if (cum[i]! - cum[j]! < 10) continue;
    const h = bearing(pts[j]!, pts[i]!);
    if (Number.isNaN(lastHeading)) {
      lastHeading = h;
      continue;
    }
    if (cum[i]! < settleUntil) {
      lastHeading = h;
      continue;
    }
    const turn = Math.abs(turnOf(lastHeading, h));
    const dropped = hasEle ? lastNoteEle - pts[i]!.ele : 0;
    if (turn > 25 || dropped > 40) {
      events.push({ i, strength: Math.min(1, turn / 90) });
      if (turn > 25) turns++;
      lastHeading = h;
      lastNoteEle = pts[i]!.ele;
      settleUntil = cum[i]! + 30;
    }
  }

  // Pitch: elevation onto two octaves of the scale, the top highest.
  const eles = pts.map((p) => p.ele);
  const top = hasEle ? Math.max(...eles) : 1;
  const bottom = hasEle ? Math.min(...eles) : 0;
  const degreeAt = (i: number) => {
    if (!hasEle || top - bottom < 5) return Math.round(7 - (14 * cum[i]!) / Math.max(1, total));
    return Math.round(-3 + (14 * (pts[i]!.ele - bottom)) / (top - bottom));
  };

  // Time: the run's own clock (or distance, without times), squeezed so a
  // turn lasts about two beats: a solo that moves, sized by its notes, never
  // longer than 32 bars.
  const at = (i: number) => (hasTime ? (pts[i]!.t - pts[0]!.t) / 1000 : cum[i]! / 6);
  const span = Math.max(1e-6, at(pts.length - 1));
  const beatsReal = (span * 96) / 60;
  const target = Math.max(16, Math.min(128, events.length * 2));
  const squeeze = Math.min(1, target / beatsReal);
  const beatOf = (i: number) => Math.round(((at(i) * 96) / 60) * squeeze * 2) / 2;
  const speedAt = (i: number) => {
    if (!hasTime || i === 0) return 0.5;
    const k = Math.max(0, i - 3);
    const dt = (pts[i]!.t - pts[k]!.t) / 1000;
    return dt > 0 ? (cum[i]! - cum[k]!) / dt : 0;
  };

  const notes: SoloNote[] = [];
  let lastBeat = -1;
  for (const e of events) {
    const beat = Math.max(beatOf(e.i), lastBeat + 0.5);
    if (beat > 160) break;
    const speed = speedAt(e.i);
    notes.push({
      beat,
      degree: degreeAt(e.i),
      vel: Math.max(0.3, Math.min(0.95, 0.4 + speed / 30 + 0.2 * e.strength)),
      beats: 1,
    });
    lastBeat = beat;
  }
  // Legato: each note lasts until the next, up to two beats.
  for (let k = 0; k < notes.length; k++) {
    const next = notes[k + 1];
    notes[k]!.beats = next ? Math.min(2, Math.max(0.5, next.beat - notes[k]!.beat)) : 2;
  }
  return {
    run: {
      points: pts,
      dropM,
      distanceM: total,
      turns,
      durationS: hasTime ? (pts.at(-1)!.t - pts[0]!.t) / 1000 : Number.NaN,
      name,
    },
    notes,
  };
}
