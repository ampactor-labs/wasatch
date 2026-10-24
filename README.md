# Wasatch Symphony

The Salt Lake valley, played live as a piece of music: **[ampactor.dev/wasatch](https://ampactor.dev/wasatch/)**

Tap **Listen to the Wasatch** and the Wasatch theme plays on piano, the crest
itself as a melody, thirteen summits from Ben Lomond to Mount Nebo, in the key
the valley is in right now. Then the live piece fades in under it:

| What's happening in the valley | What you hear |
|---|---|
| A TRAX train leaves a station | A bell on its line's chord tone (Blue root, Red fifth, Green third) |
| FrontRunner at Salt Lake Central | A horn in the rhythm of a grade crossing |
| Buses everywhere | The groove's density: hats and shakers in Euclidean patterns |
| The Jordan River running high | A walking bass |
| A ski bus heads up a canyon | Drums in that canyon's own echo |
| Great Salt Lake's level | The drone under everything; below 4,198 ft, phrases don't always come home |
| The sky over the valley | How bright the mode is, Lydian through minor |
| Wind on the ridges | An Aeolian harp, each string picked by the wind's shedding frequency |
| Snow falling in the Cottonwoods | Grains of sparkle, as light as the powder is |
| Smog and an inversion | Haze over the pad, a low ceiling on the reverb |
| The ground under downtown | Four seismometers, moved up onto the chord |
| An earthquake in Utah | A deep bell |
| A GREENbike checked out | A marimba pluck |

The harmony moves at every section boundary, one note at a time, and a caption
says why: *"The valley's slowing down → B♭ minor (G♭ for G)."* Every phone
plays the same bar at the same moment, about 90 seconds behind the valley.
Pick where you're listening from (the whole valley, the Gallivan Center
downtown, Tanners Flat up Little Cottonwood, Saltair on the lake) and you're
standing there: every family has a home in the valley, so what's near is
close, bright and dry, what's far is quiet, dark and echoing, and the place
answers with its own echoes (the towers flutter, the canyon slaps back on
the beat). The map says YOU ARE HERE and a sign says what's near and far. The
mix changes; the music doesn't.

Everything else is in the menu, all optional:

- **Play along.** Hold the phone like a ski and tip it onto its edges: a
  steady edge plays the chord, a wobble plays the notes between. It can't
  play a wrong note, and only you hear it.
- **Add your run.** A GPX from any tracker becomes a piano solo over the live
  valley, every turn a note, the vertical as the melody coming down. Save a
  30-second clip. The file never leaves your device.
- **Rewind,** and **A Day in Twelve Minutes:** a whole day, 5 AM to 5 AM, as
  its own 300-bar piece, the trains racing across the map. Any day in the
  archive, with a link to share it.
- **Line up with a friend.** Phones play the same bar; on Android and
  desktop, *Tune to the room* listens for the phone next to it and lines
  this one up (a Bluetooth speaker's delay included). iPhones get a nudge.
- **Show mappings.** The lowdown: every stream and every musical idea, what
  it plays, its live value, where it came from, and a live spectrogram.

While it plays, a conditions board under the clock shows every live
reading at once, the way a ski area posts its own: trains and buses out,
how late the trains run, the lake, the air, the sky, new snow, the ridge
wind, the river, the ground, quakes and bikes.

Anything on screen that comes from the valley explains itself: tap a word
in the status lines, a card in the feed, the key, a sticker, the dial or
the map, and a toast says what it is and what the music does with it; tap
the toast for the lowdown. On a desktop, Space plays and pauses and 1 to 4
pick where you listen from; media keys and the system's media controls work
too.

[DESIGN.md](DESIGN.md) is the whole design: the music theory, the data, the
sync, and why each choice was made.

## How it works

- **The engine** ([`engine/`](engine/)) is Rust on
  [sonido](https://github.com/ampactor-labs/sonido), compiled to WebAssembly
  and run in an AudioWorklet. It plans the day, composes each bar, voices and
  renders it: a sampled piano, a pad whose waveform is the skyline's spectrum,
  modal bells and marimbas, a Karplus–Strong harp, every family staged from
  where you're listening and a modeled room per vantage, and a mastering
  chain to −16 LUFS whose rider listens like a phone's speaker. The same `.wasm` renders offline in Node
  for the tests.
- **The score** is deterministic. A day's plan is a function of the transit
  schedule, the sun and moon, and sky observations; every random choice comes
  from a counter-based generator keyed by the bar. Two phones with the same
  inputs play the same notes.
- **The schedule** ([`tools/gtfs/`](tools/gtfs/)) is compiled from UTA's GTFS
  every day into small JSON files: every rail departure, ski-bus trip, and the
  bus network's activity by the minute.
- **The live data** comes straight from the browser: USGS (the lake, the
  Jordan River, earthquakes), the National Weather Service, Open-Meteo,
  SNOTEL, GREENbike's GBFS feed, and the University of Utah's seismometers
  over EarthScope's DataLink WebSocket, decoded from miniSEED in the page.
- **The page** ([`web/`](web/)) is TypeScript and hand-drawn SVG: the skyline
  with a shredder riding the theme summit to summit, the valley map with every
  scheduled train, the harmony dial as a ski-lift bullwheel, and captions on
  routed-wood trail signs.
- **The conductor** ([`conductor/`](conductor/)), on Railway, is a small
  Node server that reads what a browser can't (UTA's realtime, KSLC's
  METARs), holds the one connection to the seismometers, and seals it all
  into 30-second windows every phone reads alike: the bells ring when the
  trains actually leave, and a late one lays back behind the beat. If it's
  ever unreachable, the site plays from the schedule and the open feeds.
- **The archive.** Each daily build compiles against the deployed site, so
  every earlier day carries forward with its schedule and its sealed sky.

## Develop

You need Rust (stable, with `rustup target add wasm32-unknown-unknown`) and
Node 24.

```sh
npm ci
npm run engine   # build the engine to web/public/engine (SIMD and scalar)
npm run gtfs     # download and compile UTA's schedule to web/public/schedule
npm run dev      # http://localhost:5173/wasatch/
```

Checks:

```sh
cd engine && cargo test --release && cargo clippy --all-targets && cd ..
npm run typecheck
npm test                                  # vitest and the tools' node tests
node tools/render/check.ts                # loudness, true peak, silence, determinism, a day in 12 minutes
node tools/e2e/smoke.ts                   # headless Chrome against dist/, every menu feature
npm run conductor                         # the conductor on :8080; open the site with ?conductor=http://localhost:8080
node tools/render/render.ts 2026-10-23 17:40 60 rush.wav
```

`engine/examples/render.rs` renders natively (`cargo run --release --example
render -- 2026-10-23 17:40 60 rush.wav`) and `examples/bench.rs` profiles each
voice.

## Layout

```
engine/          the Rust engine (plan, compose, voicing, audio, FFI)
web/             the page: src/engine (worklet host), src/app, src/art, src/data
conductor/       the optional server: realtime trains, sealed windows, a clock
tools/gtfs/      UTA GTFS → the score's schedule files (and the archive)
tools/archive/   sealing each finished day's sky
tools/render/    offline renders and the quality check
tools/e2e/       the headless browser test
research/        the measurements behind DESIGN.md
docs/            the first design, for the record
```

## Credits

Data: Utah Transit Authority (GTFS), U.S. Geological Survey, National Weather
Service, Open-Meteo (CC BY 4.0) with Copernicus CAMS, USDA NRCS SNOTEL,
BCycle/GREENbike (GBFS), and the University of Utah Seismograph Stations via
EarthScope. The crest is from USGS 3DEP elevations.

The piano is the Salamander Grand Piano by Alexander Holm (CC BY 3.0). The
type is Shrikhand, Rubik and Space Mono (SIL Open Font License).

## License

GNU Affero General Public License v3.0 or later. See [LICENSE](LICENSE).
