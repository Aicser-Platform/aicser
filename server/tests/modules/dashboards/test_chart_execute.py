"""Tests for dashboard chart execute with runtime filters."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.modules.dashboards.charts import router as charts_router


@pytest.mark.asyncio
async def test_execute_chart_data_merges_runtime_filters():
    chart = MagicMock()
    chart.chart_query = {"filters": [{"field": "region", "operator": "=", "value": "US"}]}
    chart.chart_type = "bar"
    chart.id = "chart-1"

    service = MagicMock()
    service.get_chart = AsyncMock(return_value=chart)
    service.chart_service.execute = AsyncMock(return_value={"x": ["EU"], "series": [{"name": "Value", "data": [1]}]})

    with patch.object(charts_router, "DashboardChartService", return_value=service):
        result = await charts_router._execute_chart_data(
            dashboard_id="dash-1",
            chart_id="chart-1",
            db=MagicMock(),
            runtime_filters=[{"field": "region", "operator": "eq", "value": "EU"}],
        )

    assert result["data"] == {"x": ["EU"], "series": [{"name": "Value", "data": [1]}]}
    execute_arg = service.chart_service.execute.await_args[0][0]
    assert execute_arg is not chart
    filters = execute_arg.chart_query["filters"]
    assert len(filters) == 1
    assert filters[0]["field"] == "region"
    assert filters[0]["value"] == "EU"


@pytest.mark.asyncio
async def test_execute_chart_data_not_found():
    service = MagicMock()
    service.get_chart = AsyncMock(return_value=None)

    with patch.object(charts_router, "DashboardChartService", return_value=service):
        with pytest.raises(HTTPException) as exc:
            await charts_router._execute_chart_data(
                dashboard_id="dash-1",
                chart_id="missing",
                db=MagicMock(),
            )
    assert exc.value.status_code == 404
