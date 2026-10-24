// The app icon: a snowcapped Wasatch peak under the sun, a gull overhead.
// Simple enough to read at 16 px; web/public/icon.svg is generated from it.
import { BILL, GRANITE, INK, POWDER, SKY, SKY_DEEP, SUN, WHITE } from "./palette.ts";

/** The icon as a standalone SVG string (viewBox 0 0 64 64). `full` drops the rounded corners. */
export function appIconSvg(opts: { full?: boolean } = {}): string {
  const r = opts.full ? 0 : 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
  <defs>
    <linearGradient id="appicon-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${SKY_DEEP}"/><stop offset="1" stop-color="${SKY}"/>
    </linearGradient>
    <clipPath id="appicon-clip"><rect x="0" y="0" width="64" height="64" rx="${r}"/></clipPath>
  </defs>
  <g clip-path="url(#appicon-clip)">
    <rect x="0" y="0" width="64" height="64" fill="url(#appicon-sky)"/>
    <circle cx="45" cy="19" r="8.5" fill="${SUN}" stroke="${INK}" stroke-width="2.6"/>
    <path d="M13 13.5 Q16 10.5 19 13 Q22 10.5 25 13.2" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    <path d="M18.2 13.4 L20.4 13.9 L18.2 14.5 Z" fill="${BILL}"/>
    <path d="M-2 66 L-2 50 L22 24 L31 35 L40 26 L66 52 L66 66 Z" fill="${GRANITE}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M22 24 L27.6 30.4 L25 30 L22.6 32.6 L20 30.2 L17.4 31 Z" fill="${WHITE}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M40 26 L44.6 30.6 L42.6 30.4 L40.4 32.4 L38.4 30.6 L35.8 31.2 Z" fill="${WHITE}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M-2 56 Q16 51 32 55 T66 54 L66 66 L-2 66 Z" fill="${POWDER}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
  </g>
  <rect x="1.5" y="1.5" width="61" height="61" rx="${Math.max(0, r - 1)}" fill="none" stroke="${INK}" stroke-width="3"/>
</svg>`;
}
