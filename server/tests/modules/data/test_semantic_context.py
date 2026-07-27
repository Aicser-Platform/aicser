"""Tests for unified semantic context and data model dedup."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock

from src.modules.data.services.semantic_context_service import (
    _normalize_semantic_rows,
    format_join_paths_for_prompt,
    infer_primary_table_sql,
    resolve_semantic_chart_query,
)


def test_format_join_paths_for_prompt():
    paths = [{"from_table": "orders", "from_column": "customer_id", "to_table": "customers", "to_column": "id", "join_type": "LEFT"}]
    text = format_join_paths_for_prompt(paths)
    assert "orders.customer_id" in text
    assert "customers.id" in text


def test_infer_primary_table_sql():
    sql = infer_primary_table_sql({"schema": "public", "tables": [{"name": "orders", "schema": "public"}]})
    assert "public.orders" in sql


def test_normalize_semantic_rows_derives_table_from_expression():
    rows = [{"name": "revenue", "expression": "SUM(fact_sales.revenue_usd)", "type_params": {}}]
    assert _normalize_semantic_rows(rows)[0]["table_name"] == "fact_sales"


@pytest.mark.asyncio
async def test_resolve_semantic_chart_query_metric():
    db = AsyncMock()
    metric_row = ("m1", "revenue", "SUM(amount)", "Total revenue")
    dim_result = MagicMock()
    dim_result.fetchall.return_value = []
    dim_result.keys.return_value = ["id", "name", "expression", "description"]

    metric_result = MagicMock()
    metric_result.fetchone.return_value = metric_row
    metric_result.keys.return_value = ["id", "name", "expression", "description"]

    db.execute = AsyncMock(side_effect=[metric_result, dim_result])

    resolved = await resolve_semantic_chart_query(
        db,
        {"semantic_metric_id": "m1", "semantic_dimension_ids": []},
    )
    assert resolved["yMetrics"][0]["field"] == "SUM(amount)"
    assert resolved.get("aggregate") is True


@pytest.mark.asyncio
async def test_model_auto_detect_dedup(monkeypatch):
    from src.modules.data.model_service import DataModelService

    svc = DataModelService(AsyncMock())
    svc.get_data_source = AsyncMock(
        return_value=MagicMock(
            schema={
                "schema": "public",
                "tables": [
                    {
                        "name": "orders",
                        "columns": [
                            {"name": "customer_id", "is_foreign_key": True, "references_table": "customers", "references_column": "id"},
                        ],
                    }
                ],
            }
        )
    )
    existing = [
        {
            "id": "1",
            "data_source_id": "ds1",
            "from_table": "orders",
            "from_column": "customer_id",
            "to_table": "customers",
            "to_column": "id",
            "join_type": "LEFT",
        }
    ]
    svc.list_relationships = AsyncMock(return_value=existing)
    svc.db.add = MagicMock()
    svc.db.flush = AsyncMock()
    svc.db.commit = AsyncMock()

    result = await svc.auto_detect("ds1")
    svc.db.add.assert_not_called()
    assert result == existing
