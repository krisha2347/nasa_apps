from app import engine as E
from app.simulator import N_DAYS


def lvl(cid, dom, d):
    return E.member(cid).status(d)["domains"][dom]["level"]


def test_no_false_alarms_in_quiet_windows():
    for cid, end in (("ben", 90), ("asha", 55), ("chen", 34), ("dara", 64)):
        for d in range(E.BASELINE_DAYS, end):
            for k, v in E.member(cid).status(d)["domains"].items():
                if k in ("environment", "radiation"):
                    continue
                assert v["level"] == "green", (cid, d, k)


def test_events_are_detected():
    assert any(lvl("asha", "behavioral", d) != "green" for d in range(60, 85))
    assert any(lvl("ben", "immune", d) == "red" for d in range(95, 108))
    assert any(lvl("chen", "gravity", d) != "green" for d in range(60, 115))
    assert any(lvl("dara", "behavioral", d) != "green" for d in range(80, 119))
    assert any(lvl("asha", "radiation", d) == "red" for d in (74, 75, 76))
    assert any(lvl("ben", "environment", d) != "green" for d in range(48, 56))


def test_infection_is_not_misread_as_deconditioning():
    st = E.member("ben").status(100)
    assert st["domains"]["immune"]["level"] == "red"
    assert st["domains"]["gravity"]["level"] == "green"


def test_forecast_gives_eta_for_slow_drift():
    etas = [E.member("chen").status(d)["domains"]["gravity"]["forecast"] for d in range(40, 80)]
    assert any(f["eta"] for f in etas)
    assert all(f["trend"] in ("worsening", "improving", "steady") for f in etas)


def test_drivers_carry_recovery_goals():
    st = E.member("asha").status(75)["domains"]["behavioral"]
    assert st["level"] != "green" and st["goals"] and st["goals"][0].startswith("back ")


def test_summary_ranks_attention():
    s = E.summary(100)
    assert s["attention"][0]["overall"] == "red"
    assert s["team_strain"]["label"] in ("Low", "Moderate", "High")


def test_queue_holds_during_blackout():
    q = E.earth_queue(N_DAYS - 1)
    held = [m for m in q if E.BLACKOUT[0] <= m["day"] <= E.BLACKOUT[1]]
    assert held and all(m["delivered_day"] == E.BLACKOUT[1] + 1 for m in held)


def test_triage():
    assert E.triage("ben", ["chest_pain"])["level"] == "red"
    assert E.triage("ben", ["fever"])["level"] == "amber"
    assert E.triage("ben", [])["level"] == "green"
