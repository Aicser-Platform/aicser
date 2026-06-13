"""build_kpi_sections must produce DIVERSE chart types, not a wall of bars.

Root cause being fixed: the metric×dimension enumeration emitted every combo as a
"bar", so a rich schema (4 metrics × 4 dims) filled the whole widget budget with
bar charts — one pie and one line at most. Users complained dashboards were
"mostly the same type like bar chart".

These tests lock in chart-type diversity for the heuristic fallback (the path used
whenever the LLM planner is skipped or returns too few widgets).
"""

from ee.modules.ai.services.dashboard_pesd_service import build_kpi_sections


def _rich_retail_schema() -> dict:
    return {
        "tables": [
            {
                "name": "sales",
                "columns": [
                    {"name": "order_date", "type": "date"},
                    {"name": "sales_amount", "type": "double"},
                    {"name": "quantity", "type": "int"},
                    {"name": "profit", "type": "double"},
                    {"name": "discount", "type": "float"},
                    {"name": "region", "type": "varchar"},
                    {"name": "category", "type": "varchar"},
                    {"name": "channel", "type": "varchar"},
                    {"name": "segment", "type": "varchar"},
                ],
            }
        ]
    }


def _chart_types(sections) -> list:
    return [str(s.get("chart_type") or "") for s in sections]


def test_heuristic_dashboard_is_not_mostly_bars():
    sections = build_kpi_sections(
        "build me a sales overview dashboard",
        _rich_retail_schema(),
        db_type="duckdb",
        tier="operational",
    )
    types = _chart_types(sections)
    assert len(types) >= 5, f"expected a meaningful dashboard, got {types}"

    non_stat = [t for t in types if t != "stat"]
    bars = [t for t in non_stat if t == "bar"]
    # Bars must not dominate: at most ~55% of the visual (non-KPI) widgets.
    assert len(bars) <= 0.55 * len(non_stat), (
        f"bars dominate ({len(bars)}/{len(non_stat)} non-stat widgets): {types}"
    )


def test_heuristic_dashboard_uses_several_distinct_chart_types():
    sections = build_kpi_sections(
        "sales performance overview",
        _rich_retail_schema(),
        db_type="duckdb",
        tier="executive",
    )
    distinct = set(_chart_types(sections))
    # A rich schema with metrics, dimensions and a date column should yield at least
    # KPI stats + a trend (line/area) + a ranking (bar) + a composition (pie/donut).
    assert len(distinct) >= 4, f"expected ≥4 distinct chart types, got {sorted(distinct)}"
    assert "line" in distinct or "area" in distinct, f"no time-trend chart: {sorted(distinct)}"
    assert "pie" in distinct or "donut" in distinct, f"no composition chart: {sorted(distinct)}"


def test_no_metrics_still_safe():
    # Schema with only categorical columns must not crash and must stay non-bar-only-safe.
    schema = {"tables": [{"name": "t", "columns": [{"name": "region", "type": "varchar"}]}]}
    sections = build_kpi_sections("overview", schema, db_type="duckdb", tier="operational")
    assert isinstance(sections, list)
