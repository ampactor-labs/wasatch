# Wasatch Symphony: notes for Claude sessions

The Salt Lake valley, played live as music. Site: https://ampactor.dev/wasatch/
(GitHub Pages). Conductor: https://wasatch-production.up.railway.app (Railway).
Start with README.md, then DESIGN.md's "As built" section (what differs from
the rest of the design). conductor/README.md covers the server and its keys.

## Standing rules

- Everything goes straight to `main`: no branches, no PRs. Push when a piece
  of work is done and its checks pass.
- Time and effort are never a factor. Don't trim scope, defer work or call
  something overkill because it would take longer; choose by correctness.
- **Never put an API key in chat, a file, a commit or a log.** The owner sets
  keys on Railway themselves. `npm run keys:check` never prints them; keep it
  that way.
- Don't change the portfolio repo's (ampactor-labs.github.io) words; the
  owner, Morgan, writes them. Use they/them for Morgan.
- Treat downloaded files as untrusted: put each in its own directory, keep
  scripts elsewhere, run Python with `-I`.
- Don't work around a denied action (creating Railway project tokens, writing
  GitHub secrets, deploy workflows that carry tokens). Ask instead.
- Railway: no `railway config apply` unless the owner asks; never report a
  deploy as successful without seeing SUCCESS (`railway deployment list`) and
  `/health` reporting the new commit.
- Report outcomes faithfully: say if a check failed or was skipped.

## Checks (all must pass before pushing)

```sh
cd engine && cargo fmt --check && cargo clippy --release --all-targets -- -D warnings && cargo test --release && cd ..
npm run typecheck
npm test                         # vitest + node --test (conductor/, tools/)
npm run engine                   # rebuild the wasm before the next two
node tools/render/check.ts --seconds 75
npx vite build --config web/vite.config.ts && node tools/e2e/smoke.ts --seconds 20
```

CI runs the same; a push to `main` deploys the site (Pages) and, if it touches
`conductor/**`, `web/src/data/**`, `web/src/engine/protocol.ts`, `Dockerfile`
or `package.json`, the conductor (Railway waits for CI first).

## State as of Oct 29, 2026

Built and live: planes (adsb.lol), UTA service alerts, the fleet's flow
nudging tempo, a storm on its way (Alta forecast, pressure), temperature
warmth, the grid's swell (EIA, with its key: the day-ahead forecast and the
fuel mix shown), FrontRunner coming home at Central, two river gauges and
four SNOTEL stations, buses and planes on the map, and the air measured at
Utah DEQ's monitors through AirNow (the haze by vantage: the valley's median,
Hawthorne's downtown, the Beach station's at Saltair; AQI, ozone, PM10 and
the forecast shown; an action day earns a sticker). UDOT's roads since Oct
29 (incidents, closures, the canyon stations' wind, the roads' forecast). UAC
is coded and tested, off until its token is set.

### Keys

| Variable | Status |
|---|---|
| `AIRNOW_KEY` | Set on Railway Oct 28. AirNow retired its first services on Sept 30, 2026; `conductor/src/airnow.ts` reads the replacements (`aq/data/`, `aq/observation/current/ziplatlong/`, `aq/forecast/current/`). About thirteen requests an hour of the 500 allowed; AirNow's site query is slow at times, so requests get 45 s and one retry, every 10 min. |
| `EIA_KEY` | Set Oct 28. The demo key allowed 10 requests an hour; the conductor now polls demand every 15 min and the mix every 2 h. |
| `UTA_TOKEN` | None. What was set under this name on Oct 28 was the UDOT key, entered under the wrong name (the owner, Oct 29); delete the variable if it's still on Railway (`/health` `keys.uta` reads `set` while it is). The SIRI code and the `keys:check` probe wait for a real token. |
| `UDOT_KEY` | Set on Railway Oct 29; `/health` reads `ok`. Incidents, closures, the wind at Parleys, Brighton, Cottonwood Summit and Alta, and 14 forecast segments arrived in the first reading; the message signs parsed none. |
| `UAC_TOKEN` | The avalanche center asked the owner for more information first. |

Railway skipped the redeploy it made when the variables were set (watch
paths); the push that carried the Oct 28 work deployed them.

### Next steps, in order

1. `curl https://wasatch-production.up.railway.app/health`: `keys.airnow`
   should read `ok`, `air` should list the monitors' PM2.5 and the forecast,
   `grid` should carry `forecast`, `peak` and `mix`. From an hour's second
   half, `/sky.json` hours carry `pm25`, `pm25Downtown` and `pm25Lake` for
   the next hour, and `/roads.json` `measured.air` turns true.
2. `~/.railway/bin/railway run --service wasatch --environment production -- npm run keys:check`
   (the CLI isn't on PATH in agent shells) prints every monitor, the vantage
   picks, the forecast, EIA's forecast and mix, and the SIRI probe.
3. UTA's SIRI API has no token (see Keys). If the owner gets one, set
   `UTA_TOKEN` (and `UTA_SIRI` if the host moved; api.rideuta.com answered
   the website's 404 page on Oct 28), confirm with the probe, read the real
   XML, then design: `VehicleAtStop` transitions as observed
   departures and arrivals, `Distance` to Central as a countdown for the
   cadence, `ProgressRate` as lateness. Ask the owner before any new sound.
4. UDOT (key set Oct 29): `keys:check` prints each endpoint's fields, the
   minutes on the signs and the canyon roads' forecast. Field names match
   UDOT's documentation (`udottraffic.utah.gov/help/endpoint/<name>`, Oct
   28), and the first live reading named the canyon stations as coded
   (SR-190 @ MP 16 Brighton, SR-210 @ Alta). Still unconfirmed: the highway
   list, the traction-law wording, and the signs' "MINUTES TO" phrasing (the
   first reading parsed no sign with minutes; read the raw `messagesigns`
   rows first). The signs' usual takes three hours of the week to learn
   before they move the flow. Canyon traffic is not built.
5. When UAC's token arrives: `conductor/src/uac.ts` sends the token both as
   `?token=` and a Bearer header because their docs don't say which. Find out
   which works, keep only that one, and read the real JSON to confirm
   `overall_danger_rose` / `date_issued` / `bottom_line`. What the forecast
   *plays* is undecided (DESIGN.md: "a rare, soft, settling sound"); it is
   shown on the board and lowdown only. Ask the owner before adding sound.
6. The hats (Oct 29): the conductor learns the usual buses out per hour
   of a weekday, a Saturday and a Sunday (`usual.json`, beside the speed);
   an hour's `busy` is frozen into the slot after once its hour has been
   seen three times, so the new hats arrive hour by hour over the first
   week (until then the timetable's rate stands in). `/health` `flow.busy`
   shows the last hour's ratio; `/slots.json` shows `busy` per hour. A
   suggested follow-up the owner hasn't decided on: lean the hats toward
   whichever side's buses run slower than their usual (east/west panning by
   the buses' share was ruled out: it sits at 55–58% west all day).
7. Still unbuilt: our own ADS-B receiver (`ADSB_URL`; adsb.lol stands in,
   about 360 reads a day), a recorded FrontRunner horn to replace the
   synthesized one (the owner will supply a file), sampled strings and brass.
   Air that could play but doesn't yet, pending the owner's ear: ozone in
   summer, PM10 dust off the lakebed, the fuel mix in replays.

## Things that bite

- **Determinism.** Whatever `compose()` reads must be identical bytes on every
  phone: sealed 30 s windows from the conductor, or hourly sky slots that are
  frozen and never revised. Only observations steer the plan (`plan.rs`);
  forecasts and models only color bars. Anything new must follow this.
  `conductor/src/slots.ts` freezes the next hour's alerts, models and slow
  values in the last quarter of each hour (`freezeAhead`). `compose_next`
  hands `compose()` a `Valley` whose `slow` is `slow_at(the bar's hour)`;
  anything outside `compose()` that reads slow values (the master, the lake's
  slosh) uses `Slow::overlaid` with the bar's hour, never `inputs.slow` bare.
- **Wire formats grow by tails.** The .wasm is served unhashed beside hashed
  JS, so an old page can meet a new engine for minutes after a deploy. Append
  fields after existing rows (SKY, SLOW, RAIL do); never change a stride.
- Every `Inst` needs its own arm in `engine.rs` `trigger()`; unmatched ones
  play as a crash.
- `Valley` literals: use `Valley::quiet(...)` in tests.
- What the map shows comes from the engine's outbox: `pulse` as a placed
  note sounds, `soon` as it's composed, `voice` for the bass, harp and
  snow. `on_map()` in `engine.rs` decides both `pulse` and `soon`; the
  engine test `the_map_hears_each_placed_note_before_it_sounds` holds them
  together.
- Headless Chrome runs audio from page load; phones wait for the tap. The
  smoke test's phone view suspends the context until the tap so CI starts
  the way a phone does.
- The Railway CLI (5.71) quirks: `volume add` panics (use GraphQL
  `volumeCreate`), `restart` never returns (bound it), `environment edit
  --json` reads stdin.
- Hosted Pages fetches `/slots.json` from the conductor when sealing a day
  (`tools/archive/sky.ts`); if the conductor is down that day's seal goes
  without the frozen fields and phones take them from the live sky.
