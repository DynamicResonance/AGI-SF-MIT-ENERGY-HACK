# Midday Surplus → Tokens

How much AI inference fits into the grid's midday net-load dip (the "duck curve"),
on real ISO data, and what it is worth. Plus an **agent loop** in which Claude schedules a
(synthetic) fleet of deferrable agent jobs into that dip, verified by a deterministic simulator.

- **Calculator tab:** pick a US ISO and a day → duck chart, auto-detected dip window, and two headroom layers
  (conservative = curtailed renewables, optimistic = idle peak capacity) → GPU-hours → tokens → $,
  plus price advantage and an annualized figure from a trailing N-day average.
- **Agent loop tab:** Claude proposes a schedule → the Python simulator replays it on the real hourly data and scores it →
  the score breakdown is fed back → repeat (default 8 iterations), compared with a "run immediately" baseline.

Data: [GridStatus.io Hosted API](https://www.gridstatus.io). Dataset choices and caveats: **[NOTES.md](NOTES.md)**.

## Quick start

```bash
cp .env.example .env      # then fill in GRIDSTATUS_API_KEY (and ANTHROPIC_API_KEY for live agent runs)
```

```bash
make up                   # Docker: builds + runs both services → http://localhost:3000
```

Without Docker:

```bash
make install
```

```bash
make dev                  # backend :8000 (FastAPI) + frontend :3000 (Next.js)
```

```bash
make test                 # pytest (data layer, scorer, agent loop) + vitest (calculation module)
```

## Environment variables

| Variable | Service | Required | Purpose |
|---|---|---|---|
| `GRIDSTATUS_API_KEY` | backend | for live data | GridStatus Hosted API key. Without it the app runs on bundled snapshots. |
| `ANTHROPIC_API_KEY` | backend | for live agent runs | Claude API key for the agent-loop proposer. Without it the Agent tab can only replay recorded runs. |
| `PROPOSER_MODEL` | backend | no | Default `claude-opus-5-5`. |
| `PROPOSER_EFFORT` | backend | no | `low`/`medium`/`high`/… Default `medium`. |
| `OFFLINE_MODE` | backend | no | `1` = never call GridStatus; serve snapshots only. |
| `CACHE_DIR` | backend | no | SQLite cache location (default `backend/cache`, `/data/cache` in Docker). |
| `API_TIMEOUT_S` | backend | no | Max seconds per GridStatus call before falling back (default 25). |
| `BACKEND_URL` | frontend | yes (deployed) | Where the Next.js `/api/*` proxy forwards to, e.g. `http://backend.railway.internal:8000`. Read at request time. |

## Reliability on stage

Data is resolved in layers. The footer always shows which layer is in use, the data source and the fetch time.

1. **Live** GridStatus API → stored in a **SQLite cache** per dataset × local day (past days cached forever, today for 10 min).
2. If the API errors, rate-limits (the key allows **30 requests/min**) or takes more than 25 s → **bundled snapshots**
   (`backend/snapshots/*.json`: 365 days ending at each region's default date, all 7 ISOs), shown as *OFFLINE*.
   After a failure the backend skips the live API for 60 s, so the UI never hangs.
3. If the backend itself is unreachable → the browser loads the same snapshots from `frontend/public/snapshots/`.
4. **Force offline** button in the footer for flaky venue Wi-Fi.
5. Agent tab: **Replay recorded run** plays back a real recorded run (`backend/agent_runs/`, copied to `frontend/public/agent_runs/`).

Before going on stage:

```bash
make prewarm              # fill the cache for every region's default day + 365-day history
```

```bash
make record-agent-run     # record real Claude agent runs for CAISO + ERCOT (needs ANTHROPIC_API_KEY)
```

Presenter mode: button top-right or press **P** (Esc exits). It hides controls and enlarges the chart and numbers.

## Deploy to Railway

Two services from this repo, same project:

1. **backend**: New Service → GitHub repo → *Root Directory* `backend` (uses `backend/Dockerfile`).
   Variables: `GRIDSTATUS_API_KEY`, `ANTHROPIC_API_KEY` (optional `PROPOSER_MODEL`, `OFFLINE_MODE`).
   Optional: attach a Volume at `/data` so the cache survives redeploys.
   No public domain is needed; note its private address (`backend.railway.internal`).
2. **frontend**: New Service → same repo → *Root Directory* `frontend` (uses `frontend/Dockerfile`).
   Variable: `BACKEND_URL=http://backend.railway.internal:${{backend.PORT}}` (or the backend's public URL).
   Generate a public domain for this service. That is the demo URL.

Both Dockerfiles honor Railway's `$PORT`. The browser only talks to the frontend; `/api/*` is proxied server-side
(streaming, so the agent loop's live log works through it).

## Layout

```
backend/
  app/regions.py        ISO → verified GridStatus dataset IDs, hubs, default demo days
  app/data.py           fetch → hourly local-time normalization → SQLite cache → snapshot fallback
  app/main.py           FastAPI: /api/regions, /api/history, /api/day, /api/agent/{status,run,cached}
  app/agent/            synthetic jobs, Claude proposer, deterministic simulator/scorer, loop
  snapshots/            bundled offline data (365 days × 7 ISOs)
  tests/                pytest: data layer, scorer (hand-checked), loop
frontend/
  lib/assumptions.ts    ALL default assumptions, each with source/rationale
  lib/calc.ts           pure calculation module (+ calc.test.ts, hand-checked example)
  components/           GridMap, DuckChart, BigNumbers, AssumptionsDrawer, HowWeCalculate, AgentLoop
  lib/us-map.json       state paths + approximate ISO footprints (scripts/build-us-map.mjs, from us-atlas)
  app/api/[...path]     streaming proxy to the backend
scripts/                dataset discovery, default-day selection, snapshots, prewarm, record agent runs
```
