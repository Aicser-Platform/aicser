"""Diagnostic / anomaly spotlight SQL must return chartable entity rows.

Previously `_sql_diagnostic` aggregated only z>2 rows into a single summary.
No outliers → 0 rows → section looked empty/failed; with outliers → scatter
of aggregates. These tests lock the entity-level ranking shape.
"""

from ee.modules.ai.config.report_templates import (
    SECTION_TYPES,
    _sql_diagnostic,
    get_section_chart_hint,
)


def test_diagnostic_chart_hint_is_horizontal_bar():
    assert get_section_chart_hint("diagnostic") == "horizontal_bar"
    assert SECTION_TYPES["diagnostic"]["chart_hint"] == "horizontal_bar"


def test_diagnostic_sql_with_dimension_returns_extreme_entities():
    sql = _sql_diagnostic("orders", "revenue", dialect="duckdb", dimension="sku")
    assert "entity" in sql
    assert "z_score" in sql
    assert "GROUP BY" in sql
    assert "ORDER BY z_score DESC" in sql
    # Must not filter to z>2 only — that emptied the section when data was flat.
    assert "> 2" not in sql
    assert "outlier_count" not in sql


def test_diagnostic_sql_without_dimension_still_returns_scored_values():
    sql = _sql_diagnostic("orders", "revenue", dialect="duckdb")
    assert "z_score" in sql
    assert "ORDER BY z_score DESC" in sql
    assert "outlier_count" not in sql


def test_diagnostic_clickhouse_with_dimension():
    sql = _sql_diagnostic("orders", "revenue", dialect="clickhouse", dimension="region")
    assert "stddevPop" in sql
    assert "entity" in sql
    assert "LIMIT 20" in sql
