"""Service facade: validate() / get_catalog() / run_query() with timeout + errors."""

import asyncio

import pytest

from ee.modules.semantic.service import run_query, validate

from tests.modules.semantic.test_loader import _full_dir


CONTEXT = {
    "metrics": [
        {
            "name": "total_revenue",
            "expression": "SUM(orders.amount_usd)",
            "metric_type": "simple",
            "table_name": "orders",
        },
        {
            "name": "account_count",
            "expression": "COUNT(*)",
            "metric_type": "simple",
            "table_name": "account",
        },
    ],
    "dimensions": [
        {
            "id": "dim-country",
            "name": "country",
            "expression": "orders.ship_country",
            "table_name": "orders",
        }
    ],
    "join_paths": [],
    "time_spines": [],
    "schema_info": {"tables": [{"name": "orders", "schema": "public"}]},
    "dialect": "postgres",
    "views": [
        {
            "name": "orders_view",
            "models": [
                {
                    "join_path": "orders",
                    "includes": ["total_revenue", "country"],
                }
            ],
        }
    ],
}


async def _ctx(data_source_id, project_id=None):
    return dict(CONTEXT)


def _spec(**overrides):
    spec = {
        "data_source_id": "ds-1",
        "metric": "total_revenue",
        "dimensions": ["country"],
        "filters": [],
        "limit": 10,
    }
    spec.update(overrides)
    return spec


async def test_run_query_happy_path_returns_rows_and_sql():
    async def execute(sql):
        assert "SUM(orders.amount_usd)" in sql
        return [{"country": "Cambodia", "metric_value": 42}]

    result = await run_query(_spec(), _load_context=_ctx, _execute=execute)
    assert result["success"] is True
    assert result["rows"] == [{"country": "Cambodia", "metric_value": 42}]
    assert "SELECT" in result["sql"] and "GROUP BY" in result["sql"]


async def test_run_query_unknown_metric_returns_readable_error():
    async def execute(sql):
        raise AssertionError("must not execute")

    result = await run_query(
        _spec(metric="revenuez"), _load_context=_ctx, _execute=execute
    )
    assert result["success"] is False
    assert "unknown_metric" in result["error"]
    assert result["rows"] == []


async def test_run_query_timeout():
    async def execute(sql):
        await asyncio.sleep(0.2)
        return []

    result = await run_query(
        _spec(), _load_context=_ctx, _execute=execute, timeout_s=0.01
    )
    assert result["success"] is False
    assert "timeout" in result["error"]


async def test_run_query_injection_value_stays_literal():
    captured = {}

    async def execute(sql):
        captured["sql"] = sql
        return []

    spec = _spec(
        filters=[{"field": "country", "operator": "eq", "value": "KH'; DROP TABLE x;--"}]
    )
    result = await run_query(spec, _load_context=_ctx, _execute=execute)
    assert result["success"] is True
    # the whole hostile value must remain inside one escaped SQL string literal
    assert "'KH''; DROP TABLE x;--'" in captured["sql"]


async def test_run_query_rejects_missing_metric_field():
    result = await run_query(
        {"data_source_id": "ds-1"}, _load_context=_ctx, _execute=None
    )
    assert result["success"] is False


async def test_run_query_rejects_member_outside_selected_view():
    async def execute(sql):
        raise AssertionError("must not execute")

    result = await run_query(
        _spec(view_name="orders_view", metrics=["account_count"], dimensions=["dim-country"]),
        _load_context=_ctx,
        _execute=execute,
    )
    assert result["success"] is False
    assert "member_not_in_view:orders_view" in result["error"]
    assert "account_count" in result["error"]


async def test_run_query_accepts_view_member_with_dimension_id():
    async def execute(sql):
        assert "orders.ship_country" in sql
        return [{"country": "Cambodia", "metric_value": 42}]

    result = await run_query(
        _spec(view_name="orders_view", metrics=["total_revenue"], dimensions=["dim-country"]),
        _load_context=_ctx,
        _execute=execute,
    )
    assert result["success"] is True


def test_validate_walks_directories(tmp_path):
    _full_dir(tmp_path)  # creates tmp_path/semantic/orders-source
    report = validate(tmp_path / "semantic")
    assert report["valid"] is True
    assert report["sources"] == 1
    assert report["issues"] == []


def test_validate_reports_issues(tmp_path):
    root = _full_dir(tmp_path)
    (root / "broken.yml").write_text("table: [oops")
    report = validate(tmp_path / "semantic")
    assert report["valid"] is False
    assert any("broken.yml" in i["file"] for i in report["issues"])
