"""Conversational triage: guided yes/no symptom questions, one blood-pressure reading, then instructions.

Content lives in ``static/triage.json`` so the server and the offline client show the same words.
Reading thresholds are reused from ``static/guides.json``, the same numbers the measure guides use,
so a value is never called normal in one place and raised in another.
"""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).parent.parent
FLOW = json.loads((ROOT / "static" / "triage.json").read_text(encoding="utf-8"))
GUIDES = json.loads((ROOT / "static" / "guides.json").read_text(encoding="utf-8"))
RANK = {"green": 0, "amber": 1, "red": 2}
ANSWERS = ("yes", "no", "unsure")

_MEAS = {m["id"]: m for m in GUIDES["measurements"]}
_BP = _MEAS["blood_pressure"]
READINGS = {
    "sys": (next(f for f in _BP["fields"] if f["id"] == "sys"), _BP),
    "dia": (next(f for f in _BP["fields"] if f["id"] == "dia"), _BP),
    "pulse": (_MEAS["heart_rate"]["fields"][0], _MEAS["heart_rate"]),
}


def _worst(level: str, other: str) -> str:
    return level if RANK[level] >= RANK[other] else other


def _band(field: dict, value: float) -> tuple[str, str]:
    for b in field["bands"]:
        if "max" not in b or value < b["max"]:
            return b["level"], b["text"]
    return "green", ""


def _num(value: float) -> str:
    return f"{value:g}"


def _unordered(items):
    seen, out = set(), []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _reading_condition_met(conditions: dict, values: dict) -> bool:
    """True if any named reading crosses its edge, so ``sys_lt`` and ``dia_lt`` read as alternatives."""
    if not conditions:
        return True
    for expr, edge in conditions.items():
        key, op = expr.rsplit("_", 1)
        value = values.get(key)
        if value is None:
            continue
        if (op == "lt" and value < edge) or (op == "gt" and value > edge):
            return True
    return False


def evaluate(answers: dict, readings: dict | None = None, baseline_rhr: float | None = None) -> dict:
    """Turn symptom answers and one set of cuff readings into a level, findings and instructions."""
    readings = readings or {}
    level, findings, notes, steps = "green", [], [], []

    for q in FLOW["questions"]:
        answer = answers.get(q["id"], "no")
        if answer not in ANSWERS:
            raise ValueError(f"Answer for {q['id']} must be yes, no or unsure.")
        if answer == "yes":
            level = _worst(level, q["level"])
            findings.append(dict(label=q["finding"], level=q["level"], source="Symptom"))
            steps += q["instructions"]
            followup = q.get("followup")
            if followup:
                detail = answers.get(q["id"] + "_detail")
                if detail == "yes":
                    notes.append(followup["yes"])
                elif detail == "no":
                    notes.append(followup["no"])
        elif answer == "unsure" and q["level"] == "red":
            level = _worst(level, "amber")
            findings.append(dict(label=f"{q['finding']} (unsure)", level="amber", source="Symptom"))
            steps.append(f"If {q['finding'].lower()} may be present, treat it as urgent: stop what you are doing "
                         "and tell the crew medical officer.")

    out_readings = []
    for key, (field, measure) in READINGS.items():
        if key not in readings:
            continue
        value = float(readings[key])
        if not (field["min"] <= value <= field["max"]):
            raise ValueError(f'{field["label"]}: enter a number between {field["min"]} and {field["max"]}.')
        read_level, text = _band(field, value)
        out_readings.append(dict(key=key, label=field["label"], value=value, unit=field["unit"],
                                 level=read_level, text=text))
        if read_level != "green":
            level = _worst(level, read_level)
            findings.append(dict(label=f'{field["label"]} {_num(value)} {field["unit"]}',
                                 level=read_level, source="Reading"))
            steps += measure["if_abnormal"]

    values = {r["key"]: r["value"] for r in out_readings}
    for combo in FLOW["combinations"]:
        when = combo["when"]
        if not all(answers.get(qid) == "yes" for qid in when.get("answers", [])):
            continue
        if not _reading_condition_met(when.get("readings", {}), values):
            continue
        level = _worst(level, combo["level"])
        findings.append(dict(label=combo["finding"], level=combo["level"], source="Combination"))
        steps += combo["instructions"]
        notes += combo.get("notes", [])

    baseline_note = None
    pulse = values.get("pulse")
    if pulse is not None and baseline_rhr:
        diff = pulse - baseline_rhr
        if abs(diff) >= 10:
            side = "above" if diff > 0 else "below"
            baseline_note = (f"Your recent resting heart rate baseline is {baseline_rhr:.0f} bpm, "
                             f"so this reading is {abs(diff):.0f} bpm {side} it.")

    return dict(level=level, headline=FLOW["headlines"][level], findings=findings, notes=notes,
                readings=out_readings, instructions=_unordered(FLOW["level_instructions"][level] + steps),
                recheck=FLOW["recheck"][level], escalate=level == "red",
                baseline_note=baseline_note, disclaimer=FLOW["disclaimer"],
                answered=sum(1 for q in FLOW["questions"] if answers.get(q["id"]) in ANSWERS))
