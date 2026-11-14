"""A gauge/stat on a one-row KPI query can carry x = the measure itself (x and yMetrics both
"order_today_count", aggregation "none"). Grouping by x then left the bare measure ungrouped and
DuckDB refused the query ("Chart execution failed"). Such a widget shows the single value."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.modules.charts.services.v2 import chart_service as chart_service_module
from src.modules.charts.services.v2.chart_service import ChartService

SAVED_SQL = 'SELECT COUNT(DISTINCT "order_id") AS order_today_count FROM "ecommerce"."orders"'


def _service() -> ChartService:
    svc = ChartService.__new__(ChartService)
    source = SimpleNamespace(
        id="ds-1", type="database", db_type="duckdb", format=None, schema={}, connection_config={},
        project_id="p-1", user_id="u-1", file_path=None,
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = source
    svc.db = MagicMock()
    svc.db.execute = AsyncMock(return_value=result)
    return svc


def _chart(chart_type: str, aggregation: str, x: str = "order_today_count") -> SimpleNamespace:
    return SimpleNamespace(
        chart_type=chart_type,
        data_source_id="ds-1",
        chart_query={
            "x": x, "xGrain": "day", "sortBy": "x", "sortOrder": "asc", "filters": [],
            "yMetrics": [{"field": "order_today_count", "aggregation": aggregation}],
        },
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("chart_type", ["gauge", "stat"])
@pytest.mark.parametrize("aggregation", ["none", "sum"])
async def test_stat_with_the_measure_as_x_shows_the_single_value(chart_type, aggregation):
    svc = _service()
    engine = MagicMock()
    engine.execute_query = AsyncMock(return_value={"success": True, "data": [{"y_0": 42}]})
    with patch.object(chart_service_module, "get_multi_engine_query_service", return_value=engine):
        out = await svc._execute_saved_query_chart(_chart(chart_type, aggregation), SAVED_SQL)

    assert out == {"value": 42}
    sql = engine.execute_query.await_args.args[0]
    assert "GROUP BY" not in sql.upper()
    assert "DATE_TRUNC" not in sql.upper()
