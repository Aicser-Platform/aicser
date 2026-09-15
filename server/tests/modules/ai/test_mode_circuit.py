"""End-to-end mode circuit: engines, SQL grain, and lead chart."""

from ee.modules.ai.nodes.chart_builder_node import _try_analytics_mode_chart
from ee.modules.ai.utils.mode_circuit import (
    di_engine_selection,
    engine_sql_grain,
    primary_chart_kind,
)
from ee.modules.ai.utils.routing_utils import infer_analysis_mode_from_query


def test_sql_grain_per_mode():
    assert engine_sql_grain("predictive") == "predictive"
    assert engine_sql_grain("diagnostic") == "diagnostic"
    assert engine_sql_grain("prescriptive") == "prescriptive"
    assert engine_sql_grain("animate") == "animate"
    assert engine_sql_grain("decision_intelligence") == "diagnostic"
    assert engine_sql_grain("diagnostic_prescriptive_predictive") == "diagnostic"
    assert engine_sql_grain("descriptive") == "descriptive"


def test_decide_on_actions_root_cause_does_not_run_forecast():
    rows = [
        {"month": "2024-01-01", "amount": 400_000},
        {"month": "2024-06-01", "amount": 700_000},
        {"month": "2025-01-01", "amount": 500_000},
    ]
    sel = di_engine_selection(
        "What actions would fix this root cause?",
        pinned=True,
        query_result=rows,
    )
    assert sel["needs_diagnostic"] is True
    assert sel["needs_prescriptive"] is True
    assert sel["needs_predictive"] is False


def test_decide_forecast_question_keeps_predictive_on_timeseries():
    rows = [{"month": f"2024-{m:02d}-01", "amount": 100 + m} for m in range(1, 13)]
    sel = di_engine_selection(
        "Forecast next 6 months and recommend what to do",
        pinned=True,
        query_result=rows,
    )
    assert sel["needs_predictive"] is True
    assert sel["needs_prescriptive"] is True


def test_decide_chart_leads_with_drivers_not_forecast():
    query = "What actions would fix this root cause?"
    meta = {
        "analytics_type": "diagnostic_prescriptive_predictive",
        "diagnostic": {
            "dimension_slicing": [
                {
                    "anomalous_segment": "Branch 5",
                    "segment_value": 706464,
                    "overall_mean": 500000,
                    "zscore": 1.8,
                    "deviation_pct": 41,
                    "dimension": "branch",
                }
            ],
            "top_contributors": [{"factor": "branch=Branch 5", "magnitude": 12, "direction": "positive"}],
        },
        "prescriptive": {"scenarios": []},
        "predictive": {
            "historical": [{"date": "2024-01-01", "value": 100}],
            "forecast": [{"date": "2025-02-01", "forecast": 120, "lower": 90, "upper": 150}],
            "model_used": "prophet",
        },
    }
    assert primary_chart_kind("decision_intelligence", query, meta) == "diagnostic"
    chart = _try_analytics_mode_chart("decision_intelligence", meta, query, [{"branch": "A", "amount": 1}])
    assert chart is not None
    names = chart.get("xAxis", {}).get("data") or []
    assert "Branch 5" in names
    series_names = [s.get("name") for s in chart.get("series") or []]
    assert "Forecast" not in series_names
    assert "Historical" not in series_names


def test_forecast_intent_does_not_steal_descriptive_or_status():
    from ee.modules.ai.utils.query_intent_principles import query_implies_forecast

    assert query_implies_forecast("Forecast revenue for the next 6 months") is True
    assert query_implies_forecast("Project sales for next quarter") is True
    assert query_implies_forecast("project status by region") is False
    assert query_implies_forecast("Show the next 5 customers") is False
    assert query_implies_forecast("Show expected close this month by stage") is False
    assert infer_analysis_mode_from_query("Show revenue year over year") != "animate"
    assert infer_analysis_mode_from_query("project status by region") != "predictive"
    assert infer_analysis_mode_from_query("Forecast revenue for the next 6 months") == "predictive"


def test_ranking_follow_up_overrides_pinned_forecast():
    from ee.modules.ai.utils.query_intent_principles import (
        query_implies_ranking_or_entity_grain,
        query_overrides_pinned_forecast,
    )

    q = "Which name has the highest current_balance?"
    assert query_implies_ranking_or_entity_grain(q) is True
    assert query_overrides_pinned_forecast(q) is True
    assert query_overrides_pinned_forecast("forecast loan amount for the next 3 months") is False
    assert query_overrides_pinned_forecast("why did this happen?") is False


def test_fallback_chart_title_does_not_look_like_forecast_succeeded():
    from ee.modules.ai.utils.mode_circuit import apply_fallback_chart_title

    chart = {
        "title": {"text": "Forecast Next 6 Months", "subtext": ""},
        "series": [{"name": "amount", "type": "bar", "data": [1, 2]}],
    }
    stamped = apply_fallback_chart_title(
        chart,
        "predictive",
        "This result is not a time series. Ask for the metric over months or dates, then forecast.",
    )
    assert stamped["title"]["text"] == "Could not forecast this result"
    assert "time series" in stamped["title"]["subtext"]
    assert stamped["_meta"]["mode_fallback_chart"] is True
    assert stamped["series"][0]["name"] == "amount"


def test_animate_without_frames_does_not_build_empty_race():
    chart = _try_analytics_mode_chart("animate", {"analytics_type": "animate"}, "animate this", [{"branch": "A", "amount": 1}])
    assert chart is None


def test_optimise_falls_back_to_diagnostic_bars():
    meta = {
        "dimension_slicing": [
            {
                "anomalous_segment": "West",
                "segment_value": 80,
                "overall_mean": 50,
                "zscore": 1.2,
                "deviation_pct": 60,
                "dimension": "region",
            }
        ],
        "top_contributors": [{"factor": "region=West", "magnitude": 5, "direction": "positive"}],
    }
    assert primary_chart_kind("prescriptive", "how can we improve this", meta) == "diagnostic"
    chart = _try_analytics_mode_chart("prescriptive", meta, "how can we improve this", [])
    assert chart is not None
    assert "West" in (chart.get("xAxis") or {}).get("data", [])


def test_actions_plus_root_cause_routes_to_decide():
    assert infer_analysis_mode_from_query("What actions would fix this root cause?") == "decision_intelligence"


def test_expected_close_is_not_forecast():
    assert infer_analysis_mode_from_query("Show expected close this month by stage") != "predictive"
