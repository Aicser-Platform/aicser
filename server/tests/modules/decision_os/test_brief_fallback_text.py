"""When the Decide brief falls back to its template, it must not print broken or invented
sentences ("forecast to trend stable over .", "Decided about record None — the one with the .")."""

from ee.modules.ai.config.workflow_config import normalize_analytics_metadata
from ee.modules.decision_os.decision_synthesizer import fallback_brief, forecast_summary


def test_no_forecast_claim_without_a_forecast():
    assert forecast_summary({"predictive": {"target_metric": "amount"}}) == ""
    assert forecast_summary({"predictive": {"target_metric": "amount", "trend_direction": "down", "forecast_horizon": 3}}) \
        == "amount is forecast to trend **down** over the next 3 periods."


def test_placeholder_summary_is_not_presented_as_the_situation():
    am = normalize_analytics_metadata({}, "diagnostic_prescriptive_predictive")
    assert am["summary_is_placeholder"] is True
    brief = fallback_brief("Why did revenue drop?", am)
    assert "analysis completed" not in str(brief.get("situation", "")).lower()


def test_case_without_an_id_is_not_mentioned():
    from ee.modules.ai.utils.considerations import build_considerations

    items = build_considerations({"case_file": {"id": None, "noun": "record", "selected_by": ""}, "execution_metadata": {}})
    assert not any("Decided about" in str(i) for i in items)
