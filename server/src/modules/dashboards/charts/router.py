from uuid import UUID
from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Body, status, Path, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.charts.services.v2.dashboard_chart_service import DashboardChartService
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.dashboards.permissions import enforce_publish_owner_edit

router = APIRouter()


# -------------------------
# Helpers
# -------------------------
def normalize_chart_payload(payload: dict) -> tuple[dict, dict | None]:
    """Returns (chart_payload, layout)"""
    chart_query = payload.get("chartQuery") or {}

    chart_type = payload.get("chartType")
    is_text = chart_type == 'text'

    chart_payload = {
        "data_source_id": payload.get("dataSourceId"),
        "chart_type": chart_type,
        "title": payload.get("title"),
        "chart_query": {} if is_text else {
            "tableName": chart_query.get("tableName"),
            "x": chart_query.get("x") or chart_query.get("xField"),
            "aggregate": chart_query.get("aggregate", "count"),
            "yMetric": chart_query.get("yMetric"),
            "xMetrics": chart_query.get("xMetrics", []),
            "yMetrics": chart_query.get("yMetrics", []),
            "yMetricsSecondary": chart_query.get("yMetricsSecondary", []),
            "y": chart_query.get("y"),
            "legend": chart_query.get("legend"),
            "sortBy": chart_query.get("sortBy"),
            "sortOrder": chart_query.get("sortOrder"),  # asc or desc
            "filters": chart_query.get("filters", []),
            "metricFilters": chart_query.get("metricFilters", []),
            "limit": chart_query.get("limit"),
            "seriesLimit": chart_query.get("seriesLimit"),
        },
        "chart_options": payload.get("chartOptions"),
    }
    
    # Extract layout (x, y, w, h) if provided
    layout = payload.get("layout")
    
    return chart_payload, layout


def serialize_chart(chart) -> dict:
    return {
        "id": str(chart.id),
        "dataSourceId": chart.data_source_id,
        "chartType": chart.chart_type,
        "title": chart.title,
        "chartQuery": chart.chart_query,
        "chartOptions": chart.chart_options,
    }


# -------------------------
# CREATE CHART
# -------------------------

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_chart(
    request: Request,
    dashboard_id: UUID = Path(..., description="Dashboard ID (from path)"),
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_async_session),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
):
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    chart_payload, layout = normalize_chart_payload(payload)
    # Ensure dashboard_id is set in the chart payload for DB integrity
    chart_payload["dashboard_id"] = str(dashboard_id)
    # Improved debug logging
    print(f"[CREATE CHART] Path: {request.url.path} Method: {request.method}")
    print(f"[CREATE CHART] Received layout: {layout}")
    print(f"[CREATE CHART] Full payload: {payload}")
    print(f"[CREATE CHART] dashboard_id (from path): {dashboard_id}")

    service = DashboardChartService(db)
    chart = await service.create(dashboard_id, chart_payload, layout)
    return serialize_chart(chart)


# -------------------------
# LIST CHARTS IN DASHBOARD
# -------------------------
@router.get("")
async def list_charts(dashboard_id: UUID, db: AsyncSession = Depends(get_async_session)):
    service = DashboardChartService(db)
    charts_with_layout = await service.list_charts_with_layout(dashboard_id)
    return [
        {
            **serialize_chart(chart),
            "layout": layout,
        }
        for chart, layout in charts_with_layout
    ]


# -------------------------
# GET SINGLE CHART
# -------------------------
@router.get("/{chart_id}")
async def get_chart(dashboard_id: UUID, chart_id: UUID, db: AsyncSession = Depends(get_async_session)):
    service = DashboardChartService(db)
    chart = await service.get_chart(dashboard_id, chart_id)
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")
    return serialize_chart(chart)


# -------------------------
# UPDATE CHART LAYOUT (Must come before /{chart_id} PUT)
# -------------------------
@router.get("/{chart_id}/layout", status_code=status.HTTP_200_OK)
async def get_chart_layout(
    dashboard_id: UUID,
    chart_id: UUID,
    db: AsyncSession = Depends(get_async_session),
):
    """Get the layout (x, y, w, h) for a chart in the dashboard."""
    service = DashboardChartService(db)
    dashboard_chart = await service.get_dashboard_chart(dashboard_id, chart_id)

    if not dashboard_chart:
        raise HTTPException(status_code=404, detail="Chart not found in dashboard")

    return dashboard_chart.layout or {}


@router.put("/{chart_id}/layout", status_code=status.HTTP_200_OK)
async def update_chart_layout(
    dashboard_id: UUID,
    chart_id: UUID,
    layout: dict = Body(...),
    db: AsyncSession = Depends(get_async_session),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
):
    """Update the layout (x, y, w, h) for a chart in the dashboard"""
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    service = DashboardChartService(db)
    success = await service.update_layout(dashboard_id, chart_id, layout)
    
    if not success:
        raise HTTPException(status_code=404, detail="Chart not found in dashboard")
    
    return {"success": True}


# -------------------------
# EXECUTE CHART (Must come before /{chart_id} GET conflicts)
# -------------------------
@router.get("/{chart_id}/data")
async def execute_chart(dashboard_id: UUID, chart_id: UUID, db: AsyncSession = Depends(get_async_session)):
    service = DashboardChartService(db)
    chart = await service.get_chart(dashboard_id, chart_id)
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")

    data = await service.chart_service.execute(chart)
    return {
        "chart": serialize_chart(chart),
        "data": data,
    }


# -------------------------
# UPDATE CHART
# -------------------------
@router.put("/{chart_id}", status_code=status.HTTP_200_OK)
async def update_chart(
    dashboard_id: UUID,
    chart_id: UUID,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_async_session),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
):
    """Update chart data (title, type, query, options)"""
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    service = DashboardChartService(db)
    chart = await service.get_chart(dashboard_id, chart_id)
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")

    chart_payload, _ = normalize_chart_payload(payload)
    
    # Remove None values from payload
    update_data = {k: v for k, v in chart_payload.items() if v is not None}
    
    updated_chart = await service.chart_service.update(chart, update_data)
    await service.db.commit()
    
    return serialize_chart(updated_chart)


# -------------------------
# DELETE CHART
# -------------------------
@router.delete("/{chart_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chart(
    dashboard_id: UUID,
    chart_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
):
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    service = DashboardChartService(db)
    chart = await service.get_chart(dashboard_id, chart_id)
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")
    
    # Delete chart and related dashboard_chart records
    await service.chart_service.delete(chart)
    await db.commit()
