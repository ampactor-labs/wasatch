# Wasatch Symphony: design

Status: revision 2, Oct 23, 2026, built and live at
[ampactor.dev/wasatch](https://ampactor.dev/wasatch/) on Oct 24. Revision 2
folds in a review of revision 1, a research pass on libraries, platforms and
feeds (with each feed fetched and decoded), and measurements taken the same
day: the skyline from USGS 3DEP (Appendix D), a benchmark of modal voices in
WebAssembly, and an inventory of what sonido already does. Appendix E lists
every change. **As built**, below, says where the build follows this design
and where it departs from it.

## As built

What's live, and where it differs from the rest of this document:

- **The look.** The brand described under "The screen" (black, paper white,
  one monospaced face) gave way to a goofy Wasatch trail-map look: a
  shredder in a neon one-piece riding the skyline summit to summit as the
  theme plays, a gull conducting, the harmony dial as a ski-lift bullwheel,
  captions on routed-wood Forest Service signs, stickers on the map's corners
  (POW DAY, INVERSION, THE LAKE IS LOW), sky gradients by daypart. Orange is
  still for measured values. Everything stops moving under reduced motion.
- **No conductor required.** The site plays from the compiled schedule and
  the open feeds the browser can read itself (USGS, NWS, Open-Meteo, SNOTEL,
  GBFS, the quake catalog, and the seismometers over EarthScope's DataLink
  WebSocket). Each phone plans the whole day itself: the plan is a pure
  function of the schedule, the sun and moon, and the sky's hourly slots, so
  score pages turned out unnecessary. The **conductor** (`conductor/`) is
  built and optional: it reads UTA's realtime (inferring departures from
  trip updates; late trains lay back as designed), KSLC's METARs, and the
  seismometers once for everyone, and seals 30-second windows at immutable
  URLs. It runs as a small Node process on the page's own TypeScript, not
  on the .wasm, on Railway at wasatch-production.up.railway.app, and the
  site reads it (conductor/README.md). It also serves UTA's fleet as it is,
  every 15 seconds: the map draws each train where UTA last saw it, and the
  status line counts the trains and buses out, by trip, saying it's live
  (more than the schedule's "in service", since a bus laying over already
  carries its next trip). Rewind and A Day in Twelve Minutes stay on the
  schedule.
- **The sky every phone agrees on.** NWS observations come every five
  minutes and have gaps (Oct 22 lost ten hours). The plan reads one slot an
  hour, the report nearest :54 in the quarter hour before the hour, and
  every phone fetches the same span (from four hours before the day's 5 AM
  anchor); alerts count from the hour after they're issued. Only
  observations steer the plan; model data (ridge wind, mountain snow, PM2.5,
  the inversion) only colors bars. Each finished day's sky is sealed from
  the METARs into the archive.
- **The archive.** GitHub Pages can't run a server, so the site is the
  archive: each daily build compiles against the deployed site, keeping the
  network append-only and carrying every earlier day forward with its
  schedule and sealed sky. Days from before the site existed are filled
  in: every date since the current feed took effect (Aug 16, 2026) is
  rebuilt from that feed, which was the published timetable then, and
  listed in the manifest's `rebuilt`; its sky is sealed from KSLC's METARs
  in the Iowa Environmental Mesonet's archive, with the models' last 92
  days for color. Rewind and A Day in Twelve Minutes reach back as far as it
  goes, with a shareable `?day=` link, and a day plays with the next one
  loaded, whose first trains end its night.
- **Clocks.** Without the conductor's `/time`, phones find our server's UTC
  from the moment its `Date` header ticks over (requests every 80 ms), which
  pins it to about half a round trip.
- **The engine.** Rust on sonido in one AudioWorklet, SIMD and scalar
  builds, 814 kB (281 kB gzipped). Departures from this document: the
  skyline oscillator is the engine's own (8 haze frames × 6 band limits, from
  the crest's DFT); the piano is 18 Salamander notes as MP3, decoded by
  symphonia in the engine itself; the modal voices use sonido's bar-physics
  presets rather than Faust; the worklet host lives here, not in sonido; the
  reverb's FDN tail runs at half rate. sonido gained true-peak limiting,
  up-conversion, counter-based random numbers, partitioned convolution,
  modal banks and GCC-PHAT for this (all pushed to its main).
- **The ground** sings one band per station rather than every station's
  octaves: the Capitol 2–4 Hz, the Avenues 4–8, Brigham Young Park 8–16, the
  I-15 bridge array 16–32 (where the freeway is), panned by station.
- **Tune to the room** measures this phone's own round trip with two 120 ms
  noise bursts rather than a click, and refuses unless each correlation peak
  stands well clear of the noise (a reverberant room measured 49 against a
  beep's 4.9). iPhones get the nudge, as planned.
- **Measured:** the engine at 7.4% of an Intel i5-6300U core in WebAssembly
  (5.6% native); −17 to −18 LUFS integrated at every daypart, true peak −1.3
  to −7 dBTP, no gaps; two renders bit-identical, and GitHub's runners
  render the same numbers as a laptop. CI listens to five dayparts and a
  whole day in twelve minutes on every push, and plays every menu feature in
  headless Chrome.
- **Not built yet:** planes (they need our own ADS-B receiver), UDOT's roads
  and plows (a key), the grid, UTA's service alerts, the resorts' own voices,
  sampled strings and brass (the pad and the horn are synthesized), rooms
  recorded on location (the vantages use modeled early reflections), and
  keeping old engines for Rewind's "as broadcast" playback.

## The idea

**The valley plays a symphony, live, and anyone can tune in.**

Trains, buses, snow, storms, wind, rivers, planes, bikes, the air, the ground
and the lake each play a part. The schedule is the score and the city is the
orchestra. Tap in at any hour, from anywhere, and you hear what the Wasatch is
doing right now, composed so it always sounds good, changes on a human time
scale, and tells you what you're hearing.

It is one piece for everyone. A commuter hears the trains, a skier hears the
snow and the canyon, everyone hears the weather, and the lake is under all of
it. "Where are you listening from?" moves you to a real place in the valley
and rebalances the mix from there, without changing the piece.

It is made of the place. The theme is the skyline, and so is the waveform the
harmony is played on. The canyon's echo was recorded in the canyon. Under
everything, the city's own seismometers move the chord.

What it is not: a dashboard with a soundtrack, a sonification demo that plays
one number as one tone, an app per company, or a just-intonation experiment.
It is music first. The data decides what the music does; it never gets to make
it sound bad.

## Principles

These come from the listener's side, and every later decision is checked
against them.

1. **It always sounds good.** Twelve-tone equal temperament, a curated
   harmonic vocabulary, quantized rhythm, density caps, a mastered mix that
   holds up on a phone speaker. Data chooses among musically valid options;
   it never writes raw pitches.
2. **It is alive within seconds.** Sound in under 1.5 seconds from the tap,
   because everything the first bar needs is loaded before the tap. A
   recognizable theme first, then the live stream at the next bar.
3. **You can hear cause and effect.** Within 30 seconds of arriving, a
   listener hears at least one event and sees what it was: "that bell was the
   Blue Line leaving Ballpark, one minute late."
4. **It changes on a human time scale.** Something changes every 8 bars, the
   section changes every one to three minutes, and the harmony moves at every
   section boundary. Slow data is made audible through form, not by waiting
   for it to change.
5. **Everyone hears the same moment.** The piece is a function of the clock
   and the data, so two phones opened in the same room play the same bar. It's
   a radio station of the valley, not a personal generator.
6. **Never silent, never noise.** 3am still has a lake, wind, the ground and
   the odd cargo plane. 7am rush hour is dense but never a wall.
7. **Measured, not asserted.** Every reading on screen says where it came from
   and whether it's live, cached or scheduled. If a feed is down the music
   keeps going on the last good value or the schedule, and says so.
8. **Made of the place.** Where the valley can supply a sound, it does: its
   skyline, its canyons' echoes, its ground. A stock sound is used only where
   nothing in the valley can do the job.

## The listener's experience

### The first ten seconds

The screen before the tap is one line of status and one button:

```
FRIDAY 5:42 PM · EVENING RUSH · 377 VEHICLES MOVING
CLEAN AIR · NO NEW SNOW · LAKE 4,189.8 FT

          ▶  LISTEN TO THE WASATCH
```

While that screen is up, the page has already fetched the engine, the piano's
first notes and the current score page, and decoded them. Tap. Within a second
the **Wasatch theme** plays on piano, in the key and mode the valley is in right
now, over a pad whose waveform is the skyline itself. The theme is the
range's summits as a melody (see "The theme"), so it's the same every time and
it is the piece's identity. It's local to the listener: a welcome, not part of
the shared stream. At the next bar line the live stream fades in under it and
the captions start.

### The first two minutes

The groove is the transit system. The listener hears a bell, notices a dot
flash on the map, reads "Red Line · Central Pointe · on time." A marimba pluck,
then "GREENbike · a bike out at 200 S & 300 E." A low brass swell rises:
"DL1784 departing SLC, climbing." At the end of the phrase, a drum fill that
came from a service alert. Every phrase carries at least one legible, captioned
event: if a phrase would otherwise be empty, the score holds the next event
from the queue for it. That is a rule of the score, so every listener hears the
same one; the 30-second guarantee is a design rule, not luck.

The first time each family sounds in a session, its caption says what the
family is: "That bell was TRAX: every train leaving a station rings one."
After that, captions are short.

### Thirty minutes

Sections rotate so that every family of data gets the foreground in turn (the
theme, the groove, the atmosphere, the journey, the lake). The harmony moves
at every boundary, and a caption says why: "The valley is moving faster than a
usual Friday → G major." Over half an hour a listener hears fourteen or more
moves, every family featured more than once, and the daypart drifting (the
evening rush thinning into last trains).

### Hours

Background listening in a kitchen or a car. The day has its own arc because
the transit schedule has one: no trains from about 1 to 4am, a dawn ramp as
buses go from about 2,400 stop events an hour to 14,000 by 7am, a long plateau,
a fade after 7pm, the last trains near midnight. Weather and season color it.
The ambient layers run on cycles of prime numbers of beats that take months to
line up again (see "Never a loop"), so two hours in it feels like a station
you leave on, not a loop you notice repeating.

### Six journeys this has to serve

| Who | When | What they should get |
|---|---|---|
| At a party, phone out | 20 seconds | The theme, a groove, one caption they can read aloud to a friend. The friend opens it and both phones play the same bar. On a Bluetooth speaker, "Tune to the room" (or the nudge, on an iPhone) lines it up with the phone next to it. |
| At home, working | 30–60 minutes | A piece that develops: the harmony walks, sections rotate, the evening thins out. Never annoying. |
| Awake at 3am | Any length | A nocturne: the lake's drone, the wind on the ridges played as a harp, a cargo plane swell, and the city asleep in its seismometers, the chord barely moving under it. Maybe an earthquake bell from a Milford swarm. Still beautiful, still alive. |
| Powder morning, in the canyon line | 10 minutes | A dawn swell sized to the overnight snow, the snow's sparkle as light as the powder is, the ski buses as canyon drums in the canyon's own echo, a low boom when UDOT closes the road for avalanche control. It knows it's a powder day. |
| Inversion week, January | Days | The mix close and roofed over under "the lid", far sounds carrying the way the freeway carries on a cold still morning, the skyline in the pad hazed down to its outline, the mode dark. When a storm clears the air, the whole piece opens up and the skyline comes back into focus. That is the moment people will screen-record. |
| A data nerd | As long as they like | A "show mappings" view: every stream, its musical role, its last value, live, cached or scheduled, with the source link, and live spectrograms of the mix and of the ground. |

### The screen

One screen, austere, phone-first, in the brand: black, paper white, one
monospaced face, safety orange only on measured values.

- **The skyline** across the top: the profile the theme and the pad are made
  from. A playhead moves along it whenever the theme plays, and haze softens
  its detail as it softens the pad.
- **The valley map** in the middle: TRAX and FrontRunner lines from the
  schedule's shapes, vehicles as dots that pulse when their event sounds, the
  canyons, the lake's edge, and the seismometers as rings that breathe with the
  ground. Events fade out in place.
- **The harmony dial**: the circle of fifths with seven adjacent positions lit
  (the notes in play) and one dot inside the lit arc (home). A move of the
  arc is a key change; a move of the dot is a change of mode. An arrow shows
  where the valley is pushing. Two minutes of watching teaches the rule.
- **The caption line** at the bottom: the last three things you heard, each
  with its receipt ("live 5:42 PM", "cached 4:45 PM", "scheduled"). It's a
  feed with a cadence, set in the score so every phone shows the same cards:
  at most two train departures a phrase, however busy the lines, and one
  card a phrase about the valley at large. That card is what's notable now
  every third phrase (snow falling, an alert, a gale on the ridges, a lid of
  bad air, the trains running late, taking turns) and otherwise a turn
  through the lake, the buses, the sky, the ground, the river and the air,
  so a few minutes' listening reaches all of it. Each card is a sentence
  that says what happened and what it played: "Red Line left Millcreek,
  4 min late", "Clean air, PM2.5 5: every ridge in the skyline", "202 buses
  out, making 149 stops a minute: the hats and shakers".
- **Everything explains itself.** Tap any reading (a word in the status
  lines, the key, the section, the tempo, a card, a sticker, the dial, the
  map, a seismometer, the skyline) and a toast says what it is and what the
  piece does with it, with its live reading; it fades after a few seconds,
  and tapped, it opens Show mappings at that topic. One list of topics
  (web/src/app/lowdown.ts) is the toast, the lowdown and the receipts, so
  they can't disagree.
- **Vantage**: a four-way control (Everywhere, Downtown, The Canyons, The
  Lake).
- **Play along**, **Add your run**, **Rewind**, **Tune to the room** behind a
  single menu.

Lock-screen controls and artwork go through the Media Session API, so it
plays in a pocket with a title like "Wasatch Symphony · Evening rush ·
G Mixolydian." Neither platform gives them to Web Audio alone without help.
iOS shows Now Playing for an AudioContext only under the "playback" audio
session, and an iOS 26.5 simulator didn't show it even then. Chrome on Android
gives notification controls only to an ordinary media element at least five
seconds long that is playing, and counts an AudioContext as an "ambient"
player. So the page also loops a near-silent five-second clip in an `<audio>`
element; whether each platform accepts that is one of M0's tests on real
phones.

## Lineage

What this takes from the pieces it descends from:

- **Hatnote's *Listen to Wikipedia*** (2013): a small, fixed legend (a bell
  for an addition, a pluck for a deletion, a swell for a new user), each sound
  drawn as a circle labeled with its article, learnable in seconds. The
  captions and the map's pulsing dots are that idea.
- **Alexander Chen's *Conductor*** (2011): the subway map as an instrument,
  trains plucking strings. It ran on the timetable, sped through a 24-hour
  loop; this one plays the live system in real time, with the timetable only
  as the fallback.
- **Brian Foo's *Two Trains*** (2015): data mapped to neutral musical traits
  (how many instruments, how hard they play) rather than to mood. The valley
  state does the same.
- **Endel:** adaptive soundscapes from time, weather and location, but a
  listener can't hear what it's doing; one reviewer noticed no clearly
  apparent changes in two weeks. Principle 3 and the captions exist so nobody
  says that here.
- **Brian Eno and Peter Chilvers' *Bloom* and *Reflection*** (2008, 2017):
  generative music you leave on. *Reflection* is brighter in the morning, back
  in its home key by evening and thinner toward the small hours. This piece's
  day has the same shape, set by the transit schedule and the sky, and it
  starts at home.
- **No 24/7 station on a city's live data turned up** in the research. The
  nearest were *The Listening Machine* (2012, months of tweets turned into
  orchestral fragments) and Björk's *Kórsafn* (2020, driven by a camera
  watching the sky from a hotel roof).

## Musical foundations

### Tuning, meter, tempo

- **Tuning: 12-tone equal temperament, A = 440 Hz.** Decision recorded at the
  end: it sounds right on every speaker and every listener's ear, and it makes
  every key on the circle equally usable.
- **Meter: 4/4** throughout. Night sections may use a half-time feel instead
  of a different meter.
- **Tempo by daypart**, changed only at section boundaries and by at most
  4 BPM per boundary, so the drop from last trains to the nocturne takes four
  sections:

| Daypart | Hours | Base BPM | Feel |
|---|---|---|---|
| Nocturne | 0:00–5:00 | 72 | Half-time, sparse, ambient |
| First light | 5:00–8:00 | 84 | Building, the overture |
| The valley at work | 8:00–16:00 | 96 | Full groove |
| Rush | 16:00–19:00 | 100 | Densest, most syncopated |
| Last trains | 19:00–24:00 | 88 | Winding down, intimate |

A data nudge of up to ±4 BPM comes from how fast the transit fleet is actually
moving compared with usual for that hour.

At 96 BPM a bar is 2.5 seconds and an 8-bar phrase is 20 seconds; at 72 BPM a
phrase is 26.7 seconds, at 100 BPM 19.2.

### Harmony space: the notes in play, and home

The piece's large-scale motion is a walk around the circle of fifths, and its
color is a mode. These are one space, not two. On a fixed tonic, each rung of
the brightness ladder is exactly one step flatward on the circle: C Lydian
uses G major's notes, C Ionian C's, C Mixolydian F's, C Dorian B♭'s, C Aeolian
E♭'s. Driving key and mode separately, as revision 1 did, lets a sky change and
a flow change add up to a five-step jump. So the harmony is two things:

- **The notes in play**: a diatonic collection, which is seven adjacent
  positions on the circle of fifths (C major's notes are F C G D A E B). The
  valley's **flow** moves it.
- **Home**: which of those seven notes is the tonic. Its place in the arc is
  the mode, from the flat end: Lydian, Ionian, Mixolydian, Dorian, Aeolian.
  The **sky** picks it. Phrygian and Locrian, the last two places, are
  excluded; they sound wrong more often than right in an ambient,
  everyone-listens setting.

| Home inside C major's notes | F | C | G | D | A |
|---|---|---|---|---|---|
| Mode | Lydian | Ionian | Mixolydian | Dorian | Aeolian |
| Brightness | brightest | | | | darkest |

The rules at each section boundary:

- **At most one note changes.** The notes in play move at most one step:
  **sharpward** when the valley is flowing better than usual over the section
  just finished, **flatward** when it's slower or congested, not at all inside
  a dead band. Adjacent collections share six of seven notes, so every move is
  smooth by construction.
- **Home moves inside the notes.** When the sky's rung changes, home moves to
  the matching note, at most two rungs per boundary, with hysteresis so a
  borderline cloud cover doesn't flap. Moving home changes no notes.
- **Something always moves.** If neither flow nor sky pushes, the notes take
  one step toward the home key; at home, they step to a neighbor and come back
  at the next boundary.
- **Through a pivot.** The last bar of the outgoing section plays a chord the
  two collections share (adjacent collections share four triads), or
  tonicizes the new home's dominant. Never a cold jump.
- **Every day starts at home.** First light (05:00) begins in the home key,
  the key the theme was written in. Through the nocturne, when flow rarely
  pushes, the walk is steered so that it arrives there.
- **Spelled for reading.** Keys are written with at most six accidentals;
  F♯/G♭ is spelled by the direction of arrival.
- **Caption every move**, plain words first: "The valley sped up → B Dorian
  (G became G♯)." The listener learns the rule in two moves; the dial shows it
  in one.

In 12-TET no key is brighter than another in itself; brightness is the mode's
job and motion is the circle's. So there is no pull toward "bright sharp keys
by day", only the pull home.

Sections average 1.5 to 2.4 minutes, so over 15 minutes a listener hears seven
or eight moves, each caused by something real or by the walk home. CI checks
the rule on every render: no boundary changes more than one note.

### Harmony

- **Vocabulary per mode** is a curated bank of progressions that sound good
  looped and varied: Ionian `I–V–vi–IV`, `vi–IV–I–V`, `I–IV–vi–V`, `ii–V–I`;
  Lydian `I–II–I–vii`, `I–II–V–I`; Mixolydian `I–♭VII–IV–I`; Dorian `i–IV`,
  `i–♭III–♭VII–IV`; Aeolian `i–♭VI–♭III–♭VII`, `i–iv–♭VII–♭III`. Every chord in
  the bank is diatonic to its mode (checked for this revision by
  `research/theory/check_theory.py`; CI checks it from then on).
- **Chord types:** triads, sevenths, add9 and sus2/sus4. No diminished chords
  except as a passing chord in a cadence. Extensions (9ths, 11ths) come from
  the snowpack (below).
- **Harmonic rhythm** (how often chords change) comes from how much is
  moving: one chord per two bars when it's quiet, one per bar at rush, never
  faster than two per bar.
- **Voice leading:** each new chord moves each voice to the nearest chord
  tone; parallel fifths are not a concern in this idiom but large leaps are
  capped.
- **Voicing by roughness:** among the voicings that pass voice leading, the
  core picks the one with the lowest roughness, summed with Vassilakis's model
  over every pair of partials the voices will actually produce. The core knows
  them exactly, from the wavetable's harmonics and the modal tables, and, as
  Sethares showed, where consonance falls depends on the timbre.
- **Tension:** a single 0–1 value (storms approaching, incidents, a rising
  lake-effect setup) biases the bank toward progressions that delay the tonic
  and adds pedal points and suspensions; release resolves them.

### The lake's rule

The Great Salt Lake controls how phrases end. Below 4,198 ft, a share of
cadences don't come home. They land instead on the mode's deceptive chord (vi
in Ionian, Lydian and Mixolydian; ♭III in Dorian; ♭VI in Aeolian) or on a sus2
tonic, and never on the chord the phrase has been vamping on, so the
non-arrival is audible. At or above 4,198 ft, cadences land home. It sounds
good either way, and it means the piece literally can't come home until the
lake does.

The curve follows the Great Salt Lake Strike Team's own ranges. In the
optimal range (4,198 to 4,205 ft) every cadence lands home. Below the bottom of
the transitional range (4,195 ft) the share of unresolved cadences stays at a
ceiling, and between 4,195 and 4,198 ft it falls from the ceiling to none. The
ceiling is tuned by ear so it reads as longing rather than aimlessness; start
at two in three. At 4,189.8 ft (Oct 23), 1.3 ft above the record low of
4,188.5 ft (Nov 2022), the lake is far below the transitional range, so for
now every listener hears the ceiling, and the day the lake rises past 4,195 ft
the piece starts to come home. Nobody has to know this to enjoy it; the
mappings view says it plainly for whoever looks.

### The theme

The piece's identity is the **Wasatch skyline as a melody**: the range's
profile from Ben Lomond in the north to Mount Nebo in the south, drawn the way
a surveyor draws it (the highest ground at each latitude), with its summits as
the notes. It was computed on Oct 23 from USGS 3DEP elevation (Appendix D),
so it is real, not drawn by hand. Thirteen summits stand at least 250 m above
their neighbors on that profile. Mapped onto ten steps of the scale, north to
south:

| Summit | Elevation (ft, sampled) | Step |
|---|---|---|
| Ben Lomond | 9,649 | 1 |
| Allen Peak (by Mount Ogden) | 9,442 | 1 |
| Thurston Peak | 9,703 | 2 |
| Bountiful Peak | 9,222 | 0 |
| Grandview Peak | 9,262 | 0 |
| Twin Peaks (American Fork) | 11,471 | 8 |
| Box Elder Peak | 10,965 | 6 |
| Mount Timpanogos | 11,674 | 8 |
| Provo Peak | 11,030 | 6 |
| Spanish Fork Peak | 9,897 | 2 |
| Santaquin Peak | 10,590 | 5 |
| Bald Mountain | 10,499 | 4 |
| Mount Nebo | 11,915 | 9 |

`1 1 2 0 0 | 8 6 8 6 | 2 5 4 9`: a low murmur along the northern Front, a leap
of more than an octave at the Cottonwoods, a plateau across Box Elder,
Timpanogos and Provo Peak, a dip at Spanish Fork Canyon, and the last climb to
Nebo, the highest note.

The data gives the contour. The rhythm, the phrasing and the scale degree that
step 0 lands on are set by hand in M0 and then frozen, because identity lives
in rhythm and the intervals change with the mode (if step 0 is the tonic, step
2 is a major third in Ionian and a minor third in Dorian). Each summit was
matched to the nearest summit in the USGS names database (GNIS), all within
1.1 km. The sampled heights run a little low, because a grid misses the exact
tops (Nebo by 13 ft, Timpanogos by 78 ft); M0 recomputes the profile at full
resolution and snaps each note to its GNIS summit.

The theme plays as the welcome on arrival, opens every Theme section, and
returns in fragments: a resort's voice plays its own summits when that resort
opens for the day (Snowbasin the Allen Peak note, its tram's summit; Snowbird
and Alta the leap to Twin Peaks; Sundance the Timpanogos plateau).

### The skyline as a sound

The same profile is a waveform. Mirrored (Ben Lomond to Nebo and back, so the
cycle is continuous) and resampled to 256 samples, it is one frame of a sonido
wavetable, and that wavetable is the pad's oscillator: the harmony under
everything is the shape of the range.

Measured (Appendix D): the skyline's harmonic amplitudes fall as about
k^−0.6 to k^−0.8, shallower than a sawtooth's k^−1, with harmonics 2 to 5
louder than the fundamental. Raw, it is a bright, reedy wave. The voice tilts
it by k^−0.5, which brings it to about k^−1.15, a slightly darkened saw, and
keeps the skyline's own phases and its irregular partials (the sixth harmonic
sits 15 dB down); those are its character.

**Haze takes detail away.** sonido's wavetable holds up to eight morph frames.
Frame 0 is the full skyline; each later frame keeps fewer harmonics, down to
the range's outline. `openness` picks the frame. On a clear day the pad has
every ridge in it; under the lid the far ridges blur, in the sound as they do
from the valley floor.

Each resort's voice uses its own stretch of the profile, so its timbre is its
own terrain.

### Ranges

| Part | Range |
|---|---|
| Sub and bass | E1–E3 |
| Pads and harmony | C3–C5 |
| Theme and melody | C4–C6 |
| Ornaments (bikes, snow) | C5–C7 |

Every pitched event is quantized to the notes in play and clamped to its part's
range.

Phone speakers give little below 200–300 Hz, which is the whole of the sub and
bass range. So every part that lives down there also carries energy above it:
the bass gets asymmetric saturation for a second harmonic an octave up (the
trick noodles' phone bass already uses, DECISIONS.md D11), and the lake's
pedal gets a quiet harmonic shadow two octaves up. CI checks it through a
phone-speaker model (see Quality).

## Form and time scales

Slow data can't be the only source of change, or a two-minute listener hears
nothing happen. So the piece runs on six time scales at once, and data enters
at the scale where a listener can hear it.

| Scale | Length at 96 BPM | What changes | Driven by |
|---|---|---|---|
| Event | instant | A bell, a pluck, a swell, a bloom in the ground | Fast data: vehicles, bikes, planes, quakes, the ground |
| Bar | 2.5 s | Groove pattern, fills | Event rates, lateness |
| Phrase | 20 s | Variation, the guaranteed legible moment | Engine plus events |
| Section | 1–3 min | Focus, the harmony's move, tempo nudge | Data trends over the last section |
| Daypart | hours | Palette, base tempo, density ceiling | Clock, schedule |
| Season | months | Instruments present, harmonic richness | Resorts open, snowpack |

### Sections

Five section types rotate, in an order the engine varies but always cycling
within 12 minutes (8 to 10 at the working day's tempo, up to 12 at the
nocturne's), so a listener on for a few minutes hears several and one on for
15 hears them all:

| Section | Foreground | Phrases |
|---|---|---|
| **Theme** | The skyline melody over the current harmony | 1 intro + 4–6 |
| **Groove** | Transit percussion, bass, bikes | 6–8 (3–4 at night: a heartbeat) |
| **Atmosphere** | Weather, wind, snow, air; drums recede | 4–6 |
| **Journey** | Everything at once; the move into it is staged with a two-bar pivot and a fill, and the dial animates | 6 |
| **Lake** | The lake's pedal and its cadence rule; a quiet section | 3–4 |

Data chooses lengths inside those ranges: rush extends Groove, a storm extends
Atmosphere, night shortens Groove to a heartbeat. The ranges are the limits,
which is what keeps the cycle inside 12 minutes. Transitions always land on a
phrase boundary with a fill.

### Never a loop

Brian Eno built *Music for Airports* from tape loops he gave as about 23½,
25⅞ and 29 15/16 seconds long, "incommensurable": any two of them realign
after 1.4 to 3.4 hours, and all three only after about 27 days. The same idea holds the hours journey together. The ambient
layers (the pad's swell, the gust pattern, the ground voice's slow phrase, the
lake pedal's breath) run on prime numbers of beats, 61, 67, 71 and 73, which is 38
to 46 seconds at 96 BPM: any two realign only after 43 minutes or more, and
all four after about five months. The metric layers, the hat pattern's
rotation and the bass figure, cycle every 7 and 9 bars, as a groove should.
The data then varies every cycle on top.

### Making slow data audible fast

Three techniques, used together.

1. **Instrumentation at arrival.** Snowpack, season and air set *what's
   playing*, which a listener hears in the first bar, not as a change.
2. **Foregrounding by rotation.** Each section puts a different family up
   front, so a slow value gets its moment every few minutes.
3. **Normalize against expectation.** Each raw value is compared with what's
   usual for that hour and day of week, and the music follows the *surprise*
   as much as the level. Rush hour is always busy; what's interesting is
   busier, later or quieter than a usual Friday at 5:40. The daypart provides
   the expected level, and the surprise provides the color.

"Usual" needs a history the archive won't have at launch, and 30 days holds
only four Fridays. So each value takes its expectation from the best source
that already has one, and the archive replaces it as it fills:

| Value | Expected from, at launch | Then |
|---|---|---|
| Stop-event rate, vehicles in service | The schedule itself (it is the expectation) | The schedule |
| Lateness, fleet speed | Zero lateness, scheduled running times | The archive: 8 weeks by hour of week, weekdays pooled |
| River flow | USGS's own percentiles for the day of the year (the Statistics API's normals) | The same |
| Snowpack | NRCS's median for the date | The same |
| PM2.5, AQI | Fixed bands (the EPA AQI categories) | The same |
| City seismic noise | The first two weeks' recordings by hour of week | The archive |
| Bike dock changes, flights | The first two weeks by hour of week | The archive |

## The valley state

The engine reads a small vector of normalized parameters, recomputed for every
event window and smoothed. Discrete choices (the notes in play, home) use
hysteresis and minimum dwell times.

| Parameter | 0 to 1 meaning | Built from | Smoothing |
|---|---|---|---|
| `flow` | Worse than usual to better than usual | Transit lateness and fleet speed vs usual; road incidents; sign travel times | 5 min |
| `activity` | Asleep to rush | Vehicles in service, stop-event rate vs usual | 2 min |
| `tension` | Settled to building | Storm approaching (forecast precip, pressure falling), active incidents, alerts | 10 min |
| `brightness` | Night or storm to bluebird | Sun elevation, cloud cover, precipitation | 10 min |
| `openness` | Hazy to clear | PM2.5 and AQI | 30 min |
| `inversion` | Mixed to capped | The most warming from the valley floor to 700 hPa (Open-Meteo's pressure levels; the SLC soundings) | 1 hour |
| `wetness` | Dry to dumping | Current snowfall or rain rate | 5 min |
| `wind` | Calm to howling | Canyon and ridge wind and gusts | 1 min |
| `snow` | Bare to deep | Snowpack vs median, overnight new snow | daily |
| `powder` | Heavy to light | Crest-level (700 hPa) temperature while it snows; SNOTEL water equivalent over depth after the storm | per storm |
| `water` | Low to running | River flow vs usual for the date | 1 hour |
| `lake` | Record low to healthy | Elevation from 4,188.5 to 4,198 ft | daily |
| `ground` | Still to busy | City seismic noise, 1–32 Hz, vs usual for the hour | 1 min |
| `energy` | Quiet to peak | Grid demand vs usual | 1 hour |
| `season` | Off-season to deep winter | Resorts open, date | daily |

`flow` is a surprise, not a level: a rush thinning on schedule doesn't move it,
a rush clearing faster than a usual Friday does.

Composite rules (initial weights, to be tuned by listening):

- `flow` moves the notes in play and sets the swing amount.
- `activity` drives density ceilings, the groove's pattern and harmonic
  rhythm.
- `tension` drives progression choice and the pads' swell.
- `brightness` picks home's rung.
- `inversion` sets the room's ceiling and the distance law; `openness` sets
  the skyline frame and the stereo width (see "Air").
- `snow`, `wetness`, `powder` and `season` drive instrumentation, extensions
  and the snow grains.
- `lake` drives the cadence rule and the sub-bass pedal level.
- `ground` drives the ground voice's level against the hour.
- `energy` drives the master's slowest swell, ±3 dB at most.

## Data → music

Each family has a home layer, a time scale and a caption template. Captions are
what make it legible; every featured event gets one.

### Transit (the groove)

The UTA schedule is the score: 243,304 stop events on a weekday, rail at about
650–710 an hour from 6am to 10pm, buses at 12,000–14,500 an hour from 6am to
6pm. Realtime is the performance.

The groove's backbone is composed: a kick and snare pattern from a bank keyed
by daypart and `activity`, silent at night. Transit plays it:

| Data | Music | Caption |
|---|---|---|
| TRAX departures: Red, Blue, Green lines; S-Line | A tuned bell per line, each on a different chord tone, quantized to the 16th grid. Real TRAX trains ring a bell as they leave a station | "Red Line · Central Pointe · on time" |
| FrontRunner arrivals | A five-note horn chord voiced like a Nathan K5LA (D♯ F♯ G♯ B D♯, a major-sixth chord), rebuilt on the nearest major-sixth chord in the notes in play, in the grade-crossing rhythm: long, long, short, long. Rare, heavy | "FrontRunner arrived at Salt Lake Central" |
| Ski buses 994 (Snowbird, Alta) and 972 (Solitude, Brighton) | Canyon toms in the canyon's recorded echo, winter only | "994 · up Little Cottonwood to Snowbird" |
| Bus stop-event *rate* | Hi-hat and shaker density as Euclidean patterns, E(k,16), with k from the rate's percentile for the hour; individual bus events are not hits | |
| Lateness (observed minus scheduled) | Lay-back: the whole kit up to 30 ms behind the beat on system lateness, and each bell behind by its own train's lateness, 1 ms for every 3 s late | "Blue Line 2 min late" |
| Service alerts | Fills and crashes at the next phrase boundary | "Alert: bus bridge on the Red Line" |
| Vehicle position | Pan and distance from the vantage | |
| FrontRunner arriving at Central | The cadence home (as far as the lake allows) | |

Rail station events run about 11 a minute systemwide, roughly one bell every
five seconds at midday: accents a listener can follow, which is why they are
bells and not the kick. A kick needs to be steady; trains aren't. Buses are
statistical so rush hour is a groove, not a wall. E(k,16) spreads k hits as
evenly as possible over 16 steps, and that family holds many of the world's
traditional timelines (Toussaint 2005: E(3,8) is the tresillo, E(5,8) the
cinquillo, E(5,16) a bossa nova, E(7,16) a samba, E(7,12) the Ashanti bell), so
every density the data asks for is a groove somebody already plays.

**Station events are inferred, because UTA's feeds don't state them.** On
Oct 23 every vehicle entity carried only its trip, position and timestamp (no
`current_status`, no stop), with positions a median 12 s old, and trip updates
drop each stop once it's passed and carry no delay field. So a train arrives
when its position enters a 50 m circle around the next platform on its trip
and departs when it leaves it, cross-checked against the last prediction for
that stop before it dropped out of the trip update. Lateness is observed minus
scheduled. Fleet speed comes from consecutive positions along each trip's
shape. Receipts say so: "live · position 12 s old".

FrontRunner's horn model isn't on record from UTA, but railfan references
list its MP36PH-3C locomotives (road numbers 1–21) with the Nathan K5LA,
the horn the voicing already follows: D♯4 311 Hz, F♯4 370, G♯4 415, B4 494,
D♯5 622, the B major sixth Nathan made by lowering two bells of the older
K5H. Individual horns drift from those nominal pitches, so one recording of
a FrontRunner horn at a crossing, pitch-tracked with sonido-analysis, would
still replace the voicing with its own (principle 8). No recording with a
usable license is on Freesound or Wikimedia Commons (searched Oct 24, 2026).

### Roads and canyons

UDOT's traffic API has no speed or travel-time endpoint, and its freeway
detector speeds live in an account-only PeMS, so `flow` leans on transit,
which has a position for every vehicle. The roads add incidents, closures and
the minutes UDOT's signs display.

| Data | Music | Caption |
|---|---|---|
| UDOT events: crashes, closures, construction | A tension chord that resolves when cleared; incidents feed `flow` | "Crash cleared, I-15 at 600 S" |
| Travel times on UDOT's message signs, where the signs show them (to confirm with a key) | Feed `flow`: the minutes on the sign against their usual | "I-15 to Draper 14 min (usually 11)" |
| Little and Big Cottonwood restrictions and traction law (mountain passes, road conditions) | A low brass pedal under the canyon voices | "SR-210 traction law in effect" |
| Avalanche-control closures (UDOT alerts) | A distant low boom, once, in the canyon's own echo | "Little Cottonwood closed for avalanche control" |
| Canyon traffic on powder mornings | Canyon tom density, from the ski buses and UDOT's canyon events | |
| Snowplows in service (UDOT service vehicles) | Brushed noise texture in winter storms | "41 plows out" |

### Water

| Data | Music | Caption |
|---|---|---|
| Great Salt Lake elevation | The sub-bass pedal under everything, with its harmonic shadow for phones, and the cadence rule | "Lake 4,189.8 ft · 8.2 ft below healthy" |
| The lake's level against its daily mean (the 15-minute gauge) | The pedal's slowest swell. When wind sets the lake sloshing (a seiche, with a fundamental near six hours), the pedal breathes with it | "The lake is sloshing: 0.4 ft at Saltair" |
| Jordan River, Little Cottonwood, City Creek flow vs usual for the date | Bassline activity: long roots at low flow, a walking line in spring runoff | "Jordan River 160 cfs" |

A seiche needs wind of at least 10 knots for about 12 hours (Utah Geological
Survey), so the swell is rare and always earned. The six-hour figure is from
Francis et al. 2011 (read from the abstract); the gauge measures the real one,
and a seiche's period grows as the lake gets shallower (T ≈ 2L/√(gh)), so the
falling lake slows its own swell.

### Snow and the mountains

| Data | Music | Caption |
|---|---|---|
| Overnight new snow (SNOTEL hourly depth) | The dawn swell's size at first light; a huge one on a powder morning | "9 in at Snowbird overnight" |
| Current snowfall rate | Snow grains: short modal pings on chord tones, density = rate | |
| New-snow density (`powder`) | The grains' color: light powder is small, high and glassy; heavy wet snow is softer, lower, felted | "Light powder, 6% water" |
| Snowpack vs median | Number of pad voices and upper extensions (9ths, 11ths) | "Snowpack 112% of median" |
| Storm approaching (NWS forecast snowfall at Alta, pressure tendency) | `tension` builds for hours; release when snow starts | "8–14 in forecast tonight" |
| Resort opening days | Each resort adds a voice to the ensemble for the season | "Alta opens today" |
| Resort first chair (opening time each day) | That resort's voice plays its summits from the theme | |
| Snowmaking window (wet-bulb from NWS temperature and humidity) | Soft white-noise layer while it's cold and dry enough for the guns | |
| Lake-effect events | The lake's pedal note doubles in the snow grains: the lake makes snow | "Lake-effect band over the Cottonwoods" |
| Avalanche activity (Utah Avalanche Center, with permission) | A rare, soft, low settling sound; never a stand-in for the forecast; the caption links to it | "Avalanche reported, upper Little Cottonwood. Read the forecast →" |

Snow density is the valley's own claim to fame, so it gets a voice. Typical
Utah snow is about 7% water (14:1), Alta averages about 8.4%, "wild snow" is
4% or less (25:1), and Alta's 24-hour record is 2% (50:1). In Alcott and
Steenburgh's study of 457 Alta storms (2010), the temperature at crest level
was the strongest single predictor. So while it snows, `powder` is predicted
from the crest-level (700 hPa) temperature and captioned as a forecast; after
the storm it is measured from SNOTEL's water equivalent over its depth,
corrected for settling, since SNOTEL gives sound storm averages but not
reliable hourly densities.

Lake effect averages about 5–6% of Cottonwood resort snow, mostly in October
and November; lake dust took about 17 days off the 2022 snowpack. Both are
real, both belong in the mappings view.

### Weather and sky

| Data | Music |
|---|---|
| Sun elevation | `brightness`; home's rung over the day |
| Cloud cover, precipitation | Home's rung |
| Temperature | Timbre warmth (gentle saturation in heat, glassier in cold) |
| Moon phase | Night pad color (fuller moon, brighter nocturne) |

### Wind: the Aeolian harp

Wind across a wire sheds vortices at a frequency set by the wind speed and the
wire's thickness, f = St·U/d, with a Strouhal number St of about 0.2 over a
wide range of flows: 5 m/s across a 2 mm wire is 500 Hz. A real Aeolian harp
tunes all its strings to one note and lets the wind bring out their overtones,
higher as the wind rises. The wind layer is that harp, with its strings tuned
to the current chord instead:

| Data | Music | Caption |
|---|---|---|
| Wind speed at canyon and ridge stations (UDOT's weather stations, measured; the NWS forecast for the ridges, captioned as a forecast; Synoptic's ridge-top stations once it consents) | Which partial sounds: a virtual 1 mm string's shedding frequency picks the register, then snaps to the nearest chord tone in equal temperament | "Wind at Alta 22 mph" |
| Gusts | The strings' excitation: a gust swells the harp and a little air noise | "Alta gusting 38 mph (forecast)" |
| Wind direction | Pan, from the station's bearing at the vantage | |

The harp keeps the physics (more wind, higher partials) and the rule (only
chord tones in 12-TET). The true 7th, 11th and 13th harmonics sit 30 to 50 cents
off equal temperament and the 5th 14 cents flat, so the harp sounds the chord
tone, never the raw harmonic.

### Air: the lid

An inversion is two things at once, and the lid plays both. Warm air sits on
cold air and roofs the valley over. That bends sound back toward the ground,
so it carries: it's why the freeway and the freight horns are so clear on a
still January morning. In a Denali valley, inversions stronger than
0.06 °C/m raised distant sound levels by 10–15 dB (JASA, 2024); in Austria's
Inn Valley the vertical temperature gradient was the key factor in motorway
noise. Under the same lid, the air fills with haze. So the lid has two inputs,
and it is a ceiling, not a blanket:

| Input | From | Plays |
|---|---|---|
| `inversion`: the temperature gradient | The most warming between the valley floor and any level up to 700 hPa (Open-Meteo's pressure levels, hourly; the SLC balloon soundings twice a day as a check) | Acoustics: a low, dark ceiling added to the room (dense early reflections, a longer tail) and a flatter distance law, so far events come up to 10 dB closer and clearer |
| `openness`: the haze | PM2.5 and AQI | Sight: the skyline frame (every ridge on a clean day, the outline in thick haze) and the stereo width (narrower under haze, never mono) |

Never to muddiness: the lid changes space and distance, and the only thing it
filters is the skyline's own detail. Caption: "Inversion · PM2.5 38 · under
the lid."

### The ground: the city's seismometers sing the chord

Seismometers in a city record the city. When the 2020 lockdowns came,
Lecocq et al. found 185 of 268 stations worldwide quieter by up to 50% in the
4–14 Hz band, tracking mobility data. In Barcelona, traffic sits at 8–35 Hz
and the subway at 20–40 Hz, nights are about four times quieter than days,
and weekends about twice as quiet as weekdays. The research found no such
study of Salt Lake; the archive will be one.

Revision 1 planned to audify it, playing the samples back sped up into hearing
range. That can't be live: audification compresses time, so a stream of 100
samples a second played at audio rate runs out in seconds. Revision 2 keeps
time and moves frequency instead, with the down-converter sonido already has:

1. Each station's vertical channel (100 samples a second) is split into
   octave bands: 1–2, 2–4, 4–8, 8–16 and 16–32 Hz. The top two carry most of
   the traffic. Below 1 Hz the ocean's microseism dominates, so it is
   filtered out.
2. Each band is down-converted to complex baseband (sonido's `Ddc`: a
   numerically controlled oscillator, a FIR low-pass and decimation). That is
   the band's own amplitude and phase, moving in real time. The baseband is
   then smoothed to a few hertz, so what follows wavers rather than buzzes.
3. Each band is up-converted onto a chord tone: low bands onto low chord
   tones, high bands onto high ones. The result is a tone exactly in tune whose
   swell and shimmer are the ground's own motion in that band, panned by
   station.
4. Each band's level is normalized to what's usual at that station for the
   hour (`ground`), so the morning's rise is audible as a rise, and a quiet
   Sunday sounds like one.

| Data | Music | Caption |
|---|---|---|
| Seismometers in the city (network UU: Brigham Young Park, the Capitol, the Avenues, an I-15 bridge array) | The ground voice: a bed of chord tones moved by the ground, panned by station | "The ground at Brigham Young Park" |
| A local earthquake in the waveforms | Every band blooms at once, limited so it never jumps out of the mix; often heard before the catalog lists it | |
| Earthquakes in the catalog (USGS) | A bell; magnitude sets loudness and depth; at most one per 30 s | "M1.6 · 16 km NNE of Milford" |

The ground is live. On Oct 23, EarthScope's real-time server
(`rtserve.earthscope.org`) listed 685 streams from 170 University of Utah
stations, the newest sample a median 18.6 s old (90th percentile 27.8 s), well
inside the 90-second delay. It allows five connections, so the conductor holds
one for everyone and runs the down-conversion on the same .wasm the phones
run. Each event window carries every band's smoothed baseband, a few kilobytes,
the same bytes for every phone, and the worklet only up-converts.

### Bikes, planes, the grid

| Data | Music | Caption |
|---|---|---|
| GREENbike dock changes (station status diffs) | Marimba plucks on chord tones; the dock's latitude picks the degree | "GREENbike · a bike out at 200 S & 300 E" |
| Flights at SLC (our own receiver; see below) | Long brass swells: departures rise, arrivals fall; altitude sets register | "DL1784 departing, climbing" |
| Grid demand (EIA, PacifiCorp East) | The slowest swell: master dynamics ±3 dB | |

GREENbike publishes station status only (72 stations, GBFS 1.1 with 2.1
alongside, cached 60 s), so the conductor polls it once a minute. Status shows
the net change at a dock since the last poll, not checkouts: a bike out and
another in between polls cancel, and a rebalancing truck moves ten at once. So
changes larger than two bikes at a dock are treated as rebalancing and not
played, and captions say what was measured ("a bike out", "a bike back"), not
what was inferred.

**Flights come from a receiver of our own.** None of the open sources fits a
live public piece. OpenSky's REST API is for non-profit research and
education, and "integration into a live product, service, or automated
system" needs a written license; anonymous use gets 400 credits a day. adsb.lol
allows 500 requests a day and plans to require a key that is earned by
feeding; adsb.fi is for personal, non-commercial use. So the conductor reads
an ADS-B receiver in the valley: an RTL-SDR dongle and an antenna on a
Raspberry Pi with a view of the approaches, decoding locally with readsb. The
planes are then measured by the valley's own antenna (principle 8), every
second instead of every few minutes, and feeding adsb.lol and OpenSky from it
earns their APIs as backups.

## Vantage: where you're listening from

One piece, four listening positions. Each vantage is a real place with a real
facing, and the mix is computed from where each sound is: distance sets level,
a high cut and the share of reverb; bearing sets pan. The vantage changes the
mix and the room, never the shared composition, so friends on different
vantages are still in the same bar.

| Vantage | Where, facing | Its room |
|---|---|---|
| Everywhere (default) | No position: the valley as a map, west left, east right, every family at its own level | sonido's FDN hall |
| Downtown | The Gallivan Center, facing the mountains | Recorded on Main Street between the towers |
| The Canyons | Tanners Flat, 8 km up Little Cottonwood, facing up-canyon | Recorded in Little Cottonwood Canyon |
| The Lake | Saltair on the south shore, facing the city | Recorded at Saltair: open, dry, and whatever comes back from the Oquirrhs |

The canyon vantage sits up the canyon rather than at its mouth: from the
mouth, Sandy's streets are as near as the granite, and the canyon didn't
sound like one.

Distance follows a compressed law, gain = (1 + d/3 km)^−1, floored at −24 dB,
so far families recede without vanishing. Under an inversion the exponent
halves to −0.5, which brings an event 30 km away about 10 dB closer. A sound
behind you is up to 3 dB quieter (the ear's own shadow), and from inside
Little Cottonwood anything outside the canyon comes over its walls, 4.4 dB
quieter and darker, with its reverb left as it was (obstruction, in
game-audio terms).

**Every family has a home.** Trains, bikes, quakes and the seismometers are
points. The rest live somewhere bigger, and each home is drawn as an area or
lines and sampled as points (engine/src/audio/homes.rs):

| Family | Its home |
|---|---|
| The skyline pad | The Wasatch, from the bench to the crest |
| The kit | The valley floor the buses run on |
| The pedal | The lake's south arm and Farmington Bay |
| The bass | The Jordan River, Little Cottonwood Creek, City Creek |
| The harp | The crest, and down Little and Big Cottonwood |
| The snow grains | Alta, Snowbird, Brighton and Solitude |
| The air | Wherever you stand: sheltered between towers, open on the shore |

Each point is heard by the event law and their power adds, so the physics
comes for free: a long range falls off about 3 dB a doubling, not 6, and an
area you stand in surrounds you. Heard from its home, a family is as played;
from anywhere else it's as much quieter, darker and wetter as its points are
together. Its width is the power-weighted spread of its points' pans (the
range you stand in is wide; the lake from downtown is narrow), and its
direction fades as it surrounds you. The result, at a glance:

| From | Up close | Far off |
|---|---|---|
| Downtown | The trains, the city's groove, City Creek's bass | The lake (−7 dB), the snow (−12 dB) |
| The canyon | The mountains, the wind, the snow, the creek | The city's groove (−11 dB, over the walls), the lake |
| The lake | The lake | The mountains (−8 dB), the wind and the snow (−12 dB), the trains |

A move glides there in about a second, so it sounds like walking, not a cut.

**Each place echoes the music.** Downtown's towers flutter (the first return
about −14 dB); the canyon's granite slaps back at about −12 dB, darker with
each echo; the Oquirrhs send one faint return across the lake. Echoes longer
than a slap (120 ms) land on the nearest sixteenth note of the tempo, so the
walls answer in time instead of smearing the groove: the geometry chooses
among musical delays, as data chooses among musical notes (principle 1).

**It has to work on a phone.** A phone's speaker plays little below about
500 Hz or above 6 kHz, and only in mono. So width alone can't carry a
vantage: what changes is level, the highs in 2–6 kHz, and the echoes, and
the master's loudness rider is weighted to what a phone plays, so the lake's
bass doesn't turn the whole view from Saltair down. The render check holds
it: each vantage differs from the map's mix, the lake is at least 4 dB
darker, the canyon at least 1.5 dB wider, and none is more than 4 dB louder
or quieter than the map through a phone's band. Measured on Oct 23 at
5:40 PM, the four are within 2 dB of each other on a phone.

Events in the canyons (ski buses, avalanche-control booms) also get the
canyon's own early echoes wherever you listen from, so the canyon always
sounds like a canyon.

On screen, the four buttons sit under a "Listen from" tab, the map marks the
place with a trail map's YOU ARE HERE (the facing, and rings at 5 and 15 km),
a sign says what's near and far from there, and each event's ring on the map
is as small and faint as it sounds from where you are.

The rooms are recorded with exponential sine sweeps from a portable speaker,
captured and deconvolved with sonido-analysis's sweep tools, several sweeps
averaged, at night when the valley is quiet. Each becomes the room's early
reflections (convolved directly) and a measured decay per band, which the FDN
is fitted to for the tail.

## Interaction

All optional; the default is just listening.

- **Play along.** Hold the phone like a ski and tip it. The edge angle picks a
  scale degree in the notes in play; a steady edge sustains chord tones, a
  wobble plays passing tones. Equal temperament plus scale quantization means
  it can't play a wrong note. Local to the player. On iOS, motion needs
  `DeviceOrientationEvent.requestPermission()` from a tap, which shows a
  prompt; Chrome allows it by default over HTTPS.
- **Add your run.** Load a GPX from any tracker; the run becomes a solo voice
  over the live valley: vertical drop as the melodic descent, speed as rhythm,
  turns as notes. The file is read in the browser and never leaves the device.
  Export a 30-second clip to share.
- **Rewind.** Any past date and time from the archive, at 1× or as **A Day in
  Twelve Minutes** (below). The best demo at any hour, and a way to hear the
  morning of the best powder day of your life.
- **Tune to the room.** For a phone on a Bluetooth speaker at a party, where
  the output delay is a quarter to a third of a second (AirPods 144–274 ms;
  Android phones averaged 308 ms over SBC and 369 ms over AAC) and the browser
  may not report it.
  The phone ducks its own output for four seconds, listens to the room, and
  cross-correlates what it hears against its own render of the same bars,
  using GCC-PHAT (Knapp and Carter, 1976). Keeping only the cross-spectrum's
  phase keeps the peak sharp in a reverberant room; the PHAT-β variant, with β
  around 0.4, keeps it from breaking down in party noise. A soft tick from its
  own speaker, correlated the same way, measures its own round trip; the
  difference is how far it is from the phone next to it, and it slews to match
  over a phrase. Apple TV's Wireless Audio Sync does the same with an iPhone's
  microphone and test tones. It works here without test tones because the
  composition is deterministic: each phone knows exactly what the others are
  playing. Nothing is recorded or sent, and the microphone is released when
  it's done. A **nudge** control (±20 ms per tap) lines phones up by ear
  wherever the microphone can't be used.

  **On iPhones it isn't offered.** Opening the microphone puts WebKit's audio
  session into a voice-chat mode: Web Audio drops to call volume, a Bluetooth
  headset falls back to its hands-free profile, and output doesn't recover
  while audio keeps playing (WebKit bugs 236219 and 248810, still open on
  iOS 26.4). iOS does report most of a Bluetooth delay in `outputLatency`
  (AirPods: 160 ms reported against 215–220 ms measured), so iPhones use that
  plus the nudge. Android is where Tune to the room matters most: Chrome's
  low-latency path reports about 24 ms whatever the headset, because it leaves
  the Bluetooth delay out, and there the microphone works raw with
  `echoCancellation: false`.
- **Show mappings.** The lowdown on everything: a card for every stream
  and every musical idea (the key and the dial, the sections, the tempo,
  the day's parts, the theme, where you listen from, the receipts, the
  clock, the map, the stickers), each with its live reading and receipt,
  what it is, what it plays and its source; a live spectrogram of the mix.
  It opens before Listen too, from the start screen's readings. (The
  ground's 0–50 Hz spectrogram per station is still to come.)

### A Day in Twelve Minutes

A day at 120× can't be the live piece played faster: bars would fly past and
every train would be a drum roll. It is its own form, composed by the same
engine from the archive:

- **100 BPM, 300 bars, one bar per 4.8 minutes of the day.** Five movements,
  one per daypart, sized to the clock and rounded to whole phrases: the
  nocturne about 2.5 minutes, first light 1.5, the working day 4, the rush
  1.5, last trains 2.5.
- **Events are summed per bar** into densities (Euclidean k), and each bar
  features the day's most salient event in its slice: the first train, the
  dawn swell on a powder morning, the crash that slowed I-15, the quake, the
  avalanche-control boom.
- **The harmony moves at every phrase,** each phrase standing for 38 minutes
  of the day: 37 moves in 12 minutes under the same one-note rule, so the
  day's flow is a journey around the circle.
- **The theme opens first light;** the captions show the clock racing.

A day is deterministic, so it is shareable: "Jan 14, 2027, in twelve minutes".

## Determinism and sync

The piece is a pure function, `compose(score, events, bar) → notes`, played by
every phone and rendered by CI with the same WebAssembly binary.

### The conductor and the players

- **The conductor** (the proxy) makes the decisions that need the valley's
  recent history. At each section boundary it writes the next section's **score
  page**: its index, start time and start bar, tempo, section type and length
  in phrases, the notes in play and home, the progression plan for each phrase,
  the instrumentation, the valley state and the boundary's caption. It runs
  the core from the same .wasm the phones run, in Node, so its decisions are
  the phones' decisions bit for bit.
- **The players** (phones) make everything at bar scale from the score page
  and the event windows: which bell, which hat pattern, which fill. A phone
  that joins mid-section replays the section from its first bar, events only,
  no audio, so it needs nothing older than the current page.
- **Event windows** hold 30 seconds of events each and are sealed 30 seconds
  after the window closes. Every phone hears a window exactly as sealed. An
  event observed after its window sealed goes into the next window and keeps
  its real time for the caption.

### The broadcast delay

The stream plays **90 seconds behind live**. A window opens at real time *t*,
is sealed at *t* + 60 s, is fetched by *t* + 75 s and is heard from *t* + 90 s.
A section boundary that passes at real time *B* is decided by the conductor at
*B* + 45 s, from data through *B*, fetched by *B* + 60 s and heard at *B* + 90 s.
Either way there are 15 to 30 seconds to spare for a slow feed or a slow
network. Captions show each event's real time.

### Files, not a feed

Score pages and windows live at immutable URLs (`/score/2026-10-23/0417.json`,
`/w/2026-10-23T17-42-30.json`) and are cached forever at the edge. A phone
computes the URL it needs from its clock and never asks for "latest", so no
cache, replica or eventually consistent store can hand two phones different
versions. (Workers KV, for one, can take 60 seconds or more to show a change
in another location.)

### Randomness

All randomness is a hash of (date, section, bar, voice, draw). It is
counter-based, so any bar can be computed without the bars before it, and a
joining phone, CI and Rewind all draw the same numbers.

### Clocks

Phones estimate their offset from an uncached `/time` endpoint at the edge:
eight round trips, keep the one with the lowest round-trip time, take its
midpoint, repeat every few minutes, and slew rather than jump. The HTTP `Date`
header can't do this: it has one-second resolution, and a cached file's
timestamps say when it was built, not when it arrived.
`AudioContext.getOutputTimestamp()` maps the audio clock to the page's clock,
and the output latency is subtracted where the browser reports it. Every
current engine has `getOutputTimestamp()` (Safari 14.1, Chrome 57, Firefox 70)
and `outputLatency` (Safari 18.4, Chrome 102, Firefox 70), but the values
vary. WebKit reports 0 until something plays, and a fixed 512 frames under
fingerprinting protection; iOS reports most of a Bluetooth delay; Chrome on
Android reports about 24 ms whatever the headset. Target: the same bar within
about 100 ms across phones in a room on their own speakers; "Tune to the room"
and the nudge cover the rest. Sample-accurate sync is a non-goal.

### Versions

Each score page names the engine version that plays it. A deploy publishes the
new engine next to the old ones, the score page before the switch tells
phones to prefetch it, and the conductor switches at a section boundary. Old
engines stay on the site, so Rewind replays a date on the engine that broadcast
it; "Remastered" renders it on today's.

### Offline

The same binary renders offline. CI runs it outside a browser to render
archived days, so at the same sample rate a CI render is, bit for bit, what a
phone computed: WebAssembly's floating point is deterministic apart from NaN
bit patterns and the relaxed-SIMD instructions, and the engine uses neither.
CI runs the .wasm itself rather than a native build, because Rust's `sin` and
`exp` differ between platforms; the engine uses the `libm` crate for every
transcendental anyway, as sonido's `no_std` crates already do. That is what
makes the listening harness and Rewind exact.

## Architecture

### Repo, hosting, license

- Its own repo, `ampactor-labs/wasatch` (name to confirm), hosted the way
  noodles is: Vite with `base: "/wasatch/"`, a GitHub Pages workflow
  (`actions/upload-pages-artifact`, `actions/deploy-pages`), served at
  ampactor.dev/wasatch.
- The Oct 23 page in the portfolio's `public/wasatch/` must be removed first;
  the two would collide on the same path.
- **License: AGPL-3.0-or-later**, the same as sonido, which the engine is
  built on. The repo is public anyway.

### The audio engine: one worklet, all ours

**Decision:** the whole audio engine (composition, voices, rooms, mix and
master) is one Rust crate on sonido, compiled once to WebAssembly and run
inside a single AudioWorklet. No Tone.js, and no native Web Audio processing
nodes in the signal path. The same binary renders offline in CI.

Why, starting from noodles' own receipts:

- **Native Web Audio graphs aren't deterministic.** noodles D29: five
  identical offline renders of a room built from native nodes came back at
  −6.60, −4.58, −4.58, −4.53 and −4.58 dB of impulse energy, because a browser
  may add latency to break a feedback cycle and Chrome decides that per graph.
  Principle 5 and the CI checks both need identical renders.
- **Worklets render silent inside Tone.Offline** (noodles D6), which would
  have broken revision 1's own plan: Tone.js voices into a sonido worklet
  master, rendered offline for CI.
- **Tone's nodes cost the audio thread even when idle.** noodles D31: on the
  Galaxy A16 the jam crackled; Tone's voices, filters and effects were most of
  the bill, and native nodes took the cold open from 278 to 76–87 ms per
  rendered second on a desktop core. A worklet that owns its voices pays only
  for what sounds.
- **sonido already has most of it**, including the Fourier tools this design
  leans on (below).

The alternatives, as of Oct 2026 (versions, licenses and gaps checked against
each project's repository and package registry):

| Option | License | Status | Covers here | Lacks here | Verdict |
|---|---|---|---|---|---|
| Tone.js | MIT | 15.1 stable, 15.5 in `next`, active | Scheduling, samplers, native-node effects | Determinism (native nodes differ by browser, OS and CPU), worklets offline, CPU on the A16 | Out |
| Elementary | MIT | 4.0.x; last commit Jan 2026, 2026 PRs unmerged | The same WASM offline in Node; samplers, tables, convolution, filters | Modal voices, granular, mip-mapped tables; its FFT only reports spectra; no loudness metering; custom nodes need a rebuilt runtime | Closest JS option; not enough |
| Faust (faustwasm, `faust -lang rust`) | LGPL tools; generated code takes your license, except GPL parts of its library | 2.88 (Sep 2026), active | 50-mode bell models, a marimba, the zita and jpverb reverbs; R128 since Aug 2026 | Its FFT is sliding, computed every sample; true peak didn't compile in faustwasm; one bell costs about 1.2% of a laptop core | A source of DSP: generate the zita reverb and the marimba as Rust, port the bell mode tables |
| FunDSP | MIT/Apache | 0.23 (Jan 2026) | Wavetables from harmonics, granular, FDN, convolution, STFT resynthesis | Loudness metering | Borrow parts |
| Csound (@csound/browser) | LGPL | 7.0 (Oct 2026) | Everything, phase-vocoder opcodes included | 8.4 MB of WASM; a second language | Out |
| SuperSonic (scsynth in WASM) | AGPL | 0.91 (Oct 2026), very active | SuperCollider's unit generators in the browser | A second runtime; offline rendering unverified | Out; worth watching |
| Essentia.js, Meyda | AGPL, MIT | Stale (2021, 2024) | Music-information features; R128 (Essentia) | Synthesis; Meyda still uses ScriptProcessorNode | Out |
| realfft/rustfft, ebur128 | MIT/Apache, MIT | Stable | FFTs with WASM SIMD; an R128 meter that passes EBU Tech 3341/3342 | — | In: the FFT under sonido-analysis, and ebur128 as an independent check on sonido's meter |

No library ships GCC-PHAT or up-conversion onto chord tones; both are built
on the FFTs and sonido's down-converter.

What sonido already has, measured and level-matched:

- **Synthesis:** PolyBLEP oscillators; wavetables with up to eight morph
  frames and mip-maps, built from any 256-sample frame (the skyline); FM;
  voices with allocation, unison and portamento; envelopes; a mod matrix.
- **Effects (36 kernels):** compressor and multiband compressor, a lookahead
  limiter, EQs, biquad and state-variable filters, an 8-line FDN reverb, plate
  and spring reverbs, a stereo widener, granular texture, pitch shift, time
  stretch, tape and more, each level-matched by measurement.
- **Analysis:** FFT and STFT, constant-Q, filter banks, the Hilbert transform,
  digital down-conversion, FFT cross-correlation with lag detection,
  ITU-R BS.1770-4 loudness with 4× true peak, YIN pitch detection, NLMS
  adaptive filters, sine-sweep impulse-response capture, and RT60.

What's new for this project, each written as a sonido kernel or module so the
plugins and the pedal can use it too:

- **An AudioWorklet host.** sonido's browser path today is cpal's Web Audio
  backend (its `wasm-bindgen` feature), driven from the page's main thread,
  which suits an editor but not a phone in a pocket.
- **A sampler voice** (multi-sample, velocity layers, release samples) for the
  piano and the orchestral samples.
- **A modal voice:** a bank of two-pole resonators run four at a time in
  SIMD, with mode tables for marimba, glockenspiel, celesta and bells (the
  bell tables ported from Faust's 50-mode models, trimmed to 16–24 modes), and
  bells whose partials are designed from the current chord so a bell is never
  out of key. Measured in Node on the i5-6300U that sonido's benchmarks use
  (`research/modal-bench/`): 2,400 resonators (48 voices × 50 modes) cost 21%
  of a core as scalar WASM and 7.0% with explicit f32x4 SIMD. Turning SIMD on
  without writing it explicitly did nothing (21.3%): the compiler doesn't
  vectorize the resonator loop by itself. So the engine runs at most 600
  resonators at once, about 5 to 6% of the A16's core at noodles' 3.5× factor,
  and steals the quietest.
- **Partitioned FFT convolution** for the measured rooms' early reflections,
  with the FDN fitted to each room's measured decay per band for the tail.
- **A true-peak limiter:** the lookahead limiter with 4× oversampled
  detection, the lesson noodles learned in D26.
- **GCC-PHAT:** phase-transform weighting on the existing cross-correlation.
- **Up-conversion,** the mirror of the down-converter, for the ground voice.
- **A counter-based random source.**

Running it in a worklet, without the usual traps:

- **No wasm-bindgen in the worklet.** A worklet has no `fetch` and no
  `TextDecoder`, and wasm-bindgen's worklet path needs nightly Rust, atomics
  and cross-origin isolation. The engine exports plain `extern "C"` functions
  and imports nothing.
- **Compile on the page, instantiate in the worklet.** The page compiles the
  module and posts it to the worklet; where posting a module fails (Safari
  before late 2022), it posts the bytes and the worklet compiles them.
- **No SharedArrayBuffer.** One instance per worklet and `postMessage` with
  transferable buffers are enough, so nothing needs the COOP/COEP headers that
  GitHub Pages can't send.
- **Memory is allocated once.** `memory.grow` detaches every view onto
  WebAssembly memory, so the engine reserves what it needs at start.
- **Denormals are flushed by hand.** WebAssembly has no flush-to-zero mode.
- **Two builds.** The SIMD build needs Safari 16.4 or later, and a module
  with SIMD instructions fails to load on engines without it, so a tiny probe
  module picks the SIMD build or a scalar one.
- **Never in a frame.** Chrome gives a real-time audio thread only to a
  top-level frame's worklet, so the portfolio links to the piece and never
  embeds it.

TypeScript keeps what TypeScript is for: the page, the map and dial, the host,
and the conductor's feed readers, where seisplotjs (MIT, active, SeedLink and
miniSEED over WebSocket) reads the seismometers and gtfs-realtime-bindings
decodes UTA's protobuf.

### Modules

| Module | Language | Responsibility |
|---|---|---|
| `core` | Rust | The composition engine: score page and event windows in, notes out. Pure, deterministic, property-tested. Used by the engine and by the conductor. |
| `engine` | Rust → WASM, on sonido | Voices, rooms, mix, master; runs `core` per bar. One AudioWorklet; also runs offline for CI and Rewind clips. |
| `host` | TypeScript | Loads the engine into the worklet, decodes samples with the engine's own decoder in a worker, feeds the worklet score pages, windows and samples as transferable buffers, and carries meters and spectrogram frames back to the page. |
| `ui` | TypeScript | The screen, captions, map, dial, vantage, menus, Media Session. |
| `conductor` | TypeScript on Node, running the core from the engine's .wasm | Reads every feed, holds the SeedLink connection, keeps the valley state, writes score pages and sealed windows, archives raw captures. One long-lived process on Railway, alongside two-top. |
| `edge` | R2 behind Cloudflare's CDN, plus one Worker | Serves the immutable files straight from R2 on a custom domain, cached forever; the Worker answers `/time` only. |
| `receiver` | readsb on a Raspberry Pi | Decodes ADS-B in the valley and pushes aircraft to the conductor. |
| `schedule` | Rust, in CI | Compiles UTA's GTFS weekly into compact per-day event tables. |
| `theme` | Rust, in CI | Computes the skyline profile, the theme's contour and the skyline wavetable frames from 3DEP; frozen once approved. |

### Data pipeline

1. **The score, built in.** A weekly GitHub Action downloads
   `gtfsfeed.rideuta.com/GTFS.zip` (8.8 MB), compiles each service day into
   rail events (individually, with route, stop, time and coordinates) and bus
   rates (per minute, per area), and ships them as static assets. With every
   live feed down, the piece still plays the day from the schedule.
2. **The conductor** reads every feed, including the ones a browser could
   read directly, because everything that reaches `compose()` must be the same
   bytes on every phone. A phone that diffs a feed on its own timing composes
   its own bars. Some feeds couldn't go to every listener anyway: UTA's
   realtime feeds send no CORS headers, EarthScope allows five connections,
   UDOT allows ten calls a minute per key, and the USGS Water Data APIs want a
   key beyond a few queries an hour. The legacy USGS services shut down on
   Feb 22, 2027, with added delays from Nov 16, 2026, so the conductor reads
   the new Water Data APIs from the start.
3. **Browser-direct reads are the fallback**, used only when the conductor is
   unreachable (see "When things fail"), and only for slow values: the lake,
   the weather, the air, the snowpack. Each is keyed to its source's own
   timestamp, so phones that read the same value agree. CORS-open feeds were
   tested Oct 23.
4. **The archive.** The conductor writes every score page, every window and
   every raw feed response to R2. Kept indefinitely; it is small. The raw
   captures start before the music exists (M0), so the archive has a winter in
   it by the time the listening harness needs one.

### Voices and mix

- **Made of the place first** (principle 8): the pad is the skyline
  wavetable; the bells, mallets and snow grains are modal voices; the wind is
  the harp; the ground is the ground voice. None of them needs a download.
- **Samples where nothing synthesized will do:** a sampled grand piano for the
  theme, and orchestral strings and brass for swells and the plane voices.
  Candidates with permissive licenses: Versilian Studios' VSCO 2 Community
  Edition and VCSL (both CC0), and the Salamander Grand Piano (CC BY). Verify
  each license before shipping.
- **The engine decodes its own samples.** They ship as Ogg Vorbis and are
  decoded by symphonia (pure Rust) inside the engine's code, not by
  `decodeAudioData`. A browser decodes and resamples with its own code, so each
  browser would hold slightly different samples, and Safari's decoders have a
  history: Opus in MP4 failed until iOS 27's rewrite, and that rewrite broke
  some AAC files.
- **The first bar loads before the tap:** the engine, the piano's first notes
  (under 500 KB) and the current score page, decoded in a worker while the
  listener reads the status screen. Everything else loads behind it.
- **Mixed like a radio station.** Family buses, then the vantage mix and the
  room, then the master: a slow loudness rider (short-term loudness on
  BS.1770's shelf with its high-pass moved up to 150 Hz, so it rides what a
  phone's speaker actually plays; ten-second time constant) toward the
  target, a gentle multiband compressor, and the true-peak limiter at
  −1 dBTP. A station sounds the same at 3am and at rush hour without anyone
  riding a fader; this one does too, on a phone as well as on headphones.
- **Loudness target:** about −16 LUFS integrated, the usual streaming level
  for mobile.
- **Mono-compatible** mix for phone speakers at a party; full stereo on
  headphones.

### Performance budgets

The reference phone is a Galaxy A16 5G, the entry-level Android noodles is
tuned on. noodles measured a phone's audio core at three to four times slower
than a desktop core (D31). sonido's FDN reverb costs 3.4% of a laptop core at
48 kHz, so on the A16 one room takes about 12% of a core, two-fifths of the
whole budget. So there is one late tail, shared, never one per voice, and the
engine is built with WebAssembly SIMD.

| Budget | Target |
|---|---|
| Time to first sound | ≤ 1.5 s from the tap on the A16 on LTE (the first bar is loaded before the tap) |
| Engine download | ≤ 1 MB compressed |
| CPU | ≤ 30% of one core on the A16: master ≤ 5%, rooms ≤ 12%, voices ≤ 10%, ground, harp and grains ≤ 3% |
| Polyphony | ≤ 48 voices, with voice stealing by priority; a voice exists only while it can sound |
| Memory for samples | ≤ 30 MB fully loaded |
| Score page | ≤ 20 KB; event window ≤ 30 KB |
| Data requests per listener | One window every 30 s, a score page every section, and a few `/time` calls at start and every few minutes |

CPU is measured the way noodles measures it (a Chrome trace of the audio
render thread, in milliseconds per rendered second) in CI on every change, and
on the A16 by hand at each milestone. In the field, Chrome's
`AudioContext.playbackStats` (Chrome 146) counts underruns; the
AudioRenderCapacity API that would have reported load was dropped from the
spec in 2025.

Two Chrome settings matter on the A16. Chrome on Android uses its low-latency
audio path for the default `latencyHint` ("interactive") and its power-saving
path for "playback". The power-saving path suits hours of listening, but one
report found it unstable over Bluetooth, so M0 measures both before choosing;
WebKit ignores the hint. Where `renderSizeHint` exists (Chrome 153 and later),
the engine asks for 512-frame quanta to cut per-call overhead; elsewhere it
runs at 128.

### When things fail

| Failure | Behavior |
|---|---|
| A feed is down | The conductor keeps its last good value; the caption says "cached"; the music doesn't stop |
| The conductor is down | Phones compute their own score pages from a deterministic schedule-only chain anchored at 05:00, so phones in fallback agree with each other; slow values come from browser-direct reads keyed to their sources' timestamps. Transit plays as written, no lateness, captions say "scheduled" |
| Offline entirely | Schedule plus the last pages and windows in storage |
| No transit (1–4am) | The nocturne palette; the lake, wind, ground and planes carry it |
| The ground's stream is late | The ground voice holds its last level and fades over a phrase; the caption says how old the ground is |
| Audio suspended by the OS | Resume on return; see risks |

## Quality: how "always sounds good" is enforced

Measured, not asserted, applied to music. Every check runs on renders of
recorded days by the same binary the phones run.

- **Loudness and peaks:** integrated loudness within ±1 LU of −16 LUFS for
  each checkpoint hour, true peak at or below −1 dBTP, measured with
  sonido-analysis's BS.1770-4 meter and cross-checked against the ebur128
  crate, an independent implementation.
- **Phone translation:** every check below also runs on the render passed
  through a phone-speaker model (a steep high-pass around 300 Hz and a small
  speaker's presence peak), so a layer that only exists in the bass fails.
- **Legibility:** for every featured event, its own stem must stand at least
  6 dB above the rest of the mix in at least one ERB band over its first
  100 ms, on both renders; at least 95% of featured events pass. This is
  principle 3 as a test.
- **Roughness:** the same roughness sum, computed per bar from the partials
  the engine synthesized, stays under a ceiling per register and section type,
  set from renders that passed the listening rubric.
- **Music rules:** no silence longer than 4 seconds; density never above the
  cap; every pitched event in the notes in play and in range; no boundary
  changes more than one note.
- **Determinism:** the same inputs give the same event list (hashed) and the
  same audio (hashed) across runs and between Node and the browser.
- **CPU:** render time per rendered second, from the trace, against the
  budget.
- **The listening harness.** Render any archived day offline faster than real
  time to audio files, then listen to fixed checkpoints (3am, 7am, noon,
  5:30pm, 11pm) after every mapping change. Mappings are tuned by ear against
  these renders, not by reasoning about them.
- **A listening rubric** for each checkpoint: Did something legible happen in
  the first 30 seconds? Did it sound good on a phone speaker? Was there a
  change I noticed within two minutes? Would I leave it on?
- **Accessibility:** captions are text, and screen readers announce section
  changes and featured events at a polite rate rather than every caption;
  reduced-motion mode stills the map and dial; a visible volume control; no
  autoplay.

## Privacy and terms

- GPX files never leave the device.
- "Tune to the room" (Android and desktop) processes four seconds of
  microphone audio on the device, sends nothing, and releases the microphone
  when it's done; the permission is asked only when the listener taps it.
- No accounts, no listener tracking beyond aggregate page counts.
- Attribution in the footer and mappings view for every source (UTA, USGS,
  NRCS, NWS, Open-Meteo, BCycle/GREENbike, UDOT, Synoptic, UAC, EIA,
  EarthScope, the University of Utah Seismograph Stations, and adsb.lol and
  OpenSky wherever their data is used) and every sample set.
- Captions name airline flights by flight number and leave private aircraft
  anonymous, as a swell with no caption.
- Check before launch:
  - UTA's current developer terms. developer.rideuta.com no longer resolves.
    The archived 2024 terms grant a revocable license to use, reproduce and
    redistribute, and require the legend "Route and departure data provided by
    permission of UTA", which goes in the footer from day one.
  - UAC's Data Access Policy, shown at token signup. Tokens last 12 months,
    and the docs ask for a custom User-Agent and polling about every
    15 minutes between 5 and 8 AM.
  - Synoptic's written consent for a public display. Its free tier is now
    for .edu accounts, and its terms limit use to internal purposes without
    consent.
  - EarthScope's and the University of Utah Seismograph Stations'
    attribution terms.
  - A USGS Water Data API key for the conductor.

## Risks and open questions

| Risk | Mitigation |
|---|---|
| iOS silences or suspends Web Audio | By default, Web Audio gets the Ambient category: the Silent switch and the screen lock silence it. The tap sets `navigator.audioSession.type = "playback"`, which ignores the Silent switch, and since WebKit 275558 (confirmed on iOS 17.5) a resumed AudioContext keeps playing in the background under it. It also stops other apps' audio, which is right for a station. The route through a MediaStream into `<audio>` is dropped as unproven. M0 tests lock, background and the Silent switch on a real iPhone; if they fail, iOS is foreground-only and the screen says so |
| Android freezes the page | Chrome freezes a hidden page a minute after it falls silent (30 s without sound). The piece is never silent (principle 6), so it isn't frozen, and audible pages keep their timers |
| No lock-screen controls | The looping five-second `<audio>` clip; M0 tests it on both platforms |
| The engine is over budget on the A16 | One shared late tail, SIMD, voices that exist only while sounding, the CPU check in CI; measured on the phone at every milestone |
| Mapping that's right on paper sounds bad | The listening harness; tune by ear |
| The skyline pad is too reedy | Measured already: brighter than a saw. The tilt is a parameter; tune by ear in M0 |
| The ground voice is too faint or too rough | Per-band levels and smoothing from the archive; tune by ear |
| Rush hour too dense | Statistical buses, caps, priorities; verify in the 7am render |
| Seismic stream late or unavailable | The 90 s delay covers the measured median of 18.6 s (90th percentile 27.8 s, worst 319 s); a station later than its window holds its last level and fades; the conductor uses one of EarthScope's five connections and reconnects with backoff |
| Station events or lateness wrong | UTA's feeds give positions only, so the geofence detector and the schedule join are unit-tested on recorded days against the trip updates' last predictions and spot-checked against UTA's arrival boards |
| The receiver goes down | adsb.lol and OpenSky, earned by feeding, as backups; planes are a color, so the piece doesn't miss a beat without them |
| Avalanche data trivialized | UAC's permission first; the caption links to the forecast; never a danger-level soundtrack |
| Feed terms change, keys revoked, APIs retired | Every layer degrades to cached; nothing depends on a single feed. The known one: USGS's legacy services close Feb 22, 2027, so the conductor uses the new Water Data APIs from day one |
| Sample licenses | Verify each; fall back to synthesis |
| Sync across phones drifts | Re-align at each phrase boundary; 100 ms is the bar; "Tune to the room" and the nudge for Bluetooth |
| WebAssembly renders differ between engines | No relaxed SIMD, no NaN-dependent logic, `libm` for every transcendental; the CI hash compares Node with Chrome, Firefox and Safari renders |

## Milestones

Each one ends with something in someone's hands, per DAY.md.

| # | Milestone | Done when |
|---|---|---|
| M0 | Repo, Pages deploy, the worklet host running sonido and the core, the computed theme on piano over the skyline pad, a schedule-only groove. The recorder: raw captures of every keyless feed to R2 every minute. The platform tests on a real iPhone and the A16, written up: background and lock under the "playback" session, the Silent switch, Now Playing and Android's notification controls, both latency hints. | A tap plays the theme and a groove at ampactor.dev/wasatch and one person has heard it; the recorder has a full day in R2 |
| M1 | The harmony walk, sections, dayparts, the lake's rule, never-a-loop cycles, the CI renders and checks, all from the schedule plus keyless feeds | A 15-minute listen has at least seven captioned moves; the 3am and 7am renders pass the rubric and the checks; sent to someone |
| M2 | The conductor and players: score pages, sealed windows, UTA realtime (arrivals, lateness, vehicles), the map, receipts, clock sync | Two phones in a room play the same bar; a late train lays back audibly |
| M3 | The valley's materials: the ground voice, the harp, snow grains, the lid, the three recorded rooms, vantage geometry, the roads and canyons from UDOT, bikes, planes from the receiver, quakes | A storm builds tension for hours in a recorded day; the canyon vantage on a powder morning sounds like one; an inversion morning sounds roofed over and carries |
| M4 | Play along, Add your run, Rewind with engine versions, A Day in Twelve Minutes, share clips, Media Session, Tune to the room | A stranger records a run and shares the clip; an Android phone on a Bluetooth speaker and a phone on its own speaker agree after Tune to the room |
| M5 | Samples, the master chain tuned, accessibility, attribution, launch | Leave it on for two hours and want to keep it on |
| Later | Synoptic and UAC (each with permission), resort voices with real opening times, a recording of a FrontRunner horn | Each with its own receipt |

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Tuning | 12-TET, A440 | Sounds right everywhere; every key on the circle is equally usable. Just intonation was dropped on Oct 23. |
| Harmony | The notes in play (moved by flow) and home (picked by the sky); at most one note changes per boundary | Key and mode are one space; driving them separately allowed five-step jumps. New in revision 2. |
| Meter | 4/4, half-time feel at night | Stable groove for transit percussion |
| Shared vs personal | Shared: everyone hears the same bar | The radio-station feeling; phones in a room in sync |
| Sync model | A conductor writes immutable score pages; phones play bars from them and from sealed 30-second event windows | Same bytes on every phone; no "latest" to disagree about. New in revision 2. |
| Broadcast delay | ~90 s behind live | Sealed windows with margin, identical across clients |
| Engine | One Rust crate on sonido, one AudioWorklet, the same binary offline | Determinism, CPU, render parity, all from noodles' receipts; sonido already has the Fourier tools. Replaces Tone.js plus a worklet master. |
| Sounds | Made of the place where possible (skyline wavetable, modal bells and mallets, the harp, the ground voice, recorded rooms); samples for piano, strings and brass | Principle 8; less to download; nothing out of key |
| Proxy host | The conductor on Railway (one long-lived Node process); files on R2 behind Cloudflare's CDN; `/time` on a Worker | The conductor needs a held SeedLink connection and a 30-second loop. Cloudflare Cron Triggers stop at one-minute intervals, the free plan gives a Worker 10 ms of CPU per invocation, and KV can lag 60 s. Decided in revision 2; revision 1 left it open. |
| Flights | An ADS-B receiver of our own | OpenSky needs a written license for a live product; the other open APIs are capped or personal-use only. New in revision 2. |
| License | AGPL-3.0-or-later | Matches sonido |
| Name | "Wasatch Symphony"; repo `wasatch` (confirm) | |

## Non-goals

- A per-company product or integration.
- A forecasting or safety tool. It points to the Avalanche Center's forecast;
  it never replaces it.
- A seismograph. The ground voice is music moved by seismometers, not a
  reading of them; the mappings view links to the real thing.
- Sample-accurate sync between devices.
- Generated or AI-composed music. The engine is rules, a curated vocabulary
  and data, written by hand and tuned by ear.

## Appendix A: data catalog (tested Oct 23, 2026)

| Source | Endpoint | Auth | Browser CORS | Cadence | Sample reading |
|---|---|---|---|---|---|
| UTA schedule | `gtfsfeed.rideuta.com/GTFS.zip` | none | n/a (build time) | weekly | 86 routes; 243,304 weekday stop events |
| UTA realtime | `apps.rideuta.com/tms/gtfs/{TripUpdate,Vehicle,Alert}` | none | no | ~10 s | 353 vehicles with trip, position and timestamp only (median 12 s old); 361 trip updates, passed stops dropped, no delay field |
| Great Salt Lake | USGS Water Data API, `ogcapi/v1/collections/latest-continuous`, `USGS-10010000`, parameter 62614 | key beyond a few queries an hour | yes | 15 min | 4,189.8 ft (provisional) |
| Rivers | USGS `collections/continuous`, e.g. `USGS-10171000`, parameter 00060; normals from `statistics/v0/observationNormals` (day of year, p5–p95) | as above | yes | 15 min | Jordan River at 1700 S 151–160 cfs; Little Cottonwood 117 cfs |
| Earthquakes | USGS FDSN event query, Utah bounding box | none | yes | minutes | 69 events in 3 days |
| Snowpack | NRCS AWDB `services/v1/data`, `duration=HOURLY`, stations 766 Snowbird, 366 Brighton, 814 Thaynes Canyon, 628 Mill-D North | none | yes | hourly (depth skips some hours; times in UTC−8) | Snowbird depth 0 → 3 → 9 in Oct 12–13, 0 by Oct 19; newest value 36 min old |
| Mountain forecast | NWS `gridpoints/SLC/108,167` (Alta) | none (User-Agent) | yes | hourly | Gusts 61 km/h (38 mph) on the morning of Oct 23 |
| Inversion | Open-Meteo forecast API, pressure-level temperatures for SLC; the SLC balloon soundings | none | yes | hourly; soundings twice a day | Not tested |
| Air | Open-Meteo air-quality API | none | yes | hourly | PM2.5 2.3, AQI 40 |
| Weather | Open-Meteo forecast; NWS KSLC observations | none | yes | hourly | |
| GREENbike | `gbfs.bcycle.com/bcycle_greenbikeslc/` (GBFS 1.1; 2.1 alongside) | none | yes | cached 60 s | 72 stations; status only |
| Seismometers | EarthScope `rtserve.earthscope.org`: SeedLink 4 on port 18000, TLS on 18500, `wss://rtserve.earthscope.org/seedlink`; network UU | none; 5 connections, about 1 h of history | yes (WebSocket) | continuous | 685 UU streams from 170 stations; newest sample a median 18.6 s old |
| Flights | Our own receiver (readsb); adsb.lol and OpenSky as feeder-earned backups | — | n/a | 1 s | To build |
| Grid | EIA v2 `electricity/rto/region-data`, PACE | free key | yes | hourly | Works with DEMO_KEY |
| Roads | UDOT `udottraffic.utah.gov/api/v2/get/{event, messagesigns, mountainpasses, alerts, servicevehicles, weatherstations}`; v3 `roadconditions` | free key, 10 calls a minute | unknown | live | No speed or travel-time endpoint |
| Wind | UDOT weather stations; the NWS forecast for the ridges; Synoptic's ridge-top stations once it consents | key; none; consent | unknown | 5–15 min | Not tested (needs keys) |
| Avalanche | Utah Avalanche Center API, e.g. `/forecast/salt-lake/json` | token after a data-access policy, 12 months | no | daily plus observations | 401 without a token |
| Ski buses | In the UTA schedule: 994 (Snowbird, Alta), 972 (Solitude, Brighton) | none | n/a | weekly | Present in the current schedule |

Dropped since revision 1: USGS `nwis/iv` (closing Feb 22, 2027), OpenSky as
the flight source, and Synoptic as the wind source.

## Appendix B: palette

| Voice | Instrument | Data |
|---|---|---|
| Theme | Grand piano (sampled) | The skyline |
| Pad | The skyline wavetable, tilted, hazed by `openness` | Progressions, snowpack extensions |
| Harmony | Strings ensemble (sampled), soft electric piano | Progressions |
| Sub and bass | Sine sub with its harmonic shadow, plucked upright or synth bass with asymmetric saturation | Lake pedal, river activity |
| Kit | Composed backbone: soft kick, brushed snare, rim; Euclidean shaker and hats | Daypart, activity, bus rate, lateness |
| TRAX bells | Modal bells, one line per chord tone | Departures |
| FrontRunner | A five-note locomotive horn chord, voiced in the current key | Arrivals |
| Canyon toms | Toms in the canyon's recorded echo | Ski buses |
| Snow grains | Modal pings; glassy for light powder, felted for heavy snow | Snowfall rate, new-snow density |
| Bikes | Marimba, kalimba (modal) | Dock changes |
| Planes | Brass and string swells (sampled) | Departures and arrivals |
| Quakes | Tubular bell, gong (modal, partials from the chord) | Catalog magnitude |
| Wind | The Aeolian harp, tuned to the chord, with a little air | Canyon and ridge wind, gusts |
| The ground | Chord tones moved by the seismometers' bands | City seismic noise |
| Resorts | One orchestral voice each (horn, clarinet, flute, harp …) playing its own summits | Opening days, first chair |

## Appendix C: a minute of rush hour, written out

Friday, 5:42 PM, Everywhere vantage. Section: Groove, phrase 3 of 8, at
100 BPM (the rush base; the fleet was at its usual Friday speed when the
section began, so no nudge). A phrase is 19.2 seconds. The notes in play are D
major's, home is E, so the mode is E Dorian: a high overcast came in from the
southwest at 4 PM, and cloud pulls home toward Dorian even with the sun still
8.7° up (sunset is 6:36 PM). The air is clean (PM2.5 2.3) and well mixed, with
no inversion, so the lid is open: the room is wide and dry and the pad has
every ridge. No snow, no storm in the forecast, tension 0.2.

- Bars 1–2: the bus stop-event rate is at the 96th percentile for a Friday at
  this hour, so the hats play E(13,16) with a light shuffle. Harmonic rhythm
  is one chord per bar: `i–IV`, E minor to A.
- Bar 2, beat 3: a Red Line train leaves Ballpark; its position left the
  platform's 50 m circle 54 seconds after its scheduled departure. The Red
  Line's bell is the chord's fifth, so over A it rings E, 18 ms behind the beat.
  Caption: "Red Line · Ballpark · 1 min late."
- Bar 3: two GREENbike docks downtown change by one bike each, so the marimba
  plays scale degrees 5 and 3, picked by the docks' latitudes.
- Bar 4, beat 1: DL2216 departs SLC, so a brass swell rises over four bars,
  panned left (the airport is west of the city on the map) as it climbs.
- Bars 5–8: the phrase cadence, `♭VII` (D) heading for `i` (E minor). The lake
  is 8.2 ft below 4,198, and this cadence is one of the share that doesn't come
  home: it lands on `♭III` (G major) with a sus2 on top, not on A, the chord
  the phrase has been vamping on.
- Bar 8: a service alert on a bus route arrived during the phrase, so the fill
  is a tom run into a soft crash on the downbeat of phrase 4.
- Under all of it: the Brigham Young Park station's 8–16 Hz band, where most
  of the traffic is, sits at its usual level for a Friday evening, so the
  ground voice holds a quiet G (the third of E minor), gliding to A when the
  chord changes and wavering with the traffic.

Five phrases remain after this one, 96 seconds. At the boundary, `flow` will
read above its dead band: the fleet has run 8% faster than a usual Friday over
the section, the rush clearing early. So the notes in play move one step
sharpward, from D major's to A major's (G becomes G♯), and since the sky is
unchanged, home stays on Dorian's place in the new arc: B. The last bar pivots
on B minor, `v` in E Dorian and `i` in B Dorian. Caption: "The valley cleared
faster than a usual Friday → B Dorian (G became G♯)."

## Appendix D: the skyline, measured

Computed Oct 23, 2026 from USGS 3DEP through the 3DEPElevation ImageServer's
`getSamples` (1 m lidar where available):

- **Sampling.** 155 east-west transects, one every 0.01° of latitude (about
  1.1 km) from Ben Lomond (41.363° N) to Mount Nebo (39.822° N), each sampled
  every 0.005° of longitude within ±0.16° of a hand-placed crest line, then
  refined on a 5×5 grid at 0.001° around each transect's highest point. The
  profile is each transect's highest point: the range as a surveyor draws it,
  or as the skyline looks from far out on the lake.
- **The profile.** 6,888 to 11,915 ft, mean 9,220 ft. Summits are local maxima
  standing at least 250 m above the lowest ground between them and anything
  higher along the profile, plus the two ends. Names are the nearest summit in
  GNIS (the USGS geographic names service), all within 1.1 km. Sampled heights
  run below the surveyed summits (Nebo 11,915 against 11,928 ft, Timpanogos
  11,674 against 11,752 ft), which M0's full-resolution pass fixes.
- **The spectrum.** The profile was detrended between its endpoints and
  mirrored into a continuous 308-sample cycle. A least-squares fit of
  log-amplitude against log-harmonic gives k^−0.67 over harmonics 1–16,
  k^−0.60 over 1–40 and k^−0.79 over 4–64; a sawtooth is k^−1.00 and a
  triangle k^−2.00. By octave band, relative to the fundamental: harmonics
  2–3 +6.0 dB, 4–7 +2.6 dB, 8–15 −1.2 dB, 16–31 −2.9 dB, 32–63 −8.8 dB (a
  sawtooth: −7.6, −14.4, −20.9, −27.1, −33.2 dB).
- **The wavetable.** Resampled to 256 samples, the first twelve harmonics sit
  at 0.0, +7.8, +4.0, +3.2, +10.6, −15.5, −5.9, +5.0, −4.4, +3.8, −2.8 and
  +2.8 dB relative to the fundamental; the power-weighted centroid is at
  harmonic 5.3. After a k^−0.5 tilt the fit is k^−1.15.

So the raw skyline is brighter than a sawtooth. It is brighter, too, than the
β ≈ 2 typical of single elevation profiles (power spectrum ∝ k^−β, so
amplitude ∝ k^−1, about a sawtooth), probably because each sample is the
highest point across a 27 km band, which jumps from ridge to ridge. The tilt
and the haze frames are what make it a pad.

To rerun the numbers in this revision:

- **The skyline:** `python3 research/skyline/fetch_crest.py <dir>` (about
  14,000 samples from 3DEP), then `analyze_crest.py <dir>`, then
  `name_summits.py <dir>`. `research/skyline/crest_profile.json` is the
  Oct 23 result, profile and wavetable included.
- **The theory and timing claims:** `python3 research/theory/check_theory.py`
  checks the ladder, the bank, the lake's chords, the worked example's pivot,
  the cycle lengths, the layer cycles and Eno's, A Day in Twelve Minutes, the
  distance law and the sunset.
- **The modal benchmark:** in `research/modal-bench/`, build with
  `RUSTFLAGS="-C target-feature=+simd128" cargo build --release --target
  wasm32-unknown-unknown` (and once without the flag for the scalar build),
  then `node run.mjs <wasm files>` and `node run2.mjs <simd wasm>`.
- **UTA's feeds:** `python3 research/feeds/gtfsrt_decode.py TripUpdate.pb
  Vehicle.pb` on fresh downloads of `apps.rideuta.com/tms/gtfs/TripUpdate` and
  `/Vehicle` shows which fields are populated.

## Appendix E: what changed in revision 2

- **Harmony:** key and mode became one space, the notes in play and home, with
  at most one note changing per boundary; no pull toward sharp keys; every day
  starts at home; the move counts now match the section lengths.
- **Form:** modulation happens at every boundary (Journey stages one, it no
  longer owns them); the cycle fits 12 minutes by construction; incommensurate
  layer cycles.
- **The theme** is computed: 13 summits, a contour, rhythm set by hand.
- **New sounds made of the place:** the skyline wavetable, the ground voice
  (down- and up-conversion instead of audification, which can't be live), the
  Aeolian harp, recorded rooms, snow grains colored by snow density.
- **Transit:** TRAX departures are bells over a composed backbone, hats are
  Euclidean, station events come from vehicle positions, FrontRunner is a horn
  in the grade-crossing rhythm.
- **The lid** is a ceiling with two inputs: the inversion's temperature
  gradient carries far sounds closer, and the haze blurs the skyline; no master
  low-pass.
- **Vantage** is a real place with computed distances and a recorded room.
- **The lake's rule** names its deceptive chords, never lands on the vamp,
  follows the Strike Team's ranges, and has its ceiling tuned by ear.
- **Sync:** a conductor writes immutable score pages, sealed event windows,
  counter-based randomness, a real clock-sync endpoint, engine versions for
  Rewind, and "Tune to the room" (Android and desktop) plus a nudge for
  Bluetooth.
- **Engine:** one AudioWorklet running a Rust crate on sonido; Tone.js is out;
  the same binary renders CI and Rewind; the engine decodes its own samples; a
  radio-style master.
- **Platform:** the "playback" audio session on iOS, a five-second clip for
  lock-screen controls, never framed, both latency hints measured.
- **Quality:** phone-speaker translation, legibility by masking, roughness
  (also used to pick voicings) and CPU are checks.
- **Lineage:** what this takes from Listen to Wikipedia, Conductor, Two
  Trains, Endel and Eno's generative apps.
- **Data:**
  - USGS moves to the new Water Data APIs; the legacy services close
    Feb 22, 2027.
  - TRAX station events are inferred from positions, since UTA's feeds carry
    no stop status, and bells ring on departure, as the real trains do.
  - Flights come from a receiver of our own.
  - Wind comes from UDOT's stations and the NWS until Synoptic consents.
  - SNOTEL's hourly data works with the right query.
  - The ground comes live from EarthScope through the conductor.
  - New inputs: the inversion's temperature gradient (from pressure-level
    temperatures), new-snow density, and the lake's seiche.
  - "Usual" has a source for every value at launch.
  - The lake's curve follows the Strike Team's ranges.
- **Fixes to revision 1's worked example:** `flow` direction, the time to the
  boundary, and why the mode is Dorian.
- **Milestones:** the archive starts recording in M0, and the platform tests
  move to M0.
