# The conductor

Live at **https://wasatch-production.up.railway.app** (`/health` says what
it's doing), and the site uses it through `web/public/config.json`.

The site plays without it: every phone reads the valley's open feeds itself
and the schedule from the site. The conductor is what makes every phone hear
exactly the same thing, and what the browser can't do on its own:

- **TRAX and FrontRunner, live.** UTA's realtime sends no CORS headers, so
  only a server can read it. The conductor follows every rail trip's
  predictions and settles a departure when its stop drops out of the feed:
  at its last current prediction, or, for a stop the feed keeps listing
  after the train has passed, at its schedule plus the trip's delay now.
  The bells ring when the trains actually leave, a late train lays back
  behind the beat (1 ms for every 3 s late), the kit lays back with the
  system, and captions say "Red Line · Ballpark · 2 min late". Trains the
  feed doesn't track keep their schedule, marked as such.
- **One connection to the seismometers.** EarthScope allows five per
  address; a party of phones on one Wi-Fi would run out. The conductor
  holds one and mixes all four stations down for everyone.
- **A sky that's complete.** KSLC's hourly METARs from the Aviation Weather
  Center (which a browser can't read), where the NWS feed has gaps.
- **Sealed windows.** Thirty seconds each, sealed a minute after they open,
  at immutable URLs a phone computes from its clock: the same bytes for
  every phone, so the same notes.
- **The fleet, live.** UTA's vehicle positions every 15 seconds: each
  train where it is (one per trip, however many cars report), and how many
  trains and buses are out, counted by trip. Phones draw the trains there
  and say the counts are live; a position over two minutes old is left out.
- **UTA's service alerts.** Read every minute; a new headline (however
  many routes and directions it's filed for) goes into the windows, and
  each window carries how many stand, by kind, as it sealed.
- **Planes.** adsb.lol's open feed (ODbL) every four minutes, or a
  receiver of our own every five seconds once `ADSB_URL` is set. A plane
  climbing out of SLC or coming down to it is queued and released into the
  windows one every 20 s, placed where it got to, named only if it's an
  airline's. `/planes.json` is what's in the air, for the map.
- **FrontRunner due at Central.** Each window carries the next predicted
  departure from Salt Lake Central as it sealed.
- **Frozen hours.** What only the conductor knows of an hour is worked out
  once and never revised, kept on disk (`DATA_DIR/slots.json`), served in
  `/sky.json` and `/slots.json`, and copied by the archive into each sealed
  day: the fleet's flow (its moving speed against the usual for the hour,
  learned in `DATA_DIR/usual.json`, with the trains' lateness), the snow
  forecast at Alta (NWS's grid), and with their keys the wind measured up
  the canyons and the PM2.5 measured at the monitors (each read in an
  hour's second half and frozen for the next). The air is frozen three
  ways: the valley's median, Hawthorne's for downtown and the Beach
  station's for Saltair, so each vantage hears the haze where it stands.
- **The grid.** PacifiCorp East's demand from EIA, hourly, against the same
  hour the week before, in `/slow.json`; with it the day-ahead forecast
  (demand against it, and the peak ahead) and what the power was made from,
  by source, which PacifiCorp East reports a day behind. Only the demand
  plays; the rest is for the board and the lowdown.
- **Keyed sources, off until their keys are set.** UDOT (incidents on the
  valley's highways, avalanche control, traction law, plows, the canyons'
  weather stations; about two calls a minute of the ten allowed), AirNow
  (every monitor in the valley's box with its raw PM2.5, PM10, ozone, NO₂,
  CO and SO₂, the reporting area's AQI by pollutant and the forecast with
  its action days, about nine requests an hour of the 500 a key is allowed;
  preliminary data, shown as such and credited to Utah DEQ and EPA AirNow)
  and the Utah Avalanche Center (the day's danger, read every 15 minutes
  from 5 to 8 AM as the center asks). UTA's SIRI token (`UTA_TOKEN`) is
  probed by `keys:check` and plays nothing until its service answers.
- **A clock.** An uncached `/time`, read eight times, keeping the fastest
  round trip.

```
GET /time            {"t": UTC ms}, never cached
GET /w/<start>.json  a sealed window: rail (and FrontRunner's due time), bikes,
                     quakes, the ground's baseband, planes, service alerts, roads
GET /sky.json        the sky's hours, by the phones' slot rules, with the frozen hours
GET /slots.json      the frozen hours since ?from= (UTC ms), for the archive
GET /slow.json       the lake, the rivers, the snow, the grid
GET /vehicles.json   every train and bus where it is, and how many are out
GET /planes.json     the planes in the air near SLC
GET /alerts.json     UTA's service alerts in effect, by headline
GET /roads.json      the keyed sources: UDOT's roads, AirNow's monitors and forecast, the avalanche forecast
GET /health          what it's doing
```

`/health` says how long it's been up, the commit it was built from, its
sealed windows and whether they're kept on disk, what realtime it's
tracking, the fleet's counts and age, the hour's flow, the alerts and
planes it's seen, the grid, each key's state (`missing`, `set`, `ok` or
`error`), each seismometer's level, and any feed that's failing.

## Keys

Each keyed source is off until its variable is set on the service, which
redeploys it:

```sh
railway variable set UDOT_KEY=… --service wasatch --environment production
```

`UDOT_KEY` (udottraffic.utah.gov, Developers), `AIRNOW_KEY`
(docs.airnowapi.org), `UAC_TOKEN` (utahavalanchecenter.org/api-access),
`EIA_KEY` (eia.gov/opendata; EIA's shared demo key until then, which allows
ten requests an hour), `UTA_TOKEN` (UTA's SIRI developer token, with
`UTA_SIRI` naming its host if UTA moves it from api.rideuta.com, where it
stopped answering by Oct 2026), and `ADSB_URL` (a readsb receiver's
`aircraft.json`). To see what each reads
with the service's keys, without printing them:

```sh
railway run --service wasatch --environment production -- npm run keys:check
```

## Run it

```sh
npm ci
PORT=8787 node conductor/src/server.ts
```

and open the site with `?conductor=http://localhost:8787`. It has no
dependencies of its own: Node 24 runs the TypeScript directly, and it shares
the page's feed, ground and schedule code.

Environment: `PORT` (8080), `SCHEDULE` (where the compiled schedule is
served; default `https://ampactor.dev/wasatch/schedule`), `DATA_DIR` (keep
sealed windows and frozen hours on disk across restarts; `/data` on
Railway), and the keys above.

## Deploy it (Railway)

The repository's `Dockerfile` is the conductor's image: Node 24, the
conductor's sources and the page code it shares, no build step. Railway
builds it on its own (the site itself is GitHub Pages and is never built
there).

The service deploys from GitHub: a push to `main` that touches what the
conductor runs (`conductor/**`, `web/src/data/**`,
`web/src/engine/protocol.ts`, `Dockerfile`, `package.json`, its watch
patterns) rebuilds and redeploys it; any other push leaves it alone. To
ship local changes without pushing, from the repository's root with the
project linked:

```sh
railway up --ci -m "what changed"
```

The service's health check is `/health`. Phones read the conductor named in
`web/public/config.json` (or `?conductor=<url>` for a test); whenever it
can't be reached they read the feeds themselves, and a span no window covers
plays from the schedule.

Sealed windows are kept on a Railway volume mounted at `/data`
(`DATA_DIR=/data`), so a restart or a redeploy picks the three-hour store up
where it left off. Each window is written beside its file and renamed, so
one on disk is whole or absent, and anything that doesn't read back is left
out. If the disk ever fails the conductor keeps going in memory and says so
in `/health` (`"kept": "in memory"`). Railway mounts the volume owned by
root, so the conductor starts as root only to hand `DATA_DIR` to the `node`
user, and drops root before it opens a port.
