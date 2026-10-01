"""When the narrative LLM stalls, answers still carry findings built from what the
engines computed — and an analysis answer with zero findings is never 'approved'."""

import pytest

from ee.modules.ai.utils.evidence_insights import build_evidence_insights


FORECAST_META = {
    "analytics_type": "predictive",
    "value_col": "revenue",
    "forecast": [
        {"date": "2025-07-01", "forecast": 1200.0, "lower": 1000.0, "upper": 1400.0, "lower_80": 1080.0, "upper_80": 1320.0},
        {"date": "2025-08-01", "forecast": 1300.0, "lower": 1050.0, "upper": 1550.0, "lower_80": 1150.0, "upper_80": 1450.0},
    ],
    "model_diagnostics": {
        "accuracy_rating": "good", "accuracy_pct": 86, "cv_folds": 3, "validated_horizon": 6,
        "forecast_summary": {"end_vs_last_actual_pct": 8.3, "last_actual": 1200.0, "horizon_total": 2500.0,
                             "prior_same_length_total": 2300.0, "total_change_pct": 8.7},
    },
    "partial_period": {"date": "2025-07-01", "value": 400.0, "coverage_pct": 30},
}


def test_forecast_evidence_quotes_engine_numbers():
    ins, recs, summary = build_evidence_insights("predictive", FORECAST_META, "revenue")
    text = " ".join(i["what"] for i in ins)
    assert len(ins) >= 3 and recs and summary
    for number in ("1,300", "1,050", "1,550", "+8.3%", "2,500", "+8.7%", "86%"):
        assert number in text + summary, number
    assert any("in progress" in i["title"].lower() for i in ins)
    assert "1,080" in recs[0]["action"] and "1,320" in recs[0]["action"]


def test_diagnostic_and_prescriptive_evidence():
    diag = {
        "analytics_type": "diagnostic",
        "period_comparison": {"direction": "down", "pct_change": -12.5,
                              "previous_period": {"sum": 800}, "current_period": {"sum": 700}},
        "dimension_slicing": [{"dimension": "region", "anomalous_segment": "EMEA", "segment_value": 90,
                               "overall_mean": 150, "deviation_pct": -40}],
        "top_contributors": [{"factor": "region", "direction": "negative", "explanation": "EMEA fell most."}],
    }
    ins, recs, summary = build_evidence_insights("diagnostic", diag, "sales")
    assert "-12.5%" in summary and any("EMEA" in i["title"] for i in ins) and recs

    presc = {"analytics_type": "prescriptive",
             "scenarios": [{"name": "Raise price 5%", "expected_outcome": 1100, "change_pct": 10, "risk": "low", "expected_value": 60}],
             "recommendations": [{"action": "Raise price 5% in EMEA", "priority_score": 0.8, "evidence": "elastic"}]}
    ins, recs, summary = build_evidence_insights("prescriptive", presc, "margin")
    assert "Raise price 5%" in summary and recs[0]["priority"] == "high"


def test_no_evidence_for_descriptive_or_errors():
    assert build_evidence_insights("descriptive", {"analytics_type": "descriptive"}) == ([], [], "")
    assert build_evidence_insights("predictive", {"error": "boom"}) == ([], [], "")


@pytest.mark.asyncio
async def test_finalizer_does_not_approve_empty_analysis_answer():
    from ee.modules.ai.nodes.response_finalizer_node import response_finalizer_node

    state = {
        "query": "forecast revenue", "analytics_type": "predictive",
        "query_result": [{"period": "2025-01-01", "value": 1}, {"period": "2025-02-01", "value": 2}],
        "insights": [], "recommendations": [],
        "executive_summary": "Revenue is forecast to rise to 2 by February according to the model output.",
        "echarts_config": {"series": [{"type": "line", "data": [1, 2]}], "xAxis": {"data": ["a", "b"]}},
        "execution_metadata": {"auto_pipeline": True},
    }
    out = await response_finalizer_node(state)
    ev = out.get("output_evaluation") or {}
    assert ev.get("decision") != "approved"
