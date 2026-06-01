"""
Real-time dashboard collaboration persistence for the studio chart model.

Maps client WidgetInstance payloads to DashboardChartService (charts + layout),
using the authenticated socket user for RBAC checks.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Mapping, Optional
from uuid import UUID

from src.modules.dashboards.charts.router import normalize_chart_payload, serialize_chart

logger = logging.getLogger(__name__)

_WIDGET_ID_PREFIX = re.compile(r"^widget-")


def resolve_socket_user_id(user: Optional[Mapping[str, Any]]) -> Optional[str]:
    if not user:
        return None
    for key in ("user_id", "id", "sub"):
        val = user.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    return None


def chart_id_from_widget(widget_id: str, payload: Optional[Mapping[str, Any]] = None) -> Optional[str]:
    if payload:
        chart_id = payload.get("chartId") or payload.get("chart_id")
        if chart_id:
            return str(chart_id)
    wid = str(widget_id or "").strip()
    if not wid:
        return None
    if _WIDGET_ID_PREFIX.match(wid):
        return wid.split("widget-", 1)[1] or None
    return wid


def _layout_from_client(layout: Optional[Mapping[str, Any]]) -> Optional[dict]:
    if not layout:
        return None
    out: dict[str, Any] = {
        "x": layout.get("x", 0),
        "y": layout.get("y", 0),
        "w": layout.get("w", 4),
        "h": layout.get("h", 5),
    }
    page_id = layout.get("pageId") or layout.get("page_id")
    if page_id:
        out["page_id"] = str(page_id)
    return out


def _client_widget_payload(widget: Mapping[str, Any], layout: Optional[Mapping[str, Any]] = None) -> dict:
    body = dict(widget)
    client_layout = _layout_from_client(layout)
    if client_layout:
        body["layout"] = client_layout
    return body


async def persist_widget_update(
    dashboard_id: str,
    widget_id: str,
    changes: Dict[str, Any],
    user: Optional[Mapping[str, Any]] = None,
) -> Optional[dict]:
    user_id = resolve_socket_user_id(user)
    if not user_id:
        return None
    chart_id = chart_id_from_widget(widget_id, changes)
    if not chart_id:
        return None

    try:
        from src.db.session import AsyncSessionLocal
        from src.modules.authentication.rbac.guard import require_permission
        from src.modules.dashboards.permissions import enforce_publish_owner_edit
        from src.modules.charts.permissions import enforce_publish_owner_chart_edit
        from src.modules.charts.services.v2.dashboard_chart_service import DashboardChartService

        dash_uuid = UUID(str(dashboard_id))
        chart_uuid = UUID(str(chart_id))

        async with AsyncSessionLocal() as db:
            await require_permission(user_id, "chart:edit")
            await enforce_publish_owner_edit(db, dash_uuid, {"id": user_id})
            await enforce_publish_owner_chart_edit(db, chart_uuid, {"id": user_id})

            service = DashboardChartService(db)
            chart = await service.get_chart(dash_uuid, chart_uuid)
            if not chart:
                return None

            chart_payload, _ = normalize_chart_payload(_client_widget_payload(changes))
            update_data = {k: v for k, v in chart_payload.items() if v is not None}
            updated = await service.chart_service.update(chart, update_data)
            await db.commit()
            return serialize_chart(updated)
    except Exception as exc:
        logger.debug("collaboration persist_widget_update failed: %s", exc)
        return None


async def persist_widget_add(
    dashboard_id: str,
    widget: Dict[str, Any],
    layout: Optional[Dict[str, Any]] = None,
    user: Optional[Mapping[str, Any]] = None,
) -> Optional[dict]:
    user_id = resolve_socket_user_id(user)
    if not user_id:
        return None

    try:
        from src.db.session import AsyncSessionLocal
        from src.modules.authentication.rbac.guard import require_permission
        from src.modules.dashboards.permissions import enforce_publish_owner_edit
        from src.modules.charts.services.v2.dashboard_chart_service import DashboardChartService

        dash_uuid = UUID(str(dashboard_id))

        async with AsyncSessionLocal() as db:
            await require_permission(user_id, "chart:edit")
            await enforce_publish_owner_edit(db, dash_uuid, {"id": user_id})

            service = DashboardChartService(db)
            chart_payload, parsed_layout = normalize_chart_payload(_client_widget_payload(widget, layout))
            chart_payload["dashboard_id"] = str(dashboard_id)
            created = await service.create(dash_uuid, chart_payload, parsed_layout or _layout_from_client(layout))
            return serialize_chart(created)
    except Exception as exc:
        logger.debug("collaboration persist_widget_add failed: %s", exc)
        return None


async def persist_widget_remove(
    dashboard_id: str,
    widget_id: str,
    widget: Optional[Dict[str, Any]] = None,
    user: Optional[Mapping[str, Any]] = None,
) -> bool:
    user_id = resolve_socket_user_id(user)
    if not user_id:
        return False
    chart_id = chart_id_from_widget(widget_id, widget)
    if not chart_id:
        return False

    try:
        from src.db.session import AsyncSessionLocal
        from src.modules.authentication.rbac.guard import require_permission
        from src.modules.dashboards.permissions import enforce_publish_owner_edit
        from src.modules.charts.services.v2.dashboard_chart_service import DashboardChartService

        dash_uuid = UUID(str(dashboard_id))
        chart_uuid = UUID(str(chart_id))

        async with AsyncSessionLocal() as db:
            await require_permission(user_id, "chart:delete")
            await enforce_publish_owner_edit(db, dash_uuid, {"id": user_id})

            service = DashboardChartService(db)
            chart = await service.get_chart(dash_uuid, chart_uuid)
            if not chart:
                return False

            dashboard_chart = await service.get_dashboard_chart(dash_uuid, chart_uuid)
            if dashboard_chart:
                await db.delete(dashboard_chart)
            await service.chart_service.delete(chart)
            await db.commit()
            return True
    except Exception as exc:
        logger.debug("collaboration persist_widget_remove failed: %s", exc)
        return False


async def persist_layout_update(
    dashboard_id: str,
    layout: list,
    user: Optional[Mapping[str, Any]] = None,
) -> bool:
    user_id = resolve_socket_user_id(user)
    if not user_id or not layout:
        return False

    try:
        from src.db.session import AsyncSessionLocal
        from src.modules.authentication.rbac.guard import require_permission
        from src.modules.dashboards.permissions import enforce_publish_owner_edit
        from src.modules.charts.services.v2.dashboard_chart_service import DashboardChartService

        dash_uuid = UUID(str(dashboard_id))

        async with AsyncSessionLocal() as db:
            await require_permission(user_id, "chart:edit")
            await enforce_publish_owner_edit(db, dash_uuid, {"id": user_id})

            service = DashboardChartService(db)
            updated_any = False
            for item in layout:
                if not isinstance(item, dict):
                    continue
                widget_key = item.get("i")
                chart_id = chart_id_from_widget(str(widget_key or ""), item)
                if not chart_id:
                    continue
                layout_payload = _layout_from_client(item)
                if not layout_payload:
                    continue
                ok = await service.update_layout(dash_uuid, UUID(chart_id), layout_payload)
                updated_any = updated_any or ok
            return updated_any
    except Exception as exc:
        logger.debug("collaboration persist_layout_update failed: %s", exc)
        return False
