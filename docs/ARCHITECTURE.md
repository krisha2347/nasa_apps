# Architecture

## Goals
1. Work for the astronaut when Earth is unreachable (offline-first, on the crew device).
2. Never raise an alert without saying why and what to do (explainable, actionable).
3. Keep clinical content editable by clinicians without touching code (`app/rules.yaml`).
4. Run the same analysis on simulated and real data (one schema, `app/ingest.py`).

## Components

| Component | File | Responsibility |
|---|---|---|
| Simulator | `app/simulator.py` | Generates a 120-day, 4-person mission with injected events (sleep spiral, infection, deconditioning, isolation, CO2 excursion, solar particle event) |
| Ingest | `app/ingest.py` | Maps wearable CSV columns to the schema, validates, fills absent metrics with flat series |
| Engine | `app/engine.py` | Baselines, z-scores, EWMA, CUSUM, domain scoring, corroboration, attribution, forecast, summaries, Earth queue, triage |
| Rules | `app/rules.yaml` | Domain membership, anchors, drift metrics, and the illustrative actions per level |
| Report | `app/report.py` | Markdown report for a flight surgeon |
| API | `app/main.py` | REST endpoints, gzip, static hosting |
| Client | `static/app.js` | Renders everything from one cached bundle; local red-flag screening when offline |
| Service worker | `static/sw.js` | Caches the shell on install; API GETs are network-first with cache fallback |

## Data model (per person, per day)

`day, rhr, hrv, sleep_h, skin_temp, spo2, exercise_min, reaction_ms, mood, co2_ppm, dose_msv`

The engine returns, per day: `readiness`, `overall`, and for each domain `score, level, reasons, drivers, goals,
actions, escalate, attribution, forecast{slope, trend, eta, projected}`.

## Why one bundle?

The client needs every day of every crew member to scrub the timeline. Sending one gzip-compressed bundle makes the
whole app cacheable by a single request, so after one successful load the dashboard works with the server off. Only
actions that need the server (import, report, full triage) degrade, and each degrades with a clear message or a local fallback.

## Offline strategy

- Install: cache `/`, `app.js`, `style.css`, manifest, icon.
- Runtime: static files stale-while-revalidate; `/api/*` GETs network-first, falling back to the last cached response.
- Check-in: server triage when reachable; otherwise local red-flag screening, so a chest-pain report still escalates.

## Privacy

- The astronaut controls whether behavioral details leave the crew device (toggle in Tools); only the level is shared when off.
- Imported CSV data lives in server memory for the session. No database, no third-party calls.
- In a real deployment the engine would run on the crew device and the "server" would be an on-board service.

## Decisions and trade-offs

| Decision | Why | Cost |
|---|---|---|
| Personal baseline over population norms | Small crews, large individual variation, no valid space norms | First 14 days are calibration only |
| EWMA plus leaky CUSUM over a black-box model | Explainable, tunable, testable on 48 hours of work | Less sensitive to complex multivariate patterns |
| Corroboration and attribution rules | Cuts false alarms and wrong explanations | Rules need clinical review |
| Static client, no framework | Zero build step, offline, easy to audit | More manual DOM code |
| Simulated data | No open continuous astronaut data exists | Validity limited; stated openly |

## Extension points
- New signals: add to `METRICS` and a domain in `rules.yaml`.
- New domain: add a block to `rules.yaml` and, if it needs special logic, a method like `_radiation`.
- Real data: replace `generate()` or call `POST /api/import`.
- Persistence: swap the in-memory `_MISSION` dict for a store.
