"""Enterprise notebook operations: certification, git bundle, catalog lineage."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.notebooks import ipynb
from src.modules.notebooks.audit import log_notebook_event
from src.modules.notebooks.models import Notebook
from src.modules.notebooks.certification_policy import assert_approver_not_submitter, assert_in_review
from src.modules.notebooks.settings_schema import NotebookSettings, parse_settings


def settings_locked(settings: NotebookSettings) -> bool:
    cert = settings.certification
    return cert.status == "approved" and cert.locks_edits


async def update_settings(
    db: AsyncSession,
    nb: Notebook,
    patch: Dict[str, Any],
    user_id: uuid.UUID,
) -> NotebookSettings:
    current = parse_settings(nb.settings)
    if settings_locked(current) and patch.get("certification") is None:
        raise HTTPException(status_code=403, detail="This notebook is certified and locked. Submit a new version or unlock from governance.")
    merged = current.model_dump()
    for key in ("parameters", "compute_profile", "git"):
        if key in patch:
            merged[key] = patch[key]
    if "certification" in patch:
        merged["certification"] = {**current.certification.model_dump(), **patch["certification"]}
    new_settings = NotebookSettings.model_validate(merged)
    nb.settings = new_settings.model_dump()
    await log_notebook_event(db, notebook_id=nb.id, user_id=user_id, action="settings_update", metadata={"keys": list(patch.keys())})
    return new_settings


async def submit_for_review(db: AsyncSession, nb: Notebook, user_id: uuid.UUID) -> NotebookSettings:
    settings = parse_settings(nb.settings)
    settings.certification.status = "in_review"
    settings.certification.submitted_by = str(user_id)
    settings.certification.locks_edits = False
    nb.settings = settings.model_dump()
    await log_notebook_event(db, notebook_id=nb.id, user_id=user_id, action="certify_submit")
    return settings


async def approve_notebook(db: AsyncSession, nb: Notebook, user_id: uuid.UUID, note: Optional[str], lock: bool) -> NotebookSettings:
    settings = parse_settings(nb.settings)
    assert_in_review(settings)
    assert_approver_not_submitter(settings, user_id)
    settings.certification.status = "approved"
    settings.certification.certified_by = str(user_id)
    settings.certification.certified_at = datetime.now(timezone.utc).isoformat()
    settings.certification.note = note
    settings.certification.locks_edits = lock
    nb.settings = settings.model_dump()
    await log_notebook_event(db, notebook_id=nb.id, user_id=user_id, action="certify_approve", metadata={"lock": lock})
    return settings


async def reject_notebook(db: AsyncSession, nb: Notebook, user_id: uuid.UUID, note: Optional[str]) -> NotebookSettings:
    settings = parse_settings(nb.settings)
    assert_in_review(settings)
    assert_approver_not_submitter(settings, user_id)
    settings.certification.status = "rejected"
    settings.certification.note = note
    settings.certification.locks_edits = False
    nb.settings = settings.model_dump()
    await log_notebook_event(db, notebook_id=nb.id, user_id=user_id, action="certify_reject")
    return settings


def git_export_bundle(nb: Notebook) -> Dict[str, Any]:
    settings = parse_settings(nb.settings)
    ipynb_doc = ipynb.to_ipynb(nb.title, nb.cells or [])
    manifest = {
        "notebook_id": str(nb.id),
        "title": nb.title,
        "version": nb.version,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "git": settings.git.model_dump(),
        "suggested_path": f"notebooks/{nb.title.replace(' ', '_')[:80]}.ipynb",
    }
    settings.git.last_export_at = manifest["exported_at"]
    settings.git.last_commit_message = f"Export {nb.title} v{nb.version}"
    nb.settings = settings.model_dump()
    return {"manifest": manifest, "ipynb": ipynb_doc}


async def register_lineage(
    db: AsyncSession,
    *,
    nb: Notebook,
    user_id: uuid.UUID,
    dataset_id: Optional[str],
    dataset_name: str,
    upstream_source_ids: list[str],
) -> None:
    await log_notebook_event(
        db,
        notebook_id=nb.id,
        user_id=user_id,
        action="lineage_dataset",
        metadata={"dataset_id": dataset_id, "dataset_name": dataset_name, "sources": upstream_source_ids},
    )
    if not nb.project_id:
        return
    try:
        from src.modules.catalog.models import CatalogAsset
        from sqlalchemy import select

        pid = nb.project_id
        ref = f"notebook:{nb.id}:dataset:{dataset_name}"
        existing = await db.execute(
            select(CatalogAsset).where(
                CatalogAsset.project_id == pid,
                CatalogAsset.asset_type == "notebook_dataset",
                CatalogAsset.source_ref == ref,
            )
        )
        row = existing.scalar_one_or_none()
        tags = {"notebook_id": str(nb.id), "dataset_name": dataset_name, "upstream_sources": upstream_source_ids}
        if row:
            row.name = dataset_name
            row.tags = tags
            row.freshness_at = datetime.now(timezone.utc)
        else:
            db.add(
                CatalogAsset(
                    id=uuid.uuid4(),
                    project_id=pid,
                    asset_type="notebook_dataset",
                    source_ref=ref,
                    name=dataset_name,
                    description=f"Saved from notebook {nb.title}",
                    owner_user_id=nb.user_id,
                    tags=tags,
                    freshness_at=datetime.now(timezone.utc),
                )
            )
        try:
            from src.modules.platform.lineage_service import emit_lineage_event

            await emit_lineage_event(
                db,
                event_type="notebook_dataset_saved",
                project_id=str(nb.project_id),
                actor_user_id=str(user_id),
                data_source_id=upstream_source_ids[0] if upstream_source_ids else None,
                payload={"notebook_id": str(nb.id), "dataset_name": dataset_name, "dataset_id": dataset_id},
            )
        except Exception:
            pass
    except ImportError:
        pass
