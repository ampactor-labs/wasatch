// Small helpers shared by the art modules. Everything here is pure: no DOM.

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for use inside SVG or HTML markup, attributes included. */
export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

/** A compact number for markup: at most `digits` decimals, no trailing zeros. */
export function n(value: number, digits = 1): string {
  const p = 10 ** digits;
  const r = Math.round(value * p) / p;
  return Object.is(r, -0) ? "0" : String(r);
}

export type Pt = readonly [number, number];

/** "x,y x,y …" for polygon and polyline points. */
export function pts(points: readonly Pt[]): string {
  return points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
}

/** An open or closed path through straight segments. */
export function linePath(points: readonly Pt[], close = false): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const head = `M${n(first![0])} ${n(first![1])}`;
  const body = rest.map(([x, y]) => `L${n(x)} ${n(y)}`).join("");
  return head + body + (close ? "Z" : "");
}

/**
 * A smooth path through points (Catmull-Rom converted to cubic Béziers).
 * `tension` 0 gives straight-ish segments, 1 the full Catmull-Rom curve.
 */
export function smoothPath(points: readonly Pt[], close = false, tension = 1): string {
  const count = points.length;
  if (count < 3) return linePath(points, close);
  const at = (i: number): Pt => {
    if (close) return points[((i % count) + count) % count]!;
    return points[Math.max(0, Math.min(count - 1, i))]!;
  };
  const t = tension / 6;
  let d = `M${n(at(0)[0])} ${n(at(0)[1])}`;
  const last = close ? count : count - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d + (close ? "Z" : "");
}

/** Attribute string from a record, skipping undefined values. */
export function attrs(record: Record<string, string | number | undefined>): string {
  return Object.entries(record)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}="${esc(String(v))}"`)
    .join(" ");
}

/** A deterministic pseudo-random value in [0, 1) from an integer seed. */
export function hash01(seed: number): number {
  let x = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Hex color helpers for mixing palette colors in JS. */
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const v = Number.parseInt(full, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex([r, g, b]: readonly [number, number, number]): string {
  const c = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mixes `a` toward `b` by `t` (0 gives a, 1 gives b). */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k]);
}

/** A standalone SVG element wrapper. Decorative unless a title is given. */
export function svg(
  viewBox: string,
  body: string,
  opts: { cls?: string; title?: string; width?: number | string; height?: number | string; style?: string } = {},
): string {
  const labelled = opts.title !== undefined;
  const a = attrs({
    xmlns: "http://www.w3.org/2000/svg",
    viewBox,
    class: opts.cls,
    width: opts.width,
    height: opts.height,
    style: opts.style,
    role: labelled ? "img" : undefined,
    "aria-hidden": labelled ? undefined : "true",
    focusable: "false",
  });
  const title = labelled ? `<title>${esc(opts.title!)}</title>` : "";
  return `<svg ${a}>${title}${body}</svg>`;
}

/** Unique-enough id prefix so several copies of one drawing can share a page. */
let idCounter = 0;
export function uid(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}`;
}
