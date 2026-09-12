"""Forecast planner must reuse period/value results instead of wrapping schema columns."""

import pytest

from ee.modules.ai.nodes.mode_query_planner_node import mode_query_planner_node
from ee.modules.ai.nodes.multi_query_execution_node import _derive_timeseries_from_base


@pytest.mark.asyncio
async def test_forecast_planner_derives_from_period_value_result(monkeypatch):
    monkeypatch.setattr(
        "ee.modules.ai.nodes.mode_query_planner_node._cache_get", lambda _key: None
    )
    monkeypatch.setattr(
        "ee.modules.ai.nodes.mode_query_planner_node._cache_set", lambda *_a, **_k: None
    )
    rows = [{"period": f"2024-{m:02d}-01", "value": 10.0 * m} for m in range(1, 10)]
    state = {
        "analytics_type": "predictive",
        "sql_query": (
            'SELECT date_trunc(\'month\', disbursed_at) AS period, SUM(amount) AS value '
            "FROM banking.loans GROUP BY 1 ORDER BY 1"
        ),
        "query_result": rows,
        "data_profile": {"time_column": "disbursed_at", "metric_columns": ["amount"]},
        "execution_metadata": {
            "mode_parameters": {"time_column": "disbursed_at", "target_metric": "amount"}
        },
        "delegation_context": {"time_column": "disbursed_at", "target_metric": "amount"},
        "data_source_id": "ds-1",
        "query": "forecast loan amounts",
    }
    out = await mode_query_planner_node(state)
    plan = out.get("analysis_plan") or {}
    queries = plan.get("queries") or []
    assert queries, plan
    ts = next(q for q in queries if q.get("id") == "pred_timeseries")
    assert ts.get("derive_from_base") is True
    sql = ts.get("sql") or ""
    assert "disbursed_at" not in sql
    assert "SUM(amount)" not in sql
    assert ts.get("time_column") == "period"
    assert ts.get("metric") == "value"


@pytest.mark.asyncio
async def test_forecast_planner_does_not_cte_wrap_missing_source_columns(monkeypatch):
    monkeypatch.setattr(
        "ee.modules.ai.nodes.mode_query_planner_node._cache_get", lambda _key: None
    )
    monkeypatch.setattr(
        "ee.modules.ai.nodes.mode_query_planner_node._cache_set", lambda *_a, **_k: None
    )
    # Too few rows for "already timeseries" via count, but aliases are present.
    rows = [{"period": "2024-01-01", "value": 10.0}]
    state = {
        "analytics_type": "predictive",
        "sql_query": "SELECT date_trunc('month', disbursed_at) AS period, SUM(amount) AS value FROM loans GROUP BY 1",
        "query_result": rows,
        "data_profile": {"time_column": "disbursed_at", "metric_columns": ["amount"]},
        "execution_metadata": {
            "mode_parameters": {"time_column": "disbursed_at", "target_metric": "amount"}
        },
        "delegation_context": {},
        "data_source_id": "ds-1",
        "query": "forecast",
    }
    out = await mode_query_planner_node(state)
    ts = next(q for q in (out.get("analysis_plan") or {}).get("queries") or [] if q.get("id") == "pred_timeseries")
    assert ts.get("derive_from_base") is True
    assert "FROM base" not in (ts.get("sql") or "") or "disbursed_at" not in (ts.get("sql") or "")


def test_derive_timeseries_resolves_schema_names_onto_period_value():
    rows = [{"period": "2024-01-01", "value": 10.0}, {"period": "2024-02-01", "value": 12.0}]
    out = _derive_timeseries_from_base(rows, "disbursed_at", "amount")
    assert len(out) == 2
    assert "period" in out[0] and "value" in out[0]
