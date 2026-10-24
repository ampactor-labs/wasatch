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
- **A clock.** An uncached `/time`, read eight times, keeping the fastest
  round trip.

```
GET /time            {"t": UTC ms}, never cached
GET /w/<start>.json  a sealed window: rail, bikes, quakes, the ground's baseband
GET /sky.json        the sky's hours, by the phones' slot rules
GET /slow.json       the lake, the river, the snow
GET /health          what it's doing
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
sealed windows on disk across restarts).

## Deploy it (Railway)

The repository's `Dockerfile` is the conductor's image: Node 24, the
conductor's sources and the page code it shares, no build step. Railway
builds it on its own (the site itself is GitHub Pages and is never built
there). From the repository's root, with the project linked:

```sh
railway up --ci -m "what changed"
```

The service's health check is `/health`. Phones read the conductor named in
`web/public/config.json` (or `?conductor=<url>` for a test); whenever it
can't be reached they read the feeds themselves, and a span no window covers
plays from the schedule. Sealed windows live in memory, so a restart starts
the three-hour store over; set `DATA_DIR` to a volume to keep them.
