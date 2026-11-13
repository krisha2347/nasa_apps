"""Personal-baseline drift engine.

Each astronaut is compared with their OWN first 14 days, not population norms.
Per metric : z-score in the "bad" direction -> EWMA (recent drift) + leaky CUSUM (sustained shift).
Per domain : mean of the top-2 EWMA scores, with corroboration and cause-attribution rules.
Forecast   : 7-day linear trend of each domain score -> projected time to the next level.
Thresholds are illustrative and need clinical validation (see docs/METHODOLOGY.md).
"""
from pathlib import Path
import numpy as np
import yaml

from .simulator import CREW, N_DAYS, generate

BASELINE_DAYS = 14
ALPHA, CUSUM_K, CUSUM_H, CUSUM_LEAK, Z_CLIP = 0.3, 0.75, 6.0, 0.97, 6.0
AMBER, RED = 1.0, 3.0
MISSION_DOSE_BUDGET = 240.0  # mSv, illustrative planned budget for this scenario
BLACKOUT = (74, 79)          # simulated comm blackout (inclusive)
EXPLAIN_AWAY = ("rhr", "hrv", "exercise_min")  # attributed to an active immune event (illness lowers activity)

METRICS = {
    "rhr": dict(label="Resting heart rate", unit="bpm", bad=+1, min_std=1.5),
    "hrv": dict(label="HRV", unit="ms", bad=-1, min_std=4.0),
    "sleep_h": dict(label="Sleep", unit="h", bad=-1, min_std=0.3),
    "skin_temp": dict(label="Skin temperature", unit="°C", bad=+1, min_std=0.15),
    "spo2": dict(label="Blood oxygen", unit="%", bad=-1, min_std=0.4),
    "exercise_min": dict(label="Exercise", unit="min", bad=-1, min_std=8.0),
    "reaction_ms": dict(label="Reaction time", unit="ms", bad=+1, min_std=8.0),
    "mood": dict(label="Mood", unit="/5", bad=-1, min_std=0.2),
    "co2_ppm": dict(label="Cabin CO2", unit="ppm", bad=+1, min_std=150.0),
}
RULES = yaml.safe_load((Path(__file__).parent / "rules.yaml").read_text())["domains"]
RANK = {"green": 0, "amber": 1, "red": 2}


def level_of(score: float) -> str:
    return "red" if score >= RED else "amber" if score >= AMBER else "green"


def link_delay_min(day: int) -> int:
    return round(3 + 17 * day / (N_DAYS - 1))


class MemberEngine:
    def __init__(self, df):
        self.df = df.reset_index(drop=True)
        self.n = len(self.df)
        base = self.df.iloc[:BASELINE_DAYS]
        self.mean, self.std = {}, {}
        self.z, self.ewma, self.cusum = {}, {}, {}
        for m, spec in METRICS.items():
            self.mean[m] = float(base[m].mean())
            self.std[m] = max(float(base[m].std(ddof=1)), spec["min_std"])
            z = np.clip(spec["bad"] * (self.df[m].to_numpy() - self.mean[m]) / self.std[m], -Z_CLIP, Z_CLIP)
            ew, cu = np.zeros(len(z)), np.zeros(len(z))
            for i, v in enumerate(z):
                ew[i] = ALPHA * v + (1 - ALPHA) * (ew[i - 1] if i else 0.0)
                cu[i] = max(0.0, (cu[i - 1] if i else 0.0) * CUSUM_LEAK + v - CUSUM_K)
            self.z[m], self.ewma[m], self.cusum[m] = z, ew, cu
        self.dose_median = float(base["dose_msv"].median())
        self.cum_dose = self.df["dose_msv"].cumsum().to_numpy()
        self._dom, self._status = {}, {}

    # ---- helpers -------------------------------------------------------
    def _days_off(self, m, d):
        n = 0
        while d - n >= 0 and self.z[m][d - n] > 1.0:
            n += 1
        return n

    def _driver(self, m, d):
        spec, v = METRICS[m], float(self.df[m].iloc[d])
        delta = v - self.mean[m]
        edge = self.mean[m] - spec["bad"] * self.std[m]  # edge of the personal band on the healthy side
        goal = f'back {"above" if spec["bad"] < 0 else "below"} {edge:.1f}{spec["unit"]}'
        return dict(metric=m, label=spec["label"], unit=spec["unit"], value=round(v, 1),
                    baseline=round(self.mean[m], 1), delta=round(delta, 1),
                    score=round(float(self.ewma[m][d]), 2), days_off=self._days_off(m, d),
                    sustained=bool(self.cusum[m][d] >= CUSUM_H), goal=goal)

    def _fmt(self, x):
        way = "above" if x["delta"] > 0 else "below"
        txt = f'{x["label"]} {x["value"]}{x["unit"]}, {abs(x["delta"])}{x["unit"]} {way} your baseline'
        if x["days_off"] >= 2:
            txt += f' ({x["days_off"]} days off-baseline)'
        if x["sustained"]:
            txt += " - sustained shift"
        return txt

    def _pack(self, rule, score, lvl, reasons, drivers, attribution=()):
        return dict(label=rule["label"], score=round(score, 2), level=lvl, reasons=reasons,
                    drivers=drivers, goals=[x["goal"] for x in drivers[:2]] if lvl != "green" else [],
                    actions=rule["actions"].get(lvl, []), escalate=lvl == "red",
                    attribution=list(attribution))

    def _domain(self, key, d, exclude=()):
        rule = RULES[key]
        if key == "radiation":
            return self._radiation(rule, d)
        ms = [m for m in rule["metrics"] if m not in exclude]
        dm = [m for m in rule["drift_metrics"] if m not in exclude]
        scores = sorted((max(float(self.ewma[m][d]), 0.0) for m in ms), reverse=True) or [0.0]
        score = float(np.mean(scores[:2])) if len(ms) > 1 else scores[0]
        anchors = rule.get("anchor_metrics")
        if anchors and max(float(self.ewma[m][d]) for m in anchors) < 0.8:
            score = min(score, 0.9)  # no corroborating temperature/SpO2 shift
        if any(self.cusum[m][d] >= CUSUM_H for m in dm) and score < AMBER:
            score = AMBER
        lvl = level_of(score)
        drivers = sorted((self._driver(m, d) for m in ms), key=lambda x: -x["score"])
        drivers = [x for x in drivers if x["score"] >= 0.5][:3]
        attribution = []
        if exclude and any(self.ewma[m][d] >= 1.0 for m in exclude):
            attribution.append("Heart rate, HRV and exercise changes are attributed to the active immune event, "
                               "so they are not counted as deconditioning.")
        return self._pack(rule, score, lvl, [self._fmt(x) for x in drivers], drivers, attribution)

    def _radiation(self, rule, d):
        recent = self.df["dose_msv"].iloc[max(0, d - 2): d + 1].to_numpy() / self.dose_median
        ratio = float(recent.max())
        pace = float(self.cum_dose[d] / (MISSION_DOSE_BUDGET * (d + 1) / N_DAYS))
        score = 3.5 if ratio >= 6 else 1.5 if ratio >= 3 else 1.2 if pace > 1.25 else 0.0
        today = float(self.df["dose_msv"].iloc[d])
        txt = [f"Dose {today:.1f} mSv today, usual {self.dose_median:.1f} (peak x{ratio:.1f} in last 3 days)",
               f"Cumulative {self.cum_dose[d]:.0f} of {MISSION_DOSE_BUDGET:.0f} mSv planned budget"]
        out = self._pack(rule, score, level_of(score), txt if score else [], [])
        out["cum_dose"], out["budget"] = round(float(self.cum_dose[d]), 1), MISSION_DOSE_BUDGET
        return out

    def _compute(self, d):
        if d in self._dom:
            return self._dom[d]
        doms = {"immune": self._domain("immune", d)}
        immune_active = doms["immune"]["level"] != "green"  # non-green implies a temp/SpO2 anchor shift
        for k in RULES:
            if k != "immune":
                doms[k] = self._domain(k, d, EXPLAIN_AWAY if (k == "gravity" and immune_active) else ())
        self._dom[d] = doms
        return doms

    def _forecast(self, key, d):
        if key == "radiation":
            return None
        ys = np.clip([self._compute(x)[key]["score"] if x >= BASELINE_DAYS else 0.0
                      for x in range(max(0, d - 6), d + 1)], 0, 6)
        slope = float(np.polyfit(range(len(ys)), ys, 1)[0]) if len(ys) >= 3 else 0.0
        cur = float(ys[-1])
        trend = "worsening" if slope > 0.12 else "improving" if slope < -0.12 else "steady"
        eta = None
        if slope > 0.05:
            target = AMBER if cur < AMBER else RED if cur < RED else None
            if target is not None and (target - cur) / slope <= 30:
                eta = dict(level=level_of(target), days=int(np.ceil((target - cur) / slope)))
        return dict(slope=round(slope, 2), trend=trend, eta=eta,
                    projected=round(float(min(6, max(0, cur + slope * 7))), 2))

    # ---- public --------------------------------------------------------
    def status(self, d: int) -> dict:
        beyond = d >= self.n
        d = int(min(max(d, 0), self.n - 1))
        if d not in self._status:
            if d < BASELINE_DAYS:
                doms = {k: dict(label=RULES[k]["label"], score=0, level="green", reasons=[], drivers=[],
                                goals=[], actions=[], escalate=False, attribution=[], forecast=None)
                        for k in RULES}
                res = dict(day=d, calibrating=True, readiness=None, overall="green", domains=doms)
            else:
                doms = {k: dict(v, forecast=self._forecast(k, d)) for k, v in self._compute(d).items()}
                readiness = int(round(max(0, 100 - 6 * sum(min(v["score"], 3.0) for v in doms.values()))))
                overall = max((v["level"] for v in doms.values()), key=lambda x: RANK[x])
                res = dict(day=d, calibrating=False, readiness=readiness, overall=overall, domains=doms)
            res["vitals"] = {m: float(self.df[m].iloc[d]) for m in METRICS}
            self._status[d] = res
        return dict(self._status[d], beyond_data=beyond)


_MISSION = {k: MemberEngine(v) for k, v in generate().items()}
_PEOPLE = {p["id"]: dict(p) for p in CREW}
_BUNDLE = None


def crew_list() -> list:
    return list(_PEOPLE.values())


def member(cid: str) -> MemberEngine:
    return _MISSION[cid]


def add_custom_member(name: str, df) -> dict:
    global _BUNDLE
    _MISSION["you"] = MemberEngine(df)
    _PEOPLE["you"] = dict(id="you", name=name or "You", role="Imported data", custom=True)
    _BUNDLE = None
    return _PEOPLE["you"]


def summary(day: int) -> dict:
    rows = []
    for cid, eng in _MISSION.items():
        if day >= eng.n:
            continue
        st = eng.status(day)
        p = _PEOPLE[cid]
        row = dict(id=cid, name=p["name"], role=p["role"], calibrating=st["calibrating"],
                   overall=st["overall"], readiness=st["readiness"], worst=None, trend=None, eta=None)
        if not st["calibrating"]:
            k, v = max(st["domains"].items(), key=lambda kv: kv[1]["score"])
            row["worst"] = dict(key=k, label=v["label"], level=v["level"], score=v["score"])
            etas = [(x["forecast"]["eta"]["days"], x["label"], x["forecast"]["eta"]["level"])
                    for x in st["domains"].values() if x["forecast"] and x["forecast"]["eta"]]
            if etas:
                days, label, lvl = min(etas)
                row["eta"] = dict(days=days, label=label, level=lvl)
            fs = [x["forecast"]["trend"] for x in st["domains"].values() if x["forecast"]]
            row["trend"] = "worsening" if "worsening" in fs else "improving" if "improving" in fs else "steady"
        rows.append(row)
    live = [r for r in rows if not r["calibrating"]]
    strain = float(np.mean([_MISSION[r["id"]].status(day)["domains"]["behavioral"]["score"] for r in live])) if live else 0.0
    return dict(day=day, mean_readiness=int(round(np.mean([r["readiness"] for r in live]))) if live else None,
                team_strain=dict(score=round(strain, 2), label="High" if strain >= 2 else "Moderate" if strain >= 1 else "Low"),
                counts={lv: sum(r["overall"] == lv for r in live) for lv in ("green", "amber", "red")},
                attention=sorted(rows, key=lambda r: (-RANK[r["overall"]], r["readiness"] if r["readiness"] is not None else 101)))


def earth_queue(upto: int = N_DAYS - 1) -> list:
    """Store-and-forward messages: one per upward level change, held during blackout."""
    msgs = []
    for cid, eng in _MISSION.items():
        high, calm = {k: 0 for k in RULES}, {k: 0 for k in RULES}
        for d in range(BASELINE_DAYS, min(upto, eng.n - 1) + 1):
            for k, v in eng.status(d)["domains"].items():
                r = RANK[v["level"]]
                calm[k] = calm[k] + 1 if r == 0 else 0
                if calm[k] >= 3:
                    high[k] = 0
                if r > high[k]:
                    high[k] = r
                    held = BLACKOUT[0] <= d <= BLACKOUT[1]
                    msgs.append(dict(day=d, crew_id=cid, name=_PEOPLE[cid]["name"], domain=v["label"], domain_key=k,
                                     level=v["level"], priority="urgent" if r == 2 else "routine",
                                     summary=(v["reasons"] or [""])[0],
                                     delivered_day=BLACKOUT[1] + 1 if held else d,
                                     size_bytes=180 + 40 * len(v["reasons"])))
    return sorted(msgs, key=lambda m: (m["day"], m["crew_id"]))


def meta() -> dict:
    return dict(days=N_DAYS, baseline_days=BASELINE_DAYS, crew=crew_list(), blackout=BLACKOUT,
                link_delay=[link_delay_min(d) for d in range(N_DAYS)],
                metrics={k: dict(label=v["label"], unit=v["unit"]) for k, v in METRICS.items()},
                domains={k: v["label"] for k, v in RULES.items()})


def series(cid: str) -> dict:
    eng = _MISSION[cid]
    return {m: dict(values=eng.df[m].tolist(), baseline=eng.mean[m], band=eng.std[m]) for m in METRICS}


def bundle() -> dict:
    """Everything the offline-first client needs, in one cacheable payload."""
    global _BUNDLE
    if _BUNDLE is None:
        _BUNDLE = dict(meta=meta(),
                       crew={cid: dict(n=e.n, statuses=[e.status(d) for d in range(e.n)], series=series(cid))
                             for cid, e in _MISSION.items()},
                       queue=earth_queue(), summaries=[summary(d) for d in range(N_DAYS)])
    return _BUNDLE


RED_FLAGS = {"chest_pain": "Chest pain", "fainting": "Fainting or near-fainting",
             "vision_change": "Sudden vision change", "severe_headache": "Severe headache",
             "breathless": "Shortness of breath"}
WATCH = {"fever": "Fever or chills", "cough": "Cough", "nausea": "Nausea", "headache": "Headache",
         "dizzy": "Dizziness", "muscle_pain": "Muscle or joint pain", "low_mood": "Low mood or anxiety"}


def triage(cid: str, symptoms: list, reaction_ms=None, mood=None) -> dict:
    eng, notes, level = member(cid), [], "green"
    red = [RED_FLAGS[s] for s in symptoms if s in RED_FLAGS]
    watch = [WATCH[s] for s in symptoms if s in WATCH]
    if red:
        level = "red"
        notes.append("Red-flag symptom reported: " + ", ".join(red))
    elif watch:
        level = "amber"
        notes.append("Symptoms to monitor: " + ", ".join(watch))
    if reaction_ms:
        z = (float(reaction_ms) - eng.mean["reaction_ms"]) / eng.std["reaction_ms"]
        if z > 2:
            level = max(level, "amber", key=lambda x: RANK[x])
            notes.append(f"Reaction time {reaction_ms:.0f} ms is {z:.1f} SD slower than your baseline")
    if mood and int(mood) <= 2:
        level = max(level, "amber", key=lambda x: RANK[x])
        notes.append("Low mood score reported")
    actions = {"red": ["Stop current activity and notify the crew medical officer now.",
                       "Send a priority message to the flight surgeon."],
               "amber": ["Re-check in 4 hours, rest, hydrate, and log how you feel.",
                         "If symptoms persist or worsen, notify the crew medical officer."],
               "green": ["No flags. Keep your routine."]}[level]
    return dict(level=level, notes=notes or ["No flags from this check-in."], actions=actions,
                disclaimer="Decision support only. Not a diagnosis.")
