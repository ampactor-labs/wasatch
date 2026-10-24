// Die-cut stickers: a drop shadow, an ink edge, a white die-cut margin, then
// the sticker face with an icon and a bold display word, slightly tilted.
import { iconAt } from "./icons.ts";
import {
  HAZE,
  INK,
  JELLO,
  LAKE,
  LAKE_DEEP,
  NIGHT,
  PINK,
  POWDER,
  SKY,
  SKY_DEEP,
  SUN,
  WHITE,
} from "./palette.ts";
import { esc, n, smoothPath, svg, type Pt } from "./util.ts";

export type StickerKind =
  | "801"
  | "POW DAY"
  | "BLUEBIRD"
  | "INVERSION"
  | "LAKE EFFECT"
  | "SEND IT"
  | "LISTEN LOCAL"
  | "THE LAKE IS LOW"
  | "FIRST CHAIR"
  | "LAST CHAIR";

export const STICKER_KINDS: readonly StickerKind[] = [
  "801",
  "POW DAY",
  "BLUEBIRD",
  "INVERSION",
  "LAKE EFFECT",
  "SEND IT",
  "LISTEN LOCAL",
  "THE LAKE IS LOW",
  "FIRST CHAIR",
  "LAST CHAIR",
];

const DISPLAY = `font-family="Shrikhand, 'Bowlby One', 'Arial Black', sans-serif"`;
const MONO = `font-family="'Space Mono', ui-monospace, monospace"`;
const MOON = "#FFF1A8";

function word(text: string, x: number, y: number, size: number, fill: string, stroke = 5): string {
  return `<text x="${n(x)}" y="${n(y)}" text-anchor="middle" ${DISPLAY} font-size="${size}" fill="${fill}" stroke="${INK}" stroke-width="${stroke}" stroke-linejoin="round" paint-order="stroke">${esc(text)}</text>`;
}

function small(text: string, x: number, y: number, size: number, fill: string): string {
  return `<text x="${n(x)}" y="${n(y)}" text-anchor="middle" ${MONO} font-weight="700" font-size="${size}" letter-spacing="1.5" fill="${fill}">${esc(text)}</text>`;
}

function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)} A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)} A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)} Z`;
}

function roundRect(cx: number, cy: number, w: number, h: number, r: number): string {
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const x1 = cx + w / 2;
  const y1 = cy + h / 2;
  return `M${n(x0 + r)} ${n(y0)} L${n(x1 - r)} ${n(y0)} Q${n(x1)} ${n(y0)} ${n(x1)} ${n(y0 + r)} L${n(x1)} ${n(y1 - r)} Q${n(x1)} ${n(y1)} ${n(x1 - r)} ${n(y1)} L${n(x0 + r)} ${n(y1)} Q${n(x0)} ${n(y1)} ${n(x0)} ${n(y1 - r)} L${n(x0)} ${n(y0 + r)} Q${n(x0)} ${n(y0)} ${n(x0 + r)} ${n(y0)} Z`;
}

function cloud(cx: number, cy: number, w: number, h: number, bumps = 9): string {
  const pts: Pt[] = [];
  const steps = bumps * 2;
  for (let k = 0; k < steps; k++) {
    const a = (k / steps) * Math.PI * 2;
    const out = k % 2 === 0 ? 1.0 : 0.88;
    pts.push([cx + Math.cos(a) * (w / 2) * out, cy + Math.sin(a) * (h / 2) * out]);
  }
  return smoothPath(pts, true, 1);
}

function starburst(cx: number, cy: number, rOut: number, rIn: number, spikes: number): string {
  const pts: string[] = [];
  for (let k = 0; k < spikes * 2; k++) {
    const r = k % 2 === 0 ? rOut : rIn;
    const a = (k / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    pts.push(`${k === 0 ? "M" : "L"}${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}`);
  }
  return pts.join("") + "Z";
}

function shield(cx: number, cy: number, w: number, h: number): string {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h * 0.12;
  const y2 = cy + h / 2;
  return `M${n(x0 + 14)} ${n(y0)} L${n(x1 - 14)} ${n(y0)} Q${n(x1)} ${n(y0)} ${n(x1)} ${n(y0 + 14)} L${n(x1)} ${n(y1)} Q${n(x1)} ${n(y2 - 18)} ${n(cx)} ${n(y2)} Q${n(x0)} ${n(y2 - 18)} ${n(x0)} ${n(y1)} L${n(x0)} ${n(y0 + 14)} Q${n(x0)} ${n(y0)} ${n(x0 + 14)} ${n(y0)} Z`;
}

function ticket(cx: number, cy: number, w: number, h: number, notch: number): string {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return `M${n(x0 + 10)} ${n(y0)} L${n(x1 - 10)} ${n(y0)} Q${n(x1)} ${n(y0)} ${n(x1)} ${n(y0 + 10)} L${n(x1)} ${n(cy - notch)} A${n(notch)} ${n(notch)} 0 0 0 ${n(x1)} ${n(cy + notch)} L${n(x1)} ${n(y1 - 10)} Q${n(x1)} ${n(y1)} ${n(x1 - 10)} ${n(y1)} L${n(x0 + 10)} ${n(y1)} Q${n(x0)} ${n(y1)} ${n(x0)} ${n(y1 - 10)} L${n(x0)} ${n(cy + notch)} A${n(notch)} ${n(notch)} 0 0 0 ${n(x0)} ${n(cy - notch)} L${n(x0)} ${n(y0 + 10)} Q${n(x0)} ${n(y0)} ${n(x0 + 10)} ${n(y0)} Z`;
}

/** Chunky headphones, centered on (cx, cy), about 50 wide. */
function headphones(cx: number, cy: number): string {
  return `<g class="sticker-headphones">
    <path d="M${cx - 20} ${cy + 8} C${cx - 22} ${cy - 22} ${cx + 22} ${cy - 22} ${cx + 20} ${cy + 8}" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M${cx - 20} ${cy + 8} C${cx - 22} ${cy - 22} ${cx + 22} ${cy - 22} ${cx + 20} ${cy + 8}" fill="none" stroke="${PINK}" stroke-width="4" stroke-linecap="round"/>
    <rect x="${cx - 29}" y="${cy - 1}" width="15" height="22" rx="6" fill="${SUN}" stroke="${INK}" stroke-width="3"/>
    <rect x="${cx + 14}" y="${cy - 1}" width="15" height="22" rx="6" fill="${SUN}" stroke="${INK}" stroke-width="3"/>
    <path d="M${cx - 9} ${cy + 4} Q${cx - 4} ${cy + 10} ${cx - 9} ${cy + 16} M${cx + 9} ${cy + 4} Q${cx + 4} ${cy + 10} ${cx + 9} ${cy + 16}" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
  </g>`;
}

interface Spec {
  w: number;
  h: number;
  shape: string;
  fill: string;
  tilt: number;
  face: string;
  title: string;
}

function spec(kind: StickerKind): Spec {
  switch (kind) {
    case "801":
      return {
        w: 180, h: 180, shape: circle(90, 90, 64), fill: SKY, tilt: -6, title: "801",
        face: `<circle cx="90" cy="90" r="54" fill="none" stroke="${WHITE}" stroke-width="2.5" stroke-dasharray="5 6" opacity=".9"/>
          ${iconAt("mountain", 90, 60, 42)}${word("801", 90, 124, 50, SUN, 6)}`,
      };
    case "POW DAY":
      return {
        w: 230, h: 160, shape: cloud(115, 80, 190, 112), fill: POWDER, tilt: 4, title: "Pow day",
        face: `${iconAt("snowflake", 44, 58, 24)}${iconAt("snowflake", 186, 114, 20)}${iconAt("snowflake", 182, 44, 15)}
          ${word("POW DAY", 115, 92, 31, SKY, 6)}`,
      };
    case "BLUEBIRD":
      return {
        w: 240, h: 120, shape: roundRect(120, 60, 206, 70, 35), fill: SKY, tilt: -3, title: "Bluebird",
        face: `${iconAt("sun", 44, 60, 38)}${word("BLUEBIRD", 144, 70, 26, WHITE, 5)}`,
      };
    case "INVERSION":
      return {
        w: 190, h: 210, shape: shield(95, 104, 142, 166), fill: HAZE, tilt: 5, title: "Inversion",
        face: `${iconAt("lid", 95, 66, 58)}${word("INVERSION", 95, 134, 23, POWDER, 5)}${small("THE LID IS ON", 95, 158, 11, INK)}`,
      };
    case "LAKE EFFECT":
      return {
        w: 230, h: 170, shape: cloud(115, 85, 196, 126, 8), fill: LAKE, tilt: -4, title: "Lake effect",
        face: `${iconAt("snowflake", 46, 64, 26)}${iconAt("shrimp", 186, 118, 26)}
          ${word("LAKE", 118, 80, 29, WHITE, 5)}${word("EFFECT", 118, 114, 29, WHITE, 5)}`,
      };
    case "SEND IT":
      return {
        w: 210, h: 210, shape: starburst(105, 105, 90, 74, 16), fill: PINK, tilt: -8, title: "Send it",
        face: `${word("SEND", 105, 100, 36, SUN, 6)}${word("IT!", 105, 140, 36, SUN, 6)}`,
      };
    case "LISTEN LOCAL":
      return {
        w: 190, h: 190, shape: circle(95, 95, 70), fill: JELLO, tilt: 6, title: "Listen local",
        face: `${headphones(95, 60)}${word("LISTEN", 95, 112, 27, POWDER, 5)}${word("LOCAL", 95, 142, 27, POWDER, 5)}`,
      };
    case "THE LAKE IS LOW":
      return {
        w: 240, h: 150, shape: ticket(120, 75, 206, 104, 12), fill: LAKE_DEEP, tilt: -5, title: "The lake is low",
        face: `${iconAt("drop", 50, 72, 44)}
          <path d="M84 104 L208 104" stroke="${SKY}" stroke-width="2.5" stroke-dasharray="6 5" stroke-linecap="round"/>
          ${word("THE LAKE", 146, 66, 22, POWDER, 4.5)}${word("IS LOW", 146, 96, 27, SUN, 5)}`,
      };
    case "FIRST CHAIR":
      return {
        w: 230, h: 150, shape: roundRect(115, 75, 196, 104, 20), fill: SKY_DEEP, tilt: 3, title: "First chair",
        face: `<circle cx="56" cy="72" r="30" fill="${SUN}" stroke="${INK}" stroke-width="3"/>${iconAt("chairlift", 56, 72, 46)}
          ${word("FIRST", 146, 70, 27, WHITE, 5)}${word("CHAIR", 146, 102, 27, WHITE, 5)}`,
      };
    case "LAST CHAIR":
      return {
        w: 230, h: 150, shape: roundRect(115, 75, 196, 104, 20), fill: NIGHT, tilt: -2, title: "Last chair",
        face: `<circle cx="56" cy="72" r="30" fill="${MOON}" stroke="${INK}" stroke-width="3"/>${iconAt("chairlift", 56, 72, 46)}
          <circle cx="104" cy="40" r="2" fill="${SUN}"/><circle cx="200" cy="44" r="1.6" fill="${SUN}"/><circle cx="190" cy="112" r="1.8" fill="${SUN}"/>
          ${word("LAST", 146, 70, 27, SUN, 5)}${word("CHAIR", 146, 102, 27, SUN, 5)}`,
      };
  }
}

/** A die-cut sticker. Classes: `.sticker`, `.sticker--<slug>`, `.sticker-face`. */
export function sticker(kind: StickerKind, opts: { title?: string; tilt?: number } = {}): string {
  const s = spec(kind);
  const tilt = opts.tilt ?? s.tilt;
  const cx = s.w / 2;
  const cy = s.h / 2;
  const slug = kind.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const body = `<g transform="rotate(${tilt} ${n(cx)} ${n(cy)})">
    <path d="${s.shape}" transform="translate(3.5 5)" fill="${INK}" stroke="${INK}" stroke-width="19" stroke-linejoin="round" opacity=".2"/>
    <path d="${s.shape}" fill="${WHITE}" stroke="${INK}" stroke-width="19" stroke-linejoin="round"/>
    <path d="${s.shape}" fill="${WHITE}" stroke="${WHITE}" stroke-width="15.5" stroke-linejoin="round"/>
    <g class="sticker-face"><path d="${s.shape}" fill="${s.fill}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>${s.face}</g>
  </g>`;
  const pad = 14;
  return svg(`${-pad} ${-pad} ${s.w + pad * 2} ${s.h + pad * 2}`, body, {
    cls: `sticker sticker--${slug}`,
    title: opts.title ?? s.title,
  });
}
