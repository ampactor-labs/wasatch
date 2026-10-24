// The Wasatch art system: pure functions returning SVG or HTML markup.
// Import the CSS once in the app: styles/fonts.css, tokens.css, art.css,
// signs.css and boot.css (or styles/index.css, which imports them all).
export { esc } from "./util.ts";
export * as palette from "./palette.ts";
export { type Daypart, DAYPARTS, daypartAt, skyGradient } from "./sky.ts";
export { gull, type GullPose, GULL_SHOULDER } from "./gull.ts";
export { shredder, shredderGroup, SHREDDER_HEIGHT, SHREDDER_VIEWBOX } from "./shredder.ts";
export {
  defaultSkylineData,
  skyline,
  skylineGeometry,
  type SkylineData,
  type SkylineGeometry,
  type SkylineOpts,
  type SkylinePoint,
  type SkylineSummit,
} from "./skyline.ts";
export { sticker, STICKER_KINDS, type StickerKind } from "./stickers.ts";
export { trailIcon, trailName, type TrailKind, type Vantage, VANTAGE_TRAIL } from "./trail.ts";
export { icon, iconAt, iconBody, ICON_NAMES, type IconName } from "./icons.ts";
export {
  CANYON_MOUTHS,
  DEFAULT_MAP_BOUNDS,
  mapBase,
  mapUnit,
  type MapBaseOpts,
  type MapBounds,
  mapHeightFor,
  mapProjection,
  type MapProjection,
} from "./map.ts";
export { DEFAULT_DIAL_LABELS, harmonyDial, type HarmonyDialOpts } from "./dial.ts";
export { BOOT_SKYLINE, bootScene, type BootSceneOpts } from "./boot.ts";
export { appIconSvg } from "./appicon.ts";
export { CREST_ELEV_FT, CREST_LAT, CREST_LON, THEME_SUMMITS } from "./crest-data.ts";
