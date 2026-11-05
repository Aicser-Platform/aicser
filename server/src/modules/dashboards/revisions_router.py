"""History of charts and alerts: list what changed, and put an older version back."""

from __future__ import annotations

from typing import Any, Dict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.helpers import extract_user_payload
from src.modules.dashboards.models import AssetRevision
from src.shared.asset_revisions import ALERT_FIELDS, CHART_FIELDS, changed_fields

router = APIRouter()
TYPES = {"chart", "alert"}


def _user(token: Any) -> Dict[str, Any]:
    return token if isinstance(token, dict) else extract_user_payload(token)


async def _current(db: AsyncSession, asset_type: str, asset_id: str, token: Any) -> Dict[str, Any]:
    """The asset as it is now, for someone allowed to change it; anyone else gets 404."""
    payload = _user(token)
    try:
        UUID(asset_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Not found") from None
    if asset_type == "chart":
        from src.modules.charts.models import Chart
        from src.modules.charts.permissions import enforce_publish_owner_chart_edit

        chart = await db.get(Chart, UUID(asset_id))
        if chart is None:
            raise HTTPException(status_code=404, detail="Not found")
        await enforce_publish_owner_chart_edit(db, chart.id, payload)
        return {f: getattr(chart, f, None) for f in CHART_FIELDS}
    from src.modules.alerts.alert_rules_service import AlertRulesService
    from src.modules.authentication.rbac.guard import require_permission
    from src.modules.pricing.feature_gate import get_user_organization_id

    user_id = str(payload.get("id") or payload.get("sub") or "")
    org_id = await get_user_organization_id(user_id, db)
    rule = await AlertRulesService(db).get_rule(asset_id, org_id)
    if rule is None:
        raise HTTPException(status_code=404, detail="Not found")
    await require_permission(user_id, "alert:edit", organization_id=str(org_id), project_id=str(rule.get("project_id") or "") or None)
    return {f: rule.get(f) for f in ALERT_FIELDS}


async def _rows(db: AsyncSession, asset_type: str, asset_id: str):
    return (await db.execute(select(AssetRevision).where(AssetRevision.asset_type == asset_type, AssetRevision.asset_id == asset_id)
                             .order_by(desc(AssetRevision.created_at)).limit(50))).scalars().all()


@router.get("/{asset_type}/{asset_id}")
async def list_revisions(asset_type: str, asset_id: str, token: Any = Depends(JWTCookieBearer()), db: AsyncSession = Depends(get_async_session)):
    if asset_type not in TYPES:
        raise HTTPException(status_code=404, detail="Not found")
    current = await _current(db, asset_type, asset_id, token)
    import json

    now = json.loads(json.dumps(current, default=str))
    rows = await _rows(db, asset_type, asset_id)
    return {"revisions": [{"id": str(r.id), "at": r.created_at.isoformat() if r.created_at else None,
                           "changed": changed_fields(r.snapshot, now)} for r in rows]}


@router.post("/{asset_type}/{asset_id}/{revision_id}/restore")
async def restore_revision(asset_type: str, asset_id: str, revision_id: UUID, token: Any = Depends(JWTCookieBearer()),
                           db: AsyncSession = Depends(get_async_session)):
    if asset_type not in TYPES:
        raise HTTPException(status_code=404, detail="Not found")
    await _current(db, asset_type, asset_id, token)
    row = await db.get(AssetRevision, revision_id)
    if row is None or row.asset_type != asset_type or row.asset_id != asset_id:
        raise HTTPException(status_code=404, detail="Not found")
    if asset_type == "chart":
        from src.modules.charts.models import Chart
        from src.modules.charts.services.v2.chart_service import ChartService

        chart = await db.get(Chart, UUID(asset_id))
        await ChartService(db).update(chart, {k: v for k, v in row.snapshot.items() if k != "data_source_id"})
    else:
        from src.modules.alerts.alert_rules_service import AlertRulesService
        from src.modules.pricing.feature_gate import get_user_organization_id

        payload = _user(token)
        org_id = await get_user_organization_id(str(payload.get("id") or payload.get("sub") or ""), db)
        await AlertRulesService(db).update_rule(asset_id, dict(row.snapshot), org_id)
    await db.commit()
    return {"ok": True}
