"""Chart type follows the data's shape, not words in the question: a top-N is a ranking (bars
in its own order), categories get bars (pie only for composition), a line only across real
periods, in calendar order; extra views never offer shares of averages or a fake cumulative."""

import pytest

from ee.modules.ai.nodes.chart_builder_node import _complementary_chart_types
from ee.modules.ai.utils.guaranteed_chart_builder import build_guaranteed_chart


def _shape(cfg):
    x, y = cfg.get("xAxis"), cfg.get("yAxis")
    axis = x.get("data") if isinstance(x, dict) and x.get("data") else (y.get("data") if isinstance(y, dict) else None)
    return [s.get("type") for s in cfg.get("series", [])], axis


def test_top_n_weeks_is_a_ranking_in_its_own_order():
    rows = [{"week": 59, "record_count": 149}, {"week": 54, "record_count": 130}, {"week": 70, "record_count": 129},
            {"week": 8, "record_count": 127}, {"week": 58, "record_count": 127}]
    types, axis = _shape(build_guaranteed_chart(rows, "Which 5 weeks recorded the highest volume of records?"))
    assert types == ["bar"]
    assert axis == ["59", "54", "70", "8", "58"]


def test_category_comparison_is_bars_even_with_a_time_word_in_the_metric_name():
    rows = [{"plan": "basic", "total_monthly_fee": 109519.01}, {"plan": "plus", "total_monthly_fee": 106329.16},
            {"plan": "pro", "total_monthly_fee": 102371.74}]
    assert _shape(build_guaranteed_chart(rows, "How does the total monthly fee compare across plans?"))[0] == ["bar"]
    assert _shape(build_guaranteed_chart(rows, "fee mix", intent={"is_decomposition": True}))[0] == ["pie"]


def test_line_across_real_periods_keeps_calendar_order():
    rows = [{"month": m, "revenue": v} for m, v in zip(["Jan", "Feb", "Mar", "Apr", "May"], [5, 7, 6, 9, 8])]
    types, axis = _shape(build_guaranteed_chart(rows, "monthly revenue"))
    assert types == ["line"]
    assert axis == ["Jan", "Feb", "Mar", "Apr", "May"]
    weeks = [{"week": w, "n": v} for w, v in zip([1, 2, 10, 11, 12], [5, 7, 6, 9, 8])]
    assert _shape(build_guaranteed_chart(weeks, "weekly records trend"))[1] == ["1", "2", "10", "11", "12"]


def test_extra_views_skip_shares_of_averages_and_fake_cumulative():
    assert "pie" in _complementary_chart_types("bar", 3, additive=True)
    assert "pie" not in _complementary_chart_types("bar", 3, additive=False)
    assert "area" not in _complementary_chart_types("line", 5, x_is_temporal=True)


@pytest.mark.asyncio
async def test_numeric_group_by_column_is_the_axis_not_a_second_measure():
    """The SQL groups by tenure_months: it is the axis. The intent taken before rows existed
    had no column roles, so the chart plotted it as a second bar series."""
    from ee.modules.ai.nodes.chart_builder_node import chart_builder_node

    rows = [{"tenure_months": 59, "record_count": 149}, {"tenure_months": 54, "record_count": 130},
            {"tenure_months": 70, "record_count": 129}, {"tenure_months": 8, "record_count": 127},
            {"tenure_months": 58, "record_count": 127}]
    out = await chart_builder_node({
        "query": "Which 5 weeks had the most records?",
        "sql_query": 'SELECT "tenure_months", COUNT(*) AS record_count FROM t GROUP BY "tenure_months" '
                     "ORDER BY record_count DESC LIMIT 5",
        "query_result": rows,
        "query_intent": {"sql_columns": {"dimensions": [], "metrics": []}},
    })
    chart = out.get("echarts_config") or {}
    names = [s.get("name") for s in chart.get("series", [])]
    assert names == ["Record Count"]
    x = chart.get("xAxis")
    assert (x or {}).get("data") == ["59", "54", "70", "8", "58"]


def test_tied_top_n_is_still_a_ranking_when_the_sql_ranks_by_the_measure():
    rows = [{"week": w, "order_count": 58300} for w in ["2024-01-01", "2024-01-08", "2024-01-22", "2024-04-01", "2024-05-13"]]
    intent = {"sql_columns": {"order_by": [("order_count", "DESC")]}}
    assert _shape(build_guaranteed_chart(rows, "Top 5 weeks by orders", intent=intent))[0] == ["bar"]
    trend = [{"week": w, "order_count": v} for w, v in zip(["2024-01-01", "2024-01-08", "2024-01-15", "2024-01-22", "2024-01-29"], [5, 7, 6, 9, 8])]
    assert _shape(build_guaranteed_chart(trend, "weekly orders", intent={"sql_columns": {"order_by": [("week", "ASC")]}}))[0] == ["line"]


@pytest.mark.parametrize("order", ["2 DESC", "COUNT(order_id) DESC", "order_count DESC", '"order_count" DESC'])
def test_order_by_resolves_to_the_output_column(order):
    from ee.modules.ai.utils.result_checks import first_order_by_output

    sql = f"SELECT DATE_TRUNC('week', order_date) AS week_start, COUNT(order_id) AS order_count FROM orders GROUP BY 1 ORDER BY {order} LIMIT 5"
    assert first_order_by_output(sql) == "order_count"
    assert first_order_by_output("SELECT week, n FROM t ORDER BY week") == "week"
    assert first_order_by_output("SELECT week, n FROM t") is None
