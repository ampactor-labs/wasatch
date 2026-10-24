// A stylized trail map of the Salt Lake valley. The app draws GTFS lines and
// vehicles on top with `mapProjection`, into the empty `.map-routes`,
// `.map-vehicles` and `.map-events` groups.
import { CREST_LAT, CREST_LON, THEME_SUMMITS } from "./crest-data.ts";
import { iconAt } from "./icons.ts";
import {
  GRANITE,
  INK,
  LAKE,
  LAKE_DEEP,
  MUDFLAT,
  POWDER,
  SAND,
  SKY,
  SKY_DEEP,
  SUNSET,
  WHITE,
} from "./palette.ts";
import { esc, linePath, n, type Pt, smoothPath, svg, uid } from "./util.ts";

export interface MapBounds {
  n: number;
  s: number;
  e: number;
  w: number;
}

/** Ogden to Provo, the lake to the crest: a phone-portrait frame. */
export const DEFAULT_MAP_BOUNDS: MapBounds = { n: 41.26, s: 40.2, w: -112.42, e: -111.52 };

export interface MapProjection {
  /** [x, y] in the map's viewBox for a latitude and longitude. */
  project(lat: number, lon: number): [number, number];
  /** Pixels per degree of latitude. */
  scale: number;
  width: number;
  height: number;
}

/** The height that keeps the projection undistorted at a given width. */
export function mapHeightFor(bounds: MapBounds, width: number): number {
  const k = Math.cos((((bounds.n + bounds.s) / 2) * Math.PI) / 180);
  return Math.round((width * (bounds.n - bounds.s)) / ((bounds.e - bounds.w) * k));
}

/**
 * Equirectangular, corrected by the cosine of the middle latitude, fitted
 * inside width × height and centered.
 */
export function mapProjection(bounds: MapBounds, width: number, height: number): MapProjection {
  const k = Math.cos((((bounds.n + bounds.s) / 2) * Math.PI) / 180);
  const sx = width / ((bounds.e - bounds.w) * k);
  const sy = height / (bounds.n - bounds.s);
  const scale = Math.min(sx, sy);
  const ox = (width - (bounds.e - bounds.w) * k * scale) / 2;
  const oy = (height - (bounds.n - bounds.s) * scale) / 2;
  return {
    project: (lat, lon) => [ox + (lon - bounds.w) * k * scale, oy + (bounds.n - lat) * scale],
    scale,
    width,
    height,
  };
}

type LonLat = readonly [number, number];

// Stylized geography, [lon, lat]. Approximate on purpose: a trail map.
const HEALTHY_LAKE: LonLat[] = [
  [-112.6, 40.725], [-112.24, 40.73], [-112.1, 40.745], [-112.03, 40.8], [-111.985, 40.87], [-111.955, 40.94],
  [-111.985, 41.02], [-112.03, 41.09], [-112.07, 41.16], [-112.1, 41.23], [-112.12, 41.3], [-112.6, 41.3],
];
const LOW_LAKE: LonLat[] = [
  [-112.6, 40.74], [-112.24, 40.745], [-112.165, 40.765], [-112.125, 40.8], [-112.15, 40.842], [-112.195, 40.872],
  [-112.235, 40.92], [-112.3, 40.975], [-112.305, 41.07], [-112.275, 41.15], [-112.3, 41.225], [-112.36, 41.3], [-112.6, 41.3],
];
/** What's left of Farmington Bay, where the Jordan River runs out. */
const FARMINGTON_POOL: LonLat[] = [
  [-112.045, 40.895], [-111.99, 40.9], [-111.972, 40.928], [-111.99, 40.958], [-112.035, 40.952], [-112.058, 40.925],
];
const ANTELOPE_ISLAND: LonLat[] = [
  [-112.235, 41.105], [-112.205, 41.08], [-112.18, 41.04], [-112.168, 40.985], [-112.185, 40.93], [-112.205, 40.885],
  [-112.226, 40.868], [-112.242, 40.9], [-112.256, 40.95], [-112.276, 41.0], [-112.272, 41.06], [-112.256, 41.095],
];
const UTAH_LAKE: LonLat[] = [
  [-111.9, 40.362], [-111.84, 40.342], [-111.77, 40.308], [-111.715, 40.268], [-111.705, 40.15], [-111.96, 40.15],
  [-111.935, 40.27], [-111.905, 40.33],
];
const JORDAN_RIVER: LonLat[] = [
  [-111.9, 40.355], [-111.915, 40.42], [-111.922, 40.47], [-111.935, 40.52], [-111.926, 40.58], [-111.92, 40.64],
  [-111.926, 40.7], [-111.92, 40.75], [-111.932, 40.8], [-111.952, 40.845], [-111.975, 40.874], [-111.985, 40.903],
];
const OQUIRRHS: LonLat[] = [
  [-112.6, 40.74], [-112.155, 40.735], [-112.11, 40.665], [-112.068, 40.585], [-112.045, 40.5], [-112.035, 40.42],
  [-112.05, 40.33], [-112.085, 40.25], [-112.1, 40.15], [-112.6, 40.15],
];
const TRAVERSE: LonLat[] = [
  [-111.925, 40.47], [-111.865, 40.5], [-111.8, 40.512], [-111.755, 40.498], [-111.74, 40.452], [-111.8, 40.432], [-111.88, 40.44],
];
/** The base of the Wasatch front (the bench along the Wasatch Fault), north to south. */
const FRONT: LonLat[] = [
  [-111.955, 41.32], [-111.945, 41.22], [-111.9, 41.07], [-111.875, 40.98], [-111.85, 40.89], [-111.872, 40.79],
  [-111.83, 40.75], [-111.8, 40.71], [-111.798, 40.67], [-111.79, 40.62], [-111.8, 40.57], [-111.84, 40.52],
  [-111.77, 40.47], [-111.72, 40.44], [-111.67, 40.3], [-111.63, 40.24], [-111.58, 40.15],
];

export const CANYON_MOUTHS: readonly { name: string; lat: number; lon: number }[] = [
  { name: "City Creek", lat: 40.785, lon: -111.881 },
  { name: "Emigration", lat: 40.753, lon: -111.817 },
  { name: "Parleys", lat: 40.713, lon: -111.797 },
  { name: "Millcreek", lat: 40.69, lon: -111.797 },
  { name: "Big Cottonwood", lat: 40.619, lon: -111.786 },
  { name: "Little Cottonwood", lat: 40.572, lon: -111.793 },
];

const CITIES: readonly { name: string; lat: number; lon: number; star?: boolean }[] = [
  { name: "Ogden", lat: 41.223, lon: -111.974 },
  { name: "Salt Lake City", lat: 40.761, lon: -111.891, star: true },
  { name: "Provo", lat: 40.234, lon: -111.659 },
];

const AIRPORT = { lat: 40.788, lon: -111.978 };
const SPIRAL_JETTY = { lat: 41.4376, lon: -112.6691 };
const MOOSE_SPOT = { lat: 40.532, lon: -111.708 };

function movingMedian(values: readonly number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice: number[] = [];
    for (let j = i - half; j <= i + half; j++) {
      const v = values[Math.max(0, Math.min(values.length - 1, j))];
      if (v !== undefined) slice.push(v);
    }
    slice.sort((a, b) => a - b);
    return slice[Math.floor(slice.length / 2)] ?? 0;
  });
}

function spiral(cx: number, cy: number, r: number): string {
  const pts: Pt[] = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40;
    const a = t * Math.PI * 4.2;
    pts.push([cx + Math.cos(a) * r * t, cy + Math.sin(a) * r * t]);
  }
  return smoothPath(pts, false, 0.8);
}

export interface MapBaseOpts {
  bounds?: MapBounds;
  width?: number;
  height?: number;
  /** Labels for canyons and cities (default true). */
  labels?: boolean;
  title?: string;
}

/** The basemap SVG. Empty `.map-routes`, `.map-vehicles`, `.map-events` groups on top. */
/** The map's unit: 1 on a phone-sized map, growing with a big one so its
 * lines, labels and marks keep their weight; held back by the height, so a
 * short, wide window doesn't get giant labels. */
export function mapUnit(width: number, height: number): number {
  return Math.max(0.7, Math.min(2.2, width / 390, Math.max(1, height / 350)));
}

export function mapBase(opts: MapBaseOpts = {}): string {
  const bounds = opts.bounds ?? DEFAULT_MAP_BOUNDS;
  const width = opts.width ?? 390;
  const height = opts.height ?? mapHeightFor(bounds, width);
  const proj = mapProjection(bounds, width, height);
  const P = (ll: LonLat): Pt => proj.project(ll[1], ll[0]);
  const poly = (lls: readonly LonLat[]) => linePath(lls.map(P), true);
  const smoothPoly = (lls: readonly LonLat[]) => smoothPath(lls.map(P), true, 0.6);
  const id = uid("map");
  const u = mapUnit(width, height);
  const labels = opts.labels ?? true;

  // The crest, smoothed so it reads as a line, and the mountain band west of it.
  const crestLon = movingMedian(CREST_LON, 9);
  const crest: LonLat[] = CREST_LAT.map((lat, i) => [crestLon[i] ?? -111.7, lat] as const);
  const band: LonLat[] = [...FRONT, [bounds.e + 0.3, 40.15], [bounds.e + 0.3, 41.32]];

  const defs = `<defs>
    <clipPath id="${id}-frame"><rect x="0" y="0" width="${n(width)}" height="${n(height)}" rx="${n(14 * u)}"/></clipPath>
    <pattern id="${id}-hatch" width="${n(7.5 * u)}" height="${n(7.5 * u)}" patternUnits="userSpaceOnUse" patternTransform="rotate(40)">
      <rect width="${n(7.5 * u)}" height="${n(7.5 * u)}" fill="${POWDER}"/>
      <line x1="0" y1="0" x2="0" y2="${n(7.5 * u)}" stroke="${GRANITE}" stroke-width="${n(1.7 * u)}"/>
    </pattern>
    <pattern id="${id}-soft" width="${n(8 * u)}" height="${n(8 * u)}" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
      <rect width="${n(8 * u)}" height="${n(8 * u)}" fill="${SAND}"/>
      <line x1="0" y1="0" x2="0" y2="${n(8 * u)}" stroke="${GRANITE}" stroke-width="${n(1.1 * u)}" opacity=".55"/>
    </pattern>
    <pattern id="${id}-mud" width="${n(9 * u)}" height="${n(9 * u)}" patternUnits="userSpaceOnUse">
      <rect width="${n(9 * u)}" height="${n(9 * u)}" fill="${MUDFLAT}"/>
      <circle cx="${n(2 * u)}" cy="${n(2 * u)}" r="${n(0.9 * u)}" fill="${GRANITE}" opacity=".55"/>
      <circle cx="${n(6.5 * u)}" cy="${n(6.5 * u)}" r="${n(0.7 * u)}" fill="${GRANITE}" opacity=".45"/>
    </pattern>
    <pattern id="${id}-waves" width="${n(26 * u)}" height="${n(14 * u)}" patternUnits="userSpaceOnUse">
      <rect width="${n(26 * u)}" height="${n(14 * u)}" fill="${LAKE}"/>
      <path d="M${n(3 * u)} ${n(8 * u)} q${n(3 * u)} ${n(-3 * u)} ${n(6 * u)} 0 t${n(6 * u)} 0" stroke="${WHITE}" stroke-width="${n(1.4 * u)}" fill="none" stroke-linecap="round" opacity=".55"/>
    </pattern>
  </defs>`;

  const layers: string[] = [];
  layers.push(`<rect class="map-land" x="0" y="0" width="${n(width)}" height="${n(height)}" fill="${SAND}"/>`);

  // The lake: where a healthy lake would reach (mudflats now), then the low water.
  layers.push(`<path class="map-lake-healthy" d="${smoothPoly(HEALTHY_LAKE)}" fill="url(#${id}-mud)"/>`);
  layers.push(
    `<path d="${smoothPoly(HEALTHY_LAKE)}" fill="none" stroke="${LAKE_DEEP}" stroke-width="${n(1.6 * u)}" stroke-dasharray="${n(5 * u)} ${n(4 * u)}" opacity=".8"/>`,
  );
  layers.push(
    `<g class="map-lake" stroke="${INK}" stroke-width="${n(2.4 * u)}" stroke-linejoin="round">
      <path d="${smoothPoly(LOW_LAKE)}" fill="url(#${id}-waves)"/>
      <path d="${smoothPoly(FARMINGTON_POOL)}" fill="url(#${id}-waves)"/>
      <path d="${smoothPoly(UTAH_LAKE)}" fill="url(#${id}-waves)"/>
    </g>`,
  );
  layers.push(
    `<path class="map-island" d="${smoothPoly(ANTELOPE_ISLAND)}" fill="url(#${id}-soft)" stroke="${INK}" stroke-width="${n(2.2 * u)}" stroke-linejoin="round"/>`,
  );

  // The mountains: Oquirrhs and Traverse soft, the Wasatch hatched up to the crest.
  layers.push(
    `<g class="map-ranges" stroke="${INK}" stroke-width="${n(1.8 * u)}" stroke-linejoin="round">
      <path d="${smoothPoly(OQUIRRHS)}" fill="url(#${id}-soft)"/>
      <path d="${smoothPoly(TRAVERSE)}" fill="url(#${id}-soft)"/>
      <path class="map-wasatch" d="${poly(band)}" fill="url(#${id}-hatch)" stroke-width="${n(2.6 * u)}"/>
    </g>`,
  );
  layers.push(
    `<path class="map-crest" d="${smoothPath(crest.map(P), false, 0.5)}" fill="none" stroke="${INK}" stroke-width="${n(3 * u)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  );

  // Little peaks with snowcaps at the theme summits on the map.
  const peakMarks = THEME_SUMMITS.map((s) => {
    const lat = CREST_LAT[s.i];
    const lon = crestLon[s.i];
    if (lat === undefined || lon === undefined) return "";
    if (lat > bounds.n || lat < bounds.s || lon < bounds.w || lon > bounds.e) return "";
    const [x, y] = proj.project(lat, lon);
    const h = 11 * u;
    const w = 8 * u;
    return `<g class="map-peak"><title>${esc(s.name)}</title>
      <path d="M${n(x - w)} ${n(y + h * 0.35)} L${n(x)} ${n(y - h * 0.65)} L${n(x + w)} ${n(y + h * 0.35)} Z" fill="${GRANITE}" stroke="${INK}" stroke-width="${n(1.8 * u)}" stroke-linejoin="round"/>
      <path d="M${n(x - w * 0.42)} ${n(y - h * 0.22)} L${n(x)} ${n(y - h * 0.65)} L${n(x + w * 0.42)} ${n(y - h * 0.22)} L${n(x + w * 0.14)} ${n(y - h * 0.3)} L${n(x)} ${n(y - h * 0.16)} L${n(x - w * 0.16)} ${n(y - h * 0.3)} Z" fill="${WHITE}" stroke="${INK}" stroke-width="${n(1.2 * u)}" stroke-linejoin="round"/>
    </g>`;
  }).join("");
  layers.push(`<g class="map-peaks">${peakMarks}</g>`);

  layers.push(
    `<path class="map-river" d="${smoothPath(JORDAN_RIVER.map(P), false, 0.7)}" fill="none" stroke="${SKY_DEEP}" stroke-width="${n(2.6 * u)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  );

  const text = (s: string, x: number, y: number, size: number, anchor = "start", weight = 700, fill = INK) =>
    `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" font-family="'Space Mono', ui-monospace, monospace" font-weight="${weight}" font-size="${n(size)}" fill="${fill}" paint-order="stroke" stroke="${POWDER}" stroke-width="${n(3 * u)}" stroke-linejoin="round">${esc(s)}</text>`;

  // Canyon mouths: a notch in the front, labeled up into the mountains so the
  // valley stays clear for the transit lines.
  const canyons = CANYON_MOUTHS.map((c) => {
    const [x, y] = proj.project(c.lat, c.lon);
    return `<g class="map-canyon"><path d="M${n(x - 4 * u)} ${n(y - 4 * u)} L${n(x)} ${n(y + 2 * u)} L${n(x + 4 * u)} ${n(y - 4 * u)}" fill="none" stroke="${INK}" stroke-width="${n(2 * u)}" stroke-linecap="round" stroke-linejoin="round"/>
      ${labels ? text(c.name.toUpperCase(), x + 7 * u, y + 2.5 * u, 7.4 * u, "start") : ""}</g>`;
  }).join("");
  layers.push(`<g class="map-canyons">${canyons}</g>`);

  const cities = CITIES.map((c) => {
    const [x, y] = proj.project(c.lat, c.lon);
    const dot = c.star
      ? `<path d="${starPath(x, y, 6.5 * u, 2.8 * u)}" fill="${SUNSET}" stroke="${INK}" stroke-width="${n(1.8 * u)}" stroke-linejoin="round"/>`
      : `<circle cx="${n(x)}" cy="${n(y)}" r="${n(3.2 * u)}" fill="${WHITE}" stroke="${INK}" stroke-width="${n(1.8 * u)}"/>`;
    return `<g class="map-city">${dot}${labels ? text(c.name.toUpperCase(), x - 9 * u, y + 3.4 * u, 8.6 * u, "end") : ""}</g>`;
  }).join("");
  layers.push(`<g class="map-cities">${cities}</g>`);

  const [ax, ay] = proj.project(AIRPORT.lat, AIRPORT.lon);
  layers.push(`<g class="map-airport">${iconAt("plane", ax, ay, 16 * u)}</g>`);

  const [mx, my] = proj.project(MOOSE_SPOT.lat, MOOSE_SPOT.lon);
  layers.push(`<g class="map-moose" transform="rotate(-8 ${n(mx)} ${n(my)})">${iconAt("moose", mx, my, 24 * u)}</g>`);

  // Spiral Jetty: drawn in place if it's on the map, else an arrow toward it.
  const [jx, jy] = proj.project(SPIRAL_JETTY.lat, SPIRAL_JETTY.lon);
  if (jx >= 0 && jx <= width && jy >= 0 && jy <= height) {
    layers.push(`<path class="map-jetty" d="${spiral(jx, jy, 9 * u)}" fill="none" stroke="${INK}" stroke-width="${n(2.2 * u)}" stroke-linecap="round"/>`);
  } else {
    const x = 14 * u;
    const y = 30 * u;
    layers.push(`<g class="map-jetty">
      <path d="${spiral(x + 10 * u, y + 2 * u, 7 * u)}" fill="none" stroke="${INK}" stroke-width="${n(1.8 * u)}" stroke-linecap="round"/>
      <path d="M${n(x + 3 * u)} ${n(y - 8 * u)} L${n(x - 1 * u)} ${n(y - 12 * u)} M${n(x - 1 * u)} ${n(y - 12 * u)} L${n(x + 4.5 * u)} ${n(y - 12.5 * u)} M${n(x - 1 * u)} ${n(y - 12 * u)} L${n(x - 1.5 * u)} ${n(y - 6.5 * u)}" stroke="${INK}" stroke-width="${n(1.8 * u)}" stroke-linecap="round" fill="none"/>
      ${text("SPIRAL JETTY", x + 22 * u, y + 5 * u, 7.4 * u)}</g>`);
  }

  // Names: the lake, the island, the dry lakebed between the low water and
  // where a healthy lake would reach.
  const display = (s: string, x: number, y: number, size: number, fill: string, rotate = 0) =>
    `<text x="${n(x)}" y="${n(y)}" text-anchor="middle" font-family="Shrikhand, 'Bowlby One', sans-serif" font-size="${n(size)}" fill="${fill}" stroke="${INK}" stroke-width="${n(3.2 * u)}" paint-order="stroke" stroke-linejoin="round"${rotate ? ` transform="rotate(${rotate} ${n(x)} ${n(y)})"` : ""}>${esc(s)}</text>`;
  if (labels) {
    const [gx, gy] = proj.project(40.805, -112.3);
    const [ix, iy] = proj.project(40.99, -112.222);
    const [dx, dy] = proj.project(41.005, -112.072);
    layers.push(`<g class="map-names">
      ${display("Great Salt", gx, gy, 12.5 * u, WHITE)}${display("Lake", gx, gy + 13 * u, 12.5 * u, WHITE)}
      ${display("Antelope Is.", ix, iy, 10.5 * u, POWDER, -74)}
      ${text("DRY LAKEBED", dx, dy, 7 * u, "middle", 700, LAKE_DEEP)}
    </g>`);
  }
  const cx = width - 26 * u;
  const cy = height - 30 * u;
  layers.push(`<g class="map-compass">
    <circle cx="${n(cx)}" cy="${n(cy)}" r="${n(15 * u)}" fill="${WHITE}" stroke="${INK}" stroke-width="${n(2.2 * u)}"/>
    <path d="M${n(cx)} ${n(cy - 12 * u)} L${n(cx + 4.5 * u)} ${n(cy)} L${n(cx)} ${n(cy - 2.5 * u)} L${n(cx - 4.5 * u)} ${n(cy)} Z" fill="${SUNSET}" stroke="${INK}" stroke-width="${n(1.4 * u)}" stroke-linejoin="round"/>
    <path d="M${n(cx)} ${n(cy + 12 * u)} L${n(cx + 4.5 * u)} ${n(cy)} L${n(cx)} ${n(cy + 2.5 * u)} L${n(cx - 4.5 * u)} ${n(cy)} Z" fill="${SKY}" stroke="${INK}" stroke-width="${n(1.4 * u)}" stroke-linejoin="round"/>
    ${text("N", cx, cy - 18 * u, 9 * u, "middle")}</g>`);

  const body = `${defs}<g clip-path="url(#${id}-frame)">${layers.join("")}
    <g class="map-routes"></g><g class="map-vehicles"></g><g class="map-events"></g></g>
    <rect x="${n(1.5 * u)}" y="${n(1.5 * u)}" width="${n(width - 3 * u)}" height="${n(height - 3 * u)}" rx="${n(13 * u)}" fill="none" stroke="${INK}" stroke-width="${n(3 * u)}"/>`;
  return svg(`0 0 ${n(width)} ${n(height)}`, body, {
    cls: "map",
    ...(opts.title !== undefined ? { title: opts.title } : {}),
  });
}

function starPath(cx: number, cy: number, rOut: number, rIn: number): string {
  let d = "";
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? rOut : rIn;
    const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
    d += `${k === 0 ? "M" : "L"}${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}`;
  }
  return d + "Z";
}
