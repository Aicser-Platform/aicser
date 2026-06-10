"""Remix feed snapshot payloads into editable dashboards."""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.core.edition import is_ee_enabled
from src.modules.charts.services.v2.dashboard_chart_service import DashboardChartService
from src.modules.charts.services.v2.dashboard_service import DashboardService
from src.modules.dashboards.models import Dashboard
from src.modules.feed.models import FeedPost, FeedSnapshot


def _layout_for_widget(widget_id: str, index: int, layout_items: List[Mapping[str, Any]]) -> Dict[str, Any]:
    for entry in layout_items:
        if str(entry.get("i")) == widget_id:
            return dict(entry)
    return {"i": widget_id, "x": 0, "y": index * 5, "w": 6, "h": 5}


async def remix_snapshot_to_dashboard(
    db: AsyncSession,
    *,
    post: FeedPost,
    snapshot: FeedSnapshot,
    user_id: UUID,
    project_id: Optional[UUID] = None,
    referral_code: Optional[str] = None,
) -> Dashboard:
    raw = snapshot.payload or {}
    narrative = raw.get("narrative") or {}
    visuals = raw.get("visuals") or {}
    widgets: List[Mapping[str, Any]] = list(visuals.get("widgets") or [])
    layout_items: List[Mapping[str, Any]] = list(visuals.get("layout") or [])
    filters_block = visuals.get("filters") or {}

    source_title = (narrative.get("title") or post.title or "Insight").strip()
    remix_title = f"Remix: {source_title}"[:255]

    remix_meta = {
        "feedPostId": str(post.id),
        "sourceAuthorId": str(post.author_id) if post.author_id else None,
        "referralCode": (referral_code or "").strip() or None,
        "snapshotVersion": int(post.snapshot_version or 0),
    }

    dashboard_service = DashboardService(db)
    dashboard = await dashboard_service.create(
        {
            "name": remix_title,
            "description": narrative.get("description") or post.description,
            "project_id": project_id if is_ee_enabled() else None,
            "config": {
                "remix": remix_meta,
                "global_filters": filters_block.get("config") or [],
                "executive_meta": {
                    "keyInsight": narrative.get("answerExcerpt") or narrative.get("description"),
                    "storyArc": narrative.get("questionTitle"),
                },
            },
        }
    )

    if not widgets:
        widgets = [
            {
                "id": "remix-primary",
                "title": source_title,
                "chartType": "bar",
                "chartOptions": {"feedRemixPlaceholder": True},
                "chartData": {},
                "chartQuery": {},
            }
        ]

    chart_service = DashboardChartService(db)
    ee_project = project_id if is_ee_enabled() else None

    for index, widget in enumerate(widgets):
        widget_id = str(widget.get("id") or f"remix-{index}")
        chart_options = dict(widget.get("chartOptions") or {})
        snapshot_data = widget.get("chartData")
        if snapshot_data:
            chart_options["snapshotChartData"] = snapshot_data
        chart_options["feedRemix"] = True
        chart_options["remixSourcePostId"] = str(post.id)

        chart_payload: Dict[str, Any] = {
            "chart_type": str(widget.get("chartType") or "bar"),
            "title": str(widget.get("title") or source_title)[:500],
            "chart_query": dict(widget.get("chartQuery") or {}),
            "chart_options": chart_options,
            "user_id": user_id,
            "project_id": ee_project,
        }

        layout = _layout_for_widget(widget_id, index, layout_items)
        await chart_service.create(
            dashboard.id,
            chart_payload,
            layout,
        )

    return dashboard
