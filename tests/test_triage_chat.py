import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

c = TestClient(app)
FLOW = json.loads((Path(__file__).parent.parent / "static" / "triage.json").read_text(encoding="utf-8"))


def ask(**answers):
    return c.post("/api/symptom-chat", json={"answers": answers})


def test_flow_is_well_formed():
    ids = [q["id"] for q in FLOW["questions"]]
    assert len(ids) == len(set(ids))
    for q in FLOW["questions"]:
        assert q["text"] and q["finding"] and q["instructions"]
        assert q["level"] in ("amber", "red"), q["id"]
    for level in ("green", "amber", "red"):
        assert FLOW["headlines"][level] and FLOW["level_instructions"][level] and FLOW["recheck"][level]
    for combo in FLOW["combinations"]:
        assert set(combo["when"]["answers"]) <= set(ids)
        for expr in combo["when"]["readings"]:
            key, op = expr.rsplit("_", 1)
            assert key in ("sys", "dia", "pulse") and op in ("lt", "gt")


def test_chest_pain_escalates_and_followup_is_explained():
    r = ask(chest_pain="yes", chest_pain_detail="yes").json()
    assert r["level"] == "red" and r["escalate"] is True
    assert any("Sharp pain" in f["label"] for f in r["findings"])
    assert any("muscular" in n for n in r["notes"])
    assert any("crew medical officer" in s for s in r["instructions"])


def test_all_clear_is_green():
    answers = {q["id"]: "no" for q in FLOW["questions"]}
    r = c.post("/api/symptom-chat", json={"answers": answers, "readings": {"sys": 118, "dia": 76, "pulse": 68}}).json()
    assert r["level"] == "green" and r["escalate"] is False
    assert len(r["readings"]) == 3 and all(x["level"] == "green" for x in r["readings"])


def test_unsure_on_a_red_flag_watches():
    assert ask(chest_pain="unsure").json()["level"] == "amber"
    assert ask(chest_pain="no").json()["level"] == "green"


def test_low_blood_pressure_with_dizziness_is_red():
    r = c.post("/api/symptom-chat", json={"answers": {"dizzy": "yes"},
                                          "readings": {"sys": 86, "dia": 54, "pulse": 96}}).json()
    assert r["level"] == "red"
    assert any("low blood pressure" in f["label"].lower() for f in r["findings"])
    assert any("raise your legs" in s for s in r["instructions"])


def test_high_reading_alone_flags():
    r = c.post("/api/symptom-chat", json={"answers": {}, "readings": {"sys": 185, "dia": 115}}).json()
    assert r["level"] == "red"
    assert [x["level"] for x in r["readings"]] == ["red", "red"]


def test_personal_baseline_is_used_for_pulse():
    r = c.post("/api/symptom-chat", json={"crew_id": "ben", "answers": {}, "readings": {"pulse": 92}}).json()
    assert "baseline" in r["baseline_note"]

    # a reading on the person's own baseline gives no comparison note
    from app import engine as E
    base = E.member("ben").mean["rhr"]
    r = c.post("/api/symptom-chat", json={"crew_id": "ben", "answers": {}, "readings": {"pulse": base}}).json()
    assert r["baseline_note"] is None


def test_validation_errors():
    assert c.post("/api/symptom-chat", json={"answers": {"chest_pain": "maybe"}}).status_code == 422
    assert c.post("/api/symptom-chat", json={"readings": {"sys": 999}}).status_code == 400
    assert c.post("/api/symptom-chat", json={"crew_id": "nobody"}).status_code == 404


def test_chat_assets_are_served():
    for path in ("/chat.js", "/triage.json"):
        assert c.get(path).status_code == 200, path
