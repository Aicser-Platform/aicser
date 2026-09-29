"""The routing golden set is well-formed and the scorer computes what go/no-go needs."""

from ee.modules.ai.decisions.registry import MODES
from ee.modules.ai.evals.run_decision_eval import load_items, score


def test_golden_set_is_valid_and_covers_every_locale_and_mode():
    items = load_items()
    assert len(items) >= 150
    assert len({i["id"] for i in items}) == len(items)
    assert all(i["mode"] in MODES for i in items)
    langs = {i["lang"] for i in items}
    assert {"en", "km", "th", "vi"} <= langs
    for lang in ("km", "th", "vi"):
        assert sum(i["lang"] == lang for i in items) >= 20
    assert {i["mode"] for i in items} == set(MODES)
    assert sum(bool(i.get("injection")) for i in items) >= 8
    assert any(i.get("injection") is False for i in items)  # look-alikes that must NOT be flagged


def test_scorer_reports_confident_accuracy_and_calibration():
    rows = [
        {"lang": "en", "mode": "predictive", "mode_pred": "predictive", "mode_conf": 0.99, "latency_ms": 300,
         "chart": True, "chart_pred": True, "injection": None},
        {"lang": "en", "mode": "standard", "mode_pred": "diagnostic", "mode_conf": 0.6, "latency_ms": 500,
         "chart": None},
        {"lang": "km", "mode": "diagnostic", "mode_pred": None, "mode_conf": None, "latency_ms": 900},
    ]
    rep = score(rows, 0.9)
    assert rep["all"]["n"] == 3 and rep["all"]["answered"] == 2
    assert rep["all"]["mode_accuracy"] == 0.5 and rep["all"]["mode_accuracy_when_confident"] == 1.0
    assert rep["all"]["coverage_confident"] == round(1 / 3, 3)
    assert rep["en"]["chart_accuracy"] == 1.0
    assert rep["km"]["answered"] == 0 and rep["km"]["mode_accuracy"] is None
    assert [b["n"] for b in rep["all"]["calibration"]] == [1, 0, 0, 1]
