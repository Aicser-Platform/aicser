"""Fallback answers lead with engine results and are never cached as the answer."""

from ee.modules.ai.nodes.insight_synthesizer_node import _build_fallback_summary
from ee.modules.ai.services import langgraph_orchestrator as lo


def test_fallback_summary_leads_with_forecast_not_totals():
    meta = {"analytics_type": "predictive", "metric_label": "loan_principal",
            "forecast": [{"date": "2025-01", "forecast": 540000, "lower": 320000, "upper": 760000},
                         {"date": "2025-03", "forecast": 541000, "lower": 250000, "upper": 830000}]}
    s = _build_fallback_summary("Forecast loan principal", 12, ["principal_amount: total=6474369 avg=539531 min=1 max=2"],
                                analytics_metadata=meta)
    assert "totals" not in s
    assert "541" in s or "2025-03" in s


def test_fallback_narrative_not_cached(monkeypatch):
    stored = {}
    monkeypatch.setattr(lo, "_QUERY_CACHE", stored)
    result = {"query_result": [{"a": 1}], "execution_metadata": {"quality_decision": "approved",
                                                                  "generation_method": "data_facts_fallback"}}
    lo._set_cached_result("k-fallback", result)
    assert "k-fallback" not in stored
    result["execution_metadata"]["generation_method"] = "llm_stream"
    lo._set_cached_result("k-llm", result)
    assert "k-llm" in stored


def test_unnarrated_multi_row_answer_is_neither_cached_nor_replayed(monkeypatch):
    """Answers whose narrative was skipped on a several-row result (a template line or nothing)
    must not be stored — and ones stored before that rule must not be served."""
    stored = {}
    monkeypatch.setattr(lo, "_QUERY_CACHE", stored)
    monkeypatch.setattr("src.core.cache.cache", None, raising=False)
    rows = [{"region": "A", "n": 3}, {"region": "B", "n": 2}]
    skipped = {"query_result": rows, "execution_metadata": {"quality_decision": "approved", "insights_skipped_by_plan": True}}
    lo._set_cached_result("k-skipped", skipped)
    assert "k-skipped" not in stored
    stored["k-legacy"] = (skipped, 10**12)
    assert lo._get_cached_result("k-legacy") is None
    scalar = {"query_result": [{"n": 5}], "execution_metadata": {"quality_decision": "approved", "insights_skipped_by_plan": True}}
    lo._set_cached_result("k-scalar", scalar)
    assert "k-scalar" in stored
