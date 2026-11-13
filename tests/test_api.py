import io
from pathlib import Path

import pandas as pd
from fastapi.testclient import TestClient

from app.main import app

c = TestClient(app)
ROOT = Path(__file__).parent.parent


def test_bundle_shape():
    b = c.get("/api/bundle").json()
    assert set(b) >= {"meta", "crew", "queue", "summaries"}
    assert len(b["crew"]["ben"]["statuses"]) == 120 and len(b["summaries"]) == 120


def test_report_is_markdown_download():
    r = c.get("/api/crew/ben/report?day=100")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    assert "Immune and infection" in r.text and "Last 14 days" in r.text


def test_checkin_validation():
    assert c.post("/api/checkin", json={"crew_id": "ben", "mood": 9}).status_code == 422
    assert c.post("/api/checkin", json={"crew_id": "nobody"}).status_code == 404


def test_import_flow_and_errors():
    assert c.post("/api/import", json={"name": "x", "csv": "a,b\n1,2"}).status_code == 400
    sample = (ROOT / "static" / "sample_wearable.csv").read_text()
    r = c.post("/api/import", json={"name": "Pal", "csv": sample})
    assert r.status_code == 200 and r.json()["person"]["id"] == "you"
    b = c.get("/api/bundle").json()
    assert "you" in b["crew"] and b["crew"]["you"]["n"] == r.json()["days"]
    assert any(s["overall"] != "green" for s in b["crew"]["you"]["statuses"])


def test_pwa_assets_served():
    for path in ("/", "/app.js", "/style.css", "/sw.js", "/manifest.webmanifest", "/icon.svg", "/sample_wearable.csv"):
        assert c.get(path).status_code == 200, path
