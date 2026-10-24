// The pre-tap screen: title, two status lines, the gull conducting in front
// of a 70s ski-poster sunburst, a couple of stickers, the big button, and the
// skyline with the shredder waiting near the north end. Styled by boot.css.
import { gull } from "./gull.ts";
import { INK, PINK, POWDER, SUN, SUNSET, WHITE } from "./palette.ts";
import { shredderGroup } from "./shredder.ts";
import { type Daypart, skyGradient } from "./sky.ts";
import { defaultSkylineData, skyline, skylineGeometry } from "./skyline.ts";
import { type StickerKind, sticker } from "./stickers.ts";
import { esc, hash01, mix, n, svg, uid } from "./util.ts";

export interface BootSceneOpts {
  daypart?: Daypart;
  status1?: string;
  status2?: string;
  cloud?: number;
  haze?: number;
  /** Two stickers for the top corners. */
  stickers?: readonly [StickerKind, StickerKind];
  /**
   * The skyline's drawing size. Pass the screen's width and the height you
   * want, e.g. clamp(150, 24vh, 260); it fills the width exactly. Re-render
   * on resize.
   */
  skylineWidth?: number;
  skylineHeight?: number;
}

/** Defaults for the boot skyline and where the rider waits (t along the ridge). */
export const BOOT_SKYLINE = { width: 600, height: 220, riderAt: 0.122, riderScale: 0.34 } as const;

const isNight = (d: Daypart) => d === "nocturne" || d === "last-trains";

function cloudSvg(cls: string, fill: string): string {
  const d =
    "M24 52 C8 52 6 34 20 31 C20 15 40 9 50 20 C56 6 82 6 86 23 C102 20 112 34 104 44 C112 50 106 56 96 52 Z";
  return svg("0 0 120 60", `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/>`, {
    cls: `boot__cloud ${cls}`,
  });
}

/** The sun (or the moon at night) that sits behind the conductor. */
function sunSvg(daypart: Daypart): string {
  if (isNight(daypart)) {
    return svg(
      "0 0 200 200",
      `<circle cx="100" cy="100" r="92" fill="#FFF1A8" opacity=".14"/>
       <path d="M86 30 A72 72 0 1 0 170 128 A58 58 0 1 1 86 30 Z" fill="#FFF1A8" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
       <circle cx="78" cy="110" r="6" fill="${INK}" opacity=".12"/><circle cx="104" cy="146" r="4.5" fill="${INK}" opacity=".12"/>`,
      { cls: "boot__moon" },
    );
  }
  const id = uid("bootsun");
  const color = daypart === "first-light" ? mix(SUN, PINK, 0.35) : daypart === "rush" ? mix(SUN, SUNSET, 0.25) : SUN;
  const stripe = mix(color, SUNSET, 0.55);
  return svg(
    "0 0 200 200",
    `<defs><clipPath id="${id}"><circle cx="100" cy="100" r="70"/></clipPath></defs>
     <circle cx="100" cy="100" r="96" fill="${color}" opacity=".22"/>
     <circle cx="100" cy="100" r="70" fill="${color}"/>
     <g clip-path="url(#${id})" fill="${stripe}"><rect x="20" y="118" width="160" height="7"/><rect x="20" y="134" width="160" height="9"/><rect x="20" y="152" width="160" height="12"/></g>
     <circle cx="100" cy="100" r="70" fill="none" stroke="${INK}" stroke-width="4"/>`,
    { cls: "boot__sunsvg" },
  );
}

function starsSvg(): string {
  const stars: string[] = [];
  for (let k = 0; k < 44; k++) {
    const x = hash01(k * 3 + 1) * 1000;
    const y = hash01(k * 5 + 2) * 760;
    const r = 1.4 + hash01(k * 7 + 3) * 2.6;
    stars.push(
      `M${n(x)} ${n(y - r * 2)} L${n(x + r * 0.45)} ${n(y - r * 0.45)} L${n(x + r * 2)} ${n(y)} L${n(x + r * 0.45)} ${n(y + r * 0.45)} L${n(x)} ${n(y + r * 2)} L${n(x - r * 0.45)} ${n(y + r * 0.45)} L${n(x - r * 2)} ${n(y)} L${n(x - r * 0.45)} ${n(y - r * 0.45)} Z`,
    );
  }
  return svg("0 0 1000 1000", `<path d="${stars.join("")}" fill="${SUN}" opacity=".85"/>`, {
    cls: "boot__stars",
  }).replace("<svg ", '<svg preserveAspectRatio="xMidYMid slice" ');
}

/**
 * HTML for the boot screen. Slots the app fills:
 *   [data-slot="status1"], [data-slot="status2"]  the two status lines
 *   button[data-action="listen"]                   the tap that starts sound
 *   .skyline-playhead                              holds the waiting shredder
 */
export function bootScene(opts: BootSceneOpts = {}): string {
  const daypart = opts.daypart ?? "rush";
  const night = isNight(daypart);
  const width = opts.skylineWidth ?? BOOT_SKYLINE.width;
  const height = opts.skylineHeight ?? BOOT_SKYLINE.height;
  const data = defaultSkylineData();
  const geo = skylineGeometry(data, { width, height });
  const p = geo.at(BOOT_SKYLINE.riderAt);
  const riderScale = BOOT_SKYLINE.riderScale * Math.max(0.75, Math.min(1.6, height / 220));
  const rider = `<g class="skyline-playhead"><g class="boot-rider" transform="translate(${n(p.x)} ${n(p.y - 1)}) rotate(${n(p.angle)}) scale(${n(riderScale, 3)})">${shredderGroup()}</g></g>`;
  const ridge = skyline(data, { width, height, daypart, haze: opts.haze ?? 0, flags: true }).replace(
    `<g class="skyline-playhead"></g>`,
    rider,
  );
  const [a, b] = opts.stickers ?? (["801", "LISTEN LOCAL"] as const);
  const background = skyGradient(daypart, { cloud: opts.cloud ?? 0, haze: opts.haze ?? 0 });
  const cloudFill = night ? mix(POWDER, "#3D4A7A", 0.55) : WHITE;
  const gullsFar = svg(
    "0 0 120 50",
    `<path d="M6 30 q8 -9 16 0 q8 -9 16 0 M48 14 q6 -7 12 0 q6 -7 12 0 M86 38 q7 -8 14 0 q7 -8 14 0" fill="none" stroke="${night ? POWDER : INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    { cls: "boot__farbirds" },
  );
  return `<section class="boot boot--${daypart}" style="background:${esc(background)}">
  <div class="boot__decor" aria-hidden="true">
    ${night ? starsSvg() : ""}
    ${cloudSvg("boot__cloud--a", cloudFill)}${cloudSvg("boot__cloud--b", cloudFill)}${cloudSvg("boot__cloud--c", cloudFill)}
    ${gullsFar}
  </div>
  <div class="boot__stickers" aria-hidden="true">
    <div class="boot__sticker boot__sticker--a">${sticker(a)}</div>
    <div class="boot__sticker boot__sticker--b">${sticker(b)}</div>
  </div>
  <h1 class="boot__title"><span class="boot__title-a">Wasatch</span><span class="boot__title-b">Symphony</span></h1>
  <div class="sign boot__status" role="status" aria-live="polite">
    <p class="sign__line" data-slot="status1">${esc(opts.status1 ?? "")}</p>
    <p class="sign__line" data-slot="status2">${esc(opts.status2 ?? "")}</p>
  </div>
  <div class="boot__stage">
    ${night ? "" : `<div class="boot__rays" aria-hidden="true"></div>`}
    <div class="boot__sun" aria-hidden="true">${sunSvg(daypart)}</div>
    <div class="boot__gull" aria-hidden="true">${gull({ pose: "conduct" })}</div>
    <button type="button" class="boot__listen" data-action="listen">
      <span class="boot__play" aria-hidden="true"></span>
      <span class="boot__listen-text">Listen to the Wasatch</span>
    </button>
  </div>
  <div class="boot__skyline" aria-hidden="true">${ridge}</div>
</section>`;
}
