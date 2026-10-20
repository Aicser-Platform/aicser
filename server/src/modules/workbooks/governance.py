"""Workbook governance (shared settings schema with notebooks)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.notebooks.certification_policy import assert_approver_not_submitter, assert_in_review
from src.modules.notebooks.settings_schema import NotebookSettings, parse_settings
from src.modules.workbooks.audit import log_workbook_event


def settings_locked(settings: NotebookSettings) -> bool:
    cert = settings.certification
    return cert.status == "approved" and cert.locks_edits


async def update_settings(db: AsyncSession, wb: Any, patch: Dict[str, Any], user_id: uuid.UUID) -> NotebookSettings:
    current = parse_settings(getattr(wb, "settings", None))
    if settings_locked(current) and patch.get("certification") is None:
        raise HTTPException(status_code=403, detail="This workbook is certified and locked for editing.")
    merged = current.model_dump()
    for key in ("parameters", "compute_profile", "git", "visual_embeds", "analyze_bindings"):
        if key in patch:
            merged[key] = patch[key]
    if "certification" in patch:
        merged["certification"] = {**current.certification.model_dump(), **patch["certification"]}
    new_settings = NotebookSettings.model_validate(merged)
    wb.settings = new_settings.model_dump()
    await log_workbook_event(db, workbook_id=wb.id, user_id=user_id, action="settings_update", metadata={"keys": list(patch.keys())})
    return new_settings


async def submit_for_review(db: AsyncSession, wb: Any, user_id: uuid.UUID) -> NotebookSettings:
    settings = parse_settings(wb.settings)
    settings.certification.status = "in_review"
    settings.certification.submitted_by = str(user_id)
    settings.certification.locks_edits = False
    wb.settings = settings.model_dump()
    await log_workbook_event(db, workbook_id=wb.id, user_id=user_id, action="certify_submit")
    return settings


async def approve_workbook(db: AsyncSession, wb: Any, user_id: uuid.UUID, note: Optional[str], lock: bool) -> NotebookSettings:
    settings = parse_settings(wb.settings)
    assert_in_review(settings)
    assert_approver_not_submitter(settings, user_id)
    settings.certification.status = "approved"
    settings.certification.certified_by = str(user_id)
    settings.certification.certified_at = datetime.now(timezone.utc).isoformat()
    settings.certification.note = note
    settings.certification.locks_edits = lock
    wb.settings = settings.model_dump()
    await log_workbook_event(db, workbook_id=wb.id, user_id=user_id, action="certify_approve", metadata={"lock": lock})
    return settings


async def reject_workbook(db: AsyncSession, wb: Any, user_id: uuid.UUID, note: Optional[str]) -> NotebookSettings:
    settings = parse_settings(wb.settings)
    assert_in_review(settings)
    assert_approver_not_submitter(settings, user_id)
    settings.certification.status = "rejected"
    settings.certification.note = note
    settings.certification.locks_edits = False
    wb.settings = settings.model_dump()
    await log_workbook_event(db, workbook_id=wb.id, user_id=user_id, action="certify_reject")
    return settings
