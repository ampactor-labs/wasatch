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
  | "service"
  | "planes"
  | "storm"
  | "grid"
  | "roads"
  | "avalanche"
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
      "The horn is voiced like the Nathan K5LA that FrontRunner's locomotives carry (D♯ F♯ G♯ B D♯, a major-sixth chord), rebuilt on the nearest major-sixth chord in the notes in play so it never clashes. The music knows it's coming: the conductor reads FrontRunner's predicted time at Central, a card says when it's due, and the phrase it arrives in turns for home (its dominant, then home, the horn landing on the cadence). It's the one cadence the lake doesn't get to leave open, except in the lake's own sections.",
    plays: "the horn",
    source: { name: "UTA realtime, by the conductor", href: "https://www.rideuta.com/Services/FrontRunner" },
    now: (c) => {
      const fleet = c.valley.liveFleet();
      if (!fleet) return null;
      const n = frontRunnersOut(c);
      const due = c.valley.frontRunnerDue;
      const next = due > c.valley.now() ? ` · next at Central ${mountainTime(due)}` : "";
      return { value: `${n} FrontRunner ${n === 1 ? "train" : "trains"} out, Ogden to Provo${next}`, receipt: `live ${mountainTime(fleet.t)}` };
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
    title: "The rivers",
    group: "valley",
    short: "The Jordan and Little Cottonwood Creek, against what's usual for the date, set the bass: long notes when they run low, a walking line when they run high.",
    more:
      "Two gauges report every 15 minutes: the Jordan at 1700 South, and Little Cottonwood Creek where it meets it, the canyon's runoff, which jumps in a storm and in the spring melt. Each flow is placed among that day of the year's percentiles and the two are averaged, so spring runoff walks and a dry August holds.",
    plays: "the bass",
    source: { name: "USGS 10171000 and 10168000", href: "https://waterdata.usgs.gov/monitoring-location/USGS-10171000/" },
    now: (c) => {
      const r = c.valley.river;
      if (!r) return null;
      const gauges = r.value.gauges?.map((g) => `${g.name.replace(" River", "").replace("Little Cottonwood Creek", "Little Cottonwood")} ${Math.round(g.cfs)} cfs`).join(" · ") ?? `${Math.round(r.value.cfs)} cfs`;
      return { value: `${gauges} · ${Math.round(r.value.position * 100)}th percentile for the date`, receipt: receipt(r) };
    },
  },
  {
    id: "snow",
    title: "Snow",
    group: "valley",
    short: "New snow in the Cottonwoods swells the dawn, and snow falling in the mountains sparkles: smaller and glassier the lighter the powder.",
    more:
      "Four SNOTEL stations, Snowbird, Brighton, Thaynes Canyon and Mill-D North, give the overnight new snow (the most at any of them, and where) and the snowpack against its median; a fuller snowpack adds voices and upper notes to the pad. Snowfall in the mountains comes from the forecast model, hour by hour. POW DAY is earned at six inches.",
    plays: "the dawn swell and the sparkle",
    source: { name: "NRCS SNOTEL", href: "https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=766" },
    now: (c) => {
      const s = c.valley.snow;
      if (!s) return null;
      const where = s.value.newIn >= 1 && s.value.newAt ? ` at ${s.value.newAt}` : "";
      const up = s.value.upHighF !== null && s.value.upHighF !== undefined ? ` · ${Math.round(s.value.upHighF)}°F at Snowbird` : "";
      return { value: `${s.value.newIn.toFixed(0)} in new overnight${where} · snowpack ${Math.round(s.value.ratio * 100)}% of median${up}`, receipt: receipt(s) };
    },
  },
  {
    id: "sky",
    title: "The sky",
    group: "valley",
    short: "The airport's hourly weather report picks how bright the mode is: clear skies lean Lydian and major, cloud and storms lean minor.",
    more:
      "One report steers each hour, the one KSLC makes near :54, so every phone reads the same sky. Only observations steer the music; the forecast models only color it. Falling pressure (a storm on its way) builds tension. The temperature colors the whole mix: a scorching day gets a little warmth, a gentle saturation and a softer top; a bitter one a glassier top; anything from 41 to 68 °F is left alone. A day's sky is sealed into the archive once it's over.",
    plays: "how bright the mode is, and the mix's warmth",
    source: { name: "KSLC weather reports", href: "https://www.weather.gov/slc/" },
    now: (c) => {
      const sky = c.valley.sky;
      if (!sky) return null;
      const hour = sky.value.hours.find((h) => h.at === Math.floor((c.valley.now() - 20 * 60_000) / 3_600_000) * 3_600_000);
      const cloud = hour && Number.isFinite(hour.cloud) ? ` · cloud ${Math.round(hour.cloud * 100)}%` : "";
      const warm = c.bar?.warm ?? 0;
      const color = warm > 0.05 ? " · warm in the heat" : warm < -0.05 ? " · glassy in the cold" : "";
      const p = sky.value.pressureHpa;
      const tend = sky.value.pressureTend ?? Number.NaN;
      const pressure = p !== undefined && Number.isFinite(p) ? ` · ${Math.round(p).toLocaleString("en-US")} hPa${Number.isFinite(tend) ? (tend <= -1 ? " falling" : tend >= 1 ? " rising" : " steady") : ""}` : "";
      return { value: `${sky.value.description || "—"}${cloud}${pressure}${color}`, receipt: receipt(sky) };
    },
  },
  {
    id: "air",
    title: "Air and the inversion",
    group: "valley",
    short: "Haze dulls the pad and the skyline. An inversion puts a low ceiling on the reverb and brings far-off sounds closer, as it does outside.",
    more:
      "Under an inversion, warm air sits on cold, sound bends back toward the ground and carries: an event 30 km away comes about 10 dB closer. The reverb gets a low, dark ceiling. PM2.5 sets how much of the skyline you can see, from every ridge on a clean day to the outline in thick haze; it never muddies the sound. It's the model's, or, with AirNow's key, what the valley's monitors measured in the hour before.",
    plays: "the reverb's ceiling and the haze",
    source: { name: "Open-Meteo, with Copernicus CAMS", href: "https://open-meteo.com/en/docs/air-quality-api" },
    now: (c) => {
      const sky = c.valley.sky;
      if (!sky || !Number.isFinite(sky.value.pm25)) return null;
      // Measured: Snowbird's station against the airport, beyond the usual
      // fall of about 3.6 °F a thousand feet (17.6 °F between them).
      const up = c.valley.snow?.value.upHighF;
      const down = sky.value.tempC;
      const measured =
        up !== null && up !== undefined && Number.isFinite(down) ? ` · Snowbird ${Math.round(up)}°F, the valley ${Math.round((down * 9) / 5 + 32)}°F${up - ((down * 9) / 5 + 32 - 17.6) > 4 ? ": inverted" : ""}` : "";
      const air = c.valley.keyed?.airnow;
      const pm = air && c.valley.keyed?.measured.air ? `AQI ${air.aqi}, ${air.category.toLowerCase()} (measured at ${air.area})` : `PM2.5 ${sky.value.pm25.toFixed(0)} µg/m³ (model)`;
      return { value: `${pm} · ${sky.value.inversionC.toFixed(1)} °C warmer aloft (model)${measured}`, receipt: receipt(sky) };
    },
  },
  {
    id: "wind",
    title: "Wind on the ridges",
    group: "valley",
    short: "Ridge gusts play an Aeolian harp: the faster the wind, the higher the string it sounds, always on a note of the chord.",
    more:
      "Wind across a wire sheds vortices at a frequency set by its speed (about 200 Hz for every metre a second across a 1 mm string). That picks the register, and the harp plays the nearest chord tone, never the raw harmonic. The wind is the forecast's at Alta, or, with UDOT's stations, the wind measured up the canyons in the hour before.",
    plays: "the harp",
    source: { name: "Open-Meteo at Alta; UDOT's stations, with its key", href: "https://open-meteo.com/" },
    now: (c) => {
      const sky = c.valley.sky;
      const w = c.valley.keyed?.udot?.wind;
      if (w && c.valley.keyed?.measured.wind) return { value: `gusts ${Math.round(w.gustMs * 2.237)} mph measured up the canyons (${w.stations.length} stations)`, receipt: "live" };
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
    id: "storm",
    title: "A storm on its way",
    group: "valley",
    short: "When the forecast says snow is coming to Alta, the harmony holds in suspense, the pad darkens and the bass pins itself to home, until the snow starts falling.",
    more:
      "The National Weather Service's forecast grid gives the snow expected at Alta over the next day. From two inches it starts to color the music; by a foot it's all suspensions, a dark pad, the lake's drone swelled up, and fills every phrase. It's a forecast, so it only colors the bars and never moves the plan; the conductor freezes each hour's reading so every phone hears the same storm coming. The moment snow is falling, the storm has arrived and its color lets go: the release.",
    plays: "suspensions, a dark pad and a pedal bass",
    source: { name: "NWS forecast grid, Alta", href: "https://forecast.weather.gov/MapClick.php?lat=40.588&lon=-111.638" },
    now: (c) => {
      const sky = c.valley.sky;
      if (!sky) return null;
      const hour = sky.value.hours.find((h) => h.at === Math.floor((c.valley.now() - 20 * 60_000) / 3_600_000) * 3_600_000);
      const mm = hour?.stormMm;
      if (mm === undefined || !Number.isFinite(mm)) return { value: "no forecast yet", receipt: "waiting" };
      return { value: mm >= 25 ? `${Math.round(mm / 25.4)} in forecast at Alta in the next day` : "no snow forecast at Alta", receipt: receipt(sky) };
    },
  },
  {
    id: "service",
    title: "UTA service alerts",
    group: "valley",
    short: "A new UTA service alert, a detour, a closure, a delay, plays a fill into the next phrase. One on the trains holds the tension up while it stands.",
    more:
      "The conductor reads UTA's service alerts every minute. A new one is a run on the toms at the end of its phrase and a crash on the next downbeat, a harder run when it suspends service, and a cymbal swell where the drums are out. UTA files an alert per route and direction, so a headline is counted once. While an alert stands on TRAX, the S-Line or FrontRunner, the phrases' approach chords carry a seventh.",
    plays: "fills, and tension",
    source: { name: "UTA service alerts", href: "https://www.rideuta.com/Rider-Info/Service-Alerts" },
    now: (c) => {
      const a = c.valley.serviceAlerts;
      if (!a) return null;
      const [bus, rail, fr, ski] = a.counts;
      const trains = rail + fr;
      return { value: `${bus + trains + ski} in effect · ${trains ? `${trains} on the trains` : "none on the trains"}${ski ? ` · ${ski} on the ski buses` : ""}`, receipt: "live" };
    },
  },
  {
    id: "planes",
    title: "Planes",
    group: "valley",
    short: "Every plane climbing out of SLC or coming in to land is a slow swell of brass and strings, sounding from where it is. A departure peaks late and rises; an arrival peaks early and falls.",
    more:
      "ADS-B is the position every airliner broadcasts; volunteers' receivers pick it up and adsb.lol shares it openly. The conductor looks every four minutes and lets one plane at a time into the music, twenty seconds apart at least, like a runway. The swell is two notes of the chord, low for a low plane and lower for a heavy one, and moves with the harmony. Airline flights are named on their cards; private aircraft never are.",
    plays: "brass and strings",
    source: { name: "adsb.lol (ODbL)", href: "https://adsb.lol/" },
    now: (c) => {
      const p = c.valley.livePlanes();
      if (!p) return null;
      const named = p.planes.filter((x) => x[6]).length;
      return { value: `${p.planes.length} in the air near SLC · ${named} airline ${named === 1 ? "flight" : "flights"}`, receipt: `live ${mountainTime(p.t)}` };
    },
  },
  {
    id: "grid",
    title: "The grid",
    group: "valley",
    short: "When the valley draws more power than usual for the hour, the whole mix swells a little; when it draws less, it eases off.",
    more:
      "The U.S. Energy Information Administration publishes PacifiCorp East's demand hour by hour. The latest hour is set against the same hour on the week's days before it: about a decibel for every 10% over or under, from −2 to +1.5, gliding over a few minutes and applied after the compressor so it isn't squeezed out.",
    plays: "the whole mix's level",
    source: { name: "EIA, PacifiCorp East demand", href: "https://www.eia.gov/electricity/gridmonitor/dashboard/electric_overview/balancing_authority/PACE" },
    now: (c) => {
      const g = c.valley.grid;
      if (!g) return null;
      const pct = Math.round((g.value.energy - 1) * 100);
      return { value: `${g.value.mw.toLocaleString("en-US")} MW · ${pct >= 0 ? "+" : ""}${pct}% on the usual for the hour`, receipt: receipt(g) };
    },
  },
  {
    id: "roads",
    title: "The roads",
    group: "valley",
    short: "A crash or closure on the valley's highways hangs the harmony until it clears; avalanche control booms up the canyon; traction law is a low brass pedal; plows in a storm are brushes.",
    more:
      "UDOT's traffic feed: incidents on I-15, I-80, I-215, Bangerter and the valley's other highways (roadwork isn't news) suspend the chord in the bar they open, hold the tension up while they stand, and bring the harmony home in the bar they clear; they slow the fleet's flow too. Closures for avalanche control on SR-210 or SR-190 are a low boom far into that canyon's echo. Traction law up a canyon is a pedal on home from there, a phrase at a time. Snowplows out in the valley while it snows play brushes on the off-beats, more the more plows. UDOT's weather stations up the canyons give the harp the wind as measured.",
    plays: "the harmony's suspense, a boom, a pedal and brushes",
    source: { name: "UDOT Traffic", href: "https://www.udottraffic.utah.gov/" },
    now: (c) => {
      const u = c.valley.keyed?.udot;
      if (!c.valley.keyed) return null;
      if (!u) return { value: "waiting for UDOT's key", receipt: "off" };
      const t = u.state.traction;
      const traction = t[0] || t[1] ? ` · traction law up ${t[0] && t[1] ? "both Cottonwoods" : t[0] ? "Little Cottonwood" : "Big Cottonwood"}` : "";
      return { value: `${u.state.closures ? `${u.state.closures} incident${u.state.closures === 1 ? "" : "s"} on the highways` : "the highways clear"}${traction} · ${u.state.plows} plows out`, receipt: "live" };
    },
  },
  {
    id: "avalanche",
    title: "Avalanche danger",
    group: "valley",
    short: "The Utah Avalanche Center's forecast for the Salt Lake mountains, read each morning: the day's danger, on the board and here.",
    more:
      "The forecast is issued between 5 and 8 AM; the conductor looks every 15 minutes then, as the center asks, and no more. Its danger rose rates every aspect and elevation; the board shows the worst of it. What it plays will come once its real forecasts have been heard through a season.",
    source: { name: "Utah Avalanche Center", href: "https://utahavalanchecenter.org/forecast/salt-lake" },
    now: (c) => {
      if (!c.valley.keyed) return null;
      const a = c.valley.keyed.uac;
      if (!a) return { value: "waiting for the center's token", receipt: "off" };
      return { value: `${["no rating", "low", "moderate", "considerable", "high", "extreme"][a.danger] ?? "?"} · ${a.issued}`, receipt: "live" };
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
      const q = c.valley.catalog ?? c.valley.quakes;
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
    short: "Each part of the day has its tempo, 72 BPM at night up to 100 at rush hour, nudged up to 4 BPM by how the buses and trains are moving.",
    more:
      "The conductor watches the whole fleet's speed against what's usual for that hour of a weekday, a Saturday or a Sunday, and the trains' lateness. Each hour's flow nudges the tempo after it: a valley stuck in traffic holds the music back, a clear one lifts it. The tempo changes only at a section's start, by at most 4 BPM at a time, so the drop from last trains into the night takes four sections.",
    now: (c) => {
      if (!c.bar) return null;
      const why = c.bar.tempo === 9 ? " · up: the valley's moving quickly" : c.bar.tempo === 10 ? " · held back: the valley's crawling" : "";
      return { value: `${Math.round(c.bar.bpm)} BPM${why}`, receipt: "scheduled" };
    },
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
    short: "Squares are trains and dots are buses, where UTA last saw them; arrows are planes. Rings are sounds as they play, smaller and fainter the farther they are from where you listen.",
    more:
      "Rings at the seismometers swell with the ground's rumble. A train past the map's edge, FrontRunner up to Ogden or down to Provo, is an arrow on the frame pointing where it is. Planes point where they're flying and fade between sightings. Pick a place to listen from and the map marks it with YOU ARE HERE.",
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
  plane: "planes",
  service: "service",
  storm: "storm",
  grid: "grid",
  due: "frontrunner",
  road: "roads",
  traction: "roads",
  plows: "roads",
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

/** One reading on the play screen's conditions board. */
export interface Condition {
  topic: TopicId;
  label: string;
  value: string;
  /** "live 2:01 PM", "scheduled", "cached 1:45 PM", "waiting". */
  receipt: string;
}

/** The valley now, every live reading, as a ski area's conditions board
 * says it: short, in order of what moves fastest. */
export function conditions(c: LowdownCtx): Condition[] {
  const v = c.valley;
  const out: Condition[] = [];
  const add = (topic: TopicId, label: string, value: string, receipt: string) => out.push({ topic, label, value, receipt });
  const sky = v.sky;
  if (sky?.value.alerts.length) add("alerts", "Alert", sky.value.alerts[0]!, receipt(sky));
  const fleet = v.liveFleet();
  const counts = fleet?.counts ?? c.schedule.transitAt(v.now());
  const transitReceipt = fleet ? `live ${mountainTime(fleet.t)}` : "scheduled";
  add("trains", "Trains", counts.trains.toLocaleString("en-US"), transitReceipt);
  add("buses", "Buses", counts.buses.toLocaleString("en-US"), transitReceipt);
  const late = c.conductor?.lateness();
  if (late && !v.shift) add("trains", "Running", Math.abs(late.medianS) < 60 ? "on time" : `${Math.round(late.medianS / 60)} min ${late.medianS > 0 ? "late" : "early"}`, "live");
  const alerts = v.serviceAlerts;
  if (alerts && !v.shift) {
    const trains = alerts.counts[1] + alerts.counts[2];
    add("service", "UTA alerts", `${alerts.counts.reduce((a, b) => a + b, 0)}${trains ? ` · ${trains} rail` : ""}`, "live");
  }
  const planes = v.livePlanes();
  if (planes) add("planes", "Planes", `${planes.planes.length} near SLC`, `live ${mountainTime(planes.t)}`);
  if (v.lake) add("lake", "Lake", `${v.lake.value.ft.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ft`, receipt(v.lake));
  if (sky && Number.isFinite(sky.value.pm25)) add("air", "Air", `PM2.5 ${Math.round(sky.value.pm25)}${sky.value.inversionC >= 4 ? " · lid" : ""}`, receipt(sky));
  if (sky) {
    const f = Number.isFinite(sky.value.tempC) ? `${Math.round((sky.value.tempC * 9) / 5 + 32)}°F` : "";
    add("sky", "Sky", [sky.value.description, f].filter(Boolean).join(" ") || "—", receipt(sky));
  }
  if (v.snow) add("snow", "Snow", `${Math.round(v.snow.value.newIn)} in new${v.snow.value.newIn >= 1 && v.snow.value.newAt ? ` at ${v.snow.value.newAt}` : ""}`, receipt(v.snow));
  if (sky) {
    const hour = sky.value.hours.find((h) => h.at === Math.floor((v.now() - 20 * 60_000) / 3_600_000) * 3_600_000);
    const mm = hour?.stormMm;
    if (mm !== undefined && mm >= 25) add("storm", "Forecast", `${Math.round(mm / 25.4)} in at Alta`, receipt(sky));
    const p = sky.value.pressureHpa;
    const tend = sky.value.pressureTend ?? Number.NaN;
    if (p !== undefined && Number.isFinite(p)) add("sky", "Pressure", `${Math.round(p).toLocaleString("en-US")} hPa${tend <= -1 ? " ↓" : tend >= 1 ? " ↑" : ""}`, receipt(sky));
  }
  if (sky && Number.isFinite(sky.value.ridgeGustMs)) add("wind", "Ridges", `${Math.round(sky.value.ridgeGustMs * 2.237)} mph`, receipt(sky));
  if (v.river) add("river", "River", `${Math.round(v.river.value.cfs)} cfs`, receipt(v.river));
  const keyed = v.keyed;
  if (keyed?.udot && !v.shift) {
    const s = keyed.udot.state;
    const parts = [s.closures ? `${s.closures} incident${s.closures === 1 ? "" : "s"}` : "clear", s.traction[0] || s.traction[1] ? "traction law" : "", s.plows ? `${s.plows} plows` : ""].filter(Boolean);
    add("roads", "Roads", parts.join(" · "), "live");
  }
  if (keyed?.uac) add("avalanche", "Avalanche", ["no rating", "low", "moderate", "considerable", "high", "extreme"][keyed.uac.danger] ?? "?", "live");
  if (v.grid) {
    const pct = Math.round((v.grid.value.energy - 1) * 100);
    add("grid", "Grid", `${v.grid.value.mw.toLocaleString("en-US")} MW · ${pct >= 0 ? "+" : ""}${pct}%`, receipt(v.grid));
  }
  if (v.ground) {
    const loudest = Math.max(...v.ground.levels);
    add("ground", "Ground", `${Math.round(loudest * 100)}%`, "live");
  }
  const quakes = v.catalog ?? v.quakes;
  if (quakes) add("quakes", "Quakes", `${quakes.value.length} in 2 days`, receipt(quakes));
  add("bikes", "Bikes", `${v.bikes.events.length} in 10 min`, v.shift ? "live only" : "live");
  return out;
}
