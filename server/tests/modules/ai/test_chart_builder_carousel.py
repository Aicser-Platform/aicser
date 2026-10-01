"""chart_builder_node emits the primary chart plus two extra views for the chat carousel
(execution_metadata.complementary_charts, index 0 = primary). Extra views must be distinct
chart types — a carousel of the same chart twice is noise."""

import pytest

from ee.modules.ai.nodes.chart_builder_node import (
    _chart_breadth_limits,
    _complementary_chart_types,
    _semantic_chart_type,
    chart_builder_node,
)


def test_every_mode_budgets_two_extra_views():
    for mode in ("descriptive", "diagnostic", "prescriptive", "predictive", "animate", "decision_intelligence"):
        limits = _chart_breadth_limits(analytics_type=mode, has_multi_step_results=False, dataset_count=1)
        assert limits["max_extra_charts"] == 2
        assert limits["complementary_charts"] == 2


def test_complementary_types_exclude_primary():
    for primary in ("line", "area", "bar", "horizontal_bar", "pie", "scatter"):
        alts = _complementary_chart_types(primary, 10)
        assert primary not in alts
        assert len(alts) >= 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rows",
    [
        [{"month": f"2025-{m:02d}-01", "revenue": 100 + m * 7 + (m % 3) * 11} for m in range(1, 13)],
        [{"region": r, "revenue": v} for r, v in zip("ABCDEFG", (300, 250, 90, 180, 60, 40, 120))],
    ],
    ids=["time_series", "categorical"],
)
async def test_descriptive_result_gets_two_distinct_extra_views(rows):
    state = {
        "query": "revenue overview",
        "query_result": rows,
        "query_intent": {},
        "analytics_type": "descriptive",
        "sql_query": "SELECT 1",
    }
    out = await chart_builder_node(state)
    charts = (out.get("execution_metadata") or {}).get("complementary_charts") or []
    assert len(charts) == 3
    labels = [c.get("view_label") for c in charts[1:]]
    assert all(labels) and len(set(labels)) == 2, labels
    assert all(c.get("series") for c in charts)


async def _views(rows):
    out = await chart_builder_node({
        "query": "Total product by region", "query_result": rows, "query_intent": {},
        "analytics_type": "descriptive", "sql_query": "SELECT 1",
    })
    return (out.get("execution_metadata") or {}).get("complementary_charts") or []


STORES = (8, 4, 5, 9, 10, 6, 7, 1, 2, 3)


@pytest.mark.asyncio
async def test_uniform_values_get_no_extra_views():
    # Every store has 4 products: a pie of equal slices / one-bar histogram says nothing.
    rows = [{"store_name": f"Store {i}", "region_id": (i % 7) + 1, "total_products": 4} for i in STORES]
    assert await _views(rows) == []


@pytest.mark.asyncio
async def test_alternate_views_reuse_primary_columns_and_are_labelled():
    # The primary is grouped by region_id; the pie must still slice by store, not region id.
    rows = [{"store_name": f"Store {i}", "region_id": (i % 7) + 1, "total_products": 3 + i} for i in STORES]
    charts = await _views(rows)
    pie = next(c for c in charts if _semantic_chart_type(c) in ("pie", "donut"))
    names = {d["name"] for d in pie["series"][0]["data"] if isinstance(d, dict)}
    assert names and all(str(n).startswith(("Store", "Other")) for n in names)
    labels = [c.get("view_label") for c in charts[1:]]
    assert all(labels) and len(set(labels)) == len(labels)


@pytest.mark.asyncio
async def test_no_line_view_across_categories():
    rows = [{"store_name": f"Store {i}", "total_products": 3 + i} for i in STORES]
    charts = await _views(rows)
    assert "line" not in {_semantic_chart_type(c) for c in charts[1:]}


def test_supporting_views_are_labelled_and_forecast_history_is_not_repeated():
    from ee.modules.ai.nodes.chart_builder_node import _dataset_view_label as L

    assert L("pred_timeseries", {}, "predictive") is None
    assert L("base", {}, "predictive") is None
    assert L("diag_breakdown__region", {}, "diagnostic") == "By region"
    assert L("presc_price_cut", {}, "prescriptive") == "Scenario: price cut"
    assert L("step_2", {"description": "Orders by store"}, "standard") == "Orders by store"
    assert L("base", {}, "diagnostic") == "Underlying data"
