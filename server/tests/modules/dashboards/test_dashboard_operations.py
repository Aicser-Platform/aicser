"""Unit tests for canonical dashboard operations helpers."""

from types import SimpleNamespace

import pytest

from src.modules.dashboards.operations import merge_runtime_filters, apply_drill_context, get_plan_limits


def test_resolve_table_for_field_from_schema():
    from src.modules.dashboards.operations import _resolve_table_for_field

    schema = {
        "tables": [
            {"name": "customers", "columns": [{"name": "id"}]},
            {"name": "loans", "columns": [{"name": "interest_rate"}, {"name": "branch_id"}]},
        ]
    }
    assert _resolve_table_for_field(schema, "interest_rate") == "loans"
    assert _resolve_table_for_field(schema, "interest_rate", "loans") == "loans"
    assert _resolve_table_for_field(schema, "id") == "customers"


def test_build_cascade_where_for_options_skips_like():
    from src.modules.dashboards.operations import _build_cascade_where_for_options

    sql = _build_cascade_where_for_options(
        [
            {"field": "name", "operator": "like", "value": "%soker%"},
            {"field": "branch_id", "operator": ">=", "value": 20},
        ],
        "interest_rate",
    )
    assert "name" not in sql
    assert "branch_id" in sql
    assert merge_runtime_filters({"x": "region"}, None) == {"x": "region"}


def test_merge_runtime_filters_replaces_same_field():
    """Runtime filter for the same field replaces the existing one.

    _normalize_filter_entry canonicalises operator aliases ("eq" → "=") and
    adds a ``type`` key, so the assertion uses the normalised form.
    """
    base = {"filters": [{"field": "region", "operator": "eq", "value": "US"}]}
    runtime = [{"field": "region", "operator": "eq", "value": "EU"}]
    merged = merge_runtime_filters(base, runtime)
    # Exactly one filter entry remains (old US filter removed, EU filter added).
    assert len(merged["filters"]) == 1
    result_filter = merged["filters"][0]
    assert result_filter["field"] == "region"
    assert result_filter["value"] == "EU"
    # operator may be canonicalised ("eq" → "="); both are acceptable
    assert result_filter["operator"] in ("eq", "=")


def test_merge_runtime_filters_appends_new_field():
    base = {"filters": [{"field": "region", "operator": "eq", "value": "US"}]}
    runtime = [{"field": "year", "operator": "eq", "value": 2024}]
    merged = merge_runtime_filters(base, runtime)
    assert len(merged["filters"]) == 2


def test_get_plan_limits_free():
    result = get_plan_limits("free")
    assert result["plan"] == "free"
    assert "max_dashboards" in result["limits"]


@pytest.mark.asyncio
async def test_get_filter_field_stats_invalid_field():
    from uuid import uuid4
    from unittest.mock import AsyncMock
    from src.modules.dashboards.operations import get_filter_field_stats

    db = AsyncMock()
    result = await get_filter_field_stats(db, uuid4(), "'; DROP", "ds-1")
    assert result == {"min": None, "max": None}


@pytest.mark.asyncio
async def test_get_filter_options_missing_table_field_skips_query():
    from uuid import uuid4
    from unittest.mock import AsyncMock
    from src.modules.dashboards.operations import get_filter_options

    ds = SimpleNamespace(
        id="ds-1",
        type="file",
        db_type="duckdb",
        format="xlsx",
        schema={
            "tables": [
                {
                    "name": "sheet_4_fact_bank_transactions",
                    "columns": [{"name": "date_key"}, {"name": "amount_usd"}],
                }
            ]
        },
        connection_config={},
        project_id=None,
        user_id=None,
        file_path=None,
    )
    db = AsyncMock()
    db.get.return_value = ds

    result = await get_filter_options(
        db,
        uuid4(),
        "month_key",
        "ds-1",
        table_name="sheet_4_fact_bank_transactions",
    )

    assert result == []


@pytest.mark.asyncio
async def test_get_filter_field_stats_missing_table_field_skips_query():
    from uuid import uuid4
    from unittest.mock import AsyncMock
    from src.modules.dashboards.operations import get_filter_field_stats

    ds = SimpleNamespace(
        id="ds-1",
        type="file",
        db_type="duckdb",
        format="xlsx",
        schema={
            "tables": [
                {
                    "name": "sheet_4_fact_bank_transactions",
                    "columns": [{"name": "date_key"}, {"name": "amount_usd"}],
                }
            ]
        },
        connection_config={},
        project_id=None,
        user_id=None,
        file_path=None,
    )
    db = AsyncMock()
    db.get.return_value = ds

    result = await get_filter_field_stats(
        db,
        uuid4(),
        "month_key",
        "ds-1",
        table_name="sheet_4_fact_bank_transactions",
    )

    assert result == {"min": None, "max": None}


def test_apply_drill_context_overrides_x_and_filters():
    base = {"x": "year", "drillPath": ["year", "quarter", "region"], "filters": []}
    ctx = {
        "level": 1,
        "drill_path": ["year", "quarter", "region"],
        "drill_filters": [{"field": "year", "operator": "=", "value": "2024"}],
    }
    merged = apply_drill_context(base, ctx)
    assert merged["x"] == "quarter"
    assert any(f["field"] == "year" and f["value"] == "2024" for f in merged["filters"])
