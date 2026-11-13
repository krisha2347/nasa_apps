# Methodology

All thresholds are illustrative and need clinical validation.

## 1. Personal baseline
For each metric, mean and SD over the first 14 days. SD is floored per metric (for example 0.15 C for skin
temperature, 8 ms for reaction time) so quiet baselines do not make tiny changes look huge.

## 2. Per-metric scores
- `z_t = clip(direction * (x_t - mean) / SD, -6, 6)`, where direction is +1 if higher is worse (HR, temperature,
  reaction time, CO2) and -1 if lower is worse (HRV, sleep, SpO2, exercise, mood).
- EWMA: `e_t = 0.3 * z_t + 0.7 * e_(t-1)` (recent drift, suppresses single-day noise).
- Leaky CUSUM: `s_t = max(0, 0.97 * s_(t-1) + z_t - 0.75)`; sustained shift when `s_t >= 6`. The leak and the 0.75
  allowance stop healthy noise from accumulating (this removed false alarms in testing).

## 3. Domain scores
- Score = mean of the top two positive EWMA values among the domain's metrics (single value for cabin air).
- **Corroboration:** the immune score is capped at 0.9 unless skin temperature or SpO2 has shifted (EWMA >= 0.8),
  so deconditioning is not read as infection.
- **Sustained shift:** a CUSUM alarm on a domain's drift metrics lifts the score to at least Watch.
- **Attribution:** while the immune domain is Watch or Act now, resting HR, HRV and exercise minutes are excluded
  from the bone, muscle and heart score and a note explains why.
- **Radiation:** daily dose over the last 3 days relative to the baseline median (Watch at 3x, Act now at 6x), plus
  a pace check of cumulative dose against a planned budget.
- Levels: Nominal below 1, Watch from 1 to 3, Act now at 3 and above.

## 4. Readiness
`100 - 6 * sum(min(score_domain, 3))`, floored at 0. A single summary number for the ring; levels drive actions.

## 5. Forecast
Linear fit over the last 7 domain scores. Trend: worsening above +0.12 per day, improving below -0.12, else steady.
If slope exceeds 0.05 per day, ETA to the next level is `(threshold - score) / slope`, shown when within 30 days.

## 6. Recovery goals
For the top drivers, the edge of the personal band on the healthy side: `mean - direction * SD`.

## 7. Earth queue
One message per upward level change per person and domain (reset after 3 calm days). Act now is *urgent*, Watch is
*routine*. Messages created during the simulated blackout (days 74 to 79) are held until day 80. One-way delay is
modelled from 3 to 20 minutes across the mission.

## 8. Check-in triage
Red-flag symptoms (chest pain, fainting, sudden vision change, severe headache, shortness of breath) always give
Act now. Other symptoms, a reaction time more than 2 SD slower than baseline, or a mood of 1 or 2 give Watch.

## 9. Validation in this repo
`tests/` assert that every injected event is detected, quiet windows produce zero flags, infection is not misread as
deconditioning, the forecast produces an ETA for slow drift, and the queue respects the blackout. This validates the
logic on simulated data only; it is not clinical validation.

## 10. Sources of effect directions
NASA Twins Study (Science, 2019); Inspiration4 datasets via NASA OSDR; Scott et al., Nature Machine Intelligence, 2023;
NASA Human Research Program hazard framework.
