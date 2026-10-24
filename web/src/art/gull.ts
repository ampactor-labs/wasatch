// The valley's conductor: a California gull, Utah's state bird, with ski
// goggles pushed up on its head and a baton in its near wing.
//
// Field marks: white head and body, a gray back (mantle), black wingtips with
// a white "mirror", a yellow bill with a red and a black spot near the tip of
// the lower mandible, a red ring around a dark eye, greenish-yellow legs.
import {
  BILL,
  BILL_RED,
  GULL_MANTLE,
  INK,
  LEG,
  PINK,
  PURPLE,
  SUN,
  SUNSET,
  WHITE,
} from "./palette.ts";
import { svg, uid } from "./util.ts";

export type GullPose = "idle" | "conduct" | "bow";

/** Where the near wing pivots (viewBox units), for CSS transform-origin. */
export const GULL_SHOULDER = { x: 118, y: 124 } as const;

const WING_ANGLE: Record<GullPose, number> = { idle: 0, conduct: -70, bow: -24 };

const S = `stroke="${INK}" stroke-linecap="round" stroke-linejoin="round"`;

/**
 * The gull, 230 × 235 viewBox, facing right.
 * Classes: `.gull` on the svg, `.gull--<pose>`, `.gull-bird` (everything),
 * `.gull-wing` (the baton wing, rotating about GULL_SHOULDER; its resting
 * angle is the CSS variable `--wing`), `.gull-baton`, `.gull-head`.
 */
export function gull(opts: { pose?: GullPose; title?: string } = {}): string {
  const pose = opts.pose ?? "idle";
  const id = uid("gull");
  const angle = WING_ANGLE[pose];
  const birdTilt = pose === "bow" ? `rotate(14 112 222)` : "";

  const defs = `<defs>
    <linearGradient id="${id}-lens" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${SUN}"/><stop offset=".45" stop-color="${SUNSET}"/>
      <stop offset=".75" stop-color="${PINK}"/><stop offset="1" stop-color="${PURPLE}"/>
    </linearGradient>
    <clipPath id="${id}-wingclip"><path d="${WING}"/></clipPath>
  </defs>`;

  const shadow = `<ellipse cx="114" cy="226" rx="56" ry="5.5" fill="${INK}" opacity=".14"/>`;

  const legs = `<g class="gull-legs">
    <path d="M110 194 L104 216 M124 196 L128 218" ${S} stroke-width="9" fill="none"/>
    <path d="M110 194 L104 216 M124 196 L128 218" stroke="${LEG}" stroke-width="4.5" stroke-linecap="round" fill="none"/>
    <path d="M102 214 L122 221 L111 222 L117 228 L96 222 Z" fill="${LEG}" ${S} stroke-width="2.6"/>
    <path d="M126 216 L146 223 L135 224 L141 230 L120 224 Z" fill="${LEG}" ${S} stroke-width="2.6"/>
  </g>`;

  const body = `<g class="gull-body">
    <path d="M40 140 C30 141 22 143 14 148 C25 152 38 151 50 146 Z" fill="${INK}" ${S} stroke-width="3"/>
    <path d="M168 118 C186 146 176 192 132 198 C96 204 62 190 46 162 L18 150 C22 144 28 140 34 138 L46 134 C68 108 110 100 140 104 C152 106 162 110 168 118 Z"
      fill="${WHITE}" ${S} stroke-width="4"/>
    <path d="M141 107 C110 103 72 111 50 133 L42 138 C64 146 98 146 125 138 C139 133 149 123 150 112 Z"
      fill="${GULL_MANTLE}" ${S} stroke-width="3"/>
    <path d="M60 128 Q80 122 100 126 M70 137 Q90 133 112 135" stroke="${INK}" stroke-width="2" stroke-linecap="round" fill="none" opacity=".5"/>
  </g>`;

  const head = `<g class="gull-head">
    <path d="M110 68 C118 50 162 44 172 64" ${S} stroke-width="8" fill="none"/>
    <path d="M110 68 C118 50 162 44 172 64" stroke="${PINK}" stroke-width="3.4" stroke-linecap="round" fill="none"/>
    <circle cx="140" cy="80" r="31" fill="${WHITE}" ${S} stroke-width="4"/>
    <path d="M166 80 C180 78 196 81 207 87 C198 90 183 90 168 90 Z" fill="${BILL}" ${S} stroke-width="3"/>
    <path d="M168 90 C182 90 195 91 204 90 C200 96 187 99 171 97 Z" fill="${BILL}" ${S} stroke-width="3"/>
    <circle cx="191" cy="93" r="3.6" fill="${BILL_RED}"/>
    <circle cx="198.5" cy="91.6" r="2.6" fill="${INK}"/>
    <path d="M176 84 L181 84.5" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    <circle cx="151" cy="79" r="7.4" fill="none" stroke="${BILL_RED}" stroke-width="1.8"/>
    <circle cx="151" cy="79" r="5" fill="${INK}"/>
    <circle cx="153" cy="77" r="1.7" fill="${WHITE}"/>
    <path d="M143 70 Q151 65.5 159 69.5" ${S} stroke-width="2.6" fill="none"/>
    <g transform="rotate(-9 144 47)">
      <rect x="121" y="37" width="46" height="19" rx="9.5" fill="url(#${id}-lens)" ${S} stroke-width="3.6"/>
      <path d="M128 43 Q136 40 144 41" stroke="${WHITE}" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".85"/>
    </g>
  </g>`;

  const wing = `<g class="gull-wing" style="--wing:${angle}deg" transform="rotate(${angle} ${GULL_SHOULDER.x} ${GULL_SHOULDER.y})">
    <g class="gull-baton">
      <path d="M124 188 L172 206" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>
      <path d="M128 189.5 L170 205.3" stroke="${WHITE}" stroke-width="2.2" stroke-linecap="round"/>
      <ellipse cx="127" cy="189" rx="5.5" ry="4" transform="rotate(20 127 189)" fill="${SUN}" ${S} stroke-width="2.4"/>
    </g>
    <path d="${WING}" fill="${GULL_MANTLE}" ${S} stroke-width="3.6"/>
    <g clip-path="url(#${id}-wingclip)">
      <ellipse cx="126" cy="190" rx="22" ry="17" fill="${INK}"/>
      <circle cx="125" cy="182" r="2.8" fill="${WHITE}"/>
    </g>
    <path d="${WING}" fill="none" ${S} stroke-width="3.6"/>
    <path d="M112 146 Q120 150 130 146 M113 158 Q121 162 131 158" stroke="${INK}" stroke-width="2" stroke-linecap="round" fill="none" opacity=".55"/>
  </g>`;

  const bird = `<g class="gull-bird"${birdTilt ? ` transform="${birdTilt}"` : ""}>${legs}${body}${head}${wing}</g>`;
  return svg("0 0 230 236", defs + shadow + bird, {
    cls: `gull gull--${pose}`,
    ...(opts.title !== undefined ? { title: opts.title } : {}),
  });
}

/** The near wing, hanging at rest from the shoulder. */
const WING =
  "M116 120 C132 116 143 132 141 150 C139 166 132 180 124 191 C117 184 110 168 108 152 C106 138 106 124 116 120 Z";
