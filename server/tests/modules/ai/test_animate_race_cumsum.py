"""Bar-race frames: running totals by default, opt-out for per-period / rate metrics."""

import pandas as pd

from ee.modules.ai.utils.animate_engine import run_animate_analysis


def _sales_frame() -> pd.DataFrame:
    # Non-monotonic period values so the mono-increasing heuristic does not
    # treat the series as already cumulative.
    return pd.DataFrame(
        {
            "year": [2020, 2020, 2021, 2021, 2022, 2022],
            "country": ["A", "B", "A", "B", "A", "B"],
            "sales": [10, 20, 5, 8, 15, 3],
        }
    )


def test_race_query_accumulates_additive_metric():
    result = run_animate_analysis(
        _sales_frame(),
        query="bar chart race of sales by country",
        time_col="year",
        category_col="country",
        metric_col="sales",
    )
    assert not result.get("error")
    # Period values 10,5,15 → running total 10,15,30 for A
    assert result["frames"][-1]["A"] == 30.0
    assert result["frames"][-1]["B"] == 31.0


def test_per_period_opt_out_skips_cumsum():
    result = run_animate_analysis(
        _sales_frame(),
        query="bar chart race of sales by country per period",
        time_col="year",
        category_col="country",
        metric_col="sales",
    )
    assert result["frames"][-1]["A"] == 15.0
    assert result["frames"][-1]["B"] == 3.0


def test_share_metric_skips_cumsum():
    df = pd.DataFrame(
        {
            "year": [2020, 2020, 2021, 2021],
            "country": ["A", "B", "A", "B"],
            "market_share": [0.4, 0.6, 0.45, 0.55],
        }
    )
    result = run_animate_analysis(
        df,
        query="bar chart race of market share by country",
        time_col="year",
        category_col="country",
        metric_col="market_share",
    )
    assert result["frames"][-1]["A"] == 0.45
    assert result["frames"][-1]["B"] == 0.55
