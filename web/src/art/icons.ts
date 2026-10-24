// 24 × 24 icons in the trail-map style: a bold ink outline, flat palette fills.
import {
  BILL,
  GRANITE,
  HAZE,
  INK,
  JELLO,
  LAKE,
  PINK,
  POWDER,
  SKY,
  SKY_DEEP,
  SUN,
  SUNSET,
  WHITE,
  WOOD,
} from "./palette.ts";
import { n, svg } from "./util.ts";

export type IconName =
  | "trax"
  | "frontrunner"
  | "bus"
  | "skibus"
  | "bike"
  | "plane"
  | "quake"
  | "seismometer"
  | "snowflake"
  | "sun"
  | "moon"
  | "cloud"
  | "wind"
  | "drop"
  | "moose"
  | "shrimp"
  | "gull-small"
  | "lid"
  | "chairlift"
  | "bell"
  | "horn"
  | "harp"
  | "mountain";

const L = `stroke="${INK}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"`;
const MOOSE = "#8B5A3C";
const MOOSE_SNOUT = "#B07C5B";
const SHRIMP = "#FF8E6E";

function snowflakeBody(cx: number, cy: number, r: number, width = 1.9): string {
  const arms: string[] = [];
  for (let k = 0; k < 6; k++) {
    const a = (k * Math.PI) / 3 - Math.PI / 2;
    const ex = cx + Math.cos(a) * r;
    const ey = cy + Math.sin(a) * r;
    const bx = cx + Math.cos(a) * r * 0.58;
    const by = cy + Math.sin(a) * r * 0.58;
    const side = r * 0.3;
    const l = a - 0.7;
    const rr = a + 0.7;
    arms.push(
      `M${n(cx)} ${n(cy)} L${n(ex)} ${n(ey)} M${n(bx)} ${n(by)} L${n(bx + Math.cos(l) * side)} ${n(by + Math.sin(l) * side)} M${n(bx)} ${n(by)} L${n(bx + Math.cos(rr) * side)} ${n(by + Math.sin(rr) * side)}`,
    );
  }
  return `<path d="${arms.join(" ")}" stroke="${INK}" stroke-width="${width}" stroke-linecap="round" fill="none"/>`;
}

function sunBody(cx: number, cy: number, r: number): string {
  const rays: string[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    rays.push(
      `M${n(cx + Math.cos(a) * (r + 2.2))} ${n(cy + Math.sin(a) * (r + 2.2))} L${n(cx + Math.cos(a) * (r + 4.6))} ${n(cy + Math.sin(a) * (r + 4.6))}`,
    );
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}" ${L}/><path d="${rays.join(" ")}" ${L} fill="none"/>`;
}

const BODIES: Record<IconName, () => string> = {
  trax: () => `
    <path d="M8.5 5 L12 1.8 L15.5 5 M10 1.8 L14 1.8" ${L} fill="none"/>
    <rect x="4.5" y="5" width="15" height="13.5" rx="3.2" fill="${POWDER}" ${L}/>
    <rect x="7" y="7.4" width="10" height="5" rx="1.4" fill="${SKY}" ${L}/>
    <path d="M4.5 14.6 L19.5 14.6" stroke="${SUNSET}" stroke-width="1.6"/>
    <circle cx="8" cy="16.4" r="1.05" fill="${SUN}" ${L} stroke-width="1"/>
    <circle cx="16" cy="16.4" r="1.05" fill="${SUN}" ${L} stroke-width="1"/>
    <path d="M7 18.5 L5 21.5 M17 18.5 L19 21.5 M3 21.8 L21 21.8" ${L} fill="none"/>`,
  frontrunner: () => `
    <path d="M2 7.5 Q2 5.5 4 5.5 L18 5.5 Q22 5.5 22 9.5 L22 16 L2 16 Z" fill="${POWDER}" ${L}/>
    <path d="M2 10.8 L22 10.8" stroke="${SKY_DEEP}" stroke-width="1.8"/>
    <rect x="4.4" y="7.2" width="3" height="2.2" rx=".6" fill="${SKY}" stroke="${INK}" stroke-width="1"/>
    <rect x="9" y="7.2" width="3" height="2.2" rx=".6" fill="${SKY}" stroke="${INK}" stroke-width="1"/>
    <rect x="13.6" y="7.2" width="3" height="2.2" rx=".6" fill="${SKY}" stroke="${INK}" stroke-width="1"/>
    <rect x="4.4" y="12.4" width="3" height="2.2" rx=".6" fill="${SKY}" stroke="${INK}" stroke-width="1"/>
    <rect x="9" y="12.4" width="3" height="2.2" rx=".6" fill="${SKY}" stroke="${INK}" stroke-width="1"/>
    <rect x="13.6" y="12.4" width="3" height="2.2" rx=".6" fill="${SKY}" stroke="${INK}" stroke-width="1"/>
    <circle cx="6.5" cy="18" r="1.7" fill="${INK}"/><circle cx="17.5" cy="18" r="1.7" fill="${INK}"/>
    <path d="M1.5 20.6 L22.5 20.6" ${L}/>`,
  bus: () => `
    <rect x="5" y="3" width="14" height="16" rx="2.6" fill="${POWDER}" ${L}/>
    <rect x="7" y="5.2" width="10" height="7" rx="1.2" fill="${SKY}" ${L}/>
    <path d="M5 7.5 L3 8.6 M19 7.5 L21 8.6" ${L}/>
    <circle cx="8.2" cy="15.6" r="1" fill="${SUN}" stroke="${INK}" stroke-width="1"/>
    <circle cx="15.8" cy="15.6" r="1" fill="${SUN}" stroke="${INK}" stroke-width="1"/>
    <rect x="6.3" y="19" width="3" height="2.6" rx="1" fill="${INK}"/><rect x="14.7" y="19" width="3" height="2.6" rx="1" fill="${INK}"/>`,
  skibus: () => `
    <path d="M3 5.2 L19.6 5.2 Q21.6 5.2 21.8 3.4" stroke="${PINK}" stroke-width="1.7" stroke-linecap="round" fill="none"/>
    <path d="M4 3.4 L18.6 3.4 Q20.6 3.4 20.8 1.6" stroke="${SKY_DEEP}" stroke-width="1.7" stroke-linecap="round" fill="none"/>
    <path d="M3.5 6.8 L20.5 6.8" ${L}/>
    <rect x="2" y="8" width="20" height="10" rx="2.2" fill="${POWDER}" ${L}/>
    <rect x="4" y="10" width="3" height="3.2" rx=".6" fill="${SKY}" stroke="${INK}" stroke-width="1"/>
    <rect x="8.6" y="10" width="3" height="3.2" rx=".6" fill="${SKY}" stroke="${INK}" stroke-width="1"/>
    <rect x="13.2" y="10" width="3" height="3.2" rx=".6" fill="${SKY}" stroke="${INK}" stroke-width="1"/>
    <rect x="17.4" y="10" width="2.8" height="5" rx=".6" fill="${SKY}" stroke="${INK}" stroke-width="1"/>
    <circle cx="6.5" cy="18.6" r="2" fill="${INK}"/><circle cx="17.5" cy="18.6" r="2" fill="${INK}"/>`,
  bike: () => `
    <circle cx="6" cy="16" r="4.4" fill="none" ${L}/><circle cx="18" cy="16" r="4.4" fill="none" ${L}/>
    <path d="M6 16 L10 9.2 L16 9.2 L18 16 M10 9.2 L12.2 16 L16 9.2 M8.6 7.2 L11.6 7.2 M10 7.2 L10.4 9.2 M15.2 7 L16 9.2" ${L} fill="none"/>
    <rect x="16.2" y="4.6" width="4.4" height="3" rx=".8" fill="${JELLO}" ${L} stroke-width="1.4"/>`,
  plane: () => `
    <path d="M12 2 C13 2 13.5 3 13.5 4.6 L13.5 9 L21 13 L21 15.2 L13.5 12.6 L13.5 18 L16 19.9 L16 21.5 L12 20.5 L8 21.5 L8 19.9 L10.5 18 L10.5 12.6 L3 15.2 L3 13 L10.5 9 L10.5 4.6 C10.5 3 11 2 12 2 Z"
      fill="${POWDER}" ${L}/>
    <path d="M11 5.2 L13 5.2" stroke="${SKY}" stroke-width="1.6" stroke-linecap="round"/>`,
  quake: () => `
    <path d="M1.8 11.5 L5 11.5 L6.6 7 L8.6 16.5 L10.6 3.8 L12.6 19.5 L14.6 7.6 L16.2 14.6 L17.6 10 L19 11.5 L22.2 11.5" ${L} fill="none" stroke="${SUNSET}"/>
    <path d="M1.8 11.5 L5 11.5 L6.6 7 L8.6 16.5 L10.6 3.8 L12.6 19.5 L14.6 7.6 L16.2 14.6 L17.6 10 L19 11.5 L22.2 11.5" stroke="${INK}" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".55"/>
    <path d="M7.5 22 L10.5 20.4 L12.6 22 L15.6 20.4" ${L} fill="none"/>`,
  seismometer: () => `
    <path d="M12 3.6 L12 11" ${L}/>
    <circle cx="12" cy="3.6" r="2" fill="${SUNSET}" ${L} stroke-width="1.4"/>
    <rect x="3" y="11" width="18" height="9.6" rx="2.2" fill="${POWDER}" ${L}/>
    <path d="M5 16 L8 16 L9 13.8 L10.5 18.2 L12 14.4 L13.4 17.2 L14.8 15.4 L19 15.4" stroke="${SKY_DEEP}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  snowflake: () => snowflakeBody(12, 12, 9.2),
  sun: () => sunBody(12, 12, 4.4),
  moon: () => `
    <path d="M15.6 3.2 A8.8 8.8 0 1 0 20.8 16.4 A7.2 7.2 0 1 1 15.6 3.2 Z" fill="#FFF1A8" ${L}/>
    <circle cx="9" cy="12.5" r="1" fill="${INK}" opacity=".35"/><circle cx="11.5" cy="17" r=".8" fill="${INK}" opacity=".35"/>`,
  cloud: () => `
    <path d="M7 18.5 C4.2 18.5 2.5 16.6 2.5 14.4 C2.5 12.2 4.3 10.4 6.5 10.6 C7.2 7.5 9.6 5.6 12.3 5.6 C15.3 5.6 17.5 7.7 17.9 10.5 C20.1 10.6 21.6 12.4 21.6 14.5 C21.6 16.7 19.9 18.5 17.7 18.5 Z" fill="${POWDER}" ${L}/>`,
  wind: () => `
    <path d="M2.5 8.6 L14 8.6 C17.2 8.6 18.2 5.9 16.6 4.4 C15.1 3 12.9 4 13.1 5.9" ${L} fill="none"/>
    <path d="M2.5 12.6 L18.4 12.6 C21.6 12.6 22.6 15.3 21 16.8 C19.5 18.2 17.3 17.2 17.5 15.3" ${L} fill="none"/>
    <path d="M2.5 16.6 L10.5 16.6" ${L} fill="none"/>`,
  drop: () => `
    <path d="M12 2.6 C12 2.6 5.4 10.4 5.4 14.6 C5.4 18.3 8.4 21.2 12 21.2 C15.6 21.2 18.6 18.3 18.6 14.6 C18.6 10.4 12 2.6 12 2.6 Z" fill="${LAKE}" ${L}/>
    <path d="M8.8 14.4 C8.8 16.4 10 17.8 11.6 18.2" stroke="${WHITE}" stroke-width="1.6" stroke-linecap="round" fill="none"/>`,
  moose: () => `
    <path d="M8.2 6.6 C5.6 6.8 3 5.4 1.8 2.6 C3 3 3.6 2.2 4 1.6 C4.6 3 5.4 3.2 6 2.2 C6.6 3.6 7.6 4 8.6 4.2 Z" fill="${HAZE}" ${L} stroke-width="1.5"/>
    <path d="M15.8 6.6 C18.4 6.8 21 5.4 22.2 2.6 C21 3 20.4 2.2 20 1.6 C19.4 3 18.6 3.2 18 2.2 C17.4 3.6 16.4 4 15.4 4.2 Z" fill="${HAZE}" ${L} stroke-width="1.5"/>
    <path d="M8.4 8 L5.6 10.2 L8.4 10.8 Z M15.6 8 L18.4 10.2 L15.6 10.8 Z" fill="${MOOSE}" ${L} stroke-width="1.4"/>
    <path d="M8 7.4 C8 5.6 16 5.6 16 7.4 L15.2 14.6 C15.4 18.2 14.2 20.8 12 21.4 C9.8 20.8 8.6 18.2 8.8 14.6 Z" fill="${MOOSE}" ${L}/>
    <ellipse cx="12" cy="18.4" rx="3" ry="2.3" fill="${MOOSE_SNOUT}" stroke="${INK}" stroke-width="1.3"/>
    <circle cx="10.9" cy="18.4" r=".55" fill="${INK}"/><circle cx="13.1" cy="18.4" r=".55" fill="${INK}"/>
    <circle cx="10.1" cy="11.6" r=".95" fill="${INK}"/><circle cx="13.9" cy="11.6" r=".95" fill="${INK}"/>
    <rect x="8.4" y="6.6" width="7.2" height="2.7" rx="1.35" fill="${PINK}" stroke="${INK}" stroke-width="1.3"/>
    <path d="M9.6 7.4 L11.4 7.4" stroke="${WHITE}" stroke-width=".9" stroke-linecap="round"/>`,
  shrimp: () => `
    <path d="M7 14.4 L6.4 17.6 M9.6 14.9 L9.2 18.2 M12.2 15 L12.2 18.3 M14.8 14.6 L15.2 17.8 M17.2 14 L17.8 16.8" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M3.6 12 C5.8 8.8 10 8.3 14 9.4 C17 10.2 19 11.3 21 10.8 L20.6 13.6 C18.6 13.3 17 14.2 14 14.5 C10 15 6.2 14.7 3.6 12 Z" fill="${SHRIMP}" ${L}/>
    <path d="M9 9.2 Q9.6 11.8 9 14.6 M12.4 9.2 Q13 11.8 12.4 14.8" stroke="${INK}" stroke-width="1" fill="none" opacity=".55"/>
    <path d="M21 10.8 L23 9 M20.8 13.4 L23 15.2" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M4 10.6 L2.4 8.8" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="2.4" cy="8.6" r="1.1" fill="${INK}"/>`,
  "gull-small": () => `
    <path d="M1.8 11.6 Q6.6 5.6 11.4 10.6 Q16.4 5.6 22.2 10.2" ${L} fill="none"/>
    <path d="M1.8 11.6 Q6.6 5.6 11.4 10.6" stroke="${GRANITE}" stroke-width=".9" stroke-linecap="round" fill="none"/>
    <ellipse cx="12" cy="11.8" rx="3.3" ry="2" fill="${WHITE}" ${L} stroke-width="1.5"/>
    <path d="M15.1 11.3 L17.7 11.8 L15.1 12.5 Z" fill="${BILL}" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>`,
  lid: () => `
    <path d="M3 15.2 C3 9 21 9 21 15.2 Z" fill="${GRANITE}" ${L}/>
    <rect x="1.8" y="15.2" width="20.4" height="2.6" rx="1.3" fill="${GRANITE}" ${L}/>
    <rect x="10" y="6.2" width="4" height="3.2" rx="1" fill="${INK}"/>
    <path d="M6.6 12.6 Q8.8 10.8 12 10.6" stroke="${WHITE}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <path d="M4.5 21 Q6.5 19.8 8.5 21 T12.5 21 T16.5 21 T20.5 21" stroke="${HAZE}" stroke-width="1.7" stroke-linecap="round" fill="none"/>`,
  chairlift: () => `
    <path d="M1 4.6 L23 2.8" ${L}/>
    <path d="M12.2 3.7 L12.2 9" ${L}/>
    <path d="M7 9 L17.4 9 M8 9 L8 15.4 M8 15.4 L17.4 15.4 L17.4 13.6" ${L} fill="none"/>
    <rect x="8" y="13.4" width="9.4" height="2" rx=".6" fill="${SUN}" stroke="${INK}" stroke-width="1.2"/>
    <path d="M9.6 18.6 L16.6 18.6 M12.8 15.4 L12.8 18.6" ${L}/>`,
  bell: () => `
    <path d="M12 2.4 L12 3.6" ${L}/>
    <path d="M12 3.4 C8 3.4 6 6.4 6 10.2 L6 14.8 L3.8 17.8 L20.2 17.8 L18 14.8 L18 10.2 C18 6.4 16 3.4 12 3.4 Z" fill="${SUN}" ${L}/>
    <path d="M8.6 8.4 Q9.2 6.6 10.8 6" stroke="${WHITE}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    <circle cx="12" cy="20.2" r="1.9" fill="${INK}"/>`,
  // A locomotive's horn: a cluster of trumpet bells on one manifold.
  horn: () => `
    <rect x="2.2" y="4.4" width="3.4" height="15.2" rx="1.2" fill="${GRANITE}" ${L} stroke-width="1.6"/>
    <path d="M5.6 6.4 L10.6 6.4 L14.4 4 L14.4 10 L10.6 7.8 L5.6 7.8 Z" fill="${POWDER}" ${L} stroke-width="1.5"/>
    <path d="M5.6 11.3 L13.2 11.3 L19.6 8.2 L19.6 15.8 L13.2 12.7 L5.6 12.7 Z" fill="${POWDER}" ${L} stroke-width="1.5"/>
    <path d="M5.6 16.2 L11.8 16.2 L16.4 13.8 L16.4 20 L11.8 17.6 L5.6 17.6 Z" fill="${POWDER}" ${L} stroke-width="1.5"/>
    <path d="M21.4 9.6 Q22.9 12 21.4 14.4" ${L} fill="none" stroke-width="1.6"/>`,
  // A concert harp, with a gust of wind across its strings (the Aeolian harp).
  harp: () => `
    <path d="M16.6 2.8 Q19.2 1.6 21.8 3.2" stroke="${SKY}" stroke-width="1.7" stroke-linecap="round" fill="none"/>
    <path d="M8.8 4.9 L8.8 20.3 M11.2 5.3 L11.2 18.3 M13.6 6.6 L13.6 16.1 M16 8.8 L16 14" stroke="${SUN}" stroke-width="1.3" stroke-linecap="round"/>
    <path d="M5.8 21 L5.8 5" ${L} stroke-width="2.4"/>
    <path d="M5.8 5 C9.8 3 13.4 5.4 15.4 7.8 C16.9 9.6 18.5 10.6 19.6 11.1" ${L} fill="none" stroke-width="2.2"/>
    <path d="M19.6 11.1 L8.6 21" stroke="${INK}" stroke-width="4.4" stroke-linecap="round"/>
    <path d="M19.6 11.1 L8.6 21" stroke="${WOOD}" stroke-width="2" stroke-linecap="round"/>
    <path d="M3.8 21.2 L11.2 21.2" ${L} stroke-width="2.2"/>`,
  mountain: () => `
    <path d="M1.8 20.4 L9.4 7.6 L13 13.2 L16.2 8.8 L22.2 20.4 Z" fill="${GRANITE}" ${L}/>
    <path d="M9.4 7.6 L11.6 11.2 L10.4 10.8 L9.4 12.1 L8.4 10.8 L7.3 11.2 Z" fill="${WHITE}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>
    <path d="M16.2 8.8 L18 12 L17.1 11.7 L16.3 12.6 L15.4 11.6 L14.6 12 Z" fill="${WHITE}" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>`,
};

export const ICON_NAMES = Object.keys(BODIES) as IconName[];

/** An icon's markup without the svg wrapper, in its 24 × 24 space. */
export function iconBody(name: IconName): string {
  return BODIES[name]();
}

/** An icon placed inside another drawing: centered on (cx, cy), `size` units wide. */
export function iconAt(name: IconName, cx: number, cy: number, size: number, extra = ""): string {
  const s = size / 24;
  return `<g class="icon icon--${name}" transform="translate(${n(cx - size / 2)} ${n(cy - size / 2)}) scale(${n(s, 3)})"${extra}>${iconBody(name)}</g>`;
}

/** A standalone 24 × 24 icon. Pass a title when the icon carries meaning. */
export function icon(name: IconName, opts: { size?: number; title?: string } = {}): string {
  return svg("0 0 24 24", iconBody(name), {
    cls: `icon icon--${name}`,
    ...(opts.size !== undefined ? { width: opts.size, height: opts.size } : {}),
    ...(opts.title !== undefined ? { title: opts.title } : {}),
  });
}
