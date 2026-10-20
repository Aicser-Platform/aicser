"""Catalog + platform lineage for live data ranges on a workbook."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.workbooks.audit import log_workbook_event


async def sync_range_lineage(
    db: AsyncSession,
    *,
    wb: Any,
    user_id: uuid.UUID,
    ranges: List[Dict[str, Any]],
) -> None:
    live = [r for r in ranges if r.get("mode") == "live" and r.get("data_source_id") and r.get("sql")]
    if not live:
        return
    source_ids = sorted({str(r["data_source_id"]) for r in live})
    await log_workbook_event(
        db,
        workbook_id=wb.id,
        user_id=user_id,
        action="lineage_ranges",
        metadata={"range_count": len(live), "data_source_ids": source_ids},
    )
    if not wb.project_id:
        return
    try:
        from src.modules.catalog.models import CatalogAsset

        pid = wb.project_id
        ref = f"workbook:{wb.id}:ranges"
        existing = await db.execute(
            select(CatalogAsset).where(
                CatalogAsset.project_id == pid,
                CatalogAsset.asset_type == "workbook_ranges",
                CatalogAsset.source_ref == ref,
            )
        )
        row = existing.scalar_one_or_none()
        tags = {
            "workbook_id": str(wb.id),
            "range_ids": [r.get("id") for r in live],
            "data_source_ids": source_ids,
        }
        if row:
            row.name = f"{wb.title} — live ranges"
            row.tags = tags
            row.freshness_at = datetime.now(timezone.utc)
        else:
            db.add(
                CatalogAsset(
                    id=uuid.uuid4(),
                    project_id=pid,
                    asset_type="workbook_ranges",
                    source_ref=ref,
                    name=f"{wb.title} — live ranges",
                    description="Governed SQL ranges embedded in an Aicser Sheet",
                    owner_user_id=wb.user_id,
                    tags=tags,
                    freshness_at=datetime.now(timezone.utc),
                )
            )
        for r in live:
            ds_id = str(r["data_source_id"])
            rref = f"workbook:{wb.id}:range:{r.get('id')}"
            rrow = (
                await db.execute(
                    select(CatalogAsset).where(
                        CatalogAsset.project_id == pid,
                        CatalogAsset.asset_type == "workbook_range",
                        CatalogAsset.source_ref == rref,
                    )
                )
            ).scalar_one_or_none()
            rtags = {
                "workbook_id": str(wb.id),
                "range_id": r.get("id"),
                "data_source_id": ds_id,
                "sql_preview": (r.get("sql") or "")[:500],
            }
            name = r.get("name") or f"Range {r.get('id')}"
            if rrow:
                rrow.name = name
                rrow.tags = rtags
                rrow.freshness_at = datetime.now(timezone.utc)
            else:
                db.add(
                    CatalogAsset(
                        id=uuid.uuid4(),
                        project_id=pid,
                        asset_type="workbook_range",
                        source_ref=rref,
                        name=name,
                        description=f"Live range on sheet {wb.title}",
                        owner_user_id=wb.user_id,
                        tags=rtags,
                        freshness_at=datetime.now(timezone.utc),
                    )
                )
        try:
            from src.modules.platform.lineage_service import emit_lineage_event

            for ds_id in source_ids:
                await emit_lineage_event(
                    db,
                    event_type="workbook_ranges_saved",
                    project_id=str(wb.project_id),
                    actor_user_id=str(user_id),
                    data_source_id=ds_id,
                    payload={"workbook_id": str(wb.id), "range_count": len(live)},
                )
        except Exception:
            pass
    except ImportError:
        pass
