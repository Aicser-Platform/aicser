"""CRUD for saved Custom report templates - org-scoped, name+vars only."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from ee.modules.ai.reports.template_service import (
    ReportTemplateAccessError,
    create_report_template,
    delete_report_template,
    list_report_templates,
    update_report_template,
)


def _fake_template(name="My Look", vars=None, org_id=None, template_id=None):
    return SimpleNamespace(
        id=template_id or uuid4(),
        organization_id=org_id or uuid4(),
        name=name,
        vars=vars or {"--report-accent": "#6d4fd6"},
        created_by=None,
        created_at=None,
        updated_at=None,
        is_deleted=False,
    )


def _session_cm(session):
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


def _scalar_result(value):
    """Mimics `(await session.execute(...)).scalar_one_or_none()` / `.scalars().all()`."""
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=value if isinstance(value, list) else [])))
    return result


@pytest.mark.asyncio
async def test_list_report_templates_serializes_rows():
    org_id = str(uuid4())
    templates = [_fake_template(name="A"), _fake_template(name="B")]
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_scalar_result(templates))
    with patch("ee.modules.ai.reports.template_service.async_session", return_value=_session_cm(session)):
        result = await list_report_templates(org_id)
    assert [t["name"] for t in result] == ["A", "B"]
    assert result[0]["vars"] == {"--report-accent": "#6d4fd6"}


@pytest.mark.asyncio
async def test_create_report_template_rejects_blank_name():
    with pytest.raises(HTTPException) as exc_info:
        await create_report_template(str(uuid4()), None, name="   ", vars={})
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_create_report_template_rejects_duplicate_name_case_insensitive():
    org_id = str(uuid4())
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_scalar_result(_fake_template(name="Executive Look")))
    with patch("ee.modules.ai.reports.template_service.async_session", return_value=_session_cm(session)):
        with pytest.raises(HTTPException) as exc_info:
            await create_report_template(org_id, None, name="executive look", vars={})
    assert exc_info.value.status_code == 409


@pytest.mark.asyncio
async def test_create_report_template_success():
    org_id = str(uuid4())
    session = AsyncMock()
    # First execute() call: duplicate-name check finds nothing.
    session.execute = AsyncMock(return_value=_scalar_result(None))
    session.add = MagicMock()
    session.commit = AsyncMock()

    async def fake_refresh(obj):
        obj.id = uuid4()
        obj.created_at = None
        obj.updated_at = None

    session.refresh = AsyncMock(side_effect=fake_refresh)
    with patch("ee.modules.ai.reports.template_service.async_session", return_value=_session_cm(session)):
        result = await create_report_template(org_id, str(uuid4()), name="New Look", vars={"--report-accent": "#000"})
    assert result["name"] == "New Look"
    assert result["vars"] == {"--report-accent": "#000"}
    session.add.assert_called_once()


@pytest.mark.asyncio
async def test_update_report_template_not_found_raises_404():
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_scalar_result(None))
    with patch("ee.modules.ai.reports.template_service.async_session", return_value=_session_cm(session)):
        with pytest.raises(ReportTemplateAccessError) as exc_info:
            await update_report_template(str(uuid4()), str(uuid4()), name="X")
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_update_report_template_malformed_id_raises_404():
    with patch("ee.modules.ai.reports.template_service.async_session"):
        with pytest.raises(ReportTemplateAccessError) as exc_info:
            await update_report_template(str(uuid4()), "not-a-uuid", name="X")
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_report_template_soft_deletes():
    template = _fake_template()
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_scalar_result(template))
    session.commit = AsyncMock()
    with patch("ee.modules.ai.reports.template_service.async_session", return_value=_session_cm(session)):
        await delete_report_template(str(template.organization_id), str(template.id))
    assert template.is_deleted is True
