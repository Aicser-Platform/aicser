import uuid

import pytest
from fastapi import HTTPException

from src.modules.notebooks.certification_policy import assert_approver_not_submitter, assert_in_review
from src.modules.notebooks.settings_schema import NotebookSettings


def test_approver_cannot_be_submitter():
    uid = uuid.uuid4()
    settings = NotebookSettings()
    settings.certification.status = "in_review"
    settings.certification.submitted_by = str(uid)
    with pytest.raises(HTTPException) as exc:
        assert_approver_not_submitter(settings, uid)
    assert exc.value.status_code == 403


def test_different_user_may_approve():
    settings = NotebookSettings()
    settings.certification.status = "in_review"
    settings.certification.submitted_by = str(uuid.uuid4())
    assert_approver_not_submitter(settings, uuid.uuid4())


def test_must_be_in_review():
    settings = NotebookSettings()
    with pytest.raises(HTTPException) as exc:
        assert_in_review(settings)
    assert exc.value.status_code == 409
