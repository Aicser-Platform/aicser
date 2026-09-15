"""Helpers for immutable feed publication snapshots."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.feed.models import FeedPost, FeedSnapshot
from src.modules.feed.service_utils import _utcnow

MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024  # 4 MB


def _payload_byte_size(payload: Dict[str, Any]) -> int:
    return len(json.dumps(payload, default=str).encode("utf-8"))


def _payload_hash(payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def normalize_snapshot_payload(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not raw or not isinstance(raw, dict):
        return {}
    return raw


def validate_snapshot_payload(payload: Dict[str, Any]) -> None:
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="snapshot_payload is required for snapshot publications",
        )
    size = _payload_byte_size(payload)
    if size > MAX_SNAPSHOT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Snapshot payload exceeds {MAX_SNAPSHOT_BYTES // (1024 * 1024)}MB limit",
        )


def build_snapshot_payload_from_preview(
    asset_type: str,
    preview_metadata: Dict[str, Any],
    *,
    title: str,
    description: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Best-effort snapshot from legacy preview_metadata (insights/charts)."""
    chart_widget = preview_metadata.get("chartWidget")
    if chart_widget and isinstance(chart_widget, dict):
        return {
            "schemaVersion": 1,
            "assetType": asset_type,
            "narrative": {
                "title": title,
                "description": description or preview_metadata.get("summary") or "",
                "questionTitle": preview_metadata.get("questionTitle"),
                "answerExcerpt": preview_metadata.get("excerpt"),
            },
            "visuals": {
                "widgets": [
                    {
                        "id": "snapshot-primary",
                        "chartType": chart_widget.get("chartType"),
                        "chartOptions": chart_widget.get("chartOptions"),
                        "chartData": chart_widget.get("chartData"),
                        "chartQuery": chart_widget.get("chartQuery"),
                        "title": title,
                    }
                ],
                "layout": [{"i": "snapshot-primary", "x": 0, "y": 0, "w": 12, "h": 8}],
            },
            "provenance": {
                "sourcePath": preview_metadata.get("sourcePath") or "/feed",
                "conversationId": preview_metadata.get("conversationId"),
                "messageId": preview_metadata.get("messageId"),
                "dashboardId": preview_metadata.get("dashboardId"),
            },
        }

    layout_summary = preview_metadata.get("layoutSummary")
    if asset_type == "dashboard" and layout_summary:
        return {
            "schemaVersion": 1,
            "assetType": "dashboard",
            "narrative": {
                "title": title,
                "description": description or preview_metadata.get("excerpt") or "",
            },
            "visuals": {
                "widgets": preview_metadata.get("widgets") or [],
                "layout": layout_summary,
                "pages": preview_metadata.get("pages"),
                "filters": preview_metadata.get("filters"),
            },
            "provenance": {
                "sourcePath": "/dashboards",
                "dashboardId": preview_metadata.get("dashboardId"),
            },
        }
    return None


MAX_LIVE_SNAPSHOT_WIDGETS = 24


def _json_safe(value: Any) -> Any:
    """Recursively coerce datetime/date/Decimal/etc. into JSON-serializable
    values. Chart execution results can carry raw date/datetime column values
    straight from the DB driver - fine for an in-process dict, but the JSONB
    column's own serializer has no `default=str` fallback (unlike this
    module's own hashing/size helpers, which already use one), so a chart
    touching a date/timestamp column failed the snapshot INSERT outright
    until sanitized here, once discovered while backfilling live attachments
    created before this function existed."""
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if hasattr(value, "isoformat"):  # datetime.date / datetime.datetime / Decimal-adjacent time types
        return value.isoformat()
    try:
        json.dumps(value)
        return value
    except TypeError:
        return str(value)


async def build_snapshot_payload_from_live_asset(
    db: AsyncSession,
    asset_type: str,
    asset_id: UUID,
    user_id: UUID,
    *,
    title: str,
    description: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Last-resort snapshot builder: fetches the dashboard/chart's OWN current
    config directly and executes its queries server-side, right here, so a
    publish/attach call that supplied neither a client-built snapshot_payload
    nor preview_metadata rich enough for build_snapshot_payload_from_preview
    still lands in render_mode=snapshot instead of silently degrading to
    render_mode=live. Without this, staying on the snapshot architecture
    depended on every single frontend call site remembering to build and pass
    a payload - miss one (as several already had, before being fixed one by
    one) and that publication was live forever, with no server-side backstop.
    This makes "no new one falls through to live" true regardless of what any
    given caller sends, for the two asset types that actually have queryable
    data to snapshot.

    Reuses the exact services the live dashboard viewer itself uses
    (DashboardChartService for the dashboard_charts join + layout,
    ChartService.execute for real query execution) rather than a second,
    parallel data-fetching path. Best-effort: returns None (never raises) so
    a broken/slow chart can't block the publish itself - the caller's own
    fallback chain (render_mode=live) still applies if this also comes up
    empty, exactly as before this existed.
    """
    from src.modules.charts.models import Chart
    from src.modules.charts.services.v2.dashboard_chart_service import DashboardChartService
    from src.modules.dashboards.models import Dashboard
    from src.modules.data.services.query_identity import QueryIdentity

    try:
        if asset_type == "dashboard":
            dashboard = await db.get(Dashboard, asset_id)
            if not dashboard:
                return None
            svc = DashboardChartService(db)
            rows = await svc.list_charts_with_layout(asset_id)
            if not rows:
                return None
            identity = QueryIdentity(
                user_id=str(user_id),
                organization_id=None,
                project_id=str(dashboard.project_id) if dashboard.project_id else None,
                token_payload={},
            )
            widgets: list[Dict[str, Any]] = []
            layout: list[Dict[str, Any]] = []
            for chart, chart_layout in rows[:MAX_LIVE_SNAPSHOT_WIDGETS]:
                try:
                    chart_data = _json_safe(await svc.chart_service.execute(chart, identity=identity))
                except Exception:
                    # One widget's query failing shouldn't drop the whole
                    # snapshot - it just renders without data for that widget,
                    # same as a live view where a single chart's fetch fails.
                    chart_data = None
                widgets.append(
                    {
                        "id": str(chart.id),
                        "title": chart.title,
                        "chartType": chart.chart_type,
                        "chartOptions": chart.chart_options,
                        "chartData": chart_data,
                        "chartQuery": chart.chart_query,
                    }
                )
                pos = chart_layout or {}
                layout.append(
                    {
                        "i": str(chart.id),
                        "x": pos.get("x", 0),
                        "y": pos.get("y", 0),
                        "w": pos.get("w", 6),
                        "h": pos.get("h", 4),
                    }
                )
            if not widgets:
                return None
            return {
                "schemaVersion": 1,
                "assetType": "dashboard",
                "narrative": {
                    "title": title,
                    "description": description or dashboard.description or "",
                },
                "visuals": {"widgets": widgets, "layout": layout},
                "provenance": {"sourcePath": "/dashboards", "dashboardId": str(asset_id)},
            }

        if asset_type == "chart":
            chart = await db.get(Chart, asset_id)
            if not chart:
                return None
            svc = DashboardChartService(db)
            identity = QueryIdentity(
                user_id=str(user_id),
                organization_id=None,
                project_id=str(chart.project_id) if chart.project_id else None,
                token_payload={},
            )
            try:
                chart_data = _json_safe(await svc.chart_service.execute(chart, identity=identity))
            except Exception:
                chart_data = None
            return {
                "schemaVersion": 1,
                "assetType": "chart",
                "narrative": {"title": title, "description": description or ""},
                "visuals": {
                    "widgets": [
                        {
                            "id": str(chart.id),
                            "title": chart.title,
                            "chartType": chart.chart_type,
                            "chartOptions": chart.chart_options,
                            "chartData": chart_data,
                            "chartQuery": chart.chart_query,
                        }
                    ],
                    "layout": [{"i": str(chart.id), "x": 0, "y": 0, "w": 12, "h": 8}],
                },
                "provenance": {"sourcePath": "/chart-designer", "chartId": str(asset_id)},
            }
    except Exception:
        return None

    return None


async def create_feed_snapshot(
    db: AsyncSession,
    *,
    post: FeedPost,
    payload: Dict[str, Any],
    created_by: UUID,
    thumbnail_url: Optional[str] = None,
) -> FeedSnapshot:
    validate_snapshot_payload(payload)
    next_version = await db.scalar(
        select(func.coalesce(func.max(FeedSnapshot.version), 0)).where(
            FeedSnapshot.post_id == post.id
        )
    )
    version = int(next_version or 0) + 1
    captured_at = _utcnow()
    payload = {**payload, "capturedAt": captured_at.isoformat()}
    snapshot = FeedSnapshot(
        post_id=post.id,
        version=version,
        payload=payload,
        payload_hash=_payload_hash(payload),
        byte_size=_payload_byte_size(payload),
        filter_state=(payload.get("visuals") or {}).get("filters"),
        captured_at=captured_at,
        created_by=created_by,
        thumbnail_url=thumbnail_url,
    )
    db.add(snapshot)
    await db.flush()
    post.render_mode = "snapshot"
    post.current_snapshot_id = snapshot.id
    post.snapshot_version = version
    return snapshot
