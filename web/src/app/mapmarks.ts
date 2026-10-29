// What the map says about the sound. Each note with a place rings where it
// is and says what it is ("E · Blue Line · Courthouse"); a ring closes on it
// in the moment before it sounds; it leaves a dot that fades over a minute,
// so a glance shows where the music has been coming from. The voices with no
// one place (the river's bass, the ridge's harp, the snow, the lake's drone)
// have homes on the map that light while they play.
//
// Plain elements over the map, animated by transform and opacity only, so
// the compositor runs them without repainting the map.

import { CANYON_MOUTHS, type MapBounds, type MapProjection } from "../art/index.ts";
import { n } from "../art/util.ts";
import type { NetworkFile } from "../engine/protocol.ts";
import type { Heard, PulseEvent, SoonEvent, VoiceEvent } from "../engine/host.ts";
import type { TopicId } from "./lowdown.ts";
import { midiName } from "./music.ts";

/** Inst codes (engine/src/compose.rs) to the colors they ring in. */
export const SOUND_COLOR: Record<number, string> = {
  1: "#FFD23F", // bell: TRAX
  2: "#FF4F9A", // horn: FrontRunner
  3: "#7AC74F", // marimba: GREENbike
  4: "#F7F4EA", // a snow grain
  5: "#FF6B35", // quake bell
  11: "#4FA3D9", // canyon drums: ski buses
  13: "#B8A1FF", // harp: the ridge wind
  14: "#1E5AA8", // bass: the rivers
  15: "#9AD0F5", // a swell: a plane
};
const DRUMS = new Set([6, 7, 8, 9, 10, 11, 12]);
const LINES = ["Blue Line", "Red Line", "Green Line", "S-Line"];

export function soundColor(i: number): string {
  return SOUND_COLOR[DRUMS.has(i) ? 11 : i] ?? "#FF6B35";
}

/** The note without its octave: "E♭". */
function pitch(m: number): string {
  return midiName(Math.round(m)).replace(/-?\d+$/, "");
}

function nearest<T extends { lat: number; lon: number }>(list: readonly T[], lat: number, lon: number): T | undefined {
  let best: T | undefined;
  let d = Infinity;
  for (const p of list) {
    const e = (p.lat - lat) ** 2 + ((p.lon - lon) * 0.76) ** 2;
    if (e < d) {
      d = e;
      best = p;
    }
  }
  return best;
}

/** What a sound on the map is, in a few words: its note and where it's from. */
export function soundName(e: { i: number; m: number; lat: number; lon: number; v?: number }, network: NetworkFile | null, tidy: (s: string) => string = (s) => s): string {
  const note = pitch(e.m);
  switch (e.i) {
    case 1: {
      const line = e.v !== undefined ? (LINES[e.v] ?? "TRAX") : "TRAX";
      const stop = network ? nearest(network.stops, e.lat, e.lon) : undefined;
      return stop ? `${note} · ${line} · ${tidy(stop.name)}` : `${note} · ${line}`;
    }
    case 2:
      return `${note} · FrontRunner's horn`;
    case 3:
      return `${note} · a GREENbike`;
    case 5:
      return `${note} · an earthquake`;
    case 15:
      return `${note} · a plane ${(e.v ?? 0) & 8 ? "landing" : "taking off"}`;
    default:
      if (DRUMS.has(e.i)) {
        if (e.v === 4) return "Drums · avalanche control";
        const canyon = nearest(CANYON_MOUTHS, e.lat, e.lon);
        return `Drums · a ski bus up ${canyon?.name ?? "the canyon"}`;
      }
      return note;
  }
}

/** Where the voices with no one place live: the gauges the bass reads, the
 * ridge the harp's wind blows over, the snow at Alta, the lake's drone. */
export interface VoiceHome {
  label: string;
  /** The inst code that lights it (−1: always sounding). */
  inst: number;
  lat: number;
  lon: number;
  topic: TopicId;
}
export const VOICE_HOMES: readonly VoiceHome[] = [
  // USGS 10171000, Jordan River at 1700 South, and 10168000, Little
  // Cottonwood Creek at the Jordan (their monitoring-location records).
  { label: "Bass", inst: 14, lat: 40.7336, lon: -111.9233, topic: "river" },
  { label: "Bass", inst: 14, lat: 40.6643, lon: -111.8989, topic: "river" },
  // The ridge between the Cottonwoods, and Alta, where the wind and the
  // snowfall are read (Open-Meteo at 40.588, −111.638).
  { label: "Harp", inst: 13, lat: 40.612, lon: -111.7, topic: "wind" },
  { label: "Snow", inst: 4, lat: 40.588, lon: -111.638, topic: "snow" },
  { label: "Drone", inst: -1, lat: 40.792, lon: -112.168, topic: "lake" },
];

/** The valley floor, where the sounds are: Bountiful to Draper, Saltair to
 * Alta and the canyons' names. */
const VALLEY_FLOOR = { n: 40.95, s: 40.45, w: -112.24, e: -111.56 };

/** The map's frame in a w × h box for a place to listen from (null:
 * everywhere). What it must show (the valley floor; from a place, 34 km
 * across, the far ring, leaning a third of the way toward the valley) fits
 * right of `inset` px on the left, where the harmony dial sits over the map
 * on a phone; the frame runs on under the dial, where the lake is. */
export function frameFor(place: { lat: number; lon: number } | null, w: number, h: number, inset = 0): MapBounds {
  const floor = VALLEY_FLOOR;
  const vLat = (floor.n + floor.s) / 2;
  const vLon = (floor.w + floor.e) / 2;
  const cLat = place ? place.lat + (vLat - place.lat) / 3 : vLat;
  const cLon = place ? place.lon + (vLon - place.lon) / 3 : vLon;
  const k = Math.cos((cLat * Math.PI) / 180);
  const latSpan = place ? 34 / 110.57 : floor.n - floor.s;
  const lonSpan = place ? 34 / (111.32 * k) : floor.e - floor.w;
  const seen = Math.max(w * 0.5, w - inset);
  // Pixels per degree of latitude: the tighter of the two fits.
  const px = Math.min(seen / (lonSpan * k), h / latSpan);
  const e = cLon + seen / (2 * px * k);
  return { n: cLat + h / (2 * px), s: cLat - h / (2 * px), w: e - w / (px * k), e };
}

/** How long a home stays lit after its voice last sounded, ms. */
const HOME_LIT_MS = 20_000;
/** How long a sound's dot stays on the map, ms. */
const GLOW_MS = 60_000;
/** Tags: at most this many at once, and one per this many ms. */
const MAX_TAGS = 2;
const TAG_GAP_MS = 650;
const TAG_MS = 2600;

interface Glow {
  lat: number;
  lon: number;
  color: string;
  /** performance.now() when it sounded. */
  t: number;
}

export class MapMarks {
  private host: HTMLElement | null = null;
  private proj: MapProjection | null = null;
  private u = 1;
  private glows: Glow[] = [];
  private tags: HTMLElement[] = [];
  private lastTag = 0;
  /** Per inst: when its home last flashed, and when it goes dark. */
  private flashed = new Map<number, number>();
  private darkTimers = new Map<number, number>();

  private readonly network: () => NetworkFile | null;
  private readonly tidy: (s: string) => string;
  /** Whether the map is everywhere (no one place to listen from). */
  private readonly everywhere: () => boolean;
  /** Paused, or the listener asked for less motion. */
  private readonly still: () => boolean;

  constructor(network: () => NetworkFile | null, tidy: (s: string) => string, everywhere: () => boolean, still: () => boolean) {
    this.network = network;
    this.tidy = tidy;
    this.everywhere = everywhere;
    this.still = still;
  }

  /** The layers, for the map's marks container (the seismometers sit between). */
  static layers(): string {
    return `<div class="marks__glow"></div><div class="marks__homes"></div><div class="marks__soon"></div>`;
  }

  /** The map was drawn: put the homes and the glows where they now belong. */
  attach(host: HTMLElement, proj: MapProjection, u: number): void {
    this.host = host;
    this.proj = proj;
    this.u = u;
    this.tags = [];
    const homes = host.querySelector(".marks__homes");
    if (homes) {
      homes.innerHTML = VOICE_HOMES.map((h, k) => {
        const [x, y] = proj.project(h.lat, h.lon);
        // Not under the compass, in the bottom right corner.
        if (!this.inside(x, y, 6) || (x > proj.width - 56 * u && y > proj.height - 70 * u)) return "";
        // The second gauge carries no label: one BASS says it.
        const label = VOICE_HOMES.findIndex((o) => o.label === h.label) === k ? `<b class="home__label">${h.label}</b>` : "";
        const state = h.inst < 0 ? " home--always" : this.darkTimers.has(h.inst) ? " home--lit" : "";
        const side = x > proj.width - 64 * u ? " home--left" : "";
        return `<div class="home${state}${side}" data-inst="${h.inst}" data-topic="${h.topic}" style="left:${n(x)}px;top:${n(y)}px;--c:${soundColor(h.inst < 0 ? 14 : h.inst)}"><i class="home__dot"></i>${label}</div>`;
      }).join("");
    }
    // The dots of the last minute, already partway faded.
    const now = performance.now();
    this.glows = this.glows.filter((g) => now - g.t < GLOW_MS);
    const glow = host.querySelector(".marks__glow");
    if (glow) {
      glow.innerHTML = "";
      for (const g of this.glows) this.addGlow(g, now - g.t);
    }
  }

  private inside(x: number, y: number, pad: number): boolean {
    const p = this.proj;
    return !!p && x >= pad && y >= pad && x <= p.width - pad && y <= p.height - pad;
  }

  private addGlow(g: Glow, age: number): void {
    const host = this.host?.querySelector(".marks__glow");
    const p = this.proj;
    if (!host || !p) return;
    const [x, y] = p.project(g.lat, g.lon);
    if (!this.inside(x, y, 3)) return;
    const el = document.createElement("i");
    el.className = "glow";
    el.style.cssText = `left:${n(x)}px;top:${n(y)}px;--c:${g.color};animation-delay:${-Math.round(age)}ms`;
    host.appendChild(el);
    window.setTimeout(() => el.remove(), GLOW_MS - age);
    // A busy minute keeps its newest.
    while (host.childElementCount > 90) host.firstElementChild?.remove();
  }

  /** A sound with a place, as it's heard: leave its dot, and maybe say what it is. */
  sounded(e: Heard<PulseEvent>): void {
    if (e.i < 0) return;
    const g = { lat: e.lat, lon: e.lon, color: soundColor(e.i), t: performance.now() };
    this.glows.push(g);
    if (this.glows.length > 120) this.glows.shift();
    this.addGlow(g, 0);
    const loud = e.g ?? 1;
    if (!this.everywhere() && loud < 0.3) return;
    this.tag(e, loud);
  }

  private tag(e: Heard<PulseEvent>, loud: number): void {
    const host = this.host;
    const p = this.proj;
    if (!host || !p) return;
    const now = performance.now();
    if (now - this.lastTag < TAG_GAP_MS) return;
    const [x, y] = p.project(e.lat, e.lon);
    if (!this.inside(x, y, 8)) return;
    this.lastTag = now;
    const el = document.createElement("div");
    // The tag goes on whichever side has room.
    const left = x > p.width - 170 * this.u;
    el.className = `tag${left ? " tag--left" : ""}`;
    el.style.cssText = `left:${n(x)}px;top:${n(y)}px;--c:${soundColor(e.i)};opacity:${(0.55 + 0.45 * Math.sqrt(loud)).toFixed(2)}`;
    el.textContent = soundName(e, this.network(), this.tidy);
    host.appendChild(el);
    this.tags.push(el);
    while (this.tags.length > MAX_TAGS) this.tags.shift()?.remove();
    window.setTimeout(() => {
      el.remove();
      this.tags = this.tags.filter((t) => t !== el);
    }, TAG_MS);
  }

  /** A sound with a place, composed: a ring closes on it until it sounds. */
  coming(e: Heard<SoonEvent>): void {
    const host = this.host?.querySelector(".marks__soon");
    const p = this.proj;
    if (!host || !p || this.still() || e.in < 250) return;
    const [x, y] = p.project(e.lat, e.lon);
    if (!this.inside(x, y, 6)) return;
    const loud = Math.sqrt(Math.max(0, Math.min(1, e.g)));
    if (!this.everywhere() && loud < 0.25) return;
    const el = document.createElement("i");
    el.className = "soon";
    el.style.cssText = `left:${n(x)}px;top:${n(y)}px;--c:${soundColor(e.i)};--u:${this.u.toFixed(2)};animation-duration:${Math.round(e.in)}ms;opacity:${(0.4 + 0.6 * loud).toFixed(2)}`;
    host.appendChild(el);
    window.setTimeout(() => el.remove(), e.in + 60);
  }

  /** A voice with no one place sounded: light its home, and flash it. */
  voiced(e: Heard<VoiceEvent>): void {
    const host = this.host;
    if (!host) return;
    const now = performance.now();
    const last = this.flashed.get(e.i) ?? 0;
    const homes = host.querySelectorAll<HTMLElement>(`.home[data-inst="${e.i}"]`);
    if (!homes.length) return;
    clearTimeout(this.darkTimers.get(e.i));
    this.darkTimers.set(
      e.i,
      window.setTimeout(() => {
        this.darkTimers.delete(e.i);
        host.querySelectorAll(`.home[data-inst="${e.i}"]`).forEach((h) => h.classList.remove("home--lit"));
      }, HOME_LIT_MS),
    );
    homes.forEach((h) => h.classList.add("home--lit"));
    // Snow falls in grains, many a second: one flash in a while is enough.
    if (this.still() || now - last < (e.i === 4 ? 400 : 140)) return;
    this.flashed.set(e.i, now);
    homes.forEach((h) => {
      const f = document.createElement("i");
      f.className = "home__flash";
      h.appendChild(f);
      window.setTimeout(() => f.remove(), 900);
    });
  }
}
