"""Segregation of duties for notebook/workbook certification (submitter ≠ approver)."""
from __future__ import annotations

import uuid

from fastapi import HTTPException

from src.modules.notebooks.settings_schema import NotebookSettings


def assert_approver_not_submitter(settings: NotebookSettings, user_id: uuid.UUID) -> None:
    submitted = settings.certification.submitted_by
    if submitted and str(user_id) == submitted:
        raise HTTPException(
            status_code=403,
            detail="A different reviewer must approve or reject. You submitted this document for review.",
        )


def assert_in_review(settings: NotebookSettings) -> None:
    if settings.certification.status != "in_review":
        raise HTTPException(status_code=409, detail="Document is not in review.")
