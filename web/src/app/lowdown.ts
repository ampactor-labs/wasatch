// The lowdown: everything on screen that comes from the valley or says
// something about the music, explained once, here. A tap on any of it
// shows its short version in a toast (explain.ts); the toast opens the
// whole story in Show mappings, scrolled to it.

import type { BarEvent, Heard } from "../engine/host.ts";
import type { Conductor } from "../data/conductor.ts";
import { STATIONS } from "../data/ground.ts";
import { clockEstimate } from "../engine/clock.ts";
import { mountainTime, receiptText } from "./captions.ts";
import { keyName } from "./music.ts";
import type { Schedule } from "./schedule.ts";
import { daypartName, transitPhrase, type Valley } from "./valley.ts";

export type TopicId =
  | "trains"
  | "frontrunner"
  | "buses"
  | "skibus"
  | "lake"
  | "river"
  | "snow"
  | "sky"
  | "air"
  | "wind"
  | "alerts"
  | "quakes"
  | "bikes"
  | "ground"
  | "sun"
  | "key"
  | "sections"
  | "tempo"
  | "dayparts"
  | "theme"
  | "vantages"
  | "receipts"
  | "sync"
  | "map"
  | "stickers";

/** What a topic's live reading needs. */
export interface LowdownCtx {
  valley: Valley;
  schedule: Schedule;
  conductor: Conductor | null;
  bar: Heard<BarEvent> | null;
  vantage: number;
}

export interface Reading {
  value: string;
  /** "live 11:09 AM", "scheduled", "cached 10:45 AM"… */
  receipt: string;
}

export interface Topic {
  id: TopicId;
  title: string;
  group: "valley" | "music";
  /** The toast: what it is and what the piece does with it, in a breath. */
  short: string;
  /** The rest of the story, for the lowdown. */
  more: string;
  /** What it plays. */
  plays?: string;
  source?: { name: string; href: string };
  now?: (c: LowdownCtx) => Reading | null;
}

const SECTION_NAMES = ["The theme", "Groove", "Atmosphere", "Journey", "The lake"];
const VANTAGE_NAMES = ["the whole valley, as a map", "the Gallivan Center, downtown", "Tanners Flat, up Little Cottonwood", "Saltair, on the lake"];

type R<T> = { value: T; observed: number; receipt: "live" | "cached" | "scheduled" } | null;
const receipt = <T>(x: R<T>) => (x ? receiptText(x) : "waiting");

function transit(c: LowdownCtx, which: "trains" | "buses"): Reading {
  const fleet = c.valley.liveFleet();
  if (fleet) {
    const n = fleet.counts[which];
    return { value: `${n.toLocaleString("en-US")} ${which === "trains" ? (n === 1 ? "train" : "trains") : n === 1 ? "bus" : "buses"} out`, receipt: `live ${mountainTime(fleet.t)}` };
  }
  const now = c.valley.now();
  const counts = c.schedule.transitAt(now);
  const phrase = transitPhrase(which === "trains" ? { buses: 0, trains: counts.trains } : { buses: counts.buses, trains: 0 }, "in service");
  return { value: phrase || `no ${which} in service`, receipt: "scheduled" };
}

/** FrontRunner trains among the fleet out now. */
function frontRunnersOut(c: LowdownCtx): number {
  const fleet = c.valley.liveFleet();
  return fleet ? fleet.trains.filter(([r]) => c.schedule.network.routes[r]?.kind === "frontrunner").length : 0;
}

export const TOPICS: readonly Topic[] = [
  // --- The valley -------------------------------------------------------------
  {
    id: "trains",
    title: "TRAX and the S-Line",
    group: "valley",
    short: "Every train leaving a station rings a bell on its line's note in the chord: the Blue Line the root, the Red the fifth, the Green the third.",
    more:
      "The conductor reads UTA's realtime every 10 seconds and settles a departure when its stop drops out of the predictions, so the bell rings when the train actually leaves. A late train rings a little late too (1 ms behind the beat for every 3 seconds late), and when the whole system runs late the drums lay back with it. Trains the feed isn't tracking ring on the schedule, and their cards say so. The map draws each train where UTA last saw it.",
    plays: "the bells",
    source: { name: "UTA realtime, by the conductor", href: "https://www.rideuta.com/" },
    now: (c) => {
      const t = transit(c, "trains");
      const fr = frontRunnersOut(c);
      const seen = c.conductor?.stats.observed;
      return { ...t, value: [t.value + (fr ? ` (${fr} of them FrontRunner)` : ""), seen ? `${seen} departures heard live` : ""].filter(Boolean).join(" · ") };
    },
  },
  {
    id: "frontrunner",
    title: "FrontRunner",
    group: "valley",
    short: "A FrontRunner train pulling into Salt Lake Central blows a five-note horn in the grade-crossing rhythm: long, long, short, long.",
    more:
      "The horn is voiced like the Nathan K5LA that FrontRunner's locomotives carry (D♯ F♯ G♯ B D♯, a major-sixth chord), rebuilt on the nearest major-sixth chord in the notes in play so it never clashes. A FrontRunner arrival at Central is also where a phrase can come home.",
    plays: "the horn",
    source: { name: "UTA realtime, by the conductor", href: "https://www.rideuta.com/Services/FrontRunner" },
    now: (c) => {
      const fleet = c.valley.liveFleet();
      if (!fleet) return null;
      const n = frontRunnersOut(c);
      return { value: `${n} FrontRunner ${n === 1 ? "train" : "trains"} out, Ogden to Provo`, receipt: `live ${mountainTime(fleet.t)}` };
    },
  },
  {
    id: "buses",
    title: "Buses",
    group: "valley",
    short: "How often UTA's buses stop, minute by minute, sets how busy the groove's hats and shakers are.",
    more:
      "A weekday has about 240,000 bus stops. Their rate, against what's usual for the hour, picks how many of sixteen steps the hats and shakers play, spread as evenly as they can be: the same rule that gives the world's traditional rhythms (three in eight is the tresillo). Buses are a groove, never single hits, so rush hour is dense but never a wall. The count of buses out is UTA's own, live; it runs higher than the schedule's “in service” because a bus laying over between trips already carries its next one.",
    plays: "the hats and shakers",
    source: { name: "UTA schedule and realtime", href: "https://www.rideuta.com/Rider-Info/Developer-Resources" },
    now: (c) => {
      const t = transit(c, "buses");
      const rate = Math.round(c.schedule.busRate(c.valley.now()));
      return rate > 0 ? { ...t, value: `${t.value} · ${rate} stops a minute` } : t;
    },
  },
  {
    id: "skibus",
    title: "Ski buses",
    group: "valley",
    short: "Each ski bus heading up a canyon plays drums in that canyon's echo: the 994 up Little Cottonwood, the 972 up Big Cottonwood.",
    more:
      "Canyon Service (CS1 to CS3) joins them in winter. The drums sound from partway up the canyon the bus climbs, so from Tanners Flat they're close and from downtown they're a distant rumble. They play in winter, when the ski season is on.",
    plays: "the canyon drums",
    source: { name: "UTA ski service", href: "https://rideuta.com/Rider-Info/Ski-Service" },
    now: (c) => {
      const trips = Object.entries(c.schedule.skiTrips(c.valley.now()));
      if (!trips.length) return { value: "none scheduled today", receipt: "scheduled" };
      return { value: trips.map(([short, n]) => `${short}: ${n} ${n === 1 ? "trip" : "trips"}`).join(" · ") + " today", receipt: "scheduled" };
    },
  },
  {
    id: "lake",
    title: "Great Salt Lake",
    group: "valley",
    short: "The lake's level is the low drone under everything. Below 4,198 ft, the level it's healthy at, phrases don't always come home.",
    more:
      "The drone sits on the key's root, low, with its overtones for phone speakers, and breathes about every 21 seconds; when wind sets the lake sloshing, it breathes deeper. The lower the lake, the more often a phrase ends somewhere other than home. THE LAKE IS LOW sticker shows below 4,195 ft.",
    plays: "the drone, and whether phrases come home",
    source: { name: "USGS 10010000, Saltair", href: "https://waterdata.usgs.gov/monitoring-location/USGS-10010000/" },
    now: (c) => {
      const l = c.valley.lake;
      if (!l) return null;
      const below = 4198 - l.value.ft;
      return { value: `${l.value.ft.toFixed(1)} ft${below > 0 ? ` · ${below.toFixed(1)} ft below healthy` : " · healthy"}`, receipt: receipt(l) };
    },
  },
  {
    id: "river",
    title: "Jordan River",
    group: "valley",
    short: "The river's flow against what's usual for the date sets the bass: long notes when it runs low, a walking line when it runs high.",
    more: "The gauge at 1700 South reports every 15 minutes; its flow is placed among that day of the year's percentiles, so spring runoff walks and a dry August holds.",
    plays: "the bass",
    source: { name: "USGS 10171000, 1700 South", href: "https://waterdata.usgs.gov/monitoring-location/USGS-10171000/" },
    now: (c) => {
      const r = c.valley.river;
      return r ? { value: `${Math.round(r.value.cfs)} cfs · ${Math.round(r.value.position * 100)}th percentile for the date`, receipt: receipt(r) } : null;
    },
  },
  {
    id: "snow",
    title: "Snow",
    group: "valley",
    short: "New snow at Snowbird swells the dawn, and snow falling in the mountains sparkles: smaller and glassier the lighter the powder.",
    more:
      "Snowbird's SNOTEL station gives the overnight new snow and the snowpack against its median; a fuller snowpack adds voices and upper notes to the pad. Snowfall in the mountains comes from the forecast model, hour by hour. POW DAY is earned at six inches.",
    plays: "the dawn swell and the sparkle",
    source: { name: "NRCS SNOTEL 766, Snowbird", href: "https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=766" },
    now: (c) => {
      const s = c.valley.snow;
      return s ? { value: `${s.value.newIn.toFixed(0)} in new overnight · snowpack ${Math.round(s.value.ratio * 100)}% of median`, receipt: receipt(s) } : null;
    },
  },
  {
    id: "sky",
    title: "The sky",
    group: "valley",
    short: "The airport's hourly weather report picks how bright the mode is: clear skies lean Lydian and major, cloud and storms lean minor.",
    more:
      "One report steers each hour, the one KSLC makes near :54, so every phone reads the same sky. Only observations steer the music; the forecast models only color it. A day's sky is sealed into the archive once it's over.",
    plays: "how bright the mode is",
    source: { name: "KSLC weather reports", href: "https://www.weather.gov/slc/" },
    now: (c) => {
      const sky = c.valley.sky;
      if (!sky) return null;
      const hour = sky.value.hours.find((h) => h.at === Math.floor((c.valley.now() - 20 * 60_000) / 3_600_000) * 3_600_000);
      const cloud = hour && Number.isFinite(hour.cloud) ? ` · cloud ${Math.round(hour.cloud * 100)}%` : "";
      return { value: `${sky.value.description || "—"}${cloud}`, receipt: receipt(sky) };
    },
  },
  {
    id: "air",
    title: "Air and the inversion",
    group: "valley",
    short: "Haze dulls the pad and the skyline. An inversion puts a low ceiling on the reverb and brings far-off sounds closer, as it does outside.",
    more:
      "Under an inversion, warm air sits on cold, sound bends back toward the ground and carries: an event 30 km away comes about 10 dB closer. The reverb gets a low, dark ceiling. PM2.5 sets how much of the skyline you can see, from every ridge on a clean day to the outline in thick haze; it never muddies the sound.",
    plays: "the reverb's ceiling and the haze",
    source: { name: "Open-Meteo, with Copernicus CAMS", href: "https://open-meteo.com/en/docs/air-quality-api" },
    now: (c) => {
      const sky = c.valley.sky;
      if (!sky || !Number.isFinite(sky.value.pm25)) return null;
      return { value: `PM2.5 ${sky.value.pm25.toFixed(0)} µg/m³ · ${sky.value.inversionC.toFixed(1)} °C warmer aloft`, receipt: receipt(sky) };
    },
  },
  {
    id: "wind",
    title: "Wind on the ridges",
    group: "valley",
    short: "Ridge gusts play an Aeolian harp: the faster the wind, the higher the string it sounds, always on a note of the chord.",
    more:
      "Wind across a wire sheds vortices at a frequency set by its speed (about 200 Hz for every metre a second across a 1 mm string). That picks the register, and the harp plays the nearest chord tone, never the raw harmonic.",
    plays: "the harp",
    source: { name: "Open-Meteo, at Alta", href: "https://open-meteo.com/" },
    now: (c) => {
      const sky = c.valley.sky;
      return sky && Number.isFinite(sky.value.ridgeGustMs) ? { value: `gusts ${Math.round(sky.value.ridgeGustMs * 2.237)} mph at Alta (forecast)`, receipt: receipt(sky) } : null;
    },
  },
  {
    id: "alerts",
    title: "Weather alerts",
    group: "valley",
    short: "A National Weather Service alert for the valley builds tension and drum fills until it's lifted.",
    more: "Alerts count from the hour after they're issued, so every phone hears the same change at the same moment.",
    plays: "tension and fills",
    source: { name: "NWS alerts", href: "https://alerts.weather.gov/" },
    now: (c) => {
      const sky = c.valley.sky;
      return sky ? { value: sky.value.alerts.length ? sky.value.alerts.join(", ") : "none", receipt: receipt(sky) } : null;
    },
  },
  {
    id: "quakes",
    title: "Earthquakes",
    group: "valley",
    short: "An earthquake in Utah's catalog rings a deep bell on the chord, louder for a bigger one.",
    more: "The catalog is read every minute. Utah has small ones most days; the bell comes once per quake, and its ring on the map sits where it was, pinned to the edge if it's far.",
    plays: "a deep bell",
    source: { name: "USGS earthquake catalog", href: "https://earthquake.usgs.gov/earthquakes/map/" },
    now: (c) => {
      const q = c.valley.quakes;
      if (!q) return null;
      const last = q.value.at(-1);
      return { value: q.value.length ? `${q.value.length} in 2 days · last M${last?.mag.toFixed(1)}` : "none in 2 days", receipt: receipt(q) };
    },
  },
  {
    id: "bikes",
    title: "GREENbike",
    group: "valley",
    short: "Every bike checked out or docked plucks a marimba, higher at stations farther north.",
    more: "The docks are read every 30 seconds. Checked out and returned sound the same note; the card says which.",
    plays: "the marimba",
    source: { name: "GREENbike (GBFS)", href: "https://greenbikeutah.org/" },
    now: (c) => ({ value: `${c.valley.bikes.events.length} bikes out or back in 10 min`, receipt: c.valley.shift ? "live only" : "live" }),
  },
  {
    id: "ground",
    title: "The ground",
    group: "valley",
    short: "Four seismometers under downtown hear the city's rumble, traffic and trains at 2 to 32 times a second, moved up into the chord so you can hear it.",
    more:
      "The University of Utah's stations at the Capitol, the Avenues, Brigham Young Park and the I-15 bridge each give one band of the city's vibration. Each band is shifted up onto a note of the chord, so the ground's real rise and fall plays as a hum. Nights are about four times quieter than days.",
    plays: "the ground's hum",
    source: { name: "University of Utah Seismograph Stations, via EarthScope", href: "https://quake.utah.edu/" },
    now: (c) => {
      const g = c.valley.ground;
      return g ? { value: STATIONS.map((s, i) => `${s.code} ${Math.round((g.levels[i] ?? 0) * 100)}%`).join(" · "), receipt: "live" } : { value: "not connected", receipt: "waiting" };
    },
  },
  {
    id: "sun",
    title: "Sun and moon",
    group: "valley",
    short: "The sun's height brightens the mode through the day; a fuller moon brightens the night's pad.",
    more: "Both are computed for Salt Lake City, to the minute, so the sun clears the Wasatch and drops behind the Oquirrhs on time.",
    plays: "how bright the mode is",
    source: { name: "NOAA's solar formulas", href: "https://gml.noaa.gov/grad/solcalc/" },
  },

  // --- The music --------------------------------------------------------------
  {
    id: "key",
    title: "The key and the dial",
    group: "music",
    short: "The dial shows the seven notes in play and which one is home. Every section, the harmony moves one note, and a card says why.",
    more:
      "The notes in play move one step around the circle at a time, pushed by how busy the valley is getting; how bright the mode is (Lydian brightest, minor darkest) follows the sky and the sun. The arrow shows where the valley is pushing next. Everything is in twelve-tone equal temperament, so nothing can sound wrong.",
    plays: "the harmony",
    now: (c) => (c.bar ? { value: `${keyName({ c: c.bar.c, r: c.bar.r })}, on ${/^[AEFHIOU]/.test(c.bar.chord) ? "an" : "a"} ${c.bar.chord} chord`, receipt: "scheduled" } : null),
  },
  {
    id: "sections",
    title: "Sections",
    group: "music",
    short: "The piece turns through the theme, the groove, the atmosphere, the journey and the lake, a minute to three each, chosen by the hour and the data.",
    more:
      "The groove puts transit up front; the atmosphere the weather, wind and snow, with the drums back; the journey everything at once; the lake its drone and a quiet cadence. Rush stretches the groove and a storm the atmosphere, but the whole cycle always fits in twelve minutes.",
    now: (c) => (c.bar ? { value: `${SECTION_NAMES[c.bar.kind] ?? ""} · bar ${c.bar.bar + 1} of ${c.bar.bars}`, receipt: "scheduled" } : null),
  },
  {
    id: "tempo",
    title: "Tempo",
    group: "music",
    short: "Each part of the day has its tempo, 72 BPM at night up to 100 at rush hour, nudged by how fast the fleet is moving.",
    more: "It changes only at a section's start, and by at most 4 BPM at a time, so the drop from last trains into the night takes four sections.",
    now: (c) => (c.bar ? { value: `${Math.round(c.bar.bpm)} BPM`, receipt: "scheduled" } : null),
  },
  {
    id: "dayparts",
    title: "The day's parts",
    group: "music",
    short: "Nocturne, first light, the working day, the evening rush and last trains (on weekends, the day and the evening) set the palette, the tempo and how dense it gets.",
    more: "They follow the clock in Salt Lake City, whatever time zone you're in.",
    now: (c) => ({ value: daypartName(c.valley.now()), receipt: "scheduled" }),
  },
  {
    id: "theme",
    title: "The Wasatch theme",
    group: "music",
    short: "Thirteen summits from Ben Lomond to Mount Nebo, played as a melody on the piano; the rider on the ridge skis it, and the pad's waveform is the same ridge.",
    more: "Each summit's height picks a note in the key the valley is in. The theme opens the piece, and a theme section brings it back.",
    plays: "the piano's melody",
  },
  {
    id: "vantages",
    title: "Where you listen from",
    group: "music",
    short: "Pick a spot and the mix becomes what you'd hear there: near is close, bright and dry, far is quiet, dark and echoing. The music doesn't change.",
    more:
      "Every family lives somewhere: the pad in the mountains, the drums in the city, the drone in the lake, the bass in the rivers, the harp on the ridges, the sparkle over the resorts. Each place echoes the music in its own way: downtown's towers flutter, the canyon slaps back on the beat, the Oquirrhs answer the lake. Friends listening from elsewhere are still in the same bar.",
    now: (c) => ({ value: VANTAGE_NAMES[c.vantage] ?? VANTAGE_NAMES[0]!, receipt: "you are here" }),
  },
  {
    id: "receipts",
    title: "Receipts",
    group: "music",
    short: "Every card says where it came from: live (seen just now), cached (the last good reading), scheduled (the timetable), or you are here (your choice).",
    more: "If a feed goes quiet, the music keeps going on the last good value or the schedule, and the card says so. Nothing is made up.",
  },
  {
    id: "sync",
    title: "The clock",
    group: "music",
    short: "Every phone plays the same bar at the same moment, about 90 seconds behind the valley, so a room of phones plays together.",
    more: "The 90 seconds give the feeds time to arrive. Each phone checks its clock against the conductor's; Line up with a friend fine-tunes the last few milliseconds for a speaker.",
    now: () => {
      const c = clockEstimate();
      return { value: `${c.source} clock, ±${Math.round(c.uncertainty)} ms`, receipt: "live" };
    },
  },
  {
    id: "map",
    title: "The map",
    group: "music",
    short: "Squares are trains, where UTA last saw them (or the schedule, when it can't). Rings are sounds as they play, smaller and fainter the farther they are from where you listen.",
    more:
      "Rings at the seismometers swell with the ground's rumble. A train past the map's edge, FrontRunner up to Ogden or down to Provo, is an arrow on the frame pointing where it is. Pick a place to listen from and the map marks it with YOU ARE HERE.",
  },
  {
    id: "stickers",
    title: "Stickers",
    group: "music",
    short: "The valley earns stickers: POW DAY after six inches, INVERSION under a lid of bad air, THE LAKE IS LOW below 4,195 ft, BLUEBIRD, FIRST CHAIR, LAKE EFFECT and more.",
    more: "When nothing's earned, it's 801 and LISTEN LOCAL.",
  },
];

export function topic(id: TopicId): Topic {
  return TOPICS.find((t) => t.id === id) ?? TOPICS[0]!;
}

export function isTopic(id: string | undefined): id is TopicId {
  return !!id && TOPICS.some((t) => t.id === id);
}

/** Which topic a caption family's card explains. */
export const FAMILY_TOPIC: Record<string, TopicId> = {
  trax: "trains",
  frontrunner: "frontrunner",
  skibus: "skibus",
  bike: "bikes",
  quake: "quakes",
  theme: "theme",
  lake: "lake",
  ground: "ground",
  wind: "wind",
  snow: "snow",
  sky: "sky",
  harmony: "key",
  vantage: "vantages",
  air: "air",
  river: "river",
  buses: "buses",
  late: "trains",
  alert: "alerts",
};

/** Which topic a sticker explains. */
export const STICKER_TOPIC: Record<string, TopicId> = {
  "POW DAY": "snow",
  INVERSION: "air",
  BLUEBIRD: "sky",
  "FIRST CHAIR": "skibus",
  "LAST CHAIR": "skibus",
  "LAKE EFFECT": "snow",
  "SEND IT": "sections",
  "THE LAKE IS LOW": "lake",
  "801": "stickers",
  "LISTEN LOCAL": "stickers",
};

/** Words in the status lines that explain themselves, and what they explain. */
const TERMS: [RegExp, TopicId][] = [
  [/\b(?:buses|bus)\b/, "buses"],
  [/\btrains?\b/, "trains"],
  [/\b(?:Nocturne|First light|Working day|Evening rush|Last trains|The day|Evening)\b/, "dayparts"],
  [/\b(?:air|Inversion|Hazy)\b/, "air"],
  [/\b(?:snow|Snowbird)\b/, "snow"],
  [/\bLake\b/, "lake"],
];

/** A status line as HTML, its data words made into buttons that explain them. */
export function withTerms(text: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  let out = "";
  let rest = text;
  for (;;) {
    let best: { at: number; len: number; id: TopicId } | null = null;
    for (const [re, id] of TERMS) {
      const m = re.exec(rest);
      if (m && (!best || m.index < best.at)) best = { at: m.index, len: m[0].length, id };
    }
    if (!best) break;
    const word = rest.slice(best.at, best.at + best.len);
    out += `${esc(rest.slice(0, best.at))}<button type="button" class="term" data-topic="${best.id}">${esc(word)}</button>`;
    rest = rest.slice(best.at + best.len);
  }
  return out + esc(rest);
}
