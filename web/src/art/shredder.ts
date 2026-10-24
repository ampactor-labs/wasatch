// The shredder: a goofy-footed snowboarder (right foot forward) in a neon
// 80s one-piece, carving to the right. Riding south along the skyline, a goofy
// rider shows the viewer their back and looks downhill over the right shoulder.
//
// Anchor convention: (0, 0) is the center of the board. The app places the
// group with transform="translate(x y) rotate(slopeDeg) scale(s)".
import { INK, PINK, POWDER, PURPLE, SKY, SKY_DEEP, SUN, SUNSET, WHITE } from "./palette.ts";
import { svg, uid } from "./util.ts";

const S = `stroke="${INK}" stroke-linecap="round" stroke-linejoin="round"`;

/** The rider's natural height in its own units (board to pom-pom). */
export const SHREDDER_HEIGHT = 118;

/**
 * The rider as an SVG group with its origin at the board's center.
 * Classes: `.shredder`, `.shredder-rider` (body, for a bob), `.shredder-spray`
 * (the snow thrown off the tail; animate scale/opacity), `.shredder-board`.
 */
export function shredderGroup(opts: { spray?: boolean } = {}): string {
  const id = uid("shred");
  const spray = opts.spray ?? true;
  const defs = `<defs>
    <linearGradient id="${id}-lens" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${SUN}"/><stop offset=".5" stop-color="${SUNSET}"/><stop offset="1" stop-color="${PURPLE}"/>
    </linearGradient>
    <clipPath id="${id}-torso"><path d="${TORSO}"/></clipPath>
  </defs>`;

  const sprayGroup = spray
    ? `<g class="shredder-spray">
        <path d="M-38 9 L-74 9 M-30 13.5 L-58 13.5" ${S} stroke-width="2.4" fill="none" opacity=".6"/>
        <circle cx="-66" cy="-6" r="8" fill="${WHITE}" ${S} stroke-width="2.4"/>
        <circle cx="-77" cy="-17" r="6" fill="${WHITE}" ${S} stroke-width="2.2"/>
        <circle cx="-85" cy="-4" r="4.6" fill="${WHITE}" ${S} stroke-width="2"/>
        <circle cx="-70" cy="-29" r="3.8" fill="${WHITE}" ${S} stroke-width="1.8"/>
        <circle cx="-59" cy="-20" r="4.2" fill="${WHITE}" ${S} stroke-width="1.8"/>
        <circle cx="-88" cy="-20" r="1.8" fill="${INK}"/>
        <circle cx="-81" cy="-33" r="1.5" fill="${INK}"/>
        <circle cx="-94" cy="-9" r="1.3" fill="${INK}"/>
      </g>`
    : "";

  const board = `<g class="shredder-board">
    <path d="M-48 3.5 L46 3.5 C54 3.5 60 -0.5 61.5 -7.5 C56 -4.2 52 -3.5 46 -3.5 L-48 -3.5 C-54 -3.5 -58.5 -4.5 -62.5 -8 C-60.5 -1 -55 3.5 -48 3.5 Z"
      fill="${SUN}" ${S} stroke-width="3"/>
    <path d="M-42 0 L40 0" stroke="${PINK}" stroke-width="2.2" stroke-linecap="round"/>
    <rect x="-25" y="-9.5" width="14" height="6.5" rx="2" fill="${INK}"/>
    <rect x="11" y="-9.5" width="14" height="6.5" rx="2" fill="${INK}"/>
  </g>`;

  const legs = `<g class="shredder-legs">
    <path d="M-18 -11 L-25 -29 L-8 -45" ${S} stroke-width="16" fill="none"/>
    <path d="M18 -11 L23 -30 L8 -47" ${S} stroke-width="16" fill="none"/>
    <path d="M-18 -11 L-25 -29 L-8 -45" stroke="${PINK}" stroke-width="10.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M18 -11 L23 -30 L8 -47" stroke="${PINK}" stroke-width="10.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M-27 -27.5 L-22 -31 M21 -32 L26 -28" stroke="${SUN}" stroke-width="3" stroke-linecap="round"/>
    <rect x="-26" y="-16" width="15" height="9" rx="3" fill="${SKY_DEEP}" ${S} stroke-width="2.6"/>
    <rect x="10" y="-16" width="15" height="9" rx="3" fill="${SKY_DEEP}" ${S} stroke-width="2.6"/>
  </g>`;

  const arms = `<g class="shredder-arms">
    <path d="M-9 -73 L-27 -80 L-43 -71" ${S} stroke-width="13" fill="none"/>
    <path d="M11 -72 L27 -66 L40 -54" ${S} stroke-width="13" fill="none"/>
    <path d="M-9 -73 L-27 -80 L-43 -71" stroke="${PINK}" stroke-width="7.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M11 -72 L27 -66 L40 -54" stroke="${PINK}" stroke-width="7.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="-45" cy="-70" r="6.2" fill="${SKY}" ${S} stroke-width="2.6"/>
    <circle cx="42" cy="-52" r="6.2" fill="${SKY}" ${S} stroke-width="2.6"/>
  </g>`;

  const torso = `<g class="shredder-torso">
    <path d="${TORSO}" fill="${PINK}"/>
    <g clip-path="url(#${id}-torso)">
      <path d="M-20 -58 L22 -72 L22 -64 L-20 -50 Z" fill="${SUN}"/>
      <path d="M-20 -48 L22 -62 L22 -56 L-20 -42 Z" fill="${SKY}"/>
      <path d="M-20 -40 L22 -54 L22 -50 L-20 -36 Z" fill="${POWDER}"/>
    </g>
    <path d="${TORSO}" fill="none" ${S} stroke-width="3.4"/>
  </g>`;

  const head = `<g class="shredder-head">
    <circle cx="4" cy="-93" r="13" fill="${SKY}" ${S} stroke-width="3"/>
    <path d="M-9 -95 C-9 -110 17 -110 17 -95 Z" fill="${SUN}" ${S} stroke-width="3"/>
    <path d="M-7.5 -101 L15.5 -101" stroke="${PINK}" stroke-width="3" stroke-linecap="round"/>
    <circle cx="-3" cy="-111" r="5" fill="${PINK}" ${S} stroke-width="2.6"/>
    <path d="M-10 -92 L18 -92" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <rect x="7" y="-97.5" width="13" height="10" rx="4" fill="url(#${id}-lens)" ${S} stroke-width="2.6"/>
  </g>`;

  return `<g class="shredder">${defs}${sprayGroup}<g class="shredder-rider">${legs}${board}${torso}${arms}${head}</g></g>`;
}

/** The one-piece's torso, back to the viewer, leaning into the turn. */
const TORSO = "M-15 -42 C-17 -58 -12 -75 1 -81 C13 -77 17 -61 15 -45 C9 -41 -9 -39 -15 -42 Z";

/** The viewBox that frames the rider and its spray; the anchor is (0, 0). */
export const SHREDDER_VIEWBOX = "-98 -122 164 138";

/** The rider as a standalone SVG (164 × 138 viewBox, anchor at 98, 122). */
export function shredder(opts: { spray?: boolean; title?: string } = {}): string {
  return svg(SHREDDER_VIEWBOX, shredderGroup(opts), {
    cls: "shredder-svg",
    ...(opts.title !== undefined ? { title: opts.title } : {}),
  });
}
