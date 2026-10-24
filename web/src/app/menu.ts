// The menu: everything optional. Rewind, line up with the phone next to you,
// see every mapping live, and the credits. Each panel is a ski-poster card
// that slides up over the screen.

import { esc } from "../art/util.ts";
import { icon, type IconName } from "../art/index.ts";
import type { Host } from "../engine/host.ts";
import { clockEstimate } from "../engine/clock.ts";
import { mountainDate, mountainTime, receiptText } from "./captions.ts";
import { keyName } from "./music.ts";
import type { Schedule } from "./schedule.ts";
import { SECTION_NAMES, type PlayScreen } from "./screen.ts";
import type { Valley } from "./valley.ts";
import { STATIONS } from "../data/ground.ts";

export interface MenuDeps {
  host: Host;
  valley: Valley;
  schedule: Schedule;
  screen: PlayScreen;
  base: string;
}

type PanelId = "rewind" | "tune" | "mappings" | "about";

const ITEMS: { id: PanelId; title: string; blurb: string; icon: IconName }[] = [
  { id: "rewind", title: "Rewind", blurb: "Hear an earlier hour of the valley", icon: "chairlift" },
  { id: "tune", title: "Line up with a friend", blurb: "Nudge this phone to match the one next to it", icon: "bell" },
  { id: "mappings", title: "Show mappings", blurb: "Every stream, what it plays, and where it came from", icon: "seismometer" },
  { id: "about", title: "About", blurb: "What this is, who made the data, the licenses", icon: "mountain" },
];

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export class Menu {
  private deps: MenuDeps;
  private sheet: HTMLElement;
  private closeTimer = 0;
  private raf = 0;
  private refresh = 0;

  constructor(deps: MenuDeps) {
    this.deps = deps;
    this.sheet = document.createElement("div");
    this.sheet.className = "sheet";
    this.sheet.hidden = true;
    this.sheet.innerHTML = `<div class="sheet__scrim" data-close></div>
      <div class="sheet__card" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <button type="button" class="round sheet__close" data-close aria-label="Close">×</button>
        <div class="sheet__body"></div>
      </div>`;
    document.body.appendChild(this.sheet);
    this.sheet.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("[data-close]")) this.close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.sheet.hidden) this.close();
    });
  }

  private body(): HTMLElement {
    return this.sheet.querySelector<HTMLElement>(".sheet__body")!;
  }

  private show(html: string): void {
    clearTimeout(this.closeTimer);
    cancelAnimationFrame(this.raf);
    clearInterval(this.refresh);
    this.body().innerHTML = html;
    this.sheet.hidden = false;
    requestAnimationFrame(() => this.sheet.classList.add("sheet--open"));
    this.sheet.querySelector<HTMLElement>(".sheet__close")?.focus();
  }

  close(): void {
    this.sheet.classList.remove("sheet--open");
    cancelAnimationFrame(this.raf);
    clearInterval(this.refresh);
    this.closeTimer = window.setTimeout(() => (this.sheet.hidden = true), 250);
    this.deps.screen.root.querySelector<HTMLElement>('[data-action="menu"]')?.focus();
  }

  open(): void {
    this.show(`<h2 class="sheet__title" id="sheet-title">Trail map</h2>
      <ul class="menu">${ITEMS.map(
        (i) => `<li><button type="button" class="menu__item" data-panel="${i.id}">${icon(i.icon, { size: 40 })}
          <span><b>${esc(i.title)}</b><small>${esc(i.blurb)}</small></span></button></li>`,
      ).join("")}</ul>`);
    this.body()
      .querySelectorAll<HTMLButtonElement>("[data-panel]")
      .forEach((b) => b.addEventListener("click", () => this.panel(b.dataset.panel as PanelId)));
  }

  panel(id: PanelId): void {
    if (id === "rewind") this.rewind();
    else if (id === "tune") this.tune();
    else if (id === "mappings") this.mappings();
    else this.about();
  }

  // --- Rewind ---------------------------------------------------------------

  private rewind(): void {
    const { valley, schedule, host } = this.deps;
    const [first] = schedule.span();
    // Observations reach back about four days; the schedule from yesterday.
    const earliest = Math.max(first + 5 * 3_600_000, Date.now() - 3.5 * 86_400_000);
    const hours: { label: string; shift: number }[] = [];
    for (let back = 1; back <= 36; back++) {
      const at = Date.now() - back * 3_600_000;
      if (at < earliest) break;
      hours.push({ label: `${back} h ago · ${mountainDate(at).replace(/, \d{4}$/, "")} ${mountainTime(at)}`, shift: -back * 3_600_000 });
    }
    this.show(`<h2 class="sheet__title" id="sheet-title">Rewind</h2>
      <p class="sheet__lede">Hear the valley as it was. The schedule, the sky, the lake and the quakes come back; GREENbike and the ground only play live.</p>
      ${valley.shift ? `<button type="button" class="btn btn--sun" data-shift="0">Back to live</button>` : ""}
      <div class="chips">${hours
        .filter((_, i) => i < 6 || i % 3 === 2)
        .map((h) => `<button type="button" class="chip${h.shift === valley.shift ? " chip--on" : ""}" data-shift="${h.shift}">${esc(h.label)}</button>`)
        .join("")}</div>`);
    this.body()
      .querySelectorAll<HTMLButtonElement>("[data-shift]")
      .forEach((b) =>
        b.addEventListener("click", async () => {
          const shift = Number(b.dataset.shift);
          valley.shift = shift;
          await valley.loadDays();
          host.setTimeShift(shift);
          this.close();
        }),
      );
  }

  // --- Line up --------------------------------------------------------------

  private tune(): void {
    const { host } = this.deps;
    const est = clockEstimate();
    const latency = Math.round(1000 * ((host.ctx.baseLatency || 0) + ((host.ctx as AudioContext & { outputLatency?: number }).outputLatency || 0)));
    this.show(`<h2 class="sheet__title" id="sheet-title">Line up with a friend</h2>
      <p class="sheet__lede">Every phone plays the same bar at the same moment. A Bluetooth speaker adds its own delay, which phones don't always report; nudge until the two of you sound like one.</p>
      <div class="nudge">
        <button type="button" class="btn" data-nudge="-20" aria-label="Play 20 milliseconds earlier">−20 ms</button>
        <output class="nudge__value" aria-live="polite">${host.nudge >= 0 ? "+" : ""}${host.nudge} ms</output>
        <button type="button" class="btn" data-nudge="20" aria-label="Play 20 milliseconds later">+20 ms</button>
      </div>
      <p class="fine">This phone's clock: ${est.source === "header" ? `set from our server to within ±${Math.round(est.uncertainty)} ms` : "its own (the server's clock didn't answer)"}. Output delay it reports: ${latency} ms.${isIOS() ? " On an iPhone, the microphone can't be used for this without dropping Web Audio to call volume, so it's by ear." : ""}</p>`);
    const out = this.body().querySelector("output");
    this.body()
      .querySelectorAll<HTMLButtonElement>("[data-nudge]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          host.setNudge(host.nudge + Number(b.dataset.nudge));
          if (out) out.textContent = `${host.nudge >= 0 ? "+" : ""}${host.nudge} ms`;
        }),
      );
  }

  // --- Mappings ---------------------------------------------------------------

  private mappingRows(): string {
    const { valley, schedule, screen } = this.deps;
    const now = valley.now();
    const row = (name: string, role: string, value: string, receipt: string, source: string, href: string) =>
      `<tr><th scope="row">${esc(name)}</th><td>${esc(role)}</td><td class="num">${esc(value)}</td><td><span class="tag tag--${receipt.split(" ")[0]}">${esc(receipt)}</span></td><td><a href="${href}" target="_blank" rel="noopener">${esc(source)}</a></td></tr>`;
    const r = <T>(x: { receipt: "live" | "cached" | "scheduled"; observed: number; value: T } | null) => (x ? receiptText(x) : "waiting");
    const sky = valley.sky;
    const hour = sky?.value.hours.find((h) => h.at === Math.floor((now - 20 * 60_000) / 3_600_000) * 3_600_000);
    const bar = screen.currentBar();
    const rows = [
      row("Transit", "the groove: bells, horn, drums, bass", `${schedule.vehiclesAt(now)} vehicles in service`, "scheduled", "UTA GTFS", "https://www.rideuta.com/Rider-Info/Developer-Resources"),
      row(
        "Great Salt Lake",
        "the drone under everything; whether phrases come home",
        valley.lake ? `${valley.lake.value.ft.toFixed(1)} ft` : "…",
        r(valley.lake),
        "USGS 10010000",
        "https://waterdata.usgs.gov/monitoring-location/USGS-10010000/",
      ),
      row(
        "Jordan River",
        "a walking bass when it runs high",
        valley.river ? `${Math.round(valley.river.value.cfs)} cfs · ${Math.round(valley.river.value.position * 100)}th pct` : "…",
        r(valley.river),
        "USGS 10171000",
        "https://waterdata.usgs.gov/monitoring-location/USGS-10171000/",
      ),
      row(
        "Snowbird snow",
        "the dawn swell; how light the snow's sparkle is",
        valley.snow ? `${valley.snow.value.newIn.toFixed(0)} in new · ${Math.round(valley.snow.value.ratio * 100)}% of median` : "…",
        r(valley.snow),
        "NRCS SNOTEL 766",
        "https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=766",
      ),
      row(
        "The sky",
        "how bright the mode is; tension",
        hour ? `${sky?.value.description || "—"} · cloud ${Number.isFinite(hour.cloud) ? `${Math.round(hour.cloud * 100)}%` : "?"}` : sky?.value.description ?? "…",
        r(sky),
        "NWS KSLC",
        "https://www.weather.gov/slc/",
      ),
      row("Alerts", "storms push tension", sky?.value.alerts.length ? sky.value.alerts.join(", ") : "none", r(sky), "NWS alerts", "https://alerts.weather.gov/"),
      row(
        "Air",
        "haze on the pad and the skyline",
        sky && Number.isFinite(sky.value.pm25) ? `PM2.5 ${sky.value.pm25.toFixed(0)} µg/m³` : "…",
        r(sky),
        "Open-Meteo CAMS",
        "https://open-meteo.com/en/docs/air-quality-api",
      ),
      row("Inversion", "the lid: a low ceiling on the reverb", sky ? `${sky.value.inversionC.toFixed(1)} °C warmer aloft` : "…", r(sky), "Open-Meteo", "https://open-meteo.com/"),
      row(
        "Ridge wind",
        "the Aeolian harp",
        sky && Number.isFinite(sky.value.ridgeGustMs) ? `gusts ${Math.round(sky.value.ridgeGustMs * 2.237)} mph at Alta` : "…",
        r(sky),
        "Open-Meteo",
        "https://open-meteo.com/",
      ),
      row(
        "Earthquakes",
        "a deep bell, in the chord",
        valley.quakes?.value.length ? `${valley.quakes.value.length} in 2 days · last M${valley.quakes.value.at(-1)?.mag.toFixed(1)}` : "none",
        r(valley.quakes),
        "USGS catalog",
        "https://earthquake.usgs.gov/earthquakes/map/",
      ),
      row("GREENbike", "a marimba pluck per bike out or back", `${valley.bikes.events.length} changes in 10 min`, valley.shift ? "live only" : "live", "GBFS", "https://greenbikeutah.org/"),
      row(
        "The ground",
        "the seismometers, moved up onto the chord",
        valley.ground ? STATIONS.map((s, i) => `${s.code} ${Math.round((valley.ground?.levels[i] ?? 0) * 100)}`).join(" · ") : "not connected",
        valley.ground ? "live" : "waiting",
        "EarthScope · UU",
        "https://quake.utah.edu/",
      ),
      row("Sun and moon", "how bright the mode is", "computed for SLC", "scheduled", "NOAA formulas", "https://gml.noaa.gov/grad/solcalc/"),
    ];
    const now2 = bar ? `${keyName({ c: bar.c, r: bar.r })} · ${SECTION_NAMES[bar.kind]} · bar ${bar.bar + 1} of ${bar.bars} · ${bar.chord}` : "";
    return `<p class="fine">${esc(now2)}</p><div class="table-wrap"><table class="mappings"><thead><tr><th>Stream</th><th>Plays</th><th>Now</th><th>Receipt</th><th>Source</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
  }

  private mappings(): void {
    this.show(`<h2 class="sheet__title" id="sheet-title">Show mappings</h2>
      <div data-rows>${this.mappingRows()}</div>
      <h3 class="sheet__sub">The mix, live</h3>
      <canvas class="spectrogram" width="720" height="200" aria-label="A spectrogram of what's playing"></canvas>`);
    this.refresh = window.setInterval(() => {
      const rows = this.body().querySelector("[data-rows]");
      if (rows) rows.innerHTML = this.mappingRows();
    }, 2000);
    const canvas = this.body().querySelector<HTMLCanvasElement>(".spectrogram");
    const analyser = this.deps.host.analyser(2048);
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bins = new Float32Array(analyser.frequencyBinCount);
    const sr = this.deps.host.ctx.sampleRate;
    const draw = () => {
      analyser.getFloatFrequencyData(bins);
      // Scroll left one pixel, then paint the newest column on a log axis.
      ctx.drawImage(canvas, -1, 0);
      const h = canvas.height;
      for (let y = 0; y < h; y++) {
        const f = 30 * Math.pow(16000 / 30, 1 - y / h);
        const k = Math.min(bins.length - 1, Math.round((f / (sr / 2)) * bins.length));
        const db = bins[k] ?? -140;
        const v = Math.max(0, Math.min(1, (db + 110) / 80));
        ctx.fillStyle = `hsl(${250 - 230 * v} 90% ${8 + 60 * v}%)`;
        ctx.fillRect(canvas.width - 1, y, 1, 1);
      }
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }

  // --- About ------------------------------------------------------------------

  private about(): void {
    this.show(`<h2 class="sheet__title" id="sheet-title">About</h2>
      <p class="sheet__lede">The Salt Lake valley, played live as a piece of music. TRAX, FrontRunner and the ski buses are the groove; the lake is the drone; the sky picks how bright the mode is; the snow, the wind, the air and the ground under the city each have a voice. The melody is the Wasatch crest itself, thirteen summits from Ben Lomond to Mount Nebo, and the pad's waveform is the same ridge.</p>
      <p>Every phone plays the same bar at the same moment, about 90 seconds behind the valley. Nothing about you is recorded or sent anywhere.</p>
      <h3 class="sheet__sub">The data</h3>
      <ul class="credits">
        <li>Transit schedule: Utah Transit Authority, GTFS.</li>
        <li>Great Salt Lake and the Jordan River: U.S. Geological Survey.</li>
        <li>Weather, alerts: National Weather Service. Air quality and winds aloft: Open-Meteo (CC BY 4.0), with Copernicus CAMS.</li>
        <li>Snow: USDA NRCS SNOTEL, Snowbird.</li>
        <li>Earthquakes: USGS. The ground: University of Utah Seismograph Stations (network UU), via EarthScope.</li>
        <li>GREENbike: BCycle's GBFS feed.</li>
        <li>The crest: USGS 3DEP elevations.</li>
      </ul>
      <h3 class="sheet__sub">The sound</h3>
      <ul class="credits">
        <li>Piano: the Salamander Grand Piano by Alexander Holm (CC BY 3.0).</li>
        <li>Engine: Rust and <a href="https://github.com/ampactor-labs/sonido" target="_blank" rel="noopener">sonido</a>, compiled to WebAssembly and run in an AudioWorklet.</li>
        <li>Type: Shrikhand, Rubik and Space Mono (SIL Open Font License).</li>
      </ul>
      <p class="fine">Free software under the GNU AGPL. <a href="https://github.com/ampactor-labs/wasatch" target="_blank" rel="noopener">Source on GitHub</a>.</p>`);
  }
}
