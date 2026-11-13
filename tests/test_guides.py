import json
from pathlib import Path

G = json.loads((Path(__file__).parent.parent / "static" / "guides.json").read_text(encoding="utf-8"))


def test_every_measurement_has_required_content():
    for m in G["measurements"]:
        assert m["how"] and m["why"] and m["if_abnormal"] and m["fields"], m["id"]


def test_bands_are_ordered_and_end_open_ended():
    for m in G["measurements"]:
        for f in m["fields"]:
            maxes = [b["max"] for b in f["bands"] if "max" in b]
            assert maxes == sorted(maxes), (m["id"], f["id"])
            assert "max" not in f["bands"][-1], (m["id"], f["id"])
            assert all(b["level"] in ("green", "amber", "red") for b in f["bands"])


def test_every_environment_schedules_every_measurement():
    ids = {m["id"] for m in G["measurements"]}
    for key, env in G["environments"].items():
        assert ids <= set(env["every_hours"]), key
