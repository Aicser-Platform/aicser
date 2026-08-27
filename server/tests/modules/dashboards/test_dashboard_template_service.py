"""CRUD for saved dashboard templates - wires up dashboard_templates, a
table that existed since the initial migration but was never used."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.modules.dashboards.template_service import (
    DashboardTemplateAccessError,
    increment_template_usage,
    list_saved_dashboard_templates,
    save_dashboard_as_template,
    update_saved_dashboard_template,
)


def _fake_template(name="Sales Ops", org_id=None, template_id=None, usage_count=0):
    return SimpleNamespace(
        id=template_id or uuid4(),
        organization_id=org_id or uuid4(),
        name=name,
        description="A saved look",
        category="sales",
        template_config={"widgets": [{"name": "Revenue", "widget_type": "chart"}]},
        preview_image_url=None,
        is_public=False,
        is_featured=False,
        usage_count=usage_count,
        rating=0.0,
        required_plan="free",
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
    result = MagicMock()
    result.scalar_one_or_none = MagicMock(return_value=value)
    result.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=value if isinstance(value, list) else [])))
    return result


@pytest.mark.asyncio
async def test_list_saved_dashboard_templates_without_org_returns_empty():
    assert await list_saved_dashboard_templates(None) == []


@pytest.mark.asyncio
async def test_list_saved_dashboard_templates_serializes_rows():
    templates = [_fake_template(name="A"), _fake_template(name="B")]
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_scalar_result(templates))
    with patch("src.modules.dashboards.template_service.async_session", return_value=_session_cm(session)):
        result = await list_saved_dashboard_templates(str(uuid4()))
    assert [t["name"] for t in result] == ["A", "B"]
    assert result[0]["source"] == "saved"
    assert result[0]["template_config"] == {"widgets": [{"name": "Revenue", "widget_type": "chart"}]}


@pytest.mark.asyncio
async def test_save_dashboard_as_template_rejects_blank_name():
    with pytest.raises(HTTPException) as exc_info:
        await save_dashboard_as_template(str(uuid4()), None, name="  ", template_config={})
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_save_dashboard_as_template_success():
    session = AsyncMock()
    session.add = MagicMock()
    session.commit = AsyncMock()

    async def fake_refresh(obj):
        obj.id = uuid4()
        obj.created_at = None
        obj.updated_at = None

    session.refresh = AsyncMock(side_effect=fake_refresh)
    with patch("src.modules.dashboards.template_service.async_session", return_value=_session_cm(session)):
        result = await save_dashboard_as_template(
            str(uuid4()), str(uuid4()), name="Sales Ops", template_config={"widgets": []}, category="sales"
        )
    assert result["name"] == "Sales Ops"
    assert result["category"] == "sales"
    assert result["usage_count"] == 0
    session.add.assert_called_once()


@pytest.mark.asyncio
async def test_update_saved_dashboard_template_not_found_raises_404():
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_scalar_result(None))
    with patch("src.modules.dashboards.template_service.async_session", return_value=_session_cm(session)):
        with pytest.raises(DashboardTemplateAccessError) as exc_info:
            await update_saved_dashboard_template(str(uuid4()), str(uuid4()), name="X")
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_increment_template_usage_never_raises_on_failure():
    with patch("src.modules.dashboards.template_service.async_session", side_effect=RuntimeError("db down")):
        await increment_template_usage(str(uuid4()), str(uuid4()))  # must not raise
