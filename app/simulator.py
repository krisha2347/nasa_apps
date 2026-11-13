"""Synthetic 120-day Mars-transit mission for a 4-person crew.

ILLUSTRATIVE DATA ONLY: directions of change follow published spaceflight physiology
(sleep loss, HRV drop, exercise decline, radiation events), magnitudes are invented for
demonstration. Replace `generate()` with real wearable data to reuse the engine.
"""
import numpy as np
import pandas as pd

N_DAYS = 120
CREW = [
    {"id": "asha", "name": "Asha", "role": "Commander"},
    {"id": "ben", "name": "Ben", "role": "Flight engineer"},
    {"id": "chen", "name": "Chen", "role": "Medical officer"},
    {"id": "dara", "name": "Dara", "role": "Pilot"},
]


def _pulse(d, start, end, rise=0.3, fall=0.25):
    """0 -> 1 ramp, plateau, ramp back to 0 (an episode that resolves)."""
    t = (d - start) / (end - start)
    out = np.where(t < rise, t / rise, np.where(t > 1 - fall, (1 - t) / fall, 1.0))
    return np.where((t < 0) | (t > 1), 0.0, np.clip(out, 0, 1))


def _lin(d, start, end):
    """0 -> 1 linear drift that does not recover (a chronic trend)."""
    return np.clip((d - start) / (end - start), 0, 1)


def generate(seed: int = 7) -> dict:
    rng = np.random.default_rng(seed)
    d = np.arange(N_DAYS)

    cabin_co2 = 3000 + rng.normal(0, 110, N_DAYS) + 2500 * _pulse(d, 48, 54)
    dose = 1.8 + rng.normal(0, 0.12, N_DAYS)  # mSv/day, deep-space cruise order of magnitude
    dose[74] += 14.0  # solar particle event
    dose[75] += 6.0

    out = {}
    for person in CREW:
        b = dict(rhr=rng.normal(61, 3), hrv=rng.normal(62, 6), sleep=rng.normal(7.0, 0.2),
                 skin=rng.normal(33.4, 0.2), spo2=rng.normal(97.6, 0.3), ex=rng.normal(125, 10),
                 rt=rng.normal(265, 12), mood=rng.normal(4.0, 0.2))
        rhr = b["rhr"] + rng.normal(0, 1.5, N_DAYS)
        hrv = b["hrv"] + rng.normal(0, 4, N_DAYS)
        sleep = b["sleep"] + rng.normal(0, 0.3, N_DAYS)
        skin = b["skin"] + rng.normal(0, 0.15, N_DAYS)
        spo2 = b["spo2"] + rng.normal(0, 0.4, N_DAYS)
        ex = b["ex"] + rng.normal(0, 8, N_DAYS)
        rt = b["rt"] + rng.normal(0, 8, N_DAYS)
        mood = b["mood"] + rng.normal(0, 0.2, N_DAYS)

        if person["id"] == "asha":  # sleep-debt spiral
            e = _pulse(d, 58, 88)
            sleep -= 1.4 * e; rt += 30 * e; mood -= 1.0 * e; hrv -= 8 * e; rhr += 3 * e
        elif person["id"] == "ben":  # early infection signature
            e = _pulse(d, 94, 108)
            skin += 0.9 * e; rhr += 9 * e; hrv -= 20 * e; spo2 -= 1.3 * e; sleep -= 0.6 * e
            ex = ex * (1 - 0.3 * e)
        elif person["id"] == "chen":  # exercise decline and cardio deconditioning
            e = _lin(d, 35, 115)
            ex = ex * (1 - 0.35 * e); rhr += 3.0 * e; hrv -= 8 * e
        elif person["id"] == "dara":  # isolation: slow mood and sleep erosion
            e = _lin(d, 65, 119)
            mood -= 1.1 * e; sleep -= 0.6 * e; ex = ex * (1 - 0.2 * e)

        out[person["id"]] = pd.DataFrame({
            "day": d,
            "rhr": rhr.round(1), "hrv": hrv.round(1), "sleep_h": sleep.round(2),
            "skin_temp": skin.round(2), "spo2": np.clip(spo2, 80, 100).round(1),
            "exercise_min": np.clip(ex, 0, None).round(0), "reaction_ms": rt.round(0),
            "mood": np.clip(mood, 1, 5).round(2),
            "co2_ppm": (cabin_co2 + rng.normal(0, 60, N_DAYS)).round(0),
            "dose_msv": (dose * (1 + rng.normal(0, 0.03, N_DAYS))).round(2),
        })
    return out
