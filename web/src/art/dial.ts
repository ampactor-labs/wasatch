// The harmony dial: the circle of fifths as a ski-lift bullwheel with twelve
// chairs. The seven lit chairs are the notes in play (positions collection-1 …
// collection+5); home's chair carries the shredder; an arrow shows the push.
import { GRANITE, INK, PINK, POWDER, SKY_DEEP, SUN, SUNSET, WHITE } from "./palette.ts";
import { shredderGroup } from "./shredder.ts";
import { esc, n, svg } from "./util.ts";

/** Labels by circle position mod 12: 0 is C, 1 is G, … 11 is F. */
export const DEFAULT_DIAL_LABELS: readonly string[] = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"];

export interface HarmonyDialOpts {
  /** Circle position of the major scale whose notes are in play (C=0, G=1, F=-1). */
  collection: number;
  /** Circle position of the tonic. */
  home: number;
  /** -1 flatward, 0 none, 1 sharpward. */
  push: -1 | 0 | 1;
  /** Twelve labels indexed by position mod 12 (spelling is the caller's). */
  labels?: readonly string[];
  /** Optional words on the hub, e.g. "E DORIAN". */
  center?: string;
  title?: string;
}

const mod12 = (p: number) => ((Math.round(p) % 12) + 12) % 12;

/**
 * The dial, viewBox 0 0 300 300. Classes: `.dial`, `.dial-wheel` (rotate it
 * for fun; it turns about 150 150), `.dial-chair`, `.dial-chair--lit`,
 * `.dial-chair--home`, `.dial-push`.
 */
export function harmonyDial(opts: HarmonyDialOpts): string {
  const labels = opts.labels && opts.labels.length >= 12 ? opts.labels : DEFAULT_DIAL_LABELS;
  const cx = 150;
  const cy = 150;
  const wheelR = 56;
  const cableR = 100;
  const lit = new Set<number>();
  for (let p = opts.collection - 1; p <= opts.collection + 5; p++) lit.add(mod12(p));
  const home = mod12(opts.home);

  const point = (k: number, r: number): [number, number] => {
    const a = (k * Math.PI) / 6;
    return [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
  };

  const spokes: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 6;
    spokes.push(`M${n(cx + Math.cos(a) * 12)} ${n(cy + Math.sin(a) * 12)} L${n(cx + Math.cos(a) * (wheelR - 7))} ${n(cy + Math.sin(a) * (wheelR - 7))}`);
  }
  const wheel = `<g class="dial-wheel">
    <circle cx="${cx}" cy="${cy}" r="${wheelR}" fill="${GRANITE}" stroke="${INK}" stroke-width="4"/>
    <circle cx="${cx}" cy="${cy}" r="${wheelR - 9}" fill="none" stroke="${INK}" stroke-width="2.2"/>
    <path d="${spokes.join(" ")}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="12" fill="${INK}"/><circle cx="${cx}" cy="${cy}" r="4.5" fill="${SUN}"/>
  </g>`;
  const cable = `<circle cx="${cx}" cy="${cy}" r="${cableR}" fill="none" stroke="${INK}" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="${cableR}" fill="none" stroke="${POWDER}" stroke-width="1" stroke-dasharray="2 6" opacity=".8"/>`;

  // Chairs hang straight down from the cable, as chairs do.
  const chairs: string[] = [];
  for (let k = 0; k < 12; k++) {
    const [x, y] = point(k, cableR);
    const isLit = lit.has(k);
    const isHome = k === home;
    const pw = 34;
    const ph = 22;
    const px = x - pw / 2;
    const py = y + 10;
    const fill = isHome ? PINK : isLit ? SUN : POWDER;
    const textFill = isHome ? WHITE : isLit ? INK : "#5A6378";
    const label = labels[k] ?? DEFAULT_DIAL_LABELS[k] ?? "";
    const cls = `dial-chair${isLit ? " dial-chair--lit" : ""}${isHome ? " dial-chair--home" : ""}`;
    const rider = isHome
      ? `<g transform="translate(${n(x)} ${n(py - 0.5)}) scale(.17)">${shredderGroup({ spray: false })}</g>`
      : "";
    chairs.push(`<g class="${cls}" data-position="${k}">
      <circle cx="${n(x)}" cy="${n(y)}" r="3.4" fill="${INK}"/>
      <path d="M${n(x)} ${n(y)} L${n(x)} ${n(py)}" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      ${rider}
      <rect x="${n(px)}" y="${n(py)}" width="${pw}" height="${ph}" rx="6" fill="${fill}" stroke="${INK}" stroke-width="${isLit || isHome ? 3 : 2.2}"/>
      <path d="M${n(px + 3)} ${n(py + ph + 3.5)} L${n(px + pw - 3)} ${n(py + ph + 3.5)}" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
      <text x="${n(x)}" y="${n(py + ph / 2 + 5.6)}" text-anchor="middle" font-family="Rubik, system-ui, sans-serif" font-weight="${isLit || isHome ? 800 : 600}" font-size="16" fill="${textFill}">${esc(label)}</text>
    </g>`);
  }
  // Draw the home chair last so its rider sits on top.
  const order = chairs.map((c, k) => ({ c, k })).sort((a, b) => Number(a.k === home) - Number(b.k === home));

  let push = "";
  if (opts.push !== 0) {
    // A fixed arc across the top of the dial (clear of every chair):
    // clockwise is sharpward, counterclockwise flatward.
    const dir = opts.push;
    const r = 134;
    const a0 = ((-28 * dir) * Math.PI) / 180;
    const a1 = ((28 * dir) * Math.PI) / 180;
    const p0: [number, number] = [cx + Math.sin(a0) * r, cy - Math.cos(a0) * r];
    const p1: [number, number] = [cx + Math.sin(a1) * r, cy - Math.cos(a1) * r];
    // The arrowhead follows the tangent at the end of the arc.
    const tip = Math.atan2(p1[1] - cy, p1[0] - cx) + (dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    const h1: [number, number] = [p1[0] - Math.cos(tip - 0.55) * 11, p1[1] - Math.sin(tip - 0.55) * 11];
    const h2: [number, number] = [p1[0] - Math.cos(tip + 0.55) * 11, p1[1] - Math.sin(tip + 0.55) * 11];
    const sweep = dir > 0 ? 1 : 0;
    const glyph = dir > 0 ? "♯" : "♭";
    const [gx, gy] = [cx, cy - r];
    push = `<g class="dial-push dial-push--${dir > 0 ? "sharp" : "flat"}">
      <path d="M${n(p0[0])} ${n(p0[1])} A${r} ${r} 0 0 ${sweep} ${n(p1[0])} ${n(p1[1])}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
      <path d="M${n(p0[0])} ${n(p0[1])} A${r} ${r} 0 0 ${sweep} ${n(p1[0])} ${n(p1[1])}" fill="none" stroke="${SUNSET}" stroke-width="3.6" stroke-linecap="round"/>
      <path d="M${n(h1[0])} ${n(h1[1])} L${n(p1[0])} ${n(p1[1])} L${n(h2[0])} ${n(h2[1])}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${n(gx)}" cy="${n(gy)}" r="10" fill="${WHITE}" stroke="${INK}" stroke-width="2.4"/>
      <text x="${n(gx)}" y="${n(gy + 5.5)}" text-anchor="middle" font-family="Rubik, system-ui, sans-serif" font-weight="800" font-size="15" fill="${SKY_DEEP}">${glyph}</text>
    </g>`;
  }

  const center = opts.center
    ? `<g class="dial-center">
        <rect x="${cx - 52}" y="${cy - 14}" width="104" height="28" rx="14" fill="${WHITE}" stroke="${INK}" stroke-width="2.6"/>
        <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="Rubik, system-ui, sans-serif" font-weight="800" font-size="14.5" letter-spacing=".5" fill="${INK}">${esc(opts.center)}</text>
      </g>`
    : "";

  return svg("0 0 300 300", `${cable}${wheel}${center}${order.map((o) => o.c).join("")}${push}`, {
    cls: "dial",
    ...(opts.title !== undefined ? { title: opts.title } : {}),
  });
}
