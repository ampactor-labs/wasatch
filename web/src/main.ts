// Wasatch Symphony: the page. Build the engine and read the valley while the
// boot screen is up; on the tap, play the theme and fade the live stream in.

import "./styles/index.css";
import "./styles/app.css";
import { bootScene, type StickerKind } from "./art/index.ts";
import { Host, type EngineEvent, type Heard } from "./engine/host.ts";
import { syncClock, syncClockFromConductor } from "./engine/clock.ts";
import { Conductor } from "./data/conductor.ts";
import { Schedule } from "./app/schedule.ts";
import { Valley, daypartName } from "./app/valley.ts";
import { PlayScreen } from "./app/screen.ts";
import { keyName } from "./app/music.ts";
import { Menu } from "./app/menu.ts";
import { Explainer } from "./app/explain.ts";
import { withTerms } from "./app/lowdown.ts";
import { Ground, GroundSource } from "./data/ground.ts";
import { Kind, encodeTwelve } from "./engine/protocol.ts";

const BASE = import.meta.env.BASE_URL;
const app = document.getElementById("app")!;

/** The conductor, if one is deployed and answering: ?conductor=<url>, or
 * config.json. One that doesn't answer within four seconds is skipped, and
 * this phone reads the feeds itself. */
async function conductorUrl(): Promise<string | null> {
  let url: string | null = null;
  const asked = new URLSearchParams(location.search).get("conductor");
  if (asked && /^https?:\/\//.test(asked)) url = asked;
  else {
    try {
      const config = (await fetch(`${BASE}config.json`, { cache: "no-cache" }).then((r) => r.json())) as { conductor?: string | null };
      url = config.conductor ?? null;
    } catch {
      return null;
    }
  }
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (res.ok) return url;
  } catch {
    // Unreachable: fall through.
  }
  console.warn(`conductor at ${url} didn't answer; reading the feeds directly`);
  return null;
}

function bootStickers(valley: Valley | null): [StickerKind, StickerKind] {
  if (!valley) return ["801", "LISTEN LOCAL"];
  if ((valley.snow?.value.newIn ?? 0) >= 6) return ["POW DAY", "801"];
  const sky = valley.sky?.value;
  if (sky && sky.inversionC >= 5 && sky.pm25 >= 12) return ["INVERSION", "LISTEN LOCAL"];
  return ["801", "LISTEN LOCAL"];
}

/** Lock-screen controls and the "now playing" line. */
function mediaSession(host: Host, screen: PlayScreen, valley: Valley, toggle: () => void): void {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  const update = () => {
    ms.metadata = new MediaMetadata({
      title: "Wasatch Symphony",
      artist: `${daypartName(valley.now())} · ${keyName(screen.currentKey())}`,
      album: "Live from the Salt Lake valley",
      artwork: [
        { src: `${BASE}icon-192.png`, sizes: "192x192", type: "image/png" },
        { src: `${BASE}icon-512.png`, sizes: "512x512", type: "image/png" },
      ],
    });
  };
  update();
  host.onEvent((e) => {
    if (e.t === "bar" && e.bar === 0) update();
  });
  for (const action of ["play", "pause", "stop"] as const) {
    try {
      ms.setActionHandler(action, toggle);
    } catch {
      // Not every browser knows every action.
    }
  }
}

async function main(): Promise<void> {
  const schedule = new Schedule();
  let valley: Valley | null = null;
  let host: Host | null = null;
  let screen: PlayScreen | null = null;
  /** The menu and the explanations: there before the tap, so the start
   * screen's readings explain themselves too. */
  let menu: Menu | null = null;
  let listen = { text: "Tuning up…", enabled: false };

  // --- The boot screen, redrawn on resize with its button's state intact.
  const button = () => app.querySelector<HTMLButtonElement>('button[data-action="listen"]');
  const applyListen = () => {
    const b = button();
    if (!b) return;
    const label = b.querySelector(".boot__listen-text");
    if (label) label.textContent = listen.text;
    b.disabled = !listen.enabled;
  };
  const setListen = (text: string, enabled: boolean) => {
    listen = { text, enabled };
    applyListen();
  };
  const setStatus = () => {
    if (!valley) return;
    const s1 = app.querySelector('[data-slot="status1"]');
    const s2 = app.querySelector('[data-slot="status2"]');
    if (s1) s1.innerHTML = withTerms(valley.status1());
    if (s2) s2.innerHTML = withTerms(valley.status2());
  };
  const drawBoot = () => {
    if (screen) return;
    const w = window.innerWidth;
    app.innerHTML = bootScene({
      daypart: valley?.daypart() ?? "rush",
      status1: valley ? valley.status1() : "Reading the valley…",
      status2: valley ? valley.status2() : "",
      haze: Math.min(1, Math.max(0, ((valley?.sky?.value.pm25 ?? 5) - 6) / 40)),
      stickers: bootStickers(valley),
      skylineWidth: w,
      skylineHeight: Math.round(Math.max(140, Math.min(260, w * 0.5, window.innerHeight * 0.22))),
    });
    applyListen();
    setStatus();
    button()?.addEventListener("click", () => start());
  };
  let resized = 0;
  const onResize = () => {
    clearTimeout(resized);
    resized = window.setTimeout(drawBoot, 150);
  };
  window.addEventListener("resize", onResize);
  drawBoot();

  // --- The tap.
  let paused = false;
  const toggle = async () => {
    if (!screen || !host) return;
    paused = !paused;
    if (paused) await host.suspend();
    else await host.resume();
    screen.setPaused(paused);
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = paused ? "paused" : "playing";
  };
  const start = () => {
    if (!listen.enabled || screen || !host || !valley) return;
    const h = host;
    const v = valley;
    window.removeEventListener("resize", onResize);
    // Everything that listens for the engine is in place before it starts.
    const s = new PlayScreen(app, {
      schedule,
      valley: v,
      onVantage: (code) => h.setVantage(code),
      onMenu: () => menu?.open(),
      onPause: () => void toggle(),
      onLive: () => h.post(Kind.TWELVE, encodeTwelve(null)),
    });
    screen = s;
    menu?.setScreen(s);
    h.onEvent((e: Heard<EngineEvent>) => {
      if (e.t === "bar") s.onBar(e);
      else if (e.t === "feat") s.onFeature(e);
      else if (e.t === "pulse") s.onPulse(e);
      else if (e.t === "theme") s.onTheme(e);
      else if (e.t === "play") s.onPlay(e);
      else if (e.t === "solo") s.onSolo(e);
      else if (e.t === "day") s.onDay(e);
      else if (e.t === "vantage") s.onVantage(e);
    });
    // Inside the tap's own call: the audio session, the context, the
    // keep-alive element.
    void h.start(`${BASE}audio/keepalive.mp3`).catch((err) => console.error(err));
    s.mount();
    mediaSession(h, s, v, () => void toggle());
    if (new URLSearchParams(location.search).has("debug")) void import("./app/debug.ts").then((d) => d.mountDebug(h, conductor));
    // A shared link to a day: play it in twelve minutes after the welcome.
    const asked = new URLSearchParams(location.search).get("day");
    if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked in schedule.manifest.days) {
      void v.loadDays(schedule.twelveDates(asked)).then(() => window.setTimeout(() => h.post(Kind.TWELVE, encodeTwelve(asked)), 9000));
    }
    // The ground: the city's seismometers, if the server will have us.
    // With a conductor, the ground comes in its windows; without, straight
    // from EarthScope.
    const direct = () => {
      const seismometers = new GroundSource();
      const g = new Ground(h, seismometers, (x) => v.setGround(x));
      g.start();
      seismometers.connect().catch((err) => console.warn("ground:", err));
      return g;
    };
    if (conductor) {
      const fromConductor = new Ground(h, conductor, (g) => v.setGround(g));
      fromConductor.start();
      // If the conductor goes quiet, this phone reads the valley itself.
      conductor.onLost = () => {
        console.warn("the conductor went quiet; reading the feeds directly");
        conductor.stop();
        fromConductor.stop();
        v.runFeeds();
        void v.refreshSky();
        void v.refreshSlow();
        void v.refreshQuakes();
        direct();
      };
    } else {
      direct();
    }
  };

  // --- Before the tap: the engine, the schedule, the valley, the piano.
  const conductorAt = await conductorUrl();
  const clock = (conductorAt ? syncClockFromConductor(conductorAt) : syncClock(`${BASE}schedule/manifest.json`)).catch(() => null);
  try {
    [host] = await Promise.all([Host.create(BASE), schedule.load(BASE)]);
  } catch (err) {
    console.error(err);
    setListen("This browser can't play it", false);
    const s1 = app.querySelector('[data-slot="status1"]');
    if (s1) s1.textContent = "It needs Web Audio worklets and WebAssembly: a current Safari, Chrome, Firefox or Edge.";
    return;
  }
  const h = host;
  const v = new Valley(h, schedule);
  const conductor = conductorAt ? new Conductor(conductorAt, h, v) : null;
  const m = new Menu({ host: h, valley: v, schedule, screen: null, base: BASE, conductor });
  menu = m;
  new Explainer(
    () => m.lowdownCtx(),
    (id) => m.lowdown(id),
  );
  // A handle for the end-to-end test and for the curious.
  Object.assign(window, {
    __wasatch: {
      host: h,
      valley: v,
      schedule,
      conductor,
      get state() {
        return h.ctx.state;
      },
    },
  });
  let pianoDone = false;
  void h.loadPiano(BASE, (loaded, total) => {
    if (!h.pianoReady()) setListen(`Tuning the piano ${Math.round((100 * loaded) / total)}%`, false);
    else if (!pianoDone) {
      pianoDone = true;
      setListen("Listen to the Wasatch", valley !== null);
    }
  });
  await Promise.all([v.prime(!conductor), conductor?.prime(), clock]);
  valley = v;
  drawBoot();
  if (h.pianoReady()) {
    pianoDone = true;
    setListen("Listen to the Wasatch", true);
  } else if (!listen.text.startsWith("Tuning the piano")) {
    setListen("Tuning the piano…", false);
  }
  v.onChange(() => {
    if (!screen) setStatus();
  });
  v.run(!conductor);
  conductor?.start();
  const statusTimer = setInterval(() => {
    if (screen) clearInterval(statusTimer);
    else setStatus();
  }, 1000);
}

void main();
