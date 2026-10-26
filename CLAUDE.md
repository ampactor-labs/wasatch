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

## State as of Oct 25, 2026

Built and live: planes (adsb.lol), UTA service alerts, the fleet's flow
nudging tempo, a storm on its way (Alta forecast, pressure), temperature
warmth, the grid's swell (EIA), FrontRunner coming home at Central, two river
gauges and four SNOTEL stations, buses and planes on the map, and the keyed
sources UDOT / AirNow / UAC (code and tests done, off until their keys are
set).

### Keys

| Variable | Status |
|---|---|
| `AIRNOW_KEY` | Owner has the key. Check `/health` → `keys.airnow`; if `missing`, the owner hasn't set it on Railway yet. |
| `EIA_KEY` | Owner has the key (`/health` → `keys.eia` is `demo key` until it's set). |
| `UDOT_KEY` | Awaiting UDOT's approval. |
| `UAC_TOKEN` | Awaiting the avalanche center's approval. |

The owner was handling Railway admin before continuing.

### Next steps, in order

1. `curl https://wasatch-production.up.railway.app/health` and read `keys`,
   `errors`, `commit`. Confirm the commit matches `git log -1` on `main`.
2. For each key that shows `set`: run
   `~/.railway/bin/railway run --service wasatch --environment production -- npm run keys:check`
   (the CLI isn't on PATH in agent shells). Compare what it parsed with the
   fixtures in `conductor/src/keyed.test.ts`; fix the parser if the real
   shape differs, add the real shape as a fixture, push, and watch the deploy.
   - **AirNow:** check `pm25` appears in `/sky.json` hours (frozen in an
     hour's second half for the next) and the Air card says "measured".
   - **EIA:** `/slow.json` `grid` should stop saying the demo key.
3. When UDOT's key arrives: `keys:check` prints each endpoint's fields. UDOT's
   field names are matched case-insensitively in `conductor/src/udot.ts`; the
   highway list, canyon names (SR-210, SR-190) and the traction-law wording
   were written from the documented schema and need checking against live
   data. Travel times on message signs and canyon traffic are not built; look
   at the real API first.
4. When UAC's token arrives: `conductor/src/uac.ts` sends the token both as
   `?token=` and a Bearer header because their docs don't say which. Find out
   which works, keep only that one, and read the real JSON to confirm
   `overall_danger_rose` / `date_issued` / `bottom_line`. What the forecast
   *plays* is undecided (DESIGN.md: "a rare, soft, settling sound"); it is
   shown on the board and lowdown only. Ask the owner before adding sound.
5. Still unbuilt: our own ADS-B receiver (`ADSB_URL`; adsb.lol stands in,
   about 360 reads a day), a recorded FrontRunner horn to replace the
   synthesized one (the owner will supply a file), sampled strings and brass.

## Things that bite

- **Determinism.** Whatever `compose()` reads must be identical bytes on every
  phone: sealed 30 s windows from the conductor, or hourly sky slots that are
  frozen and never revised. Only observations steer the plan (`plan.rs`);
  forecasts and models only color bars. Anything new must follow this.
- **Wire formats grow by tails.** The .wasm is served unhashed beside hashed
  JS, so an old page can meet a new engine for minutes after a deploy. Append
  fields after existing rows (SKY, SLOW, RAIL do); never change a stride.
- Every `Inst` needs its own arm in `engine.rs` `trigger()`; unmatched ones
  play as a crash.
- `Valley` literals: use `Valley::quiet(...)` in tests.
- The Railway CLI (5.71) quirks: `volume add` panics (use GraphQL
  `volumeCreate`), `restart` never returns (bound it), `environment edit
  --json` reads stdin.
- Hosted Pages fetches `/slots.json` from the conductor when sealing a day
  (`tools/archive/sky.ts`); if the conductor is down that day's seal goes
  without the frozen fields and phones take them from the live sky.
