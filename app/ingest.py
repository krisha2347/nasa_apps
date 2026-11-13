"""Import real wearable data (CSV) into the same schema the simulator uses."""
import io

import numpy as np
import pandas as pd

from .engine import BASELINE_DAYS, METRICS
from .simulator import N_DAYS

DEFAULTS = dict(rhr=60, hrv=60, sleep_h=7.0, skin_temp=33.4, spo2=97.5, exercise_min=120,
                reaction_ms=265, mood=4.0, co2_ppm=3000, dose_msv=1.8)
ALIASES = {
    "rhr": ["rhr", "resting_hr", "resting_heart_rate", "heart_rate", "hr"],
    "hrv": ["hrv", "rmssd", "hrv_rmssd"],
    "sleep_h": ["sleep_h", "sleep", "sleep_hours", "sleep_duration_h"],
    "skin_temp": ["skin_temp", "skin_temperature", "temp", "temperature"],
    "spo2": ["spo2", "oxygen", "blood_oxygen"],
    "exercise_min": ["exercise_min", "exercise", "active_minutes", "workout_min"],
    "reaction_ms": ["reaction_ms", "reaction", "pvt_ms"],
    "mood": ["mood", "mood_score"],
    "co2_ppm": ["co2_ppm", "co2"],
    "dose_msv": ["dose_msv", "dose", "radiation_msv"],
}


class IngestError(ValueError):
    pass


def from_csv(text: str) -> pd.DataFrame:
    try:
        raw = pd.read_csv(io.StringIO(text))
    except Exception as exc:  # malformed CSV
        raise IngestError(f"Could not read the CSV: {exc}") from exc
    raw.columns = [str(c).strip().lower().replace(" ", "_") for c in raw.columns]
    out, found = {}, []
    for key, names in ALIASES.items():
        col = next((c for c in names if c in raw.columns), None)
        if col is not None:
            out[key] = pd.to_numeric(raw[col], errors="coerce")
            found.append(key)
    if len([k for k in found if k in METRICS]) < 2:
        raise IngestError("Need at least two recognised columns, for example rhr, hrv, sleep_h, skin_temp, spo2.")
    df = pd.DataFrame(out).ffill().bfill()
    if len(df) < BASELINE_DAYS + 1:
        raise IngestError(f"Need at least {BASELINE_DAYS + 1} daily rows (first {BASELINE_DAYS} learn the baseline).")
    df = df.iloc[:N_DAYS].copy()
    for key, val in DEFAULTS.items():
        if key not in df or df[key].isna().all():
            df[key] = val  # absent metric: flat series, so it never raises a flag
    df.insert(0, "day", range(len(df)))
    return df.reset_index(drop=True)
