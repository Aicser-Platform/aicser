"""Forecast chart: history then forecast on one timeline, with a real 95% CI band."""

from ee.modules.ai.nodes.chart_builder_node import _build_forecast_chart


def test_forecast_chart_drops_overlapping_months_and_plots_ci_band():
    chart = _build_forecast_chart(
        {
            "historical": [
                {"date": "2024-11-01", "value": 100},
                {"date": "2024-12-01", "value": 110},
                {"date": "2025-01-31", "value": 120},
            ],
            "forecast": [
                {"date": "2024-12-01", "forecast": 108, "lower": 90, "upper": 130},
                {"date": "2025-01-01", "forecast": 119, "lower": 100, "upper": 140},
                {"date": "2025-02-01", "forecast": 130, "lower": 110, "upper": 160},
                {"date": "2025-03-01", "forecast": 140, "lower": 115, "upper": 170},
            ],
            "model_used": "prophet",
            "confidence_level": 0.95,
            "target_metric": "current_balance",
            "metric_label": "current_balance",
        },
        "forecast collateral",
    )
    assert chart is not None
    assert "Forecast" in str((chart.get("title") or {}).get("text") or "")
    names = [s["name"] for s in chart["series"]]
    assert names[:2] == ["Historical", "Forecast"]
    assert "95% interval" in names
    assert "_ci_lower" in names
    assert "Lower Bound" not in names
    x = chart["xAxis"]["data"]
    assert x == ["2024-11-01", "2024-12-01", "2025-01-31", "2025-02-01", "2025-03-01"]
    assert chart.get("grid")
    assert chart.get("_forecastTooltip") is True
    assert "formatter" not in (chart.get("tooltip") or {})
    sub = (chart.get("title") or {}).get("subtext") or ""
    assert "MAPE" not in sub or "%" in sub
    assert "conformal" not in sub
    hist = chart["series"][0]["data"]
    fc = chart["series"][1]["data"]
    assert hist[:3] == [100, 110, 120]
    assert hist[3] is None and hist[4] is None
    # No drop-to-zero padding on history
    assert 0 not in hist
    # Forecast starts at the last historical point, then continues
    assert fc[2]["value"] == 120
    assert fc[3]["value"] == 130
    assert fc[3]["lower"] == 110
    assert fc[3]["upper"] == 160
    assert fc[0] is None and fc[1] is None

    ci_base = next(s for s in chart["series"] if s["name"] == "_ci_lower")
    ci_span = next(s for s in chart["series"] if s["name"] == "95% interval")
    # Historical slots are null, not 0 — that was the flattened "Lower Bound" bug
    assert ci_base["data"][0] is None
    assert ci_base["data"][1] is None
    assert 0 not in ci_base["data"]
    assert ci_base["data"][3] == 110
    assert ci_span["data"][3] == 50
    assert "95% CI" in ((chart.get("title") or {}).get("subtext") or "")


def test_forecast_chart_daily_keeps_same_month_after_last_day():
    chart = _build_forecast_chart(
        {
            "historical": [
                {"date": "2025-01-13", "value": 10},
                {"date": "2025-01-14", "value": 11},
                {"date": "2025-01-15", "value": 12},
            ],
            "forecast": [
                {"date": "2025-01-15", "forecast": 12, "lower": 11, "upper": 13},
                {"date": "2025-01-16", "forecast": 13, "lower": 11, "upper": 15},
            ],
            "model_used": "ets",
        },
        "daily forecast",
    )
    x = chart["xAxis"]["data"]
    assert "2025-01-16" in x
    fc = chart["series"][1]["data"]
    values = [p["value"] if isinstance(p, dict) else p for p in fc]
    assert 13 in values
