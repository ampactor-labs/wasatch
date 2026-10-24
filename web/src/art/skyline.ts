// The skyline: the real Wasatch crest (USGS 3DEP, research/skyline) drawn as a
// bold silhouette, north (left) to south (right), with snowcaps, halftone
// shading, pennants on the 13 theme summits, and haze that softens detail.
import { CREST_ELEV_FT, THEME_SUMMITS } from "./crest-data.ts";
import {
  GRANITE,
  HAZE,
  INK,
  PINK,
  POWDER,
  ROCK,
  ROCK_NIGHT,
  SKY,
  SNOW_SHADE,
  SUNSET,
  WHITE,
  stepColor,
} from "./palette.ts";
import type { Daypart } from "./sky.ts";
import { esc, hash01, linePath, mix, n, type Pt, svg, uid } from "./util.ts";

export interface SkylineSummit {
  /** Index into elevFt. */
  i: number;
  name: string;
  /** The theme's scale step, 0–9. */
  step: number;
}

export interface SkylineData {
  /** Crest elevation in feet, north to south. */
  elevFt: readonly number[];
  summits: readonly SkylineSummit[];
}

export interface SkylineOpts {
  width: number;
  height: number;
  /** 0 clean air … 1 thick inversion haze. */
  haze?: number;
  /** Snow sits above this elevation. Default 9,600 ft. */
  snowLineFt?: number;
  daypart?: Daypart;
  /** Pennants on the theme summits (default true). */
  flags?: boolean;
  /** Summit names above the pennants (default false; wide layouts only). */
  labels?: boolean;
  /** Which summit is sounding now (index into summits), drawn raised and bright. */
  activeSummit?: number;
  title?: string;
}

export interface SkylinePoint {
  x: number;
  y: number;
  /** Slope of the ridge here, in degrees (SVG rotation; positive is clockwise). */
  angle: number;
}

export interface SkylineGeometry {
  width: number;
  height: number;
  /** The ridge, one point per profile sample. */
  points: readonly Pt[];
  /** x for a profile index. */
  x(i: number): number;
  /** y for an elevation in feet. */
  y(ft: number): number;
  /** A point on the ridge at t (0 north end … 1 south end), with its slope. */
  at(t: number): SkylinePoint;
  /** The ridge point of a theme summit (index into data.summits). */
  summit(k: number): SkylinePoint;
}

/** The measured crest and its 13 theme summits, as embedded in the build. */
export function defaultSkylineData(): SkylineData {
  return { elevFt: CREST_ELEV_FT, summits: THEME_SUMMITS };
}

/** The coordinate mapping the drawing uses; place a playhead with `at(t)`. */
export function skylineGeometry(data: SkylineData, opts: { width: number; height: number }): SkylineGeometry {
  const { width, height } = opts;
  const e = data.elevFt;
  const count = e.length;
  const minFt = Math.min(...e);
  const maxFt = Math.max(...e);
  const pad = width * 0.025;
  const top = height * 0.34;
  const bottom = height * 0.86;
  const x = (i: number) => pad + (i / Math.max(1, count - 1)) * (width - 2 * pad);
  const y = (ft: number) => bottom - ((ft - minFt) / Math.max(1, maxFt - minFt)) * (bottom - top);
  const points: Pt[] = e.map((ft, i) => [x(i), y(ft)] as const);
  const pointAt = (f: number): Pt => {
    const c = Math.max(0, Math.min(count - 1, f));
    const i0 = Math.min(count - 2, Math.floor(c));
    const a = points[i0] ?? [0, 0];
    const b = points[i0 + 1] ?? a;
    const k = c - i0;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  // The ridge is measured every 1.1 km, so its local slope is jagged; a rider
  // takes the slope over about five samples, and never past 26 degrees.
  const at = (t: number): SkylinePoint => {
    const f = Math.max(0, Math.min(1, t)) * (count - 1);
    const [px, py] = pointAt(f);
    const [ax, ay] = pointAt(f - 2.5);
    const [bx, by] = pointAt(f + 2.5);
    const raw = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
    return { x: px, y: py, angle: Math.max(-26, Math.min(26, raw)) };
  };
  const summit = (k: number): SkylinePoint => {
    const s = data.summits[k];
    if (!s) return at(0);
    return at(s.i / Math.max(1, count - 1));
  };
  return { width, height, points, x, y, at, summit };
}

function movingAverage(values: readonly number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    let sum = 0;
    let c = 0;
    for (let j = i - half; j <= i + half; j++) {
      const v = values[Math.max(0, Math.min(values.length - 1, j))];
      if (v !== undefined) {
        sum += v;
        c += 1;
      }
    }
    return sum / Math.max(1, c);
  });
}

/** The skyline as an SVG (viewBox 0 0 width height). Empty `.skyline-playhead` group on top. */
export function skyline(data: SkylineData, opts: SkylineOpts): string {
  const { width, height } = opts;
  const haze = Math.max(0, Math.min(1, opts.haze ?? 0));
  const snowLine = opts.snowLineFt ?? 9600;
  const daypart = opts.daypart ?? "work";
  const night = daypart === "nocturne" || daypart === "last-trains";
  const g = skylineGeometry(data, { width, height });
  const id = uid("sky");
  const unit = Math.max(0.6, Math.min(1.6, height / 160));
  const count = data.elevFt.length;
  const last = g.points[count - 1] ?? [width, height];
  const first = g.points[0] ?? [0, height];

  const rock = night ? ROCK_NIGHT : ROCK;
  const snowTint =
    daypart === "first-light"
      ? mix(POWDER, PINK, 0.22)
      : daypart === "rush"
        ? mix(POWDER, SUNSET, 0.16)
        : night
          ? SNOW_SHADE
          : WHITE;

  const outline: Pt[] = [[0, first[1]], ...g.points, [width, last[1]]];
  const silhouette = linePath([[0, height], ...outline, [width, height]], true);

  // A softer back range behind for depth.
  const back = movingAverage(data.elevFt, 9).map((ft, i): Pt => [
    g.x(i) + width * 0.012,
    g.y(ft) - height * 0.07,
  ]);
  const backPath = linePath([[0, height], [0, (back[0] ?? first)[1]], ...back, [width, (back[back.length - 1] ?? last)[1]], [width, height]], true);
  const backColor = night ? mix(ROCK_NIGHT, SKY, 0.18) : mix(GRANITE, SKY, 0.45);

  // Snowcaps: frosting with drips, wherever the ridge clears the snow line.
  const caps: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const topEdge = run.map((i): Pt => g.points[i] ?? [0, 0]);
      const lowEdge = [...run].reverse().map((i): Pt => {
        const p = g.points[i] ?? [0, 0];
        const ft = data.elevFt[i] ?? snowLine;
        const depth = Math.min(1, (ft - snowLine) / 1800) * 16 * unit + 3 * unit;
        const drip = hash01(i * 7 + 3) > 0.62 ? 7 * unit : hash01(i) * 3 * unit;
        return [p[0], Math.min(g.y(snowLine), p[1] + depth + drip)];
      });
      caps.push(linePath([...topEdge, ...lowEdge], true));
    }
    run = [];
  };
  data.elevFt.forEach((ft, i) => {
    if (ft >= snowLine) run.push(i);
    else flush();
  });
  flush();

  const defs = `<defs>
    <pattern id="${id}-dots" width="${n(6 * unit)}" height="${n(6 * unit)}" patternUnits="userSpaceOnUse">
      <circle cx="${n(1.5 * unit)}" cy="${n(1.5 * unit)}" r="${n(1.05 * unit)}" fill="${INK}"/>
      <circle cx="${n(4.5 * unit)}" cy="${n(4.5 * unit)}" r="${n(1.05 * unit)}" fill="${INK}"/>
    </pattern>
    <linearGradient id="${id}-fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".55" stop-color="#fff" stop-opacity=".25"/>
      <stop offset="1" stop-color="#fff" stop-opacity="1"/>
    </linearGradient>
    <mask id="${id}-mask"><rect x="0" y="${n(height * 0.25)}" width="${n(width)}" height="${n(height * 0.75)}" fill="url(#${id}-fade)"/></mask>
    <linearGradient id="${id}-haze" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${HAZE}" stop-opacity="0"/><stop offset=".45" stop-color="${HAZE}" stop-opacity=".55"/>
      <stop offset="1" stop-color="${HAZE}" stop-opacity=".9"/>
    </linearGradient>
  </defs>`;

  const layers: string[] = [];
  layers.push(`<path class="skyline-back" d="${backPath}" fill="${backColor}" opacity="${night ? 0.8 : 0.7}"/>`);
  layers.push(`<path class="skyline-rock" d="${silhouette}" fill="${rock}"/>`);
  layers.push(`<path d="${silhouette}" fill="url(#${id}-dots)" mask="url(#${id}-mask)" opacity="${n(0.32 * (1 - haze * 0.7), 2)}"/>`);
  layers.push(
    `<g class="skyline-snow" fill="${snowTint}" stroke="${INK}" stroke-width="${n(2 * unit)}" stroke-linejoin="round" opacity="${n(1 - haze * 0.45, 2)}">${caps
      .map((d) => `<path d="${d}"/>`)
      .join("")}</g>`,
  );
  layers.push(
    `<path class="skyline-ridge" d="${linePath(outline)}" fill="none" stroke="${INK}" stroke-width="${n(3 * unit)}" stroke-linejoin="round" stroke-linecap="round"/>`,
  );

  if (haze > 0) {
    // Haze softens detail: a smoothed range laid over the sharp one, then the lid.
    const soft = movingAverage(data.elevFt, 15).map((ft, i): Pt => [g.x(i), g.y(ft) + 2 * unit]);
    const softPath = linePath([[0, height], [0, (soft[0] ?? first)[1]], ...soft, [width, (soft[soft.length - 1] ?? last)[1]], [width, height]], true);
    layers.push(`<path class="skyline-haze" d="${softPath}" fill="${mix(rock, HAZE, 0.65)}" opacity="${n(haze * 0.8, 2)}"/>`);
    layers.push(`<rect class="skyline-lid" x="0" y="${n(height * 0.45)}" width="${n(width)}" height="${n(height * 0.55)}" fill="url(#${id}-haze)" opacity="${n(haze, 2)}"/>`);
  }

  if (opts.flags ?? true) {
    const flagH = 15 * unit;
    const fontSize = 9 * unit;
    const lineH = fontSize + 3.5 * unit;
    // Each label starts just above its pennant and climbs a line at a time
    // until it clears every label already placed.
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const flags = data.summits.map((s, k) => {
      const p = g.summit(k);
      const active = opts.activeSummit === k;
      const h = active ? flagH * 1.35 : flagH;
      const w = h * 0.78;
      const baseY = p.y - 1.5 * unit;
      const color = stepColor(s.step);
      let label = "";
      if (opts.labels) {
        const name = s.name.replace(/^Mount /, "Mt. ");
        const half = (name.length * fontSize * 0.6) / 2 + 3 * unit;
        const lx = Math.max(half, Math.min(width - half, p.x));
        const natural = baseY - h - 5 * unit;
        let ly = natural;
        const hits = (y: number) =>
          placed.some((r) => lx - half < r.x1 && lx + half > r.x0 && y - fontSize < r.y1 && y + 2 * unit > r.y0);
        for (let tries = 0; tries < 8 && hits(ly) && ly - lineH > fontSize; tries++) ly -= lineH;
        placed.push({ x0: lx - half, x1: lx + half, y0: ly - fontSize, y1: ly + 2 * unit });
        const leader =
          ly < natural - 1
            ? `<path d="M${n(p.x)} ${n(baseY - h - 1 * unit)} L${n(p.x)} ${n(ly + 1.5 * unit)}" stroke="${night ? POWDER : INK}" stroke-width="${n(0.9 * unit)}" stroke-dasharray="${n(1.5 * unit)} ${n(1.5 * unit)}" opacity=".7"/>`
            : "";
        label = `${leader}<text x="${n(lx)}" y="${n(ly)}" text-anchor="middle" font-family="'Space Mono', ui-monospace, monospace" font-weight="700" font-size="${n(fontSize)}" fill="${night ? POWDER : INK}" paint-order="stroke" stroke="${night ? INK : POWDER}" stroke-width="${n(2.4 * unit)}" stroke-linejoin="round">${esc(name)}</text>`;
      }
      return `<g class="skyline-flag${active ? " skyline-flag--active" : ""}" data-step="${s.step}"><title>${esc(s.name)} · step ${s.step}</title>
        <path d="M${n(p.x)} ${n(baseY)} L${n(p.x)} ${n(baseY - h)}" stroke="${INK}" stroke-width="${n(1.8 * unit)}" stroke-linecap="round"/>
        <path d="M${n(p.x)} ${n(baseY - h)} L${n(p.x + w)} ${n(baseY - h + h * 0.28)} L${n(p.x)} ${n(baseY - h + h * 0.56)} Z" fill="${color}" stroke="${INK}" stroke-width="${n(1.6 * unit)}" stroke-linejoin="round"/>
        ${label}</g>`;
    });
    layers.push(`<g class="skyline-flags">${flags.join("")}</g>`);
  }

  layers.push(`<g class="skyline-playhead"></g>`);
  return svg(`0 0 ${n(width)} ${n(height)}`, defs + layers.join(""), {
    cls: "skyline",
    ...(opts.title !== undefined ? { title: opts.title } : {}),
  });
}
