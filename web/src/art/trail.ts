// Ski trail-map difficulty symbols, for the four-way vantage control.
//
// The mapping, by how much commitment each listening position asks:
//   Everywhere   → green circle   (easiest: the whole valley, no commitment)
//   Downtown     → blue square    (intermediate: the city's groove)
//   The Canyons  → black diamond  (expert terrain: snow, wind, ski buses)
//   The Lake     → lake wave      (off the trail map entirely: teal, flat, salty)
// The double black diamond is spare, for powder-day and storm badges.
import { INK, LAKE, TRAIL_BLUE, TRAIL_GREEN, WHITE } from "./palette.ts";
import { svg } from "./util.ts";

export type TrailKind = "green-circle" | "blue-square" | "black-diamond" | "double-black" | "lake-wave";

export type Vantage = "everywhere" | "downtown" | "canyons" | "lake";

export const VANTAGE_TRAIL: Readonly<Record<Vantage, TrailKind>> = {
  everywhere: "green-circle",
  downtown: "blue-square",
  canyons: "black-diamond",
  lake: "lake-wave",
};

const EDGE = `stroke="${INK}" stroke-width="7" stroke-linejoin="round"`;
const RIM = `stroke="${WHITE}" stroke-width="3.2" stroke-linejoin="round"`;

function diamond(cx: number, cy: number, r: number): string {
  return `M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`;
}

const BODIES: Record<TrailKind, string> = {
  "green-circle": `<circle cx="16" cy="16" r="11" fill="${TRAIL_GREEN}" ${EDGE}/><circle cx="16" cy="16" r="11" fill="${TRAIL_GREEN}" ${RIM}/>`,
  "blue-square": `<rect x="5.5" y="5.5" width="21" height="21" rx="2" fill="${TRAIL_BLUE}" ${EDGE}/><rect x="5.5" y="5.5" width="21" height="21" rx="2" fill="${TRAIL_BLUE}" ${RIM}/>`,
  "black-diamond": `<path d="${diamond(16, 16, 12.5)}" fill="${INK}" ${EDGE}/><path d="${diamond(16, 16, 12.5)}" fill="${INK}" ${RIM}/>`,
  "double-black": `<path d="${diamond(9.6, 16, 8)}" fill="${INK}" ${EDGE}/><path d="${diamond(22.4, 16, 8)}" fill="${INK}" ${EDGE}/>
    <path d="${diamond(9.6, 16, 8)}" fill="${INK}" ${RIM}/><path d="${diamond(22.4, 16, 8)}" fill="${INK}" ${RIM}/>`,
  "lake-wave": `<circle cx="16" cy="16" r="11.5" fill="${LAKE}" ${EDGE}/><circle cx="16" cy="16" r="11.5" fill="${LAKE}" ${RIM}/>
    <path d="M7.4 14.2 Q9.6 11.8 11.8 14.2 T16.2 14.2 T20.6 14.2 T25 14.2" stroke="${WHITE}" stroke-width="2.3" stroke-linecap="round" fill="none"/>
    <path d="M8.6 19.2 Q10.8 16.8 13 19.2 T17.4 19.2 T21.8 19.2" stroke="${WHITE}" stroke-width="2.3" stroke-linecap="round" fill="none"/>`,
};

const NAMES: Record<TrailKind, string> = {
  "green-circle": "Green circle",
  "blue-square": "Blue square",
  "black-diamond": "Black diamond",
  "double-black": "Double black diamond",
  "lake-wave": "Lake",
};

/** A 32 × 32 trail symbol. Decorative unless given a title. */
export function trailIcon(kind: TrailKind, opts: { size?: number; title?: string } = {}): string {
  return svg("0 0 32 32", BODIES[kind], {
    cls: `trail trail--${kind}`,
    ...(opts.size !== undefined ? { width: opts.size, height: opts.size } : {}),
    ...(opts.title !== undefined ? { title: opts.title } : {}),
  });
}

export function trailName(kind: TrailKind): string {
  return NAMES[kind];
}
