# Wasatch Symphony

The Salt Lake valley, played live as a piece of music: **[ampactor.dev/wasatch](https://ampactor.dev/wasatch/)**

Tap **Listen to the Wasatch** and the Wasatch theme plays on piano, the crest
itself as a melody, thirteen summits from Ben Lomond to Mount Nebo, in the key
the valley is in right now. Then the live piece fades in under it:

| What's happening in the valley | What you hear |
|---|---|
| A TRAX train leaves a station | A bell on its line's chord tone (Blue root, Red fifth, Green third) |
| FrontRunner at Salt Lake Central | A horn in the rhythm of a grade crossing |
| Buses everywhere | The groove's density: hats, kick, the walking line |
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
Pick where you're listening from (the whole valley, downtown, the canyons, the
lake) and the mix and the room change; the music doesn't.

[DESIGN.md](DESIGN.md) is the whole design: the music theory, the data, the
sync, and why each choice was made.

## How it works

- **The engine** ([`engine/`](engine/)) is Rust on
  [sonido](https://github.com/ampactor-labs/sonido), compiled to WebAssembly
  and run in an AudioWorklet. It plans the day, composes each bar, voices and
  renders it: a sampled piano, a pad whose waveform is the skyline's spectrum,
  modal bells and marimbas, a Karplus–Strong harp, a modeled room per vantage
  and a mastering chain to −16 LUFS. The same `.wasm` renders offline in Node
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
node tools/render/check.ts                # loudness, true peak, silence, determinism
node tools/e2e/smoke.ts                   # headless Chrome against dist/
node tools/render/render.ts 2026-10-23 17:40 60 rush.wav
```

`engine/examples/render.rs` renders natively (`cargo run --release --example
render -- 2026-10-23 17:40 60 rush.wav`) and `examples/bench.rs` profiles each
voice.

## Layout

```
engine/          the Rust engine (plan, compose, voicing, audio, FFI)
web/             the page: src/engine (worklet host), src/app, src/art, src/data
tools/gtfs/      UTA GTFS → the score's schedule files
tools/render/    offline renders and the quality check
tools/e2e/       the headless browser smoke test
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
