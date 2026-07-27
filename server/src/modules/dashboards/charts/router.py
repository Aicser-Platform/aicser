from uuid import UUID
from typing import List, Dict, Any, Optional
import copy
from fastapi import APIRouter, Depends, HTTPException, Body, status, Path, Request, Query
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.charts.services.v2.dashboard_chart_service import DashboardChartService
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.helpers import extract_user_payload
from src.modules.authentication.rbac.guard import require_permission, user_id_from_payload
from src.modules.dashboards.permissions import enforce_publish_owner_edit
from src.modules.charts.permissions import enforce_publish_owner_chart_edit
from src.modules.dashboards.chart_data_validation import validate_chart_data
from src.modules.dashboards.operations import merge_runtime_filters, apply_drill_context, verify_dashboard_read_access

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
            "joins": chart_query.get("joins") or [],
            "saved_query_id": chart_query.get("saved_query_id"),
            "query_snapshot_id": chart_query.get("query_snapshot_id") or chart_query.get("snapshot_id"),
            "groupField": chart_query.get("groupField") or chart_query.get("legend"),
            "semantic_metric_id": chart_query.get("semantic_metric_id"),
            "semantic_dimension_ids": chart_query.get("semantic_dimension_ids") or [],
            "drillPath": chart_query.get("drillPath") or [],
            "interactionMode": chart_query.get("interactionMode"),
            "drillThrough": chart_query.get("drillThrough"),
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

    uid = user_id_from_payload(extract_user_payload(current_user))
    await require_permission(uid, "chart:edit")
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
# LINK EXISTING LIBRARY CHART (no copy)
# -------------------------
@router.post("/link", status_code=status.HTTP_201_CREATED)
async def link_chart(
    dashboard_id: UUID = Path(..., description="Dashboard ID"),
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_async_session),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
):
    """Place an existing chart definition on this dashboard (shared instance)."""
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    uid = user_id_from_payload(extract_user_payload(current_user))
    await require_permission(uid, "chart:edit")
    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    raw_id = payload.get("chartId") or payload.get("chart_id")
    if not raw_id:
        raise HTTPException(status_code=400, detail="chartId is required")
    try:
        chart_id = UUID(str(raw_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid chartId")

    layout = payload.get("layout")
    mode = str(payload.get("mode") or "link").strip().lower()
    service = DashboardChartService(db)

    if mode == "copy":
        source = await service.chart_service.get(chart_id)
        if not source:
            raise HTTPException(status_code=404, detail="Chart not found")
        chart = await service.copy_chart_to_dashboard(dashboard_id, source, layout)
        return {**serialize_chart(chart), "linked": False, "copied": True}

    try:
        chart, created = await service.link_existing(dashboard_id, chart_id, layout)
    except ValueError:
        raise HTTPException(status_code=404, detail="Chart not found")
    return {**serialize_chart(chart), "linked": True, "created": created}


@router.delete("/{chart_id}/link", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_chart(
    dashboard_id: UUID,
    chart_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
):
    """Remove placement from dashboard without deleting the library chart."""
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")
    uid = user_id_from_payload(extract_user_payload(current_user))
    await require_permission(uid, "chart:edit")
    await enforce_publish_owner_edit(db, dashboard_id, current_user)
    service = DashboardChartService(db)
    ok = await service.detach(dashboard_id, chart_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Chart placement not found")


# -------------------------
# LIST CHARTS IN DASHBOARD
# -------------------------
@router.get("")
async def list_charts(
    dashboard_id: UUID,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    await verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )
    uid = user_id_from_payload(extract_user_payload(current_user) if current_user else {})
    await require_permission(uid, "chart:view")
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
async def get_chart(
    dashboard_id: UUID,
    chart_id: UUID,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    await verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )
    uid = user_id_from_payload(extract_user_payload(current_user) if current_user else {})
    await require_permission(uid, "chart:view")
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

    uid = user_id_from_payload(extract_user_payload(current_user))
    await require_permission(uid, "chart:edit")
    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    service = DashboardChartService(db)
    success = await service.update_layout(dashboard_id, chart_id, layout)
    
    if not success:
        raise HTTPException(status_code=404, detail="Chart not found in dashboard")
    
    return {"success": True}


# -------------------------
# EXECUTE CHART (Must come before /{chart_id} GET conflicts)
# -------------------------
async def _execute_chart_data(
    dashboard_id: UUID,
    chart_id: UUID,
    db: AsyncSession,
    runtime_filters: Optional[List[dict]] = None,
    drill_context: Optional[dict] = None,
) -> dict:
    service = DashboardChartService(db)
    chart = await service.get_chart(dashboard_id, chart_id)
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")

    exec_chart = chart
    if runtime_filters or drill_context:
        exec_chart = copy.deepcopy(chart)
        base_query = copy.deepcopy(chart.chart_query or {})
        if runtime_filters:
            base_query = merge_runtime_filters(base_query, runtime_filters)
        if drill_context:
            base_query = apply_drill_context(base_query, drill_context)
        exec_chart.chart_query = base_query

    try:
        data = await service.chart_service.execute(exec_chart)
    except ValueError as exc:
        message = str(exc).strip() or "Chart execution failed"
        if "data source not found" in message.lower():
            raise HTTPException(status_code=404, detail="Data source not found") from exc
        raise HTTPException(status_code=400, detail=message) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Chart execution failed") from exc

    validation = validate_chart_data(
        chart.chart_type,
        data,
        chart_query=getattr(exec_chart, "chart_query", None),
    )
    if not validation.valid:
        raise HTTPException(status_code=400, detail=validation.reason or "Chart returned invalid data")

    return {
        "chart": serialize_chart(chart),
        "data": data,
    }


@router.get("/{chart_id}/data")
async def execute_chart(
    dashboard_id: UUID,
    chart_id: UUID,
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    await verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )
    return await _execute_chart_data(dashboard_id, chart_id, db)


@router.post("/{chart_id}/data")
async def execute_chart_with_filters(
    dashboard_id: UUID,
    chart_id: UUID,
    payload: dict = Body(default_factory=dict),
    token: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_async_session),
    current_user: Optional[dict] = Depends(JWTCookieBearer(auto_error=False)),
):
    """Execute chart with dashboard runtime filters merged into chart_query.filters."""
    await verify_dashboard_read_access(
        db, dashboard_id, current_user=current_user, embed_token=token
    )
    runtime_filters = payload.get("runtime_filters") if isinstance(payload, dict) else None
    if runtime_filters is not None and not isinstance(runtime_filters, list):
        raise HTTPException(status_code=400, detail="runtime_filters must be a list")
    drill_context = payload.get("drill_context") if isinstance(payload, dict) else None
    if drill_context is not None and not isinstance(drill_context, dict):
        raise HTTPException(status_code=400, detail="drill_context must be an object")
    return await _execute_chart_data(
        dashboard_id, chart_id, db,
        runtime_filters=runtime_filters or None,
        drill_context=drill_context,
    )


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

    uid = user_id_from_payload(extract_user_payload(current_user))
    await require_permission(uid, "chart:edit")
    await enforce_publish_owner_edit(db, dashboard_id, current_user)
    await enforce_publish_owner_chart_edit(db, chart_id, current_user)

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
    purge: bool = Query(
        False,
        description="If true, also delete the library chart when nothing else references it "
        "(default: unlink only — Metabase/Looker/Tableau 'remove from dashboard' semantics).",
    ),
    db: AsyncSession = Depends(get_async_session),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
):
    """Remove a chart from this dashboard.

    Default: detach placement only (keeps the shared library definition).
    Optional purge=true: delete the chart row when usage_count reaches 0.
    """
    from sqlalchemy import func, select

    from src.modules.dashboards.models import DashboardChart

    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication required")

    uid = user_id_from_payload(extract_user_payload(current_user))
    await require_permission(uid, "chart:delete")
    await enforce_publish_owner_edit(db, dashboard_id, current_user)

    service = DashboardChartService(db)
    chart = await service.get_chart(dashboard_id, chart_id)
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")

    await service.detach(dashboard_id, chart_id)

    if purge:
        remaining = await db.execute(
            select(func.count())
            .select_from(DashboardChart)
            .where(DashboardChart.chart_id == chart_id)
        )
        if int(remaining.scalar() or 0) == 0:
            await service.chart_service.delete(chart)
            await db.commit()
