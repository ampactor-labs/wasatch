// The Wasatch palette. tokens.css defines the same values as CSS custom
// properties for the page; SVG art uses these constants directly so it renders
// the same anywhere (inline, as a standalone file, or rasterized).

export const INK = "#1B1F3B"; // outlines and text
export const POWDER = "#F7F4EA"; // snow, paper
export const SKY = "#4FA3D9"; // Alta bluebird
export const SKY_DEEP = "#1E5AA8";
export const SUNSET = "#FF6B35"; // measured values only
export const SUN = "#FFD23F";
export const PINK = "#FF4F9A"; // neon one-piece
export const JELLO = "#7AC74F"; // green Jell-O
export const LAKE = "#2EC4B6";
export const LAKE_DEEP = "#0E7C7B";
export const GRANITE = "#8D99AE";
export const WOOD = "#5C3A1E";
export const WOOD_TEXT = "#F2D16B";
export const NIGHT = "#0B1026";
export const HAZE = "#C9B79C";

// Supporting colors for the drawings.
export const WHITE = "#FFFFFF";
export const SAND = "#F1E6CF"; // valley floor on the map
export const MUDFLAT = "#E6D7B5"; // exposed lakebed
export const GULL_MANTLE = "#A7B3C4"; // a California gull's gray back
export const BILL = "#F6C425";
export const BILL_RED = "#E23D3D";
export const LEG = "#C3CF5E"; // greenish yellow
export const ROCK = "#6D7891"; // the range by day
export const ROCK_NIGHT = "#2B3362";
export const PURPLE = "#7B4FC9";
export const SNOW_SHADE = "#D9E6F2";

/** Ski trail-map colors. */
export const TRAIL_GREEN = "#2E9D4F";
export const TRAIL_BLUE = "#1E5AA8";
export const TRAIL_BLACK = INK;

/** Cold to warm, one per theme step (0 lowest summit, 9 highest). */
export const STEP_COLORS: readonly string[] = [
  SKY_DEEP,
  SKY,
  LAKE,
  JELLO,
  "#B5D33B",
  SUN,
  "#FFB13B",
  SUNSET,
  PINK,
  PURPLE,
];

export function stepColor(step: number): string {
  const i = Math.max(0, Math.min(STEP_COLORS.length - 1, Math.round(step)));
  return STEP_COLORS[i] ?? SUN;
}
