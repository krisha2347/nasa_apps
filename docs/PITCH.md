# AstroTwin: pitch kit

## One-liner
An offline-first health copilot that learns each astronaut's own baseline, explains every flag, forecasts where a trend is heading, and tells the crew what to do when Earth is out of reach.

## 3-minute demo script (rehearse twice)

**0:00 Problem (20s).** "On a Mars transit Earth is up to about 20 minutes away and sometimes unreachable. Radiation, isolation, altered gravity and a closed cabin change the body slowly, and the astronaut notices first. Today's tools serve the ground. AstroTwin serves the crew."

**0:20 Baseline (15s).** "It learns each person's own normal in 14 days. Grey is learning, teal is normal. Population norms don't hold in space."

**0:35 Press Play to day 50 (15s).** "Cabin CO2 spikes and every Cabin air card goes red."

**0:50 Asha's sleep spiral (30s).** Click Asha around day 66. "No single alarming number, a pattern: sleep, reaction time, mood. The card says why, what to do, and the recovery goal."

**1:20 Early warning (20s).** Click Chen around day 60. "Chen's deconditioning is only Watch, but the forecast says it reaches Act now in about four weeks. We act before it's urgent."

**1:40 Radiation and blackout (20s).** Day 75. "Solar particle event, shelter procedure. The link is down so the priority message is held and sent on day 80."

**2:00 Ben's infection (25s).** Click Ben, day 100. "Temperature, heart rate, HRV and oxygen move together: an infection signature. The system does not blame deconditioning, it says the heart changes are attributed to the immune event."

**2:25 Privacy and offline (15s).** Toggle sharing off, switch the network off in dev tools, reload. "The astronaut decides what Earth sees. It still works offline."

**2:40 Close (20s).** "Explainable, forecasting, offline-first. Simulated data, illustrative protocols. Next: wearables, OSDR calibration, clinical validation with flight surgeons."

## Submission text

**Title:** AstroTwin: an offline-first health copilot for astronauts

**Summary:** AstroTwin learns each astronaut's personal baseline and monitors five spaceflight hazard domains (immune, behavioral health, bone/muscle/heart, cabin air, radiation). Every alert explains why it fired, forecasts where the trend is heading, and gives a recovery goal and action. Priority summaries are queued for Earth with store-and-forward delivery, and the astronaut controls what behavioral detail is shared.

**How we built it:** Python (FastAPI, NumPy, pandas), a YAML rule layer for clinical actions, EWMA and leaky CUSUM drift detection with corroboration and cause attribution, an installable offline PWA, and pytest tests for detection and false alarms.

**NASA data and sources:** NASA OSDR (Inspiration4 processed datasets), NASA Twins Study (Science, 2019), Scott et al. (Nature Machine Intelligence, 2023), NASA Human Research Program hazards. [Add the exact links you used.]

**Limitations:** Simulated data; illustrative thresholds and protocols; not a medical device; needs clinical validation.

**Next:** Wearable integrations, OSDR-calibrated effect sizes, flight-surgeon review, on-device storage.

## Judging map
- Impact: crew autonomy for Earth-independent missions; terrestrial use in remote clinics and polar or maritime work.
- Creativity: personal baselines, corroboration and attribution, forecast with ETA, delay-tolerant Earth link, privacy control.
- Validity: tests on injected events and quiet windows, documented method, limits stated openly.
- Relevance: one-to-one mapping to the hazards in the challenge text (see README).
- Presentation: story above; record the video the morning of day 2.

## Likely questions
- *Is the data real?* Simulated, shaped by published directions of change. The engine accepts real data: import a CSV.
- *Why not a neural network?* Small crews and no labelled space data; explainable statistics are safer and auditable.
- *How do you avoid false alarms?* EWMA persistence, leaky CUSUM, corroboration, attribution, and zero-flag tests on quiet windows.
- *What about privacy?* The astronaut can share levels only; imported data is not persisted.
- *Is it a medical device?* No. Decision support only; every protocol is a placeholder for flight-surgeon-approved procedures.
