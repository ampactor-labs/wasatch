# Wasatch Symphony: design

Status: design, Oct 23, 2026. Nothing is built or deployed. The page at
ampactor.dev/wasatch (Oct 23) was a throwaway and is superseded by this; it
should come down before this ships, because the new repo wants the same URL.

## The idea

**The valley plays a symphony, live, and anyone can tune in.**

Trains, buses, snow, storms, wind, rivers, planes, bikes, the air and the
lake each play a part. The schedule is the score and the city is the
orchestra. Tap in at any hour, from anywhere, and you hear what the Wasatch
is doing right now, composed so it always sounds good, changes on a human
time scale, and tells you what you're hearing.

It is one piece for everyone. A commuter hears the trains, a skier hears the
snow and the canyon, everyone hears the weather, and the lake is under all of
it. "Where are you listening from?" rebalances the mix toward a place without
changing the piece.

What it is not: a dashboard with a soundtrack, a sonification demo that
plays one number as one tone, an app per company, or a just-intonation
experiment. It is music first. The data decides what the music does; it never
gets to make it sound bad.

## Principles

These come from the listener's side, and every later decision is checked
against them.

1. **It always sounds good.** Twelve-tone equal temperament, a curated
   harmonic vocabulary, quantized rhythm, density caps, a mastered mix. Data
   chooses among musically valid options; it never writes raw pitches.
2. **It is alive within seconds.** Sound in under 1.5 seconds from the tap.
   A recognizable theme first, then the live stream at the next bar.
3. **You can hear cause and effect.** Within 30 seconds of arriving, a
   listener hears at least one event and sees what it was: "that snare was
   the Blue Line arriving at Ballpark, one minute late."
4. **It changes on a human time scale.** Something changes every 8 bars,
   the section changes every two to three minutes, the key moves at every
   section boundary. Slow data is made audible through form, not by waiting
   for it to change.
5. **Everyone hears the same moment.** The piece is a function of the clock
   and the data, so two phones opened in the same room play the same bar.
   It's a radio station of the valley, not a personal generator.
6. **Never silent, never noise.** 3am still has a lake, wind, the ground and
   the odd cargo plane. 7am rush hour is dense but never a wall.
7. **Measured, not asserted.** Every reading on screen says where it came
   from and whether it's live or cached. If a feed is down the music keeps
   going on the last good value or the schedule, and says so.

## The listener's experience

### The first ten seconds

The screen before the tap is one line of status and one button:

```
FRIDAY 5:42 PM · EVENING RUSH · 377 VEHICLES MOVING
CLEAN AIR · NO NEW SNOW · LAKE 4,189.8 FT

          ▶  LISTEN TO THE WASATCH
```

Tap. Within a second the **Wasatch theme** plays on piano, in the key and
mode the valley is in right now, over the current pad. It's the shape of the
skyline as a melody (see "The theme"), so it's the same every time and it is
the piece's identity. It's local to the listener: a welcome, not part of the
shared stream. At the next bar line the live stream fades in under it and the
captions start.

### The first two minutes

The groove is the transit system. The listener hears a kick, notices a dot
flash on the map, reads "Red Line · Central Pointe · on time." A bike pluck,
then "GREENbike checkout · 200 S & 300 E." A low swell rises: "DL1784
departing SLC, climbing." At the end of the phrase, a drum fill that came
from a service alert. If nothing legible has happened in 20 seconds, the
engine pulls the next event forward from the queue; the 30-second guarantee is
a design rule, not luck.

### Thirty minutes

Sections rotate so that every family of data gets the foreground in turn
(the theme, the groove, the atmosphere, the journey, the lake). The key moves
around the circle of fifths at each boundary, and a caption says why: "The
valley is moving faster than a usual Friday → G major." Over half an hour a
listener hears ten or more modulations, every family featured more than once,
and the daypart drifting (the evening rush thinning into last trains).

### Hours

Background listening in a kitchen or a car. The day has its own arc because
the transit schedule has one: silence from about 1 to 4am, a dawn ramp as
buses go from about 2,400 stop events an hour to 14,000 by 7am, a long
plateau, a fade after 7pm, the last trains near midnight. Weather and season
color it. Two hours in, it should feel like a station you leave on, not a
loop you notice repeating.

### Six journeys this has to serve

| Who | When | What they should get |
|---|---|---|
| At a party, phone out | 20 seconds | The theme, a groove, one caption they can read aloud to a friend. The friend opens it and both phones play the same bar. |
| At home, working | 30–60 minutes | A piece that develops: keys move, sections rotate, the evening thins out. Never annoying. |
| Awake at 3am | Any length | A nocturne: the lake's drone, wind, a cargo plane swell, maybe an earthquake bell from a Milford swarm. Still beautiful, still alive. |
| Powder morning, in the canyon line | 10 minutes | A dawn swell sized to the overnight snow, the ski buses as canyon drums, a low boom when UDOT closes the road for avalanche control. It knows it's a powder day. |
| Inversion week, January | Days | The mix close and muffled under "the lid", the mode dark; when a storm clears the air, the whole piece opens up. That is the moment people will screen-record. |
| A data nerd | As long as they like | A "show mappings" view: every stream, its musical role, its last value, live or cached, with the source link. |

### The screen

One screen, austere, phone-first, in the brand: black, paper white, one
monospaced face, safety orange only on measured values.

- **The skyline** across the top: the Wasatch crest line that the theme is
  drawn from. A playhead moves along it whenever the theme plays.
- **The valley map** in the middle: TRAX and FrontRunner lines from the
  schedule's shapes, vehicles as dots that pulse when their event sounds,
  the canyons, the lake's edge. Events fade out in place.
- **The circle of fifths** as a small dial: current key and mode, the last
  move, and an arrow for where the valley is pushing it.
- **The caption line** at the bottom: the last three things you heard,
  each with its receipt ("live 5:42 PM" or "cached 4:45 PM").
- **Vantage**: a four-way control (Everywhere, Downtown, The Canyons, The
  Lake).
- **Play along**, **Add your run**, **Rewind** behind a single menu.

Lock-screen controls and artwork through the Media Session API, so it plays
in a pocket with a title like "Wasatch Symphony · Evening rush · G Mixolydian."

## Musical foundations

### Tuning, meter, tempo

- **Tuning: 12-tone equal temperament, A = 440 Hz.** Decision recorded at the
  end: it sounds right on every speaker and every listener's ear, and it
  makes every key on the circle equally usable.
- **Meter: 4/4** throughout. Night sections may use a half-time feel
  instead of a different meter.
- **Tempo by daypart**, changed only at section boundaries and only by a
  few BPM at a time:

| Daypart | Hours | Base BPM | Feel |
|---|---|---|---|
| Nocturne | 0:00–5:00 | 72 | Half-time, sparse, ambient |
| First light | 5:00–8:00 | 84 | Building, the overture |
| The valley at work | 8:00–16:00 | 96 | Full groove |
| Rush | 16:00–19:00 | 100 | Densest, most syncopated |
| Last trains | 19:00–24:00 | 88 | Winding down, intimate |

A data nudge of up to ±4 BPM comes from how fast the transit fleet is
actually moving compared with usual for that hour.

At 96 BPM a bar is 2.5 seconds, an 8-bar phrase is 20 seconds, and a 6-phrase
section is 2 minutes.

### The circle of fifths: the journey

The piece's large-scale motion is a walk around the circle of fifths. This
is where the data steers the composition hardest, and the rules keep it
sounding composed.

- **When:** a modulation happens at each section boundary (every two to
  three minutes), never mid-phrase.
- **How far:** one step at a time. Adjacent keys share six of seven notes,
  so every move is smooth. A relative major/minor swap counts as a move.
- **How:** through a pivot chord the two keys share, or by tonicizing the
  new key's dominant in the last bar of the outgoing section. Never a cold
  jump.
- **Which way:** the valley's trend over the section just finished. The
  engine compares the composite **flow** index (below) at the end of the
  section with its start:
  - flowing faster or brighter than it was → one step **sharpward** (C → G)
  - slowing, darkening or congesting → one step **flatward** (C → F)
  - flat within a dead band → relative major/minor swap, staying put on the
    circle
- **Gravity:** a soft pull toward the daypart's home region (bright sharp
  keys for the working day, flatter keys at night) so the walk doesn't drift
  to seven sharps and stay there. The pull grows with distance from home.
- **Caption every move:** "The valley sped up → D major." The listener
  learns the rule in two modulations.

Over 15 minutes a listener hears five or six moves, each one caused by
something real.

### Mode: the brightness ladder

Within a key, the mode sets the color. Ordered from brightest to darkest,
restricted to the five that always sound good:

**Lydian → Ionian → Mixolydian → Dorian → Aeolian**

Phrygian and Locrian are excluded; they sound wrong more often than right in
an ambient, everyone-listens setting.

The rung is chosen at each section boundary from the sky: sun up and clear is
Lydian or Ionian ("bluebird days play in Lydian"), clouds pull toward
Mixolydian and Dorian, active precipitation or night pulls toward Aeolian.
Air quality biases it darker during inversions. Hysteresis keeps it from
flapping between rungs on a borderline cloud cover.

### Harmony

- **Vocabulary per mode** is a curated bank of progressions that sound good
  looped and varied: Ionian `I–V–vi–IV`, `vi–IV–I–V`, `I–IV–vi–V`, `ii–V–I`;
  Lydian `I–II–I–vii`, `I–II–V–I`; Mixolydian `I–♭VII–IV–I`; Dorian `i–IV`,
  `i–♭III–♭VII–IV`; Aeolian `i–♭VI–♭III–♭VII`, `i–iv–♭VII–♭III`. Every
  chord in the bank is diatonic to its mode, and CI checks it (see Quality).
- **Chord types:** triads, sevenths, add9 and sus2/sus4. No diminished
  chords except as a passing chord in a cadence. Extensions (9ths, 11ths)
  come from the snowpack (below).
- **Harmonic rhythm** (how often chords change) comes from how much is
  moving: one chord per two bars when it's quiet, one per bar at rush, never
  faster than two per bar.
- **Voice leading:** each new chord moves each voice to the nearest chord
  tone; parallel fifths are not a concern in this idiom but large leaps are
  capped.
- **Tension:** a single 0–1 value (storms approaching, incidents, a rising
  lake-effect setup) biases the bank toward progressions that delay the
  tonic and adds pedal points and suspensions; release resolves them.

### The lake's rule

The Great Salt Lake controls how phrases end. Below 4,198 ft, a share of
cadences don't come home: in major, V goes to vi instead of I; in the other
modes the cadence lands on a non-tonic chord of the mode (IV in Dorian and
Mixolydian, ♭VI in Aeolian), or onto a sus2 tonic instead of a plain one.
The share is proportional to how far below 4,198 ft the lake is. At
4,189.8 ft (Oct 23) that's most of them. At or above 4,198 ft, cadences land
home. It sounds good either way, and it means the piece literally can't
come home until the lake does. Nobody has to know this to enjoy it; the
mappings view says it plainly for whoever looks.

### The theme

The piece's identity is the **Wasatch skyline as a melody**: the crest line
from Ben Lomond in the north to Mount Nebo in the south, sampled at eight to
twelve points, each elevation mapped to a scale degree in the current key.
It is computed once at build time from USGS 3DEP elevation along the crest,
so it is real, not drawn by hand. Illustrative contour, south of Salt Lake:
Mount Olympus (about 9,026 ft), Twin Peaks (about 11,330 ft), Lone Peak
(about 11,253 ft), Timpanogos (about 11,752 ft): a climb, a plateau, a last
rise.

The theme plays as the welcome on arrival, opens every "Theme" section, and
returns in fragments: a resort's voice plays its stretch of the skyline when
that resort opens for the day.

### Ranges

| Part | Range |
|---|---|
| Sub and bass | E1–E3 |
| Pads and harmony | C3–C5 |
| Theme and melody | C4–C6 |
| Ornaments (bikes, snow) | C5–C7 |

Every pitched event is quantized to the current scale and clamped to its
part's range.

## Form and time scales

Slow data can't be the only source of change, or a two-minute listener hears
nothing happen. So the piece runs on six time scales at once, and data enters
at the scale where a listener can hear it.

| Scale | Length at 96 BPM | What changes | Driven by |
|---|---|---|---|
| Event | instant | A hit, a pluck, a swell, a bell | Fast data: vehicles, bikes, planes, quakes |
| Bar | 2.5 s | Groove pattern, fills | Event rates, lateness |
| Phrase | 20 s | Variation, the guaranteed legible moment | Engine plus events |
| Section | 2–3 min | Focus, key, mode, tempo nudge | Data trends over the last section |
| Daypart | hours | Palette, base tempo, density ceiling | Clock, schedule |
| Season | months | Instruments present, harmonic richness | Resorts open, snowpack |

### Sections

Five section types rotate, in an order the engine varies but always cycles
within about 12 minutes, so a listener on for a few minutes hears several and
one on for 15 hears them all:

| Section | Foreground | Typical length |
|---|---|---|
| **Theme** | The skyline melody over the current harmony | 1 phrase intro, 4–6 phrases |
| **Groove** | Transit percussion, bass, bikes | 6–8 phrases |
| **Atmosphere** | Weather, wind, snow, air; drums recede | 4–6 phrases |
| **Journey** | Everything; the modulation lands here | 6 phrases |
| **Lake** | The lake's pedal and its cadence rule; a quiet section | 3–4 phrases |

Data stretches or shrinks them: rush extends Groove, a storm extends
Atmosphere, night shortens Groove to a heartbeat. Transitions always land on
a phrase boundary with a fill.

### Making slow data audible fast

Three techniques, used together.

1. **Instrumentation at arrival.** Snowpack, season and air set *what's
   playing*, which a listener hears in the first bar, not as a change.
2. **Foregrounding by rotation.** Each section puts a different family up
   front, so a slow value gets its moment every few minutes.
3. **Normalize against expectation.** Each raw value is compared with what's
   usual for that hour and day of week (rolling 30-day percentiles), and the
   music follows the *surprise* as much as the level. Rush hour is always
   busy; what's interesting is busier, later or quieter than a usual Friday
   at 5:40. The daypart provides the expected level, and the surprise
   provides the color.

## The valley state

The engine reads a small vector of normalized parameters, recomputed every
snapshot (30–60 s) and smoothed. Discrete choices (key, mode) use hysteresis
and minimum dwell times.

| Parameter | 0 to 1 meaning | Built from | Smoothing |
|---|---|---|---|
| `flow` | Gridlocked to flowing | Transit lateness vs usual, fleet speed, UDOT speeds and incidents | 5 min |
| `activity` | Asleep to rush | Vehicles in service, stop-event rate vs usual | 2 min |
| `tension` | Settled to building | Storm approaching (forecast precip, pressure falling), active incidents, alerts | 10 min |
| `brightness` | Night or storm to bluebird | Sun elevation, cloud cover, precipitation | 10 min |
| `openness` | Under the lid to open | PM2.5 and AQI | 30 min |
| `wetness` | Dry to dumping | Current snowfall or rain rate | 5 min |
| `wind` | Calm to howling | Ridge-top wind and gusts | 1 min |
| `snow` | Bare to deep | Snowpack vs median, overnight new snow | daily |
| `water` | Low to running | River flow vs usual for the month | 1 hour |
| `lake` | Record low to healthy | Elevation from 4,188.5 to 4,198 ft | daily |
| `energy` | Quiet to peak | Grid demand vs usual | 1 hour |
| `season` | Off-season to deep winter | Resorts open, date | daily |

Composite rules (initial weights, to be tuned by listening):

- `flow` drives the circle-of-fifths direction and the swing amount.
- `activity` drives density ceilings and harmonic rhythm.
- `tension` drives progression choice and pads' swell.
- `brightness` and `openness` drive the mode rung, filter cutoff and
  stereo width.
- `snow`, `wetness` and `season` drive instrumentation and extensions.
- `lake` drives the cadence rule and the sub-bass pedal level.
- `energy` drives the master's slowest swell, ±3 dB at most.

## Data → music

Each family has a home layer, a time scale and a caption template. Captions
are what make it legible; every featured event gets one.

### Transit (the groove)

The UTA schedule is the score: 243,304 stop events on a weekday, rail at
about 650–710 an hour from 6am to 10pm, buses at 12,000–14,500 an hour from
6am to 6pm. Realtime predictions are the performance.

| Data | Music | Caption |
|---|---|---|
| TRAX Red Line stop events | Kick (tuned, soft) | "Red Line · Central Pointe · on time" |
| TRAX Blue Line | Snare (brushed in quiet sections) | |
| TRAX Green Line | Rim and clap | |
| S-Line | Shaker | |
| FrontRunner | Floor tom or timpani: rare, heavy | "FrontRunner arrived at Salt Lake Central" |
| Ski buses 994 (Snowbird, Alta) and 972 (Solitude, Brighton) | Canyon toms with long canyon reverb, winter only | "994 · up Little Cottonwood to Snowbird" |
| Bus stop-event *rate* | Hi-hat and shaker pattern density from a pattern bank (8ths, 16ths, shuffled 16ths); individual bus events are not hits | |
| Lateness (predicted minus scheduled) | Microtiming: up to 30 ms behind the beat; a late system lays back | "Blue Line 2 min late" |
| Service alerts | Fills and crashes at the next phrase boundary | "Alert: bus bridge on the Red Line" |
| Vehicle position | Stereo pan (west valley left, east bench right) and distance (downtown dry, far valley wet) | |
| FrontRunner arriving at Central | The cadence home (as far as the lake allows) | |

Rail hits are individual and quantized to the 16th grid; at about 11 a
minute systemwide they're accents, roughly one every five seconds at midday,
which is what makes them legible. Buses are statistical so rush hour is a groove,
not a wall.

### Roads and canyons

| Data | Music | Caption |
|---|---|---|
| I-15 and canyon speeds vs usual (UDOT) | Feeds `flow` | |
| Incidents | A tension chord that resolves when cleared | "Crash cleared, I-15 at 600 S" |
| Little and Big Cottonwood closures, traction law | A low brass pedal under the canyon voices | "SR-210 traction law in effect" |
| Avalanche-control closures | A distant low boom, once | "Little Cottonwood closed for avalanche control" |
| Canyon traffic volume on powder mornings | Canyon tom density: the Red Snake as a rhythm | |
| Snowplows in service (UDOT) | Brushed noise texture in winter storms | |

### Water

| Data | Music | Caption |
|---|---|---|
| Great Salt Lake elevation | The sub-bass pedal under everything, and the cadence rule | "Lake 4,189.8 ft · 8.2 ft below healthy" |
| Jordan River, Little Cottonwood, City Creek flow vs monthly usual | Bassline activity: long roots at low flow, a walking line in spring runoff | "Jordan River 160 cfs" |

### Snow and the mountains

| Data | Music | Caption |
|---|---|---|
| Overnight new snow (SNOTEL depth, daily) | The dawn swell's size at first light; a huge one on a powder morning | "9 in at Snowbird overnight" |
| Current snowfall rate | Celesta and glockenspiel twinkles, density = rate | |
| Snowpack vs median | Number of pad voices and upper extensions (9ths, 11ths) | "Snowpack 112% of median" |
| Storm approaching (NWS forecast snowfall at Alta, pressure tendency) | `tension` builds for hours; release when snow starts | "8–14 in forecast tonight" |
| Ridge-top wind and gusts (Synoptic/MesoWest) | A wind layer of filtered noise; gusts as whooshes, panned by direction | "Hidden Peak gusting 45 mph" |
| Resort opening days | Each resort adds a voice to the ensemble for the season | "Alta opens today" |
| Resort first chair (opening time each day) | That resort's voice plays its stretch of the skyline theme | |
| Snowmaking window (wet-bulb from NWS temperature and humidity) | Soft white-noise layer while it's cold and dry enough for the guns | |
| Lake-effect events | The lake's pedal note doubles in the snow voices: the lake makes snow | "Lake-effect band over the Cottonwoods" |
| Avalanche activity (Utah Avalanche Center, with permission) | A rare, soft low settling sound; never a stand-in for the forecast; the caption links to it | "Avalanche reported, upper Little Cottonwood. Read the forecast →" |

Lake effect averages about 5–6% of Cottonwood resort snow, mostly in October
and November; lake dust took about 17 days off the 2022 snowpack. Both are
real, both belong in the mappings view.

### Weather and sky

| Data | Music |
|---|---|
| Sun elevation | `brightness`; filter openness over the day |
| Cloud cover, precipitation | Mode rung |
| Temperature | Timbre warmth (gentle saturation in heat, glassier in cold) |
| Moon phase | Night pad color (fuller moon, brighter nocturne) |

### Air

| Data | Music | Caption |
|---|---|---|
| PM2.5 and AQI | "The lid": low-pass cutoff and stereo width. Clean air is wide and open; an inversion closes the mix in, never to muddiness | "PM2.5 38 · under the lid" |

### The ground

| Data | Music | Caption |
|---|---|---|
| Earthquakes (USGS) | A bell; magnitude sets loudness and depth; at most one per 30 s | "M1.6 · 16 km NNE of Milford" |
| Seismometers in the city (Brigham Young Park, the Capitol, the Avenues, an I-15 bridge array) | The city's hum, audified (sped up into hearing range) and filtered, as a very low bed | "The ground at Brigham Young Park" |

The seismometer bed is the most unusual layer and the least certain: data
latency from EarthScope's waveform service hasn't been tested. If it's hours
behind, it plays in Rewind only.

### Bikes, planes, the grid

| Data | Music | Caption |
|---|---|---|
| GREENbike checkouts and returns (station status diffs) | Marimba or kalimba plucks in the current scale; dock latitude picks the scale degree | "GREENbike · 200 S & 300 E" |
| Flights at SLC (OpenSky) | Long swells: departures rise, arrivals fall; altitude sets register | "DL1784 departing, climbing" |
| Grid demand (EIA, PacifiCorp East) | The slowest swell: master dynamics ±3 dB | |

## Vantage: where are you listening from

One piece, four listening positions. The vantage changes the mix and the
captions, never the shared composition, so friends on different vantages are
still in the same bar.

| Vantage | Up front | Pushed back |
|---|---|---|
| Everywhere (default) | Balanced | — |
| Downtown | Transit groove, bikes, planes, the ground | Canyon voices |
| The Canyons | Snow, wind, ski buses, canyon roads, resort voices | Bus hi-hats |
| The Lake | The lake, rivers, wind, birds of the shoreline in a future layer | Transit |

## Interaction

All optional; the default is just listening.

- **Play along.** Hold the phone like a ski and tip it. The edge angle picks
  a scale degree in the current key and mode; a steady edge sustains chord
  tones, a wobble plays passing tones. Equal temperament plus scale
  quantization means it can't play a wrong note. Local to the player.
- **Add your run.** Load a GPX from any tracker; the run becomes a solo
  voice over the live valley: vertical drop as the melodic descent, speed as
  rhythm, turns as notes. The file is read in the browser and never leaves
  the device. Export a 30-second clip to share.
- **Rewind.** Any past date and time from the archive, at 1× or as **A Day
  in Twelve Minutes** (120×). The best demo at any hour, and a way to hear
  the morning of the best powder day of your life.
- **Show mappings.** The data-nerd view: every stream, its role, its last
  value, live or cached, with the source.

## Determinism and sync

The piece is a pure function: `compose(bar_index, snapshot, seed) → events`.

- `bar_index` is computed from wall-clock time against a fixed epoch and the
  current tempo map, so every client agrees which bar it is.
- The **snapshot** is the server-built valley state for the section's start,
  fetched by every client from the same cached URL, so every client makes the
  same decisions.
- All randomness comes from a seeded PRNG keyed on the date and section
  index.
- Clients estimate their clock offset from the snapshot's `served_at` and
  HTTP `Date` headers and align bar lines to it. Target: same bar within
  about 100 ms across phones in a room. Sample-accurate sync is a non-goal.
- The stream plays **about 90 seconds behind live** (a broadcast delay), so
  each bar's events are complete when it's composed. Captions show the
  event's real time.
- The same function renders offline, which makes Rewind exact and makes the
  listening harness possible (see Quality).

## Architecture

### Repo and hosting

- Its own repo, `ampactor-labs/wasatch` (name to confirm), hosted the way
  noodles is: Vite with `base: "/wasatch/"`, a GitHub Pages workflow
  (`actions/upload-pages-artifact`, `actions/deploy-pages`), served at
  ampactor.dev/wasatch.
- The Oct 23 page in the portfolio's `public/wasatch/` must be removed first;
  the two would collide on the same path.

### Modules

| Module | Language | Responsibility |
|---|---|---|
| `core` | Rust → WASM | The composition engine: valley state in, note events out. Pure, deterministic, property-tested. |
| `data` | TypeScript | Browser-side fetchers for open feeds, snapshot client, normalization helpers |
| `audio` | TypeScript + Rust/WASM | Scheduler and voices (Tone.js transport and samplers), master bus on sonido's kernels in an AudioWorklet (reverb, EQ, compressor, limiter, the lid filter) |
| `ui` | TypeScript | The screen, captions, map, dial, vantage, menus, Media Session |
| `proxy` | TypeScript (Cloudflare Worker) or Rust (Railway) | Pulls keyed or CORS-blocked feeds, builds snapshots, archives days |
| `schedule` | Rust or Node script in CI | Compiles UTA's GTFS weekly into compact per-day event tables |
| `theme` | Build script | Computes the skyline theme from USGS 3DEP elevations |

The Rust core is the deliberate choice: determinism you can test, one engine
for live and offline rendering, and a showcase of exactly the work Rust
real-time audio roles hire for. sonido's kernels already compile to WASM.

### Data pipeline

1. **The score, built in.** A weekly GitHub Action downloads
   `gtfsfeed.rideuta.com/GTFS.zip` (8.8 MB), compiles each service day into
   rail events (individually, with route, stop, time and coordinates) and bus
   rates (per minute, per area), and ships them as static assets. With every
   live feed down, the piece still plays the day from the schedule.
2. **Browser-direct feeds** (CORS open, tested Oct 23): USGS water and
   earthquakes, NWS (Alta forecast grid and SLC observations), NRCS SNOTEL,
   Open-Meteo air quality and weather, GREENbike GBFS, EarthScope station
   metadata.
3. **The proxy** handles everything else and is the single source of truth
   for the shared snapshot:
   - UTA GTFS-realtime (TripUpdate, Vehicle, Alert): open, no key, but no
     CORS and protobuf. Decoded server-side; lateness computed as predicted
     minus scheduled by joining against the schedule (the feed's own delay
     field read 0 everywhere on Oct 23).
   - OpenSky flights (CORS limited to their own site).
   - UDOT traffic API (free key, 10 calls a minute).
   - Synoptic/MesoWest ridge-top wind (free token, 5,000 requests a month:
     poll every 10–15 minutes and cache).
   - Utah Avalanche Center (token on request; ask first).
   - EIA grid demand (free key).
   It publishes `snapshot.json` every 30–60 s at the edge (every listener
   reads the same cached object, so feed rate limits are paid once) and an
   events log covering the last 15 minutes.
4. **The archive.** The proxy writes each snapshot and event log to object
   storage (R2) for Rewind. Kept indefinitely; it is small.

Proxy host is an open decision: a Cloudflare Worker with Cron Triggers, KV
and R2 (free tier, at the edge), or a Railway service alongside two-top's.

### Audio rendering

- **Samples for realism:** a sampled piano for the theme, orchestral strings,
  brass and percussion for pads, swells and the kit, mallets for ornaments.
  Candidates with permissive licenses: Versilian Studios' VSCO 2 Community
  Edition and VCSL (both CC0), and the Salamander Grand Piano (CC BY).
  Verify each license before shipping.
- **Synthesis for texture:** wind, the lid, sub-bass, snow sparkle.
- **Progressive loading:** a 3 MB "lite" set (piano, kit, one pad) so sound
  starts in under 1.5 s; the full set loads in the background.
- **Master bus:** sonido's reverb and filters in an AudioWorklet, then EQ,
  bus compression and a true-peak limiter at −1 dBTP.
- **Loudness target:** about −16 LUFS integrated, the usual streaming level
  for mobile.
- **Mono-compatible** mix for phone speakers at a party; full stereo on
  headphones.

### Performance budgets

| Budget | Target |
|---|---|
| Time to first sound | ≤ 1.5 s on a mid-range phone on LTE |
| Polyphony | ≤ 48 voices, with voice stealing by priority |
| CPU | ≤ 30% of one core on a mid-range Android |
| Memory for samples | ≤ 30 MB fully loaded |
| Snapshot size | ≤ 50 KB |
| Data requests per listener | One snapshot every 30–60 s plus a few direct feeds every few minutes |

### When things fail

| Failure | Behavior |
|---|---|
| A feed is down | Its layer uses the last good value, the caption says "cached," the music doesn't stop |
| The proxy is down | Schedule plus direct feeds; transit plays as written, no lateness |
| Offline entirely | Schedule plus the last snapshot in local storage |
| No transit (1–4am) | The nocturne palette; the lake, wind, ground and planes carry it |
| Audio context suspended (iOS lock screen) | Resume on return; see risks |

## Quality: how "always sounds good" is enforced

Measured, not asserted, applied to music.

- **Automated checks in CI** on rendered audio from recorded days:
  no clipping; loudness within ±1 LU of target; no silence longer than 4
  seconds; density never above the cap; every pitched event in the current
  scale and range; no more than one modulation per section; same input,
  same output (hash of the rendered event list).
- **The listening harness.** Render any archived day offline at faster than
  real time to audio files, then listen to fixed checkpoints (3am, 7am, noon,
  5:30pm, 11pm) after every mapping change. Mappings are tuned by ear against
  these renders, not by reasoning about them.
- **A listening rubric** for each checkpoint: Did something legible happen in
  the first 30 seconds? Did it sound good on a phone speaker? Was there a
  change I noticed within two minutes? Would I leave it on?
- **Accessibility:** captions are text (screen readers announce them at a
  polite rate), reduced-motion mode stills the map, a visible volume control,
  no autoplay.

## Privacy and terms

- GPX files never leave the device.
- No accounts, no listener tracking beyond aggregate page counts.
- Attribution in the footer and mappings view for every source (UTA, USGS,
  NRCS, NWS, Open-Meteo, BCycle/GREENbike, OpenSky, UDOT, Synoptic, UAC,
  EIA, EarthScope).
- Check before launch: UTA developer terms (developer.rideuta.com was
  unreachable from the research environment), OpenSky's terms for public
  display, Synoptic's free-tier terms, UAC's conditions on its data.

## Risks and open questions

| Risk | Mitigation |
|---|---|
| iOS suspends Web Audio when the screen locks | Media Session plus routing through an `<audio>` element; test early on real phones. Accept foreground-only if it can't be solved. |
| Mapping that's right on paper sounds bad | The listening harness; tune by ear |
| Rush hour too dense | Statistical buses, caps, priorities; verify in the 7am render |
| Lateness math wrong | Unit-test against the schedule join; spot-check against UTA's own arrival boards |
| Seismic latency | Rewind-only if it's slow |
| Avalanche data trivialized | UAC's permission first; the caption links to the forecast; never a danger-level soundtrack |
| Feed terms change or keys revoked | Every layer degrades to cached; nothing depends on a single feed |
| Sample licenses | Verify each; fall back to synthesis |
| Sync across phones drifts | Re-align at each phrase boundary; 100 ms is the bar |

## Milestones

Each one ends with something in someone's hands, per DAY.md.

| # | Milestone | Done when |
|---|---|---|
| M0 | Repo, Pages deploy, Rust core skeleton, scheduler, the lite sample set, the theme | A tap plays the theme and a schedule-only groove at ampactor.dev/wasatch, and one person has heard it |
| M1 | Circle-of-fifths journey, modes, sections, dayparts, the lake's rule, all from schedule plus direct feeds | A 15-minute listen has five key changes with captions; the 3am and 7am renders pass the rubric |
| M2 | Proxy: UTA realtime (lateness, vehicles), snapshot sync, map, captions, archive | Two phones in a room play the same bar; a late train lays back audibly |
| M3 | Weather, snow, wind, air, rivers, bikes, planes, quakes; vantage | A storm builds tension for hours in a recorded day; the canyon vantage on a powder morning sounds like one |
| M4 | Play along, Add your run, Rewind, A Day in Twelve Minutes, share clips, Media Session | A stranger records a run and shares the clip |
| M5 | Samples, mix and mastering pass, accessibility, attribution, launch | Leave it on for two hours and want to keep it on |
| Later | UDOT, Synoptic, UAC (with permission), seismic bed, resort voices with real opening times | Each with its own receipt |

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Tuning | 12-TET, A440 | Sounds right everywhere; every key on the circle is equally usable. Just intonation was dropped on Oct 23. |
| Meter | 4/4, half-time feel at night | Stable groove for transit percussion |
| Shared vs personal | Shared: everyone hears the same bar | The radio-station feeling; phones in a room in sync |
| Broadcast delay | ~90 s behind live | Complete events per bar, identical across clients |
| Engine language | Rust → WASM | Determinism, testability, one engine live and offline, the portfolio |
| Audio scheduling | Tone.js transport and samplers | Proven, and already used in noodles |
| Master bus | sonido kernels in an AudioWorklet | Rust DSP in production |
| Hosting | Own repo, GitHub Pages, ampactor.dev/wasatch | Like noodles; not the portfolio's public folder |
| Proxy host | Open: Cloudflare Worker or Railway | Decide at M2 |
| Name | "Wasatch Symphony"; repo `wasatch` (confirm) | |

## Non-goals

- A per-company product or integration.
- A forecasting or safety tool. It points to the Avalanche Center's forecast;
  it never replaces it.
- Sample-accurate sync between devices.
- Generated or AI-composed music. The engine is rules, a curated vocabulary
  and data, written by hand and tuned by ear.

## Appendix A: data catalog (tested Oct 23, 2026)

| Source | Endpoint | Auth | Browser CORS | Cadence | Sample reading |
|---|---|---|---|---|---|
| UTA schedule | `gtfsfeed.rideuta.com/GTFS.zip` | none | n/a (build time) | weekly | 86 routes; 243,304 weekday stop events |
| UTA realtime | `apps.rideuta.com/tms/gtfs/{TripUpdate,Vehicle,Alert}` | none | no | ~10 s | 377 vehicles, 388 trip updates at 5:19 PM |
| Great Salt Lake | USGS `nwis/iv` site 10010000, param 62614 | none | yes | 15 min | 4,189.8 ft at 4:45 PM (provisional) |
| Rivers | USGS `nwis/iv`, param 00060 | none | yes | 15 min | Jordan River at 1700 S 160 cfs; Little Cottonwood 117 cfs |
| Earthquakes | USGS FDSN event query, Utah bounding box | none | yes | minutes | 69 events in 3 days |
| Snowpack | NRCS AWDB `services/v1/data`, stations 766 Snowbird, 366 Brighton, 814 Thaynes Canyon, 628 Mill-D North | none | yes | daily (hourly query returned empty) | Snowbird depth 0 → 3 → 9 in Oct 12–13, 0 by Oct 19 |
| Mountain forecast | NWS `gridpoints/SLC/108,167` (Alta) | none (User-Agent) | yes | hourly | Gusts 61 km/h (38 mph) on the morning of Oct 23 |
| Air | Open-Meteo air-quality API | none | yes | hourly | PM2.5 2.3, AQI 40 |
| Weather | Open-Meteo forecast; NWS KSLC observations | none | yes | hourly | |
| GREENbike | `gbfs.bcycle.com/bcycle_greenbikeslc/` | none | yes | live | Station status per dock |
| Seismometers | EarthScope FDSN station and dataselect, network UU (AVE, BYP, CAP2, BSS, C846) | none | yes (metadata) | continuous | Waveform latency untested |
| Flights | OpenSky `states/all`, SLC bounding box | none (rate-limited) | no | ~10 s | Planes on approach and on the ground |
| Grid | EIA v2 `electricity/rto/region-data`, PACE | free key | yes | hourly | Works with DEMO_KEY |
| Roads | UDOT traffic API | free key, 10 calls/min | unknown | live | Not tested (needs key) |
| Ridge wind | Synoptic (MesoWest) | free token, 5,000 req/month | unknown | 5–15 min | Not tested (needs token) |
| Avalanche | Utah Avalanche Center API | token on request | no | daily plus observations | Returned 401 without token |
| Ski buses | In the UTA schedule: 994 (Snowbird, Alta), 972 (Solitude, Brighton) | none | n/a | weekly | Present in the current schedule |

## Appendix B: palette

| Voice | Instrument | Data |
|---|---|---|
| Theme | Grand piano | The skyline |
| Harmony | Strings ensemble, soft electric piano | Progressions, snowpack extensions |
| Sub and bass | Sine sub, plucked upright or synth bass | Lake pedal, river activity |
| Kit | Soft kick, brushed snare, rim, shaker, hats | TRAX lines, bus rate |
| Canyon toms | Toms with long reverb | Ski buses |
| FrontRunner | Timpani | Arrivals |
| Snow | Celesta, glockenspiel | Snowfall rate |
| Bikes | Marimba, kalimba | Checkouts and returns |
| Planes | Brass and string swells | Departures and arrivals |
| Quakes | Tubular bell, gong | Magnitude |
| Wind | Filtered noise | Ridge gusts |
| The ground | Audified seismometer bed | City hum |
| Resorts | One orchestral voice each (horn, clarinet, flute, harp …) | Opening days, first chair |

## Appendix C: a minute of rush hour, written out

Friday, 5:42 PM, Everywhere vantage. Section: Groove, phrase 3 of 8, B♭ Dorian
at 100 BPM (rush base 100, fleet speed normal). Clean air, so the lid is open
and wide. No snow, no storm in the forecast, tension 0.2.

- Bars 1–2: bus rate at 96th percentile for a Friday at this hour, so the
  hats play shuffled 16ths. Harmonic rhythm one chord per bar: `i–IV`.
- Bar 2, beat 3: a Red Line arrival at Ballpark lands as the kick, 18 ms
  behind (the train is 54 seconds late). Caption: "Red Line · Ballpark · 1
  min late."
- Bar 3: two GREENbike returns downtown, marimba on scale degrees 5 and 3.
- Bar 4, beat 1: DL2216 departing SLC, a string swell rising over four bars,
  panned left as it climbs out to the northwest.
- Bars 5–8: the phrase cadence, `♭VII` (A♭) heading for `i` (B♭ minor).
  The lake is 8.2 ft below 4,198, so this one lands on `IV` (E♭) instead,
  with a sus2 on top, and doesn't come home.
- Bar 8: a service alert on a bus route arrived during the phrase, so the
  fill is a tom run into a soft crash on the downbeat of phrase 4.

At the section boundary (2:40 from now) `flow` will have fallen slightly as
the rush thins, so the journey moves one step flatward: B♭ Dorian to E♭
Dorian, through the shared `B♭` minor chord, with the caption "The valley is
slowing down → E♭."
