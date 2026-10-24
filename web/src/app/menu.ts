// The menu: everything optional. Rewind, line up with the phone next to you,
// see every mapping live, and the credits. Each panel is a ski-poster card
// that slides up over the screen.

import { esc } from "../art/util.ts";
import { icon, type IconName } from "../art/index.ts";
import type { Host } from "../engine/host.ts";
import { clockEstimate } from "../engine/clock.ts";
import { mountainDate, mountainDay, mountainTime, receiptText } from "./captions.ts";
import { keyName, midiName } from "./music.ts";
import type { Schedule } from "./schedule.ts";
import { SECTION_NAMES, type PlayScreen } from "./screen.ts";
import type { Valley } from "./valley.ts";
import { TOPICS, type LowdownCtx, type Topic, type TopicId } from "./lowdown.ts";
import { STATIONS } from "../data/ground.ts";
import type { Conductor } from "../data/conductor.ts";
import { Kind, encodeSolo, encodeTwelve } from "../engine/protocol.ts";
import { PlayAlong } from "./playalong.ts";
import { parseGpx, soloFromRun } from "./run.ts";
import { TuneError, tuneToRoom } from "./tune.ts";

export interface MenuDeps {
  host: Host;
  valley: Valley;
  schedule: Schedule;
  /** The play screen, once Listen is tapped; the lowdown opens before it. */
  screen: PlayScreen | null;
  base: string;
  conductor: Conductor | null;
}

type PanelId = "play" | "run" | "rewind" | "tune" | "mappings" | "about";

const ITEMS: { id: PanelId; title: string; blurb: string; icon: IconName }[] = [
  { id: "play", title: "Play along", blurb: "Tip your phone like a ski; it can't play a wrong note", icon: "snowflake" },
  { id: "run", title: "Add your run", blurb: "A GPX of your run becomes a solo over the valley", icon: "mountain" },
  { id: "rewind", title: "Rewind", blurb: "An earlier hour, or a whole day in twelve minutes", icon: "chairlift" },
  { id: "tune", title: "Line up with a friend", blurb: "Nudge this phone to match the one next to it", icon: "bell" },
  { id: "mappings", title: "Show mappings", blurb: "The lowdown: every stream, what it plays, and where it came from", icon: "seismometer" },
  { id: "about", title: "About", blurb: "What this is, who made the data, the licenses", icon: "gull-small" },
];

/** Record `ms` of what this phone is playing; resolves with a download URL. */
function recordClip(host: Host, ms: number): Promise<{ href: string; ext: string }> {
  const node = host.output();
  if (!node) return Promise.reject(new Error("nothing is playing"));
  const dest = host.ctx.createMediaStreamDestination();
  node.connect(dest);
  const type = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
  const rec = new MediaRecorder(dest.stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  return new Promise((resolve, reject) => {
    rec.onerror = () => reject(new Error("the recorder failed"));
    rec.onstop = () => {
      node.disconnect(dest);
      const blob = new Blob(chunks, { type: rec.mimeType });
      resolve({ href: URL.createObjectURL(blob), ext: rec.mimeType.includes("mp4") ? "m4a" : rec.mimeType.includes("ogg") ? "ogg" : "webm" });
    };
    rec.start(1000);
    window.setTimeout(() => rec.stop(), ms);
  });
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export class Menu {
  private deps: MenuDeps;
  private sheet: HTMLElement;
  private closeTimer = 0;
  private raf = 0;
  private refresh = 0;
  private playing: PlayAlong | null = null;
  /** Undone whenever the panel changes or closes. */
  private cleanup: (() => void)[] = [];

  private tidy(): void {
    this.playing?.stop();
    this.playing = null;
    for (const f of this.cleanup.splice(0)) f();
  }

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
      if (this.sheet.hidden) return;
      if (e.key === "Escape") this.close();
      // A modal dialog: Tab cycles inside it.
      if (e.key === "Tab") {
        const focusable = [...this.sheet.querySelectorAll<HTMLElement>("button, [href], input, [tabindex]:not([tabindex='-1'])")].filter(
          (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    });
  }

  private body(): HTMLElement {
    return this.sheet.querySelector<HTMLElement>(".sheet__body")!;
  }

  private show(html: string): void {
    clearTimeout(this.closeTimer);
    cancelAnimationFrame(this.raf);
    clearInterval(this.refresh);
    this.tidy();
    this.body().innerHTML = html;
    this.sheet.hidden = false;
    requestAnimationFrame(() => this.sheet.classList.add("sheet--open"));
    this.sheet.querySelector<HTMLElement>(".sheet__close")?.focus();
  }

  close(): void {
    this.sheet.classList.remove("sheet--open");
    cancelAnimationFrame(this.raf);
    clearInterval(this.refresh);
    this.tidy();
    this.closeTimer = window.setTimeout(() => (this.sheet.hidden = true), 250);
    this.deps.screen?.root.querySelector<HTMLElement>('[data-action="menu"]')?.focus();
  }

  /** The play screen, once it exists. */
  setScreen(screen: PlayScreen): void {
    this.deps.screen = screen;
  }

  /** What the lowdown's live readings need. */
  lowdownCtx(): LowdownCtx {
    const { valley, schedule, conductor, screen } = this.deps;
    return { valley, schedule, conductor, bar: screen?.currentBar() ?? null, vantage: screen?.currentVantage() ?? 0 };
  }

  /** Open the lowdown at `id`. */
  lowdown(id: TopicId): void {
    this.mappings(id);
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
    if (id === "play") this.playAlong();
    else if (id === "run") this.run();
    else if (id === "rewind") this.rewind();
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
    // Whole days: any day that has begun and whose sky is known, live or
    // sealed in the archive.
    const now = Date.now();
    const playable = Object.entries(schedule.manifest.t0)
      .filter(([date, t0]) => t0 + 5 * 3_600_000 < now && (t0 > now - 30 * 3_600_000 || schedule.manifest.sky?.[date]))
      .sort((a, b) => b[1] - a[1]);
    const days = playable
      .slice(0, 7)
      .map(([date, t0]) => ({ date, label: now - t0 < 29 * 3_600_000 ? "Today so far" : `${mountainDay(t0 + 12 * 3_600_000)}, ${mountainDate(t0 + 12 * 3_600_000).replace(/, \d{4}$/, "")}` }));
    const oldest = playable.at(-1)?.[0];
    const newest = playable[0]?.[0];
    const inDay = this.deps.screen?.inDay() ?? false;
    this.show(`<h2 class="sheet__title" id="sheet-title">Rewind</h2>
      ${valley.shift || inDay ? `<button type="button" class="btn btn--sun" data-shift="0">Back to live</button>` : ""}
      <h3 class="sheet__sub">A Day in Twelve Minutes</h3>
      <p class="sheet__lede">A whole day, 5 AM to 5 AM, composed for the speed: three hundred bars, every bar 4.8 minutes of the day, the harmony moving every 38. Watch the trains race across the map.</p>
      <div class="chips">${days.map((d) => `<button type="button" class="chip" data-twelve="${d.date}">${esc(d.label)}</button>`).join("")}</div>
      ${playable.length > 7 && oldest && newest ? `<div class="pickday"><label>Another day <input type="date" min="${oldest}" max="${newest}" value="${playable[7]?.[0] ?? oldest}" /></label><button type="button" class="chip" data-pick>Play it</button></div>` : ""}
      <h3 class="sheet__sub">An earlier hour</h3>
      <p class="fine">The schedule, the sky, the lake and the quakes come back; GREENbike and the ground only play live.</p>
      <div class="chips">${hours
        .filter((_, i) => i < 6 || i % 3 === 2)
        .map((h) => `<button type="button" class="chip${h.shift === valley.shift ? " chip--on" : ""}" data-shift="${h.shift}">${esc(h.label)}</button>`)
        .join("")}</div>`);
    const playDay = async (date: string) => {
      if (!(date in schedule.manifest.days)) return;
      if (valley.shift) {
        valley.shift = 0;
        host.setTimeShift(0);
      }
      await valley.loadDays(schedule.twelveDates(date));
      host.post(Kind.TWELVE, encodeTwelve(date));
      this.close();
    };
    this.body()
      .querySelectorAll<HTMLButtonElement>("[data-twelve]")
      .forEach((b) => b.addEventListener("click", () => void playDay(b.dataset.twelve ?? "")));
    this.body()
      .querySelector<HTMLButtonElement>("[data-pick]")
      ?.addEventListener("click", () => {
        const input = this.body().querySelector<HTMLInputElement>('.pickday input[type="date"]');
        if (input?.value) void playDay(input.value);
      });
    this.body()
      .querySelectorAll<HTMLButtonElement>("[data-shift]")
      .forEach((b) =>
        b.addEventListener("click", async () => {
          const shift = Number(b.dataset.shift);
          if (this.deps.screen?.inDay()) host.post(Kind.TWELVE, encodeTwelve(null));
          valley.shift = shift;
          await valley.loadDays();
          host.setTimeShift(shift);
          this.close();
        }),
      );
  }

  // --- Play along --------------------------------------------------------------

  private playAlong(): void {
    const motion = PlayAlong.hasMotion();
    this.show(`<h2 class="sheet__title" id="sheet-title">Play along</h2>
      <p class="sheet__lede">${motion ? "Hold your phone flat like a ski and tip it onto its edges." : "Drag along the ski, or use the arrow keys."} Hold an edge and it plays the chord; wobble and it plays the notes between. It can't play a wrong note, and only you hear it.</p>
      ${motion ? `<button type="button" class="btn btn--sun" data-strap>Strap in</button>` : ""}
      <div class="skipad" tabindex="0" role="slider" aria-label="Your ski's edge" aria-valuemin="-1" aria-valuemax="1" aria-valuenow="0">
        <svg class="skipad__ski" viewBox="-160 -40 320 80" aria-hidden="true">
          <path d="M-140 -14 H118 C138 -14 150 -26 154 -34 C158 -22 152 4 128 14 H-140 C-150 14 -154 8 -154 0 C-154 -8 -150 -14 -140 -14 Z" fill="#FF4F9A" stroke="#1B1F3B" stroke-width="5" stroke-linejoin="round"/>
          <path d="M-120 -2 H100" stroke="#FFD23F" stroke-width="6" stroke-linecap="round"/>
          <rect x="-34" y="-24" width="68" height="20" rx="6" fill="#1B1F3B"/>
        </svg>
        <output class="skipad__note" aria-live="polite"></output>
      </div>
      <p class="fine">${motion ? "No sensor prompt? Drag along the ski instead." : "Tap the ski for a chord tone."}</p>`);
    const pad = this.body().querySelector<HTMLElement>(".skipad");
    const ski = this.body().querySelector<SVGElement>(".skipad__ski");
    if (!pad || !ski) return;
    const play = new PlayAlong(this.deps.host, (edge) => {
      ski.style.transform = `rotate(${(edge * 30).toFixed(1)}deg)`;
      pad.setAttribute("aria-valuenow", edge.toFixed(2));
    });
    this.playing = play;
    play.run();
    this.body()
      .querySelector<HTMLButtonElement>("[data-strap]")
      ?.addEventListener("click", async (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        const ok = await play.strapIn();
        b.textContent = ok ? "Strapped in: tip it" : "No motion sensor here; drag instead";
        b.disabled = true;
      });
    const edgeAt = (x: number) => {
      const r = pad.getBoundingClientRect();
      return ((x - r.left) / r.width) * 2 - 1;
    };
    pad.addEventListener("pointerdown", (e) => {
      pad.setPointerCapture(e.pointerId);
      play.edge(edgeAt(e.clientX));
      play.tap();
    });
    pad.addEventListener("pointermove", (e) => {
      if (pad.hasPointerCapture(e.pointerId)) play.edge(edgeAt(e.clientX));
    });
    let keyEdge = 0;
    pad.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        keyEdge = Math.max(-1, Math.min(1, keyEdge + (e.key === "ArrowLeft" ? -0.14 : 0.14)));
        play.edge(keyEdge);
        e.preventDefault();
      } else if (e.key === " " || e.key === "Enter") {
        play.tap();
        e.preventDefault();
      }
    });
    const out = pad.querySelector("output");
    this.cleanup.push(
      this.deps.host.onEvent((ev) => {
        if (ev.t === "play" && out) out.textContent = `♪ ${midiName(ev.m)}`;
      }),
    );
  }

  // --- Add your run --------------------------------------------------------------

  private run(): void {
    const { host, screen } = this.deps;
    this.show(`<h2 class="sheet__title" id="sheet-title">Add your run</h2>
      <p class="sheet__lede">Load a GPX from Slopes, Strava, a watch or any tracker. Your run becomes a piano solo over the valley: the vertical is the melody coming down, every turn is a note, speed is how hard it's played. The file is read on this device and never leaves it.</p>
      <label class="btn btn--sun filebtn">Choose a GPX<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden /></label>
      <p class="run__result" aria-live="polite"></p>
      <button type="button" class="btn" data-clip hidden>Save a 30-second clip</button>
      <p class="fine" data-cliphint hidden>The clip starts with your solo; it's a recording of this phone's audio, saved to your device.</p>`);
    const input = this.body().querySelector<HTMLInputElement>('input[type="file"]');
    const result = this.body().querySelector<HTMLElement>(".run__result");
    const clip = this.body().querySelector<HTMLButtonElement>("[data-clip]");
    const hint = this.body().querySelector<HTMLElement>("[data-cliphint]");
    input?.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file || !result) return;
      try {
        const { name, points } = parseGpx(await file.text());
        const { run, notes } = soloFromRun(points, name || file.name.replace(/\.gpx$/i, ""));
        host.post(Kind.SOLO, encodeSolo(notes));
        screen?.startSolo(notes.length);
        const ft = Math.round(run.dropM * 3.28084).toLocaleString("en-US");
        const mi = (run.distanceM / 1609.344).toFixed(1);
        result.textContent = `${run.name ? `${run.name}: ` : ""}${ft} ft of vertical, ${mi} mi, ${run.turns} turns, as ${notes.length} notes. It starts at the next bar.`;
        screen?.caption({ text: `Your run: ${ft} ft of vertical, ${run.turns} turns, as a solo`, receipt: "live", observed: Date.now(), at: performance.now(), family: "harmony" });
        if (clip && "MediaRecorder" in window) {
          clip.hidden = false;
          if (hint) hint.hidden = false;
        }
      } catch (err) {
        result.textContent = err instanceof Error ? err.message : String(err);
      }
    });
    clip?.addEventListener("click", () => {
      clip.disabled = true;
      clip.textContent = "Recording… 30 s";
      void recordClip(host, 30_000).then(
        (url) => {
          clip.disabled = false;
          clip.textContent = "Save a 30-second clip";
          const a = document.createElement("a");
          a.href = url.href;
          a.download = `wasatch-run.${url.ext}`;
          a.click();
        },
        (err: unknown) => {
          clip.textContent = `Couldn't record: ${err instanceof Error ? err.message : String(err)}`;
        },
      );
    });
  }

  // --- Line up --------------------------------------------------------------

  private tune(): void {
    const { host } = this.deps;
    const est = clockEstimate();
    const latency = Math.round(1000 * ((host.ctx.baseLatency || 0) + ((host.ctx as AudioContext & { outputLatency?: number }).outputLatency || 0)));
    this.show(`<h2 class="sheet__title" id="sheet-title">Line up with a friend</h2>
      <p class="sheet__lede">Every phone plays the same bar at the same moment. A Bluetooth speaker adds its own delay, which phones don't always report; nudge until the two of you sound like one.</p>
      ${isIOS() ? "" : `<button type="button" class="btn btn--sun" data-tune>Tune to the room</button>
      <p class="fine" data-tuned aria-live="polite">It ducks this phone for a few seconds and listens for the other one. Nothing is recorded or sent.</p>`}
      <div class="nudge">
        <button type="button" class="btn" data-nudge="-20" aria-label="Play 20 milliseconds earlier">−20 ms</button>
        <output class="nudge__value" aria-live="polite">${host.nudge >= 0 ? "+" : ""}${host.nudge} ms</output>
        <button type="button" class="btn" data-nudge="20" aria-label="Play 20 milliseconds later">+20 ms</button>
      </div>
      <p class="fine">This phone's clock: ${est.source === "header" ? `set from our server to within ±${Math.round(est.uncertainty)} ms` : "its own (the server's clock didn't answer)"}. Output delay it reports: ${latency} ms.${isIOS() ? " On an iPhone, the microphone can't be used for this without dropping Web Audio to call volume, so it's by ear." : ""}</p>`);
    const out = this.body().querySelector("output");
    const tuned = this.body().querySelector<HTMLElement>("[data-tuned]");
    this.body()
      .querySelector<HTMLButtonElement>("[data-tune]")
      ?.addEventListener("click", async (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.disabled = true;
        try {
          const r = await tuneToRoom(host, (msg) => {
            if (tuned) tuned.textContent = msg;
          });
          const shift = Math.round(r.shiftMs);
          host.setNudge(host.nudge + shift);
          if (out) out.textContent = `${host.nudge >= 0 ? "+" : ""}${host.nudge} ms`;
          if (tuned) {
            tuned.textContent =
              Math.abs(shift) < 15
                ? "You're already together, within 15 ms."
                : `The other phone is ${Math.abs(shift)} ms ${shift > 0 ? "behind" : "ahead"}; this one ${shift > 0 ? "waits for it" : "catches up"} over the next few seconds. (This phone's own round trip: ${Math.round(r.ownMs)} ms.)`;
          }
        } catch (err) {
          if (tuned) tuned.textContent = err instanceof TuneError ? err.message : "Something went wrong listening. Use the nudge instead.";
          if (!(err instanceof TuneError)) console.warn("tune:", err instanceof Error ? `${err.name}: ${err.message}` : err);
        } finally {
          b.disabled = false;
        }
      });
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

  /** One topic's live reading, as HTML. */
  private reading(t: Topic, ctx: LowdownCtx): string {
    const now = t.now?.(ctx);
    if (!now) return "";
    return `<span class="num">${esc(now.value)}</span> <span class="tag tag--${esc(now.receipt.split(" ")[0] ?? "")}">${esc(now.receipt)}</span>`;
  }

  private topicCard(t: Topic, ctx: LowdownCtx): string {
    const meta = [t.plays ? `Plays ${esc(t.plays)}` : "", t.source ? `<a href="${t.source.href}" target="_blank" rel="noopener">${esc(t.source.name)}</a>` : ""].filter(Boolean).join(" · ");
    return `<section class="topic" id="topic-${t.id}">
        <h3 class="topic__title">${esc(t.title)}</h3>
        <p class="topic__now" data-now="${t.id}">${this.reading(t, ctx)}</p>
        <p class="topic__about">${esc(t.short)} ${esc(t.more)}</p>
        ${meta ? `<p class="topic__meta">${meta}</p>` : ""}
      </section>`;
  }

  /** Show mappings: the lowdown on everything, opened at `focus`. */
  private mappings(focus?: TopicId): void {
    const ctx = this.lowdownCtx();
    const group = (g: Topic["group"]) => TOPICS.filter((t) => t.group === g).map((t) => this.topicCard(t, ctx)).join("");
    const playing = this.deps.host.ctx.state === "running";
    this.show(`<h2 class="sheet__title" id="sheet-title">Show mappings</h2>
      <p class="sheet__lede">Everything the piece reads from the valley, what it does with it, and where it came from, live.</p>
      <h3 class="sheet__sub">The valley</h3>
      <div class="topics">${group("valley")}</div>
      <h3 class="sheet__sub">The music</h3>
      <div class="topics">${group("music")}</div>
      ${playing ? `<h3 class="sheet__sub">The mix, live</h3><canvas class="spectrogram" width="720" height="200" aria-label="A spectrogram of what's playing"></canvas>` : ""}`);
    if (focus) {
      const card = this.body().querySelector<HTMLElement>(`#topic-${focus}`);
      if (card) {
        card.classList.add("topic--focus");
        // After the sheet's slide starts, so it scrolls inside the card.
        requestAnimationFrame(() => card.scrollIntoView({ block: "start", behavior: "auto" }));
      }
    }
    this.refresh = window.setInterval(() => {
      const c = this.lowdownCtx();
      for (const t of TOPICS) {
        const el = this.body().querySelector(`[data-now="${t.id}"]`);
        if (el) el.innerHTML = this.reading(t, c);
      }
    }, 2000);
    if (!playing) return;
    const canvas = this.body().querySelector<HTMLCanvasElement>(".spectrogram");
    const analyser = this.deps.host.analyser(2048);
    if (!canvas || !analyser) return;
    this.cleanup.push(() => this.deps.host.output()?.disconnect(analyser));
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const bins = new Float32Array(analyser.frequencyBinCount);
    const sr = this.deps.host.ctx.sampleRate;
    const draw = () => {
      analyser.getFloatFrequencyData(bins);
      // Scroll left one pixel, then paint the newest column on a log axis.
      ctx2d.drawImage(canvas, -1, 0);
      const h = canvas.height;
      for (let y = 0; y < h; y++) {
        const f = 30 * Math.pow(16000 / 30, 1 - y / h);
        const k = Math.min(bins.length - 1, Math.round((f / (sr / 2)) * bins.length));
        const db = bins[k] ?? -140;
        const v = Math.max(0, Math.min(1, (db + 110) / 80));
        ctx2d.fillStyle = `hsl(${250 - 230 * v} 90% ${8 + 60 * v}%)`;
        ctx2d.fillRect(canvas.width - 1, y, 1, 1);
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
