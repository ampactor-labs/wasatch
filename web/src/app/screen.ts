// The play screen: the skyline with the shredder riding the theme, the valley
// map with every sounding event, the harmony dial, the trail-sign captions,
// the vantage control and the menu.

import {
  defaultSkylineData,
  gull,
  harmonyDial,
  mapBase,
  mapProjection,
  shredderGroup,
  skyGradient,
  skyline,
  skylineGeometry,
  sticker,
  trailIcon,
  VANTAGE_TRAIL,
  type MapBounds,
  type MapProjection,
  type SkylineGeometry,
  type StickerKind,
  type Vantage,
} from "../art/index.ts";
import { esc, n } from "../art/util.ts";
import type { BarEvent, DayEvent, FeatureEvent, Heard, PlayEvent, PulseEvent, SoloEvent, ThemeEvent } from "../engine/host.ts";
import { daypartAt } from "../art/sky.ts";
import { featureCaption, harmonyCaption, mountainDate, mountainDay, mountainHour, mountainTime, receiptText, type Caption, type Family } from "./captions.ts";
import { midiName } from "./music.ts";
import { dialLabels, homePos, keyName, noteName, push, type Key } from "./music.ts";
import type { Schedule } from "./schedule.ts";
import { DAYPART_NAMES, type Valley } from "./valley.ts";
import { season } from "../data/feeds.ts";
import { STATIONS } from "../data/ground.ts";

export const SECTION_NAMES = ["The theme", "Groove", "Atmosphere", "Journey", "The lake"];
const MODE_SHORT = ["LYDIAN", "MAJOR", "MIXO", "DORIAN", "MINOR"];
export const VANTAGES: { id: Vantage; code: number; name: string; short: string }[] = [
  { id: "everywhere", code: 0, name: "Everywhere", short: "Valley" },
  { id: "downtown", code: 1, name: "Downtown", short: "Downtown" },
  { id: "canyons", code: 2, name: "The Canyons", short: "Canyons" },
  { id: "lake", code: 3, name: "The Lake", short: "Lake" },
];

/** Inst codes (engine/src/compose.rs) to pulse colors on the map. */
const PULSE_COLOR: Record<number, string> = {
  1: "#FFD23F", // bell: TRAX
  2: "#FF4F9A", // horn: FrontRunner
  3: "#7AC74F", // marimba: GREENbike
  5: "#FF6B35", // quake bell
  11: "#4FA3D9", // canyon drums: ski buses
};

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface ScreenDeps {
  schedule: Schedule;
  valley: Valley;
  onVantage(code: number): void;
  onMenu(): void;
  onPause(): void;
  /** Leave A Day in Twelve Minutes for the live valley. */
  onLive(): void;
}

/** How much faster than the day A Day in Twelve Minutes runs. */
const DAY_SPEED = 120;

export class PlayScreen {
  readonly root: HTMLElement;
  private deps: ScreenDeps;
  private key: Key = { c: 0, r: 1 };
  private next: Key = { c: 0, r: 1 };
  private bar: Heard<BarEvent> | null = null;
  private captions: Caption[] = [];
  private introduced = new Set<Family>();
  private geo: SkylineGeometry | null = null;
  private proj: MapProjection | null = null;
  private riderT = 0.02;
  private riderAnim = 0;
  /** Theme hops win over the slow carve until this time. */
  private hopUntil = 0;
  private vantage = 0;
  private stickers: [StickerKind, StickerKind] = ["801", "LISTEN LOCAL"];
  private haze = 0;
  private daypart = "";
  private resizeTimer = 0;
  private mapTimer = 0;
  private tickTimer = 0;
  private paused = false;
  /** A Day in Twelve Minutes: the moment of the day at a bar, and when it was heard. */
  private day: { ms: number; at: number; first: number } | null = null;
  private dayTimer = 0;
  /** A run's solo: how many notes, how many heard. */
  private solo = { count: 0, heard: 0 };
  private noteTimer = 0;

  constructor(root: HTMLElement, deps: ScreenDeps) {
    this.root = root;
    this.deps = deps;
  }

  mount(): void {
    this.root.innerHTML = `<main class="play">
      <header class="play__sky">
        <div class="play__skyline"></div>
      </header>
      <div class="play__status" role="status"><span class="play__status-line"><span data-slot="clock"></span></span><span class="play__status-line"><span data-slot="key"></span><span data-slot="section"></span></span><button type="button" class="play__live" data-action="share" hidden>Share this day</button><button type="button" class="play__live" data-action="live" hidden>Back to live</button></div>
      <div class="play__note" aria-hidden="true"></div>
      <section class="play__valley">
        <div class="play__mapwrap">
          <div class="play__map" aria-label="The valley map"></div>
          <div class="play__sticker play__sticker--a" aria-hidden="true"></div>
          <div class="play__sticker play__sticker--b" aria-hidden="true"></div>
        </div>
        <div class="play__dial"></div>
        <div class="play__podium" aria-hidden="true">${gull({ pose: "conduct" })}</div>
      </section>
      <section class="play__captions" aria-live="polite" aria-label="What you're hearing"></section>
      <nav class="play__bar">
        <div class="play__vantage" role="radiogroup" aria-label="Where you're listening from">
          ${VANTAGES.map(
            (v) => `<button type="button" role="radio" class="vantage" data-vantage="${v.code}" aria-checked="${v.code === 0}">
              ${trailIcon(VANTAGE_TRAIL[v.id], { size: 30 })}<span class="vantage__long">${esc(v.name)}</span><span class="vantage__short">${esc(v.short)}</span></button>`,
          ).join("")}
        </div>
        <div class="play__gull" aria-hidden="true">${gull({ pose: "conduct" })}</div>
        <button type="button" class="round play__pause" aria-label="Pause" data-action="pause"><span class="play__pause-icon"></span></button>
        <button type="button" class="round play__menu" aria-label="Menu" data-action="menu"><span></span><span></span><span></span></button>
      </nav>
    </main>`;
    this.root.querySelectorAll<HTMLButtonElement>("[data-vantage]").forEach((b) => {
      b.addEventListener("click", () => this.setVantage(Number(b.dataset.vantage)));
    });
    this.root.querySelector('[data-action="menu"]')?.addEventListener("click", () => this.deps.onMenu());
    this.root.querySelector('[data-action="pause"]')?.addEventListener("click", () => this.deps.onPause());
    this.root.querySelector('[data-action="live"]')?.addEventListener("click", () => this.deps.onLive());
    this.root.querySelector('[data-action="share"]')?.addEventListener("click", () => void this.shareDay());
    this.layout();
    window.addEventListener("resize", () => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.layout(), 150);
    });
    // The map fills whatever room the captions leave it.
    const map = this.root.querySelector<HTMLElement>(".play__map");
    if (map && "ResizeObserver" in window) {
      let last = "";
      new ResizeObserver(() => {
        const size = `${map.clientWidth}x${map.clientHeight}`;
        if (size === last) return;
        last = size;
        clearTimeout(this.mapTimer);
        this.mapTimer = window.setTimeout(() => this.renderMap(), 120);
      }).observe(map);
    }
    this.tickTimer = window.setInterval(() => this.tick(), 1000);
    this.tick();
    this.renderDial();
    this.renderStickers();
  }

  setPaused(p: boolean): void {
    this.paused = p;
    const b = this.root.querySelector<HTMLButtonElement>('[data-action="pause"]');
    if (b) {
      b.setAttribute("aria-label", p ? "Play" : "Pause");
      b.classList.toggle("is-paused", p);
    }
    this.root.querySelector(".play")?.classList.toggle("play--paused", p);
  }

  setVantage(code: number): void {
    this.vantage = code;
    this.root.querySelectorAll<HTMLButtonElement>("[data-vantage]").forEach((b) => {
      b.setAttribute("aria-checked", String(Number(b.dataset.vantage) === code));
    });
    this.deps.onVantage(code);
  }

  /** Redraw everything sized to the screen. */
  layout(): void {
    this.renderSky();
    this.renderMap();
  }

  private renderSky(): void {
    const host = this.root.querySelector<HTMLElement>(".play__skyline");
    const header = this.root.querySelector<HTMLElement>(".play__sky");
    if (!host || !header) return;
    const width = Math.max(320, Math.round(host.clientWidth || window.innerWidth));
    const height = Math.round(Math.max(110, Math.min(230, width * 0.3, window.innerHeight * 0.2)));
    const daypart = this.deps.valley.daypart();
    this.daypart = daypart;
    const cloud = this.deps.valley.sky?.value.hours.find((h) => Math.abs(h.at - Math.floor(Date.now() / 3_600_000) * 3_600_000) < 1)?.cloud;
    header.style.background = skyGradient(daypart, { cloud: Number.isFinite(cloud) ? (cloud ?? 0) * 0.6 : 0, haze: this.haze });
    const data = defaultSkylineData();
    this.geo = skylineGeometry(data, { width, height });
    const snowLine = this.snowLine();
    host.innerHTML = skyline(data, { width, height, daypart, haze: this.haze, flags: true, labels: width >= 900, snowLineFt: snowLine });
    const head = host.querySelector(".skyline-playhead");
    if (head) head.innerHTML = `<g class="play__rider">${shredderGroup()}</g>`;
    this.placeRider(this.riderT, 0);
  }

  /** The snow line follows the season and the latest snowpack. */
  private snowLine(): number {
    const month = new Date().getUTCMonth();
    const base = [7000, 7000, 7600, 8600, 9800, 11200, 12500, 12500, 11500, 10200, 8600, 7400][month] ?? 9600;
    const pack = this.deps.valley.snow?.value.ratio ?? 1;
    return base - (pack - 1) * 900;
  }

  private riderScale(): number {
    const h = this.geo?.height ?? 160;
    return 0.3 * Math.max(0.65, Math.min(1.4, h / 190));
  }

  private placeRider(t: number, lift: number, spin = 0): void {
    const g = this.root.querySelector<SVGGElement>(".play__rider");
    if (!g || !this.geo) return;
    const p = this.geo.at(t);
    g.setAttribute("transform", `translate(${n(p.x)} ${n(p.y - 1 - lift)}) rotate(${n(p.angle + spin)}) scale(${n(this.riderScale(), 3)})`);
  }

  /** The theme sounded summit `s`: hop there. */
  private hopTo(s: number): void {
    const data = defaultSkylineData();
    const summit = data.summits[s];
    if (!summit) return;
    this.root.querySelectorAll(".skyline-flag").forEach((f, k) => f.classList.toggle("skyline-flag--active", k === s));
    this.hopToT(summit.i / (data.elevFt.length - 1));
  }

  /** Between theme statements the rider carves along the ridge, north to
   * south over a section, a bar at a time: the skyline as a playhead. */
  private carve(bar: Heard<BarEvent>): void {
    if (this.riderAnim && performance.now() < this.hopUntil) return;
    const target = Math.min(1, (bar.bar + 1) / Math.max(1, bar.bars));
    if (bar.bar === 0 && this.riderT > 0.5) this.riderT = 0;
    const from = this.riderT;
    this.riderT = target;
    if (reducedMotion()) {
      this.placeRider(target, 0);
      return;
    }
    const ms = (240_000 / bar.bpm) * 0.95;
    const t0 = performance.now();
    cancelAnimationFrame(this.riderAnim);
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms);
      this.placeRider(from + (target - from) * u, 0);
      if (u < 1) this.riderAnim = requestAnimationFrame(step);
    };
    this.riderAnim = requestAnimationFrame(step);
  }

  /** Hop along the ridge to `target` (0 Ben Lomond … 1 Mount Nebo). */
  private hopToT(target: number): void {
    cancelAnimationFrame(this.riderAnim);
    this.hopUntil = performance.now() + 2500;
    const from = this.riderT;
    this.riderT = target;
    if (reducedMotion()) {
      this.placeRider(target, 0);
      return;
    }
    const dist = Math.abs(target - from);
    const ms = 160 + 900 * Math.min(1, dist * 2.2);
    const height = (this.geo?.height ?? 160) * (0.08 + 0.35 * Math.min(1, dist * 3));
    // A long hop gets a full spin: send it.
    const spins = dist > 0.25 ? 360 * Math.sign(target - from) : 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / ms);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      this.placeRider(from + (target - from) * e, 4 * height * u * (1 - u), spins * e);
      if (u < 1) this.riderAnim = requestAnimationFrame(step);
    };
    this.riderAnim = requestAnimationFrame(step);
  }

  /** Bounds that fill a w × h box around the valley: the lake's south arm
   * to the crest, Bountiful to Draper, grown to the box's shape. */
  private mapBounds(w: number, h: number): MapBounds {
    const k = Math.cos((40.72 * Math.PI) / 180);
    let lat = 0.66;
    let lon = 0.82;
    const aspect = h / w;
    if (aspect > lat / (lon * k)) lat = Math.min(1.3, lon * k * aspect);
    else lon = Math.min(1.25, lat / (k * aspect));
    const cLat = 40.71;
    const cLon = -111.98;
    return { n: cLat + lat / 2, s: cLat - lat / 2, w: cLon - lon / 2, e: cLon + lon / 2 };
  }

  private renderMap(): void {
    const host = this.root.querySelector<HTMLElement>(".play__map");
    if (!host) return;
    const w = Math.max(240, Math.round(host.clientWidth));
    const h = Math.max(200, Math.round(host.clientHeight || w * 1.1));
    const bounds = this.mapBounds(w, h);
    this.proj = mapProjection(bounds, w, h);
    host.innerHTML = mapBase({ bounds, width: w, height: h, labels: w >= 300 });
    const routes = host.querySelector(".map-routes");
    if (routes) routes.innerHTML = this.routesSvg();
    // The seismometers: rings that breathe with the ground.
    const proj = this.proj;
    routes?.insertAdjacentHTML(
      "afterend",
      `<g class="map-ground">${STATIONS.map((s, band) => {
        const [x, y] = proj.project(s.lat, s.lon);
        return `<g class="map-seis" data-band="${band}" transform="translate(${n(x)} ${n(y)})"><title>${esc(s.name)}</title><circle class="map-seis__ring" r="9"/><circle class="map-seis__dot" r="2.6"/></g>`;
      }).join("")}</g>`,
    );
    this.drawGround();
    this.drawVehicles();
  }

  /** Each seismometer's ring follows its band's level; hidden when it's quiet or offline. */
  private drawGround(): void {
    const levels = this.deps.valley.ground?.levels;
    this.root.querySelectorAll<SVGGElement>(".map-seis").forEach((g) => {
      const level = levels?.[Number(g.dataset.band)] ?? 0;
      g.classList.toggle("map-seis--live", !!levels);
      g.style.setProperty("--level", level.toFixed(2));
    });
  }

  private routesSvg(): string {
    const proj = this.proj;
    const net = this.deps.schedule.network;
    if (!proj || !net) return "";
    const lines: string[] = [];
    const casing: string[] = [];
    // One direction per route is enough to draw the line.
    const seen = new Set<number>();
    for (const shape of net.shapes) {
      if (seen.has(shape.r)) continue;
      seen.add(shape.r);
      const d = shape.pts
        .map(([lat, lon], i) => {
          const [x, y] = proj.project(lat, lon);
          return `${i ? "L" : "M"}${n(x)} ${n(y)}`;
        })
        .join("");
      const color = net.routes[shape.r]?.color ?? "#1B1F3B";
      const fr = net.routes[shape.r]?.kind === "frontrunner";
      casing.push(`<path d="${d}" stroke="#1B1F3B" stroke-width="${fr ? 5 : 6.5}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`);
      lines.push(
        `<path d="${d}" stroke="${color}" stroke-width="${fr ? 2.4 : 3.6}" stroke-linecap="round" stroke-linejoin="round" fill="none"${fr ? ' stroke-dasharray="7 4"' : ""}/>`,
      );
    }
    const stations = net.stops
      .map((s) => {
        const [x, y] = proj.project(s.lat, s.lon);
        return `<circle cx="${n(x)}" cy="${n(y)}" r="2.6" fill="#FFFFFF" stroke="#1B1F3B" stroke-width="1.6"/>`;
      })
      .join("");
    return `${casing.join("")}${lines.join("")}<g class="map-stations">${stations}</g>`;
  }

  /** The moment of the day being played: the listening time, or in A Day
   * in Twelve Minutes, the day's racing clock. */
  private dayNow(): number {
    if (this.day) return this.day.ms + (performance.now() - this.day.at) * DAY_SPEED;
    return this.deps.valley.now() - 90_000;
  }

  private drawVehicles(): void {
    const g = this.root.querySelector(".map-vehicles");
    const proj = this.proj;
    if (!g || !proj) return;
    const trains = this.deps.schedule.trainsAt(this.dayNow());
    g.innerHTML = trains
      .map((t) => {
        const [x, y] = proj.project(t.lat, t.lon);
        const color = this.deps.schedule.routeColor(t.route);
        return `<rect x="${n(x - 3.6)}" y="${n(y - 3.6)}" width="7.2" height="7.2" rx="2" fill="${color}" stroke="#1B1F3B" stroke-width="1.8"/>`;
      })
      .join("");
  }

  private pulse(e: Heard<PulseEvent>): void {
    const g = this.root.querySelector(".map-events");
    const proj = this.proj;
    if (!g || !proj) return;
    let [x, y] = proj.project(e.lat, e.lon);
    // Far events (a quake near Milford) pin to the map's edge.
    const edge = 10;
    const off = x < edge || y < edge || x > proj.width - edge || y > proj.height - edge;
    x = Math.max(edge, Math.min(proj.width - edge, x));
    y = Math.max(edge, Math.min(proj.height - edge, y));
    const color = PULSE_COLOR[e.i] ?? "#FF6B35";
    const big = e.i === 5;
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    el.setAttribute("class", `map-pulse${big ? " map-pulse--big" : ""}${off ? " map-pulse--edge" : ""}`);
    el.setAttribute("transform", `translate(${n(x)} ${n(y)})`);
    el.innerHTML = `<circle class="map-pulse__ring" r="9" fill="none" stroke="${color}" stroke-width="3"/><circle r="${big ? 7 : 5}" fill="${color}" stroke="#1B1F3B" stroke-width="2"/>`;
    g.appendChild(el);
    window.setTimeout(() => el.remove(), big ? 4000 : 1800);
  }

  private renderDial(): void {
    const host = this.root.querySelector<HTMLElement>(".play__dial");
    if (!host) return;
    const k = this.key;
    host.innerHTML = harmonyDial({
      collection: k.c,
      home: homePos(k),
      push: push(k, this.next),
      labels: dialLabels(k),
      center: `${noteName(homePos(k))} ${MODE_SHORT[k.r] ?? ""}`,
      title: `${keyName(k)}: the notes in play are ${noteName(k.c)} major's`,
    });
    host.querySelector(".dial")?.classList.toggle("dial--turning", !this.paused);
  }

  private renderStickers(): void {
    const [a, b] = this.stickers;
    const sa = this.root.querySelector(".play__sticker--a");
    const sb = this.root.querySelector(".play__sticker--b");
    if (sa) sa.innerHTML = sticker(a);
    if (sb) sb.innerHTML = sticker(b);
    if (!reducedMotion()) {
      sa?.firstElementChild?.classList.add("sticker-pop");
      sb?.firstElementChild?.classList.add("sticker-pop");
    }
  }

  /** Which two stickers the valley earns right now. */
  private pickStickers(): [StickerKind, StickerKind] {
    const v = this.deps.valley;
    const earned: StickerKind[] = [];
    const hour = mountainHour(v.now());
    const winter = season(v.now()) > 0.5;
    const newIn = v.snow?.value.newIn ?? 0;
    const sky = v.sky?.value;
    const nowHour = sky?.hours.find((h) => h.at === Math.floor(Date.now() / 3_600_000) * 3_600_000);
    if (newIn >= 6) earned.push("POW DAY");
    if (sky && sky.inversionC >= 5 && sky.pm25 >= 12) earned.push("INVERSION");
    if (nowHour && nowHour.cloud <= 0.1 && hour > 7 && hour < 18 && newIn >= 2) earned.push("BLUEBIRD");
    if (winter && hour >= 8.5 && hour < 9.5) earned.push("FIRST CHAIR");
    if (winter && hour >= 15.5 && hour < 16.5) earned.push("LAST CHAIR");
    if (nowHour && nowHour.snowCm > 0 && (nowHour.ridgeGustMs ?? 0) > 6 && hour > 0) earned.push("LAKE EFFECT");
    if (this.bar?.kind === 3) earned.push("SEND IT");
    if ((v.lake?.value.ft ?? 4199) < 4195) earned.push("THE LAKE IS LOW");
    earned.push("801", "LISTEN LOCAL");
    return [earned[0] ?? "801", earned[1] ?? "LISTEN LOCAL"];
  }

  /** Once a second: the clock, the trains, the stickers. */
  private tick(): void {
    const v = this.deps.valley;
    const t = v.now();
    const clock = this.root.querySelector('[data-slot="clock"]');
    this.drawGround();
    if (this.day) {
      this.dayTick();
    } else {
      if (clock) clock.textContent = `${v.shift ? "⏪ " : ""}${mountainTime(t)} · ${DAYPART_NAMES[v.daypart()]}`;
      this.drawVehicles();
    }
    const s = this.pickStickers();
    if (s[0] !== this.stickers[0] || s[1] !== this.stickers[1]) {
      this.stickers = s;
      this.renderStickers();
    }
    if (v.daypart() !== this.daypart) this.renderSky();
  }

  /** Five times a second in A Day in Twelve Minutes: the racing clock and the trains. */
  private dayTick(): void {
    const now = this.dayNow();
    const clock = this.root.querySelector('[data-slot="clock"]');
    if (clock) clock.textContent = `⏩ ${mountainTime(now)} · ${DAYPART_NAMES[daypartAt(mountainHour(now))]}`;
    this.drawVehicles();
  }

  private enterDay(e: Heard<BarEvent>): void {
    this.day = { ms: e.day, at: e.at, first: e.day };
    this.root.querySelector(".play")?.classList.add("play--day");
    for (const action of ["live", "share"]) {
      const b = this.root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
      if (b) b.hidden = false;
    }
    clearInterval(this.dayTimer);
    this.dayTimer = window.setInterval(() => this.dayTick(), 200);
    this.caption({
      text: `${mountainDay(e.day)}, ${mountainDate(e.day).replace(/, \d{4}$/, "")}, from 5 AM to 5 AM, in twelve minutes`,
      receipt: "scheduled",
      at: e.at,
      family: "harmony",
    });
  }

  private exitDay(e: Heard<BarEvent>): void {
    const first = this.day?.first ?? e.at;
    this.day = null;
    clearInterval(this.dayTimer);
    this.root.querySelector(".play")?.classList.remove("play--day");
    for (const action of ["live", "share"]) {
      const b = this.root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`);
      if (b) b.hidden = true;
    }
    this.caption({ text: `That was ${mountainDay(first)} in twelve minutes. Back to the valley, live.`, receipt: "scheduled", at: e.at, family: "harmony" });
    this.tick();
  }

  onBar(e: Heard<BarEvent>): void {
    if (e.day > 0) {
      if (!this.day) this.enterDay(e);
      else this.day = { ...this.day, ms: e.day, at: e.at };
    } else if (this.day) {
      this.exitDay(e);
    }
    const first = this.bar === null;
    const newSection = first || e.sec !== this.bar?.sec || e.chain !== this.bar?.chain;
    this.bar = e;
    this.key = { c: e.c, r: e.r };
    this.next = { c: e.nc, r: e.nr };
    const play = this.root.querySelector<HTMLElement>(".play");
    play?.style.setProperty("--beat", `${(60 / e.bpm).toFixed(3)}s`);
    const keyEl = this.root.querySelector('[data-slot="key"]');
    if (keyEl) keyEl.textContent = keyName(this.key);
    const secEl = this.root.querySelector('[data-slot="section"]');
    if (secEl) secEl.textContent = `${SECTION_NAMES[e.kind] ?? ""} · ${Math.round(e.bpm)} BPM`;
    if (e.kind !== 0) this.carve(e);
    if (Math.abs(e.haze - this.haze) > 0.08) {
      this.haze = e.haze;
      this.renderSky();
    }
    if (newSection) {
      this.renderDial();
      if (e.bar === 0) this.caption(harmonyCaption(e));
      else if (first) this.caption({ text: `Now playing in ${keyName(this.key)}: ${SECTION_NAMES[e.kind] ?? ""}`, receipt: "scheduled", at: e.at, family: "harmony" });
    }
  }

  onFeature(e: Heard<FeatureEvent>): void {
    if (e.k === 11) return; // the bar event captions the boundary
    const c = featureCaption(e, this.deps.schedule, this.deps.valley.valleyNow(), this.key, this.day !== null);
    if (c) this.caption(c);
  }

  /** A note the listener played: show it for a moment. */
  onPlay(e: Heard<PlayEvent>): void {
    this.flashNote(`♪ ${midiName(e.m)}`);
  }

  /** A note of the listener's run: the rider skis it along the ridge. */
  onSolo(e: Heard<SoloEvent>): void {
    this.solo.heard++;
    const t = this.solo.count > 1 ? Math.min(1, this.solo.heard / this.solo.count) : 0.5;
    this.riderT = Math.max(0, t - 0.02);
    this.hopToT(t);
    this.flashNote(`♪ ${midiName(e.m)}`);
    if (this.solo.heard === this.solo.count) {
      this.caption({ text: "That was your run. Back to the valley.", receipt: "scheduled", at: e.at, family: "harmony" });
    }
  }

  onDay(e: Heard<DayEvent>): void {
    if (!e.ok) this.caption({ text: "That day isn't in the schedule yet.", receipt: "scheduled", at: e.at, family: "harmony" });
  }

  /** A run is coming: `count` notes. */
  startSolo(count: number): void {
    this.solo = { count, heard: 0 };
  }

  private flashNote(text: string): void {
    const el = this.root.querySelector<HTMLElement>(".play__note");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("play__note--on");
    void el.offsetWidth;
    el.classList.add("play__note--on");
    clearTimeout(this.noteTimer);
    this.noteTimer = window.setTimeout(() => el.classList.remove("play__note--on"), 900);
  }

  onPulse(e: Heard<PulseEvent>): void {
    this.pulse(e);
  }

  onTheme(e: Heard<ThemeEvent>): void {
    this.hopTo(e.s);
  }

  /** Show a caption: newest on top, three at most. */
  caption(c: Caption): void {
    const intro = this.introduced.has(c.family) ? undefined : c.intro;
    this.introduced.add(c.family);
    this.captions.unshift({ ...c, intro });
    this.captions.length = Math.min(this.captions.length, 3);
    const host = this.root.querySelector(".play__captions");
    if (!host) return;
    host.innerHTML = this.captions
      .map(
        (k, i) => `<div class="sign sign--${k.receipt} caption${i ? " sign--small caption--old" : " caption--new"}">
          <p class="sign__line">${esc(k.text)}</p>${i === 0 && k.intro ? `<p class="sign__line caption__intro">${esc(k.intro)}</p>` : ""}
          <span class="sign__receipt">${esc(receiptText(k))}</span></div>`,
      )
      .join("");
  }

  /** The latest captions, for the lock screen and sharing. */
  latest(): Caption | undefined {
    return this.captions[0];
  }

  currentKey(): Key {
    return this.key;
  }

  currentBar(): Heard<BarEvent> | null {
    return this.bar;
  }

  destroy(): void {
    clearInterval(this.tickTimer);
    clearInterval(this.dayTimer);
    cancelAnimationFrame(this.riderAnim);
  }

  /** A link that plays this day in twelve minutes, shared or copied. */
  private async shareDay(): Promise<void> {
    if (!this.day) return;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(this.day.first);
    const url = new URL(location.href);
    url.search = `?day=${date}`;
    const title = `${mountainDay(this.day.first)}, ${mountainDate(this.day.first)}, in twelve minutes`;
    try {
      if (navigator.share) await navigator.share({ title: `Wasatch Symphony: ${title}`, url: url.href });
      else {
        await navigator.clipboard.writeText(url.href);
        this.flashNote("Link copied");
      }
    } catch {
      // The listener closed the share sheet.
    }
  }

  /** Whether A Day in Twelve Minutes is playing. */
  inDay(): boolean {
    return this.day !== null;
  }
}
