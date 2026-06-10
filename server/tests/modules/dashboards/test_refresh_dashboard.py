"""Tests for batch dashboard chart refresh."""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from src.modules.dashboards import operations as dash_ops


@pytest.mark.asyncio
async def test_refresh_dashboard_charts_empty():
    result = await dash_ops.refresh_dashboard_charts(MagicMock(), uuid4(), [])
    assert result == {"results": [], "ok": 0, "failed": 0, "total": 0}


@pytest.mark.asyncio
async def test_refresh_dashboard_charts_success_and_failure():
    chart_ok = MagicMock()
    chart_ok.chart_query = {"filters": []}
    chart_fail = MagicMock()
    chart_fail.chart_query = {"filters": []}

    service = MagicMock()
    service.get_chart = AsyncMock(side_effect=lambda _dash, cid: chart_ok if str(cid).endswith("1") else chart_fail)
    service.chart_service.execute = AsyncMock(
        side_effect=lambda chart: {"x": [1]} if chart is chart_ok else (_ for _ in ()).throw(RuntimeError("boom"))
    )

    cid_ok = "00000000-0000-0000-0000-000000000001"
    cid_fail = "00000000-0000-0000-0000-000000000002"

    with patch.object(dash_ops, "DashboardChartService", return_value=service):
        result = await dash_ops.refresh_dashboard_charts(
            MagicMock(),
            uuid4(),
            [
                {"chart_id": cid_ok, "widget_id": "w1"},
                {"chart_id": cid_fail, "widget_id": "w2"},
            ],
        )

    assert result["total"] == 2
    assert result["ok"] == 1
    assert result["failed"] == 1
    by_widget = {r["widget_id"]: r for r in result["results"]}
    assert by_widget["w1"]["success"] is True
    assert by_widget["w1"]["data"] == {"x": [1]}
    assert by_widget["w2"]["success"] is False


@pytest.mark.asyncio
async def test_refresh_dashboard_charts_dedupes_identical_requests():
    chart = MagicMock()
    chart.chart_query = {"filters": []}

    service = MagicMock()
    service.get_chart = AsyncMock(return_value=chart)
    service.chart_service.execute = AsyncMock(return_value={"x": [1]})

    chart_id = str(uuid4())
    with patch.object(dash_ops, "DashboardChartService", return_value=service):
        await dash_ops.refresh_dashboard_charts(
            MagicMock(),
            uuid4(),
            [
                {"chart_id": chart_id, "widget_id": "w1", "runtime_filters": []},
                {"chart_id": chart_id, "widget_id": "w2", "runtime_filters": []},
            ],
        )

    assert service.chart_service.execute.await_count == 1
