// Sky gradients for the five dayparts of DESIGN.md (Tuning, meter, tempo).
import { HAZE, NIGHT } from "./palette.ts";
import { mix } from "./util.ts";

export type Daypart = "nocturne" | "first-light" | "work" | "rush" | "last-trains";

export const DAYPARTS: readonly Daypart[] = ["nocturne", "first-light", "work", "rush", "last-trains"];

/** The daypart for a local hour (0–24): 0–5, 5–8, 8–16, 16–19, 19–24. */
export function daypartAt(hour: number): Daypart {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return "nocturne";
  if (h < 8) return "first-light";
  if (h < 16) return "work";
  if (h < 19) return "rush";
  return "last-trains";
}

/** Top-to-bottom stops for a clear sky in each daypart. */
const STOPS: Record<Daypart, readonly string[]> = {
  nocturne: [NIGHT, "#18204A", "#2A3570"],
  "first-light": ["#2B3A7A", "#C56FB0", "#FFB38A", "#FFE1B0"],
  work: ["#1E5AA8", "#4FA3D9", "#A9DBF5", "#E3F4FB"],
  rush: ["#33438F", "#C0628F", "#FF8C61", "#FFD06A"],
  "last-trains": ["#11163A", "#3D2F78", "#8C4A8E", "#D06A84"],
};

const OVERCAST = "#9AA3B5";

/**
 * A CSS `background` value for the sky.
 * `cloud` (0–1) grays the whole sky; `haze` (0–1) browns the lower sky and,
 * past a little haze, draws the inversion's lid as a flat line part-way up.
 */
export function skyGradient(daypart: Daypart, opts: { cloud?: number; haze?: number } = {}): string {
  const cloud = Math.max(0, Math.min(1, opts.cloud ?? 0));
  const haze = Math.max(0, Math.min(1, opts.haze ?? 0));
  const base = STOPS[daypart];
  const last = base.length - 1;
  const dark = daypart === "nocturne" || daypart === "last-trains";
  const stops = base.map((c, i) => {
    const grayed = mix(c, dark ? "#3A4060" : OVERCAST, cloud * 0.6);
    const low = i / last; // 0 top, 1 horizon
    return mix(grayed, dark ? "#6B5E52" : HAZE, haze * (0.15 + 0.7 * low * low));
  });
  const positions = stops.map((_, i) => (i / last) * 100);
  const colorAt = (pos: number): string => {
    for (let i = 0; i < last; i++) {
      const a = positions[i] ?? 0;
      const b = positions[i + 1] ?? 100;
      if (pos <= b) return mix(stops[i] ?? HAZE, stops[i + 1] ?? HAZE, (pos - a) / (b - a || 1));
    }
    return stops[last] ?? HAZE;
  };
  const parts: string[] = [];
  const add = (color: string, pos: number) => parts.push(`${color} ${Math.round(pos)}%`);
  if (haze <= 0.2) {
    stops.forEach((c, i) => add(c, positions[i] ?? 0));
  } else {
    // The lid: a flat, slightly darker band where the warm air sits.
    const lidAt = 64 - haze * 10;
    const lid = mix(colorAt(lidAt), dark ? "#4B4038" : "#A8957A", 0.35 + haze * 0.3);
    stops.forEach((c, i) => {
      const p = positions[i] ?? 0;
      if (p < lidAt - 1) add(c, p);
    });
    add(colorAt(lidAt - 1), lidAt - 1);
    add(lid, lidAt);
    add(mix(lid, HAZE, 0.5), lidAt + 8);
    stops.forEach((c, i) => {
      const p = positions[i] ?? 0;
      if (p > lidAt + 8) add(mix(c, HAZE, 0.3), p);
    });
  }
  return `linear-gradient(180deg, ${parts.join(", ")})`;
}
