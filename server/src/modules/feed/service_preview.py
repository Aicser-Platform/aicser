"""Real asset preview resolution for feed posts."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional, Sequence
from uuid import UUID

from sqlalchemy import select

from src.modules.charts.models import Chart
from src.modules.dashboards.models import Dashboard, DashboardChart
from src.modules.feed.models import FeedPost, FeedSnapshot
from src.modules.feed.schemas import AssetType
from src.modules.feed.service_utils import _enum_value, _normalize_asset_payload, _sanitize_preview_data


class FeedServicePreviewMixin:
    db: Any

    def _fallback_preview_payload(self, post: FeedPost) -> Dict[str, Any]:
        asset_type = _enum_value(post.asset_type)
        meta = getattr(post, "preview_metadata", None) or {}
        preview_label_map = {
            AssetType.dashboard.value: "Live Dashboard",
            AssetType.chart.value: "Interactive Chart",
            AssetType.insight.value: "Insight Snapshot",
            AssetType.query.value: "Saved Query",
        }
        payload: Dict[str, Any] = {
            "summary": post.description or meta.get("excerpt") or f"{post.title or 'Insight'} — {asset_type}",
            "previewLabel": meta.get("previewLabel") or preview_label_map.get(asset_type, "Analytics"),
            "previewType": meta.get("previewType") or ("dashboard" if asset_type == AssetType.dashboard.value else "bar"),
            "previewData": meta.get("previewData") or [],
            "previews": meta.get("previews") or [],
        }
        for key in (
            "chartWidget",
            "dashboardId",
            "sourceQueryId",
            "excerpt",
            "questionTitle",
            "conversationId",
            "messageId",
        ):
            if meta.get(key) is not None:
                payload[key] = meta[key]
        return _normalize_asset_payload(payload)

    def _payload_from_snapshot(
        self,
        post: FeedPost,
        snapshot: FeedSnapshot,
        *,
        max_widgets: Optional[int] = None,
    ) -> Dict[str, Any]:
        raw = snapshot.payload or {}
        narrative = raw.get("narrative") or {}
        visuals = raw.get("visuals") or {}
        widgets = visuals.get("widgets") or []
        rendered_raw = raw
        if max_widgets is not None and len(widgets) > max_widgets:
            presentation = visuals.get("presentation") or {}
            featured_ids = presentation.get("featuredWidgetIds") or []
            widget_by_id = {
                str(widget.get("id")): widget
                for widget in widgets
                if isinstance(widget, dict) and widget.get("id") is not None
            }
            rendered_widgets = []
            rendered_widget_ids = set()
            for widget_id in featured_ids:
                widget = widget_by_id.get(str(widget_id))
                if widget is not None and str(widget_id) not in rendered_widget_ids:
                    rendered_widgets.append(widget)
                    rendered_widget_ids.add(str(widget_id))
            for widget in widgets:
                widget_id = str(widget.get("id")) if isinstance(widget, dict) else ""
                if widget_id not in rendered_widget_ids:
                    rendered_widgets.append(widget)
                    rendered_widget_ids.add(widget_id)
            rendered_widgets = rendered_widgets[:max_widgets]
            rendered_ids = {
                str(widget.get("id"))
                for widget in rendered_widgets
                if isinstance(widget, dict) and widget.get("id") is not None
            }
            rendered_visuals = {**visuals, "widgets": rendered_widgets}
            layout = visuals.get("layout")
            if isinstance(layout, list) and rendered_ids:
                rendered_visuals["layout"] = [
                    item
                    for item in layout
                    if isinstance(item, dict) and str(item.get("i")) in rendered_ids
                ]
            rendered_raw = {**raw, "visuals": rendered_visuals}

        asset_type = _enum_value(post.asset_type)
        title = narrative.get("title") or post.title or "Insight"
        description = narrative.get("description") or post.description or ""

        payload: Dict[str, Any] = {
            "summary": description or title,
            "previewLabel": title,
            "previewType": raw.get("previewType") or ("dashboard" if asset_type == "dashboard" else "insight"),
            "previewData": raw.get("previewData") or [],
            "previews": raw.get("previews") or [],
            "snapshotPayload": rendered_raw,
            "snapshotCapturedAt": snapshot.captured_at.isoformat() if snapshot.captured_at else raw.get("capturedAt"),
            "widgetCount": len(widgets),
            "thumbnailUrl": snapshot.thumbnail_url,
            "excerpt": narrative.get("answerExcerpt") or narrative.get("description"),
            "questionTitle": narrative.get("questionTitle"),
        }

        provenance = raw.get("provenance") or {}
        for key in ("conversationId", "messageId", "dashboardId", "sourceQueryId"):
            if provenance.get(key) is not None:
                payload[key] = provenance[key]

        if len(widgets) == 1:
            widget = widgets[0]
            payload["chartWidget"] = {
                "chartType": widget.get("chartType"),
                "chartData": widget.get("chartData"),
                "chartOptions": widget.get("chartOptions"),
                "chartQuery": widget.get("chartQuery"),
            }
            chart_type = (widget.get("chartType") or "bar").lower()
            if chart_type in ("bar", "line", "pie", "area"):
                payload["previewType"] = chart_type

        return _normalize_asset_payload(payload)

    async def _load_preview_payloads(
        self,
        posts: Sequence[FeedPost],
        *,
        max_snapshot_widgets: Optional[int] = None,
    ) -> Dict[UUID, Dict[str, Any]]:
        if not posts:
            return {}

        payloads: Dict[UUID, Dict[str, Any]] = {}
        snapshot_posts: List[FeedPost] = []
        live_posts: List[FeedPost] = []

        for post in posts:
            render_mode = _enum_value(getattr(post, "render_mode", None)) or "live"
            snap_id = getattr(post, "current_snapshot_id", None)
            if render_mode == "snapshot" and snap_id:
                snapshot_posts.append(post)
            else:
                live_posts.append(post)

        if snapshot_posts:
            snap_ids = [p.current_snapshot_id for p in snapshot_posts if p.current_snapshot_id]
            snap_result = await self.db.execute(select(FeedSnapshot).where(FeedSnapshot.id.in_(snap_ids)))
            snap_map = {row.id: row for row in snap_result.scalars().all()}
            for post in snapshot_posts:
                snap = snap_map.get(post.current_snapshot_id)
                if snap:
                    payloads[post.id] = self._payload_from_snapshot(
                        post,
                        snap,
                        max_widgets=max_snapshot_widgets,
                    )

        posts = live_posts
        if not posts:
            return {post_id: _normalize_asset_payload(payload) for post_id, payload in payloads.items()}

        by_type: Dict[str, List[FeedPost]] = defaultdict(list)
        for post in posts:
            by_type[_enum_value(post.asset_type)].append(post)

        dashboard_posts = by_type.get(AssetType.dashboard.value, [])
        if dashboard_posts:
            dashboard_ids = [post.asset_id for post in dashboard_posts if post.asset_id]
            dashboards = {}
            if dashboard_ids:
                result = await self.db.execute(select(Dashboard).where(Dashboard.id.in_(dashboard_ids)))
                dashboards = {row.id: row for row in result.scalars().all()}

            chart_rows = []
            if dashboard_ids:
                chart_result = await self.db.execute(
                    select(DashboardChart, Chart)
                    .join(Chart, Chart.id == DashboardChart.chart_id, isouter=True)
                    .where(DashboardChart.dashboard_id.in_(dashboard_ids))
                    .limit(50)
                )
                chart_rows = chart_result.all()

            charts_by_dashboard: Dict[UUID, List[Chart]] = defaultdict(list)
            for dash_chart, chart in chart_rows:
                if chart and dash_chart.dashboard_id:
                    charts_by_dashboard[dash_chart.dashboard_id].append(chart)

            for post in dashboard_posts:
                dashboard = dashboards.get(post.asset_id)
                charts = charts_by_dashboard.get(post.asset_id, [])[:5]
                previews = []
                for chart in charts:
                    chart_type = (chart.chart_type or "bar").lower()
                    if chart_type not in ("bar", "line", "pie", "dashboard"):
                        chart_type = "bar"
                    previews.append(
                        {
                            "type": chart_type,
                            "label": chart.title or "Chart",
                            "data": [],
                        }
                    )
                title = dashboard.name if dashboard and dashboard.name else post.title
                payloads[post.id] = {
                    "summary": post.description or f"Dashboard with {len(charts)} chart(s)",
                    "previewLabel": title or "Live Dashboard",
                    "previewType": "dashboard",
                    "previewData": [],
                    "previews": previews or [{"type": "dashboard", "label": title or "Dashboard", "data": []}],
                }

        chart_posts = by_type.get(AssetType.chart.value, [])
        if chart_posts:
            chart_ids = [post.asset_id for post in chart_posts if post.asset_id]
            charts_map = {}
            dashboard_by_chart: Dict[UUID, UUID] = {}
            if chart_ids:
                result = await self.db.execute(select(Chart).where(Chart.id.in_(chart_ids)))
                charts_map = {row.id: row for row in result.scalars().all()}
                dash_result = await self.db.execute(
                    select(DashboardChart.chart_id, DashboardChart.dashboard_id).where(
                        DashboardChart.chart_id.in_(chart_ids)
                    )
                )
                for chart_id, dashboard_id in dash_result.all():
                    if chart_id and dashboard_id:
                        dashboard_by_chart[chart_id] = dashboard_id

            for post in chart_posts:
                chart = charts_map.get(post.asset_id)
                chart_type = (getattr(chart, "chart_type", None) or "bar").lower()
                if chart_type not in ("bar", "line", "pie"):
                    chart_type = "bar"
                title = (getattr(chart, "title", None) or post.title or "Chart").strip()
                dashboard_id = dashboard_by_chart.get(post.asset_id)
                payloads[post.id] = _normalize_asset_payload(
                    {
                        "summary": post.description or title,
                        "previewLabel": title,
                        "previewType": chart_type,
                        "previewData": [],
                        "previews": [{"type": chart_type, "label": title, "data": []}],
                        **({"dashboardId": str(dashboard_id)} if dashboard_id else {}),
                    }
                )

        insight_posts = by_type.get(AssetType.insight.value, [])
        for post in insight_posts:
            meta = getattr(post, "preview_metadata", None) or {}
            preview_type = meta.get("previewType", "insight")
            preview_data = _sanitize_preview_data(meta.get("previewData") or [])
            chart_widget = meta.get("chartWidget")
            previews = meta.get("previews") or [{"type": preview_type, "data": preview_data}]
            payloads[post.id] = _normalize_asset_payload(
                {
                    "summary": post.description or post.title or "Insight",
                    "previewLabel": meta.get("previewLabel") or post.title or "Insight Snapshot",
                    "previewType": preview_type,
                    "previewData": preview_data,
                    "previews": previews,
                    "chartWidget": chart_widget,
                    "excerpt": meta.get("excerpt"),
                    "questionTitle": meta.get("questionTitle"),
                    "conversationId": meta.get("conversationId"),
                    "messageId": meta.get("messageId"),
                }
            )

        query_posts = by_type.get(AssetType.query.value, [])
        for post in query_posts:
            meta = getattr(post, "preview_metadata", None) or {}
            sql_snippet = meta.get("sql") or meta.get("sqlSnippet") or ""
            source_query_id = meta.get("sourceQueryId")
            payloads[post.id] = _normalize_asset_payload(
                {
                    "summary": post.description or sql_snippet[:200] or "Saved SQL query",
                    "previewLabel": post.title or "Saved Query",
                    "previewType": "line",
                    "previewData": meta.get("previewData") or [],
                    "previews": [{"type": "line", "label": "Query", "data": meta.get("previewData") or []}],
                    **({"sourceQueryId": str(source_query_id)} if source_query_id else {}),
                }
            )

        for post in posts:
            if post.id not in payloads:
                payloads[post.id] = self._fallback_preview_payload(post)

        return {post_id: _normalize_asset_payload(payload) for post_id, payload in payloads.items()}
