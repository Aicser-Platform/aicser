"""
Dashboard collaboration service for Socket.IO real-time updates.

Used by app.modules.collaboration.socketio_manager. When user context is available
(e.g. from JWT in socket handshake), these can delegate to
app.modules.charts.services.dashboard_service. Until then, get_dashboard returns
None on permission/session issues so the server does not crash; widget updates
are no-ops when delegation is not possible.
"""

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


async def get_dashboard(dashboard_id: str) -> Optional[Dict[str, Any]]:
    """
    Load dashboard by ID for collaboration join_dashboard.
    Returns None if not found or on error (e.g. no user context in socketio).
    """
    try:
        from src.db.session import async_session
        from src.modules.charts.services.dashboard_service import DashboardService

        async with async_session() as session:
            svc = DashboardService(session)
            # user_id=None causes RBAC to deny; we catch and return None so socketio does not crash
            return await svc.get_dashboard(dashboard_id, user_id=None)
    except Exception as e:
        logger.debug("dashboards.service.get_dashboard failed for %s: %s", dashboard_id, e)
        return None


async def update_widget(dashboard_id: str, widget_id: str, changes: Dict[str, Any]) -> None:
    """Persist widget update from collaboration. No-op when no user context."""
    try:
        from src.db.session import async_session
        from src.modules.charts.services.dashboard_service import DashboardService
        from src.modules.charts.schemas import DashboardWidgetCreateSchema as WidgetCreateSchema

        async with async_session() as session:
            svc = DashboardService(session)
            data = dict(changes or {})
            data.setdefault("dashboard_id", dashboard_id)
            schema = WidgetCreateSchema(**data)
            await svc.update_widget(dashboard_id, widget_id, schema, user_id=None)
            await session.commit()
    except Exception as e:
        logger.debug("dashboards.service.update_widget failed: %s", e)


async def add_widget(dashboard_id: str, widget: Dict[str, Any]) -> Dict[str, Any]:
    """Persist new widget from collaboration. Returns widget dict (saved or as-is on error)."""
    try:
        from src.db.session import async_session
        from src.modules.charts.services.dashboard_service import DashboardService
        from src.modules.charts.schemas import DashboardWidgetCreateSchema as WidgetCreateSchema

        async with async_session() as session:
            svc = DashboardService(session)
            data = dict(widget) if isinstance(widget, dict) else {}
            data.setdefault("dashboard_id", dashboard_id)
            schema = WidgetCreateSchema(**data)
            out = await svc.create_widget(dashboard_id, schema, user_id=None)
            await session.commit()
            return out or widget
    except Exception as e:
        logger.debug("dashboards.service.add_widget failed: %s", e)
        return widget


async def delete_widget(dashboard_id: str, widget_id: str) -> None:
    """Remove widget from dashboard (collaboration). No-op on error."""
    try:
        from src.db.session import async_session
        from src.modules.charts.services.dashboard_service import DashboardService

        async with async_session() as session:
            svc = DashboardService(session)
            await svc.delete_widget(dashboard_id, widget_id, user_id=None)
            await session.commit()
    except Exception as e:
        logger.debug("dashboards.service.delete_widget failed: %s", e)
