"""Link workbooks to at most one active FILE data source (Ask / dashboards)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.data.models import DataSource

logger = logging.getLogger(__name__)


async def find_workbook_data_sources(
    db: AsyncSession,
    workbook_id: str,
    *,
    project_id: Optional[str] = None,
    active_only: bool = True,
) -> List[DataSource]:
    """All data sources tagged with this workbook_id (newest first)."""
    wb_id = str(workbook_id)
    query = select(DataSource).where(
        DataSource.connection_config.op("->>")("workbook_id") == wb_id,
    )
    if active_only:
        query = query.where(DataSource.is_active == True)  # noqa: E712
    if project_id:
        try:
            query = query.where(DataSource.project_id == UUID(str(project_id)))
        except (ValueError, TypeError):
            pass
    query = query.order_by(
        DataSource.updated_at.desc().nulls_last(),
        DataSource.created_at.desc(),
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def resolve_workbook_data_source_id(
    db: AsyncSession,
    workbook_id: str,
    *,
    project_id: Optional[str] = None,
) -> Tuple[Optional[str], int]:
    """
    Pick the canonical data source for a workbook.
    If several rows share workbook_id, keep the newest and deactivate the rest.
    Returns (source_id, number_deactivated).
    """
    rows = await find_workbook_data_sources(db, workbook_id, project_id=project_id, active_only=False)
    if not rows:
        return None, 0

    def _sort_key(d: DataSource) -> datetime:
        ts = getattr(d, "updated_at", None) or getattr(d, "created_at", None)
        if ts is None:
            return datetime.min.replace(tzinfo=timezone.utc)
        return ts

    rows.sort(key=_sort_key, reverse=True)
    canonical = rows[0]
    deactivated = 0
    now = datetime.now(timezone.utc)
    for extra in rows[1:]:
        if extra.is_active:
            extra.is_active = False
            extra.updated_at = now
            deactivated += 1
            logger.info(
                "Deactivated duplicate workbook data source %s (workbook=%s); canonical=%s",
                extra.id,
                workbook_id,
                canonical.id,
            )
    if deactivated:
        await db.commit()
    return str(canonical.id), deactivated


def workbook_upload_options(
    workbook_id: str,
    title: str,
    *,
    project_id: Optional[str],
    organization_id: Optional[str],
    user_id: str,
    existing_source_id: Optional[str] = None,
) -> Dict[str, Any]:
    display = f"{title} (Sheet)".strip() or "Workbook (Sheet)"
    opts: Dict[str, Any] = {
        "project_id": project_id,
        "organization_id": organization_id,
        "user_id": user_id,
        "name": display,
        "connection_config": {
            "workbook_id": str(workbook_id),
            "source_type": "workbook",
        },
    }
    if existing_source_id:
        opts["source_id"] = existing_source_id
    return opts


def _normalize_file_source_name(name: Optional[str]) -> str:
    n = (name or "").strip().lower()
    if n.endswith(" (sheet)"):
        n = n[: -len(" (sheet)")].strip()
    return n or "untitled"


def _file_source_rank(ds: DataSource) -> tuple:
    cfg = ds.connection_config if isinstance(ds.connection_config, dict) else {}
    has_workbook = 1 if cfg.get("workbook_id") else 0
    ts = getattr(ds, "updated_at", None) or getattr(ds, "created_at", None)
    if ts is None:
        ts = datetime.min.replace(tzinfo=timezone.utc)
    return (has_workbook, ts)


async def dedupe_project_file_sources(
    db: AsyncSession,
    *,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Deactivate duplicate active FILE data sources in a project.

    - Same display name (normalized): keep row with workbook_id, else newest.
    - Same workbook_id: keep newest (resolve_workbook_data_source_id).
    - workbook_id points at a deleted workbook: deactivate source.
    """
    from src.modules.workbooks.models import Workbook

    query = select(DataSource).where(
        DataSource.is_active == True,  # noqa: E712
        DataSource.type == "file",
    )
    if project_id:
        try:
            query = query.where(DataSource.project_id == UUID(str(project_id)))
        except (ValueError, TypeError):
            pass
    result = await db.execute(query)
    rows = list(result.scalars().all())

    deactivated_ids: List[str] = []
    kept_ids: List[str] = []
    now = datetime.now(timezone.utc)

    workbook_ids = set()
    for ds in rows:
        cfg = ds.connection_config if isinstance(ds.connection_config, dict) else {}
        wb = cfg.get("workbook_id")
        if wb:
            workbook_ids.add(str(wb))

    for wb_id in workbook_ids:
        canonical_id, n = await resolve_workbook_data_source_id(db, wb_id, project_id=project_id)
        if canonical_id:
            kept_ids.append(canonical_id)
        if n:
            logger.info("dedupe_project_file_sources workbook=%s deactivated=%s", wb_id, n)

    result = await db.execute(query)
    rows = [r for r in result.scalars().all() if r.is_active]

    for ds in rows:
        cfg = ds.connection_config if isinstance(ds.connection_config, dict) else {}
        wb_id = cfg.get("workbook_id")
        if wb_id:
            try:
                wb = await db.get(Workbook, UUID(str(wb_id)))
            except (ValueError, TypeError):
                wb = None
            if wb is None or getattr(wb, "is_deleted", False):
                ds.is_active = False
                ds.updated_at = now
                deactivated_ids.append(str(ds.id))
                logger.info(
                    "Deactivated file source %s — workbook %s missing or deleted",
                    ds.id,
                    wb_id,
                )

    groups: Dict[str, List[DataSource]] = {}
    for ds in rows:
        if not ds.is_active:
            continue
        key = f"{ds.project_id}:{_normalize_file_source_name(ds.name)}"
        groups.setdefault(key, []).append(ds)

    for group in groups.values():
        if len(group) < 2:
            continue
        group.sort(key=_file_source_rank, reverse=True)
        winner = group[0]
        kept_ids.append(str(winner.id))
        for extra in group[1:]:
            if extra.is_active and str(extra.id) != str(winner.id):
                extra.is_active = False
                extra.updated_at = now
                deactivated_ids.append(str(extra.id))

    if deactivated_ids:
        await db.commit()

    return {
        "deactivated_count": len(deactivated_ids),
        "deactivated_ids": deactivated_ids,
        "kept_ids": list(dict.fromkeys(kept_ids)),
    }
