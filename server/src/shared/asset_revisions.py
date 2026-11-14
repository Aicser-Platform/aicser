"""Keeping what a chart or alert was before each change, so any change can be undone later."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from sqlalchemy import delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

CHART_FIELDS = ("title", "chart_type", "chart_query", "chart_options", "data_source_id")
ALERT_FIELDS = ("name", "description", "condition_sql", "threshold_operator", "threshold_value", "window_minutes", "severity", "channels")
KEEP_PER_ASSET = 50


def _plain(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


async def keep(db: AsyncSession, asset_type: str, asset_id: Any, snapshot: Dict[str, Any], user_id: Optional[str] = None) -> None:
    """Add a revision, unless nothing changed since the last. Never gets in the way of the save itself."""
    from src.modules.dashboards.models import AssetRevision

    try:
        snapshot = _plain(snapshot)
        # A savepoint: if this fails, the save it belongs to still goes through.
        async with db.begin_nested():
            ids = (await db.execute(select(AssetRevision.id, AssetRevision.snapshot).where(
                AssetRevision.asset_type == asset_type, AssetRevision.asset_id == str(asset_id)
            ).order_by(desc(AssetRevision.created_at)))).all()
            if ids and ids[0].snapshot == snapshot:
                return
            db.add(AssetRevision(asset_type=asset_type, asset_id=str(asset_id), snapshot=snapshot, created_by=user_id))
            old = [row.id for row in ids[KEEP_PER_ASSET - 1:]]
            if old:
                await db.execute(delete(AssetRevision).where(AssetRevision.id.in_(old)))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Revision of %s %s not kept: %s", asset_type, asset_id, exc)


def changed_fields(older: Dict[str, Any], newer: Dict[str, Any]) -> list:
    return sorted(k for k in {*older, *newer} if older.get(k) != newer.get(k))
