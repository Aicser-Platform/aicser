"""A dashboard as a paginated PDF report (cover, KPIs, one chart per page, page numbers), rendered
as a given user. Used by "Share → PDF report" and by scheduled report emails, which attach it.

Access is checked for that user every time (a schedule whose owner lost access stops attaching
the report), and the render credential is a single-use embed token revoked right after."""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

logger = logging.getLogger(__name__)


async def render_dashboard_report(
    db,
    dashboard_id: str,
    *,
    user_payload: dict,
    org_id: Optional[str] = None,
) -> tuple[bytes, str, str]:
    """Return (pdf bytes, mime type, dashboard name). Raises HTTPException 404/403 when the user
    can't see the dashboard."""
    from fastapi import HTTPException

    from src.modules.dashboards.operations import verify_dashboard_read_access
    from src.modules.embed import service as embed_service
    from src.modules.exports.playwright_export_service import default_pagination_pdf_options, render_page_export

    try:
        dashboard_uuid = UUID(str(dashboard_id))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Dashboard not found") from exc
    dashboard = await verify_dashboard_read_access(db, dashboard_uuid, current_user=user_payload)
    name = str(getattr(dashboard, "name", None) or getattr(dashboard, "title", None) or "Dashboard")
    user_id = str(user_payload.get("id") or user_payload.get("user_id") or user_payload.get("sub") or "")
    token_record = await embed_service.create_embed_token(
        user_id=user_id,
        org_id=str(org_id) if org_id else None,
        name=f"[export] dashboard report {dashboard_id}",
        scopes=["dashboard"],
        resource_id=str(dashboard_id),
        expires_in_hours=1,
        kind="export",
    )
    try:
        data, mime = await render_page_export(
            embed_path=f"/embed/dashboard/{dashboard_id}?layout=report",
            token=token_record["token"],
            export_format="pdf",
            viewport={"width": 900, "height": 1200},
            pdf_options=default_pagination_pdf_options(org_name=name),
            content_selector='[data-report-ready="true"]',
        )
    finally:
        try:
            await embed_service.revoke_embed_token(user_id, token_record["id"])
        except Exception:
            logger.warning("Failed to revoke short-lived report token %s", token_record.get("id"))
    return data, mime, name
